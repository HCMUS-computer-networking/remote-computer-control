# Architecture — Controller

Remote administration console frontend (React + Vite, JavaScript, no TypeScript).  
Connects to a Gateway over WebSocket; renders data voluntarily sent by Agents after user consent.

---

## Current state

| Layer | Status |
|---|---|
| App shell, global CSS, theme toggle | ✅ Complete |
| 4 Zustand stores (static mock data) | ✅ Complete |
| Layout components (Sidebar, TopBar, ThemeToggle) | ✅ Complete |
| Agent components (AgentList, AgentCard) | ✅ Complete |
| Livescreen components (GridView, FocusView, FrameCanvas) | ✅ Complete |
| 7 module tab components | ⏳ Placeholder stubs (icon + label only) |
| `MockSocket.js` | ⏳ Single-line comment stub |
| `Protocol.js` | ⏳ Single-line comment stub |
| `UseAgentSocket.js` hook | ⏳ Single-line comment stub |
| `Socket.js` (real WebSocket) | ⏳ Single-line comment stub |
| `MultiSelect.jsx` (multi-agent select) | ⏳ Single-line comment stub |

---

## File tree & roles

```
controller/
├── architecture.md                         This file — current code map (always up to date)
├── README.md                               Setup, run instructions, project overview
├── package.json                            react 19.2, react-dom 19.2, zustand 5.0 (prod)
│                                           vite 8.1, @vitejs/plugin-react 6, oxlint, prettier (dev)
├── vite.config.js                          Vite config (React plugin)
├── index.html                              HTML entry — mounts #root
│
├── docs/
│   ├── wireframe/
│   │   ├── color-palette.md                CSS variable token definitions (light + dark themes)
│   │   ├── icons.md                        Icon usage rules (lucide-react, size/strokeWidth)
│   │   └── controller-wireframes.drawio    Full UI wireframe — 4 pages (Grid, Focus, App, Process)
│   │
│   ├── formatjson/                         DRAFT message-format reference
│   │   ├── instruction.md                  Overview table + TODO list for team confirmation
│   │   ├── connection.json                 list_agents, agents_list, agent_status
│   │   ├── application.json                app_list, app_start, app_stop + results
│   │   ├── process.json                    proc_list, proc_kill + results
│   │   ├── livescreen.json                 screenshot / stream + frame_meta / binary JPEG
│   │   ├── keylog.json                     keylog events + consent flow
│   │   ├── file.json                       fs_list, fs_get, fs_put (sandbox only)
│   │   ├── webcam.json                     frame_meta (module=webcam) + binary JPEG + consent flow
│   │   └── power.json                      lock / restart / shutdown / sleep
│   │
│   ├── technical_explanation/              Short academic explanations of tech decisions (Vietnamese)
│   │   ├── 01_zustand_vs_redux_context.md  Why Zustand over Redux / Context API (re-render problem)
│   │   ├── 02_websocket_qua_gateway.md     Why WebSocket through Gateway (browser TCP limits)
│   │   ├── 03_json_lenh_binary_anh.md      Why JSON for commands, binary JPEG for frames
│   │   ├── 04_tach_store_va_mock_pattern.md 4-store split + Mock→Real swap pattern
│   │   └── 05_grid_fps_thap_focus_24fps.md Grid low FPS vs Focus 24 FPS (bandwidth tradeoff)
│   │
│   └── screenshot/
│       └── wireframe_UI/
│           ├── darktheme.png               Wireframe screenshot — dark theme
│           └── lighttheme.png              Wireframe screenshot — light theme
│
├── public/
│   ├── favicon.svg
│   └── icons.svg
│
└── src/
    ├── main.jsx                            Entry — mounts <App /> into #root, imports index.css
    ├── index.css                           ALL CSS: variables (light/dark), base reset,
    │                                       every component class (BEM-lite: block__element--modifier)
    ├── App.css                             Empty (intentional) — all styles live in index.css
    ├── App.jsx                             Root shell — syncs theme to <html data-theme>,
    │                                       renders two-column layout (Sidebar + right panel)
    │
    ├── store/
    │   ├── UiStore.js                      theme, view_mode, active_tab, sidebar_open
    │   │                                   exports MODULE_TABS constant (7 module ids)
    │   ├── AgentStore.js                   agents[], selected_agent_id, search_query
    │   │                                   derived: getFilteredAgents(), getSelectedAgent()
    │   │                                   mock data: 5 agents (3 online, 1 offline, 1 in_session)
    │   ├── ConnectionStore.js              status ('connected'|'connecting'|'disconnected'), gateway_url
    │   │                                   mock default: status = 'connected'
    │   └── ModuleStore.js                  data[agent_id][module] — raw payloads from Gateway
    │                                       actions: setModuleData, clearModuleData, clearAgentData
    │
    ├── services/
    │   ├── Socket.js                       STUB — real WebSocket wrapper (not yet implemented)
    │   ├── MockSocket.js                   STUB — simulated Gateway+Agent (not yet implemented)
    │   └── Protocol.js                     STUB — JSON message builders and parsers (not yet implemented)
    │
    ├── hooks/
    │   └── UseAgentSocket.js               STUB — bridge hook; components must NEVER call socket directly
    │
    └── components/
        ├── layout/
        │   ├── Sidebar.jsx                 Left panel (220px fixed): logo, search input, AgentList,
        │   │                               gateway status footer (dot + text)
        │   ├── TopBar.jsx                  Header (60px): breadcrumb, SESSION badge, Grid/Focus buttons,
        │   │                               ConnectionIndicator, ThemeToggle, Admin button
        │   └── ThemeToggle.jsx             Sun/Moon button — calls UiStore.toggleTheme()
        │
        ├── agents/
        │   ├── AgentList.jsx               Renders filtered AgentCard list; empty-state (Inbox icon)
        │   ├── AgentCard.jsx               One agent row: status dot, name, SESSION badge, OS + IP;
        │   │                               click → setSelectedAgent + setViewMode('focus')
        │   └── MultiSelect.jsx             STUB — multi-agent checkbox selection
        │
        ├── livescreen/
        │   ├── GridView.jsx                CSS grid of AgentThumbnail tiles (online agents only);
        │   │                               click tile → setSelectedAgent + setViewMode('focus')
        │   ├── FocusView.jsx               Single-agent view: 7-tab nav bar + active module panel;
        │   │                               shows "select an agent" prompt if none selected
        │   └── FrameCanvas.jsx             <canvas> — decodes ArrayBuffer JPEG via createImageBitmap,
        │                                   calls bitmap.close() after draw to prevent memory leak
        │
        └── modules/                        All 7 tabs are placeholder stubs (icon + label + coming soon)
            ├── ApplicationTab/index.jsx    Whitelist app list — Start / Stop
            ├── ProcessTab/index.jsx        All-process table — Kill
            ├── ScreenTab/index.jsx         Screenshot + 24fps live stream
            ├── KeylogTab/index.jsx         Terminal keystroke log (visible consent indicator)
            ├── FileTab/index.jsx           Sandbox file tree + upload / download
            ├── WebcamTab/index.jsx         Live webcam feed (visible consent indicator)
            └── PowerTab/index.jsx          Lock / Restart / Shutdown / Sleep (countdown confirm)
```

