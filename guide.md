# Hướng Dẫn Thử Nghiệm Hệ Thống Điều Khiển Máy Tính Từ Xa (Remote Computer Control)

Tài liệu này hướng dẫn chi tiết từng bước thiết lập môi trường, triển khai và kiểm thử hệ thống trong mạng LAN thực tế hoặc giữa hai máy tính độc lập.

---

## 1. Kiến Trúc Mạng & Phân Vùng Hệ Thống

Hệ thống bao gồm 3 thành phần chính:
- **Controller (React Frontend)**: Giao diện điều khiển chạy trên trình duyệt Web.
- **Gateway (Node.js Proxy & FEC Server)**: Máy chủ trung gian điều phối lệnh WebSocket và nhận luồng UDP mã hóa.
- **Agent (C# Windows Service / Executable)**: Tiến trình dịch vụ chạy trên máy target bị điều khiển.

### Mô Hình Thử Nghiệm (2 Máy Tính trong Mạng LAN)
- **Máy B (Operator / Gateway PC)**: Chạy **Gateway** (Node.js) và **Controller** (React).
- **Máy A (Target PC)**: Chạy **Agent** (C# .NET 8).

---

## 2. Các Bước Thử Nghiệm Chi Tiết

### Bước 1: Lấy Địa Chỉ IP Mạng LAN của Máy B (Gateway PC)
1. Trên **Máy B**, mở **PowerShell** hoặc **Command Prompt**.
2. Chạy lệnh:
   ```cmd
   ipconfig
   ```
3. Ghi lại địa chỉ **IPv4 Address** (Ví dụ: `192.168.1.150`).

---

### Bước 2: Khởi Chạy Gateway & Controller (Tại Máy B)

#### 1. Khởi chạy Gateway:
Mở Terminal tại thư mục gốc dự án:
```bash
cd gateway
npm install
npm run dev
```
* **Cổng mặc định**: 
  - TCP WebSocket: `8080`
  - UDP Stream: `9000`
* *Lưu ý: Đảm bảo Windows Firewall cho phép ứng dụng Node.js nhận dữ liệu trên Port 8080 và 9000.*

#### 2. Khởi chạy Controller (Admin Dashboard):
Mở một Terminal mới:
```bash
cd controller
npm install
npm run dev
```
* Mở trình duyệt Web tại máy B (hoặc bất kỳ máy nào cùng LAN) truy cập: `http://localhost:5173` (hoặc IP của máy B).

---

### Bước 3: Cấu Hình & Khởi Chạy Agent (Tại Máy A - Target PC)

1. Mở file cấu hình `agent/config.json` (hoặc tạo mới cạnh file `agent.exe` nếu đã build):
   ```json
   {
     "agent_id": "AUTO",
     "gateway_url": "ws://192.168.1.150:8080",
     "auth_key": "agent-secret-key-2024",
     "app_whitelist": ["notepad", "calc", "chrome", "winword"],
     "sandbox_root_path": "C:\\AgentSandbox\\",
     "log_retention_days": 7,
     "consent_timeout_ms": 30000,
     "tray_password": ""
   }
   ```
   *(Thay `192.168.1.150` bằng IPv4 thực tế của Máy B. Lưu ý: Mã PIN E2EE được sinh động ngẫu nhiên trên RAM và bảo vệ bằng Windows DPAPI `ProtectedData`, không còn lưu dưới dạng plain-text trên đĩa).*

2. Khởi chạy Agent:
   - Chạy trực tiếp `agent.exe` bằng cách nhấn phải chuột chọn **Run as Administrator** (để test các quyền điều khiển hệ thống, UAC, và Keylogger).

---

### Bước 4: Thao Tác Kiểm Thử Chức Năng (End-to-End Verification)

#### A. Kiểm tra Bắt tay Mã hóa E2EE (Handshake)
1. Trên giao diện Web Controller, bạn sẽ thấy Agent của Máy A xuất hiện trong danh sách kết nối.
2. Nhập mã PIN (Mặc định: `default-pin-12345`).
3. Kiểm tra thông báo Toast thành công: `E2EE Handshake successful`.
4. Mọi dữ liệu lệnh điều khiển từ lúc này đều được mã hóa AES-256-GCM bảo mật tuyệt đối.

#### B. Kiểm tra Điều khiển Lệnh (TCP Channels)
1. **Application Manager**: Xem danh sách ứng dụng, chạy/tắt thử `calc.exe` hoặc `notepad.exe`.
2. **Process Manager**: Xem danh sách tiến trình hệ thống, kiểm tra tính năng kill process.
3. **File Explorer**: Duyệt file/thư mục được phép trong `SandboxPath`, tải xuống/tải lên file.
4. **Keylogger**: Bật theo dõi bàn phím và gõ phím trên Máy A để kiểm tra dữ liệu real-time.

#### C. Kiểm tra Luồng Streaming & PFS Key Ratchet (UDP Stream)
1. Mở tab **Live Screen** hoặc **Webcam**.
2. **Kiểm tra hình ảnh**: Hình ảnh hiển thị trực tiếp với độ trễ thấp (<50ms).
3. **Kiểm tra Forward Secrecy (Symmetric Ratchet)**: 
   - Khóa phiên UDP tự động tiến hóa sau mỗi 100 khung hình (`Key_i+1 = SHA256(Key_i + "Ratchet_v1")`).
   - Màn hình tiếp tục mượt mà mà không gặp sự cố giải mã.
4. **Kiểm tra Multi-thread FEC Worker**:
   - Nếu có hiện tượng rơi gói tin UDP trên mạng LAN, Gateway sẽ tự động đẩy mảng dữ liệu XOR sang **Worker Thread Pool** (`fecWorker.js`) để khôi phục khung hình mà không làm lag Main Thread.
