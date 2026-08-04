# Remote Computer Control — Đồ án Mạng máy tính HCMUS

Hệ thống **remote administration** cho phòng máy: một Controller web-based giám sát và điều khiển nhiều Agent Windows từ xa qua một Gateway trung gian. Mọi hành động nhạy cảm (screen stream, keylog, webcam, file, power) đều đi qua **consent flow** phía Agent — người dùng cuối phải xác nhận trên máy trước khi Controller nhìn thấy dữ liệu. Kiến trúc **star topology** 3 thành phần, giao tiếp qua raw WebSocket + JSON schema chốt sẵn trong `docs/protocol/`.

## 1. Kiến trúc

```
┌──────────────┐   ws://:8080/controller   ┌──────────────┐   ws://:8080/agent   ┌──────────────┐
│  Controller  │ ◄─────────────────────► │   Gateway    │ ◄──────────────────► │    Agent     │
│ (React SPA)  │      HTTPS /api/login   │ (Node.js WS) │  (nhiều Agent song   │  (C# .NET 8, │
│              │                          │              │   song)              │  Windows Tray)│
└──────────────┘                          └──────────────┘                      └──────────────┘
```

- **Controller** — React + Vite + Zustand, chạy trên trình duyệt của admin.
- **Gateway** — Node.js WebSocket relay + Express REST cho auth (JWT).
- **Agent** — C# .NET 8 tray app trên Windows, thực thi lệnh cục bộ.

Chi tiết đầy đủ: xem [`docs/design/controller/architecture.md`](docs/design/controller/architecture.md), [`docs/design/gateway/technical_design.md`](docs/design/gateway/technical_design.md), [`docs/design/agent/technical_design.md`](docs/design/agent/technical_design.md).

## 2. Tính năng chính

- **Screen live stream** với **Software Bounding Box Delta Encoding** (chỉ gửi vùng thay đổi, MD5 change-detection).
- **Remote Input** — inject chuột + phím qua Win32 `user32.dll`.
- **Keylogger** — ghi phím kèm consent + visible indicator.
- **File transfer sandbox** — WebSocket Binary Frame, chunking + SHA-256, sandbox root `C:\AgentSandbox\`.
- **Process / Application control** — list, kill process; start/stop app trong whitelist.
- **SysInfo** — CPU, RAM, disk, uptime, OS, IP realtime.
- **Power** — lock / restart / shutdown / sleep với 10s countdown phía Controller.
- **Webcam** — MJPEG stream + visible on-screen indicator khi camera bật.
- **Consent flow** — mọi module nhạy cảm yêu cầu dialog xác nhận trên Agent (timeout 30s).
- **Dynamic Policy** — Controller push whitelist / sandbox path nóng vào RAM Agent.

## 3. Yêu cầu môi trường

| Thành phần | Yêu cầu |
|---|---|
| Gateway | Node.js **18+**, npm |
| Controller | Node.js **18+**, npm, trình duyệt hiện đại (Chrome/Edge/Firefox mới) |
| Agent | Windows **10/11**, **.NET 8 SDK** (dev) hoặc .NET 8 Runtime (chạy), Visual Studio 2022 (tùy chọn) |

## 4. Hướng dẫn chạy (theo thứ tự)

```bash
git clone <repo-url>
cd remote-computer-control
```

### 4.1. Gateway (chạy trước)

```bash
cd gateway
npm install
cp .env.example .env         # chỉnh AGENT_KEY / CONTROLLER_KEY / JWT_SECRET
npm run dev                  # dev mode (auto-restart). Production: npm start
```

Mặc định lắng nghe `:8080`. Health check: `GET http://localhost:8080/health`.

### 4.2. Controller

```bash
cd controller
npm install
npm run dev                  # → http://localhost:5173
```

Mặc định app đang chạy ở chế độ `MockSocket` (mô phỏng Gateway + Agent trong trình duyệt). Để nối Gateway thật, tạo `.env` với `VITE_USE_MOCK=false` và `VITE_GATEWAY_URL=ws://<host>:8080`.

### 4.3. Agent

**Cách A — Visual Studio 2022:**
1. Mở `agent/agent.sln` bằng VS 2022.
2. Chỉnh `agent/config.json`:
   - `gateway_url` — trỏ tới Gateway (mặc định `ws://127.0.0.1:8080`).
   - `auth_key` — khớp `AGENT_KEY` trong Gateway `.env`.
   - `agent_id` — để `"AUTO"` để tự dựng từ hostname + MAC.
3. Nhấn **F5** để build + run. Agent thu mình xuống system tray.

**Cách B — CLI:**
```bash
cd agent
dotnet build
dotnet run
```

Lần đầu, nếu `gateway_url` sai, Agent bật dialog cấu hình URL.

## 5. Tài khoản test mặc định

Theo `gateway/README.md`:
- **username:** `admin`
- **password:** `admin123`

Password gốc lưu trong `gateway/src/store/users.json` dưới dạng **bcrypt hash** — thay đổi bằng script `gateway/scripts/hash-password.js`.

## 6. Cấu trúc thư mục

| Thư mục | Mô tả |
|---|---|
| [`agent/`](agent/) | Agent C# .NET 8 (Core, Modules, Managers, Forms, Utils, `agent.sln`, `config.json`) |
| [`controller/`](controller/) | Controller React + Vite (src/, public/, `vite.config.js`) |
| [`gateway/`](gateway/) | Gateway Node.js (src/, tests/, scripts/, `.env.example`) |
| [`docs/`](docs/) | Toàn bộ tài liệu (protocol, design, reports, history) — xem `docs/README.md` |

## 7. Tài liệu chi tiết

- [`docs/README.md`](docs/README.md) — mục lục docs/.
- [`docs/protocol/`](docs/protocol/) — 11 JSON schema canonical + `Instruction.md`.
- [`docs/design/agent/`](docs/design/agent/) — technical design, specification, checklist Agent.
- [`docs/design/gateway/`](docs/design/gateway/) — technical design Gateway.
- [`docs/design/controller/`](docs/design/controller/) — architecture, technical explanation, wireframe.
- [`docs/reports/evaluation.md`](docs/reports/evaluation.md) — báo cáo đánh giá tổng thể.

## 8. Credits

Đồ án nhóm — Mạng máy tính, HCMUS.

| Thành viên | Vai trò |
|---|---|
| _<tên thành viên 1>_ | Agent (C# .NET 8 Windows client) |
| _<tên thành viên 2>_ | Gateway (Node.js WebSocket relay + Auth) |
| _<tên thành viên 3>_ | Controller (React + Vite + Zustand) |