---

## State (Zustand stores)

| Store | Fields | Actions |
|---|---|---|
| `UiStore` | `theme` ('light'\|'dark'), `view_mode` ('grid'\|'focus'), `active_tab` (string), `sidebar_open` (bool) | `setTheme`, `toggleTheme`, `setViewMode`, `setActiveTab` (also sets view_mode→'focus'), `toggleSidebar` |
| `AgentStore` | `agents[]` ({id, name, os, ip, online, in_session}), `selected_agent_id`, `search_query` | `setAgents`, `setSelectedAgent`, `setSearchQuery`, `getFilteredAgents()`, `getSelectedAgent()` |
| `ConnectionStore` | `status` ('connected'\|'connecting'\|'disconnected'), `gateway_url` | `setStatus`, `setGatewayUrl` |
| `ModuleStore` | `data = { [agent_id]: { [module]: payload } }` | `setModuleData(id, mod, payload)`, `clearModuleData(id, mod)`, `clearAgentData(id)` |

---

## Data flow (services/hooks not yet wired — planned design)

```
Socket.js / MockSocket.js
    │  raw WebSocket messages (JSON text or binary ArrayBuffer)
    ▼
Protocol.js  ──→  message parsing / building
    │
    ▼
UseAgentSocket (hook)          ← components must NEVER import socket directly
    │
    ├── ConnectionStore.setStatus()
    ├── AgentStore.setAgents()
    └── ModuleStore.setModuleData(agentId, module, payload)
                ▲
                │  store state read by components via Zustand selectors
                │
          Component renders

User action  →  store action  →  UseAgentSocket.sendCommand()  →  Socket TX
```

