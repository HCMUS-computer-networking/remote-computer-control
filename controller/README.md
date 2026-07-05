# Controller — Đồ án Điều khiển máy tính từ xa

Phần **Controller** là giao diện web ReactJS cho phép người quản trị:

- Xem danh sách Agent đang kết nối (online/offline, trạng thái phiên điều khiển).
- Chuyển giữa **Grid view** (xem thumbnail màn hình nhiều Agent) và **Focus view** (điều khiển 1 Agent với 7 tab module).
- Gửi lệnh điều khiển tới Agent thông qua Gateway trung gian qua WebSocket.

Controller **chỉ render dữ liệu** mà Agent chủ động gửi lên sau khi người dùng đầu Agent đã đồng ý — không tự thu thập dữ liệu.

---

## Tech stack

| Thư viện | Phiên bản | Mục đích |
|---|---|---|
| React | 19 | UI |
| Vite | 8 | Dev server + build |
| Zustand | 5 | Quản lý state (tránh re-render thừa khi dữ liệu cập nhật liên tục) |
| lucide-react | latest | Icon (nhẹ, nhất quán, dễ giải thích) |
| WebSocket (native) | — | Giao tiếp real-time với Gateway |

> Không dùng TypeScript, không dùng Redux, không dùng Context API cho state liên tục — đây là lựa chọn có chủ ý, ghi rõ trong báo cáo.

---

## Cách chạy

```bash
# cài dependencies (chỉ cần làm 1 lần)
npm install

# khởi động dev server (mở http://localhost:5173)
npm run dev
```

Các lệnh khác:

```bash
npm run build     # build production ra thư mục dist/
npm run preview   # preview bản build
npm run lint      # kiểm tra lint với oxlint
```

---

## 7 module quản trị

| Tab | Tính năng |
|---|---|
| Application | Xem + Start/Stop ứng dụng trong whitelist |
| Process | Xem toàn bộ tiến trình + Kill |
| Screen | Chụp màn hình 1 lần + Live Stream 24fps |
| Keylog | Xem keystroke log (có chỉ báo consent trực quan) |
| File | Duyệt cây thư mục sandbox + Upload/Download |
| Webcam | Xem live webcam (có chỉ báo consent trực quan) |
| Power | Lock / Restart / Shutdown / Sleep (có modal đếm ngược xác nhận) |

---

## Cấu trúc thư mục

```
controller/
├── docs/                        Tài liệu thiết kế UI
│   ├── color-palette.md         Bảng màu + CSS variable tokens (light/dark)
│   ├── icons.md                 Quy tắc dùng lucide-react
│   └── controller-wireframes.drawio  Wireframe đầy đủ (4 màn hình)
│
└── src/
    ├── store/                   Zustand stores
    │   ├── UiStore.js           theme, view_mode, active_tab, sidebar_open
    │   ├── AgentStore.js        agents[], selected_agent_id, search_query
    │   ├── ConnectionStore.js   trạng thái kết nối Gateway
    │   └── ModuleStore.js       dữ liệu module theo [agentId][module]
    │
    ├── services/
    │   ├── MockSocket.js        Giả lập Gateway+Agent (dùng khi phát triển độc lập)
    │   ├── Socket.js            WebSocket thật (dùng khi Gateway sẵn sàng)
    │   └── Protocol.js          Build/parse JSON message
    │
    ├── hooks/
    │   └── UseAgentSocket.js    Hook trung gian — component KHÔNG được gọi socket trực tiếp
    │
    ├── components/
    │   ├── layout/              Sidebar, TopBar, ThemeToggle
    │   ├── agents/              AgentList, AgentCard, MultiSelect
    │   ├── livescreen/          GridView, FocusView, FrameCanvas
    │   └── modules/             7 tab: ApplicationTab, ProcessTab, ScreenTab,
    │                            KeylogTab, FileTab, WebcamTab, PowerTab
    │
    ├── App.jsx                  Root component — áp theme, render layout shell
    └── index.css                Toàn bộ CSS: variables, reset, class của mọi component
```

---

## Trạng thái hiện tại

| Phần | Trạng thái |
|---|---|
| Bố cục shell (Sidebar + TopBar + GridView + FocusView) | ✅ Hoàn chỉnh |
| CSS variables light/dark + toggle theme | ✅ Hoàn chỉnh |
| 4 Zustand stores | ✅ Hoàn chỉnh (dùng mock data) |
| AgentList, AgentCard — sidebar | ✅ Hoàn chỉnh |
| GridView — overview nhiều Agent | ✅ Hoàn chỉnh |
| FocusView — 7-tab bar | ✅ Hoàn chỉnh |
| FrameCanvas — render JPEG binary frame | ✅ Hoàn chỉnh (chờ dữ liệu thật) |
| 7 module tab | ⏳ Placeholder (logic thật sẽ làm Tuần 2–4) |
| MockSocket.js | ⏳ Stub (chưa implement) |
| Protocol.js | ⏳ Stub (chưa implement) |
| UseAgentSocket hook | ⏳ Stub (chưa implement) |
| Socket.js (thật) | ⏳ Stub (Tuần 5) |

---

## Ghi chú mock → real

> ⚠️ App hiện đang render **mock data tĩnh** (định nghĩa thẳng trong `AgentStore.js`).
> Khi `MockSocket.js` và `UseAgentSocket` được implement, data sẽ đến từ mock Gateway.
> Khi Gateway thật sẵn sàng (Tuần 5), chỉ cần đổi **1 import** từ `MockSocket` sang `Socket` —
> toàn bộ component không cần sửa vì chúng chỉ nói chuyện qua store/hook.

---

## Git workflow

- Nhánh làm việc: `dev`
- Nhánh ổn định: `main`
- Quy ước commit: `feat:` / `fix:` / `refactor:` / `chore:` / `docs:`

---

*Xem chi tiết kiến trúc code tại [architecture.md](architecture.md).*
