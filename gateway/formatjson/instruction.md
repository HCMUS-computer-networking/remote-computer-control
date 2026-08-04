# JSON Message Format — DRAFT (chưa chốt với nhóm)

> **Trạng thái:** File MẪU TẠM do phía Controller tự đề xuất, **chưa họp nhóm xác nhận**.
> Khi nhóm họp xong và thống nhất, cập nhật các file này và xoá dòng DRAFT này.

## Danh sách file

| File | Module | Ghi chú |
|---|---|---|
| `connection.json` | Kết nối & danh sách Agent | `list_agents`, `agents_list`, `agent_status` |
| `application.json` | Application | `app_list`, `app_start`, `app_stop` + kết quả |
| `process.json` | Process | `proc_list`, `proc_kill` + kết quả |
| `livescreen.json` | Screenshot / Live Stream | `frame_meta` + binary JPEG |
| `keylog.json` | Input Activity (Keylog) | `keylog`, consent flow |
| `file.json` | File (sandbox) | `fs_list`, `fs_get`, `fs_put` |
| `webcam.json` | Webcam | `frame_meta` (module=webcam) + binary JPEG |
| `power.json` | Power | `lock`, `restart`, `shutdown`, `sleep` |

## Quy ước chung

- **`type`** — tên loại message, bắt buộc trong mọi gói tin JSON.
- **`agent_id`** — id của agent gửi kết quả về (phía Gateway→Controller).
- **`target_agents`** — mảng id agent mà lệnh sẽ được gửi tới (phía Controller→Gateway). Cần xác nhận Gateway có relay field này không (xem `TODO` trong `file.json`).
- **Frame ảnh (screen / webcam):** luôn gồm 2 message liên tiếp — JSON `frame_meta` rồi BINARY JPEG. Controller đặt `binaryType = "arraybuffer"` và ghép cặp theo thứ tự nhận.
- **Consent:** các module nhạy cảm (keylog, webcam) có thêm message `*_denied` khi người dùng từ chối.

## TODO cần xác nhận với nhóm

- [ ] Confirm field name `target_agents` với Gateway (có relay được không?).
- [ ] File upload (`fs_put`): dùng base64 chunks hay binary WebSocket message?
- [ ] `frame_meta` + binary: Agent gửi liên tiếp trong cùng 1 WebSocket connection hay tách riêng?
- [ ] URL/port Gateway và giao thức `ws://` hay `wss://`.
- [ ] Các field `timestamp_ms` có thật sự cần không?
