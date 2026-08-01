# Controller — Đồ án Điều khiển máy tính từ xa

**Controller** là giao diện web (SPA) để người quản trị giám sát và điều khiển
nhiều máy Agent từ xa thông qua một Gateway trung gian bằng WebSocket.

---

## Tech stack

- **React 19** — UI
- **Vite** — dev server + build
- **Zustand** — global state (không dùng Redux / Context)
- **WebSocket** (native) — giao tiếp real-time với Gateway
- **lucide-react** — icon

Không dùng TypeScript.

---

## Cách chạy

```bash
npm install        # cài dependencies (chỉ cần lần đầu)
npm run dev        # dev server → http://localhost:5173
```

Lệnh khác: `npm run build`, `npm run preview`, `npm run lint`.

---

## Cấu trúc thư mục (tóm tắt)

```
src/
├── App.jsx, main.jsx        # entry + shell
├── store/                   # 6 Zustand store (Agent / Connection / Module /
│                            #                  Permission / Policy / Ui)
├── hooks/UseAgentSocket.js  # singleton hook nối component ↔ socket
├── services/                # index.js (chọn mock/real), Protocol.js,
│                            # MockSocket.js, Socket.js, AuthService.js
└── components/
    ├── LoginScreen.jsx      # màn đăng nhập admin (JWT)
    ├── FrameCanvas.jsx      # primitive dùng chung để vẽ JPEG frame
    ├── ModuleTable.jsx      # primitive dùng chung cho bảng có sort
    ├── PermissionGate.jsx   # wrapper Connect/Disconnect cho từng module
    ├── agents/              # sidebar agent list + multi-select
    ├── layout/              # Sidebar, TopBar, ThemeToggle
    ├── livescreen/          # Grid view + Focus view
    └── modules/             # 7 tab: Application, Process, Screen, Keylog,
                             #        File, Webcam, Power
```

Chi tiết kiến trúc, store, luồng dữ liệu, giao thức message xem trong
[`Architecture.md`](./Architecture.md).

---

## Trạng thái backend

Hiện tại app chạy bằng **`MockSocket`** (mô phỏng Gateway + Agent ngay trong
trình duyệt) để phát triển UI không phụ thuộc backend. `MockSocket` và `Socket`
(WebSocket thật) có cùng API, được chọn tại `src/services/index.js` qua biến môi
trường `VITE_USE_MOCK`. Khi Gateway thật sẵn sàng, đặt `VITE_USE_MOCK=false`
(và `VITE_GATEWAY_URL` trỏ tới Gateway) trong file `.env` — không cần sửa
component hay store.
