/**
 * gemini-api.js — Gemini API (Google AI Studio) Provider
 * Inherits from BaseProvider.
 */

const BaseProvider = require('./base-provider');

const PRICING_PER_M_TOKENS = {
  'gemini-3.5-flash':       { input: 0.0, output: 0.0 },
  'gemini-3.1-flash-lite':  { input: 0.0, output: 0.0 },
  'gemini-2.5-flash':       { input: 0.0, output: 0.0 },
};

class GeminiAPIProvider extends BaseProvider {
  // Google caps a whole request at 20 MB including base64 overhead; 15 MB for the
  // page image leaves headroom for the prompt. Rarely reached at 2000px, but it
  // keeps an unusually dense page from failing the request outright.
  static MAX_IMAGE_BYTES = 15 * 1024 * 1024;

  constructor(apiKey = '', model = 'gemini-3.5-flash') {
    super(model || 'gemini-3.5-flash');
    this.apiKey = apiKey;
  }

  get providerName() {
    return 'Gemini API';
  }

  async _validateConfig() {
    if (!this.apiKey) {
      throw new Error('Gemini API Key chưa được cấu hình. Vui lòng nhập API Key.');
    }
  }

  async _getHeaders() {
    // SECURITY: API key is sent via header, NOT in the URL query string.
    // This prevents key exposure in server logs, browser history, and DevTools Network tab.
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.apiKey,
    };
  }

  get generateUrl() {
    // No API key in URL — key is in 'x-goog-api-key' header
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
  }

  get streamGenerateUrl() {
    // No API key in URL — key is in 'x-goog-api-key' header
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse`;
  }

  _extractUsageStats(responseData) {
    const usage = responseData?.usageMetadata || {};
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const totalTokens = usage.totalTokenCount || (inputTokens + outputTokens);

    return { inputTokens, outputTokens, totalTokens, costUSD: 0.0 };
  }

  async listModels() {
    try {
      if (!this.apiKey) throw new Error('API Key trống — vui lòng nhập API Key');

      return [
        { id: 'gemini-3.5-flash', name: 'gemini-3.5-flash (Mới nhất, Khuyên dùng)', pricing: PRICING_PER_M_TOKENS['gemini-3.5-flash'], limits: { rpm: 5, rpd: 20 } },
        { id: 'gemini-3.1-flash-lite', name: 'gemini-3.1-flash-lite (Nhẹ, Siêu tốc)', pricing: PRICING_PER_M_TOKENS['gemini-3.1-flash-lite'], limits: { rpm: 15, rpd: 500 } },
        { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash (Thông minh, OCR tốt)', pricing: PRICING_PER_M_TOKENS['gemini-2.5-flash'], limits: { rpm: 5, rpd: 20 } },
      ];
    } catch (e) {
      console.warn('listModels error:', e.message);
      throw e;
    }
  }

  async testConnection() {
    try {
      if (!this.apiKey) throw new Error('API Key trống — vui lòng nhập API Key');

      const testModel = this.model || 'gemini-3.5-flash';
      const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${testModel}:generateContent`;

      const thinkingConfig = this._getThinkingConfig();
      const generateResp = await fetch(testUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,  // SECURITY: key in header, not URL
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
        let errMsg = errText.slice(0, 200);

        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error?.message || errMsg;
        } catch {}

        if (generateResp.status === 400 && errMsg.includes('API key not valid')) {
          throw new Error('API Key không hợp lệ. Vui lòng kiểm tra lại.');
        }

        return {
          success: false,
          message: `Lỗi kết nối Gemini API: ${errMsg}`,
        };
      }

      const modelsList = await this.listModels();

      return {
        success: true,
        message: 'Kết nối Gemini API thành công!',
        models: modelsList,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = GeminiAPIProvider;
