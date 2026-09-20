/**
 * ai-translate-engine.js
 * Orchestrator: manages AI Translation and Extraction pipeline
 */

const VertexAIProvider = require('./providers/vertex-ai');
const GeminiAPIProvider = require('./providers/gemini-api');
const OpenAICompatibleProvider = require('./providers/openai-compatible');

// Default prompt for formatting-preserving extraction from images.
// Used for OCR / Text Extraction from PDF pages using the Vision model, before the actual translation step.
const DEFAULT_EXTRACT_PROMPT = `You are a document extraction and translation specialist. Extract the content of this document page image into structured Markdown format.

CRITICAL RULES — follow exactly:
1. Extract ALL text visible on the page, character by character
2. Use proper Markdown heading levels: # for H1, ## for H2, ### for H3, etc.
3. Recreate tables using standard Markdown table syntax (| col1 | col2 |)
4. Preserve ordered lists (1. 2. 3.) and unordered lists (- item)
5. Use **bold** and *italic* for emphasized text
6. Preserve paragraph breaks with blank lines
7. For images, charts, or diagrams: write [Hình ảnh: mô tả ngắn]
8. For page numbers, headers, footers: include them as-is
9. Do NOT add explanations, commentary, or preamble
10. Output ONLY the Markdown content, nothing else

If the page is blank, output: [Trang trắng]`;

function pickModel(customModelOverride, fallback) {
  return customModelOverride === null || customModelOverride === undefined
    ? fallback
    : customModelOverride;
}

/**
 * Bộ nhớ đệm provider theo (provider + model + cấu hình).
 *
 * Trước đây mỗi lần OCR hoặc dịch một trang đều dựng một instance mới. Với
 * Gemini và OpenAI-compatible thì chỉ lãng phí, nhưng với Vertex AI thì
 * _accessToken nằm trên instance: instance mới nghĩa là ký JWT lại và đổi
 * OAuth token lại. Một tài liệu 2500 trang có OCR + dịch là khoảng 5000
 * provider và chừng ấy lượt xin token — đủ để dính rate limit và làm chậm
 * đáng kể chỉ vì phần xác thực.
 *
 * Khoá gồm toàn bộ cấu hình liên quan, nên đổi API key, model hay project
 * trong Cài đặt sẽ tự sinh instance mới; không cần xoá đệm thủ công.
 */
const providerCache = new Map();
const PROVIDER_CACHE_MAX = 8;

function cachedProvider(key, create) {
  const hit = providerCache.get(key);
  if (hit) return hit;

  const instance = create();
  providerCache.set(key, instance);
  // Map giữ thứ tự chèn nên khoá đầu là khoá cũ nhất.
  while (providerCache.size > PROVIDER_CACHE_MAX) {
    providerCache.delete(providerCache.keys().next().value);
  }
  return instance;
}

/**
 * Build provider instance based on provider name + settings
 */
function buildProvider(provider, settingsManager, customModelOverride = null) {
  const settings = settingsManager.getAll();

  if (provider === 'vertex-ai') {
    const model = pickModel(customModelOverride, settings.vertexAI?.model);
    const v = settings.vertexAI || {};
    // serviceAccountJson là chuỗi dài; băm rẻ tiền là đủ để phát hiện thay đổi.
    return cachedProvider(
      `vertex|${v.projectId}|${v.region}|${model}|${(v.serviceAccountJson || '').length}`,
      () => new VertexAIProvider(v.projectId, v.region, model, v.serviceAccountJson)
    );
  } else if (provider === 'gemini-api') {
    const model = pickModel(customModelOverride, settings.geminiAPI?.model);
    const key = settings.geminiAPI?.apiKey;
    return cachedProvider(
      `gemini|${key}|${model}`,
      () => new GeminiAPIProvider(key, model)
    );
  } else if (provider === 'openai-compatible') {
    const cfg = settings.openaiCompatible || {};
    const model = pickModel(customModelOverride, cfg.model);
    return cachedProvider(
      `openai|${cfg.baseUrl}|${cfg.apiKey}|${model}|${cfg.maxTokens}|${cfg.pricingInput}|${cfg.pricingOutput}`,
      () => new OpenAICompatibleProvider(cfg.baseUrl, cfg.apiKey, model, {
        maxTokens: cfg.maxTokens,
        pricing: { input: cfg.pricingInput, output: cfg.pricingOutput },
      })
    );
  } else {
    throw new Error(`Nhà cung cấp '${provider}' không hợp lệ hoặc đã bị xoá.`);
  }
}

/**
 * Test connection to AI provider
 * @returns {object} { success, message, models? }
 */
async function testConnection(provider, model, settingsManager) {
  try {
    const p = buildProvider(provider, settingsManager, model);
    return await p.testConnection();
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function listModels(provider, settingsManager) {
  try {
    const p = buildProvider(provider, settingsManager);
    const models = await p.listModels();
    return { success: true, models };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = {
  buildProvider,
  testConnection,
  listModels,
  DEFAULT_EXTRACT_PROMPT,
};
