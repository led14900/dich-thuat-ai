/**
 * markdown-two-column-export.js
 *
 * Đổi bản dịch song ngữ thành bảng Markdown 2 cột khi xuất file .md.
 *
 * Vì sao không đụng vào buildFullMarkdown: chuỗi markdown đó còn được lưu vào
 * Lịch sử và checkpoint, rồi đọc ngược lại để dựng file Word. Đổi định dạng của
 * nó là mọi mục lịch sử cũ hết đọc được. Hàm này chỉ chạy đúng lúc bấm "Xuất
 * Markdown", không ảnh hưởng dữ liệu đã lưu.
 *
 * Bảng Markdown dán thẳng vào Excel, Google Sheets hay Notion vẫn ra 2 cột.
 */
window.MarkdownTwoColumnExport = (() => {

  /**
   * @param {Array<{page, bilingualSections, markdown, skipped, error}>} results
   * @param {string} targetLang tên cột phải
   * @returns {string} markdown có bảng 2 cột, mỗi trang gốc một bảng
   */
  function build(results, targetLang) {
    const out = [];

    for (const r of results || []) {
      if (r.skipped || r.error) continue;

      const sections = (r.bilingualSections || []).filter(
        sec => sec && (sec.original?.trim() || sec.translation?.trim())
      );

      out.push(`## Trang ${r.page}\n`);

      if (sections.length === 0) {
        // Trang không có cặp gốc–dịch (chế độ chỉ bản dịch, hoặc model trả về
        // sai cấu trúc): ghi thẳng, thà mất bố cục còn hơn mất nội dung.
        out.push(`${(r.markdown || '').trim()}\n`);
        continue;
      }

      out.push(`| Bản gốc | ${escapeCell(targetLang || 'Bản dịch')} |`);
      out.push('| --- | --- |');
      for (const sec of sections) {
        out.push(`| ${escapeCell(sec.original)} | ${escapeCell(sec.translation)} |`);
      }
      out.push('');
    }

    return out.join('\n').trim();
  }

  /**
   * Một ô bảng Markdown phải nằm gọn trên một dòng.
   *
   * Xuống dòng thật sẽ cắt bảng làm đôi, còn dấu `|` trong nội dung sẽ tạo thêm
   * cột ma khiến các hàng lệch nhau.
   */
  function escapeCell(text) {
    return (text || '')
      .replace(/\|/g, '\\|')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{2,}/g, '<br><br>')
      .replace(/\n/g, '<br>')
      .trim();
  }

  return { build, escapeCell };
})();
