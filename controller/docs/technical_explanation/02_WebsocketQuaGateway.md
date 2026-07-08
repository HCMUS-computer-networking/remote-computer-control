# 2. Lý do Controller kết nối Agent thông qua Gateway bằng WebSocket

## Giới hạn của trình duyệt

Trình duyệt web hoạt động trong môi trường sandbox và **không cho phép mở kết nối TCP thô** (raw TCP socket) đến máy tùy ý. Đây là ràng buộc bảo mật của nền tảng web, không thể bỏ qua. Do đó, Controller không thể kết nối trực tiếp đến Agent (chạy trên Windows) bằng TCP thuần túy.

## Tại sao dùng WebSocket thay vì HTTP polling

HTTP polling (gửi request định kỳ để hỏi có dữ liệu mới không) là giải pháp thay thế đơn giản, nhưng có hai vấn đề chính trong ngữ cảnh này:

- **Độ trễ**: Dữ liệu chỉ được lấy tại các khoảng thời gian cố định, không theo thời gian thực.
- **Lãng phí tài nguyên**: Mỗi request HTTP mang overhead header lớn; với tần suất polling cao (để giảm độ trễ), tổng lưu lượng tăng đáng kể dù phần lớn response là rỗng.

WebSocket thiết lập một kết nối TCP duy nhất và **giữ kết nối mở** (persistent connection). Sau khi bắt tay HTTP Upgrade, cả hai phía đều có thể gửi dữ liệu bất kỳ lúc nào mà không cần khởi tạo request mới (full-duplex). Điều này phù hợp với mô hình đẩy dữ liệu (server push) của hệ thống: Agent chủ động gửi khung ảnh, sự kiện bàn phím, kết quả lệnh về Controller ngay khi có.

## Vai trò của Gateway

Agent chạy trên mạng nội bộ (LAN) của máy thực nghiệm và không có địa chỉ IP công khai. Gateway đóng vai trò **relay trung gian**: Agent kết nối ra Gateway qua WebSocket, Controller cũng kết nối vào Gateway qua WebSocket, và Gateway định tuyến thông điệp giữa hai phía theo `agent_id`. Mô hình này cũng cho phép Controller quản lý nhiều Agent cùng lúc mà không cần biết địa chỉ IP của từng Agent.

## Đánh đổi

WebSocket yêu cầu duy trì kết nối liên tục, nên cần xử lý reconnect khi mạng không ổn định. Ngoài ra, toàn bộ thông điệp đi qua Gateway tạo thêm một điểm lỗi (single point of failure). Trong phạm vi đồ án chạy trên mạng LAN phòng lab, các rủi ro này được chấp nhận và xử lý bằng logic reconnect cơ bản ở phía Controller.
