/**
 * vertex-ai.js — Google Vertex AI Provider
 * Uses Vertex AI Generative AI REST API
 * Best for: enterprise, data privacy, higher SLA than AI Studio
 * Auth: Service Account JSON or Application Default Credentials
 */

const {
  buildTranslatePrompt,
  buildBilingualTranslatePrompt,
  extractTranslation,
  extractBilingualTranslation,
  formatBilingualOutput
} = require('./translate-utils');

/**
 * Pricing per 1 million tokens (USD) — Standard tier, no-thinking mode
 * Source: https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
 */
const PRICING_PER_M_TOKENS = {
  'gemini-3.5-flash':       { input: 0.15,  output: 0.60 },
  'gemini-3.1-flash-lite':  { input: 0.025, output: 0.10 },
  'gemini-2.5-flash':       { input: 0.15,  output: 0.60 },
  'gemini-2.5-flash-lite':  { input: 0.10,  output: 0.40 },
  'gemini-2.5-pro':         { input: 1.25,  output: 10.0 },
};

class VertexAIProvider {
  static RETRY_STATUS_CODES = [429, 500, 502, 503];
  static MAX_RETRIES = 3;

  constructor(projectId, region = 'us-central1', model = 'gemini-2.5-flash', serviceAccountJson = '') {
    this.projectId = projectId;
    this.region = region || 'us-central1';
    this.model = model || 'gemini-2.5-flash';
    this.serviceAccountJson = serviceAccountJson;
    this._accessToken = null;
    this._tokenExpiry = 0;
  }

