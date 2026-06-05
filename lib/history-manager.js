const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class HistoryManager {
  constructor(userDataPath) {
    this.historyFile = path.join(userDataPath, 'translation_history.json');
    this.maxEntries = 500;
  }

  /**
   * Loads the history array from the JSON file
   */
  async _loadHistory() {
    try {
      const data = await fs.readFile(this.historyFile, 'utf8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed.history) ? parsed.history : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      console.error('Lỗi đọc file lịch sử:', err);
      return [];
    }
  }

  /**
   * Saves the history array to the JSON file
   */
  async _saveHistory(historyArray) {
    try {
      await fs.writeFile(this.historyFile, JSON.stringify({ history: historyArray }, null, 2));
    } catch (err) {
      console.error('Lỗi lưu file lịch sử:', err);
    }
  }

  /**
   * Add a new entry to the history
   */
  async addEntry(entryData) {
    const history = await this._loadHistory();
    
    // Nén nội dung markdown để tiết kiệm dung lượng
    let compressedMarkdown = null;
    if (entryData.markdownContent) {
      const buffer = await gzip(entryData.markdownContent);
      compressedMarkdown = buffer.toString('base64');
    }

    const newEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      inputFile: entryData.inputFile,
      inputType: entryData.inputType,
      pageCount: entryData.pageCount || 1,
      pagesProcessed: entryData.pagesProcessed || 1,
      sourceLang: entryData.sourceLang || 'auto',
      targetLang: entryData.targetLang,
      translateMode: entryData.translateMode,
      model: entryData.model,
      totalTokens: entryData.totalTokens || 0,
      costUSD: entryData.costUSD || 0,
      elapsedMs: entryData.elapsedMs || 0,
      outputPath: entryData.outputPath,
      success: entryData.success !== false,
      markdownData: compressedMarkdown // base64 gzipped text
    };

    history.unshift(newEntry); // Thêm vào đầu danh sách

    // Giới hạn số lượng entries
    if (history.length > this.maxEntries) {
      history.length = this.maxEntries;
    }

    await this._saveHistory(history);
    return newEntry.id;
  }

  /**
   * Get all history entries (without the heavy markdown payload)
   */
  async getAll() {
    const history = await this._loadHistory();
    return history.map(h => {
      const { markdownData, ...meta } = h;
      return meta;
    });
  }

  /**
   * Get full markdown content of an entry
   */
  async getMarkdown(id) {
    const history = await this._loadHistory();
    const entry = history.find(h => h.id === id);
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
  async deleteEntry(id) {
    let history = await this._loadHistory();
    history = history.filter(h => h.id !== id);
    await this._saveHistory(history);
  }

  /**
   * Clear all history
   */
  async clearAll() {
    await this._saveHistory([]);
  }
}

module.exports = HistoryManager;
