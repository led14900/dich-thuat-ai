/**
 * translate-output-mode.js
 *
 * Một chỗ duy nhất trả lời hai câu hỏi về chế độ dịch:
 *   - Có cần model trả về bản song ngữ không?
 *   - File Word phải dựng theo bố cục nào?
 *
 * Trước đây câu `settings.translateMode === 'bilingual' || settings.bilingual`
 * bị chép ở 5 chỗ (main.js, docx-generator, translate-controller, history-ui).
 * Thêm một chế độ mới là phải nhớ sửa đủ cả 5 — thiếu một chỗ thì model trả về
 * bản dịch trơn còn phần xuất file lại đi tìm đoạn gốc không có.
 */

/** Các chế độ hợp lệ của ô "Định dạng bản dịch". */
const MODES = {
  BILINGUAL: 'bilingual',     // gốc → dịch, xen kẽ theo đoạn
  TWO_COLUMN: 'two-column',   // bảng 2 cột: trái gốc, phải dịch
  CLEAN: 'clean',             // chỉ bản dịch
};

/**
 * Chế độ đang chọn, có xử lý cài đặt cũ.
 *
 * Bản trước 1.2.5 chỉ có cờ boolean `bilingual`, chưa có `translateMode`.
 * Người dùng nâng cấp mà chưa mở Cài đặt lần nào thì vẫn phải chạy đúng.
 */
function resolveMode(settings = {}) {
  const mode = settings.translateMode;
  if (mode === MODES.TWO_COLUMN || mode === MODES.CLEAN || mode === MODES.BILINGUAL) {
    return mode;
  }
  return settings.bilingual === false ? MODES.CLEAN : MODES.BILINGUAL;
}

/**
 * Có cần model trả về cặp gốc–dịch không?
 *
 * Cả chế độ xen kẽ lẫn 2 cột đều cần, vì cả hai đều phải đặt đoạn gốc cạnh
 * đoạn dịch tương ứng.
 */
function needsBilingualSections(settings = {}) {
  const mode = resolveMode(settings);
  return mode === MODES.BILINGUAL || mode === MODES.TWO_COLUMN;
}

/** Bố cục file Word: 'interleaved' | 'two-column' | 'clean'. */
function docxLayout(settings = {}) {
  const mode = resolveMode(settings);
  if (mode === MODES.TWO_COLUMN) return 'two-column';
  if (mode === MODES.CLEAN) return 'clean';
  return 'interleaved';
}

/** Tên hiển thị cho người dùng (dùng trong Lịch sử, thông báo). */
function modeLabel(settings = {}) {
  const labels = {
    [MODES.BILINGUAL]: 'Song ngữ xen kẽ',
    [MODES.TWO_COLUMN]: 'Song ngữ 2 cột',
    [MODES.CLEAN]: 'Chỉ bản dịch',
  };
  return labels[resolveMode(settings)];
}

module.exports = { MODES, resolveMode, needsBilingualSections, docxLayout, modeLabel };
