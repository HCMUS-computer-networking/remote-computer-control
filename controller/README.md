# Controller — Đồ án Điều khiển máy tính từ xa

Phần **Controller** là giao diện web cho phép người quản trị giám sát và điều khiển các máy Agent từ xa thông qua một Gateway trung gian. Toàn bộ dữ liệu chỉ được thu thập sau khi người dùng đầu Agent đồng ý.

---

## Tech stack

| Thư viện | Phiên bản | Mục đích |
|---|---|---|
| React | 19.2 | UI |
| Vite | 8.1 | Dev server + build |
| Zustand | 5.0 | Global state (tránh re-render thừa) |
| lucide-react | 1.23 | Icon |
| WebSocket (native) | — | Giao tiếp real-time với Gateway |

> Không dùng TypeScript, không dùng Redux, không dùng Context API cho state liên tục.

---

## Cách chạy

```bash
npm install        # cài dependencies (chỉ cần làm 1 lần)
npm run dev        # khởi động dev server → http://localhost:5173
```

Lệnh khác:

```bash
npm run build      # build production ra dist/
npm run preview    # preview bản build
npm run lint       # kiểm tra lint với oxlint
```

---

## 7 module quản trị

| Tab | Tính năng | Trạng thái |
|---|---|---|
| Application | Bảng app list, sort, Start/Stop whitelist, poll 3s | ✅ |
| Process | Bảng process list, sort, Kill, poll 3s | ✅ |
| Screen | Chụp 1 lần + Live Stream 24fps + Grid 2fps | ✅ |
| Keylog | Xem keystroke log (có chỉ báo consent trực quan) | ✅ |
| File | Duyệt cây thư mục sandbox + Upload/Download | ✅ |
| Webcam | Xem live webcam (có chỉ báo consent trực quan) | ⏳ |
| Power | Lock / Restart / Shutdown / Sleep (đếm ngược xác nhận) | ⏳ |

---

## Cấu trúc thư mục

```
controller/
├── docs/
│   ├── wireframe/              Wireframe drawio + bảng màu + icon guide
│   ├── formatjson/             Draft JSON protocol 7 module + policy_update (whitelist/sandbox push)
│   ├── technical_explanation/  Giải thích kỹ thuật cho báo cáo (tiếng Việt)
│   └── screenshot/wireframe_UI/ Ảnh chụp wireframe light/dark
│
└── src/
    ├── store/          UiStore · AgentStore · ConnectionStore · ModuleStore
    ├── services/       Protocol.js · MockSocket.js · Socket.js (stub)
    ├── hooks/          UseAgentSocket.js
    ├── components/
    │   ├── layout/     Sidebar · TopBar · ThemeToggle
    │   ├── agents/     AgentList · AgentCard · MultiSelect
    │   ├── livescreen/ GridView · FocusView · FrameCanvas
    │   └── modules/    7 tab (5 hoàn chỉnh, 2 placeholder)
    ├── App.jsx
    └── index.css       Toàn bộ CSS của dự án
```

---

## Ghi chú Mock → Real

App hiện chạy với **MockSocket.js** — giả lập Gateway và Agent ngay trong trình duyệt, không cần backend thật.

Khi Gateway thật sẵn sàng, chỉ cần đổi **một dòng import** trong `src/hooks/UseAgentSocket.js`:

```js
// Đổi dòng này:
import MockSocket from '../services/MockSocket'

// Thành:
import MockSocket from '../services/Socket'
```

Không cần sửa bất kỳ component hay store nào.

---

## Git workflow

- Nhánh làm việc: `dev`
- Nhánh ổn định: `main`
- Quy ước commit: `feat:` / `fix:` / `refactor:` / `chore:` / `docs:`

---

_Xem chi tiết kiến trúc code tại [Architecture.md](Architecture.md)._
