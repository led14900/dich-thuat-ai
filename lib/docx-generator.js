/**
 * docx-generator.js
 * Convert OCR results (Markdown array from AI) into a Word document (.docx)
 * Uses the `docx` npm package
 */

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  AlignmentType,
  PageBreak,
  ShadingType,
  convertInchesToTwip,
} = require('docx');

const { parseMarkdown } = require('./markdown-parser');
const fs = require('fs');

// Heading level mapping
const HEADING_MAP = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

class DocxGenerator {
  constructor(settings = {}) {
    this.font = settings.outputFont || 'Times New Roman';
    this.pageSize = settings.pageSize || 'A4';
    this.fontSize = (settings.outputFontSize || 12) * 2; // Half-points: 24 = 12pt
    this.settings = settings;
  }

  /**
   * Generate a .docx file from page OCR results
   *
   * @param {Array<{page, markdown, skipped, error}>} pageResults
   * @param {string} outputPath - file system path to write .docx
   * @returns {boolean} success
   */
  async generate(pageResults, outputPath) {
    const children = [];

    for (let idx = 0; idx < pageResults.length; idx++) {
      const { page, markdown, skipped, error } = pageResults[idx];

      // Add page break before each page (except the first)
      if (idx > 0) {
        children.push(
          new Paragraph({
            children: [new PageBreak()],
          })
        );
      }

      if (skipped) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `[Trang ${page} — bị bỏ qua]`, italics: true, color: '888888' })],
          })
        );
        continue;
      }

      if (error) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `[Trang ${page} — lỗi: ${error}]`, italics: true, color: 'FF4444' })],
          })
        );
        continue;
      }

      // Bilingual mode: interleaved layout — original paragraph → translation paragraph
      if (this.settings.translateLanguage && (this.settings.translateMode === 'bilingual' || this.settings.bilingual) && pageResults[idx].bilingualSections?.length > 0) {
        for (const sec of pageResults[idx].bilingualSections) {
          // Skip entirely empty sections
          if (!sec.original?.trim() && !sec.translation?.trim()) continue;

          // ── Original paragraph (rendered normally) ──
          if (sec.original?.trim()) {
            const origElements = parseMarkdown(sec.original);
            const origDocEls = this._convertElements(origElements, page);
            for (const el of origDocEls) {
              children.push(el);
            }
            if (origDocEls.length === 0) {
              children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
            }
          }

          // ── Translation paragraph (italic, blue text, subtle left border) ──
          if (sec.translation?.trim()) {
            const transElements = parseMarkdown(sec.translation);

            for (const el of transElements) {
              // Skip blanks
              if (el.type === 'blank') continue;

              // Build runs with italic + blue override
              const runs = (el.runs || [{ text: el.text || sec.translation, bold: false, italic: false, code: false }]);
              const styledRuns = runs.map(run =>
                new TextRun({
                  text: run.text,
                  bold: run.bold || false,
                  italics: true,
                  font: run.code ? 'Courier New' : this.font,
                  size: run.code ? 20 : this.fontSize,
                  color: '2563EB',
                })
              );

              children.push(
                new Paragraph({
                  children: styledRuns,
                  spacing: { before: 40, after: 80 },
                  border: {
                    left: { style: BorderStyle.SINGLE, size: 4, color: '93C5FD', space: 6 },
                  },
                  indent: { left: 120 },
                  ...(el.type === 'heading' ? { heading: HEADING_MAP[el.level] || HeadingLevel.HEADING_3 } : {}),
                })
              );
            }

            // Fallback: if no parsed elements, render raw text
            if (transElements.length === 0 || transElements.every(e => e.type === 'blank')) {
              children.push(
                new Paragraph({
                  children: [new TextRun({
                    text: sec.translation,
                    italics: true,
                    color: '2563EB',
                    font: this.font,
                    size: this.fontSize,
                  })],
                  spacing: { before: 40, after: 80 },
                  border: {
                    left: { style: BorderStyle.SINGLE, size: 4, color: '93C5FD', space: 6 },
                  },
                  indent: { left: 120 },
                })
              );
            }
          }

          // Light spacing between sections
          children.push(
            new Paragraph({
              children: [],
              spacing: { before: 60, after: 60 },
            })
          );
        }
      } else {
        // Parse markdown and convert to DOCX elements
        const elements = parseMarkdown(markdown || '');
        const docElements = this._convertElements(elements, page);
        children.push(...docElements);
      }
    }

    // Build document
    const doc = new Document({
      creator: 'AI Translate',
      title: 'Tài liệu AI Translate',
      description: 'Converted with AI Translate',
      numbering: {
        config: [
          {
            reference: 'ordered-list',
            levels: [
              {
                level: 0,
                format: 'decimal',
                text: '%1.',
                alignment: AlignmentType.START,
                style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
              },
              {
                level: 1,
                format: 'lowerLetter',
                text: '%2.',
                alignment: AlignmentType.START,
                style: { paragraph: { indent: { left: convertInchesToTwip(1.0), hanging: convertInchesToTwip(0.25) } } },
              },
              {
                level: 2,
                format: 'lowerRoman',
                text: '%3.',
                alignment: AlignmentType.START,
                style: { paragraph: { indent: { left: convertInchesToTwip(1.5), hanging: convertInchesToTwip(0.25) } } },
              },
            ],
          },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              size: this._getPageSize(),
              margin: {
                top: convertInchesToTwip(1),
                right: convertInchesToTwip(1),
                bottom: convertInchesToTwip(1),
                left: convertInchesToTwip(1.25),
              },
            },
          },
          children,
        },
      ],
      styles: {
        default: {
          document: {
            run: {
              font: this.font,
              size: this.fontSize,
            },
          },
        },
      },
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);
    return true;
  }

  /**
   * Convert parsed document elements to docx Paragraph/Table objects
   */
  _convertElements(elements, pageNum) {
    const result = [];

    for (const el of elements) {
      switch (el.type) {
        case 'heading':
          result.push(
            new Paragraph({
              heading: HEADING_MAP[el.level] || HeadingLevel.HEADING_1,
              children: this._buildRuns(el.runs),
            })
          );
          break;

        case 'paragraph':
          if (el.runs?.length > 0 && el.runs.some(r => r.text.trim())) {
            result.push(
              new Paragraph({
                children: this._buildRuns(el.runs),
              })
            );
          }
          break;

        case 'blank':
          result.push(new Paragraph({ children: [] }));
          break;

        case 'hr':
          result.push(
            new Paragraph({
              border: { bottom: { color: 'AAAAAA', space: 1, value: BorderStyle.SINGLE, size: 6 } },
              children: [],
            })
          );
          break;

        case 'code':
          result.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: el.text,
                  font: 'Courier New',
                  size: 20, // 10pt
                  color: '444444',
                }),
              ],
              shading: { type: ShadingType.SOLID, color: 'F4F4F4' },
            })
          );
          break;

        case 'listItem': {
          const indentInches = 0.15 * ((el.indent || 0) + 1);
          const prefix = el.ordered ? `${el.number || 1}. ` : '• ';
          
          const runsCopy = el.runs ? JSON.parse(JSON.stringify(el.runs)) : [{ text: '' }];
          if (runsCopy.length > 0) {
            runsCopy[0].text = prefix + runsCopy[0].text;
          }
          
          result.push(
            new Paragraph({
              indent: { left: convertInchesToTwip(indentInches) },
              children: this._buildRuns(runsCopy),
            })
          );
          break;
        }

        case 'table':
          result.push(this._buildTable(el.rows));
          break;

        case 'image':
          result.push(
            new Paragraph({
              children: [
                new TextRun({ text: `[Hình ảnh: ${el.alt}]`, italics: true, color: '666666' }),
              ],
            })
          );
          break;
      }
    }

    return result;
  }

  /**
   * Convert Run[] to TextRun[]
   */
  _buildRuns(runs = []) {
    if (!runs || runs.length === 0) {
      return [new TextRun({ text: '' })];
    }
    return runs.map(run =>
      new TextRun({
        text: run.text,
        bold: run.bold || false,
        italics: run.italic || false,
        font: run.code ? 'Courier New' : this.font,
        size: run.code ? 20 : this.fontSize,
        color: run.code ? '444444' : undefined,
      })
    );
  }

  /**
   * Build a Table element from row data
   */
  _buildTable(rows) {
    const tableRows = rows.map((row, rowIdx) =>
      new TableRow({
        children: row.map(cell =>
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: cell.text || '',
                    bold: cell.bold || rowIdx === 0, // First row is header
                    font: this.font,
                    size: this.fontSize,
                  }),
                ],
              }),
            ],
            margins: { top: 40, bottom: 40, left: 80, right: 80 },
            shading: rowIdx === 0
              ? { type: ShadingType.SOLID, color: 'E8E8E8' }
              : undefined,
          })
        ),
      })
    );

    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: tableRows,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
        bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
        left: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
        right: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
        insideH: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
        insideV: { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' },
      },
    });
  }

  /**
   * Map page size string to docx page dimensions
   */
  _getPageSize() {
    const sizes = {
      'A4': { width: convertInchesToTwip(8.27), height: convertInchesToTwip(11.69) },
      'A3': { width: convertInchesToTwip(11.69), height: convertInchesToTwip(16.54) },
      'Letter': { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
      'Legal': { width: convertInchesToTwip(8.5), height: convertInchesToTwip(14) },
    };
    return sizes[this.pageSize] || sizes['A4'];
  }
}

module.exports = DocxGenerator;
