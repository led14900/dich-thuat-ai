/**
 * base-provider.js — Base Class for AI Translation Providers
 * Handles retry, SSE streaming logic, thinking configurations, and shared process/translate pipelines.
 *
 * Provider-specific wire format is isolated behind 3 overridable hooks, so a provider that does not
 * speak the Gemini REST dialect (e.g. an OpenAI-compatible endpoint) only overrides these instead of
 * re-implementing the whole streaming pipeline:
 *   - _buildTextRequestBody(prompt)
 *   - _buildImageRequestBody(prompt, base64Image)
 *   - _parseStreamChunk(parsedJson) → { text, usage }
 */

const {
  buildTranslatePrompt,
  buildBilingualTranslatePrompt,
  extractTranslation,
  extractBilingualTranslation,
  formatBilingualOutput
} = require('./translate-utils');

class BaseProvider {
  static RETRY_STATUS_CODES = [429, 500, 502, 503];
  static MAX_RETRIES = 3;

  constructor(model) {
    this.model = model;
  }

  /**
   * Helper delay that respects AbortSignal and cleans up listener on completion
   */
  async _delay(ms, signal) {
    if (signal && signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    return new Promise((resolve, reject) => {
      let timer;
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };

      timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /**
   * Fetch with exponential backoff retry for transient errors
   */
  async _fetchWithRetry(url, options, maxRetries = BaseProvider.MAX_RETRIES) {
    let lastError;
    const signal = options.signal;
    const retryStatusCodes = this.constructor.RETRY_STATUS_CODES || BaseProvider.RETRY_STATUS_CODES;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (signal && signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const response = await fetch(url, options);
        if (response.ok || !retryStatusCodes.includes(response.status)) {
          return response;
        }

        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < maxRetries) {
          const delayMs = Math.pow(2, attempt) * 1000;
          await this._delay(delayMs, signal);
        } else {
          return response;
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        lastError = err;
        if (attempt >= maxRetries) throw err;

        const delayMs = Math.pow(2, attempt) * 1000;
        await this._delay(delayMs, signal);
      }
    }
    throw lastError;
  }

  /**
   * Returns correct thinkingConfig based on model version
   */
  _getThinkingConfig() {
    const model = (this.model || '').toLowerCase();

    // Lite models don't support thinking config
    if (model.includes('lite')) return null;

    // Gemini 3.x models — use thinkingLevel
    if (model.includes('gemini-3')) {
      return { thinkingLevel: 'minimal' };
    }
    // Gemini 2.5 models — use thinkingBudget
    if (model.includes('gemini-2.5')) {
      return { thinkingBudget: 128 };
    }
    return null;
  }

  // ── Overridable wire-format hooks (default: Gemini REST dialect) ──────────

  /**
   * Build the request body for a text-only streaming generation.
   */
  _buildTextRequestBody(prompt) {
    const thinkingConfig = this._getThinkingConfig();
    return {
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
  }

  /**
   * Build the request body for a prompt + PNG image streaming generation.
   */
  _buildImageRequestBody(prompt, base64Image) {
    const thinkingConfig = this._getThinkingConfig();
    return {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/png', data: base64Image } },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 65535,
        temperature: 0.1,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
      toolConfig: {
        functionCallingConfig: { mode: 'NONE' },
      },
    };
  }

  /**
   * Extract incremental text + optional usage stats from one parsed SSE payload.
   * @returns {{ text: string, usage: object|null }}
   */
  _parseStreamChunk(data) {
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = data?.usageMetadata ? this._extractUsageStats(data) : null;
    return { text, usage };
  }

  /**
   * Incremental SSE accumulator shared by the streaming and buffered readers.
   * Returns { push(textChunk), finish() } — push() may be called with arbitrary
   * slices of the response text; finish() flushes whatever is left over.
   */
  _createSseAccumulator(onChunk) {
    let fullText = '';
    let usageStats = { inputTokens: 0, outputTokens: 0, costUSD: 0 };
    let buffer = '';
    let currentData = '';

    // Parse one accumulated SSE message payload and fold it into the result
    const consume = (dataStr) => {
      if (!dataStr || dataStr === '[DONE]') return;
      try {
        const data = JSON.parse(dataStr);
        const { text: chunkText, usage } = this._parseStreamChunk(data);
        if (chunkText) {
          fullText += chunkText;
          if (onChunk) onChunk(chunkText);
        }
        if (usage) usageStats = usage;
      } catch (e) {
        // Incomplete JSON or parsing error, skip
      }
    };

    // True when the buffered payload is already a complete JSON document.
    const isComplete = (str) => {
      if (!str) return false;
      try { JSON.parse(str); return true; } catch { return false; }
    };

    return {
      push(textChunk) {
        buffer += textChunk;
        let boundary = buffer.indexOf('\n');

        while (boundary !== -1) {
          const line = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 1);
          boundary = buffer.indexOf('\n');

          if (line === '') {
            // Message boundary — process accumulated data
            if (currentData) {
              const dataStr = currentData.trim();
              currentData = ''; // Reset for next message
              consume(dataStr);
            }
          } else if (line.startsWith('data:')) {
            const dataVal = line.slice(5).trim();
            // Spec says messages are separated by a blank line, but several
            // OpenAI-compatible gateways emit back-to-back `data:` lines with no
            // separator. Flush the previous payload as soon as it is complete JSON,
            // otherwise keep accumulating (Gemini splits one payload over many lines).
            if (currentData && isComplete(currentData.trim())) {
              const dataStr = currentData.trim();
              currentData = '';
              consume(dataStr);
            }
            currentData = currentData ? currentData + '\n' + dataVal : dataVal;
          }
        }
      },
      finish() {
        // Process any remaining leftover data
        if (currentData) {
          consume(currentData.trim());
          currentData = '';
        }
        return { text: fullText, usageStats };
      },
    };
  }

  /**
   * Read a streaming response body, whatever the server actually sent.
   * A server that ignores `stream: true` and answers with a single JSON document
   * is handled too — otherwise the page would silently come back empty.
   */
  async _handleStreamResponse(response, onChunk) {
    const contentType = (response.headers?.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/event-stream')) {
      return this._handleSseStream(response.body, onChunk);
    }
    return this._handleBufferedResponse(await response.text(), onChunk);
  }

  /**
   * Parse a fully-buffered response: a single JSON document, a JSON array of
   * stream chunks, or SSE text that arrived without the event-stream content type.
   */
  _handleBufferedResponse(raw, onChunk) {
    const body = (raw || '').trim();

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Not JSON — fall back to treating it as SSE text
      const acc = this._createSseAccumulator(onChunk);
      acc.push(body.endsWith('\n') ? body : body + '\n');
      return acc.finish();
    }

    let fullText = '';
    let usageStats = { inputTokens: 0, outputTokens: 0, costUSD: 0 };

    // Gemini's non-SSE streaming endpoint answers with an array of chunks
    for (const item of (Array.isArray(parsed) ? parsed : [parsed])) {
      const { text: chunkText, usage } = this._parseStreamChunk(item);
      if (chunkText) {
        fullText += chunkText;
        if (onChunk) onChunk(chunkText);
      }
      if (usage) usageStats = usage;
    }

    return { text: fullText, usageStats };
  }

  /**
   * Process Server-Sent Events stream, accumulating multi-line data payloads
   */
  async _handleSseStream(body, onChunk) {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    const acc = this._createSseAccumulator(onChunk);

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc.push(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
    }

    return acc.finish();
  }

  // processImage() (non-streaming) removed — use processImageStream() instead.

  async processImageStream(imageBuffer, prompt, onChunk, { signal } = {}) {
    await this._validateConfig();
    const headers = await this._getHeaders();
    const base64 = imageBuffer.toString('base64');

    const body = this._buildImageRequestBody(prompt, base64);

    const response = await this._fetchWithRetry(this.streamGenerateUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.providerName} stream error ${response.status}: ${text.slice(0, 300)}`);
    }

    return this._handleStreamResponse(response, onChunk);
  }

  // translateText() (non-streaming) removed — use translateTextStream() instead.

  async translateTextStream(text, targetLang, sourceLang = 'auto', bilingual = false, onChunk, { signal } = {}) {
    await this._validateConfig();
    const headers = await this._getHeaders();

    const prompt = bilingual
      ? buildBilingualTranslatePrompt(text, targetLang, sourceLang)
      : buildTranslatePrompt(text, targetLang, sourceLang);

    const body = this._buildTextRequestBody(prompt);

    const response = await this._fetchWithRetry(this.streamGenerateUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${this.providerName} stream error ${response.status}: ${errText.slice(0, 300)}`);
    }

    const { text: raw, usageStats } = await this._handleStreamResponse(response, onChunk);

    if (bilingual) {
      const sections = extractBilingualTranslation(raw, text);
      const formatted = formatBilingualOutput(sections);
      return { text: formatted, bilingualSections: sections, usageStats };
    } else {
      const extracted = extractTranslation(raw, text);
      return { text: extracted, usageStats };
    }
  }
}

module.exports = BaseProvider;
