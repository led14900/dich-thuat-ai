const fs = require('fs/promises');
const path = require('path');
const { writeJsonAtomic, readJsonSafe, SerialQueue } = require('./atomic-json-store');

class StatsManager {
  constructor(userDataPath) {
    this.statsFile = path.join(userDataPath, 'translation_stats.json');
    // Hai addRecord chay song song tung doc cung mot anh chup roi ghi de len
    // nhau, lam mat mot ban ghi. Xep hang tuan tu.
    this.queue = new SerialQueue();
  }

  async _loadStats() {
    const parsed = await readJsonSafe(this.statsFile, { stats: [] });
    return Array.isArray(parsed.stats) ? parsed.stats : [];
  }

  async _saveStats(statsArray) {
    await writeJsonAtomic(this.statsFile, { stats: statsArray });
  }

  /**
   * Migrate existing history entries into stats file on first launch
   */
  async ensureStatsInitialized(historyManager) {
    try {
      await fs.access(this.statsFile);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log('Initializing stats database from translation history...');
        try {
          const historyEntries = await historyManager._loadHistory();
          const stats = historyEntries.map(h => ({
            timestamp: h.timestamp,
            documentKey: h.documentKey || null,
            inputFile: h.inputFile || null,
            runId: h.runId || null,
            status: h.status || (h.success === false ? 'cancelled' : 'completed'),
            pageCount: h.pageCount,
            pagesProcessed: h.pagesProcessed,
            sourceLang: h.sourceLang,
            targetLang: h.targetLang,
            model: h.model,
            totalTokens: h.totalTokens,
            costUSD: h.costUSD,
            success: h.success
          }));
          await this._saveStats(stats);
        } catch (migrationErr) {
          console.error('Lỗi di cư dữ liệu lịch sử sang thống kê:', migrationErr);
        }
      }
    }
  }

  /**
   * Một bản ghi thống kê là MỘT PHIÊN xử lý, không phải một tài liệu.
   *
   * `pagesProcessed` phải là số trang dịch được TRONG PHIÊN NÀY, không phải
   * tổng luỹ kế. Trước đây lần "Chạy tiếp" ghi tổng cả trang của lần trước,
   * nên tài liệu 10 trang huỷ ở trang 4 rồi chạy tiếp bị cộng thành 14 trang.
   *
   * `documentKey` và `runId` để Dashboard đếm được tài liệu duy nhất và số
   * lần dịch, thay vì đếm số bản ghi.
   */
  async addRecord(record) {
    return this.queue.run(async () => {
      try {
        const stats = await this._loadStats();
        stats.push({
          timestamp: record.timestamp || new Date().toISOString(),
          documentKey: record.documentKey || null,
          inputFile: record.inputFile || null,
          runId: record.runId || null,
          pageCount: record.pageCount ?? 1,
          pagesProcessed: record.pagesProcessed ?? 0,
          sourceLang: record.sourceLang,
          targetLang: record.targetLang,
          model: record.model,
          totalTokens: record.totalTokens || 0,
          costUSD: record.costUSD || 0,
          success: record.success !== false,
          status: record.status || (record.success === false ? 'cancelled' : 'completed'),
        });
        await this._saveStats(stats);
      } catch (err) {
        console.error('Lỗi thêm bản ghi thống kê:', err);
      }
    });
  }

  async getAll() {
    return this._loadStats();
  }

  /**
   * Xoá các bản ghi thống kê thuộc về những mục lịch sử vừa bị xoá.
   *
   * Người dùng xoá một mục trong Lịch sử là muốn xoá hẳn lần dịch đó, nhưng
   * thống kê nằm ở file riêng nên trước đây vẫn còn nguyên — mở Thống kê lên
   * vẫn thấy chi phí của thứ mình tưởng đã xoá.
   *
   * Ghép theo `runId`. Bản ghi cũ (trước 1.2.10) không có runId thì ghép theo
   * cùng file và thời điểm lệch dưới 1 phút — lịch sử và thống kê của cùng một
   * lần dịch luôn được ghi cách nhau vài mili giây.
   */
  async deleteForHistoryEntries(entries) {
    const list = (entries || []).filter(Boolean);
    if (list.length === 0) return { deletedCount: 0 };

    const runIds = new Set(list.map(e => e.runId).filter(Boolean));
    const loose = list
      .filter(e => !e.runId && e.timestamp)
      .map(e => ({ key: e.documentKey || null, at: new Date(e.timestamp).getTime() }))
      .filter(e => Number.isFinite(e.at));

    return this.queue.run(async () => {
      const stats = await this._loadStats();
      const kept = stats.filter(rec => {
        if (rec.runId && runIds.has(rec.runId)) return false;
        if (!rec.runId && loose.length && rec.timestamp) {
          const at = new Date(rec.timestamp).getTime();
          const hit = loose.some(e =>
            Math.abs(at - e.at) < 60000 && (!e.key || !rec.documentKey || e.key === rec.documentKey));
          if (hit) return false;
        }
        return true;
      });
      await this._saveStats(kept);
      return { deletedCount: stats.length - kept.length };
    });
  }

  /**
   * Delete statistics records older than a certain number of days
   */
  async deleteOlderThan(days) {
    const n = parseInt(days, 10);
    // NaN, 0 hay so am loc het sach ban ghi ma nguoi dung khong he yeu cau.
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error('Số ngày không hợp lệ.');
    }
    return this.queue.run(async () => {
    try {
      const stats = await this._loadStats();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - n);
      
      const filtered = stats.filter(item => {
        if (!item.timestamp) return true; // keep if no timestamp
        const itemDate = new Date(item.timestamp);
        return itemDate >= cutoff; // keep only if it is newer than cutoff
      });
      
      await this._saveStats(filtered);
      return { success: true, deletedCount: stats.length - filtered.length };
    } catch (err) {
      console.error('Lỗi khi xóa thống kê cũ:', err);
      throw err;
    }
    });
  }

  /**
   * Delete all statistics records
   */
  async clearAll() {
    return this.queue.run(async () => {
      try {
        await this._saveStats([]);
        return { success: true };
      } catch (err) {
        console.error('Lỗi khi xóa toàn bộ thống kê:', err);
        throw err;
      }
    });
  }
}

module.exports = StatsManager;
