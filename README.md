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

Three-tier **star topology** — Agents never talk to the Controller directly; all traffic passes through the Gateway. Full design in [`Architecture.md`](Architecture.md).

## Features

- **End-to-end encryption (Zero-Trust)** — ECDH P-256 + HKDF + AES-256-GCM, PIN-authenticated handshake; the Gateway relays ciphertext only.
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
- **WSS/TLS by default** — set `TLS_ENABLED=false` for plain HTTP/WS in dev.

## Requirements

| Component  | Requirement                                                       |
| ---------- | ----------------------------------------------------------------- |
| Gateway    | Node.js **≥ 20**, npm, openssl _(bundled with Git for Windows)_   |
| Controller | Node.js **≥ 20**, npm, a modern browser (Chrome / Edge / Firefox) |
| Agent      | Windows **10/11**, **.NET 8 SDK**                                 |

**Firewall** — Gateway host: `8080/TCP`, `9000/UDP`; Agent host: `8888/UDP`.

## Run

```bash
git clone https://github.com/HCMUS-computer-networking/remote-computer-control.git
cd remote-computer-control
```

Run the bootstrap script. It needs **PowerShell** — bundled on Windows; on macOS/Linux install [PowerShell 7](https://learn.microsoft.com/powershell/scripting/install/installing-powershell):

| Shell                             | Command                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| Windows PowerShell 5.1 · Git Bash | `powershell -ExecutionPolicy Bypass -File ./scripts/setup.ps1` |
| PowerShell 7 (`pwsh`, any OS)     | `pwsh ./scripts/setup.ps1`                                     |

`setup.ps1` generates all secrets + TLS cert, installs deps, seeds admin, builds the Agent, and prints the secrets. Add `-GatewayIp <ip>` for a multi-machine run, `-NoTls` for plain HTTP.

Then start each tier **in this order — Gateway → Controller → Agent** (each in its own terminal):

```bash
cd gateway && npm start                    # 1. https://localhost:8080  (open /health once, accept the self-signed cert)
cd controller && npm run dev -- --host     # 2. https://localhost:5173
# 3. run agent/bin/Release/net8.0-windows/agent.exe  (copy config.local.json → config.json beside it)
```

> On **Windows PowerShell 5.1** replace `&&` with `;` (it lacks `&&`). The Agent runs on Windows only; macOS/Linux can host the Gateway + Controller.

Log in on the Controller, then enter the **E2EE PIN** to unlock an agent. Prefer configuring by hand? See [`docs/guide.md`](docs/guide.md). A fresh clone carries **no live secrets** — all `.env`, certs, DB, and Agent config are gitignored and generated locally (details in [`Architecture.md` §8](Architecture.md#8-mô-hình-bảo-mật--secret)).

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

## Credits

Team project — Computer Networks, HCMUS.

| Member                 | Role                                     |
| ---------------------- | ---------------------------------------- |
| _Nguyen Ba Duy_        | Agent (C# .NET 8 Windows client)         |
| _Trinh Tran Huong Mai_ | Gateway (Node.js WebSocket relay + Auth) |
| _Thai Mac Tuong Vi_    | Controller (React + Vite + Zustand)      |

Licensed under the [MIT License](LICENSE).
