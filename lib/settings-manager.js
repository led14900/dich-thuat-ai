/**
 * settings-manager.js
 * Persistent settings using JSON file in app userData directory.
 * Sensitive fields (apiKey, serviceAccountJson) are encrypted via safeStorage.
 */

const path = require('path');
const { app, safeStorage } = require('electron');
const fs = require('fs');
const PROMPT_TEMPLATES = require('./prompt-templates');

// Magic prefix to distinguish encrypted values from plaintext.
// Without this, we can't tell if a stored string is already encrypted
// or is a legacy plaintext value — leading to double-encryption or
// failed decryption on app restart.
const ENC_PREFIX = 'enc:';

function encryptString(plainText) {
  if (!plainText) return '';
  // Already encrypted — return as-is (defensive guard against double-encrypt)
  if (plainText.startsWith(ENC_PREFIX)) return plainText;
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(plainText).toString('base64');
      return ENC_PREFIX + encrypted;
    }
  } catch (err) {
    console.error('Mã hóa dữ liệu thất bại:', err);
  }
  return plainText; // Fallback: store as plaintext
}

function decryptString(cipherText) {
  if (!cipherText) return '';

  // New format: prefixed with 'enc:'
  if (cipherText.startsWith(ENC_PREFIX)) {
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        const raw = cipherText.slice(ENC_PREFIX.length);
        const buf = Buffer.from(raw, 'base64');
        return safeStorage.decryptString(buf);
      }
    } catch (err) {
      console.error('Giải mã dữ liệu thất bại:', err);
    }
    // Fail-safe: return the original encrypted text if safeStorage is temporarily unavailable,
    // avoiding overwriting and wiping out credentials when config is saved.
    return cipherText;
  }

  // Legacy format: raw base64 from previous safeStorage implementation (no prefix).
  // Try to decrypt it — if it works, great. If not, it's plaintext.
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(cipherText, 'base64');
      // safeStorage.decryptString throws if buffer is not valid ciphertext
      const decrypted = safeStorage.decryptString(buf);
      // Sanity check: decrypted result should not be empty for non-empty input
      if (decrypted) return decrypted;
    }
  } catch {
    // Not encrypted — it's a plaintext value (original setting before encryption was added)
  }
  return cipherText;
}

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
        const parsed = JSON.parse(data);

        // Decrypt sensitive fields
        if (parsed.geminiAPI && typeof parsed.geminiAPI.apiKey === 'string') {
          parsed.geminiAPI.apiKey = decryptString(parsed.geminiAPI.apiKey);
        }
        if (parsed.vertexAI && typeof parsed.vertexAI.serviceAccountJson === 'string') {
          parsed.vertexAI.serviceAccountJson = decryptString(parsed.vertexAI.serviceAccountJson);
        }
        if (parsed.openaiCompatible && typeof parsed.openaiCompatible.apiKey === 'string') {
          parsed.openaiCompatible.apiKey = decryptString(parsed.openaiCompatible.apiKey);
        }

        this.store = { ...this.defaults, ...parsed };
      }
    } catch (err) {
      console.error('Lỗi đọc settings:', err);
    }
  }

  save() {
    try {
      // Clone the store to avoid encrypting in-memory working values
      const cloned = JSON.parse(JSON.stringify(this.store));

      // Encrypt sensitive fields before writing to disk
      if (cloned.geminiAPI && typeof cloned.geminiAPI.apiKey === 'string') {
        cloned.geminiAPI.apiKey = encryptString(cloned.geminiAPI.apiKey);
      }
      if (cloned.vertexAI && typeof cloned.vertexAI.serviceAccountJson === 'string') {
        cloned.vertexAI.serviceAccountJson = encryptString(cloned.vertexAI.serviceAccountJson);
      }
      if (cloned.openaiCompatible && typeof cloned.openaiCompatible.apiKey === 'string') {
        cloned.openaiCompatible.apiKey = encryptString(cloned.openaiCompatible.apiKey);
      }

      fs.writeFileSync(this.path, JSON.stringify(cloned, null, 2));
    } catch (err) {
      console.error('Lỗi lưu settings:', err);
    }
  }

  get(key) {
    return this.store[key];
  }

  set(key, value) {
    this.store[key] = value;
    this.save();
  }
}

const DEFAULT_SETTINGS = {
  aiProvider: 'vertex-ai',
  model: 'gemini-3.1-flash-lite',
  vertexAI: {
    projectId: '',
    region: 'global',
    model: 'gemini-3.1-flash-lite',
    serviceAccountJson: '',
  },
  geminiAPI: {
    apiKey: '',
    model: 'gemini-3.5-flash',
  },
  // Generic OpenAI-compatible Chat Completions endpoint
  // (OpenAI, OpenRouter, Groq, DeepSeek, Ollama, LM Studio, vLLM, LiteLLM, ...)
  openaiCompatible: {
    baseUrl: 'https://api.airender.vn/v1',
    apiKey: '',
    model: 'gpt-5.6-luna',
    maxTokens: 0,       // 0 = để server tự quyết định
    pricingInput: 0,    // USD / 1M input tokens — dùng để ước tính chi phí
    pricingOutput: 0,   // USD / 1M output tokens
  },
  dpi: 300,
  concurrentPages: 2,
  requestDelaySec: 2,
  uiLanguage: 'vi',
  sourceLanguage: 'auto',
  bilingual: true,
  translateMode: 'bilingual',
  translateLanguage: 'Tiếng Việt',
  outputFont: 'Times New Roman',
  outputFontSize: 12,
  pageSize: 'A4',
  customPrompt: '',
  promptTemplates: PROMPT_TEMPLATES,
  activePromptTemplate: 'default',
  theme: 'dark',
  recentFiles: [],
};

class SettingsManager {
  constructor() {
    this.store = new FileStore({
      name: 'pdf-ai-converter-settings',
      defaults: DEFAULT_SETTINGS,
    });

    // Migrations without triggering immediate redundant writes
    let changed = false;
    const VALID_PROVIDERS = ['vertex-ai', 'gemini-api', 'openai-compatible'];
    const currentProvider = this.store.get('aiProvider');
    if (!VALID_PROVIDERS.includes(currentProvider)) {
      this.store.store['aiProvider'] = 'vertex-ai';
      changed = true;
    }
    // Backfill openaiCompatible block for settings files written before this provider existed
    if (!this.store.get('openaiCompatible')) {
      this.store.store['openaiCompatible'] = { ...DEFAULT_SETTINGS.openaiCompatible };
      changed = true;
    }
    if (!this.store.get('geminiAPI')) {
      this.store.store['geminiAPI'] = {
        apiKey: '',
        model: 'gemini-3.5-flash',
      };
      changed = true;
    }
    if (!this.store.get('model')) {
      this.store.store['model'] = 'gemini-3.1-flash-lite';
      changed = true;
    }
    if (this.store.get('bilingual') === undefined) {
      this.store.store['bilingual'] = true;
      changed = true;
    }
    if (this.store.get('sourceLanguage') === undefined) {
      this.store.store['sourceLanguage'] = 'auto';
      changed = true;
    }
    if (this.store.get('concurrentPages') === undefined) {
      this.store.store['concurrentPages'] = 2;
      changed = true;
    }
    if (this.store.get('requestDelaySec') === undefined) {
      this.store.store['requestDelaySec'] = 2;
      changed = true;
    }

    if (changed) {
      this.store.save();
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
