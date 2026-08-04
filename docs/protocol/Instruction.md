# JSON Message Format & E2EE Protocol

> **Trạng thái:** File chính thức. Đã áp dụng End-to-End Encryption (E2EE).

## Danh sách file

| File | Module | Ghi chú |
|---|---|---|
| `Connection.json` | Kết nối & danh sách Agent | `list_agents`, `agents_list`, `agent_status` |
| `Application.json` | Application | `app_list`, `app_start`, `app_stop` + kết quả |
| `Process.json` | Process | `proc_list`, `proc_kill` + kết quả |
| `Livescreen.json` | Screenshot / Live Stream | `frame_meta` + binary JPEG |
| `Keylog.json` | Input Activity (Keylog) | `keylog`, consent flow |
| `File.json` | File (sandbox) | `fs_list`, `fs_get`, `fs_put` |
| `Webcam.json` | Webcam | `frame_meta` (module=webcam) + binary JPEG |
| `Power.json` | Power | `lock`, `restart`, `shutdown`, `sleep` |

## Quy ước chung

- **`type`** — tên loại message, bắt buộc trong mọi gói tin JSON.
- **E2EE Wrapper (`e2ee_payload`)** — Ngoại trừ các bản tin hệ thống như `list_agents`, `agent_status`, `e2ee_init`, `e2ee_ready`, toàn bộ các JSON Payload chứa nội dung điều khiển đều phải được Serialized thành chuỗi, mã hóa AES-GCM 256-bit (kèm IV và AuthTag), sau đó encode Base64 và đặt vào trường `data` của một object `e2ee_payload`. Gateway chỉ làm nhiệm vụ luân chuyển các `e2ee_payload` này (Blind Relay).
- **`agent_id`** — id của agent gửi kết quả về (phía Gateway→Controller).
- **`target_agents`** — mảng id agent mà lệnh sẽ được gửi tới (phía Controller→Gateway). Gateway sẽ dựa vào trường này để Route JSON (hoặc `e2ee_payload`) tới đích.
- **Frame ảnh & UDP Stream (screen / webcam):** luôn gồm 2 quá trình liên tiếp: JSON `frame_meta` (gửi qua WebSocket) rồi BINARY BUFFER (gửi qua UDP). Controller ghép cặp theo metadata. Payload nhị phân của hình ảnh đã được mã hóa nguyên khối AES-GCM trước khi gửi.
- **Consent:** các module nhạy cảm (keylog, webcam) có thêm message `*_denied` khi người dùng từ chối.

## Ghi chú triển khai

- Gateway hỗ trợ broadcast nếu `target_agents` trống.
- `frame_meta` được gửi qua giao thức WebSocket (TCP) để đảm bảo độ tin cậy, còn luồng nhị phân được gửi qua UDP Stream để tăng tốc.
- Quá trình xin cấp quyền được thực hiện trước khi bất kỳ module nhạy cảm nào khởi chạy. Nếu Controller/Agent bị ngắt kết nối, quyền được reset, và mã PIN sẽ cần xác thực Handshake lại khóa E2EE (`permissions_reset`).
