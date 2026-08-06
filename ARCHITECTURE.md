# Kiến trúc Hệ thống

> Tài liệu này mô tả **trạng thái hiện tại** của toàn bộ monorepo: cây thư mục, vai trò từng file, các store Zustand và action, luồng dữ liệu, danh sách message được hỗ trợ, tầng mã hoá đầu-cuối (E2EE), các module đã hoàn thiện và các quy ước đang được áp dụng. Cách chạy xem [`README.md`](README.md).

---

## 1. Tổng quan

```mermaid
graph LR
    Controller["<b>Controller</b><br/>React SPA<br/>(browser)"]
    Gateway["<b>Gateway</b><br/>Node.js<br/>Express + ws"]
    Agent1["<b>Agent</b> #1<br/>C# .NET 8<br/>Windows Tray"]
    Agent2["<b>Agent</b> #2"]
    AgentN["<b>Agent</b> #N"]

    Controller -- "HTTPS /api/login (JWT)" --> Gateway
    Controller <-. "WSS /controller?token=JWT<br/>E2EE JSON + binary frame" .-> Gateway
    Gateway <-. "WSS /agent (REGISTER)<br/>E2EE JSON + binary frame" .-> Agent1
    Gateway <-. WSS .-> Agent2
    Gateway <-. WSS .-> AgentN
    Agent1 == "UDP :9000<br/>(stream frame + FEC, low latency)" ==> Gateway
    Gateway -. "UDP :8888 beacon<br/>GATEWAY_ANNOUNCE" .- Agent1
```

- **Star topology** — Agent không nói chuyện trực tiếp với Controller; mọi traffic đi qua Gateway.
- **Cùng một WebSocket** vừa mang JSON control vừa mang binary frame (screen + webcam).
- **E2EE (Zero-Trust)** — Controller ⇄ Agent mã hoá đầu-cuối bằng ECDH P-256 + AES-256-GCM; Gateway chỉ relay ciphertext, **không đọc được** nội dung lệnh/response/frame.
- **UDP :9000** — Agent bắn frame stream nhanh về Gateway (kèm FEC parity) để giảm overhead WebSocket và chịu mất gói.
- **UDP :8888** — Gateway phát `GATEWAY_ANNOUNCE|wss://ip:port` mỗi 3 s; Agent lắng nghe để auto-discover Gateway trong LAN.
- **HTTPS/HTTP** — dùng cho REST `POST /api/login`, `POST /api/refresh`, `POST /api/logout`, `GET /health`, `GET /api/agents`.
- **TLS/WSS mặc định bật** (`TLS_ENABLED !== 'false'`); đặt `TLS_ENABLED=false` để chạy HTTP/WS chế độ dev.

---

## 2. Cây thư mục & vai trò từng file

### 2.1. Root
```
remote-computer-control/
├── Architecture.md            Tài liệu này
├── README.md                  Trang chủ monorepo (giới thiệu + link)
├── CONTRIBUTING.md            Quy ước đóng góp
├── CHANGELOG.md               Nhật ký phiên bản
├── LICENSE
├── docs/                      Tài liệu chung
│   ├── protocol/              Schema canonical của mọi message JSON
│   ├── design/                Thiết kế chi tiết từng subsystem
│   ├── reports/               Báo cáo đánh giá
│   └── guide.md               Hướng dẫn tổng hợp
├── scripts/                   dev-up.ps1 (khởi động cả 3 subsystem)
├── controller/                React SPA — xem 2.2
├── gateway/                   Node.js relay — xem 2.3
└── agent/                     C# tray app — xem 2.4
```

