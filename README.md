# AI Translate v1.2.3

AI Translate là ứng dụng desktop cho Windows giúp dịch thuật tự động các tài liệu PDF dựa trên công nghệ AI tiên tiến của Gemini Enterprise Agent Platform và Gemini API (Google AI Studio). Ứng dụng tập trung vào tốc độ và trải nghiệm người dùng: giữ nguyên định dạng, tự động lưu lịch sử & thống kê chi phí, và không yêu cầu cài đặt rườm rà.

## 🚀 Tải bản mới nhất
Bản ổn định hiện tại: v1.2.3

📥 Tải trực tiếp:
- Bản portable không cần cài đặt: [Download AI Translate 1.2.3.exe](https://github.com/led14900/dich-thuat-ai/releases/download/v1.2.3/AI.Translate.1.2.3.exe)
- Bản cài đặt Setup: [Download AI Translate Setup 1.2.3.exe](https://github.com/led14900/dich-thuat-ai/releases/download/v1.2.3/AI.Translate.Setup.1.2.3.exe)

Hoặc vào trang Releases:
[https://github.com/led14900/dich-thuat-ai/releases/latest](https://github.com/led14900/dich-thuat-ai/releases/latest)

## ⚙️ Cách chạy
1. Tải `AI Translate 1.2.3.exe` nếu muốn dùng bản portable, hoặc `AI Translate Setup 1.2.3.exe` nếu muốn cài đặt.
2. 🖱️ Chạy trực tiếp file đã tải.
3. ⚠️ Lưu ý: Do ứng dụng chưa được đăng ký chứng chỉ số trả phí (chưa sign publisher), Windows Defender SmartScreen có thể hiện cảnh báo bảo mật khi mở lần đầu. Bạn chỉ cần chọn **More info -> Run anyway** để sử dụng bình thường.

## 🔑 Hướng dẫn cấu hình API
Ứng dụng hỗ trợ **2 phương thức xác thực**. Mở ứng dụng → **Cài đặt** → chọn nhà cung cấp AI phù hợp:

### Cách 1: Gemini Enterprise Agent Platform (Vertex AI) — Trả phí, không giới hạn
1. Chọn nhà cung cấp **Vertex AI**.
2. Tải lên hoặc dán nội dung file `Service Account JSON` của Google Cloud.
3. Project ID và Region sẽ tự động điền từ file JSON.
4. Nhấn **Xác thực** → chọn model → **Kiểm tra & Lưu cài đặt**.

### Cách 2: Gemini API (Google AI Studio) — Miễn phí, giới hạn RPM
1. Chọn nhà cung cấp **Gemini API**.
2. Nhập **API Key** lấy từ [Google AI Studio](https://aistudio.google.com/apikey).
3. Nhấn **Xác thực** → chọn model → **Kiểm tra & Lưu cài đặt**.
4. ⚠️ **Lưu ý bản Free:** Bị giới hạn số lượt gọi/phút (RPM) và lượt/ngày (RPD). Bạn **bắt buộc** phải chỉnh **"Delay giữa các request"** lên **5s–12s** ở phần Xử lý để tránh lỗi quá tải 429. Google có thể dùng dữ liệu dịch để huấn luyện mô hình — tránh dịch tài liệu nhạy cảm.

## ✨ Tính năng chính của AI Translate
- 📄 **Dịch thuật PDF chuyên nghiệp:** Kéo thả trực tiếp file PDF để tải lên và bắt đầu dịch.
- 🤖 **Tích hợp AI thông minh:** Phân tích chính xác ngữ cảnh, dịch thuật nhanh chóng và giữ nguyên cấu trúc văn bản. Hỗ trợ xác thực Service Account JSON trực quan, tự động báo lỗi cấu hình nhanh chóng.
- ⚡ **Tốc độ & Ổn định:** Xử lý song song nhiều trang, tự động quản lý Delay tránh lỗi API Rate Limit.
- 💾 **Tự động lưu Lịch sử & Thống kê:** Lưu thông tin dịch thuật (số trang, số token tiêu thụ, chi phí API ước tính) ngay khi quá trình dịch của các trang kết thúc. Bạn có thể theo dõi chi phí kể cả khi không lưu file.
- ⚡ **Tải chậm & Lưu trữ không giới hạn:** Hỗ trợ lưu trữ danh sách file gần đây trên Trang chủ và Lịch sử dịch thuật không giới hạn số lượng. Tích hợp cơ chế phân trang tải chậm (lazy load) tối ưu từ Main Process giúp truyền tải mượt mà và tiết kiệm RAM tối đa.
- 📂 **Lưu file & Xem trước linh hoạt:** Màn hình kết quả cho phép Xem trước bản dịch Markdown dạng chỉ đọc, Xuất Markdown (.md), hoặc xuất tài liệu Word (.docx) bất cứ lúc nào. Sau khi lưu, bạn có thể mở trực tiếp file Word hoặc thư mục chứa file từ màn hình kết quả hoặc trang Lịch sử.
- ⚙️ **Tùy biến cao:** Hỗ trợ cài đặt Font chữ khi xuất Word, DPI ảnh khi OCR, và chế độ dịch (Song ngữ xen kẽ / Chỉ bản dịch).
- 🎨 **Giao diện hiện đại:** Thiết kế full-width (rộng tối đa) sang trọng, hỗ trợ co giãn responsive tự động (hiển thị 2 cột trên màn hình rộng và 1 cột khi thu nhỏ cửa sổ), 100% tiếng Việt, rất dễ sử dụng.

## 👨‍💻 Tác giả & Liên hệ
- Tác giả: led14900
- SĐT / Zalo: 0896009111
- GitHub: [https://github.com/led14900](https://github.com/led14900)
- Báo lỗi / Góp ý: [https://github.com/led14900/dich-thuat-ai/issues](https://github.com/led14900/dich-thuat-ai/issues)

## 📄 Bản quyền
MIT License - AI Translate (c) 2026 led14900
