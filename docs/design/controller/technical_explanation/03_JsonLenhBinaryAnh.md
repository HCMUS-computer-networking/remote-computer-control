# 3. Lý do dùng JSON cho lệnh và Binary (JPEG) cho ảnh/video kèm frame_meta

## Hai loại dữ liệu có bản chất khác nhau

Hệ thống truyền hai loại dữ liệu qua cùng một kết nối WebSocket:

- **Lệnh và metadata**: Nhỏ, có cấu trúc rõ ràng, cần con người và code đọc được dễ dàng (ví dụ: `{ "type": "request", "module": "process", "action": "proc_kill", "pid": 1234 }`).
- **Dữ liệu hình ảnh**: Lớn, là dữ liệu nhị phân thuần túy (byte stream của JPEG), không có ý nghĩa khi biểu diễn dưới dạng văn bản.

Áp dụng một định dạng duy nhất cho cả hai loại đều dẫn đến vấn đề:

- Nếu dùng JSON cho ảnh: phải mã hóa JPEG sang Base64 trước khi nhúng vào JSON. Base64 làm tăng kích thước dữ liệu khoảng **33%** và tốn thêm chu kỳ CPU để mã hóa/giải mã ở cả hai đầu.
- Nếu dùng binary cho tất cả: lệnh điều khiển mất đi tính tự mô tả (self-describing), việc debug và mở rộng giao thức trở nên khó khăn hơn.

## Giải pháp: tách thành hai thông điệp liên tiếp

Giao thức sử dụng mô hình **hai bước** cho mỗi khung hình:

1. **Thông điệp JSON `frame_meta`**: gửi trước, chứa metadata của khung (`module`, `w`, `h`, `len`, `seq`). Controller đọc JSON này để biết kích thước và module nguồn, cấp phát bộ nhớ phù hợp, và xác định cách xử lý thông điệp tiếp theo.
2. **Thông điệp binary**: gửi ngay sau, chứa đúng `len` byte dữ liệu JPEG thô. Controller nhận ArrayBuffer này và tạo Blob/ObjectURL để hiển thị trực tiếp, không cần giải mã thêm.

JSON vẫn được dùng cho tất cả lệnh điều khiển vì tính dễ debug, dễ mở rộng field, và kích thước nhỏ không đáng kể.

## Đánh đổi

Mô hình hai bước yêu cầu phía nhận duy trì trạng thái "đang chờ binary sau frame_meta". Nếu thứ tự thông điệp bị đảo (lý thuyết không xảy ra trên TCP nhưng cần xử lý phòng thủ), logic xử lý sẽ phức tạp hơn. Trong triển khai hiện tại, Controller sử dụng cờ `pending_frame_meta` trong store để theo dõi trạng thái này và reset nếu nhận thông điệp không hợp lệ.
