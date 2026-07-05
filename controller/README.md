# Controller — Đồ án Điều khiển máy tính từ xa

Phần **Controller** là giao diện web ReactJS cho phép người quản trị:

- Xem danh sách Agent đang kết nối (online/offline, trạng thái phiên điều khiển).
- Chuyển giữa **Grid view** (thumbnail màn hình nhiều Agent) và **Focus view** (điều khiển 1 Agent với 7 tab module).
- Gửi lệnh điều khiển tới Agent thông qua Gateway trung gian qua WebSocket.

Controller **chỉ render dữ liệu** mà Agent chủ động gửi lên sau khi người dùng đầu Agent đã đồng ý — không tự thu thập dữ liệu.

---

## Tech stack

| Thư viện           | Phiên bản | Mục đích                                                           |
| ------------------ | --------- | ------------------------------------------------------------------ |
| React              | 19.2      | UI                                                                 |
| Vite               | 8.1       | Dev server + build                                                 |
| Zustand            | 5.0       | Quản lý state (tránh re-render thừa khi dữ liệu cập nhật liên tục) |
| lucide-react       | ^1.23.0   | Icon (nhẹ, nhất quán)                                              |
| WebSocket (native) | —         | Giao tiếp real-time với Gateway                                    |

> Không dùng TypeScript, không dùng Redux, không dùng Context API cho state liên tục.  
> Lý do chi tiết: [`docs/technical_explanation/`](docs/technical_explanation/)

---

## Cách chạy

```bash
# cài dependencies (chỉ cần làm 1 lần)
npm install

# khởi động dev server → http://localhost:5173
npm run dev
```

Các lệnh khác:

```bash
npm run build     # build production ra dist/
npm run preview   # preview bản build
npm run lint      # kiểm tra lint với oxlint
```

---

## 7 module quản trị

| Tab         | Tính năng                                                    |
| ----------- | ------------------------------------------------------------ |
| Application | Xem + Start/Stop ứng dụng trong whitelist                    |
| Process     | Xem toàn bộ tiến trình + Kill                                |
| Screen      | Chụp màn hình 1 lần + Live Stream 24fps                      |
| Keylog      | Xem keystroke log (có chỉ báo consent trực quan)             |
| File        | Duyệt cây thư mục sandbox + Upload/Download                  |
| Webcam      | Xem live webcam (có chỉ báo consent trực quan)               |
| Power       | Lock / Restart / Shutdown / Sleep (modal đếm ngược xác nhận) |

---

## Cấu trúc thư mục

```
controller/
├── docs/
│   ├── wireframe/              Wireframe drawio + bảng màu + icon guide
│   ├── formatjson/             Draft JSON protocol 7 module (chưa chốt với nhóm)
│   ├── technical_explanation/  Giải thích kỹ thuật cho báo cáo (tiếng Việt)
│   └── screenshot/wireframe_UI/ Ảnh chụp wireframe light/dark
│
└── src/
    ├── store/          UiStore · AgentStore · ConnectionStore · ModuleStore
    ├── services/       Socket.js · MockSocket.js · Protocol.js  (stubs)
    ├── hooks/          UseAgentSocket.js  (stub)
    ├── components/
    │   ├── layout/     Sidebar · TopBar · ThemeToggle
    │   ├── agents/     AgentList · AgentCard · MultiSelect (stub)
    │   ├── livescreen/ GridView · FocusView · FrameCanvas
    │   └── modules/    7 tab placeholder stubs
    ├── App.jsx
    └── index.css       Toàn bộ CSS của dự án
```

---

## Ghi chú Mock → Real

App hiện render **mock data tĩnh** định nghĩa trong `AgentStore.js`.  
Khi `MockSocket.js` và `UseAgentSocket` được implement, data sẽ đến từ mock Gateway giả lập.  
Khi Gateway thật sẵn sàng, chỉ cần đổi **một import** từ `MockSocket` sang `Socket` — toàn bộ component không cần sửa vì chúng chỉ nói chuyện qua store/hook.

---

## Git workflow

- Nhánh làm việc: `dev`
- Nhánh ổn định: `main`
- Quy ước commit: `feat:` / `fix:` / `refactor:` / `chore:` / `docs:`

---

_Xem chi tiết kiến trúc code tại [architecture.md](architecture.md)._
