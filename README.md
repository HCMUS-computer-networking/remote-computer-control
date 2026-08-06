# Remote Computer Control — HCMUS Computer Networks course project

A consent-based **remote administration** tool for a lab environment: a web-based Controller monitors and controls multiple Windows Agents through a Node.js Gateway. Every sensitive action (screen stream, keylog, webcam, file, power, remote input) goes through a **consent flow** on the Agent side — the end user must confirm on their machine before the Controller sees any data. Three-tier **star topology**, WebSocket + JSON schema locked down in `docs/protocol/`.

## 1. Architecture

```
┌──────────────┐   wss://:8080/controller   ┌──────────────┐   wss://:8080/agent   ┌──────────────┐
│  Controller  │ ◄─────────────────────► │   Gateway    │ ◄──────────────────► │    Agent     │
│ (React SPA)  │      HTTPS /api/login   │ (Node.js WS) │  (many Agents in     │  (C# .NET 8, │
│              │                          │              │   parallel)          │  Windows tray)│
└──────────────┘                          └──────────────┘                      └──────────────┘
```

- **Controller** — React 19 + Vite + Zustand 5 + lucide-react + recharts, runs in the admin's browser.
- **Gateway** — Node.js WebSocket relay + Express REST for auth (JWT + bcrypt + SQLite).
- **Agent** — C# .NET 8 Windows Forms tray application, executes commands locally.

Full detail: see [`Architecture.md`](Architecture.md) and the per-subsystem design docs under [`docs/design/`](docs/design/).

## 2. Main features

- **End-to-end encryption (Zero-Trust)** — ECDH P-256 + HKDF + AES-256-GCM between Controller and Agent; the handshake is authenticated by a pre-shared PIN (HMAC-SHA256) and UDP frames use a symmetric ratchet. The Gateway only relays ciphertext.
- **Screen live stream** — bounding-box delta encoding (only changed regions sent) with periodic keyframes, over UDP with FEC parity recovery.
- **Remote Input** — inject mouse + keyboard events via Win32 `SendInput`, with an on-screen indicator on the Agent.
- **Keylogger** — consent + visible indicator, lock-free capture queue; consecutive characters grouped into a single line.
- **File transfer sandbox** — WebSocket binary frames, chunked + SHA-256, locked to a sandbox root.
- **Process / Application control** — list/kill process (critical system processes protected); start/stop apps from a whitelist.
- **SysInfo dashboard** — CPU, RAM, disk, uptime, OS, IP in near real time.
- **Power** — lock / restart / shutdown / sleep with a countdown on the Controller.
- **Webcam** — MJPEG stream with an on-screen red-dot indicator while the camera is on.
- **Consent flow** — every sensitive module requires confirmation on the Agent (30 s timeout, single-popup anti-DoS guard).
- **Dynamic policy** — the Controller pushes the app whitelist and sandbox path into Agent RAM without a restart.
- **Zero-config LAN discovery** — the Gateway broadcasts its address on UDP `:8888`; the Agent auto-discovers it, no manual endpoint needed.
- **WSS/TLS by default** — set `TLS_ENABLED=false` for plain HTTP/WS in dev.

## 3. Environment requirements

| Component  | Requirement                                                                  |
|------------|------------------------------------------------------------------------------|
| Gateway    | Node.js **18+**, npm                                                         |
| Controller | Node.js **18+**, npm, a modern browser (recent Chrome / Edge / Firefox)      |
| Agent      | Windows **10/11**, **.NET 8 SDK** (dev) or .NET 8 Runtime (run), Visual Studio 2022 (optional) |

## 4. How to run (in this order)

```bash
git clone <repo-url>
cd remote-computer-control
```

### 4.1. Gateway (start first)

```bash
cd gateway
npm install
cp .env.example .env         # set AGENT_KEY / JWT_SECRET / ALLOWED_ORIGINS
npm run dev                  # dev mode (auto-restart). Production: npm start
```

Listens on `:8080` by default. TLS/WSS is on by default: place `server.cert` + `server.key` in `gateway/certs/`, or set `TLS_ENABLED=false` in `.env` to run plain HTTP/WS for local dev. Health check: `GET <http|https>://localhost:8080/health`.

### 4.2. Controller

```bash
cd controller
npm install
npm run dev                  # → http://localhost:5173
```

By default the Controller runs against `MockSocket` (an in-browser Gateway + Agent simulator). To point at a real Gateway, create `.env.local` with `VITE_USE_MOCK=false` and `VITE_GATEWAY_URL=wss://<host>:8080`.

### 4.3. Agent

**Option A — Visual Studio 2022:**
1. Open `agent/agent.sln` in VS 2022.
2. Edit `agent/config.json`:
   - `gateway_url` — point at the Gateway (default `wss://127.0.0.1:8080`); leave empty to auto-discover the Gateway over the LAN.
   - `auth_key` — must match `AGENT_KEY` in the Gateway `.env`.
   - `e2ee_shared_secret` — the PIN the Controller must enter (after unlocking with its master password) to establish E2EE with this Agent.
   - `agent_id` — leave as `"AUTO"` to derive it from hostname + MAC.
3. Press **F5** to build and run. The Agent minimises to the system tray.

**Option B — CLI:**
```bash
cd agent
dotnet build
dotnet run
```

On first launch, if `gateway_url` is empty the Agent opens a configuration dialog.

## 5. Default test account

- **username:** `admin`
- **password:** `admin123`

The raw password is stored in `gateway/src/store/data.sqlite` as a **bcrypt hash** — rotate it with `gateway/scripts/hash-password.js`.

## 6. Directory layout

| Directory                | Description                                                                                     |
|--------------------------|-------------------------------------------------------------------------------------------------|
| [`agent/`](agent/)       | Agent C# .NET 8 (Core, Modules, Managers, Forms, Utils, `agent.sln`, `config.json`)              |
| [`controller/`](controller/) | Controller React + Vite (src/, public/, `vite.config.js`)                                    |
| [`gateway/`](gateway/)   | Gateway Node.js (src/, tests/, scripts/, `.env.example`)                                         |
| [`docs/`](docs/)         | All documentation (protocol schemas, design docs, reports)                                       |
| [`scripts/`](scripts/)   | Helper scripts (`dev-up.ps1` boots Gateway + Controller in parallel)                             |

## 7. Detailed documentation

- [`Architecture.md`](Architecture.md) — current state of the monorepo (tree, stores, data flow, protocol, conventions).
- [`docs/protocol/`](docs/protocol/) — 11 canonical JSON schemas + `Instruction.md`. Single source of truth for message format.
- [`docs/design/agent/`](docs/design/agent/) — Agent technical design, specification, checklist.
- [`docs/design/gateway/`](docs/design/gateway/) — Gateway technical design, description, internal report.
- [`docs/design/controller/`](docs/design/controller/) — Controller architecture snapshot, technical explanation notes, wireframes.
- [`docs/reports/evaluation.md`](docs/reports/evaluation.md) — overall project evaluation report.

## 8. Credits

Team project — Computer Networks, HCMUS.

| Member                    | Role                                             |
|---------------------------|--------------------------------------------------|
| _<member 1>_              | Agent (C# .NET 8 Windows client)                 |
| _<member 2>_              | Gateway (Node.js WebSocket relay + Auth)         |
| _<member 3>_              | Controller (React + Vite + Zustand)              |
