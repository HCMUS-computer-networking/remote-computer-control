# ĐÁNH GIÁ CHUYÊN SÂU: CÁC NÚT THẮT & RỦI RO CẤP DOANH NGHIỆP (ENTERPRISE LEVEL)

Mặc dù hệ thống đã hoàn thiện xuất sắc ở mức độ đồ án học thuật (10/10), nhưng khi soi xét dưới lăng kính của một hệ thống thương mại quy mô lớn (như TeamViewer, AnyDesk), mã nguồn hiện tại vẫn còn 5 "nút thắt" (bottlenecks) và rủi ro tiềm ẩn cần được giải quyết.

---

## 1. Rủi ro Chặn luồng (Event Loop Blocking) tại Gateway
* **Hiện trạng:** Trong `udpServer.js`, thuật toán phục hồi FEC sử dụng vòng lặp `for` lồng nhau để XOR từng byte của mảng Buffer bằng JavaScript thuần.
* **Vấn đề:** Node.js chạy trên kiến trúc đơn luồng (Single-threaded Event Loop). Việc ép Node.js tính toán mã hóa/XOR cho hàng chục khung hình mỗi giây sẽ khóa (block) Event Loop. Khi đó, Gateway không thể phản hồi các gói tin Ping/Pong (Heartbeat), dẫn đến việc toàn bộ hệ thống bị ngắt kết nối oan.
* **Tiêu chuẩn Enterprise:** Xử lý byte/mã hóa ở Gateway bắt buộc phải được đẩy ra một luồng khác bằng **Worker Threads**, hoặc viết bằng **C++ Addon (N-API) / WebAssembly (WASM)**.

## 2. Thiếu cơ chế Kiểm soát Nghẽn mạng (Congestion Control)
* **Hiện trạng:** Tại `ScreenTab/index.jsx`, Controller gửi lệnh bắt đầu stream với FPS và Quality cố định (24 FPS). Agent (`UdpStreamSender.cs`) sẽ liên tục bắn UDP các khung hình này lên mạng.
* **Vấn đề:** Nếu băng thông mạng của Agent đột ngột yếu đi, việc tiếp tục nhồi nhét gói tin UDP dung lượng lớn sẽ làm sập hẳn đường truyền.
* **Tiêu chuẩn Enterprise:** Cần có cơ chế **RTCP Feedback** (tương tự WebRTC). Gateway hoặc Controller phải tính toán tỷ lệ rớt gói (Packet Loss Rate) và báo ngược lại cho Agent để Agent tự động giảm Quality hoặc rớt xuống 15 FPS, 10 FPS (Adaptive Bitrate Streaming).

## 3. Mật mã học (Cryptography) chưa đạt chuẩn 2024
* **Hiện trạng:** 
  - Tại `E2EEStore.js`, thuật toán `PBKDF2` được dùng để băm Master Password với 100,000 vòng lặp.
  - Mã PIN (`e2ee_shared_secret`) của Agent đang được lưu cứng (hardcode) trong `config.json`.
  - Dùng ECDH sinh `SessionKey` một lần duy nhất.
* **Vấn đề & Tiêu chuẩn Enterprise:** 
  - Khuyến cáo OWASP 2024 yêu cầu PBKDF2-HMAC-SHA256 tối thiểu **600,000 vòng**, hoặc dùng **Argon2id**.
  - Không được hardcode mã PIN tĩnh dạng plain-text trên ổ cứng.
  - Cần áp dụng **Perfect Forward Secrecy (PFS)** bằng thuật toán **Double Ratchet** để liên tục xoay vòng khóa (rotate key) sau mỗi khung hình/tin nhắn, tránh việc lộ khóa sau này làm lộ toàn bộ dữ liệu quá khứ.

## 4. Bất cập trong Lập trình Hệ thống Windows (System Programming)
* **Hiện trạng:** 
  - `KeyloggerModule.cs` dùng Global Hook (`WH_KEYBOARD_LL`) và dùng khóa `lock (bufferLock)` bên trong callback.
  - `InputModule.cs` dùng `SendInput` để giả lập chuột/phím.
* **Vấn đề & Tiêu chuẩn Enterprise:** 
  - Hàm callback của Low-Level Hook nếu bị nghẽn (do chờ lock) sẽ làm **toàn bộ bàn phím của Windows bị lag/khựng**. Cần dùng cấu trúc không khóa (Lock-free data structures) như `ConcurrentQueue`.
  - Cơ chế UIPI của Windows sẽ block `SendInput` nếu màn hình đang hiện UAC (Run as Admin) hoặc Task Manager. Agent bắt buộc phải được ký chứng chỉ số (Digital Certificate) và cấu hình `uiAccess="true"`.

## 5. Kiến trúc Frontend (React) gây nghẽn UI (Rendering Bottleneck)
* **Hiện trạng:** Trong `FrameCanvas.jsx` và `ScreenTab/index.jsx`, khung hình từ Gateway gửi xuống được lưu vào Zustand Store (`useModuleStore`).
* **Vấn đề:** Với tốc độ 24 FPS, Store thay đổi 24 lần/giây. Điều này ép cây DOM của React phải tính toán render lại (Reconciliation) liên tục, đẩy CPU trình duyệt lên rất cao (30-50%).
* **Tiêu chuẩn Enterprise:** Luồng dữ liệu video **tuyệt đối không được đi qua State/Store của React**. Phải đẩy trực tiếp từ sự kiện `onmessage` của WebSocket thẳng vào `<canvas>` thông qua `useRef` và `requestAnimationFrame`.

---
*Tài liệu này tổng hợp các rủi ro hệ thống ở quy mô lớn, được sử dụng làm cơ sở định hướng phát triển (Future Works) cho phiên bản thương mại của sản phẩm.*
"""