### 2.2. Controller (`controller/`)
```
controller/
├── package.json               React 19 + Vite + Zustand 5 + lucide-react + recharts + oxlint
├── vite.config.js             Vite config, `VITE_USE_MOCK` env
├── index.html
└── src/
    ├── main.jsx               ReactDOM.createRoot, mount <App/>
    ├── App.jsx                Auth gate: token null → <LoginScreen>; có token → console shell
    ├── App.css / index.css    Theme tokens + global reset
    │
    ├── components/
    │   ├── FrameCanvas.jsx        Vẽ 1 frame (ArrayBuffer) lên <canvas>. Subscribe FrameEventBus theo (agent_id, module) — nhận frame trực tiếp KHÔNG qua React state. Hỗ trợ delta encoding: keyframe resize canvas + vẽ (0,0); non-keyframe vẽ diff-rect tại (meta.x, meta.y) không reset canvas.
    │   ├── E2EEUnlockModal.jsx    Modal nhập Master Password để mở khoá kho PIN; nhập/lưu PIN cho từng agent (dùng E2EEStore).
    │   ├── LoginScreen.jsx        Form đăng nhập, gọi AuthService, lưu JWT vào sessionStorage + ConnectionStore.
    │   ├── ModuleTable.jsx        Bảng chung (sort/filter) dùng chung cho App/Process.
    │   ├── PermissionGate.jsx     HOC bọc mỗi module tab. Expose useGuardedSend + usePendingConsent qua React context — click nút gọi guardedSend(fn), nếu chưa cấp thì queue + xin quyền.
    │   ├── agents/
    │   │   ├── AgentCard.jsx      Ô hiển thị 1 agent (tên, status, checkbox multi-select).
    │   │   ├── AgentList.jsx      Danh sách agent trong Sidebar, filter theo search query.
    │   │   └── MultiSelect.jsx    Toggle chọn nhiều agent để bắn lệnh bulk.
    │   ├── layout/
    │   │   ├── Sidebar.jsx        Panel trái: logo, search, AgentList, gateway status.
    │   │   ├── TopBar.jsx         Header: tên focused agent, theme toggle, logout, trạng thái E2EE.
    │   │   └── ThemeToggle.jsx    Nút đổi light/dark theme.
    │   ├── livescreen/
    │   │   ├── GridView.jsx       Lưới thumbnail nhiều agent, dùng FrameCanvas nhỏ.
    │   │   └── FocusView.jsx      1 agent focus + tab bar 8 module + PermissionGate wrap.
    │   └── modules/               Mỗi module 1 folder, chỉ có index.jsx
    │       ├── ApplicationTab/    List/start/stop app (whitelist). Poll 3 s (silent).
    │       ├── ProcessTab/        List/kill process. Poll 3 s (silent).
    │       ├── ScreenTab/         Screenshot + start/stop stream + toggle "Điều khiển" (Remote Input).
    │       ├── KeylogTab/         Terminal log, gộp ký tự liên tiếp thành 1 dòng, Enter ngắt dòng; export .txt.
    │       ├── FileTab/           Sandbox browser, upload/download chunked binary.
    │       ├── WebcamTab/         MJPEG stream, dùng FrameCanvas với label="WEBCAM".
    │       ├── SysInfoTab/        CPU/RAM/Disk/uptime realtime. Poll 3 s (silent).
    │       └── PowerTab/          lock / restart / shutdown / sleep + countdown UI.
    │
    ├── hooks/
    │   └── UseAgentSocket.js      Singleton socket (refcount, ONE global connection). Public API: sendCommand, sendToFocused, sendToSelected, requestPermission, revokePermission, stopModule. Điều phối E2EE: bọc mọi lệnh gửi đi thành e2ee_payload, giải mã e2ee_payload nhận về, chạy handshake khi agent online, giải mã + ratchet frame UDP rồi emit sang FrameEventBus.
    │
    ├── services/
    │   ├── index.js               ONE place chọn mock vs real: `USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'`.
    │   ├── Socket.js              Wrap trình duyệt WebSocket, callback onOpen/onMessage/onBinary/onClose/onError, gắn token vào query string.
    │   ├── MockSocket.js          Sim Gateway+Agent trong browser: nhận JSON, delay, echo lại đúng schema. Sinh frame placeholder cho screen/webcam.
    │   ├── FrameEventBus.js       EventTarget nhẹ; kênh phát frame ảnh theo tên "frame_{agentId}_{module}" để FrameCanvas nhận trực tiếp, tránh re-render toàn cây React.
    │   ├── Protocol.js            Builders (buildXxx), validators, MSG_TYPE, MODULE, FEATURE, POWER_ACTION, normalizeIncoming (chuẩn hoá snake_case tên field).
    │   └── AuthService.js         POST /api/login, /api/refresh, /api/logout; xử lý refresh cookie.
    │
    ├── utils/
    │   └── crypto.js              WebCrypto helper cho E2EE: sinh cặp ECDH P-256, export/import SPKI, HMAC-SHA256 (ký PIN), HKDF-SHA256 (dẫn xuất khoá phiên TCP + UDP), AES-256-GCM encrypt/decrypt, bước ratchet SHA-256, tiện ích Base64/ArrayBuffer.
    │
    └── store/                     Zustand — xem 4.1
