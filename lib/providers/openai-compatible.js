/**
 * openai-compatible.js — Generic OpenAI-compatible Chat Completions Provider
 *
 * Works with any endpoint that speaks the OpenAI `/v1/chat/completions` dialect:
 * OpenAI, OpenRouter, Groq, Together, DeepSeek, xAI, Mistral, Ollama, LM Studio,
 * vLLM, LiteLLM proxies, Azure-style gateways, etc.
 *
 * Inherits the streaming/retry pipeline from BaseProvider and only overrides the
 * wire-format hooks (_buildTextRequestBody / _buildImageRequestBody / _parseStreamChunk).
 */

const BaseProvider = require('./base-provider');

// Params that some OpenAI-compatible servers reject outright (reasoning models,
// llama.cpp servers, older proxies). On a 400 mentioning one of these we retry
// once with the offending params stripped instead of failing the whole page.
const OPTIONAL_PARAMS = ['temperature', 'max_tokens', 'stream_options', 'top_p'];

class OpenAICompatibleProvider extends BaseProvider {
  // Gateways in front of OpenAI-compatible models are far stricter than Google's
  // 20 MB inline limit — many reject bodies over a few MB, or answer 200 with an
  // empty completion. 4 MB encoded leaves room for the prompt inside a 5 MB cap.
  static MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  // Same budget Gemini asks for. Omitting max_tokens lets the endpoint apply its
  // own default — often 1024 or less — which silently truncates a translated page.
  static DEFAULT_MAX_TOKENS = 65535;

  /**
   * @param {string} baseUrl   e.g. https://api.openai.com/v1
   * @param {string} apiKey    Bearer token (may be empty for local servers like Ollama)
   * @param {string} model     Model ID as the endpoint expects it
   * @param {object} options   { maxTokens, pricing: { input, output } }
   */
  constructor(baseUrl = '', apiKey = '', model = '', options = {}) {
    super(model || '');
    this.baseUrl = OpenAICompatibleProvider.normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey || '';
    this.maxTokens = Number(options.maxTokens) > 0 ? Number(options.maxTokens) : null;
    this.pricing = {
      input: Number(options.pricing?.input) || 0,
      output: Number(options.pricing?.output) || 0,
    };
  }

  /**
   * Accepts whatever the user pasted and returns a clean `.../v1` style root.
   * Strips trailing slashes and a trailing `/chat/completions` (a very common paste mistake).
   */
  static normalizeBaseUrl(url) {
    let u = (url || '').trim();
    if (!u) return '';
    u = u.replace(/\s+/g, '');
    u = u.replace(/\/+$/, '');
    u = u.replace(/\/chat\/completions$/i, '');
    u = u.replace(/\/+$/, '');
    return u;
  }

  get providerName() {
    return 'OpenAI Compatible';
  }

  async _validateConfig() {
    if (!this.baseUrl) {
      throw new Error('Base URL chưa được cấu hình. Ví dụ: https://api.openai.com/v1');
    }
    if (!/^https?:\/\//i.test(this.baseUrl)) {
      throw new Error('Base URL phải bắt đầu bằng http:// hoặc https://');
    }
    if (!this.model) {
      throw new Error('Chưa chọn Model ID cho endpoint OpenAI Compatible.');
    }
  }

  async _getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    // Local servers (Ollama / LM Studio) usually need no key — only send it when present.
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  get chatCompletionsUrl() {
    return `${this.baseUrl}/chat/completions`;
  }

  get modelsUrl() {
    return `${this.baseUrl}/models`;
  }

  // BaseProvider posts to this URL for both text and image streams.
  get streamGenerateUrl() {
    return this.chatCompletionsUrl;
  }

  // ── Wire format ──────────────────────────────────────────────────────────

  _buildBaseChatBody(messages) {
    return {
      model: this.model,
      messages,
      stream: true,
      // Ask for usage on the final chunk — silently dropped by servers that ignore it,
      // and stripped by the 400-fallback on servers that reject it.
      stream_options: { include_usage: true },
      temperature: 0.1,
      max_tokens: this.maxTokens || this.constructor.DEFAULT_MAX_TOKENS,
    };
  }

  _buildTextRequestBody(prompt) {
    return this._buildBaseChatBody([{ role: 'user', content: prompt }]);
  }

