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
  ShadingType,
  Footer,
  PageNumber,
  SectionType,
  convertInchesToTwip,
} = require('docx');
const { parseMarkdown } = require('./markdown-parser');
const { docxLayout } = require('./translate-output-mode');
const { buildTwoColumnTable, buildCopyHint, twoColumnFontSize } = require('./docx-two-column-layout');
const fs = require('fs');

function reconstructBilingualSections(pageMarkdown) {
  if (!pageMarkdown) return [];
  const blocks = pageMarkdown.split(/\n\n+/);
  const sections = [];
  let currentOriginal = '';
  
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    
    // Check if it represents a translation (wrapped in *...* or _..._)
    const isTranslation = (trimmed.startsWith('*') && trimmed.endsWith('*')) || (trimmed.startsWith('_') && trimmed.endsWith('_'));
    
    if (isTranslation) {
      // Strip the wrapping asterisks
      const cleanedTranslation = trimmed.slice(1, -1).trim();
      sections.push({
        original: currentOriginal.trim(),
        translation: cleanedTranslation
      });
      currentOriginal = ''; // Reset for next section
    } else {
      if (currentOriginal) {
        currentOriginal += '\n\n' + trimmed;
      } else {
        currentOriginal = trimmed;
      }
    }
  }
  
  // If there's any trailing original text without translation
  if (currentOriginal.trim()) {
    sections.push({
      original: currentOriginal.trim(),
      translation: ''
    });
  }
  
  return sections;
}
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
    const layout = docxLayout(this.settings);

    // MỖI TRANG GỐC = MỘT SECTION RIÊNG.
    //
    // Trước đây cả tài liệu là một section, các trang ngăn nhau bằng PageBreak.
    // Cách đó chỉ ngắt trang được, không cho phép mỗi trang có chân trang riêng,
    // nên người đọc không biết đoạn mình đang xem thuộc trang nào của bản gốc.
    //
    // Section thì mặc định bắt đầu ở trang mới, nên trang gốc 1 tràn 1,5 trang
    // Word thì trang gốc 2 tự nhảy sang trang Word thứ 3 — không bao giờ có hai
    // trang gốc chen nhau trên cùng một trang Word.
    //
    // Đã đo: 2500 trang -> ~2 MB, ~2,7 giây. Không đáng lo.
    const sections = pageResults.map((res, idx) => ({
      properties: {
        ...(idx > 0 ? { type: SectionType.NEXT_PAGE } : {}),
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
      footers: { default: this._buildPageFooter(res.page) },
      children: this._buildPageChildren(res, layout),
    }));

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
      sections,
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
    await fs.promises.writeFile(outputPath, buffer);
    return true;
  }

  /**
   * Chân trang: số trang của BẢN GỐC, kèm số trang Word.
   *
   * Người đọc cần đối chiếu với file PDF gốc nên số trang gốc là số quan trọng;
   * số trang Word để ở sau cho việc in ấn và trích dẫn.
   */
  _buildPageFooter(pageNum) {
    return new Footer({
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9', space: 6 } },
          children: [
            new TextRun({
              text: `Trang gốc ${pageNum}`,
              bold: true,
              font: this.font,
              size: 18,
              color: '555555',
            }),
            new TextRun({ text: '   •   Trang Word ', font: this.font, size: 18, color: '999999' }),
            new TextRun({ children: [PageNumber.CURRENT], font: this.font, size: 18, color: '999999' }),
            new TextRun({ text: '/', font: this.font, size: 18, color: '999999' }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], font: this.font, size: 18, color: '999999' }),
          ],
        }),
      ],
    });
  }

  /** Toàn bộ nội dung của một trang gốc, theo bố cục đang chọn. */
  _buildPageChildren(result, layout) {
    const { page, markdown, skipped, error } = result;

    if (skipped) {
      return [new Paragraph({
        children: [new TextRun({ text: `[Trang ${page} — bị bỏ qua]`, italics: true, color: '888888' })],
      })];
    }

    if (error) {
      return [new Paragraph({
        children: [new TextRun({ text: `[Trang ${page} — lỗi: ${error}]`, italics: true, color: 'FF4444' })],
      })];
    }

    // Chế độ song ngữ cần cặp gốc–dịch. Bản ghi cũ (lịch sử, checkpoint từ bản
    // trước) không lưu bilingualSections nên phải dựng lại từ markdown.
    let sections = result.bilingualSections;
    if (!sections && layout !== 'clean' && markdown) {
      sections = reconstructBilingualSections(markdown);
    }

    const hasPairs = this.settings.translateLanguage && sections && sections.length > 0;

    if (layout === 'two-column' && hasPairs) {
      // Cột chỉ rộng ~8cm nên chữ trong bảng nhỏ hơn cỡ người dùng chọn. Phải
      // đổi cả this.fontSize vì _convertElements đặt cỡ chữ cho từng TextRun
      // theo trường đó — chỉ truyền fontSize vào buildTwoColumnTable thì mỗi
      // hàng tiêu đề nhỏ đi, còn nội dung vẫn giữ cỡ cũ.
      const cellFontSize = twoColumnFontSize(this.fontSize);
      const table = this._withFontSize(cellFontSize, () =>
        buildTwoColumnTable(sections, {
          renderMarkdown: md => this._convertElements(parseMarkdown(md), page),
          font: this.font,
          fontSize: cellFontSize,
          sourceLabel: 'Bản gốc',
          targetLabel: this.settings.translateLanguage || 'Bản dịch',
        })
      );
      if (table) {
        // Paragraph rỗng sau bảng: Word không cho bảng là phần tử cuối cùng của
        // một section, thiếu nó thì file mở ra báo lỗi cấu trúc.
        return [buildCopyHint(this.font), table, new Paragraph({ children: [] })];
      }
    }

    if (layout === 'interleaved' && hasPairs) {
      return this._buildInterleaved(sections, page);
    }

    return this._convertElements(parseMarkdown(markdown || ''), page);
  }

  /**
   * Chạy `fn` với một cỡ chữ khác, rồi trả cỡ cũ về.
   *
   * try/finally để một trang hỏng ném lỗi cũng không bỏ lại cỡ chữ nhỏ cho các
   * trang sau. An toàn vì mọi thứ trong `fn` đều chạy đồng bộ — docx dựng xong
   * cây phần tử ngay tại chỗ, không chờ await nào cả.
   */
  _withFontSize(size, fn) {
    const previous = this.fontSize;
    this.fontSize = size;
    try {
      return fn();
    } finally {
      this.fontSize = previous;
    }
  }

  /** Bố cục xen kẽ: đoạn gốc, rồi đoạn dịch in nghiêng màu xanh ngay dưới. */
  _buildInterleaved(sections, page) {
    const out = [];

    for (const sec of sections) {
      if (!sec.original?.trim() && !sec.translation?.trim()) continue;

      if (sec.original?.trim()) {
        const origDocEls = this._convertElements(parseMarkdown(sec.original), page);
        if (origDocEls.length === 0) {
          out.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
        } else {
          out.push(...origDocEls);
        }
      }

      if (sec.translation?.trim()) {
        out.push(...this._buildTranslationBlock(sec.translation));
      }

      out.push(new Paragraph({ children: [], spacing: { before: 60, after: 60 } }));
    }

    return out;
  }

  /** Khối bản dịch: in nghiêng, màu xanh, có vạch dọc bên trái. */
  _buildTranslationBlock(translation) {
    const out = [];
    const style = {
      spacing: { before: 40, after: 80 },
      border: { left: { style: BorderStyle.SINGLE, size: 4, color: '93C5FD', space: 6 } },
      indent: { left: 120 },
    };

    const elements = parseMarkdown(translation);

    for (const el of elements) {
      if (el.type === 'blank') continue;

      const runs = el.runs || [{ text: el.text || translation }];
      out.push(new Paragraph({
        ...style,
        children: runs.map(run => new TextRun({
          text: run.text,
          bold: run.bold || false,
          italics: true,
          font: run.code ? 'Courier New' : this.font,
          size: run.code ? 20 : this.fontSize,
          color: '2563EB',
        })),
        ...(el.type === 'heading' ? { heading: HEADING_MAP[el.level] || HeadingLevel.HEADING_3 } : {}),
      }));
    }

    // Không parse ra gì thì in thô, thà xấu còn hơn mất chữ.
    if (out.length === 0) {
      out.push(new Paragraph({
        ...style,
        children: [new TextRun({
          text: translation,
          italics: true,
          color: '2563EB',
          font: this.font,
          size: this.fontSize,
        })],
      }));
    }

    return out;
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
                // Ô bảng cũng phải in được chữ đậm/nghiêng. Trước đây lấy thẳng
                // cell.text nên `**Tổng cộng**` hiện nguyên dấu sao trong Word.
                children: (cell.runs?.length ? cell.runs : [{ text: cell.text || '' }]).map(run =>
                  new TextRun({
                    text: run.text,
                    bold: run.bold || cell.bold || rowIdx === 0, // hàng đầu là tiêu đề
                    italics: run.italic || false,
                    font: run.code ? 'Courier New' : this.font,
                    size: run.code ? 20 : this.fontSize,
                  })
                ),
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