```

### 2.3. Gateway (`gateway/`)
```
gateway/
├── package.json               Express 5 + ws + better-sqlite3 + bcryptjs + jsonwebtoken + AJV + winston + express-rate-limit + cookie-parser + cors
├── nodemon.json               Dev auto-reload
├── certs/                     server.cert + server.key (self-signed, KHÔNG commit — gitignore)
└── src/
    ├── index.js               Boot: init DB, start server.
    ├── server.js              1 HTTP(S) server + WebSocketServer(noServer:true). Tự chọn HTTPS/WSS khi tlsEnabled. CORS whitelist + rate-limit /api/login (10/60s). Route upgrade theo pathname (/agent, /controller). Khởi động UDP :9000 + beacon :8888.
    ├── config.js              Read .env: port, allowedOrigins, JWT secret, AGENT_KEY, tlsEnabled/tlsCertPath/tlsKeyPath.
    ├── db.js                  better-sqlite3 handle + prepared statements (getUserByUsername, getUserById, refresh_tokens CRUD, agent CRUD).
    │
    ├── auth/
    │   └── login.js           POST /api/login (bcrypt verify SQLite, phát JWT + refresh cookie HttpOnly), /api/refresh, /api/logout.
    ├── middleware/
    │   └── auth.js            Verify Bearer JWT (REST) + verify JWT trong WS upgrade query (?token=).
    ├── router/
    │   └── messageRouter.js   Đọc target_agents, forward raw tới agent. Broadcast (target_agents rỗng) CHỈ cho policy_update; type khác thiếu target_agents bị reject.
    ├── socket/
    │   ├── agentHandler.js    /agent — xác thực bằng REGISTER message { agent_id, secret }; register vào agentStore; stamp agent_id rồi relay message ngược lên controllerStore (theo command_id hoặc subscriber).
    │   └── controllerHandler.js  /controller?token=JWT — verify JWT, register vào controllerStore, whitelist type (bao gồm e2ee_init/e2ee_payload) rồi route qua messageRouter.
    ├── store/
    │   ├── agentStore.js      Map<agent_id, ws> (in-RAM) + metadata agent.
    │   ├── controllerStore.js Set<ws> + subscribe/command-initiator map (in-RAM).
    │   ├── heartbeat.js       Ping loop ~30 s, đóng socket im lặng khi mất nhịp.
    │   ├── data.sqlite        Persistence chính (users, agents, refresh_tokens).
    │   ├── users.json         Seed cho migration ban đầu.
    │   └── agents.json        Seed cho migration ban đầu.
    ├── udp/
    │   ├── udpServer.js       :9000 nhận stream frame + parity từ Agent; gom chunk theo frameId; khôi phục 1 chunk mất bằng FEC XOR; forward frame_meta (JSON) + payload (binary) tới controller.
    │   ├── fecWorker.js       Worker Thread: tính XOR khôi phục chunk mất (offload khỏi event loop chính).
    │   └── beacon.js          Broadcast `GATEWAY_ANNOUNCE|wss|ws://ip:port` trên UDP :8888 mỗi 3 s.
    ├── utils/
    │   └── logger.js          Winston rolling: gateway.log + error.log.
    └── validation/
        └── commandSchemas.js  AJV schema per module để validate params trước khi forward.
