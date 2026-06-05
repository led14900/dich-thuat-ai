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

/**
 * Parse inline Markdown formatting: **bold**, *italic*, `code`, ***bold+italic***
 * @param {string} text
 * @returns {Run[]}
 */
function parseInline(text) {
  const runs = [];
  // Regex: match bold+italic, bold, italic, code, plain text, or single character fallback to avoid truncation
  const pattern = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`\n]+)|([\s\S]))/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match[2]) {
      runs.push({ text: match[2], bold: true, italic: true, code: false });
    } else if (match[3]) {
      runs.push({ text: match[3], bold: true, italic: false, code: false });
    } else if (match[4]) {
      runs.push({ text: match[4], bold: false, italic: true, code: false });
    } else if (match[5]) {
      runs.push({ text: match[5], bold: false, italic: false, code: true });
    } else if (match[6]) {
      runs.push({ text: match[6], bold: false, italic: false, code: false });
    } else if (match[7]) {
      if (runs.length > 0 && !runs[runs.length - 1].bold && !runs[runs.length - 1].italic && !runs[runs.length - 1].code) {
        runs[runs.length - 1].text += match[7];
      } else {
        runs.push({ text: match[7], bold: false, italic: false, code: false });
      }
    }
  }

  return runs.length > 0 ? runs : [{ text, bold: false, italic: false, code: false }];
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
