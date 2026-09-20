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
    this.historyCache = null;
  }

  /**
   * Loads the history array from the JSON file into memory cache
   */
  async _loadHistory() {
    if (this.historyCache !== null) {
      return this.historyCache;
    }
    try {
      const data = await fs.readFile(this.historyFile, 'utf8');
      const parsed = JSON.parse(data);
      this.historyCache = Array.isArray(parsed.history) ? parsed.history : [];
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.historyCache = [];
      } else {
        console.error('Lỗi đọc file lịch sử:', err);
        this.historyCache = [];
      }
    }
    return this.historyCache;
  }

  /**
   * Saves the cache to the JSON file
   */
  async _saveHistory() {
    if (this.historyCache === null) return;
    try {
      await fs.writeFile(this.historyFile, JSON.stringify({ history: this.historyCache }, null, 2));
    } catch (err) {
      console.error('Lỗi lưu file lịch sử:', err);
    }
  }

  /**
   * Add a new entry to the history
   */
  async addEntry(entryData) {
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

    this.historyCache.unshift(newEntry);
    await this._saveHistory();
    return newEntry.id;
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
  async deleteEntry(id) {
    await this._loadHistory();
    this.historyCache = this.historyCache.filter(h => h.id !== id);
    await this._saveHistory();
  }

  /**
   * Update the output path of a history entry
   */
  async updateOutputPath(id, outputPath) {
    await this._loadHistory();
    const entry = this.historyCache.find(h => h.id === id);
    if (entry) {
      entry.outputPath = outputPath;
      await this._saveHistory();
      return true;
    }
    return false;
  }

  /**
   * Update fields of a history entry
   */
  async updateEntry(id, fields) {
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
  }

  /**
   * Clear all history
   */
  async clearAll() {
    this.historyCache = [];
    await this._saveHistory();
  }
}

module.exports = HistoryManager;
