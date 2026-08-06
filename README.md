# Remote Computer Control

[![CI](https://github.com/HCMUS-computer-networking/remote-computer-control/actions/workflows/ci.yml/badge.svg)](https://github.com/HCMUS-computer-networking/remote-computer-control/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Agent](https://img.shields.io/badge/Agent-C%23%20.NET%208-512BD4)
![Gateway](https://img.shields.io/badge/Gateway-Node.js%20%E2%89%A520-339933)
![Controller](https://img.shields.io/badge/Controller-React%20%2B%20Vite-61DAFB)

A consent-based, end-to-end encrypted **remote administration** system: a web **Controller** monitors and controls many Windows **Agents** through a Node.js **Gateway** that relays _ciphertext only_. Every sensitive action is confirmed on the Agent machine first — HCMUS Computer Networks course project.

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

Three-tier **star topology** — Agents never talk to the Controller directly; all traffic passes through the Gateway, which relays **encrypted** payloads it cannot read. Full design in [`Architecture.md`](Architecture.md).

## Features

- **End-to-end encryption (Zero-Trust)** — ECDH P-256 + HKDF + AES-256-GCM, PIN-authenticated handshake; the Gateway relays ciphertext only.
- **Multi-agent control** — select agents in the sidebar to drive them together; grid-capable modules (screen, webcam, keylog, power, sysinfo) show a live per-agent grid, and batch actions fan out to the selected agents (each still confirms consent on its own machine).
- **Screen live stream** — bounding-box delta encoding + keyframes over UDP with FEC parity recovery.
- **Remote input** — mouse + keyboard injection via Win32 `SendInput`, with an on-screen indicator.
- **Keylogger** — consent + visible indicator, lock-free capture.
- **File transfer** — chunked + SHA-256, locked to a sandbox root.
- **Process / Application control** — list/kill process (critical processes protected); start/stop whitelisted apps.
- **SysInfo dashboard** — CPU / RAM / disk / uptime / OS / IP in near real time.
- **Power** — lock / restart / shutdown / sleep with a Controller-side countdown.
- **Webcam** — MJPEG stream with an on-screen red-dot indicator.
- **Consent flow** — every sensitive module confirmed on the Agent (30 s timeout, single-popup guard).
- **Zero-config LAN discovery** — Gateway broadcasts on UDP `:8888`; the Agent auto-discovers it.
- **WSS/TLS by default** — set `-NoTls` (or `TLS_ENABLED=false`) for plain HTTP/WS in dev.

## Requirements

| Component  | Requirement                                                       |
| ---------- | ----------------------------------------------------------------- |
| Gateway    | Node.js **≥ 20**, npm, openssl _(bundled with Git for Windows)_   |
| Controller | Node.js **≥ 20**, npm, a modern browser (Chrome / Edge / Firefox) |
| Agent      | Windows **10/11**, **.NET 8 SDK**                                 |
| Bootstrap  | PowerShell (built into Windows) or [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell) on macOS/Linux |

**Firewall** — Gateway host: `8080/TCP`, `9000/UDP`; Agent host: `8888/UDP`.

## Setup (one command)

Clone, then run the bootstrap script from the repo root. It generates all secrets + a TLS cert, installs dependencies, seeds the admin account, builds the Agent, and prints the secrets.

```bash
git clone https://github.com/HCMUS-computer-networking/remote-computer-control.git
cd remote-computer-control
```

| Shell                             | Command                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| Windows PowerShell 5.1 · Git Bash | `powershell -ExecutionPolicy Bypass -File ./scripts/setup.ps1 -E2eePin default-pin-12345` |
| PowerShell 7 (`pwsh`, any OS)     | `pwsh ./scripts/setup.ps1 -E2eePin default-pin-12345`                                     |

> **`-E2eePin default-pin-12345` is required for the demo to work out of the box.** The Controller currently authenticates the E2EE handshake with the built-in PIN `default-pin-12345` (a per-agent PIN-entry UI is not wired yet), so the Agent's PIN must match. Omit the flag and `setup.ps1` generates a random PIN that the Controller cannot use, and the handshake fails.

Useful flags: `-GatewayIp <ip>` (multi-machine), `-Force` (regenerate secrets/cert), `-Component gateway|controller|agent` (set up one role only). `-NoTls` (plain HTTP/WS) applies to the Gateway only — the Controller dev server always serves HTTPS (`vite.config.js` reads `gateway/certs/*`), so keep TLS on for the standard flow below.

## Run

Start each tier **in this order — Gateway → Controller → Agent**, each in **its own terminal**. `setup.ps1` already installed the dependencies, so these commands only launch the tiers.

**1 — Gateway** (terminal 1) — serves `https://localhost:8080`. Open `https://localhost:8080/health` once and accept the self-signed certificate.

```bash
# Git Bash
cd gateway && npm start
```

```powershell
# PowerShell
cd gateway; npm start
```

**2 — Controller** (open a new terminal) — serves `https://localhost:5173`.

```bash
# Git Bash
cd controller && npm run dev -- --host
```

```powershell
# PowerShell
cd controller; npm run dev -- --host
```

**3 — Agent** (open a new terminal, Windows only). `setup.ps1` writes `agent/config.local.json`; the Agent loads `config.json` from **beside its exe**, so copy it there first, then run the exe (right-click **Run as Administrator** to exercise UAC-gated features — Remote Input, Keylogger):

```bash
# Git Bash
cp agent/config.local.json agent/bin/Release/net8.0-windows/config.json
./agent/bin/Release/net8.0-windows/agent.exe
```

```powershell
# PowerShell
Copy-Item agent\config.local.json agent\bin\Release\net8.0-windows\config.json
.\agent\bin\Release\net8.0-windows\agent.exe
```

From source instead of the built exe: `dotnet run --project agent -c Release` (in that case put the copy at `agent/config.json`). The copied config must keep `"e2ee_shared_secret": "default-pin-12345"` (it already does if you ran `setup.ps1 -E2eePin default-pin-12345`) so the E2EE handshake matches the Controller.

Then, in the Controller browser tab (`https://localhost:5173`):

1. Because the TLS cert is self-signed, accept the browser warning for the Controller page **and** open `https://localhost:8080/health` once to accept the Gateway cert (the live WebSocket connects straight to `:8080`).
2. Log in with `admin` / `admin123`.
3. In the **E2EE Master Password** modal, enter **any** password — it only encrypts the local PIN vault in your browser. The handshake then runs automatically using PIN `default-pin-12345` and unlocks each Agent whose config uses that PIN.

For a multi-machine run, on the Agent machine run `setup.ps1 -Component agent -GatewayIp <gateway-ip> -AgentKey <key> -E2eePin default-pin-12345` (the `AGENT_KEY` is printed on the Gateway machine) and copy `agent/config.local.json` → `config.json` next to the exe as above. Prefer configuring by hand? See [`docs/guide.md`](docs/guide.md).

> A fresh clone carries **no live secrets** — all `.env`, certs, DB, and Agent config are gitignored and generated locally (details in [`Architecture.md` §8](Architecture.md#8-mô-hình-bảo-mật--secret)).

## Default test account

- **username:** `admin` — **password:** `admin123` (seeded as a bcrypt hash; change it with `gateway/scripts/hash-password.js`).

## Repository layout

| Directory                                  | Description                                               |
| ------------------------------------------ | --------------------------------------------------------- |
| [`agent/`](agent/)                         | Agent — C# .NET 8 (Core, Modules, Managers, Forms, Utils) |
| [`controller/`](controller/)               | Controller — React + Vite + Zustand                       |
| [`gateway/`](gateway/)                     | Gateway — Node.js WebSocket relay + Auth                  |
| [`AgentSystem.Tests/`](AgentSystem.Tests/) | .NET unit tests (xUnit) for the Agent                     |
| [`docs/`](docs/)                           | Protocol schemas, design docs, reports                    |
| [`scripts/`](scripts/)                     | `setup.ps1`, `gen-cert.ps1`, `dev-up.ps1`                 |

## Documentation

- [`Architecture.md`](Architecture.md) — current state of the monorepo: directory tree, Zustand stores, data flow, message list, protocol, conventions, security model.
- [`docs/protocol/`](docs/protocol/) — canonical JSON message schemas (single source of truth).
- Per-subsystem design: [`docs/design/agent/`](docs/design/agent/) · [`docs/design/gateway/`](docs/design/gateway/) · [`docs/design/controller/`](docs/design/controller/).

## Development — Mock mode (no Agent build needed)

The Controller ships with an in-browser **mock** (`controller/src/services/MockSocket.js`) that plays the **Gateway relay + several fake Agents** on the data plane: it runs the *real* E2EE handshake, decrypts commands, simulates consent popups, and streams synthetic screen/webcam frames. Use it to develop or demo the Controller UI (multi-agent grids, consent, feeds) **without building or running any C# Agent**.

> **Login still uses the real Gateway** — authentication is not mocked. So you run the Gateway (for `POST /api/login`) and the Controller in mock mode; **no Agent is needed**. There is no separate standalone Gateway mock — the Controller's mock stands in for the Gateway data plane *and* the Agents.

**Terminal 1 — Gateway** (needed only so login works):

```bash
# Git Bash
cd gateway && npm start
```

```powershell
# PowerShell
cd gateway; npm start
```

**Terminal 2 — Controller in mock mode** — open a **new terminal** and set `VITE_USE_MOCK=true` inline. This overrides the `VITE_USE_MOCK=false` that `setup.ps1` wrote into `controller/.env`, so no file edit is needed:

```bash
# Git Bash — new terminal
cd controller && VITE_USE_MOCK=true npm run dev -- --host
```

```powershell
# PowerShell — new terminal
cd controller; $env:VITE_USE_MOCK = 'true'; npm run dev -- --host
```

Then open `https://localhost:5173` and:

1. Log in with `admin` / `admin123` (this hits the real Gateway).
2. In the **E2EE Master Password** modal, enter any password — the mock uses the default PIN `default-pin-12345`, so the handshake completes for every fake agent.
3. Several simulated agents appear. One (`PC-Lab-06`) always **declines** consent so you can test the denied flow. SysInfo, Screen, Webcam, Keylog, Process, Application, File, and Power all respond end-to-end.

To go back to real mode, run the Controller without the override (`npm run dev -- --host` — Git Bash, or `cd controller; npm run dev -- --host` — PowerShell); it reads `VITE_USE_MOCK=false` from `controller/.env` and talks to the real Gateway + Agents again.

## Credits

Team project — Computer Networks, HCMUS.

| Member                 | Role                                     |
| ---------------------- | ---------------------------------------- |
| _Nguyen Ba Duy_        | Agent (C# .NET 8 Windows client)         |
| _Trinh Tran Huong Mai_ | Gateway (Node.js WebSocket relay + Auth) |
| _Thai Mac Tuong Vi_    | Controller (React + Vite + Zustand)      |

Licensed under the [MIT License](LICENSE).
