const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const { writeJsonAtomic, readJsonSafe, SerialQueue, documentKeyFor } = require('./atomic-json-store');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class HistoryManager {
  constructor(userDataPath) {
    this.historyFile = path.join(userDataPath, 'translation_history.json');
    this.historyCache = null;
    // Mot hang doi duy nhat cho moi thao tac doc-sua-ghi.
    this.queue = new SerialQueue();
  }

  /**
   * Loads the history array from the JSON file into memory cache
   */
  async _loadHistory() {
    if (this.historyCache !== null) {
      return this.historyCache;
    }
    const parsed = await readJsonSafe(this.historyFile, { history: [] });
    this.historyCache = Array.isArray(parsed.history) ? parsed.history : [];
    return this.historyCache;
  }

  /**
   * Saves the cache to the JSON file
   */
  /**
   * Ghi xuống đĩa. Cố tình KHÔNG bắt lỗi: nơi gọi phải biết là ghi hỏng, vì
   * renderer dựa vào kết quả này để quyết định có xoá checkpoint hay không.
   * Nuốt lỗi ở đây từng là cửa sổ mất cả lịch sử lẫn checkpoint.
   */
  async _saveHistory() {
    if (this.historyCache === null) return;
    await writeJsonAtomic(this.historyFile, { history: this.historyCache });
  }

  /**
   * Add a new entry to the history
   */
  async addEntry(entryData) {
    return this.queue.run(async () => {
    await this._loadHistory();

    // Compress markdown content to save space
    let compressedMarkdown = null;
    if (entryData.markdownContent) {
      const buffer = await gzip(entryData.markdownContent);
      compressedMarkdown = buffer.toString('base64');
    }

    const newEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      inputFile: entryData.inputFile,
      // Cung mot duong dan la cung mot tai lieu, du dich lai bao nhieu lan.
      documentKey: documentKeyFor(entryData.inputFile),
      inputType: entryData.inputType,
      pageCount: entryData.pageCount ?? 1,
      // `|| 1` cu bien 0 thanh 1: mot lan huy chua xong trang nao van duoc
      // ghi la da xu ly mot trang.
      pagesProcessed: entryData.pagesProcessed ?? 0,
      sourceLang: entryData.sourceLang || 'auto',
      targetLang: entryData.targetLang,
      translateMode: entryData.translateMode,
      model: entryData.model,
      totalTokens: entryData.totalTokens || 0,
      costUSD: entryData.costUSD || 0,
      elapsedMs: entryData.elapsedMs || 0,
      outputPath: entryData.outputPath,
      success: entryData.success !== false,
      // completed | partial | cancelled | interrupted. Giu `success` cho ban
      // ghi cu va cho cho nao chi can biet dung/sai.
      status: entryData.status || (entryData.success === false ? 'cancelled' : 'completed'),
      // Lần dịch dang dở còn một checkpoint trên đĩa. Giữ id ở đây để xoá mục
      // lịch sử là xoá luôn checkpoint, không để lại dữ liệu người dùng tưởng
      // đã xoá.
      runId: entryData.runId || null,
      markdownData: compressedMarkdown // base64 gzipped text
    };

    this.historyCache.unshift(newEntry);
    await this._saveHistory();
    return newEntry.id;
    });
  }

  /**
   * Get paginated history entries (consistently returns { items, total } shape)
   */
  async getAll(page, pageSize) {
    await this._loadHistory();
    const total = this.historyCache.length;

    let items;
    if (page === undefined || pageSize === undefined) {
      items = this.historyCache.map(h => {
        const { markdownData, ...meta } = h;
        return meta;
      });
    } else {
      const startIndex = (page - 1) * pageSize;
      items = this.historyCache.slice(startIndex, startIndex + pageSize).map(h => {
        const { markdownData, ...meta } = h;
        return meta;
      });
    }

    return {
      items,
      total
    };
  }

  /**
   * Get full markdown content of an entry
   */
  async getMarkdown(id) {
    await this._loadHistory();
    const entry = this.historyCache.find(h => h.id === id);
    if (!entry || !entry.markdownData) return null;

    try {
      const buffer = Buffer.from(entry.markdownData, 'base64');
      const unzipped = await gunzip(buffer);
      return unzipped.toString('utf8');
    } catch (err) {
      console.error('Lỗi giải nén markdown:', err);
      return null;
    }
  }

  /**
   * Delete a specific entry
   */
  /**
   * Trả về chính mục vừa xoá, để nơi gọi xoá nốt checkpoint VÀ bản ghi thống
   * kê tương ứng. Trước đây chỉ trả về runId nên thống kê không có cách nào
   * biết mục nào vừa bị xoá.
   */
  async deleteEntry(id) {
    return this.queue.run(async () => {
      await this._loadHistory();
      const entry = this.historyCache.find(h => h.id === id) || null;
      this.historyCache = this.historyCache.filter(h => h.id !== id);
      await this._saveHistory();
      return entry;
    });
  }

  /**
   * Update the output path of a history entry
   */
  async updateOutputPath(id, outputPath) {
    return this.queue.run(async () => {
      await this._loadHistory();
      const entry = this.historyCache.find(h => h.id === id);
      if (!entry) return false;
      entry.outputPath = outputPath;
      await this._saveHistory();
      return true;
    });
  }

  /**
   * Update fields of a history entry
   */
  async updateEntry(id, fields) {
    return this.queue.run(async () => {
    await this._loadHistory();
    const entry = this.historyCache.find(h => h.id === id);
    if (entry) {
      if (fields.markdownContent !== undefined) {
        if (fields.markdownContent) {
          const buffer = await gzip(fields.markdownContent);
          entry.markdownData = buffer.toString('base64');
        } else {
          entry.markdownData = null;
        }
      }
      for (const [key, val] of Object.entries(fields)) {
        if (key !== 'markdownContent') {
          entry[key] = val;
        }
      }
      await this._saveHistory();
      return true;
    }
    return false;
    });
  }

  /**
   * Clear all history
   */
  /** Trả về toàn bộ mục đã xoá để nơi gọi dọn checkpoint và thống kê theo. */
  async clearAll() {
    return this.queue.run(async () => {
      await this._loadHistory();
      const removed = this.historyCache;
      this.historyCache = [];
      await this._saveHistory();
      return removed;
    });
  }
}

module.exports = HistoryManager;
