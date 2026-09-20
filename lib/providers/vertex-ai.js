/**
 * vertex-ai.js — Gemini Enterprise Agent Platform Provider (Vertex AI)
 * Inherits from BaseProvider.
 */

const BaseProvider = require('./base-provider');

const PRICING_PER_M_TOKENS = {
  'gemini-3.5-flash':       { input: 0.15,  output: 0.60 },
  'gemini-3.1-flash-lite':  { input: 0.025, output: 0.10 },
  'gemini-2.5-flash':       { input: 0.15,  output: 0.60 },
  'gemini-2.5-flash-lite':  { input: 0.10,  output: 0.40 },
  'gemini-2.5-pro':         { input: 1.25,  output: 10.0 },
};

class VertexAIProvider extends BaseProvider {
  // Google caps a whole request at 20 MB including base64 overhead; 15 MB for the
  // page image leaves headroom for the prompt. Rarely reached at 2000px, but it
  // keeps an unusually dense page from failing the request outright.
  static MAX_IMAGE_BYTES = 15 * 1024 * 1024;

  constructor(projectId, region = 'global', model = 'gemini-3.1-flash-lite', serviceAccountJson = '') {
    super(model || 'gemini-3.1-flash-lite');
    this.projectId = projectId;
    this.region = region || 'global';
    this.serviceAccountJson = serviceAccountJson;
    this._accessToken = null;
    this._tokenExpiry = 0;
  }

  get providerName() {
    return 'Vertex AI';
  }

  async _validateConfig() {
    if (!this.projectId) throw new Error('Vertex AI Project ID không được cấu hình');
    if (!this.serviceAccountJson) {
      throw new Error('Service Account JSON chưa được cấu hình. Vui lòng paste JSON vào phần Cài đặt.');
    }
  }

  async _getHeaders() {
    const token = await this._getAccessToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
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

  async _getAccessToken() {
    const now = Date.now();
    if (this._accessToken && now < this._tokenExpiry - 60000) {
      return this._accessToken;
    }

    if (this.serviceAccountJson) {
      return this._getTokenFromServiceAccount();
    }

    throw new Error('Service Account JSON chưa được cấu hình.');
  }

  async _getTokenFromServiceAccount() {
    try {
      const sa = typeof this.serviceAccountJson === 'string'
        ? JSON.parse(this.serviceAccountJson)
        : this.serviceAccountJson;

      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const payload = Buffer.from(JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })).toString('base64url');

      const crypto = require('crypto');
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(`${header}.${payload}`);
      const sig = sign.sign(sa.private_key, 'base64url');
      const jwt = `${header}.${payload}.${sig}`;

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

  _extractUsageStats(responseData) {
    const usage = responseData?.usageMetadata || {};
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;
    const totalTokens = usage.totalTokenCount || (inputTokens + outputTokens);

    const pricing = PRICING_PER_M_TOKENS[this.model] || { input: 0.15, output: 0.60 };
    const costUSD = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;

    return { inputTokens, outputTokens, totalTokens, costUSD };
  }

  async listModels() {
    return [
      { id: 'gemini-3.5-flash', name: 'gemini-3.5-flash (Mới nhất, Đa năng)', pricing: PRICING_PER_M_TOKENS['gemini-3.5-flash'] },
      { id: 'gemini-3.1-flash-lite', name: 'gemini-3.1-flash-lite (Nhẹ, Khuyên dùng)', pricing: PRICING_PER_M_TOKENS['gemini-3.1-flash-lite'] },
      { id: 'gemini-2.5-flash', name: 'gemini-2.5-flash (Thông minh, OCR tốt)', pricing: PRICING_PER_M_TOKENS['gemini-2.5-flash'] },
      { id: 'gemini-2.5-flash-lite', name: 'gemini-2.5-flash-lite (Siêu nhẹ, Tốc độ)', pricing: PRICING_PER_M_TOKENS['gemini-2.5-flash-lite'] },
      { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro (Thông minh cao cấp)', pricing: PRICING_PER_M_TOKENS['gemini-2.5-pro'] },
    ];
  }

  async testConnection() {
    try {
      await this._validateConfig();
      const testModel = this.model || 'gemini-3.1-flash-lite';
      const testUrl = `${this.apiEndpoint}/v1/projects/${this.projectId}/locations/${this.region}/publishers/google/models/${testModel}:generateContent`;

      const headers = await this._getHeaders();
      const thinkingConfig = this._getThinkingConfig();

      const generateResp = await fetch(testUrl, {
        method: 'POST',
        headers,
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
        return {
          success: false,
          message: `Lỗi kết nối Vertex AI: ${errMsg}`,
        };
      }

      const modelsList = await this.listModels();
      return {
        success: true,
        message: 'Kết nối Vertex AI thành công!',
        models: modelsList,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = VertexAIProvider;