  _buildImageRequestBody(prompt, base64Image, mimeType = 'image/png') {
    return this._buildBaseChatBody([
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
        ],
      },
    ]);
  }

  /**
   * OpenAI streaming delta shape. The final chunk may carry `usage` with empty choices.
   */
  _parseStreamChunk(data) {
    const choice = data?.choices?.[0];
    const delta = choice?.delta || {};

    // `content` is normally a string; a few gateways send an array of parts.
    let text = '';
    if (typeof delta.content === 'string') {
      text = delta.content;
    } else if (Array.isArray(delta.content)) {
      text = delta.content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('');
    } else if (typeof choice?.message?.content === 'string') {
      // Server ignored `stream: true` and answered with a full chat completion
      text = choice.message.content;
    } else if (Array.isArray(choice?.message?.content)) {
      text = choice.message.content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('');
    } else if (typeof choice?.text === 'string') {
      // Legacy /completions-style servers
      text = choice.text;
    }

    const usage = data?.usage ? this._extractUsageStats(data) : null;
    // Null on every chunk but the last; 'length' means the page was cut short.
    const finishReason = choice?.finish_reason || null;
    return { text, usage, finishReason };
  }

  _extractUsageStats(responseData) {
    const usage = responseData?.usage || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || (inputTokens + outputTokens);

    const costUSD =
      (inputTokens * this.pricing.input + outputTokens * this.pricing.output) / 1_000_000;

    return { inputTokens, outputTokens, totalTokens, costUSD };
  }

  // ── Compatibility fallback ───────────────────────────────────────────────

  /**
   * Wraps the inherited retry logic: if the server rejects the request with a 400
   * naming an optional param (common with reasoning models and local servers),
   * retry once with those params removed.
   */
  async _fetchWithRetry(url, options, maxRetries) {
    const response = await super._fetchWithRetry(url, options, maxRetries);

    if (response.status !== 400 || !options.body) return response;

    let errText = '';
    try {
      errText = await response.clone().text();
    } catch {
      return response;
    }

    const offenders = OPTIONAL_PARAMS.filter(p => errText.includes(p));
    if (offenders.length === 0) return response;

    let body;
    try {
      body = JSON.parse(options.body);
    } catch {
      return response;
    }

    let stripped = false;
    for (const param of offenders) {
      if (param in body) {
        delete body[param];
        stripped = true;
      }
    }
    if (!stripped) return response;

    console.warn(
      `[OpenAI Compatible] Endpoint từ chối tham số: ${offenders.join(', ')} — thử lại không kèm tham số này.`
    );
    return super._fetchWithRetry(
      url,
      { ...options, body: JSON.stringify(body) },
      maxRetries
    );
  }

  // ── Discovery / diagnostics ──────────────────────────────────────────────

  async listModels() {
    if (!this.baseUrl) {
      throw new Error('Base URL trống — vui lòng nhập Base URL (ví dụ: https://api.openai.com/v1)');
    }

    const headers = await this._getHeaders();
    const resp = await fetch(this.modelsUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(
        `Không lấy được danh sách model (HTTP ${resp.status}): ${errText.slice(0, 200)}`
      );
    }

    const json = await resp.json();
    // OpenAI: { data: [{ id }] }. Some gateways return a bare array.
    const rawList = Array.isArray(json) ? json : (json.data || json.models || []);

    return rawList
      .map(m => {
        const id = typeof m === 'string' ? m : (m.id || m.name || '');
        if (!id) return null;
        return { id, name: id, pricing: null, limits: null };
      })
      .filter(Boolean)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async testConnection() {
    try {
      await this._validateConfig();

      const headers = await this._getHeaders();
      // Goes through _fetchWithRetry (not a bare fetch) so the 400 param-strip fallback applies —
      // reasoning models that reject `max_tokens` must not be reported as a broken connection.
      const resp = await this._fetchWithRetry(
        this.chatCompletionsUrl,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: 'user', content: 'Hi' }],
            max_tokens: 5,
            stream: false,
          }),
          signal: AbortSignal.timeout(20000),
        },
        0 // no exponential-backoff retries during a connection test — fail fast
      );

      if (!resp.ok) {
        const errText = await resp.text();
        let errMsg = errText.slice(0, 250);
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error?.message || errJson.message || errMsg;
        } catch { }

        if (resp.status === 401 || resp.status === 403) {
          return { success: false, message: `API Key không hợp lệ hoặc không có quyền: ${errMsg}` };
        }
        if (resp.status === 404) {
          return {
            success: false,
            message: `Không tìm thấy endpoint/model. Kiểm tra lại Base URL (thường kết thúc bằng /v1) và Model ID. Chi tiết: ${errMsg}`,
          };
        }
        return { success: false, message: `Lỗi kết nối (HTTP ${resp.status}): ${errMsg}` };
      }

      let models = [];
      try {
        models = await this.listModels();
      } catch (e) {
        // /models is optional on many self-hosted servers — connection is still valid.
        console.warn('listModels không khả dụng:', e.message);
      }

      return {
        success: true,
        message: `Kết nối endpoint OpenAI Compatible thành công! (model: ${this.model})`,
        models,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = OpenAICompatibleProvider;
