# AI Translate v1.2.8

AI Translate là ứng dụng desktop cho Windows giúp dịch thuật tự động các tài liệu PDF dựa trên công nghệ AI tiên tiến của Gemini Enterprise Agent Platform, Gemini API (Google AI Studio) và mọi endpoint OpenAI Compatible. Ứng dụng tập trung vào tốc độ và trải nghiệm người dùng: **giữ nguyên cấu trúc văn bản** (heading, bảng biểu, danh sách), tự động lưu lịch sử & thống kê chi phí, và không yêu cầu cài đặt rườm rà.

## 🚀 Tải bản mới nhất
Bản ổn định hiện tại: **v1.2.8**

📥 Tải trực tiếp:
- Bản portable không cần cài đặt: [Download AI Translate 1.2.8.exe](https://github.com/led14900/dich-thuat-ai/releases/download/v1.2.8/AI.Translate.1.2.8.exe)
- Bản cài đặt Setup: [Download AI Translate Setup 1.2.8.exe](https://github.com/led14900/dich-thuat-ai/releases/download/v1.2.8/AI.Translate.Setup.1.2.8.exe)

Hoặc vào trang Releases:
[https://github.com/led14900/dich-thuat-ai/releases/latest](https://github.com/led14900/dich-thuat-ai/releases/latest)

## ⚙️ Cách chạy
1. Tải `AI Translate 1.2.8.exe` nếu muốn dùng bản portable, hoặc `AI Translate Setup 1.2.8.exe` nếu muốn cài đặt.
2. 🖱️ Chạy trực tiếp file đã tải.
3. ⚠️ Lưu ý: Do ứng dụng chưa được đăng ký chứng chỉ số trả phí (chưa sign publisher), Windows Defender SmartScreen có thể hiện cảnh báo bảo mật khi mở lần đầu. Bạn chỉ cần chọn **More info → Run anyway** để sử dụng bình thường.

## 🔑 Hướng dẫn cấu hình API
Ứng dụng hỗ trợ **3 phương thức xác thực**. Mở ứng dụng → **Cài đặt** → chọn nhà cung cấp AI phù hợp:

### Cách 1: Gemini Enterprise Agent Platform (Vertex AI) — Trả phí, không giới hạn
1. Chọn nhà cung cấp **Vertex AI**.
2. Tải lên hoặc dán nội dung file `Service Account JSON` của Google Cloud.
3. Project ID sẽ tự động điền từ file JSON — chọn Region phù hợp.
4. Nhấn **Xác thực** → chọn model → **Kiểm tra & Lưu cài đặt**.

### Cách 2: Gemini API (Google AI Studio) — Miễn phí, giới hạn RPM
1. Chọn nhà cung cấp **Gemini API**.
2. Nhập **API Key** lấy từ [Google AI Studio](https://aistudio.google.com/apikey).
3. Nhấn **Xác thực** → chọn model → **Kiểm tra & Lưu cài đặt**.
4. ⚠️ **Lưu ý bản Free:** Bị giới hạn số lượt gọi/phút (RPM) và lượt/ngày (RPD). Bạn **bắt buộc** phải chỉnh **"Delay giữa các request"** lên **5s–12s** ở phần Xử lý để tránh lỗi quá tải 429. Google có thể dùng dữ liệu dịch để huấn luyện mô hình — tránh dịch tài liệu nhạy cảm.

### Cách 3: OpenAI Compatible — Dùng endpoint bất kỳ theo chuẩn OpenAI
Dùng được với AI Render, OpenAI, OpenRouter, Groq, DeepSeek, xAI (Grok), Mistral, Together, hoặc server chạy máy local như Ollama / LM Studio / vLLM / LiteLLM.

1. Chọn nhà cung cấp **OpenAI Compatible**.
2. Nhập **Base URL** — phần gốc của endpoint, thường kết thúc bằng `/v1` (ví dụ `https://api.airender.vn/v1`). Có sẵn danh sách preset để chọn nhanh; dán nhầm cả đuôi `/chat/completions` thì app tự cắt.
3. Nhập **API Key** (gửi qua header `Authorization: Bearer`). Để trống nếu server local không yêu cầu key.
4. Bật **"Model hỗ trợ ảnh (vision)"** nếu muốn dịch file PDF — app gửi từng trang dưới dạng ảnh PNG nên model bắt buộc phải nhận ảnh. Model chỉ-văn-bản vẫn dùng được cho chức năng dịch text.
5. (Tùy chọn) Nhập đơn giá **input/output (USD / 1M tokens)** để trang Thống kê ước tính chi phí. Để 0 nếu không cần.
6. Nhấn **Xác thực** → chọn model → **Kiểm tra & Lưu cài đặt**. Server không hỗ trợ `GET /models` thì chọn **"✍️ Tự nhập Model ID"**.
7. ⚠️ Endpoint bắt buộc phải hỗ trợ **streaming SSE** (`"stream": true`). Dữ liệu dịch sẽ được gửi tới nhà cung cấp bạn cấu hình — cân nhắc với tài liệu nhạy cảm.

Ví dụ kiểm tra nhanh endpoint bằng curl trước khi cấu hình trong app:

```bash
curl https://api.airender.vn/v1/chat/completions -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"model":"gpt-5.6-luna","messages":[{"role":"user","content":"Xin chào"}]}'
```

## ✨ Tính năng chính của AI Translate
- 📄 **Dịch thuật PDF chuyên nghiệp:** Kéo thả trực tiếp file PDF để tải lên và bắt đầu dịch.
- 🤖 **Tích hợp AI thông minh:** Phân tích ngữ cảnh, dịch thuật nhanh chóng và **giữ nguyên định dạng văn bản** (heading, bảng biểu, danh sách có thứ tự, in đậm, in nghiêng). Hỗ trợ 17 template prompt chuyên ngành (Y khoa, Pháp lý, Khoa học, Logistics, ...).
- ⚡ **Tốc độ & Ổn định:** Xử lý song song nhiều trang, tự động quản lý Delay tránh lỗi API Rate Limit. Nút Tạm dừng / Tiếp tục không làm gián đoạn các trang đang xử lý.
- 💾 **Tự động lưu Lịch sử & Thống kê:** Lưu thông tin dịch thuật (số trang, số token tiêu thụ, chi phí API ước tính) ngay khi quá trình dịch của các trang kết thúc — kể cả khi hủy giữa chừng, chi phí token đã dùng vẫn được tính.
- ⚡ **Tải chậm & Lưu trữ không giới hạn:** Hỗ trợ lưu trữ danh sách file gần đây trên Trang chủ và Lịch sử dịch thuật không giới hạn số lượng. Tích hợp cơ chế phân trang tải chậm (lazy load) tối ưu từ Main Process giúp truyền tải mượt mà và tiết kiệm RAM tối đa.
- 📂 **Lưu file & Xem trước linh hoạt:** Màn hình kết quả cho phép Xem trước bản dịch Markdown dạng chỉ đọc, Xuất Markdown (.md), hoặc xuất tài liệu Word (.docx). Sau khi lưu, bạn có thể mở trực tiếp file Word hoặc thư mục chứa file. Lịch sử dịch thuật cũng cho phép tải lại file Word hoặc xem lại bản dịch Markdown bất kỳ lúc nào.
- ⚙️ **Tùy biến cao:** Cài đặt Font chữ, DPI ảnh OCR, cỡ chữ, khổ giấy khi xuất Word. Chế độ dịch: **Song ngữ xen kẽ** (giữ nguyên văn bản gốc, bản dịch ngay bên dưới in nghiêng màu xanh) hoặc **Bản dịch hoàn hảo** (chỉ bản dịch, không có văn bản gốc).
- 🎨 **Giao diện hiện đại:** Thiết kế full-width sang trọng, hỗ trợ co giãn responsive tự động (2 cột màn hình rộng / 1 cột khi thu nhỏ), 100% tiếng Việt, rất dễ sử dụng.
- 📊 **Dashboard thống kê:** Biểu đồ chi phí và token tiêu thụ theo ngày/tháng/năm, phân tích theo model và ngôn ngữ đích.

## 📋 Changelog

### v1.2.8 — Hỗ trợ endpoint OpenAI Compatible (2026-09-20)
- ✨ **Nhà cung cấp mới — OpenAI Compatible:** Thêm lựa chọn nhà cung cấp thứ ba, dùng được với mọi endpoint nói chuẩn `/v1/chat/completions`: AI Render, OpenAI, OpenRouter, Groq, DeepSeek, xAI (Grok), Mistral, Together, cùng các server local như Ollama / LM Studio / vLLM / LiteLLM.
- ⚙️ **Cấu hình linh hoạt:** Base URL (có preset chọn nhanh, tự cắt đuôi `/chat/completions` nếu dán nhầm), API Key gửi qua header `Authorization: Bearer` (để trống được với server local), cờ hỗ trợ ảnh (vision) và đơn giá input/output để ước tính chi phí.
- 🔌 **Tự động tương thích:** Tải danh sách model qua `GET /models`; server không hỗ trợ thì vẫn cho tự nhập Model ID. Nếu endpoint từ chối các tham số tùy chọn (`temperature`, `max_tokens`, `stream_options`, `top_p`), app tự động thử lại sau khi lược bỏ thay vì báo lỗi.
- 🐛 **Sửa lỗi trích xuất PDF ra trống (không báo lỗi):** Bộ đọc SSE trước đây chỉ xử lý dữ liệu khi gặp **dòng trống ngăn cách** giữa các event. Gemini luôn gửi dòng trống nên không lộ, nhưng nhiều gateway OpenAI-compatible gửi các dòng `data:` liền nhau — app dồn hết thành một chuỗi, `JSON.parse` thất bại và lỗi bị nuốt trong `catch` rỗng, khiến trang trả về **rỗng mà không báo lỗi**. Nay payload được flush ngay khi đã là JSON hoàn chỉnh. Đồng thời thêm nhánh xử lý cho server phớt lờ `stream: true` và trả JSON thường (cũng gây ra trống y hệt).
- 🔒 **Bảo mật:** API Key của endpoint tùy chỉnh được mã hóa bằng `safeStorage` như các provider khác.
- 🔒 **Sửa lỗi XSS (mức cao):** Model ID trả về từ endpoint tùy chỉnh (`GET /models`) trước đây được nhét thẳng vào `innerHTML` ở trang Cài đặt và bảng thống kê Dashboard. Một endpoint độc hại có thể chèn mã chạy trong renderer. Toàn bộ giá trị này giờ được escape qua helper dùng chung `UIManager.escapeHtml`.
- 🐛 **Không còn xoá trắng model khi lưu:** Bấm "Lưu cài đặt" trước khi Xác thực (lúc dropdown model chưa được tải) trước đây ghi đè model đang dùng thành rỗng, làm hỏng cấu hình đang chạy. Giờ tự động giữ lại model đã lưu của nhà cung cấp đó.
- 🐛 **Không báo lỗi kết nối sai:** Bước "Kiểm tra kết nối" trước đây gọi thẳng `fetch` nên bỏ qua cơ chế tự lược bỏ tham số — model từ chối `max_tokens` (thường gặp ở model reasoning) bị báo nhầm là sai cấu hình.
- 🐛 **Thống kê đúng model khi hủy:** Hủy dịch giữa chừng trước đây ghi `model` toàn cục có thể đã lỗi thời, gây gán nhầm chi phí cho nhà cung cấp khác.
- 🧹 **Tái cấu trúc:** Tách định dạng request/response của từng provider thành hook riêng trong `BaseProvider`; gom logic xác định provider/model đang dùng vào `renderer/js/provider-utils.js`; gộp khối HTML "Bước 1 / Bước 2" bị lặp 3 lần trong trang Cài đặt.

### v1.2.5 — Sửa lỗi & Tối ưu (2026-06-10)
- 🐛 **Sửa lỗi trễ kép (BUG-03):** `requestDelaySec` trước đây bị áp dụng 2 lần (trước mỗi trang và trong bước dịch), dẫn đến chờ gấp đôi thời gian cài đặt. Giờ chỉ áp dụng 1 lần giữa các request.
- 🐛 **Hủy dịch tức thì (BUG-05):** Lệnh `sleep()` trong quá trình chờ giữa các trang giờ nhận biết tín hiệu hủy — bấm Hủy bây giờ thoát ngay lập tức thay vì phải đợi hết thời gian delay (có thể lên tới 60 giây).
- 🐛 **Sửa lỗi model không đồng bộ (BUG-06):** Khi kiểm tra kết nối AI trước khi dịch và khi lưu lịch sử, ứng dụng giờ dùng model đúng theo nhà cung cấp (Vertex AI / Gemini API) thay vì trường `model` toàn cục có thể đã lỗi thời.
- 🐛 **Ngăn ghi lịch sử đúp (BUG-02):** Thêm guard check để history.add không được gọi nếu conversion đã bị hủy.
- 🔒 **Sửa lỗi XSS tiềm ẩn (BUG-04):** `outputPath` trong trang Lịch sử giờ được escape HTML trước khi inject vào DOM.
- 🧹 **Tối ưu bộ nhớ:** `pageOutputs` giờ được xóa sạch hoàn toàn giữa các lần chạy để tránh memory leak tích lũy.

### v1.2.4 — Bản vá bảo mật (2026-06-10)
- 🔒 **Bảo mật:** Sửa lỗi XSS tiềm ẩn trong trang Settings — credentials không còn được nhúng trực tiếp vào HTML
- 🔒 **Bảo mật:** Bật lại `webSecurity` (Same-Origin Policy) cho renderer — thay thế bằng custom protocol an toàn hơn để tải PDF.js
- 🔒 **Bảo mật:** Tăng cường kiểm tra path traversal — giới hạn truy cập file theo thư mục an toàn
- 🔒 **Bảo mật (Gemini API):** API Key giờ được gửi qua header `x-goog-api-key` thay vì URL query string — tránh lộ key trong logs/network
- 🧹 **Dọn dẹp:** Xóa dead code không được dùng trong engine

### v1.2.3
- Thêm nhà cung cấp Gemini API (Google AI Studio) hỗ trợ bản miễn phí
- Thêm 16 template prompt chuyên ngành (Y khoa, Pháp lý, Khoa học, Tài chính, ...)
- Dashboard thống kê token & chi phí theo ngày/tháng/năm
- Hỗ trợ xuất Markdown trực tiếp từ màn hình kết quả

## 👨‍💻 Tác giả & Liên hệ
- Tác giả: led14900
- SĐT / Zalo: 0896009111
- GitHub: [https://github.com/led14900](https://github.com/led14900)
- Báo lỗi / Góp ý: [https://github.com/led14900/dich-thuat-ai/issues](https://github.com/led14900/dich-thuat-ai/issues)

## 📄 Bản quyền
MIT License - AI Translate (c) 2026 led14900