Swapping `MockSocket` for `Socket` requires changing **one import only** — no component changes needed.

---

## View modes

| Mode | Trigger | Content area |
|---|---|---|
| **Grid** | Default on load, or LayoutGrid button in TopBar | `GridView` — responsive grid of AgentThumbnail tiles (online agents only) |
| **Focus** | Click AgentCard or thumbnail, or Maximize2 button | `FocusView` — 7-tab bar + active module panel |

---

## UI states implemented

| State | Where shown |
|---|---|
| Agent online | Green `status-dot--online` in AgentCard + GridView thumbnail header |
| Agent offline | Gray `status-dot--offline` in AgentCard (offline agents hidden from GridView) |
| Agent in session | Red `session-badge` in AgentCard, GridView thumbnail, TopBar (ĐANG ĐIỀU KHIỂN) |
| Gateway connected | Green dot + "Connected" / Wifi icon in TopBar and Sidebar footer |
| Gateway connecting | Yellow Loader2 (spin) + "Connecting…" in TopBar |
| Gateway disconnected | Red WifiOff + "Disconnected" in TopBar; red dot in Sidebar footer |
| No agents found (search) | Inbox icon + "No agents found" in AgentList |
| No agents online (grid) | Inbox icon + "No agents online" in GridView |
| No agent selected (focus) | "Select an agent from the sidebar" prompt in FocusView |
| Module placeholder | Lucide icon + module name + "coming soon" in each module tab |

---

## JSON message types (draft — see docs/formatjson/ for full samples)

> ⚠️ All formats are **draft proposals** by the Controller team, not yet confirmed with Gateway/Agent team.

| Direction | `type` field | Purpose |
|---|---|---|
| TX | `list_agents` | Request agent list |
| TX | `request` | Start module (`module`, `params`, `target_agents[]`) |
| TX | `power` | `action`: lock \| restart \| shutdown \| sleep |
| TX | `fs_list` / `fs_get` / `fs_put` | File ops (sandbox only) |
| TX | `app_list` / `app_start` / `app_stop` | Application control (whitelist only) |
| TX | `proc_list` / `proc_kill` | Process control |
| RX | `frame_meta` + binary blob | JPEG frame — `module:"screen"` or `module:"webcam"` |
| RX | `keylog` | `{ events: [] }` keystroke batch |
| RX | `agents_list` | Agent list response |
| RX | `agent_status` | Single-agent online/offline push |
| RX | `*_result` / `*_started` / `*_stopped` / `*_denied` | Per-module confirmation / error replies |

---

## CSS design tokens

All defined in `src/index.css`. Every component style uses `var(--)` — no hardcoded colors.

| Group | Tokens |
|---|---|
| Grayscale | `--gray-0` … `--gray-900` |
| Semantic | `--bg`, `--bg-surface`, `--bg-elevated`, `--border`, `--text`, `--text-muted` |
| Accent (blue) | `--accent`, `--accent-bg`, `--accent-border` |
| Status | `--success`/`-bg`, `--danger`/`-bg`, `--warning`/`-bg` |
| Fixed dark surfaces | `--surface-feed`, `--border-feed`, `--text-feed`, `--surface-terminal`, `--text-terminal` |

Theme toggled by setting/removing `data-theme="dark"` on `<html>` via `useEffect` in `App.jsx`.

---

## Naming conventions

| Identifier | Convention |
|---|---|
| Variable | `snake_case` |
| Function | `camelCase` |
| React component / class / enum | `PascalCase` |
| Constant | `UPPER_SNAKE_CASE` |
| File | `PascalCase` |
| CSS class | BEM-lite: `block__element--modifier` |

- Code comments always in English, simple words.
- Adjacent trailing `//` comments aligned to one column.
- Braces: Allman style — `{` on its own line aligned with the opening statement.
- Components must not import `Socket.js` or `MockSocket.js` directly — only through `UseAgentSocket`.
