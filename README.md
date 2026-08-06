# Remote Computer Control — HCMUS Computer Networks course project

A consent-based **remote administration** system: a web **Controller** monitors and controls multiple Windows **Agents** through a Node.js **Gateway**, with end-to-end encryption so the Gateway only relays ciphertext. Every sensitive action requires the end user to confirm on the Agent machine first.

## Architecture

```
┌──────────────┐   wss://:8080/controller   ┌──────────────┐   wss://:8080/agent   ┌──────────────┐
│  Controller  │ ◄─────────────────────►    │   Gateway    │ ◄──────────────────►  │    Agent     │
│  (React SPA) │      HTTPS /api/login      │ (Node.js WS) │  (many Agents in      │ (C# .NET 8,  │
│              │                            │              │   parallel)           │ Windows tray)│
└──────────────┘                            └──────────────┘                       └──────────────┘
        ▲                                          │ 9000/UDP  ◄── stream ────────────────┘
        │                                          │ 8888/UDP  ── beacon discovery ──────►
```

Three-tier **star topology** — Agents never talk to the Controller directly; all traffic passes through the Gateway. Full design: see [`Architecture.md`](Architecture.md).

## Features

- **End-to-end encryption (Zero-Trust)** — ECDH P-256 + HKDF + AES-256-GCM, PIN-authenticated handshake; Gateway relays ciphertext only.
- **Screen live stream** — bounding-box delta encoding + keyframes over UDP with FEC parity recovery.
- **Remote input** — mouse + keyboard injection via Win32 `SendInput`, with an on-screen indicator.
- **Keylogger** — consent + visible indicator, lock-free capture.
- **File transfer** — chunked + SHA-256, locked to a sandbox root.
- **Process / Application control** — list/kill process (critical system processes protected); start/stop whitelisted apps.
- **SysInfo dashboard** — CPU / RAM / disk / uptime / OS / IP in near real time.
- **Power** — lock / restart / shutdown / sleep with a Controller-side countdown.
- **Webcam** — MJPEG stream with an on-screen red-dot indicator.
- **Consent flow** — every sensitive module confirmed on the Agent (30 s timeout, single-popup guard).
- **Dynamic policy** — push app whitelist + sandbox path into Agent RAM without a restart.
- **Zero-config LAN discovery** — Gateway broadcasts on UDP `:8888`; the Agent auto-discovers it.
- **WSS/TLS by default** — set `TLS_ENABLED=false` for plain HTTP/WS in dev.

## Requirements

| Component  | Requirement                                                             |
|------------|-------------------------------------------------------------------------|
| Gateway    | Node.js **≥ 20**, npm, `openssl` (to generate the TLS cert)             |
| Controller | Node.js **≥ 20**, npm, a modern browser (Chrome / Edge / Firefox)       |
| Agent      | Windows **10/11**, **.NET 8 SDK**                                       |

## How to run

TLS/WSS is **on by default**. Start in this order: **Gateway → Controller → Agent**.

```bash
git clone <repo-url>
cd remote-computer-control
```

There are 4 shared secrets to set: `CONTROLLER_KEY` (same value in `gateway/.env` and `controller/.env`), `AGENT_KEY` (same value in `gateway/.env` and the Agent's `config.json` `auth_key`), `JWT_SECRET` (Gateway only), and the **E2EE PIN** (Agent `config.json` `e2ee_shared_secret`, entered on the Controller to unlock). Generate a strong value with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### 1. Gateway

```bash
cd gateway
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/server.key -out certs/server.cert -days 365 -subj "/CN=localhost"
cp .env.example .env        # set CONTROLLER_KEY (required), AGENT_KEY, JWT_SECRET; keep TLS_ENABLED=true
npm ci
node scripts/hash-password.js "admin123"                                   # copy the printed hash
node -e "require('./src/db').queries.upsertUser('admin', '<hash>', 'admin')"   # seed the admin user
npm start
```

Open `https://<gateway-ip>:8080/health` once and accept the self-signed cert, otherwise the Controller's WSS connection fails silently.

### 2. Controller

Create `controller/.env`:

```ini
VITE_GATEWAY_URL=wss://<gateway-ip>:8080
VITE_CONTROLLER_KEY=<same as CONTROLLER_KEY>
VITE_USE_MOCK=false          # true = front-end mock (no Gateway/Agent needed)
```

```bash
cd controller && npm ci && npm run dev -- --host      # → http://localhost:5173
```

### 3. Agent (Windows)

```bash
cd agent && dotnet build agent.sln -c Release
```

Run `agent\bin\Release\net8.0-windows\agent.exe`. On first run it creates `config.json` next to the exe — set `gateway_url`, `auth_key` (= `AGENT_KEY`), and `e2ee_shared_secret` (the E2EE PIN). The Agent auto-discovers the Gateway over the LAN (UDP `:8888`), or you can enter the endpoint manually.

**Firewall** (Gateway host): `8080/TCP`, `9000/UDP`; on the Agent host open `8888/UDP` for the discovery beacon.

**Mock vs real:** set `VITE_USE_MOCK=true` in `controller/.env` to run the Controller against an in-browser mock (no Gateway/Agent needed); `false` connects to the real Gateway.

## Default test account

- **username:** `admin`
- **password:** `admin123`

Stored as a bcrypt hash in `gateway/src/store/data.sqlite`; rotate with `gateway/scripts/hash-password.js`.

## Directory layout

| Directory | Description |
|-----------|-------------|
| [`agent/`](agent/) | Agent C# .NET 8 (Core, Modules, Managers, Forms, Utils, `agent.sln`) |
| [`controller/`](controller/) | Controller React + Vite (src/, `vite.config.js`) |
| [`gateway/`](gateway/) | Gateway Node.js (src/, tests/, scripts/, `.env.example`) |
| [`AgentSystem.Tests/`](AgentSystem.Tests/) | .NET unit tests (xUnit) for the Agent |
| [`docs/`](docs/) | Protocol schemas, design docs, reports |
| [`scripts/`](scripts/) | Helper scripts (`dev-up.ps1`) |

## Documentation

- [`Architecture.md`](Architecture.md) — current state of the monorepo (directory tree, Zustand stores, data flow, protocol, conventions).
- [`docs/protocol/`](docs/protocol/) — canonical JSON message schemas (single source of truth).
- [`docs/design/agent/`](docs/design/agent/), [`docs/design/gateway/`](docs/design/gateway/), [`docs/design/controller/`](docs/design/controller/) — per-subsystem design docs.

## Credits

Team project — Computer Networks, HCMUS.

| Member | Role |
|--------|------|
| _<member 1>_ | Agent (C# .NET 8 Windows client) |
| _<member 2>_ | Gateway (Node.js WebSocket relay + Auth) |
| _<member 3>_ | Controller (React + Vite + Zustand) |
