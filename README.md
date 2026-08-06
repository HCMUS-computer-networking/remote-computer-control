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

- **End-to-end encryption (Zero-Trust)** — ECDH P-256 + HKDF + AES-256-GCM between Controller and Agent; the handshake is authenticated by a pre-shared PIN (HMAC-SHA256). UDP stream frames use a stable per-session key with a random IV and per-frame AAD (`frameId + timestamp`). The Gateway only relays ciphertext.
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
| Gateway    | Node.js **≥ 20**, npm, `openssl` (to generate the TLS cert)                  |
| Controller | Node.js **≥ 20**, npm, a modern browser (recent Chrome / Edge / Firefox)     |
| Agent      | Windows **10/11**, **.NET 8 SDK** (dev) or .NET 8 Runtime (run), Visual Studio 2022 (optional) |

## 4. How to run (WSS/TLS mode, in this order)

```bash
git clone <repo-url>
cd remote-computer-control
```

TLS/WSS is **on by default** (`TLS_ENABLED !== 'false'`); the demo runs over HTTPS/WSS. Set `TLS_ENABLED=false` only for a plain HTTP/WS dev run.

### 4.1. Gateway (start first)

Generate a self-signed certificate, then configure and start:

```bash
cd gateway
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/server.key -out certs/server.cert \
  -days 365 -subj "/CN=localhost"
cp .env.example .env          # fill CONTROLLER_KEY / AGENT_KEY / JWT_SECRET, keep TLS_ENABLED=true
npm ci
npm start                     # dev auto-reload: npm run dev
```

The cert is self-signed — open `https://<gateway-ip>:8080` once in the browser and accept the warning, otherwise the Controller's WSS connection is silently blocked. Health check: `GET https://localhost:8080/health`.

Seed an admin user and register an agent into SQLite (`src/store/data.sqlite`; `users.json` / `agents.json` are migration seeds only):

```bash
node scripts/hash-password.js "<your-password>"                  # prints a bcrypt hash
node -e "require('./src/db').queries.upsertUser('admin', '<hash>', 'admin')"
node scripts/add_agent.js <agent_id>                             # prints the agent secret to paste into agent/config.json
```

### 4.2. Controller

Create `controller/.env`:

```
VITE_GATEWAY_URL=wss://<gateway-ip>:8080
VITE_CONTROLLER_KEY=<same value as CONTROLLER_KEY>
```

```bash
cd controller
npm ci
npm run dev -- --host         # → http://localhost:5173
```

### 4.3. Agent (Windows)

```bash
cd agent
dotnet build agent.sln -c Release
```

Run the built `.exe`, then enter the E2EE master password. The Agent auto-discovers the Gateway over the LAN (UDP `:8888`), or you can type the endpoint (`wss://<gateway-ip>:8080`) manually if discovery is unavailable (different subnet, broadcast blocked). `auth_key` in `agent/config.json` must match `AGENT_KEY`, and `e2ee_shared_secret` is the PIN the Controller enters to establish E2EE.

### 4.4. Firewall (open on the Gateway host)

| Port | Proto | Purpose                              |
|------|-------|--------------------------------------|
| 8080 | TCP   | REST `/api/login` + WebSocket (WSS)  |
| 9000 | UDP   | Receives stream frames from Agents   |
| 8888 | UDP   | LAN discovery beacon                 |

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