  /**
   * Fetch with exponential backoff retry for transient errors
   */
  async _fetchWithRetry(url, options, maxRetries = VertexAIProvider.MAX_RETRIES) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);
        if (response.ok || !VertexAIProvider.RETRY_STATUS_CODES.includes(response.status)) {
          return response;
        }
        // Retryable status code
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          // Wait but respect abort signal
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, delayMs);
            if (options.signal) {
              options.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              }, { once: true });
            }
          });
        } else {
          return response; // Return last response for error handling
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        lastError = err;
        if (attempt >= maxRetries) throw err;
        const delayMs = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    throw lastError;
  }

  /**
   * Returns the correct thinkingConfig based on model version:
   * - Gemini 3.x (non-lite): uses thinkingLevel ('minimal', 'low', 'medium', 'high')
   * - Gemini 2.5 Flash/Pro (non-lite): uses thinkingBudget (min 128)
   * - Lite models & older: no thinking config (not supported or not needed)
   */
  _getThinkingConfig() {
    const model = (this.model || '').toLowerCase();

    // Lite models don't support thinking config
    if (model.includes('lite')) return null;

    // Gemini 3.x models — use thinkingLevel
    if (model.includes('gemini-3')) {
      return { thinkingLevel: 'minimal' };
    }
    // Gemini 2.5 models — use thinkingBudget (0 not supported, 128 = minimum safe)
    if (model.includes('gemini-2.5')) {
      return { thinkingBudget: 128 };
    }
    // Older models (2.0, etc.) — no thinking config
    return null;
  }

  /**
   * Extract token usage stats from Vertex AI response and calculate cost
   * @param {object} responseData - Raw JSON response from generateContent
   * @returns {{ inputTokens: number, outputTokens: number, totalTokens: number, costUSD: number }}
   */
  _extractUsageStats(responseData) {
    const usage = responseData?.usageMetadata || {};
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const totalTokens = usage.totalTokenCount || (inputTokens + outputTokens);

    // Find pricing for current model
    const pricing = PRICING_PER_M_TOKENS[this.model] || { input: 0.15, output: 0.60 }; // default to 2.5 Flash
    const costUSD = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;

    return { inputTokens, outputTokens, totalTokens, costUSD };
  }

  get apiEndpoint() {
    if (this.region === 'global') {
      return 'https://aiplatform.googleapis.com';
    }
    return `https://${this.region}-aiplatform.googleapis.com`;
  }

  get generateUrl() {
    return `${this.apiEndpoint}/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${this.model}:generateContent`;
  }

  get streamGenerateUrl() {
    return `${this.apiEndpoint}/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${this.model}:streamGenerateContent?alt=sse`;
  }

  /**
   * Get access token via Service Account JWT or ADC
   */
  async _getAccessToken() {
    const now = Date.now();
    if (this._accessToken && now < this._tokenExpiry - 60000) {
      return this._accessToken;
    }

    if (this.serviceAccountJson) {
      return this._getTokenFromServiceAccount();
    }

    throw new Error(
      'Service Account JSON chưa được cấu hình. Vui lòng paste JSON vào phần Cài đặt.'
    );
  }

  async _getTokenFromServiceAccount() {
    try {
      const sa = typeof this.serviceAccountJson === 'string'
        ? JSON.parse(this.serviceAccountJson)
        : this.serviceAccountJson;

      // Build JWT
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const payload = Buffer.from(JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })).toString('base64url');

      // Sign with private key (Node.js crypto)
      const crypto = require('crypto');
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(`${header}.${payload}`);
      const sig = sign.sign(sa.private_key, 'base64url');
      const jwt = `${header}.${payload}.${sig}`;

      // Exchange JWT for access token
      const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        }),
      });

      if (!resp.ok) throw new Error(`Token exchange failed: ${resp.status}`);
      const data = await resp.json();
      this._accessToken = data.access_token;
      this._tokenExpiry = Date.now() + data.expires_in * 1000;
      return this._accessToken;
    } catch (err) {
      throw new Error(`Vertex AI auth error: ${err.message}`);
    }
  }


  async processImage(imageBuffer, prompt, onChunk, { signal } = {}) {
    if (!this.projectId) throw new Error('Vertex AI Project ID không được cấu hình');

    const token = await this._getAccessToken();
    const base64 = imageBuffer.toString('base64');

    const thinkingConfig = this._getThinkingConfig();

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/png', data: base64 } },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 65535,
        temperature: 0.1,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
      // Tắt tất cả tools (Google Search, code execution, etc.) — không cần cho OCR
      toolConfig: {
        functionCallingConfig: { mode: 'NONE' },
      },
    };

    const response = await this._fetchWithRetry(this.generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Vertex AI error ${response.status}: ${text.slice(0, 300)}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usageStats = this._extractUsageStats(data);
    return { text, usageStats };
  }

  /**
   * Process Server-Sent Events stream
   */
  async _handleSseStream(body, onChunk) {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let fullText = '';
    let usageStats = { inputTokens: 0, outputTokens: 0, costUSD: 0 };
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n');
        
        while (boundary !== -1) {
          const line = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 1);
          boundary = buffer.indexOf('\n');

          if (!line.startsWith('data: ')) continue;
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);
            const chunkText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (chunkText) {
              fullText += chunkText;
              if (onChunk) onChunk(chunkText);
            }
            if (data.usageMetadata) {
              const currentUsage = this._extractUsageStats(data);
              if (currentUsage) usageStats = currentUsage;
            }
          } catch (e) {
            // Incomplete JSON chunk, skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    
    return { text: fullText, usageStats };
  }

  /**
   * Process image using streaming (Server-Sent Events)
   */
  async processImageStream(imageBuffer, prompt, onChunk, { signal } = {}) {
    if (!this.projectId) throw new Error('Vertex AI Project ID không được cấu hình');
    const token = await this._getAccessToken();
    const base64 = imageBuffer.toString('base64');
    const thinkingConfig = this._getThinkingConfig();

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: base64 } }] }],
      generationConfig: { maxOutputTokens: 65535, temperature: 0.1, ...(thinkingConfig ? { thinkingConfig } : {}) },
      toolConfig: { functionCallingConfig: { mode: 'NONE' } },
    };

    const response = await this._fetchWithRetry(this.streamGenerateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Vertex AI stream error ${response.status}: ${text.slice(0, 300)}`);
    }

    return this._handleSseStream(response.body, onChunk);
  }

  async translateText(text, targetLang, sourceLang = 'auto', bilingual = false, onChunk, { signal } = {}) {
    if (!this.projectId) throw new Error('Vertex AI Project ID không được cấu hình');
    const token = await this._getAccessToken();
    
    const prompt = bilingual
      ? buildBilingualTranslatePrompt(text, targetLang, sourceLang)
      : buildTranslatePrompt(text, targetLang, sourceLang);

    const thinkingConfig = this._getThinkingConfig();

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 65535,
        temperature: 0.1,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
      toolConfig: {
        functionCallingConfig: { mode: 'NONE' },
      },
    };

    const response = await this._fetchWithRetry(this.generateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Vertex AI error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usageStats = this._extractUsageStats(data);

    if (bilingual) {
      const sections = extractBilingualTranslation(raw, text);
      const formatted = formatBilingualOutput(sections);
      return { text: formatted, bilingualSections: sections, usageStats };
    } else {
      const extracted = extractTranslation(raw, text);
      return { text: extracted, usageStats };
    }
  }

  /**
   * Translate text using streaming (Server-Sent Events) for real-time chunk delivery
   */
  async translateTextStream(text, targetLang, sourceLang = 'auto', bilingual = false, onChunk, { signal } = {}) {
    if (!this.projectId) throw new Error('Vertex AI Project ID không được cấu hình');
    const token = await this._getAccessToken();

    const prompt = bilingual
      ? buildBilingualTranslatePrompt(text, targetLang, sourceLang)
      : buildTranslatePrompt(text, targetLang, sourceLang);

    const thinkingConfig = this._getThinkingConfig();

    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 65535,
        temperature: 0.1,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
      toolConfig: {
        functionCallingConfig: { mode: 'NONE' },
      },
    };

    const response = await this._fetchWithRetry(this.streamGenerateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Vertex AI stream error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const { text: raw, usageStats } = await this._handleSseStream(response.body, onChunk);

    if (bilingual) {
      const sections = extractBilingualTranslation(raw, text);
      const formatted = formatBilingualOutput(sections);
      return { text: formatted, bilingualSections: sections, usageStats };
    } else {
      const extracted = extractTranslation(raw, text);
      return { text: extracted, usageStats };
    }
  }

  async listModels() {
    try {
      if (!this.projectId) throw new Error('Project ID trống — vui lòng nhập Project ID');
      // Just test if we can get a valid access token (validates the SA JSON)
      await this._getAccessToken();
      
      // Google Cloud Vertex AI DOES NOT provide a REST API endpoint to list publisher (foundation) models.
      // The endpoint /publishers/google/models returns 404. 
      // Therefore, we must return a comprehensive static list of known Gemini models.
      const GEMINI_MODELS = [
        { id: 'gemini-3.5-flash', name: 'gemini-3.5-flash (Mới nhất, Nhanh)', pricing: PRICING_PER_M_TOKENS['gemini-3.5-flash'] },
        { id: 'gemini-3.1-flash-lite', name: 'gemini-3.1-flash-lite (Nhẹ, Siêu tốc)', pricing: PRICING_PER_M_TOKENS['gemini-3.1-flash-lite'] },
        { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash (Khuyên dùng)', pricing: PRICING_PER_M_TOKENS['gemini-2.5-flash'] },
        { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro (Thông minh)', pricing: PRICING_PER_M_TOKENS['gemini-2.5-pro'] },
        { id: 'gemini-2.5-flash-lite', name: 'gemini-2.5-flash-lite (Rẻ nhất)', pricing: PRICING_PER_M_TOKENS['gemini-2.5-flash-lite'] },
      ];

      return GEMINI_MODELS;
    } catch (e) {
      console.warn('listModels error:', e.message);
      throw e; 
    }
  }

  async testConnection() {
    try {
      if (!this.projectId) throw new Error('Project ID trống — vui lòng nhập Project ID');
      const token = await this._getAccessToken();

      // If testing connection with empty model name, fallback to default one for API test
      const testModel = this.model || 'gemini-2.5-flash';
      const testUrl = `${this.apiEndpoint}/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${testModel}:generateContent`;

      // Validate by calling generateContent with a tiny prompt
      const thinkingConfig = this._getThinkingConfig();
      const generateResp = await fetch(testUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
          generationConfig: {
            maxOutputTokens: 5,
            ...(thinkingConfig ? { thinkingConfig } : {}),
          },
          toolConfig: { functionCallingConfig: { mode: 'NONE' } },
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!generateResp.ok) {
        const errText = await generateResp.text();
        let isJson = false;
        let errMsg = errText.slice(0, 200);

        try {
          const errJson = JSON.parse(errText);
          isJson = true;
          errMsg = errJson.error?.message || errMsg;
        } catch {}

        if (generateResp.status === 403) {
          throw new Error(`Không có quyền truy cập (403). Kiểm tra Service Account có role "Vertex AI User" chưa. Chi tiết: ${errMsg}`);
        }

        if (generateResp.status === 404) {
          if (isJson) {
            return {
              success: false,
              message: `Model "${testModel}" không được hỗ trợ tại Region ${this.region} (404). Vui lòng chọn Model khác trong danh sách. Chi tiết: ${errMsg}`,
            };
          } else {
            throw new Error(`Project ID hoặc Region không tồn tại (404 API Not Found). Hãy kiểm tra lại cấu hình.`);
          }
        }

        return {
          success: false,
          message: `Lỗi khi test Model: ${errMsg}`,
        };
      }

      // Load available models dynamically from Vertex AI
      const modelsList = await this.listModels();

      return {
        success: true,
        message: `Kết nối Vertex AI thành công (${this.region})`,
        models: modelsList,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = VertexAIProvider;
