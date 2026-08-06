# HƯỚNG DẪN TEST NỘI BỘ — Remote Computer Control

> Tài liệu dành cho **team test nội bộ**. Giả định team **clone lại repo hoàn toàn** để bắt đầu. Đọc kèm [`README.md`](README.md) (phần cài đặt). File này đi sâu vào **chuẩn bị môi trường test, chạy mock, chạy thật, và checklist từng tính năng**.
>
> Thứ tự khởi động chuẩn của hệ thống luôn là: **Gateway → Agent → Controller**.
>
> **Nhanh nhất:** chạy `setup.ps1` là xong toàn bộ khâu chuẩn bị (sinh secret + cert + cài deps + seed admin + build agent). Mục 2 mô tả cả **đường tự động** lẫn **đường thủ công**.

---

## 0. Quy ước lệnh theo shell (ĐỌC TRƯỚC)

Máy Windows có sẵn **Windows PowerShell 5.1** (`powershell`). `pwsh` là **PowerShell 7** — phải cài thêm (`winget install --id Microsoft.PowerShell -e`). Trong tài liệu, mỗi block lệnh có **nhãn shell**; chạy đúng nhãn cho môi trường của bạn.

**Gọi `setup.ps1` — chọn theo môi trường:**

| Môi trường | Lệnh chạy setup |
|---|---|
| **Windows PowerShell 5.1** (mặc định, có sẵn) | `powershell -ExecutionPolicy Bypass -File ./scripts/setup.ps1` |
| **PowerShell 7** (`pwsh`, mọi OS) | `pwsh ./scripts/setup.ps1` |
| **Git Bash** (Windows) | `powershell -ExecutionPolicy Bypass -File ./scripts/setup.ps1` |
| **macOS / Linux** | cài `pwsh` trước, rồi `pwsh ./scripts/setup.ps1` |

Tham số (`-GatewayIp`, `-Component`, …) **giống hệt nhau** ở mọi cách gọi — chỉ khác phần đầu (`powershell -File` vs `pwsh`).

**Hai khác biệt cú pháp hay gặp** (khi tự gõ lệnh ngoài setup):

| Việc | Git Bash / macOS / Linux / PowerShell 7 | Windows PowerShell 5.1 |
|---|---|---|
| Nối 2 lệnh "chạy A rồi A xong mới chạy B" | `cd gateway && npm start` | `cd gateway; npm start` (**không** dùng `&&`) |
| Đặt biến môi trường 1 lần cho 1 lệnh | `GATEWAY_HOST=192.168.1.10 node x.js` | `$env:GATEWAY_HOST="192.168.1.10"; node x.js` |

> ⚠️ **Agent chỉ chạy trên Windows** (WinForms + Win32 API). macOS/Linux chỉ chạy được **Gateway + Controller + mock**, không chạy Agent thật.
>
> Bên dưới, các block gắn nhãn ` bash ` viết theo Git Bash/macOS (dùng `&&`); nếu bạn ở **PowerShell 5.1** thì thay `&&` bằng `;` như bảng trên.

---

## Mục lục