```

### 2.4. Agent (`agent/`)
```
agent/
├── agent.csproj / agent.sln   .NET 8 Windows Forms
├── app.manifest               Cấu hình UIPI (uiAccess) cho tương tác input đặc quyền.
├── Program.cs                 [STAThread] Main: ConfigManager → nếu gateway_url rỗng thử NetworkDiscovery.ScanForGatewayAsync (UDP :8888), fallback GatewayConfigForm → DI container → đăng ký module → Application.Run(TrayApp).
├── config.json                agent_id, gateway_url, auth_key, e2ee_shared_secret (PIN), app_whitelist, sandbox_root_path, log_retention_days, consent_timeout_ms, tray_password.
│
├── Core/
│   ├── AgentClient.cs             Chủ ClientWebSocket + SemaphoreSlim send lock. Giữ CryptoModule; xử lý e2ee_init (verify HMAC PIN → derive khoá → trả e2ee_ready); chặn mọi lệnh khi E2EE chưa sẵn sàng (trừ policy_update/permissions_reset/e2ee_init); bọc response gửi đi thành e2ee_payload. Route command theo _moduleRegistry.
│   ├── IAgentContext.cs           Interface expose AgentId + SendResponse + Crypto cho module.
│   ├── MessageDispatcher.cs       Deserialise JSON → CommandPacket; giải mã e2ee_payload (kiểm sequence window chống replay) → RouteCommand.
│   └── WebSocketClient.cs         Low-level wrap ClientWebSocket, reconnect + heartbeat.
│
├── Managers/
│   ├── UIManager.cs               Consent popup (TCS-based, hard timeout, enum ConsentOutcome Granted/Declined/Timeout/Busy). Overlay red-dot (webcam) + blue "K" (Remote Input). ShowCountdown.
│   ├── SecurityManager.cs         App whitelist + sandbox path normalization (chống `..`) + consent gate.
│   ├── ConfigManager.cs           Load/save config.json; expose GatewayUrl, E2EESharedSecret, …
│   ├── AuditLogger.cs             Log mọi permission_request/revoke + command đã thực thi.
│   └── LogCleanupJob.cs           Timer xoá log Serilog cũ hơn log_retention_days.
│
├── Modules/                       Đều kế thừa BaseModule (IAgentContext + SecurityManager + UIManager).
│   ├── BaseModule.cs              abstract: SupportedCommands, ExecuteAsync, virtual OnDisconnected.
│   ├── CryptoModule.cs            E2EE crypto: ECDH P-256, HMAC-SHA256 (xác thực PIN), HKDF-SHA256 (khoá TCP "RemoteControl_E2EE_v1" + khoá UDP "RemoteControl_UDP_v1"), AES-256-GCM (TCP payload + UDP frame với AAD), sequence window chống replay, UDP symmetric ratchet SHA-256 mỗi 100 frame.
│   ├── AppModule.cs               app_list / app_start / app_stop (chỉ chạy app trong whitelist).
│   ├── ProcessModule.cs           proc_list / proc_kill; chặn kill tiến trình lõi hệ thống + tiến trình đặc quyền.
│   ├── KeyloggerModule.cs         keylog_start/stop + global low-level keyboard hook; batch qua ConcurrentQueue (lock-free) rồi flush theo PeriodicTimer.
│   ├── WebcamModule.cs            webcam_start/stop, MJPEG, red-dot overlay khi bật; bắn frame qua UdpStreamSender.
│   ├── FileModule.cs              fs_list / fs_get / fs_put — chunk, sha256 verify, sandbox root. HandleBinaryChunk cho upload.
│   ├── StreamModule.cs            screenshot + screen_stream/stop. Change detection + Bounding-Box Delta Encoding (LockBits unsafe). Keyframe định kỳ. Bắn frame qua UdpStreamSender.
│   ├── PowerModule.cs             lock / restart / shutdown / sleep (Win32 Shutdown API).
│   ├── SysInfoModule.cs           sysinfo — CPU/RAM/Disk/uptime/hostname/IP/OS.
│   └── InputModule.cs             input_mouse_move (fire-and-forget) / input_mouse_click / input_key / input_type qua SendInput. Overlay blue "K".
│
├── Forms/
│   ├── TrayApp.cs                 NotifyIcon + context menu (Reconfigure / Reset / Exit — có tray_password).
│   ├── MainForm.cs               Cửa sổ trạng thái/log agent.
│   ├── GatewayConfigForm.cs       Dialog nhập gateway_url + auth_key khi config trống / discovery thất bại.
│   └── PasswordPromptForm.cs      Prompt tray_password trước action nhạy cảm ở tray.
│
├── Models/
│   ├── AppConfig.cs               POCO map config.json.
│   └── CommandPacket.cs           POCO message inbound (type, command_id, module, feature, params, target_agents, publicKey, signature, seq, data).
│
├── Utils/
│   ├── ImageUtils.cs              Bitmap → JPEG, LockBits helper cho diff detection.
│   ├── NetworkDiscovery.cs        ScanForGatewayAsync: lắng nghe UDP :8888, parse GATEWAY_ANNOUNCE để tự tìm Gateway.
│   └── UdpStreamSender.cs         Chunk frame → UDP :9000; mã hoá E2EE (AAD = frameId + timestamp) khi sẵn sàng; sinh FEC parity chunk cho frame nhiều mảnh.
│
└── Logs/                          Serilog rolling daily (auto-clean).
```

---

## 3. Giao thức (Protocol)

Schema canonical: [`docs/protocol/*.json`](docs/protocol/) + [`Instruction.md`](docs/protocol/Instruction.md).

### 3.1. Ba lớp message

| Lớp | Chiều | Đặc trưng | Ví dụ |
|---|---|---|---|
| **request** | Controller → Gateway → Agent | Có `command_id`, `module`, `params`, `target_agents`. Gateway forward raw. | `{type:"request", command_id, module:"sysinfo", params:{}, target_agents:["PC-01"]}` |
| **response** | Agent → Gateway → Controller | Suffix `_result` / `_error` / `_denied`. Gateway stamp `agent_id`. | `sysinfo_result`, `fs_put_complete`, `keylog_denied`, `power_result`, `input_result` |
| **event** | Không solicited | Không có `command_id`. | `agents_list`, `agent_status`, `frame_meta` (+ binary), `keylog`, `auth_expired`, `permissions_reset` |

Khi E2EE bật, mọi message của 3 lớp trên (trừ khối handshake) được **bọc trong `e2ee_payload`** trước khi qua Gateway.

### 3.2. Danh sách message hiện được hỗ trợ

**TX (Controller → Gateway):** `list_agents`, `request`, `power`, `policy_update`, `permission_request`, `permission_revoke`, `stop_module`, `subscribe`, `unsubscribe`, `e2ee_init`, `e2ee_payload`.

**RX (Gateway/Agent → Controller):**

| Nhóm | Message types |
|---|---|
| Agent status | `agents_list`, `agent_status` |
| Application | `app_list_result`, `app_action_result` |
| Process | `proc_list_result`, `proc_kill_result` |
| Screen | `frame_meta` (+ binary frame), `stream_started`, `stream_stopped` |
| Keylog | `keylog`, `keylog_started`, `keylog_stopped`, `keylog_denied` |
| Webcam | `frame_meta` (+ binary frame), `webcam_started`, `webcam_stopped`, `webcam_denied` |
| File | `fs_list_result`, `fs_get_result` (+ binary chunk), `fs_put_result`, `fs_put_complete`, `fs_action_result`, `fs_error` |
| Power | `power_result` |
| SysInfo | `sysinfo_result` |
| Remote Input | `input_started`, `input_stopped`, `input_denied` (`reason` ∈ `"user declined" \| "timeout" \| "busy"`), `input_result` |
| Policy | `policy_update_result` |
| Permission | `permission_result`, `permissions_reset` |
| E2EE | `e2ee_ready`, `e2ee_error`, `e2ee_payload` |
| Auth | `auth_expired` |

### 3.3. `feature` vs `module`

- **feature** = permission group (đơn vị consent) — dùng trong `permission_request/revoke`. Giá trị: `application`, `process`, `screen`, `keylog`, `file`, `webcam`, `power`, `input`.
- **module** = command namespace (đơn vị lệnh) — dùng trong `request.module`: `app_list/start/stop`, `proc_list/kill`, `screenshot`, `screen_stream`, `screen_stream_stop`, `keylog_start/stop`, `webcam_start/stop`, `fs_list/get/put/delete`, `sysinfo`, `input_mouse_move/click`, `input_key`, `input_type`.

**Remote Input** dùng feature riêng `"input"` (KHÔNG dùng chung với `"screen"`).

### 3.4. Binary frame — pairing pattern

Hai kênh binary trên cùng một WS:

1. **Frame ảnh (screen / webcam)** — cặp `frame_meta` JSON + binary kế tiếp. Controller pair theo **thứ tự nhận**.
2. **File chunk (`fs_get_result`)** — cặp `fs_get_result` JSON (chứa `transfer_id` **bắt buộc**) + binary bytes kế tiếp. Controller pair theo `transfer_id` (Map) — hỗ trợ nhiều download song song.

### 3.5. Đường đi frame UDP (screen / webcam)

1. Agent chụp/encode frame → (nếu E2EE sẵn sàng) mã hoá AES-256-GCM bằng khoá UDP, AAD = `frameId(2) + timestamp(8)`.
2. Chia thành chunk ≤ 1300 byte; header UDP 24 byte cố định + agent_id/command_id. Frame nhiều chunk kèm **1 parity chunk** (index = totalChunks) = XOR toàn bộ chunk.
3. Gateway (`udpServer.js`) gom chunk theo `frameKey`; đủ chunk → ghép; thiếu đúng 1 chunk + có parity → **fecWorker** khôi phục bằng XOR; timeout 40 ms; GC frame dở sau 100 ms.
4. Gateway forward `frame_meta` (JSON) + payload (binary) tới controller.
5. Controller giải mã (nếu E2EE), bước ratchet khoá UDP theo epoch, rồi **emit sang FrameEventBus** để FrameCanvas vẽ.

**Delta encoding:** `frame_meta` screen mang `is_keyframe`, `x/y/w/h`. Keyframe = full frame (resize canvas, vẽ (0,0)); non-keyframe = diff-rect vẽ tại (x,y). Agent chèn keyframe định kỳ để tránh drift.

### 3.6. E2EE — handshake & mã hoá

- **Master Password (Controller):** mở khoá kho PIN cục bộ (IndexedDB) qua PBKDF2 (600k vòng) + AES-GCM. Mỗi agent có 1 PIN chia sẻ trước (khớp `e2ee_shared_secret` phía Agent).
- **Handshake (xác thực bằng PIN, chống MitM):**
  1. Controller → `e2ee_init { publicKey (SPKI), signature = HMAC-SHA256(publicKey, PIN) }`.
  2. Agent verify HMAC → ECDH P-256 (raw secret) → HKDF-SHA256 dẫn xuất khoá TCP + UDP → Controller nhận `e2ee_ready { publicKey, signature }` → verify HMAC → dẫn xuất cùng khoá. Từ chối → `e2ee_error`.
- **Kênh TCP (WS JSON):** mọi lệnh/response bọc `e2ee_payload { agent_id, seq, data = base64(iv[12] + ciphertext + tag[16]) }`, AES-256-GCM; **sequence sliding window (size 5)** chống replay.
- **Kênh UDP (frame):** mã hoá bằng khoá UDP, AAD = frameId + timestamp; **symmetric ratchet** `key = SHA-256(key ‖ "Ratchet_v1")` sau mỗi 100 frame (epoch) cho forward secrecy.
- **Gateway:** chỉ relay `e2ee_init`/`e2ee_payload`, **không giữ khoá, không đọc plaintext**.
- **Re-handshake:** khi agent reconnect / `permissions_reset`, hai bên reset sequence và bắt tay lại.

---

## 4. Controller — chi tiết

### 4.1. Zustand stores (7)

| Store | State | Actions |
|---|---|---|
| **AgentStore** | `agents[]`, `focused_agent_id`, `selected_agent_ids[]`, `search_query` | `setAgents`, `setAgentStatus(id, patch)`, `setFocused(id)`, `setSelectedIds(ids)`, `clearSelection`, `setSearchQuery`, getters `getFilteredAgents`, `getFocusedAgent` |
| **ConnectionStore** | `status: 'idle'\|'open'\|'closed'`, `gateway_url`, `auth_token` | `connect(url)`, `disconnect`, `setStatus`, `setGatewayUrl`, `setAuthToken`, `clearAuthToken` |
| **ModuleStore** | `data[agent_id] = { app_list, proc_list, keylog[], keylog_active, sysinfo[], screen_stream_active, webcam_active, input_active, file tree, file_downloads[transfer_id], file_put_ack }` (frame ảnh KHÔNG lưu ở store — đi qua FrameEventBus) | `setModuleData`, `appendKeylog`, `appendSysInfo`, `setScreenStreamActive`, `setWebcamActive`, `setKeylogActive`, `setInputActive`, `setFsEntries`, `appendFileDownloadChunk`, `setFilePutAck`, `clearLiveFlagsForAgent`, `clearAllLiveFlags`, … |
| **PermissionStore** | `permissions[agent_id][feature] = 'idle'\|'requesting'\|'granted'\|'denied'` | `requestPermission(id, feature)`, `setPermissionResult(id, feature, granted)`, `revoke(id, feature)`, `revokeAll(id)`, getter `getStatus(id, feature)` |
| **PolicyStore** | `app_whitelist[]`, `sandbox_path`, `last_result[agent_id]` | `setWhitelist`, `setSandboxPath`, `setPolicyResult(id, result)` |
| **UiStore** | `theme`, `layout_mode: 'grid'\|'focus'`, `active_tab`, `toasts[]` | `setTheme`, `setLayoutMode`, `setActiveTab`, `addToast(msg, variant)` |
| **E2EEStore** | `isUnlocked`, `masterKey`, `sessions[agent_id] = { state, sessionKey, udpKeyBuffer, udpEpoch, udpFrameIdOffset, udpLastSeq, sendSeq, recvSeq }` | `unlock/lock`, `saveAgentPin/getAgentPin` (IndexedDB), `setSessionState`, `resetSession`, `getSessionKey`, `getSendSeqAndIncrement`, `checkAndUpdateRecvSeq`, `updateUdpSeq`, `updateUdpRatchet` |

Mọi component subscribe **selector cụ thể** (`useStore(s => s.x)`).

### 4.2. Luồng dữ liệu: `component → hook → service → store`

**Outbound** (UI action → wire):
```
Component (onClick)
   → useGuardedSend()(fn)  ── PermissionGate: kiểm consent, queue nếu chưa cấp
       → useAgentSocket().sendCommand / sendToFocused / sendToSelected
           → services/Protocol.buildXxx()          ── build JSON đúng schema
           → (E2EE) bọc thành e2ee_payload + AES-GCM + seq
           → services/index.js (AgentSocket) → socket.send()
```

**Inbound** (wire → UI):
```
AgentSocket.onMessage(raw)
   → nếu e2ee_payload → giải mã + kiểm sequence → JSON gốc
   → normalizeIncoming → UseAgentSocket.dispatchMessage
       → switch(type) → useModuleStore / usePermissionStore / useE2EEStore / …

Binary frame:
AgentSocket.onBinary(bytes)
   → nếu _pending_fs_chunks (fs_get_result chờ) → pair theo transfer_id → appendFileDownloadChunk
   → nếu _pending_meta (frame_meta) → (E2EE) giải mã + ratchet UDP → FrameEventBus.emit(agent_id, module, frame, meta)
       → FrameCanvas (đã subscribe) vẽ canvas trực tiếp
   → ngược lại drop + warn
```

### 4.3. Pattern Mock ↔ Real socket

- `services/index.js` là **nơi DUY NHẤT** đọc `VITE_USE_MOCK`. `Socket.js` (real) và `MockSocket.js` cùng API shape (`connect/close/send`, `onOpen/onMessage/onBinary/onClose/onError`). Toàn app import `AgentSocket from '../services'`. Đổi backend chỉ cần set `VITE_USE_MOCK=false`.

### 4.4. Consent flow (PermissionGate)

1. Component gọi `guardedSend(fn)`. 2. Nếu feature đã `granted` → chạy ngay. 3. Ngược lại: queue `fn`, `requestPermission`, hiện spinner. 4. Agent trả `permission_result` → drain queue khi granted, toast lỗi khi denied. 5. Timeout 30 s → toast + clear queue. 6. Rời tab / đổi agent → auto `revokePermission` + `stopModule`.

---

## 5. Modules — trạng thái hoàn thiện

| Module | Feature | Command | Consent | Đã có |
|---|---|---|---|---|
| **Application** | `application` | `app_list`, `app_start`, `app_stop` | ✓ | List whitelist, start/stop, poll 3 s silent. |
| **Process** | `process` | `proc_list`, `proc_kill` | ✓ | List/kill PID (chặn tiến trình lõi + đặc quyền), poll 3 s silent. |
| **SysInfo** | (none) | `sysinfo` | — | CPU/RAM/Disk/uptime/hostname/IP/OS, poll 3 s, recharts sparkline. |
| **Screen** | `screen` | `screenshot`, `screen_stream`, `screen_stream_stop` | ✓ | 1-shot + live stream (delta encoding, keyframe định kỳ, FEC, E2EE UDP), countdown trước khi bật. |
| **Remote Input** | `input` | `input_mouse_move/click`, `input_key`, `input_type` | ✓ (riêng) | Nút "Điều khiển" trên ScreenTab, overlay blue "K", remap toạ độ, throttle mouse_move. |
| **Keylog** | `keylog` | `keylog_start`, `keylog_stop` | ✓ | Hook lock-free, terminal log gộp dòng, export .txt. |
| **Webcam** | `webcam` | `webcam_start`, `webcam_stop` | ✓ | MJPEG stream (FEC, E2EE UDP) + red-dot overlay Agent. |
| **File** | `file` | `fs_list`, `fs_get`, `fs_put`, `fs_delete` | ✓ | Sandbox browser, chunk + sha256, download song song, upload binary. |
| **Power** | `power` | `power` (lock/restart/shutdown/sleep) | ✓ | Countdown ở Controller trước khi bắn lệnh. |
| **Policy** | — | `policy_update` | — (broadcast) | Push `app_whitelist` + `sandbox_path` fleet-wide (type DUY NHẤT được broadcast). |

---

## 6. Quy ước (Conventions)

### 6.1. Common (MỌI subsystem — agent + gateway + controller + docs)

- **Braces Allman**: `{` mở trên **dòng riêng**, thẳng cột với statement mở khối.
- **Comment tiếng Anh**, từ đơn giản, giải thích **WHY** (invariant, workaround, ràng buộc), không WHAT. Trailing `//` liền kề **căn thẳng 1 cột**.
- **Constant thực sự**: `UPPER_SNAKE_CASE` mọi ngôn ngữ.
- **Import / using** theo cụm: stdlib → third-party → local, cách nhau 1 dòng trống.
- **KHÔNG hardcode** màu / font-size / spacing / port / path / key / timeout — luôn qua CSS var / config / env / const.
- **JSON schema (`docs/protocol/`)** là **single source of truth**; field name `snake_case`. Drift ở code phải sync lại schema trước khi merge.
- **`Architecture.md`** luôn phản ánh **TRẠNG THÁI HIỆN TẠI** — không changelog, không "đổi từ X sang Y".

### 6.2. Controller — JavaScript / JSX

- **Naming**: biến `snake_case`, hàm `camelCase`, class/component/enum `PascalCase`, constant `UPPER_SNAKE_CASE`, file `PascalCase.jsx|js`.
- **State**: chỉ **Zustand**; subscribe đúng slice; setter luôn spread giữ immutability.
- **Component** không gọi socket/fetch trực tiếp — chỉ qua `services/*` + `hooks/UseAgentSocket.js`. Frame ảnh đi qua **FrameEventBus**, không nhồi vào store.
- **Cleanup mọi `useEffect`**: interval, listener, WS handler, unsubscribe FrameEventBus, `URL.revokeObjectURL`, `ImageBitmap.close()`.
- **UI copy** cho operator: tiếng **Việt**; comment code tiếng Anh.
- **Lint** `oxlint`: giữ pass.

### 6.3. Gateway — JavaScript (Node.js)

- **Naming**: biến `snake_case`, hàm `camelCase`, class `PascalCase`, constant `UPPER_SNAKE_CASE`. File `camelCase.js` (di sản, không mass-rename).
- **`const`** cho giá trị không reassign; `async/await` + try/catch quanh I/O.
- **Validation**: command JSON qua `messageRouter` phải whitelist type; params nhạy cảm validate AJV.
- **Không log** payload chứa credential/token.
- **State** chỉ ở SQLite (`db.js` prepared statements) + Map/Set in-RAM (`store/*.js`).

### 6.4. Agent — C# .NET 8

- **Naming .NET**: class/method/property/public field `PascalCase`; private field `_camelCase`; local/param `camelCase`; interface `IPascalCase`; enum `PascalCase`; const `UPPER_SNAKE_CASE`.
- **Async** `Task` + `PeriodicTimer` (không `Thread.Sleep` trong vòng lặp); critical section async → `SemaphoreSlim`.
- **Resource** `using`/`IDisposable` cho Bitmap, WebSocket, PerformanceCounter, CancellationTokenSource, `AesGcm`.
- **P/Invoke** khu trú ở `InputModule`, `KeyloggerModule`, `Utils/*`; signature khớp Win32, comment WHY.
- **DI**: Managers Singleton, Modules Transient (`Program.cs`).
- **Logging** Serilog rolling; không log secret / khoá.

### 6.5. E2EE / Crypto (cross-cutting)

- Tham số phải **khớp tuyệt đối** hai phía: ECDH **P-256**, HKDF-SHA256 với `info` `"RemoteControl_E2EE_v1"` (TCP) / `"RemoteControl_UDP_v1"` (UDP), salt rỗng; AES-256-GCM IV 12 byte + tag 16 byte; ratchet `SHA-256(key ‖ "Ratchet_v1")` mỗi 100 frame.
- Handshake xác thực bằng **HMAC-SHA256(publicKey, PIN)** — không bỏ verify.
- Gateway **không bao giờ** giữ khoá / đọc plaintext. PIN/khoá không log, không đưa vào URL.
- Khoá phiên xoá (zeroize) khi Dispose/Reset.

### 6.6. Auth & transport

- JWT lưu `sessionStorage` (Controller) + refresh_token cookie HttpOnly. Gateway verify JWT ở WS `?token=`.
- Agent xác thực qua **REGISTER message** `{ agent_id, secret }` sau khi mở WS `/agent`.
- **WSS/TLS mặc định**; cert local để trong `gateway/certs/` và **không commit**.

### 6.7. Sandbox, whitelist, consent, broadcast

- File: mọi `fs_*` hard-lock trong `sandbox_root_path`, normalize chống `..`.
- Application: chỉ app trong `app_whitelist` được `app_start`; push nóng qua `policy_update`.
- Consent timeout 30 s; popup đang mở → request mới cùng feature auto-reject (`Busy`); reset quyền khi disconnect.
- `messageRouter` chỉ cho `target_agents` rỗng khi `type === 'policy_update'`.

---

## 7. Persistence

| Thành phần | Nơi lưu | Nội dung |
|---|---|---|
| Gateway — SQLite | `gateway/src/store/data.sqlite` | `users` (username, password_hash bcrypt, role), `agents` (agent_id, secret_hash, display_name), `refresh_tokens`. |
| Gateway — seed | `store/users.json`, `store/agents.json` | Chỉ cho migration; runtime không đọc. |
| Gateway — in-RAM | `Map<agent_id, ws>` + `Set<controller_ws>` | Session, xoá khi restart. |
| Gateway — logs | `logs/gateway.log`, `logs/error.log` | Winston rolling. |
| Gateway — certs | `gateway/certs/server.key|.cert` | Self-signed TLS, gitignore. |
| Agent — config | `agent/config.json` | agent_id, gateway_url, auth_key, e2ee_shared_secret, app_whitelist, sandbox_root_path, … |
| Agent — audit log | `agent/Logs/agent-YYYYMMDD.log` | Serilog rolling daily, auto-clean. |
| Controller — PIN vault | IndexedDB `RemoteControl_E2EE` | PIN từng agent, mã hoá AES-GCM dưới Master Password (PBKDF2). |
| Controller — session | `sessionStorage` (JWT) + refresh cookie HttpOnly | Zustand + khoá phiên E2EE hoàn toàn in-memory. |

---

## 8. Nơi tra cứu

- Schema JSON: [`docs/protocol/`](docs/protocol/) — nguồn duy nhất cho tên field.
- Thiết kế Controller: [`docs/design/controller/architecture.md`](docs/design/controller/architecture.md).
- Thiết kế Gateway: [`docs/design/gateway/technical_design.md`](docs/design/gateway/technical_design.md).
- Thiết kế Agent: [`docs/design/agent/technical_design.md`](docs/design/agent/technical_design.md).
- Đánh giá & bug còn mở: [`docs/reports/evaluation.md`](docs/reports/evaluation.md).
