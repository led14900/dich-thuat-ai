/**
 * markdown-parser.js
 * Parse Markdown text (from AI OCR output) into structured document data
 * ready for DOCX generation
 */

/**
 * Parse a Markdown string into an array of document elements
 *
 * @param {string} markdown
 * @returns {Array<DocElement>}
 *
 * DocElement types:
 *   { type: 'heading', level: 1-6, text: string, runs: Run[] }
 *   { type: 'paragraph', runs: Run[] }
 *   { type: 'table', rows: Row[][] }   // Row = array of { text, bold, colspan }
 *   { type: 'list', ordered: boolean, items: ListItem[] }
 *   { type: 'listItem', runs: Run[], indent: number }
 *   { type: 'blank' }
 *   { type: 'hr' }
 *   { type: 'image', alt: string }
 *   { type: 'code', text: string }
 *
 * Run = { text: string, bold: boolean, italic: boolean, code: boolean }
 */
function parseMarkdown(markdown) {
  if (!markdown || markdown.trim() === '') return [];

  const lines = markdown.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Blank line ─────────────────────────────────
    if (line.trim() === '') {
      elements.push({ type: 'blank' });
      i++;
      continue;
    }

    // ── Horizontal rule ───────────────────────────
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      elements.push({ type: 'hr' });
      i++;
      continue;
    }

    // ── Heading ────────────────────────────────────
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      elements.push({ type: 'heading', level, text, runs: parseInline(text) });
      i++;
      continue;
    }

    // ── Code block ─────────────────────────────────
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      elements.push({ type: 'code', text: codeLines.join('\n') });
      continue;
    }

    // ── Table ──────────────────────────────────────
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableRows = [];
      let headerRow = null;

      while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
        const row = parseTableRow(lines[i]);

        // Skip separator row (---|---  pattern)
        if (row.every(cell => /^[-: ]+$/.test(cell.text))) {
          i++;
          continue;
        }

        if (!headerRow && tableRows.length === 0) {
          headerRow = row.map(c => ({ ...c, bold: true }));
          tableRows.push(headerRow);
        } else {
          tableRows.push(row);
        }
        i++;
      }

      if (tableRows.length > 0) {
        elements.push({ type: 'table', rows: tableRows });
      }
      continue;
    }

    // ── Ordered list ───────────────────────────────
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      const indent = Math.floor(orderedMatch[1].length / 2);
      const text = orderedMatch[3];
      elements.push({ type: 'listItem', ordered: true, number: parseInt(orderedMatch[2]), indent, runs: parseInline(text) });
      i++;
      continue;
    }

    // ── Unordered list ─────────────────────────────
    const unorderedMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      const indent = Math.floor(unorderedMatch[1].length / 2);
      const text = unorderedMatch[2];
      elements.push({ type: 'listItem', ordered: false, indent, runs: parseInline(text) });
      i++;
      continue;
    }

    // ── Regular paragraph ──────────────────────────
    elements.push({ type: 'paragraph', runs: parseInline(line) });
    i++;
  }

  return elements;
}