0. [Quy ước lệnh theo shell (ĐỌC TRƯỚC)](#0-quy-ước-lệnh-theo-shell-đọc-trước)
1. [Chuẩn bị trước khi test](#1-chuẩn-bị-trước-khi-test)
2. [Chuẩn bị môi trường (secret / cert / seed DB)](#2-chuẩn-bị-môi-trường-secret--cert--seed-db)
3. [Test build (phải PASS trước mọi thứ)](#3-test-build-phải-pass-trước-mọi-thứ)
4. [Ba chế độ test — chọn cái nào?](#4-ba-chế-độ-test--chọn-cái-nào)
5. [Chế độ A — Mock front-end (chỉ Controller)](#5-chế-độ-a--mock-front-end-chỉ-controller)
6. [Chế độ B — Mock relay Gateway](#6-chế-độ-b--mock-relay-gateway)
7. [Chế độ C — Test thật đầu-cuối (checklist từng tính năng)](#7-chế-độ-c--test-thật-đầu-cuối-checklist-từng-tính-năng)
8. [Bố trí máy: 1 / 2 / 3 máy](#8-bố-trí-máy-1--2--3-máy)
9. [Bảng xử lý sự cố](#9-bảng-xử-lý-sự-cố)
10. [Mock kiểm được gì / KHÔNG kiểm được gì](#10-mock-kiểm-được-gì--không-kiểm-được-gì)
11. [Biểu mẫu ghi nhận kết quả](#11-biểu-mẫu-ghi-nhận-kết-quả)

---

## 1. Chuẩn bị trước khi test

Mỗi máy test cài đủ theo vai trò (chi tiết bảng trong [README — Requirements](README.md#requirements)):

- **Máy Gateway/Controller:** Node.js ≥ 20, npm, Git (bản Git for Windows đã kèm sẵn OpenSSL), trình duyệt hiện đại.
- **Máy Agent:** **Windows 10/11**, .NET SDK 8, Git.

Kiểm tra nhanh (mỗi lệnh 1 dòng — chạy được ở MỌI shell):

```bash
node -v
npm -v
git --version
dotnet --version     # máy Agent — phải 8.x
```

> `setup.ps1` sẽ tự kiểm các công cụ này và báo cái nào thiếu kèm link cài; cert do `gen-cert.ps1` tự dò OpenSSL trong bản Git for Windows nên không cần cài OpenSSL riêng.

Clone repo (mọi máy tham gia):

```bash
git clone <repo-url>
cd remote-computer-control
```

> Sau khi clone, **chưa có** `gateway/.env`, `controller/.env`, chứng chỉ TLS, và **database rỗng** (chưa có user admin). Tất cả tạo ở mục 2.

---

## 2. Chuẩn bị môi trường (secret / cert / seed DB)

Có **2 đường**. Đường tự động (2.0) đủ cho hầu hết trường hợp; đường thủ công (2.1→2.6) để kiểm soát từng bước hoặc khi không có PowerShell.

### 2.0. Đường tự động — `setup.ps1` (khuyến nghị)

Trên **máy Gateway/Controller**, tại thư mục gốc repo (chọn cách gọi theo [bảng §0](#0-quy-ước-lệnh-theo-shell-đọc-trước) — ví dụ dưới dùng Windows PowerShell 5.1):

```powershell
# 1 máy (all): sinh secret + cert + deps + seed admin + build agent
powershell -ExecutionPolicy Bypass -File ./scripts/setup.ps1

# hoặc chỉ định IP LAN của Gateway khi test nhiều máy:
powershell -ExecutionPolicy Bypass -File ./scripts/setup.ps1 -GatewayIp 192.168.1.10
```

> Có PowerShell 7 thì gọn hơn: `pwsh ./scripts/setup.ps1 -GatewayIp 192.168.1.10`.

Script **sinh cả 4 secret một lần** và ghi khớp vào `gateway/.env`, `controller/.env`, `agent/config.local.json`; tạo cert; `npm ci` cả hai; seed `admin/admin123`; build agent. **Cuối cùng nó in ra các secret** (`AGENT_KEY`, `CONTROLLER_KEY`, `E2EE PIN`) — ghi lại để cấu hình máy khác.

Trên **máy Agent riêng** (Windows), dán key từ Gateway (viết 1 dòng — không xuống dòng):

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/setup.ps1 -Component agent -GatewayIp 192.168.1.10 -AgentKey <agent-key-từ-gateway> -E2eePin <pin-từ-gateway>
```

> **Lưu ý cho chế độ mock (mục 6):** `setup.ps1` sinh `AGENT_KEY` **ngẫu nhiên**, còn `mock-agent.js` mặc định gửi `agent-secret-key-2024`. Để mock-agent khớp, chạy nó với đúng key trong `.env` (xem mục 6), hoặc dùng đường thủ công 2.1 và đặt `AGENT_KEY=agent-secret-key-2024`.

Xong 2.0 thì **bỏ qua 2.1–2.3, 2.5**; chỉ cần 2.6 (accept cert) trước khi mở Controller. Muốn làm tay thì đọc tiếp:

### 2.1. Tạo `gateway/.env` (thủ công)

Làm trên **máy chạy Gateway**, tại thư mục `gateway/`.

```bash
# Git Bash / macOS / Linux
cd gateway
cp .env.example .env
```

```powershell
# Windows PowerShell
cd gateway
Copy-Item .env.example .env
```

Điền tối thiểu — sinh chuỗi mạnh (lệnh `node` giống nhau ở mọi shell):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```ini
CONTROLLER_KEY=<chuỗi-mạnh>              # BẮT BUỘC (thiếu → server thoát)
AGENT_KEY=agent-secret-key-2024         # dùng đúng giá trị này để mock-agent & agent mặc định auto-register
JWT_SECRET=<chuỗi-ngẫu-nhiên-dài>
TLS_ENABLED=true
TLS_CERT_PATH=./certs/server.cert
TLS_KEY_PATH=./certs/server.key
ALLOWED_ORIGINS=http://localhost:5173   # thêm http://<IP-máy-A>:5173 nếu test qua LAN
```

### 2.2. Sinh chứng chỉ TLS tự ký

**Cách gọn (mọi OS):** dùng script sẵn — tự dò openssl, tạo vào `gateway/certs/`:

```powershell
# Windows PowerShell 5.1 (từ thư mục gốc repo)
powershell -ExecutionPolicy Bypass -File ./scripts/gen-cert.ps1
# PowerShell 7 / macOS/Linux: pwsh ./scripts/gen-cert.ps1
```

**Hoặc chạy openssl trực tiếp** (tại thư mục `gateway/`):

```bash
# macOS / Linux (nối dòng bằng \)
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/server.key -out certs/server.cert \
  -days 365 -subj "/CN=localhost"
```

```bash
# Git Bash (Windows): DÙNG "//CN=localhost" (2 gạch) để MSYS không đổi /CN thành đường dẫn
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/server.key -out certs/server.cert \
  -days 365 -subj "//CN=localhost"
```

```powershell
# Windows PowerShell (nối dòng bằng backtick `)
New-Item -ItemType Directory -Force certs | Out-Null
openssl req -x509 -newkey rsa:2048 -nodes `
  -keyout certs/server.key -out certs/server.cert `
  -days 365 -subj "/CN=localhost"
```

> Đơn giản nhất là dùng `gen-cert.ps1` ở trên — nó xử lý sẵn các khác biệt này.

### 2.3. Seed user admin vào SQLite

```bash
node scripts/hash-password.js "admin123"
# copy chuỗi Hash rồi chạy (thay <hash>):
node -e "require('./src/db').queries.upsertUser('admin', '<hash>', 'admin')"
```

Kiểm tra đã có user:

```bash
node -e "console.log(require('./src/db').queries.getUserByUsername('admin'))"
# → in ra { id, username: 'admin', password_hash: '...', role: 'admin' }
```

### 2.4. (Tùy chọn) Đăng ký agent thủ công

Nếu **không** muốn dùng auto-register bằng `AGENT_KEY`:

```bash
node scripts/add_agent.js PC-Lab-01
# → in ra SECRET plaintext → dán vào "auth_key" trong config.json của Agent
```

### 2.5. Tạo `controller/.env`

Tại thư mục `controller/`:

```ini
VITE_GATEWAY_URL=wss://<IP-gateway>:8080
VITE_CONTROLLER_KEY=<đúng bằng CONTROLLER_KEY>
VITE_USE_MOCK=false
```

### 2.6. Chấp nhận chứng chỉ tự ký

Sau khi Gateway chạy (mục 3), mở `https://<IP-gateway>:8080/health` trên **trình duyệt operator** → chấp nhận cảnh báo self-signed **một lần**. Nếu bỏ qua, Controller login/WSS sẽ fail âm thầm.

---

## 3. Test build (phải PASS trước mọi thứ)

Chạy hết từ **thư mục gốc repo**, tất cả phải PASS. `dotnet` chạy trong `agent/` (sln `agent/agent.sln` đã gồm cả project test).

```bash
# Git Bash / macOS / Linux — nối bằng && (dừng ngay khi 1 bước fail)
cd gateway && npm ci && node --check src/server.js && node --check src/index.js
cd ../controller && npm ci && npm run build && npm run lint
cd ../agent && dotnet restore agent.sln && dotnet build agent.sln -c Release   # dotnet: chỉ máy Windows có .NET 8 SDK
```

```powershell
# Windows PowerShell — dùng ; (LƯU Ý: ; chạy hết dù có bước fail → xem kỹ output từng lệnh)
cd gateway; npm ci; node --check src/server.js; node --check src/index.js
cd ../controller; npm ci; npm run build; npm run lint
cd ../agent; dotnet restore agent.sln; dotnet build agent.sln -c Release
```

**Test unit Agent (xUnit)** — từ thư mục gốc repo:

```bash
cd agent
dotnet test agent.sln
```

Kỳ vọng: các test trong `AgentSystem.Tests/SecurityManagerTests.cs` PASS (kiểm chống path-traversal của sandbox file).

---

## 4. Ba chế độ test — chọn cái nào?

| Chế độ | Kiểm cái gì | Cần máy Windows? | Khi nào dùng |
|--------|-------------|------------------|--------------|
| **A. Mock front-end** | Chỉ UI Controller, dữ liệu giả | Không | Xem giao diện nhanh, không cần backend |
| **B. Mock relay Gateway** | Gateway lên WSS, auth, định tuyến relay | Không | Xác nhận Gateway "khỏe" trước khi ghép Agent/Controller thật |
| **C. Test thật đầu-cuối** | Toàn bộ tính năng thật (E2EE, stream, input…) | **Có** (cho Agent) | Nghiệm thu / quay demo |

Quy trình khuyến nghị: **B (xác nhận Gateway) → C (test thật)**. Chế độ A chỉ để xem UI.

---

## 5. Chế độ A — Mock front-end (chỉ Controller)

Không cần Gateway/Agent. Trong `controller/.env` đặt:

```ini
VITE_USE_MOCK=true
```

```bash
cd controller && npm ci && npm run dev -- --host
```

Mở `http://localhost:5173`. Controller dùng `MockSocket` — có agent giả + dữ liệu giả để xem luồng UI (đăng nhập, danh sách agent, mở các tab module). **Không** phản ánh hành vi mạng/E2EE thật.

> Nhớ đổi lại `VITE_USE_MOCK=false` khi chuyển sang test thật.

---

## 6. Chế độ B — Mock relay Gateway

Kiểm Gateway relay giữa "agent giả" và "controller giả" mà chưa cần Agent C# / Controller React thật.

**Điều kiện:** đã chạy `setup.ps1` (mục 2.0) hoặc làm tay mục 2.1–2.3 — nghĩa là có `.env`, đã seed `admin/admin123`, đã có cert.

> **Khớp secret cho mock-agent:** `mock-agent.js` đọc biến môi trường `AGENT_KEY` (mặc định `agent-secret-key-2024`). Nếu `.env` do `setup.ps1` sinh key ngẫu nhiên, chạy mock-agent với đúng key đó:
> ```powershell
> # Windows PowerShell
> $env:AGENT_KEY = (Select-String '^AGENT_KEY=' gateway/.env).Line.Split('=')[1]
> node gateway/tests/mock-agent.js
> ```
> ```bash
> # Git Bash / macOS / Linux
> AGENT_KEY=$(grep '^AGENT_KEY=' gateway/.env | cut -d= -f2) node gateway/tests/mock-agent.js
> ```
> hoặc chỉ cần dùng đường thủ công 2.1 với `AGENT_KEY=agent-secret-key-2024`.

Mở 3 cửa sổ terminal:

```bash
# Cửa sổ 1 — Gateway WSS
cd gateway && npm start
```
Kỳ vọng log: `port 8080` + `TLS enabled` + `[UDP] ...9000` + `[UDP Beacon] ...8888`.

```bash
# Cửa sổ 2 — Agent giả
cd gateway && node tests/mock-agent.js
```
Kỳ vọng: `✅ Connected to Gateway` → `📤 Sent REGISTER` và **không bị disconnect** (nếu bị đóng `invalid_secret` → `AGENT_KEY` trong `.env` chưa khớp `agent-secret-key-2024`).

```bash
# Cửa sổ 3 — Controller giả
cd gateway && node tests/mock-controller.js
```
Kỳ vọng flow chạy trọn:
```
✅ Logged in, JWT acquired.
📤 Sent subscribe
📤 Sending permission_request (proc_list)...
📥 permission_result (granted)
📤 Sending request (proc_list)...
📥 proc_list_result
📤 Sending stop_module...
🎉 Flow complete.
```

**Đổi host khi Gateway ở máy khác** (tại thư mục `gateway/`):

```bash
# Git Bash / macOS / Linux
GATEWAY_HOST=192.168.1.10 node tests/mock-agent.js
GATEWAY_HOST=192.168.1.10 node tests/mock-controller.js
```

```powershell
# Windows PowerShell
$env:GATEWAY_HOST="192.168.1.10"; node tests/mock-agent.js
$env:GATEWAY_HOST="192.168.1.10"; node tests/mock-controller.js
```

> ✅ **Kết luận:** `mock-controller.js` chạy trọn tới `stop_module` không lỗi ⇒ **Gateway relay khỏe**. Lúc này **tắt cả 2 mock** (`Ctrl+C`), giữ Gateway đang chạy, chuyển sang chế độ C.

---

## 7. Chế độ C — Test thật đầu-cuối (checklist từng tính năng)

### 7.1. Khởi động (đúng thứ tự)

1. **Gateway** (máy A): `cd gateway && npm start` → thấy log TLS + UDP 9000 + Beacon 8888.
2. **Agent** (máy B, Windows): chạy `agent\bin\Release\net8.0-windows\agent.exe`.
   - `config.json` cạnh exe: nếu chạy `setup.ps1` thì đã có sẵn `agent/config.local.json` — **copy nó thành `config.json`** đặt cạnh exe. Làm tay thì copy `agent/config.example.json` → `config.json`.
   - Kiểm giá trị: `gateway_url = wss://<IP-gateway>:8080`, `auth_key` = `AGENT_KEY`, `e2ee_shared_secret` = PIN sẽ dùng ở Controller.
   - Agent tự tìm Gateway qua beacon; nếu không thấy, nhập endpoint tay.
   - Nhập **master password / PIN E2EE**.
3. **Controller** (máy A): `cd controller && npm run dev -- --host` → mở `http://<IP-operator>:5173`.

### 7.2. Đăng nhập & bắt tay E2EE

| Bước | Thao tác | Kỳ vọng |
|------|----------|---------|
| Login | Đăng nhập `admin` / `admin123` | Vào được dashboard, không lỗi 401 |
| Thấy agent | Nhìn sidebar | Agent hiển thị **online** |
| E2EE | Chờ vài giây / mở agent | Trạng thái `e2ee_ready` (khóa E2EE thành công). Nếu báo *"Invalid signature / MitM"* → PIN Controller ≠ PIN Agent |

### 7.3. Checklist tính năng (nghiệm thu từng module)

Đánh dấu ✅/❌ và ghi lỗi thật vào [mục 11](#11-biểu-mẫu-ghi-nhận-kết-quả).

| # | Module | Cách test | Kết quả kỳ vọng |
|---|--------|-----------|-----------------|
| 1 | **Screen stream** | Mở tab Screen, Start | Ảnh màn hình target hiện mượt, giải mã UDP AES-GCM; kéo cửa sổ trên target thấy cập nhật |
| 2 | **Webcam** | Mở tab Webcam, Start | Có hình webcam; **chấm đỏ** hiện trên máy Agent |
| 3 | **Remote Input** | Trong Screen view, click/gõ phím | Chuột/phím tác động **máy target**; Agent có chỉ báo điều khiển |
| 4 | **File — list** | Tab File, duyệt thư mục sandbox | Liệt kê được file trong `C:\AgentSandbox\` |
| 5 | **File — get** | Tải 1 file về | Tải thành công, checksum khớp |
| 6 | **File — put** | Đẩy 1 file lên | File xuất hiện trong sandbox target |
| 7 | **File — chặn traversal** | Thử path `..\..\Windows\...` | **Bị từ chối** (không ra ngoài sandbox) |
| 8 | **Process — list** | Tab Process | Liệt kê tiến trình + CPU/RAM |
| 9 | **Process — kill thường** | Kill 1 app do bạn mở (vd notepad) | Tiến trình bị tắt, báo success |
| 10 | **Process — kill hệ thống** ⚠️ | Thử kill `lsass`/`csrss`/`system`… | **PHẢI bị từ chối** "Access Denied: Cannot terminate critical system process" (fail-closed) |
| 11 | **Application** | Start/Stop app trong whitelist (notepad/calc) | App mở/đóng trên target; app ngoài whitelist bị từ chối |
| 12 | **SysInfo** | Tab SysInfo | CPU/RAM/đĩa/uptime/OS/IP hiển thị, cập nhật |
| 13 | **Power** | Chọn Lock (an toàn nhất để test) | Máy target lock; Controller có đếm ngược |
| 14 | **Keylogger** | Start, gõ trên target | Ký tự hiện trên Controller; Agent có chỉ báo |
| 15 | **Consent flow** | Mỗi module nhạy cảm | Agent hiện popup xác nhận (timeout 30s); từ chối → Controller không nhận data |
| 16 | **Policy động** | Đổi whitelist/sandbox từ Controller | Agent áp dụng ngay, không cần restart |
| 17 | **Discovery LAN** | Tắt cấu hình tay, để Agent tự tìm | Agent tự thấy Gateway qua beacon 8888 |
| 18 | **Ngắt kết nối** | Tắt Agent giữa chừng | Controller chuyển agent **offline**, xóa badge live, reset E2EE |

> ⚠️ Test **Power shutdown/restart** cẩn thận (nên để cuối, hoặc chỉ test **Lock** để tránh phải khởi động lại máy target liên tục).

---

## 8. Bố trí máy: 1 / 2 / 3 máy

| Kịch bản | Số máy | Bố trí | Dùng khi |
|----------|--------|--------|----------|
| Smoke test | **1 máy Windows** | Gateway + Controller + Agent cùng `localhost`, dùng `wss://localhost:8080`, agent điều khiển chính nó | Kiểm luồng nhanh, **không cần mở firewall** |
| **Demo khuyến nghị** | **2 máy cùng LAN** | Máy A = Gateway + Controller (operator); Máy B (Windows) = Agent (target) | Quay video báo cáo |
| Đầy đủ | 3 máy | Gateway riêng · Operator (Controller) · Target (Agent) | Mô phỏng thật |

**Sơ đồ 2 máy (WSS):**

```
Máy A (operator, OS nào cũng được)          Máy B (TARGET — bắt buộc Windows)
┌───────────────────────────────┐           ┌──────────────────────────────┐
│ Gateway  (8080/TCP, 9000/UDP)  │◄── WSS ───│ Agent C# (WinForms)          │
│ Controller (Vite :5173, WSS)   │◄── UDP ───│  screen/webcam/input/file... │
│ Trình duyệt operator           │  9000     │  E2EE master password        │
└───────────────────────────────┘           └──────────────────────────────┘
        └──── beacon 8888/UDP (gateway broadcast → agent nghe) ────┘
```

Với **2/3 máy**: nhớ mở firewall (xem [README — Requirements](README.md#requirements): Gateway `8080/TCP` + `9000/UDP`, Agent `8888/UDP`) và đặt `VITE_GATEWAY_URL` + `gateway_url` của Agent trỏ đúng **IP LAN** máy Gateway (lấy bằng `ipconfig`). Cách gọn: chạy `setup.ps1 -GatewayIp <IP-LAN>` để mọi file cấu hình tự trỏ đúng.

---

## 9. Bảng xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|-------------|------------------------|------------|
| Gateway thoát ngay `Missing required env vars: controllerKey` | Chưa điền `CONTROLLER_KEY` | Điền vào `gateway/.env` |
| Controller login fail âm thầm (không báo lỗi rõ) | Chưa accept chứng chỉ self-signed | Mở `https://<ip>:8080/health` chấp nhận cảnh báo |
| Login trả 401 | User admin chưa seed / sai mật khẩu | Làm lại mục 2.3, kiểm bằng `getUserByUsername('admin')` |
| mock-agent bị đóng `invalid_secret` | `AGENT_KEY` env của mock ≠ `AGENT_KEY` trong `gateway/.env` (hay xảy ra khi `.env` do setup sinh key ngẫu nhiên) | Chạy mock-agent với đúng key trong `.env` (xem hộp lưu ý mục 6), hoặc dùng `.env` thủ công `agent-secret-key-2024` |
| mock-agent bị đóng `missing_credentials` | Message REGISTER thiếu `secret` | Đảm bảo đang dùng bản `mock-agent.js` mới nhất |
| mock-controller login được nhưng không nhận `permission_result` | Controller chưa `subscribe` agent | Dùng bản `mock-controller.js` mới nhất (đã tự subscribe) |
| Controller báo *"Invalid signature / MitM"* | PIN E2EE Controller ≠ `e2ee_shared_secret` của Agent | Nhập đúng PIN (mặc định `default-pin-12345`) |
| Agent không thấy Gateway | Khác subnet / broadcast bị chặn | Nhập endpoint `wss://<ip>:8080` tay trong form cấu hình Agent |
| Không có stream / màn hình đen | Cổng 9000/UDP bị firewall chặn | Mở inbound 9000/UDP trên máy Gateway |
| Agent online nhưng đổi tên lạ | `agent_id` để mặc định → tự lấy tên máy + đuôi MAC | Bình thường; đặt `agent_id` cố định nếu muốn |
| CORS bị chặn khi test LAN | `ALLOWED_ORIGINS` thiếu origin LAN | Thêm `http://<IP-máy-A>:5173` vào `ALLOWED_ORIGINS` |

---

## 10. Mock kiểm được gì / KHÔNG kiểm được gì

| Mock (chế độ B) kiểm ✅ | Mock KHÔNG kiểm ❌ (phải test thật — chế độ C) |
|--------------------------|-----------------------------------------------|
| Gateway lên WSS/TLS, cổng 8080 | Chụp màn hình/webcam thật |
| Auth: REGISTER `secret`, login JWT | UDP stream 9000 + FEC khôi phục gói mất |
| Định tuyến: `list_agents`, `subscribe`, relay 2 chiều | E2EE thật: handshake ECDH+PIN, giải mã AES-GCM trong trình duyệt |
| Kiểm envelope/param, whitelist, RBAC | Remote input tác động OS thật |
| — | File get/put, **process-kill guard**, power, keylog, sysinfo |
| — | Discovery LAN (beacon 8888), master-password/PIN |

> 🔀 **Điểm chuyển (handoff):** khi mock-controller chạy trọn flow tới `stop_module` không lỗi ⇒ tắt cả 2 mock, giữ Gateway, thay bằng Agent C# thật + Controller React thật (chế độ C).

---

## 11. Biểu mẫu ghi nhận kết quả

Copy bảng này cho mỗi buổi test:

```
Buổi test: __________  Người test: __________  Bố trí: 1 / 2 / 3 máy
Build:   Gateway [ ]  Controller [ ]  Agent [ ]  dotnet test [ ]
Mock B:  mock-agent [ ]  mock-controller flow-đủ [ ]

Tính năng (✅/❌ + ghi chú lỗi thật):
 1. Screen stream ......... [ ]  ____________________
 2. Webcam ................ [ ]  ____________________
 3. Remote input .......... [ ]  ____________________
 4. File list ............. [ ]  ____________________
 5. File get .............. [ ]  ____________________
 6. File put .............. [ ]  ____________________
 7. File chặn traversal ... [ ]  ____________________
 8. Process list .......... [ ]  ____________________
 9. Process kill thường ... [ ]  ____________________
10. Process kill hệ thống . [ ]  (phải bị từ chối)
11. Application ........... [ ]  ____________________
12. SysInfo .............. [ ]  ____________________
13. Power (Lock) .......... [ ]  ____________________
14. Keylogger ............ [ ]  ____________________
15. Consent flow ......... [ ]  ____________________
16. Policy động .......... [ ]  ____________________
17. Discovery LAN ........ [ ]  ____________________
18. Ngắt agent → offline . [ ]  ____________________
```

> Có lỗi thật thì **ghi lại log lỗi cụ thể** (copy dòng log Gateway/Agent/console trình duyệt), **đừng sửa mù** — báo về để xử lý đúng nguyên nhân.
