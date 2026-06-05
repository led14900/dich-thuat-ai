/**
 * settings-manager.js
 * Persistent settings using JSON file in app userData directory
 */

const path = require('path');
const { app } = require('electron');
const fs = require('fs');

class FileStore {
  constructor(options) {
    this.path = path.join(app.getPath('userData'), options.name + '.json');
    this.defaults = options.defaults || {};
    this.store = { ...this.defaults };
    this.load();
  }
  load() {
    try {
      if (fs.existsSync(this.path)) {
        const data = fs.readFileSync(this.path, 'utf8');
        this.store = { ...this.defaults, ...JSON.parse(data) };
      }
    } catch (err) {
      console.error('Lỗi đọc settings:', err);
    }
  }
  save() {
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.store, null, 2));
    } catch (err) {
      console.error('Lỗi lưu settings:', err);
    }
  }
  get(key) { return this.store[key]; }
  set(key, value) {
    this.store[key] = value;
    this.save();
  }
}

const DEFAULT_SETTINGS = {
  aiProvider: 'vertex-ai',
  model: 'gemini-2.5-flash',
  vertexAI: {
    projectId: '',
    region: 'us-central1',
    model: 'gemini-2.5-flash',
    serviceAccountJson: '',
  },
  dpi: 300,
  uiLanguage: 'vi',
  sourceLanguage: 'auto',
  bilingual: true,
  translateMode: 'bilingual',
  translateLanguage: 'Tiếng Việt',
  outputFont: 'Times New Roman',
  outputFontSize: 12,
  pageSize: 'A4',
  customPrompt: '',
  theme: 'dark',
  concurrentPages: 2,
  requestDelaySec: 2,
  recentFiles: [],
};

class SettingsManager {
  constructor() {
    this.store = new FileStore({
      name: 'pdf-ai-converter-settings',
      defaults: DEFAULT_SETTINGS,
    });

    // Migrations
    if (this.store.get('aiProvider') !== 'vertex-ai') {
      this.store.set('aiProvider', 'vertex-ai');
    }
    if (!this.store.get('model')) {
      this.store.set('model', 'gemini-2.5-flash');
    }
    if (this.store.get('bilingual') === undefined) {
      this.store.set('bilingual', true);
    }
    if (this.store.get('sourceLanguage') === undefined) {
      this.store.set('sourceLanguage', 'auto');
    }
  }

  getAll() {
    return this.store.store;
  }

  saveAll(settings) {
    this.store.store = { ...this.store.store, ...settings };
    this.store.save();
    return true;
  }

  get(key) {
    return this.store.get(key);
  }

  set(key, value) {
    this.store.set(key, value);
    return true;
  }

}

module.exports = SettingsManager;
