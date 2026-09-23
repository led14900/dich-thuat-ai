/**
 * translate-utils.js — Shared translation utilities
 */


/**
 * Build the translation prompt.
 * Asking for XML tags ensures the AI doesn't prepend conversational phrases, and is robust against multiline texts.
 */
function buildTranslatePrompt(text, targetLang, sourceLang = 'auto') {
  const sourceInstruction = (!sourceLang || sourceLang === 'auto')
    ? 'detect the source language automatically'
    : `translate from ${sourceLang}`;

  return `You are a professional translator. Translate the markdown text below to ${targetLang} (${sourceInstruction}).
Return the translation enclosed in <translation> and </translation> XML tags.
Preserve ALL markdown formatting (headings, bold, italic, tables, lists) exactly as-is.
CRITICAL RULES:
- Do NOT add any explanation, preamble, commentary, footnotes, or translator notes.
- Do NOT include the original text in your output.
- Do NOT add phrases like "Note:", "Explanation:", "Translator's note:", etc.
- Output ONLY the pure, clean translation — nothing else.

Text to translate:
${text}`;
}

/**
 * Build the bilingual prompt in XML format.
 */
function buildBilingualTranslatePrompt(text, targetLang, sourceLang = 'auto') {
  const sourceInstruction = (!sourceLang || sourceLang === 'auto')
    ? 'detect the source language automatically'
    : `translate from ${sourceLang}`;

  return `You are a professional translator. Translate the markdown text below to ${targetLang} (${sourceInstruction}).
You must output a bilingual version, aligned paragraph-by-paragraph (or block-by-block, e.g. for headings and lists).
For EACH block, output the following XML structure:
<section>
  <original>
    <exact original text>
  </original>
  <translation>
    <translated text>
  </translation>
</section>

CRITICAL RULES:
- Do NOT add any explanation, preamble, commentary, footnotes, or translator notes.
- Output ONLY the XML elements.
- All markdown formatting (bold, italic, lists, etc.) inside the blocks must be preserved.

Text to translate:
${text}`;
}

/**
 * Extract the translated text from an AI response.
 */
function extractTranslation(raw, fallback) {
  if (!raw?.trim()) return fallback || '';

  // 1. Try to extract from <translation> tags (most robust)
  const startIdx = raw.toLowerCase().indexOf('<translation>');
  const endIdx = raw.toLowerCase().lastIndexOf('</translation>');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return raw.substring(startIdx + 13, endIdx).trim();
  }

  // 2. Fallback: just remove markdown code fences if AI still wrapped it in ```markdown
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:markdown|text)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  return cleaned || fallback || raw;
}

/**
 * Parse the bilingual XML response.
 * Fallbacks to manual paragraph alignment if XML parse fails.
 */
function extractBilingualTranslation(raw, originalText) {
  if (!raw?.trim()) return alignFallbackBilingual(originalText, '');

  const sections = [];
  const regex = /<section>\s*<original>([\s\S]*?)<\/original>\s*<translation>([\s\S]*?)<\/translation>\s*<\/section>/gi;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    sections.push({
      original: match[1].trim(),
      translation: match[2].trim()
    });
  }

  if (sections.length > 0) {
    return sections;
  }

  // Fallback: Extract plain text translation first, then align paragraph-by-paragraph
  const plainTranslation = extractTranslation(raw, '');
  return alignFallbackBilingual(originalText, plainTranslation);
}

/**
 * Fallback alignment: splits text by paragraph blocks and maps them side-by-side
 */
function alignFallbackBilingual(originalText, translatedText) {
  const origBlocks = (originalText || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const transBlocks = (translatedText || '').split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  
  const sections = [];
  const maxLen = Math.max(origBlocks.length, transBlocks.length);

  for (let i = 0; i < maxLen; i++) {
    sections.push({
      original: origBlocks[i] || '',
      translation: transBlocks[i] || ''
    });
  }

  return sections;
}

/**
 * Formats bilingual sections into lightweight interleaved text for real-time UI display
 * (original paragraph → translation paragraph, repeating for each section)
 */
function formatBilingualOutput(sections) {
  if (!Array.isArray(sections)) return '';
  return sections
    .filter(sec => sec.original?.trim() || sec.translation?.trim())
    .map(sec => {
      const orig = sec.original?.trim() || '';
      const trans = sec.translation?.trim() || '';
      return `${orig}\n  → ${trans}`;
    }).join('\n\n');
}

module.exports = {
  buildTranslatePrompt,
  buildBilingualTranslatePrompt,
  extractTranslation,
  extractBilingualTranslation,
  alignFallbackBilingual,
  formatBilingualOutput,
};
