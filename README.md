# Remote Computer Control

[![CI](https://github.com/HCMUS-computer-networking/remote-computer-control/actions/workflows/ci.yml/badge.svg)](https://github.com/HCMUS-computer-networking/remote-computer-control/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Agent](https://img.shields.io/badge/Agent-C%23%20.NET%208-512BD4)
![Gateway](https://img.shields.io/badge/Gateway-Node.js%20%E2%89%A520-339933)
![Controller](https://img.shields.io/badge/Controller-React%20%2B%20Vite-61DAFB)

A consent-based, end-to-end encrypted **remote administration** system for Windows: a web **Controller** monitors and controls Windows **Agents** through a Node.js **Gateway** that relays _ciphertext only_. Every sensitive action is confirmed on the Agent machine first — HCMUS Computer Networks course project.

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

- **End-to-end encryption (Zero-Trust)** — ECDH P-256 + HKDF + AES-256-GCM, PIN-authenticated handshake.
- **Multi-agent control** — select agents in the sidebar to drive them together; grid-capable modules show live per-agent feeds.
- **Screen live stream** — bounding-box delta encoding + keyframes over UDP with FEC parity recovery.
- **Remote input** — mouse + keyboard injection via Win32 `SendInput`, with an on-screen indicator.
- **Keylogger** — consent + visible indicator, lock-free capture.
- **File transfer** — chunked + SHA-256, locked to a sandbox root.
- **Process / Application control** — list/kill process (critical processes protected); start/stop whitelisted apps.
- **SysInfo dashboard** — CPU / RAM / disk / uptime / OS / IP in near real time.
- **Power** — lock / restart / shutdown / sleep with a Controller-side countdown.
- **Webcam** — MJPEG stream with an on-screen red-dot indicator.
- **Consent flow** — every sensitive module confirmed on the Agent (30 s timeout, single-popup guard).
- **Agent dashboard** — live connection state and active controlled modules, with disconnect controls.
- **Zero-config LAN discovery** — Gateway broadcasts on UDP `:8888`; the Agent auto-discovers it.

## Requirements (Windows 10 / 11)

- **Node.js ≥ 20** + **npm**
- **.NET 8 SDK**
- **Git for Windows** (bundles `openssl`)
- **PowerShell** (built into Windows)

## Setup

Open PowerShell as Administrator in the repository root and run:

```powershell
powershell -ExecutionPolicy Bypass -File ./scripts/setup.ps1 -E2eePin default-pin-12345
```

This single command automatically:
1. Detects your machine's primary LAN IPv4 address (e.g., `192.168.1.x`).
2. Generates shared secrets and self-signed TLS certificates for LAN & localhost.
3. Installs Gateway and Controller Node.js dependencies.
4. Seeds the default `admin` account.
5. Builds the C# Agent in Release mode and populates `config.json` files.

## Run

### Option 1: All-in-one Launcher (Recommended)

Run the parallel launcher script in PowerShell:

```powershell
pwsh ./scripts/dev-up.ps1
```

### Option 2: Manual Terminal Launch

Open **three separate PowerShell terminals**:

**Terminal 1 — Gateway**
```powershell
cd gateway; npm start
```

**Terminal 2 — Controller**
```powershell
cd controller; npm run dev -- --host
```

**Terminal 3 — Agent** (Run as Administrator)
```powershell
.\agent\bin\Release\net8.0-windows\agent.exe
```

## Using the Controller

1. Open `https://<YOUR_LAN_IP>:5173` (or `https://localhost:5173`) in your browser and accept the self-signed certificate.
2. Open `https://<YOUR_LAN_IP>:8080/health` once in the browser to accept the Gateway TLS certificate.
3. Log in with:
   - **Username:** `admin`
   - **Password:** `admin123`
4. Enter **any** password in the **E2EE Master Password** modal. The E2EE handshake will automatically unlock connected Agents using PIN `default-pin-12345`.

> **Note**: To stop the Agent completely, right-click the shield icon in the Windows System Tray (bottom-right taskbar) and select **Exit**.

## Repository Layout

| Directory                                  | Description                                               |
| ------------------------------------------ | --------------------------------------------------------- |
| [`agent/`](agent/)                         | Agent — C# .NET 8 (Core, Modules, Managers, Forms, Utils) |
| [`controller/`](controller/)               | Controller — React + Vite + Zustand                       |
| [`gateway/`](gateway/)                     | Gateway — Node.js WebSocket relay + Auth                  |
| [`AgentSystem.Tests/`](AgentSystem.Tests/) | .NET unit tests (xUnit) for the Agent                     |
| [`docs/`](docs/)                           | Protocol schemas and design documentation                 |
| [`scripts/`](scripts/)                     | `setup.ps1`, `gen-cert.ps1`, `dev-up.ps1`                 |

## Documentation

- [`Architecture.md`](Architecture.md) — Topology, state management, message routing, protocol specifications, and security model.

## Credits

HCMUS Computer Networks course project.

| Member                 | Role                                     |
| ---------------------- | ---------------------------------------- |
| _Nguyen Ba Duy_        | Agent (C# .NET 8 Windows client)         |
| _Trinh Tran Huong Mai_ | Gateway (Node.js WebSocket relay + Auth) |
| _Thai Mac Tuong Vi_    | Controller (React + Vite + Zustand)      |

Licensed under the [MIT License](LICENSE).
