const fs = require('fs/promises');
const path = require('path');

/**
 * Đọc/ghi một file JSON sao cho mất điện giữa chừng không xoá sạch dữ liệu.
 *
 * Trước đây lịch sử và thống kê ghi thẳng đè lên file chính. Tiến trình chết
 * sau khi file đã bị cắt về 0 byte nhưng chưa ghi xong để lại một file JSON
 * rách; lần đọc sau bắt lỗi parse rồi trả về mảng rỗng, và lần ghi tiếp theo
 * đè nốt phần còn lại. Toàn bộ lịch sử biến mất mà không báo gì.
 *
 * Nên: ghi ra file tạm cùng thư mục rồi rename đè lên file chính (rename trên
 * cùng ổ đĩa là thao tác nguyên tử), và giữ lại bản trước đó làm phao cứu sinh.
 */

/** Ghi nguyên tử. Ném lỗi thay vì nuốt, để nơi gọi biết mà đừng xoá checkpoint. */
async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  const backup = `${filePath}.bak`;

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');

  // Bản cũ thành phao trước khi bị thay. Không có file cũ thì bỏ qua.
  try {
    await fs.copyFile(filePath, backup);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Không tạo được bản sao dự phòng:', err.message);
  }

  await fs.rename(tmp, filePath);
}

/**
 * Đọc JSON, tự quay về bản dự phòng nếu file chính hỏng.
 * File chưa tồn tại trả về `fallback` — đó là trạng thái bình thường lần đầu chạy.
 */
async function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;

    console.error(`File ${path.basename(filePath)} hỏng, thử bản dự phòng:`, err.message);
    try {
      return JSON.parse(await fs.readFile(`${filePath}.bak`, 'utf8'));
    } catch {
      return fallback;
    }
  }
}

/**
 * Xếp hàng các thao tác đọc-sửa-ghi để chúng không giẫm lên nhau.
 *
 * Hai lời gọi addRecord đồng thời đều đọc cùng một ảnh chụp, mỗi bên thêm bản
 * ghi của mình rồi bên ghi sau xoá mất bản ghi của bên kia. Xếp hàng tuần tự
 * là đủ cho quy mô này — vài chục thao tác mỗi lần dịch.
 */
class SerialQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(task) {
    const result = this.tail.then(task, task);
    // Nhánh hàng đợi nuốt lỗi để một thao tác hỏng không chặn các thao tác sau;
    // lỗi thật vẫn nổi lên qua `result` mà nơi gọi nhận được.
    this.tail = result.then(() => { }, () => { });
    return result;
  }
}

/**
 * Khoá nhận diện tài liệu: cùng đường dẫn là cùng một tài liệu, dù dịch lại
 * bao nhiêu lần. Windows không phân biệt hoa thường nên hạ hết về chữ thường,
 * và thống nhất dấu phân cách để "D:/a.pdf" với "D:\a.pdf" không thành hai.
 */
function documentKeyFor(filePath) {
  if (!filePath) return null;
  try {
    return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  } catch {
    return null;
  }
}

module.exports = { writeJsonAtomic, readJsonSafe, SerialQueue, documentKeyFor };
