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

  // ── Page image limits (overridable per provider) ────────────────────────
  //
  // A PDF page rendered at 300 DPI is ~8.7 megapixels, about 7.9 MB as PNG and
  // 10.5 MB once base64-encoded into the request body. Every vision API tiles
  // the image internally (OpenAI at 512px, Gemini at 768px) and caps the long
  // edge well below that, so the extra pixels cost upload time and tokens
  // without improving OCR.
  //
  // 2000px on the long edge is ~170 DPI for A4 — still comfortably readable for
  // body text, and the ceiling OpenAI documents for detailed vision input.
  static MAX_IMAGE_EDGE = 2000;
  static JPEG_QUALITY = 85;
  // Trần cho ảnh SAU khi mã hoá base64 (đúng thứ đi trên dây). 0 = chỉ giới hạn cạnh.
  static MAX_IMAGE_BYTES = 0;
  // Long edges tried in order when MAX_IMAGE_BYTES is still exceeded.
  static IMAGE_FALLBACK_EDGES = [1600, 1200, 900];

  // Chờ máy chủ trả header. fetch() không tự bỏ cuộc bao giờ: một proxy nhận
  // kết nối rồi im lặng sẽ giữ worker mãi mãi.
  static CONNECT_TIMEOUT_MS = 90_000;
  // Luồng SSE đang chạy nhưng không phát thêm byte nào. Gặp ở proxy đứt giữa
  // chừng hoặc stream thiếu dấu kết thúc.
  static STREAM_IDLE_TIMEOUT_MS = 120_000;

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
   * Dong ho canh cho MOT request streaming.
   *
   * Voi 100 trang thi mot request treo la chuyen hiem. Voi 2500 trang la khoang
   * 5000 request — gap mot ket noi nua dong, mot proxy im lang hay mot luong SSE
   * thieu dau ket thuc gan nhu chac chan xay ra. Khong co dong ho nay thi request
   * do giu mot worker vinh vien, va den luot Promise.all() khong bao gio xong:
   * dung la trieu chung "treo ca du an" ma nguoi dung gap.
   *
   * Tin huy cua nguoi dung duoc noi vao cung mot controller, nen bam Huy van
   * cat duoc request ngay.
   */
  _createRequestGuard(outerSignal) {
    const controller = new AbortController();
    let timer = null;
    let reason = null;

    const onOuterAbort = () => controller.abort();
    if (outerSignal) {
      if (outerSignal.aborted) controller.abort();
      else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
    }

    const arm = (ms, why) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        reason = why;
        controller.abort();
      }, ms);
    };

    const connectMs = this.constructor.CONNECT_TIMEOUT_MS;
    const idleMs = this.constructor.STREAM_IDLE_TIMEOUT_MS;

    return {
      signal: controller.signal,
      armConnect: () =>
        arm(connectMs, `máy chủ không trả lời trong ${Math.round(connectMs / 1000)} giây`),
      // Hen lai moi lan nhan duoc du lieu: stream cham van chay, stream chet thi bi cat.
      armIdle: () =>
        arm(idleMs, `luồng dữ liệu im lặng quá ${Math.round(idleMs / 1000)} giây`),
      disarm: () => { if (timer) clearTimeout(timer); timer = null; },
      get timeoutReason() { return reason; },
      release() {
        if (timer) clearTimeout(timer);
        timer = null;
        if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
      },
    };
  }

  /**
   * Bien mot lan abort do het gio thanh loi doc duoc, thay vi "AbortError" tran
   * len giao dien va bi nham voi thao tac Huy cua nguoi dung.
   */
  _rethrowAsTimeout(err, guard, what) {
    if (err?.name === 'AbortError' && guard.timeoutReason) {
      throw new Error(
        `${this.providerName} quá hạn khi ${what}: ${guard.timeoutReason}. ` +
        'Trang này được ghi nhận là lỗi để lần chạy tiếp tục — bấm "Thử lại" để gọi lại.'
      );
    }
    throw err;
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
   * Sampling + tool settings shared by every Gemini-dialect request body.
   * Kept in one place so a change to the token budget or the tool-calling mode
   * cannot drift between the text and image paths.
   */
  _generationOptions(maxOutputTokens = 65535) {
    const thinkingConfig = this._getThinkingConfig();
    return {
      generationConfig: {
        maxOutputTokens,
        temperature: 0.1,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
      toolConfig: {
        functionCallingConfig: { mode: 'NONE' },
      },
    };
  }

  /**
   * Smallest valid generate request, used by testConnection to prove the model
   * answers. Gemini and Vertex spoke the same body here with their own copies.
   */
  _buildProbeBody() {
    const { generationConfig, toolConfig } = this._generationOptions(5);
    delete generationConfig.temperature;
    return {
      contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
      generationConfig,
      toolConfig,
    };
  }

  /**
   * Build the request body for a text-only streaming generation.
   */
  _buildTextRequestBody(prompt) {
    return {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...this._generationOptions(),
    };
  }

  /**
   * Downscale and re-encode the rendered page image before upload.
   *
   * Applies to every provider: Gemini accepts a 7.9 MB PNG per page, but over a
   * 2500-page document that is ~20 GB pushed over the wire for pixels the API
   * discards during tiling anyway. Shrinking first is the single biggest
   * throughput win on large documents.
   *
   * Providers tune the limits through the static fields above rather than by
   * reimplementing this.
   * @returns {{ buffer: Buffer, mimeType: string }}
   */
  async _prepareImage(imageBuffer) {
    const fallback = { buffer: imageBuffer, mimeType: 'image/png' };
    try {
      const { nativeImage } = require('electron');
      const source = nativeImage.createFromBuffer(imageBuffer);
      if (source.isEmpty()) return fallback;

      const { width, height } = source.getSize();
      const maxBytes = this.constructor.MAX_IMAGE_BYTES;

      // Ảnh đi trong JSON dưới dạng base64, tốn thêm đúng 1/3. So byte thô với
      // trần là đo nhầm chỗ: trần 4 MB khi đó thực ra cho qua tới ~5,33 MB trên
      // dây, vượt đúng cái giới hạn mà trần này sinh ra để chặn.
      const encodedSize = (raw) => Math.ceil(raw / 3) * 4;

      // Try the preferred edge first, then progressively smaller ones — but only
      // while the result is still over the provider's byte ceiling.
      const edges = [this.constructor.MAX_IMAGE_EDGE, ...this.constructor.IMAGE_FALLBACK_EDGES];
      let best = null;

      for (const edge of edges) {
        const candidate = this._encodeAtEdge(source, width, height, edge, fallback);
        if (!candidate) continue;
        if (!best || candidate.buffer.length < best.buffer.length) best = candidate;
        if (!maxBytes || encodedSize(candidate.buffer.length) <= maxBytes) return candidate;
      }

      // Still too big even at the smallest edge — send the smallest we produced
      // and let the endpoint decide, rather than silently failing here.
      return best || fallback;
    } catch {
      // nativeImage unavailable (unit tests run outside Electron) — send the PNG as-is
      return fallback;
    }
  }

  /**
   * Encode `source` with its long edge capped at `edge`, picking whichever of
   * JPEG / PNG / the untouched original comes out smallest.
   */
  _encodeAtEdge(source, width, height, edge, fallback) {
    const didResize = Math.max(width, height) > edge;
    const img = didResize
      ? source.resize(width >= height ? { width: edge, quality: 'best' } : { height: edge, quality: 'best' })
      : source;

    const candidates = [];
    const jpeg = img.toJPEG(this.constructor.JPEG_QUALITY);
    if (jpeg && jpeg.length > 0) candidates.push({ buffer: jpeg, mimeType: 'image/jpeg' });

    if (didResize) {
      const png = img.toPNG();
      if (png && png.length > 0) candidates.push({ buffer: png, mimeType: 'image/png' });
    } else {
      // No downscale happened, so the untouched original is a valid candidate
      candidates.push(fallback);
    }

    candidates.sort((a, b) => a.buffer.length - b.buffer.length);
    return candidates[0] || null;
  }

  /**
   * Build the request body for a prompt + page image streaming generation.
   */
  _buildImageRequestBody(prompt, base64Image, mimeType = 'image/png') {
    return {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
      ...this._generationOptions(),
    };
  }

  /**
   * Extract incremental text + optional usage stats from one parsed SSE payload.
   * @returns {{ text: string, usage: object|null, finishReason: string|null }}
   */
  _parseStreamChunk(data) {
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = data?.usageMetadata ? this._extractUsageStats(data) : null;
    const finishReason = data?.candidates?.[0]?.finishReason || null;
    return { text, usage, finishReason };
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
    // Diagnostics — so an empty result can explain itself instead of failing silently
    let rawSample = '';
    let payloadCount = 0;
    let parseErrors = 0;
    let lastFinishReason = null;

    // Parse one accumulated SSE message payload and fold it into the result
    const consume = (dataStr) => {
      if (!dataStr || dataStr === '[DONE]') return;
      payloadCount++;
      try {
        const data = JSON.parse(dataStr);
        const { text: chunkText, usage, finishReason } = this._parseStreamChunk(data);
        if (chunkText) {
          fullText += chunkText;
          if (onChunk) onChunk(chunkText);
        }
        if (usage) usageStats = usage;
        if (finishReason) lastFinishReason = finishReason;
      } catch (e) {
        // Incomplete JSON or parsing error, skip
        parseErrors++;
      }
    };

    // True when the buffered payload is already a complete JSON document.
    const isComplete = (str) => {
      if (!str) return false;
      try { JSON.parse(str); return true; } catch { return false; }
    };

    return {
      push(textChunk) {
        if (rawSample.length < 1000) rawSample += textChunk;
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
        return {
          text: fullText,
          usageStats,
          diagnostics: { rawSample, payloadCount, parseErrors, finishReason: lastFinishReason, source: 'sse' },
        };
      },
    };
  }

  /**
   * A stream that produced no text at all is a failure the user must see.
   * Without this, a response we cannot parse silently becomes an empty page.
   */
  _assertNonEmpty(result, what) {
    if (result?.text && result.text.trim()) return result;

    const d = result?.diagnostics || {};
    const sample = (d.rawSample || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    const detail = [
      `${d.payloadCount || 0} gói dữ liệu`,
      `${d.parseErrors || 0} gói lỗi cú pháp`,
      d.source ? `kiểu phản hồi: ${d.source}` : '',
    ].filter(Boolean).join(', ');

    throw new Error(
      `${this.providerName} trả về nội dung rỗng khi ${what} (${detail}). ` +
      `Model "${this.model}" có thể không hỗ trợ ảnh, hoặc endpoint trả về định dạng lạ. ` +
      (sample ? `Phản hồi thô: ${sample}` : 'Máy chủ không trả về dữ liệu nào.')
    );
  }

  /**
   * A response the server cut short used to be returned as if it were complete,
   * leaving a half-translated page with no warning.
   *
   * When nothing usable came back this is a hard error. When the server did
   * produce text before stopping, throwing away that work helps nobody — the
   * partial result is returned with a warning the user can actually see in the
   * output, via `truncationWarning`.
   */
  _assertNotTruncated(result, what) {
    const raw = result?.diagnostics?.finishReason;
    const reason = String(raw || '').toLowerCase();
    if (!reason) return result;

    let cause = null;
    if (reason === 'length' || reason === 'max_tokens') {
      const got = result?.usageStats?.outputTokens;
      cause =
        `chạm giới hạn token (finish_reason: ${raw}` +
        (got ? `, đã sinh ${got} token` : '') + '). ' +
        'App đã yêu cầu mức tối đa 65535 token, nên endpoint này đang tự áp một giới hạn ' +
        'thấp hơn — hãy giảm DPI trong Cài đặt, hoặc đổi model/endpoint cho phép output dài hơn.';
    } else if (reason === 'content_filter' || reason === 'safety') {
      cause =
        `bộ lọc an toàn của máy chủ chặn lại (finish_reason: ${raw}). ` +
        'Nội dung trang không nhất thiết vi phạm gì — bộ lọc của endpoint thường chặn nhầm ' +
        'ảnh có mã QR, thông tin liên hệ hoặc quảng cáo. Bấm "Thử lại" thường là chạy được, ' +
        'vì bộ lọc không cho kết quả giống nhau giữa các lần gọi.';
    }

    if (!cause) return result;

    // Nothing usable came back — this has to be a hard error.
    if (!result?.text || !result.text.trim()) {
      throw new Error(`${this.providerName} dừng sớm khi ${what}: ${cause}`);
    }

    return {
      ...result,
      truncationWarning:
        `⚠️ **Trang này có thể thiếu nội dung** — máy chủ dừng sớm khi ${what}: ${cause}`,
    };
  }

  /**
   * Read a streaming response body, whatever the server actually sent.
   * A server that ignores `stream: true` and answers with a single JSON document
   * is handled too — otherwise the page would silently come back empty.
   */
  async _handleStreamResponse(response, onChunk, guard = null) {
    const contentType = (response.headers?.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/event-stream')) {
      return this._handleSseStream(response.body, onChunk, guard);
    }
    // Doc mot cuc: van co the treo giua chung, nen giu dong ho chay den khi xong.
    const raw = await response.text();
    guard?.disarm();
    return this._handleBufferedResponse(raw, onChunk);
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
    let finishReason = null;

    // Gemini's non-SSE streaming endpoint answers with an array of chunks
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      const { text: chunkText, usage, finishReason: fr } = this._parseStreamChunk(item);
      if (chunkText) {
        fullText += chunkText;
        if (onChunk) onChunk(chunkText);
      }
      if (usage) usageStats = usage;
      if (fr) finishReason = fr;
    }

    return {
      text: fullText,
      usageStats,
      diagnostics: {
        rawSample: body.slice(0, 1000),
        payloadCount: items.length,
        parseErrors: 0,
        finishReason,
        source: 'json',
      },
    };
  }

  /**
   * Process Server-Sent Events stream, accumulating multi-line data payloads
   */
  async _handleSseStream(body, onChunk, guard = null) {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    const acc = this._createSseAccumulator(onChunk);

    try {
      while (true) {
        // Hen gio TRUOC moi lan doc: neu may chu ngung phat, doi tuong guard se
        // abort va reader.read() nem loi thay vi cho mai.
        guard?.armIdle();
        const { value, done } = await reader.read();
        if (done) break;
        acc.push(decoder.decode(value, { stream: true }));
      }
    } finally {
      guard?.disarm();
      try { reader.releaseLock(); } catch { /* da bi abort giai phong */ }
    }

    return acc.finish();
  }

  // processImage() (non-streaming) removed — use processImageStream() instead.

  async processImageStream(imageBuffer, prompt, onChunk, { signal } = {}) {
    await this._validateConfig();
    const headers = await this._getHeaders();
    const { buffer: uploadBuffer, mimeType } = await this._prepareImage(imageBuffer);
    const base64 = uploadBuffer.toString('base64');

    const body = this._buildImageRequestBody(prompt, base64, mimeType);

    const what = 'trích xuất nội dung từ ảnh trang tài liệu';
    const guard = this._createRequestGuard(signal);
    try {
      guard.armConnect();
      const response = await this._fetchWithRetry(this.streamGenerateUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: guard.signal,
      });
      guard.disarm();

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${this.providerName} stream error ${response.status}: ${text.slice(0, 300)}`);
      }

      const result = this._assertNonEmpty(
        this._assertNotTruncated(await this._handleStreamResponse(response, onChunk, guard), what),
        what
      );

      // Surface the warning inside the page text so it survives into the output file.
      if (result.truncationWarning) {
        return { ...result, text: `${result.text}\n\n> ${result.truncationWarning}\n` };
      }
      return result;
    } catch (err) {
      this._rethrowAsTimeout(err, guard, what);
    } finally {
      guard.release();
    }
  }

  // translateText() (non-streaming) removed — use translateTextStream() instead.

  async translateTextStream(text, targetLang, sourceLang = 'auto', bilingual = false, onChunk, { signal } = {}) {
    await this._validateConfig();
    const headers = await this._getHeaders();

    const prompt = bilingual
      ? buildBilingualTranslatePrompt(text, targetLang, sourceLang)
      : buildTranslatePrompt(text, targetLang, sourceLang);

    const body = this._buildTextRequestBody(prompt);

    const guard = this._createRequestGuard(signal);
    let raw, usageStats, truncationWarning;
    try {
      guard.armConnect();
      const response = await this._fetchWithRetry(this.streamGenerateUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: guard.signal,
      });
      guard.disarm();

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${this.providerName} stream error ${response.status}: ${errText.slice(0, 300)}`);
      }

      ({ text: raw, usageStats, truncationWarning } = this._assertNonEmpty(
        this._assertNotTruncated(await this._handleStreamResponse(response, onChunk, guard), 'dịch văn bản'),
        'dịch văn bản'
      ));
    } catch (err) {
      this._rethrowAsTimeout(err, guard, 'dịch văn bản');
    } finally {
      guard.release();
    }

    // Appended after extraction — the extractor would strip it from the raw text.
    const withWarning = (out) =>
      truncationWarning ? `${out}\n\n> ${truncationWarning}\n` : out;

    if (bilingual) {
      const sections = extractBilingualTranslation(raw, text);
      const formatted = formatBilingualOutput(sections);
      return { text: withWarning(formatted), bilingualSections: sections, usageStats };
    } else {
      const extracted = extractTranslation(raw, text);
      return { text: withWarning(extracted), usageStats };
    }
  }
}

module.exports = BaseProvider;
