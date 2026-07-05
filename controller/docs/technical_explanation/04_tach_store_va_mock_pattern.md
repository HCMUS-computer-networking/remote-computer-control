# 4. Lý do tách 4 store và áp dụng pattern Mock → Real

## Cấu trúc 4 store

State của Controller được chia thành 4 store độc lập trong Zustand:

| Store | Trách nhiệm |
|---|---|
| `ConnectionStore` | Trạng thái kết nối WebSocket (connected/disconnected/reconnecting), URL Gateway |
| `AgentStore` | Danh sách Agent đang online, Agent đang được chọn |
| `ModuleStore` (keyed by agentId) | Dữ liệu của từng module (process list, screenshot buffer, keylog events...) theo từng Agent |
| `UiStore` | Trạng thái giao diện thuần túy (tab đang mở, modal, trạng thái loading) |

**Lý do tách theo trách nhiệm** thay vì dùng một store duy nhất:

- **Granular subscription**: Component hiển thị danh sách tiến trình chỉ subscribe vào `ModuleStore`, không bị ảnh hưởng khi `ConnectionStore` thay đổi (ví dụ khi đang reconnect). Nếu dùng một store duy nhất, mọi thay đổi đều có nguy cơ trigger re-render toàn bộ.
- **Dễ test và debug từng phần**: Có thể reset hoặc mock từng store riêng lẻ trong quá trình phát triển mà không ảnh hưởng đến phần còn lại.
- **Tránh circular dependency**: `ModuleStore` cần biết `agentId` hiện tại từ `AgentStore`, nhưng không cần biết trạng thái kết nối. Tách store làm rõ chiều phụ thuộc này.

## Pattern Mock → Real

Controller không kết nối trực tiếp đến Gateway. Tất cả component và store chỉ giao tiếp qua một interface socket duy nhất, được inject vào qua `UseAgentSocket` hook. Trong quá trình phát triển, `MockSocket.js` được dùng thay cho `Socket.js`:

```
Component → Hook (UseAgentSocket) → Store → Service (MockSocket / Socket)
```

`MockSocket.js` mô phỏng hành vi của Gateway+Agent: phát sinh danh sách tiến trình giả, gửi JPEG ảnh chụp màn hình ngẫu nhiên theo interval, phản hồi các lệnh điều khiển. Điều này cho phép **toàn bộ nhóm phát triển giao diện độc lập** mà không cần Gateway và Agent thực chạy song song.

Khi tích hợp thực, chỉ cần thay một dòng import trong file cấu hình kết nối — **không có component nào cần sửa**. Sự thay thế này hoạt động được vì cả `MockSocket.js` và `Socket.js` đều tuân thủ cùng một interface (cùng tên method: `connect`, `send`, `onMessage`, `disconnect`).

## Đánh đổi

`MockSocket.js` phải được duy trì song song với giao thức thực. Nếu giao thức thay đổi (thêm message type mới), `MockSocket.js` phải được cập nhật tương ứng, nếu không việc test giao diện sẽ không phản ánh đúng hành vi thực. Đây là chi phí bảo trì nhỏ nhưng cần chú ý trong suốt quá trình phát triển.
