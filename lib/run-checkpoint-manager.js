/**
 * run-checkpoint-manager.js — crash-safe progress for long conversion runs
 *
 * A 2500-page run used to hold every finished page in renderer memory and write
 * nothing until the very last page resolved. Cancelling at page 2400, an app
 * crash, or a power cut threw away hours of paid API calls.
 *
 * Each finished page is appended here as one JSON line instead. Append-only
 * JSONL is the right shape for this: a torn write damages at most the last line,
 * which is simply skipped on read, and appending costs the same at page 2500 as
 * at page 1.
 */

const fs = require('fs');
const path = require('path');

class RunCheckpointManager {
  /**
   * @param {string} userDataDir Electron's userData directory
   */
  constructor(userDataDir) {
    this.dir = path.join(userDataDir, 'checkpoints');
  }

  _ensureDir() {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  /** Reject anything that could escape the checkpoints directory. */
  _fileFor(runId) {
    const safe = String(runId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safe) throw new Error('runId không hợp lệ');
    return path.join(this.dir, `${safe}.jsonl`);
  }

  /**
   * Record one finished page. Never throws: losing a checkpoint line must not
   * abort a translation run that is otherwise succeeding.
   *
   * Written synchronously on purpose. A buffered WriteStream would leave the
   * most recent pages in memory — exactly the pages a crash would destroy, and
   * exactly the ones this file exists to protect. One append per page, seconds
   * apart, so the syscall cost is irrelevant next to an API round trip.
   */
  append(runId, record) {
    try {
      this._ensureDir();
      // 'a' so a resumed run adds to what is there instead of truncating it.
      fs.appendFileSync(this._fileFor(runId), JSON.stringify(record) + '\n');
      return true;
    } catch (err) {
      console.error('[checkpoint] không ghi được:', err.message);
      return false;
    }
  }

  /**
   * Read back every page recorded for a run, newest entry per page winning so a
   * retried page replaces its earlier failure.
   * @returns {Array<object>} sorted by page number
   */
  read(runId) {
    let raw;
    try {
      raw = fs.readFileSync(this._fileFor(runId), 'utf8');
    } catch {
      return []; // no checkpoint yet is a normal state, not an error
    }

    const byPage = new Map();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const rec = JSON.parse(trimmed);
        if (rec && Number.isFinite(rec.page)) byPage.set(rec.page, rec);
      } catch {
        // Torn final line from an interrupted write — skipping it is the point.
      }
    }

    return [...byPage.values()].sort((a, b) => a.page - b.page);
  }

  /** Delete a run's checkpoint — called once its output is safely written. */
  clear(runId) {
    try {
      fs.unlinkSync(this._fileFor(runId));
      return true;
    } catch {
      return false;
    }
  }

  /** List unfinished runs so the UI can offer to resume them. */
  list() {
    try {
      return fs.readdirSync(this.dir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const runId = f.slice(0, -6);
          let stat = null;
          try { stat = fs.statSync(path.join(this.dir, f)); } catch { }
          return { runId, savedAt: stat?.mtimeMs || 0, bytes: stat?.size || 0 };
        })
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  }

  /** Drop checkpoints older than `days` so abandoned runs cannot pile up. */
  pruneOlderThan(days = 7) {
    const cutoff = Date.now() - days * 86400_000;
    let removed = 0;
    for (const entry of this.list()) {
      if (entry.savedAt && entry.savedAt < cutoff && this.clear(entry.runId)) removed++;
    }
    return removed;
  }
}

module.exports = RunCheckpointManager;
