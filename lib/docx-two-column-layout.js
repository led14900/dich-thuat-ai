/**
 * docx-two-column-layout.js
 *
 * Dựng bố cục Word "song ngữ 2 cột": cột trái là bản gốc, cột phải là bản dịch,
 * mỗi cặp đoạn nằm trên CÙNG MỘT HÀNG nên đọc ngang là đối chiếu được ngay.
 *
 * Vì sao dùng bảng chứ không dùng cột báo (newspaper columns) của Word:
 * cột báo chảy tràn từ cột trái sang cột phải, nên đoạn thứ 10 của bản gốc và
 * đoạn thứ 10 của bản dịch không bao giờ ngang hàng nhau. Bảng thì mỗi hàng là
 * một cặp, dài ngắn khác nhau vẫn đứng đúng chỗ.
 *
 * Bảng cũng là thứ duy nhất cho phép bôi đen RIÊNG một cột rồi copy ra — đúng
 * yêu cầu "2 cột độc lập để dễ copy". Bôi đen cột trong Word: rê chuột từ đầu
 * ô trên cùng xuống ô dưới cùng của cột đó.
 */

const {
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  VerticalAlign,
  TableLayoutType,
  AlignmentType,
} = require('docx');

/**
 * Cỡ chữ dùng trong bảng 2 cột, nhỏ hơn cỡ chữ người dùng chọn.
 *
 * Mỗi cột chỉ rộng 4680 twip (~8,2cm) trên khổ A4 lề mặc định, trừ mép ô còn
 * chưa tới 7,8cm. Giữ nguyên 12pt thì chữ Latin còn ~50 ký tự một dòng, còn
 * tiếng Trung / Nhật / Hàn mỗi chữ rộng bằng cả cỡ chữ nên chỉ được ~18 chữ một
 * dòng — câu nào cũng gãy làm mấy khúc, đọc đối chiếu rất mệt.
 *
 * Bớt 2pt là đủ thoáng mà chưa mỏi mắt. Sàn 9pt để cỡ chữ nhỏ sẵn không bị bóp
 * thêm thành không đọc nổi: người đã chọn 9pt thì giữ nguyên 9pt.
 *
 * @param {number} fontSize cỡ chữ gốc, đơn vị nửa-point (24 = 12pt)
 * @returns {number} cỡ chữ cho bảng, cũng là nửa-point
 */
function twoColumnFontSize(fontSize) {
  const REDUCE = 4;   // 4 nửa-point = 2pt
  const FLOOR = 18;   // 18 nửa-point = 9pt
  const base = Number(fontSize) || 24;
  if (base <= FLOOR) return base;
  return Math.max(FLOOR, base - REDUCE);
}

/** Không viền: nhìn như hai cột văn bản, không như một cái bảng kế toán. */
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = {
  top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
  insideH: NO_BORDER, insideV: NO_BORDER,
};

/** Một vạch dọc mờ giữa hai cột, để mắt không đọc lẫn sang cột kia. */
const DIVIDER = { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' };

/**
 * @param {Array<{original: string, translation: string}>} sections cặp đoạn đã ghép
 * @param {object} opts
 * @param {(markdown: string) => Array} opts.renderMarkdown  markdown -> phần tử docx
 * @param {string} opts.font
 * @param {number} opts.fontSize  nửa-point (24 = 12pt)
 * @param {string} opts.sourceLabel  tiêu đề cột trái
 * @param {string} opts.targetLabel  tiêu đề cột phải
 * @returns {Table|null} null nếu không có gì để dựng
 */
function buildTwoColumnTable(sections, opts) {
  const { renderMarkdown, font, fontSize, sourceLabel, targetLabel } = opts;

  const usable = (sections || []).filter(
    sec => sec && (sec.original?.trim() || sec.translation?.trim())
  );
  if (usable.length === 0) return null;

  const rows = [headerRow(sourceLabel, targetLabel, font, fontSize)];

  for (const sec of usable) {
    rows.push(
      new TableRow({
        // KHÔNG đặt cantSplit: một đoạn dài hơn chiều cao trang mà cấm tách thì
        // Word đẩy cả hàng sang trang sau và cắt cụt phần thừa — mất chữ.
        children: [
          textCell(sec.original, { renderMarkdown, font, fontSize, divider: true }),
          textCell(sec.translation, { renderMarkdown, font, fontSize, divider: false }),
        ],
      })
    );
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    // FIXED: nếu để Word tự co giãn, một ô chứa URL dài sẽ kéo toác cột đó ra
    // và cột kia bị bóp lại còn vài ký tự mỗi dòng.
    layout: TableLayoutType.FIXED,
    columnWidths: [4680, 4680], // nửa–nửa, tính theo twip trên khổ A4 lề mặc định
    borders: NO_BORDERS,
    rows,
  });
}

/** Hàng tiêu đề, lặp lại ở đầu mỗi trang Word để biết cột nào là cột nào. */
function headerRow(sourceLabel, targetLabel, font, fontSize) {
  const cell = (text, divider) =>
    new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: {
        ...NO_BORDERS,
        bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF' },
        ...(divider ? { right: DIVIDER } : {}),
      },
      margins: { top: 40, bottom: 80, left: 100, right: 140 },
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold: true, font, size: Math.max(16, fontSize - 4), color: '555555' })],
        }),
      ],
    });

  return new TableRow({
    // Bảng dài tràn nhiều trang: tiêu đề tự in lại ở đầu mỗi trang.
    tableHeader: true,
    children: [cell(sourceLabel, true), cell(targetLabel, false)],
  });
}

/**
 * Một ô văn bản.
 *
 * Ô rỗng vẫn phải có đúng một Paragraph rỗng: bảng Word thiếu paragraph trong ô
 * là file hỏng, Word báo "nội dung không đọc được" khi mở.
 */
function textCell(markdown, { renderMarkdown, font, fontSize, divider }) {
  const text = (markdown || '').trim();
  let children = text ? renderMarkdown(text) : [];

  if (children.length === 0) {
    children = [new Paragraph({ children: [new TextRun({ text: '', font, size: fontSize })] })];
  }

  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    borders: divider ? { ...NO_BORDERS, right: DIVIDER } : NO_BORDERS,
    // Chừa mép phải rộng hơn mép trái để chữ hai cột không dính sát vạch ngăn.
    margins: { top: 60, bottom: 60, left: 100, right: 140 },
    children,
  });
}

/** Dòng ghi chú nhỏ đặt trên bảng, nhắc cách copy riêng từng cột. */
function buildCopyHint(font) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: 'Mẹo: rê chuột dọc theo một cột để bôi đen và copy riêng cột đó.',
        italics: true,
        color: '888888',
        font,
        size: 16,
      }),
    ],
  });
}

module.exports = { buildTwoColumnTable, buildCopyHint, twoColumnFontSize };
