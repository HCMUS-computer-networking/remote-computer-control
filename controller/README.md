# Controller — Đồ án Điều khiển máy tính từ xa

Phần **Controller** là giao diện web ReactJS cho phép người quản trị:

- Xem danh sách Agent đang kết nối (online/offline, trạng thái phiên điều khiển).
- Chuyển giữa **Grid view** (xem thumbnail màn hình nhiều Agent) và **Focus view** (điều khiển 1 Agent với 7 tab module).
- Gửi lệnh điều khiển tới Agent thông qua Gateway trung gian qua WebSocket.

Controller **chỉ render dữ liệu** mà Agent chủ động gửi lên sau khi người dùng đầu Agent đã đồng ý — không tự thu thập dữ liệu.

---

## Tech stack

| Thư viện           | Phiên bản | Mục đích                                                           |
| ------------------ | --------- | ------------------------------------------------------------------ |
| React              | 19        | UI                                                                 |
| Vite               | 8         | Dev server + build                                                 |
| Zustand            | 5         | Quản lý state (tránh re-render thừa khi dữ liệu cập nhật liên tục) |
| lucide-react       | ^1.23.0   | Icon (nhẹ, nhất quán, dễ giải thích)                               |
| WebSocket (native) | —         | Giao tiếp real-time với Gateway                                    |

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

| Tab         | Tính năng                                                       |
| ----------- | --------------------------------------------------------------- |
| Application | Xem + Start/Stop ứng dụng trong whitelist                       |
| Process     | Xem toàn bộ tiến trình + Kill                                   |
| Screen      | Chụp màn hình 1 lần + Live Stream 24fps                         |
| Keylog      | Xem keystroke log (có chỉ báo consent trực quan)                |
| File        | Duyệt cây thư mục sandbox + Upload/Download                     |
| Webcam      | Xem live webcam (có chỉ báo consent trực quan)                  |
| Power       | Lock / Restart / Shutdown / Sleep (có modal đếm ngược xác nhận) |

---

## Cấu trúc thư mục

```
controller/
├── docs/
│   ├── wireframe/
│   │   ├── color-palette.md              Bảng màu + CSS variable tokens (light/dark)
│   │   ├── icons.md                      Quy tắc dùng lucide-react
│   │   └── controller-wireframes.drawio  Wireframe đầy đủ (4 màn hình)
│   │
│   └── formatjson/                       Format JSON giao tiếp (DRAFT — chưa chốt với nhóm)
│       ├── instruction.md                Tổng quan + TODO cần xác nhận
│       ├── connection.json               Kết nối & danh sách Agent
│       ├── application.json              Module Application
│       ├── process.json                  Module Process
│       ├── livescreen.json               Module Screenshot / Live Stream
│       ├── keylog.json                   Module Keylog (Input Activity)
│       ├── file.json                     Module File (sandbox)
│       ├── webcam.json                   Module Webcam
│       └── power.json                    Module Power
│
└── src/
    ├── store/
    │   ├── UiStore.js           theme, view_mode, active_tab, sidebar_open
    │   ├── AgentStore.js        agents[], selected_agent_id, search_query (mock data: 5 agents)
    │   ├── ConnectionStore.js   trạng thái kết nối Gateway (mock default: 'connected')
    │   └── ModuleStore.js       dữ liệu module theo [agentId][module]
    │
    ├── services/
    │   ├── MockSocket.js        STUB — giả lập Gateway+Agent (dùng khi phát triển độc lập)
    │   ├── Socket.js            STUB — WebSocket thật (dùng khi Gateway sẵn sàng)
    │   └── Protocol.js          STUB — build/parse JSON message
    │
    ├── hooks/
    │   └── UseAgentSocket.js    STUB — hook trung gian; component KHÔNG được gọi socket trực tiếp
    │
    ├── components/
    │   ├── layout/              Sidebar, TopBar, ThemeToggle
    │   ├── agents/              AgentList, AgentCard, MultiSelect (stub)
    │   ├── livescreen/          GridView, FocusView, FrameCanvas
    │   └── modules/             7 tab placeholder: ApplicationTab, ProcessTab, ScreenTab,
    │                            KeylogTab, FileTab, WebcamTab, PowerTab
    │
    ├── App.jsx                  Root component — áp theme, render layout shell
    └── index.css                Toàn bộ CSS: variables, reset, class của mọi component
```

---

## Trạng thái hiện tại

| Phần                                                   | Trạng thái                                                |
| ------------------------------------------------------ | --------------------------------------------------------- |
| Bố cục shell (Sidebar + TopBar + GridView + FocusView) | ✅ Hoàn chỉnh                                             |
| CSS variables light/dark + toggle theme                | ✅ Hoàn chỉnh                                             |
| 4 Zustand stores                                       | ✅ Hoàn chỉnh (dùng mock data tĩnh)                       |
| AgentList, AgentCard — sidebar                         | ✅ Hoàn chỉnh                                             |
| GridView — overview nhiều Agent                        | ✅ Hoàn chỉnh                                             |
| FocusView — 7-tab bar                                  | ✅ Hoàn chỉnh                                             |
| FrameCanvas — render JPEG binary frame                 | ✅ Hoàn chỉnh (chờ dữ liệu thật)                          |
| Wireframe + bảng màu + icon guide                      | ✅ Hoàn chỉnh (docs/wireframe/)                           |
| Draft format JSON 7 module                             | ✅ Có bản mẫu tạm (docs/formatjson/) — chưa chốt với nhóm |
| 7 module tab                                           | ⏳ Placeholder stub (logic thật làm Tuần 2–4)             |
| MockSocket.js                                          | ⏳ Stub (chưa implement)                                  |
| Protocol.js                                            | ⏳ Stub (chưa implement)                                  |
| UseAgentSocket hook                                    | ⏳ Stub (chưa implement)                                  |
| MultiSelect (chọn nhiều agent)                         | ⏳ Stub (chưa implement)                                  |
| Socket.js (thật)                                       | ⏳ Stub (Tuần 5)                                          |

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

_Xem chi tiết kiến trúc code tại [architecture.md](architecture.md)._