function findSingleChar(str, char) {
  let i = 0;
  while (i < str.length) {
    if (str[i] === char) {
      if (str[i + 1] === char) {
        i += 2;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

function mergeConsecutiveRuns(runs) {
  if (runs.length <= 1) return runs;
  const merged = [];
  let current = runs[0];
  
  for (let i = 1; i < runs.length; i++) {
    const next = runs[i];
    if (!next.text) continue;
    if (!current.text) {
      current = next;
      continue;
    }
    
    if (
      current.bold === next.bold &&
      current.italic === next.italic &&
      current.code === next.code
    ) {
      current.text += next.text;
    } else {
      merged.push(current);
      current = next;
    }
  }
  if (current.text) {
    merged.push(current);
  }
  return merged;
}

function findEndIdx(text, target) {
  if (target.type === 'code') {
    return text.indexOf('`', target.start + 1);
  } else if (target.delim === '***') {
    return text.indexOf('***', target.start + 3);
  } else if (target.delim === '___') {
    return text.indexOf('___', target.start + 3);
  } else if (target.delim === '**') {
    return text.indexOf('**', target.start + 2);
  } else if (target.delim === '__') {
    return text.indexOf('__', target.start + 2);
  } else if (target.delim === '*') {
    const searchStart = target.start + 1;
    const candidate = findSingleChar(text.substring(searchStart), '*');
    if (candidate !== -1) {
      return searchStart + candidate;
    }
  } else if (target.delim === '_') {
    const searchStart = target.start + 1;
    const candidate = findSingleChar(text.substring(searchStart), '_');
    if (candidate !== -1) {
      return searchStart + candidate;
    }
  }
  return -1;
}

function parseInlineRecursive(text, style) {
  if (!text) return [];

  if (style.code) {
    return [{ text, ...style }];
  }

  const idxBoldItalicStars = text.indexOf('***');
  const idxBoldItalicUnderscores = text.indexOf('___');
  const idxCode = text.indexOf('`');
  const idxBoldStars = text.indexOf('**');
  const idxBoldUnderscores = text.indexOf('__');
  const idxItalicStar = findSingleChar(text, '*');
  const idxItalicUnderscore = findSingleChar(text, '_');

  const targets = [];
  if (idxCode !== -1) targets.push({ type: 'code', start: idxCode, len: 1, delim: '`' });
  if (idxBoldItalicStars !== -1) targets.push({ type: 'bold+italic', start: idxBoldItalicStars, len: 3, delim: '***' });
  if (idxBoldItalicUnderscores !== -1) targets.push({ type: 'bold+italic', start: idxBoldItalicUnderscores, len: 3, delim: '___' });
  if (idxBoldStars !== -1) targets.push({ type: 'bold', start: idxBoldStars, len: 2, delim: '**' });
  if (idxBoldUnderscores !== -1) targets.push({ type: 'bold', start: idxBoldUnderscores, len: 2, delim: '__' });
  if (idxItalicStar !== -1) targets.push({ type: 'italic', start: idxItalicStar, len: 1, delim: '*' });
  if (idxItalicUnderscore !== -1) targets.push({ type: 'italic', start: idxItalicUnderscore, len: 1, delim: '_' });

  // For each target, check if it has a matching endIdx
  const validTargets = [];
  for (const target of targets) {
    const endIdx = findEndIdx(text, target);
    if (endIdx !== -1) {
      validTargets.push({ ...target, endIdx });
    }
  }

  if (validTargets.length === 0) {
    return [{ text, ...style }];
  }

  // Sort valid targets to process the earliest start index first, and then the longest delimiter length
  validTargets.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.len - a.len;
  });

  const firstTarget = validTargets[0];
  const beforeText = text.substring(0, firstTarget.start);
  const innerText = text.substring(firstTarget.start + firstTarget.len, firstTarget.endIdx);
  const afterText = text.substring(firstTarget.endIdx + firstTarget.len);

  const runs = [];
  if (beforeText) {
    runs.push(...parseInlineRecursive(beforeText, style));
  }

  const newStyle = { ...style };
  if (firstTarget.type === 'code') {
    newStyle.code = true;
  } else if (firstTarget.type === 'bold') {
    newStyle.bold = true;
  } else if (firstTarget.type === 'italic') {
    newStyle.italic = true;
  } else if (firstTarget.type === 'bold+italic') {
    newStyle.bold = true;
    newStyle.italic = true;
  }

  runs.push(...parseInlineRecursive(innerText, newStyle));

  if (afterText) {
    runs.push(...parseInlineRecursive(afterText, style));
  }

  return mergeConsecutiveRuns(runs);
}

/**
 * Parse inline Markdown formatting: **bold**, *italic*, `code`, ***bold+italic***
 * @param {string} text
 * @returns {Run[]}
 */
function parseInline(text) {
  if (!text) return [{ text: '', bold: false, italic: false, code: false }];
  return parseInlineRecursive(text, { bold: false, italic: false, code: false });
}

/**
 * Parse a table row: | col1 | col2 | col3 |
 * @returns {Array<{text: string, bold: boolean}>}
 */
function parseTableRow(line) {
  return line
    .split('|')
    .slice(1, -1) // Remove empty first/last items from leading/trailing |
    .map(cell => ({ text: cell.trim(), bold: false }));
}

module.exports = { parseMarkdown, parseInline };
