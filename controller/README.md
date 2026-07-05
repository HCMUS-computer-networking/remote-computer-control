# Controller

Controller là giao diện web dùng để **điều khiển từ xa** các máy Agent trong đồ án "Điều khiển máy tính từ xa". Người dùng (Controller) quan sát danh sách Agent đang kết nối, xem màn hình trực tiếp (live screen), và gửi lệnh điều khiển (file, process, power, keylog, webcam, application...) tới từng Agent thông qua Gateway trung gian.

## Tech stack

- **React 19** — UI
- **Vite** — dev server & build tool
- **Zustand** — quản lý state (agent, connection, module, UI)
- **WebSocket** — giao tiếp real-time với Gateway/Agent

## Cách chạy

```bash
npm install
npm run dev
```

Các lệnh khác:

```bash
npm run build     # build production
npm run preview   # preview bản build
npm run lint      # kiểm tra lint với oxlint
```

## Cấu trúc thư mục

```
src/
├── assets/            # hình ảnh, icon tĩnh
├── components/
│   ├── agents/        # danh sách, card, chọn agent
│   ├── layout/         # sidebar, topbar, theme toggle
│   ├── livescreen/     # xem màn hình agent (grid/focus view)
│   └── modules/        # các tab chức năng: File, Process, Power, Keylog, Webcam, Application, Screen
├── hooks/              # custom hooks (vd: UseAgentSocket)
├── services/           # Socket.js, MockSocket.js, Protocol.js
├── store/              # Zustand store: Agent, Connection, Module, UI
├── App.jsx
└── main.jsx
```

## Ghi chú

> ⚠️ Hiện tại project đang chạy bằng **`MockSocket`** ([src/services/MockSocket.js](src/services/MockSocket.js)) để giả lập dữ liệu/agent trong lúc phát triển UI. Khi Gateway thật đã sẵn sàng, cần đổi sang **`Socket.js`** ([src/services/Socket.js](src/services/Socket.js)) để kết nối WebSocket thật.
