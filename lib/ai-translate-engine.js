/**
 * ai-translate-engine.js
 * Orchestrator: manages AI Translation and Extraction pipeline
 */

const VertexAIProvider = require('./providers/vertex-ai');

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
 * Build provider instance based on provider name + settings
 */
function buildProvider(provider, settingsManager, customModelOverride = null) {
  const settings = settingsManager.getAll();

  if (provider !== 'vertex-ai') {
    throw new Error(`Nhà cung cấp '${provider}' không hợp lệ hoặc đã bị xoá. Vui lòng cấu hình Gemini Enterprise Agent Platform (Vertex AI).`);
  }

  return new VertexAIProvider(
    settings.vertexAI?.projectId,
    settings.vertexAI?.region,
    pickModel(customModelOverride, settings.vertexAI?.model),
    settings.vertexAI?.serviceAccountJson
  );
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
