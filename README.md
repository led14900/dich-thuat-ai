# AI Translate v1.2.12

AI Translate là ứng dụng desktop cho Windows giúp dịch thuật tự động các tài liệu PDF dựa trên công nghệ AI tiên tiến của Gemini Enterprise Agent Platform, Gemini API (Google AI Studio) và mọi endpoint OpenAI Compatible. Ứng dụng tập trung vào tốc độ và trải nghiệm người dùng: **giữ nguyên cấu trúc văn bản** (heading, bảng biểu, danh sách), tự động lưu lịch sử & thống kê chi phí, và không yêu cầu cài đặt rườm rà.

## 🚀 Tải bản mới nhất
Bản ổn định hiện tại: **v1.2.12**

📥 Tải trực tiếp:
- Bản portable không cần cài đặt: [Download AI Translate 1.2.12.exe](https://github.com/led14900/dich-thuat-ai/releases/download/v1.2.12/AI.Translate.1.2.12.exe)
- Bản cài đặt Setup: [Download AI Translate Setup 1.2.12.exe](https://github.com/led14900/dich-thuat-ai/releases/download/v1.2.12/AI.Translate.Setup.1.2.12.exe)

Hoặc vào trang Releases:
[https://github.com/led14900/dich-thuat-ai/releases/latest](https://github.com/led14900/dich-thuat-ai/releases/latest)

## ⚙️ Cách chạy
1. Tải `AI Translate 1.2.12.exe` nếu muốn dùng bản portable, hoặc `AI Translate Setup 1.2.12.exe` nếu muốn cài đặt.
2. 🖱️ Chạy trực tiếp file đã tải.
3. ⚠️ Lưu ý: Do ứng dụng chưa được đăng ký chứng chỉ số trả phí (chưa sign publisher), Windows Defender SmartScreen có thể hiện cảnh báo bảo mật khi mở lần đầu. Bạn chỉ cần chọn **More info → Run anyway** để sử dụng bình thường.

## 🔑 Hướng dẫn cấu hình API

### Lấy API Key của Google AI Studio (miễn phí)

1. Vào [aistudio.google.com/apikey](https://aistudio.google.com/apikey), đăng nhập bằng tài khoản Google.
2. Bấm **Create API key**. Cứ để Google tự tạo project mới nếu bạn chưa có.
3. Sao chép key vừa hiện ra — **chỉ hiện đầy đủ một lần**, mất thì phải tạo key khác.
4. Dán vào **Cài đặt → Gemini API → API Key** trong app.

Không cần thẻ tín dụng. Bù lại bị giới hạn số lượt gọi mỗi phút, nên nhớ chỉnh **Delay giữa các request** lên 5–12 giây.

> ⚠️ Từ tháng 6/2026 Google chặn các key không giới hạn phạm vi. Nếu ở trang key thấy nhãn *unrestricted*, bấm **Restrict to Gemini API** là xong.

### Lấy file JSON của Gemini Enterprise Agent Platform

Cách này trả phí theo mức dùng nhưng không bị nghẹt số lượt gọi, hợp với tài liệu dài.

1. Mở [Google Cloud Console](https://console.cloud.google.com/), chọn hoặc tạo một project.
2. Vào **APIs & Services → Enable APIs and Services**, bật **Agent Platform API**. Không tìm thấy thì gõ thẳng `aiplatform.googleapis.com` vào ô tìm kiếm — mã này không đổi, hoặc mở trực tiếp [trang bật API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com).
3. Vào **IAM & Admin → Service Accounts → Create service account**, đặt tên bất kỳ.
4. Cấp cho nó quyền **Agent Platform User** (mã `roles/aiplatform.user`). Chỉ cần từng đó, đừng cấp Owner.
5. Mở service account vừa tạo → thẻ **Keys** → **Add key → Create new key** → chọn **JSON** → **Create**. File `.json` sẽ tự tải về máy.
6. Trong app: **Cài đặt → Gemini Enterprise Agent Platform**, tải lên hoặc dán nội dung file JSON đó. Project ID tự điền, bạn chỉ cần chọn Region.

> 🔒 File JSON này là chìa khoá vào project Google Cloud của bạn. Đừng gửi qua chat, đừng commit lên Git. Lỡ lộ thì vào đúng trang **Keys** ở trên xoá key đó đi.

### Cấu hình trong ứng dụng

Ứng dụng hỗ trợ **3 phương thức xác thực**. Mở ứng dụng → **Cài đặt** → chọn nhà cung cấp AI phù hợp:

### Cách 1: Gemini Enterprise Agent Platform — Trả phí, không giới hạn
1. Chọn nhà cung cấp **Gemini Enterprise Agent Platform**.
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
4. Chọn model **nhận được ảnh (vision)** — app gửi từng trang PDF dưới dạng ảnh, model chỉ đọc văn bản sẽ không dịch được PDF.
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
- ⚙️ **Tùy biến cao:** Cài đặt Font chữ, DPI ảnh OCR, cỡ chữ, khổ giấy khi xuất Word. Chế độ dịch: **Song ngữ xen kẽ** (bản dịch ngay dưới bản gốc, in nghiêng màu xanh), **Song ngữ 2 cột** (gốc và dịch ngang hàng nhau, copy riêng từng cột được) hoặc **Bản dịch hoàn hảo** (chỉ bản dịch). Mỗi trang gốc là một trang Word riêng, chân trang ghi số trang gốc để đối chiếu.
- 🎨 **Giao diện hiện đại:** Thiết kế full-width sang trọng, hỗ trợ co giãn responsive tự động (2 cột màn hình rộng / 1 cột khi thu nhỏ), 100% tiếng Việt, rất dễ sử dụng.
- 📊 **Dashboard thống kê:** Biểu đồ chi phí và token tiêu thụ theo ngày/tháng/năm, phân tích theo model và ngôn ngữ đích.

## 📋 Changelog

### v1.2.12 — Song ngữ 2 cột và đúng số trang (2026-09-23)
- ✨ Thêm chế độ **Song ngữ 2 cột**: bản gốc và bản dịch nằm ngang hàng nhau trong bảng không viền, rê chuột dọc một cột là copy riêng được cột đó. Chữ trong bảng tự nhỏ hơn 2pt (sàn 9pt) vì mỗi cột chỉ rộng nửa trang — đỡ gãy dòng, nhất là với tiếng Trung / Nhật / Hàn. Xuất Markdown ở chế độ này ra bảng 2 cột, dán vào Excel / Google Sheets / Notion vẫn giữ 2 cột.
- ✨ Mỗi trang tài liệu gốc luôn bắt đầu ở một trang Word mới, không viết đè tiếp vào trang trước. Trang 1 dài 1,5 trang thì trang 2 vẫn mở ở trang Word mới.
- ✨ Chân mỗi trang Word ghi "Trang gốc N • Trang Word X/Y" để đối chiếu với bản gốc.
- 🐛 Tên biến kiểu `file_name_version` và chỉ số dưới trong công thức `$x_1$` không còn bị bẻ thành chữ nghiêng.
- 🐛 Ký tự được thoát bằng dấu chéo ngược nay hiện ra đúng ký tự đó, không còn giữ lại dấu chéo.
- 🐛 Ô bảng có chứa dấu sổ dọc không còn tách thành cột thừa làm lệch cả bảng.
- 🐛 Ô bảng in đậm / in nghiêng nay hiện đúng định dạng thay vì hiện thô dấu sao.
- 🐛 Ảnh trong bản dịch được nhận ra và ghi chú lại, không còn lọt nguyên cú pháp Markdown vào file Word.
- 🐛 Tải lại file Word từ Lịch sử: chân trang ghi đúng số trang gốc kể cả khi bản dịch có trang bị bỏ qua hay trang lỗi.
- 🐛 Bỏ đường kẻ ngang thừa ở cuối tài liệu.
- 🐛 Màn hình Giới thiệu hiện đúng số hiệu phiên bản đang chạy. Trước đây số này gõ tay vào giao diện nên bump phiên bản là quên sửa, bản 1.2.11 vẫn hiện "Phiên bản 1.2.10".
- ✨ README bổ sung hướng dẫn lấy API Key của Google AI Studio và cách tạo file JSON service account cho Gemini Enterprise Agent Platform.

### v1.2.10 — Điều chỉnh thống kê (2026-09-20)
- ✨ "Tổng tài liệu" đếm theo file, dịch lại cùng một file vẫn là một tài liệu. Thêm thẻ "Số lần dịch".
- 🐛 "Chạy tiếp" không còn cộng trùng số trang đã dịch.
- 🐛 Bấm "Thử lại" nay được tính vào token, chi phí và số trang.
- 🐛 Lần dịch có trang lỗi không còn hiện là hoàn tất; Lịch sử ghi rõ Xong một phần / Đã huỷ / Gián đoạn.
- 🐛 Bấm Huỷ không còn làm tụt tỉ lệ thành công.
- 🐛 Lịch sử và thống kê không mất khi máy tắt đột ngột lúc đang ghi.
- 🐛 Lần dịch bỏ dở quá 7 ngày được đưa vào Lịch sử trước khi dọn.
- 🧹 Xóa lịch sử nay xóa luôn phần thống kê của lần dịch đó. Xóa toàn bộ lịch sử là xóa sạch thống kê.
- 🐛 Dọn thống kê theo số ngày: báo rõ khi không có bản ghi nào đủ cũ, thay vì "Đã xóa 0 bản ghi".

### v1.2.09 — Chạy được tài liệu hàng nghìn trang (2026-09-20)
- 🐛 Sửa lỗi treo khi dịch tài liệu lớn: trang không nhận được phản hồi nay tự bỏ qua sau ít phút và tính là lỗi, bấm "Thử lại" để chạy lại trang đó.
- ⚡ Giảm mạnh bộ nhớ khi dịch: tài liệu hàng nghìn trang không còn làm máy ì.
- 🐛 Không mất tiến độ nếu app tắt ngay sau khi dịch xong: kết quả được giữ lại để "Chạy tiếp".
- 🐛 Tạm dừng có hiệu lực ngay, không gửi thêm trang nào nữa.
- 🐛 Thời gian còn lại hiển thị đúng hơn.
- 🐛 Đếm đúng số trang đã dịch khi bấm Hủy.
- ⚡ Giao diện không chậm dần trong lần chạy dài.
- ✨ Huỷ hoặc tắt app giữa chừng: phần đã dịch nay được lưu vào Lịch sử và đánh dấu "Chưa hoàn tất", xem lại và xuất file được ngay.
- 🧹 Xóa mục trong Lịch sử nay xóa luôn dữ liệu dở dang của lần dịch đó.
- 🐛 Mở lại file trong "File gần đây" sau khi khởi động lại app không còn báo "Đường dẫn không hợp lệ" với file nằm ngoài Documents / Downloads / Desktop.

### v1.2.08 — Hỗ trợ endpoint OpenAI Compatible (2026-09-20)
- ✨ Thêm nhà cung cấp thứ ba — OpenAI Compatible: dùng được với OpenAI, OpenRouter, Groq, DeepSeek, xAI (Grok), Mistral, Together, AI Render, và server chạy tại máy như Ollama / LM Studio / vLLM / LiteLLM.
- ⚙️ Cấu hình gồm Base URL (có sẵn preset), API Key (để trống được với server tại máy), và đơn giá để ước tính chi phí. Tự tải danh sách model, server nào không hỗ trợ thì tự nhập Model ID.
- 🐛 Sửa lỗi trang trả về trống mà không báo lỗi với một số endpoint.
- 🐛 Sửa lỗi OCR ra trống: ảnh trang nay được thu nhỏ trước khi gửi, nhẹ hơn khoảng 8 lần mà độ chính xác không đổi.
- 🐛 Trang bị cắt giữa chừng nay được giữ lại phần đã dịch kèm cảnh báo, thay vì mất trắng hoặc ghi vào kết quả như thể đã xong.
- 🐛 Không còn xóa trắng model khi bấm Lưu cài đặt trước lúc xác thực.
- 🧹 Bỏ tùy chọn "model hỗ trợ vision" — OCR luôn bật.
- 🔒 API Key của endpoint tùy chỉnh được mã hóa như các nhà cung cấp khác; vá một lỗi bảo mật ở trang Cài đặt và Dashboard.

### v1.2.05 — Sửa lỗi & Tối ưu (2026-06-10)
- 🐛 Sửa lỗi chờ gấp đôi thời gian delay đã cài đặt.
- 🐛 Bấm Hủy nay thoát ngay, không phải đợi hết thời gian chờ.
- 🐛 Ghi đúng model đang dùng vào lịch sử và khi kiểm tra kết nối.
- 🐛 Không còn ghi trùng bản ghi lịch sử khi đã hủy.
- 🔒 Vá một lỗi bảo mật ở trang Lịch sử.
- 🧹 Giảm bộ nhớ tích lũy giữa các lần chạy.

### v1.2.04 — Bản vá bảo mật (2026-06-10)
- 🔒 Vá các lỗi bảo mật ở trang Cài đặt và phần đọc file PDF.
- 🔒 Giới hạn quyền truy cập file theo thư mục an toàn.
- 🔒 Gemini API Key không còn xuất hiện trong URL, tránh lộ qua log mạng.
- 🧹 Dọn code không dùng đến.

### v1.2.03
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
