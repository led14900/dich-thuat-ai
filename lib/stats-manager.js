const fs = require('fs/promises');
const path = require('path');

class StatsManager {
  constructor(userDataPath) {
    this.statsFile = path.join(userDataPath, 'translation_stats.json');
  }

  async _loadStats() {
    try {
      const data = await fs.readFile(this.statsFile, 'utf8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed.stats) ? parsed.stats : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      console.error('Lỗi đọc file thống kê:', err);
      return [];
    }
  }

  async _saveStats(statsArray) {
    try {
      await fs.writeFile(this.statsFile, JSON.stringify({ stats: statsArray }, null, 2));
    } catch (err) {
      console.error('Lỗi lưu file thống kê:', err);
    }
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

  async addRecord(record) {
    try {
      const stats = await this._loadStats();
      const newRecord = {
        timestamp: record.timestamp || new Date().toISOString(),
        pageCount: record.pageCount || 1,
        pagesProcessed: record.pagesProcessed || 1,
        sourceLang: record.sourceLang,
        targetLang: record.targetLang,
        model: record.model,
        totalTokens: record.totalTokens || 0,
        costUSD: record.costUSD || 0,
        success: record.success !== false
      };
      stats.push(newRecord);
      await this._saveStats(stats);
    } catch (err) {
      console.error('Lỗi thêm bản ghi thống kê:', err);
    }
  }

  async getAll() {
    return this._loadStats();
  }

  /**
   * Delete statistics records older than a certain number of days
   */
  async deleteOlderThan(days) {
    try {
      const stats = await this._loadStats();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parseInt(days, 10));
      
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
  }

  /**
   * Delete all statistics records
   */
  async clearAll() {
    try {
      await this._saveStats([]);
      return { success: true };
    } catch (err) {
      console.error('Lỗi khi xóa toàn bộ thống kê:', err);
      throw err;
    }
  }
}

module.exports = StatsManager;
