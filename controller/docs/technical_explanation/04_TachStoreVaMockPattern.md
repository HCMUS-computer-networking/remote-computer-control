# 4. Lý do tách 4 store và áp dụng pattern Mock → Real

## Cấu trúc 4 store

State của Controller được chia thành 4 store độc lập trong Zustand:

| Store | Trách nhiệm | Subscriber điển hình |
|---|---|---|
| `ConnectionStore` | Trạng thái kết nối (`idle/connecting/open/closed`), URL Gateway, auth token | TopBar, Sidebar footer, UseAgentSocket hook |
| `AgentStore` | Danh sách agent, multi-select set, agent đang xem chi tiết, ô tìm kiếm | Sidebar, AgentList, AgentCard, FocusView, TopBar |
| `ModuleStore` | Dữ liệu từng module (app list, process list, keylog buffer, frame JPEG, file tree) theo từng `agentId` | Các module tab (ApplicationTab, ProcessTab, ScreenTab…) |
| `UiStore` | Chủ đề màu, layout mode (grid/focus), tab đang mở, trạng thái sidebar | App, TopBar, FocusView, ThemeToggle |

---

## Tại sao tách 4 store thay vì gộp 1?

### 1. Granular subscription — tránh re-render thừa

Zustand chỉ re-render component khi **đúng slice mà component đó subscribe** thay đổi. Nếu gộp tất cả vào một store duy nhất:

```
// Giả sử dùng 1 store:
const { status, agents, active_tab, data } = useOneStore()
// → Bất cứ khi nào frame JPEG mới đến (60 lần/giây trong focus mode),
//   TopBar, Sidebar, AgentList đều bị re-render mặc dù chúng không cần frame.
```

Khi tách riêng, `ScreenTab` subscribe vào `ModuleStore.data[id].screen` — các component còn lại không bị ảnh hưởng:

```
// 4 store riêng:
// ScreenTab    → useModuleStore()  — re-render mỗi frame mới (đúng)
// AgentList    → useAgentStore()   — chỉ re-render khi agent list thay đổi
// TopBar       → useUiStore()      — chỉ re-render khi tab / theme thay đổi
// Sidebar      → useConnectionStore() — chỉ re-render khi status thay đổi
```

### 2. Tách theo vòng đời (update frequency)

Mỗi store có tần suất cập nhật rất khác nhau:

| Store | Tần suất thay đổi |
|---|---|
| `ConnectionStore` | Thấp — vài lần/session (connect, disconnect) |
| `AgentStore` | Thấp–trung — khi agent online/offline |
| `UiStore` | Trung — mỗi lần user click tab/theme |
| `ModuleStore` | Rất cao — frame JPEG: 1–24 lần/giây; keylog: liên tục |

Gộp 1 store nghĩa là mọi component đều chạy với tần suất của store nhanh nhất (ModuleStore).

### 3. Tránh circular dependency

`ModuleStore` cần biết `agentId` hiện tại (từ `AgentStore`) khi đọc dữ liệu, nhưng không cần biết trạng thái kết nối. `AgentStore` không cần biết gì về module data. Tách store làm rõ chiều phụ thuộc và tránh store gọi lẫn nhau.

### 4. Dễ mock và test từng phần

Trong quá trình phát triển, mỗi store có thể được seed dữ liệu giả độc lập. Ví dụ: `AgentStore` có `MOCK_AGENTS` scaffold cho đến khi `UseAgentSocket` được nối vào — trong khi `ModuleStore` vẫn rỗng và `ConnectionStore` ở trạng thái `idle`.

---

## Pattern Mock → Real

Controller không import `MockSocket` trong component hay store. Toàn bộ giao tiếp socket đi qua một hook trung gian duy nhất:

```
Component → store action → UseAgentSocket hook → MockSocket (dev) / Socket (prod)
                                ↓ onMessage callback
                          ConnectionStore / AgentStore / ModuleStore
```

`MockSocket.js` mô phỏng hành vi của Gateway+Agent: trả danh sách agent giả, phản hồi lệnh app/process, trả ack cho lệnh power. Điều này cho phép **phát triển giao diện độc lập** mà không cần Gateway và Agent thực chạy song song.

Khi tích hợp thực, chỉ cần đổi **một dòng import** trong `UseAgentSocket.js`:
```js
// Đổi dòng này:
import MockSocket from '../services/MockSocket'
// Thành:
import Socket from '../services/Socket'
```
Không có component hay store nào cần thay đổi vì cả hai class đều có cùng API: `connect()`, `send()`, `close()`, `onOpen()`, `onMessage()`, `onClose()`, `onError()`.

---

## Đánh đổi

`MockSocket.js` phải được cập nhật song song với giao thức thực. Nếu Gateway team thêm message type mới, `MockSocket` phải thêm handler tương ứng — nếu không, giao diện sẽ không phản ánh đúng hành vi thực khi tích hợp. Đây là chi phí bảo trì nhỏ nhưng cần chú ý trong suốt quá trình phát triển.
