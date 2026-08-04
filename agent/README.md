# Agent System - Computer Management System

## 1. Tổng quan
Agent là phần mềm chạy trên nền tảng Windows (C# .NET 8), đóng vai trò như một client bị giám sát trong hệ thống Computer Management System (kiến trúc 3-Tier: Controller - Gateway - Agent).
Agent hoạt động ẩn dưới System Tray, nhận lệnh từ Controller thông qua WebSockets (Gateway) và thực thi các thao tác hệ thống cục bộ trên máy được cài đặt.

## 2. Tính năng chính
- **Quản lý Ứng dụng & Tiến trình**: Xem danh sách, tắt/buộc dừng tiến trình, đo hiệu suất CPU/RAM theo thời gian thực (Delta CPU Time).
- **Giám sát Màn hình**: Truyền phát màn hình (Live Stream) siêu nhẹ với thuật toán **Software Bounding Box Delta Encoding**.
- **Điều khiển Từ xa**: Can thiệp bằng cách tiêm sự kiện chuột và phím từ xa qua Win32 API (`user32.dll`).
- **Quản lý Tệp tin**: Tải/Lưu file kích thước lớn tốc độ cao qua giao thức **WebSocket Binary Frame** (chunking + băm SHA-256). Tích hợp cơ chế Sandbox bảo vệ.
- **Keylogger & Webcam**: Ghi nhận thao tác bàn phím, stream hình ảnh camera. Bắt buộc có cơ chế cảnh báo trong suốt (Visual Transparency) để người dùng nhận biết khi camera bị truy cập.
- **Kiểm soát Truy cập (Security)**: Cơ chế Sandbox & Whitelist được cập nhật nóng (Dynamic Policy trên RAM). Mọi hành động nhạy cảm đều yêu cầu người dùng xác nhận thông qua Hộp thoại Consent (30s timeout).

## 3. Cấu trúc Thư mục & Kiến trúc (Architecture)
Dự án sử dụng cơ chế Dependency Injection (`Microsoft.Extensions.DependencyInjection`).
- `Core/`: Chứa các kết nối mạng `AgentClient`, `WebSocketClient`, và bộ định tuyến `MessageDispatcher`.
- `Modules/`: Các phân hệ xử lý tính năng độc lập (VD: `AppModule`, `StreamModule`, `FileModule`, `InputModule`,...). Các module kế thừa từ `BaseModule`.
- `Managers/`: Chứa các bộ quản lý Singleton (`SecurityManager`, `UIManager`, `ConfigManager`).
- `Forms/`: Các giao diện Windows Forms (`TrayApp` cho icon khay hệ thống, Form xác nhận Consent, Form mật khẩu).

## 4. Hướng dẫn Cài đặt & Chạy
### Yêu cầu Hệ thống
- Hệ điều hành: Windows.
- Runtime: .NET 8.0 SDK.

### Biên dịch & Chạy
1. Mở thư mục `agent/` trong terminal hoặc Visual Studio.
2. Kiểm tra file cấu hình `config.json` (mặc định `agent_id` là `"AUTO"` để tự động lấy tên máy + MAC).
3. Biên dịch và chạy bằng dòng lệnh:
   ```bash
   dotnet build
   dotnet run
   ```
4. Trong lần đầu tiên chạy, nếu `gateway_url` không hợp lệ, Agent sẽ hiển thị hộp thoại yêu cầu cấu hình **Gateway URL**. Sau khi nhập thành công, Agent sẽ tự động thu nhỏ xuống System Tray và hoạt động ngầm.