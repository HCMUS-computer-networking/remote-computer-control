# Architecture — Controller

Remote administration console frontend (React + Vite, JavaScript, no TypeScript).
Connects to a Gateway over WebSocket; renders data voluntarily sent by Agents after consent.

---

## Current state

The app shell, global styles, all four Zustand stores, and all layout / agent / livescreen
components are fully implemented with mock data.  
The seven module tabs are placeholder stubs — each renders an icon + label; real data logic
will be added per module in Weeks 2–4.  
`services/` and `hooks/` files are single-line comment stubs; they will be filled in when
MockSocket and UseAgentSocket are implemented.  
Draft JSON message-format files for all 7 modules exist in `docs/formatjson/` — status:
**proposed by Controller team, not yet confirmed with Gateway/Agent team**.

---

## File tree & roles

```
controller/
├── architecture.md                        This file — current code map
├── README.md                              Setup & run instructions
├── package.json                           react 19, react-dom 19, zustand 5, lucide-react (prod)
│                                          vite 8, @vitejs/plugin-react, oxlint, prettier (dev)
├── vite.config.js                         Vite config (React plugin)
├── index.html                             HTML entry point (mounts #root)
│
├── docs/
│   ├── wireframe/
│   │   ├── color-palette.md               CSS variable token definitions (light + dark)
│   │   ├── icons.md                       Icon usage table (lucide-react, size/strokeWidth rules)
│   │   └── controller-wireframes.drawio   Full UI wireframe — 4 pages (Grid, Focus, App, Process tabs)
│   │
│   └── formatjson/                        DRAFT message-format reference (not yet confirmed with team)
│       ├── instruction.md                 Overview table + TODO list for team confirmation
│       ├── connection.json                list_agents, agents_list, agent_status
│       ├── application.json               app_list, app_start, app_stop + results
│       ├── process.json                   proc_list, proc_kill + results
│       ├── livescreen.json                screenshot / stream + frame_meta / binary JPEG
│       ├── keylog.json                    keylog events + consent flow
│       ├── file.json                      fs_list, fs_get, fs_put (sandbox only)
│       ├── webcam.json                    frame_meta (module=webcam) + binary JPEG + consent flow
│       └── power.json                     lock / restart / shutdown / sleep
│
├── public/
│   ├── favicon.svg
│   └── icons.svg
│
└── src/
    ├── main.jsx                           Entry point — mounts <App /> into #root, imports index.css
    ├── index.css                          ALL CSS: variables (light/dark), base reset, every component's
    │                                      class names (BEM-lite: block__element--modifier)
    ├── App.css                            Empty (intentional) — all styles live in index.css
    ├── App.jsx                            Root shell — syncs theme to <html data-theme>, renders
    │                                      two-column layout (Sidebar + right-panel)
    │
    ├── store/
    │   ├── UiStore.js                     theme, view_mode, active_tab, sidebar_open
    │   │                                  exports MODULE_TABS constant (7 module ids)
    │   ├── AgentStore.js                  agents[], selected_agent_id, search_query
    │   │                                  derived: getFilteredAgents(), getSelectedAgent()
    │   │                                  mock data: 5 agents (4 online, 1 offline, 1 in_session)
    │   ├── ConnectionStore.js             status ('connected'|'connecting'|'disconnected'), gateway_url
    │   │                                  mock default: status = 'connected'
    │   └── ModuleStore.js                 data[agent_id][module] — raw payloads from Gateway
    │                                      actions: setModuleData, clearModuleData, clearAgentData
    │
    ├── services/
    │   ├── Socket.js                      STUB — real WebSocket wrapper (not yet implemented)
    │   ├── MockSocket.js                  STUB — simulated Gateway+Agent (not yet implemented)
    │   └── Protocol.js                    STUB — JSON message builders and parsers (not yet implemented)
    │
    ├── hooks/
    │   └── UseAgentSocket.js              STUB — bridge hook; components must NEVER call socket directly
    │
    └── components/
        ├── layout/
        │   ├── Sidebar.jsx                Left panel (220 px fixed): logo, search input, AgentList,
        │   │                              gateway status footer (status dot + text)
        │   ├── TopBar.jsx                 Header (60 px): breadcrumb/title, SESSION badge, Grid/Focus
        │   │                              view-mode buttons, ConnectionIndicator, ThemeToggle, Admin btn
        │   └── ThemeToggle.jsx            Sun/Moon button — calls UiStore.toggleTheme()
        │
        ├── agents/
        │   ├── AgentList.jsx              Renders filtered AgentCard list; Inbox empty state
        │   ├── AgentCard.jsx              One agent row in sidebar: status dot, name, SESSION badge,
        │   │                              OS + IP; click → setSelectedAgent + setViewMode('focus')
        │   └── MultiSelect.jsx            STUB — multi-agent checkbox selection
        │
        ├── livescreen/
        │   ├── GridView.jsx               Auto-fill CSS grid of AgentThumbnail tiles (online agents only)
        │   │                              click tile → setSelectedAgent + setViewMode('focus')
        │   ├── FocusView.jsx              Single-agent view: 7-tab nav bar + active module panel
        │   │                              shows "select an agent" prompt if none selected
        │   └── FrameCanvas.jsx            <canvas> — decodes ArrayBuffer JPEG via createImageBitmap,
        │                                  calls bitmap.close() after draw to prevent memory leak
        │
        └── modules/                       All 7 tabs are placeholder stubs (icon + label + "coming soon")
            ├── ApplicationTab/index.jsx   Whitelist app list — Start / Stop
            ├── ProcessTab/index.jsx       All-process table — Kill
            ├── ScreenTab/index.jsx        Screenshot + 24 fps live stream
            ├── KeylogTab/index.jsx        Terminal keystroke log (visible consent indicator)
            ├── FileTab/index.jsx          Sandbox file tree + upload / download
            ├── WebcamTab/index.jsx        Live webcam feed (visible consent indicator)
            └── PowerTab/index.jsx         Lock / Restart / Shutdown / Sleep (countdown confirm)
```

---

## State (Zustand stores)

| Store             | Fields                                                                                                 | Actions                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `UiStore`         | `theme` ('light'\|'dark'), `view_mode` ('grid'\|'focus'), `active_tab` (string), `sidebar_open` (bool) | `setTheme`, `toggleTheme`, `setViewMode`, `setActiveTab` (also sets view_mode to 'focus'), `toggleSidebar` |
| `AgentStore`      | `agents[]` ({id, name, os, ip, online, in_session}), `selected_agent_id`, `search_query`               | `setAgents`, `setSelectedAgent`, `setSearchQuery`, `getFilteredAgents()`, `getSelectedAgent()`             |
| `ConnectionStore` | `status` ('connected'\|'connecting'\|'disconnected'), `gateway_url`                                    | `setStatus`, `setGatewayUrl`                                                                               |
| `ModuleStore`     | `data = { [agent_id]: { [module]: payload } }`                                                         | `setModuleData(id, mod, payload)`, `clearModuleData(id, mod)`, `clearAgentData(id)`                        |

---

## Data flow (planned — hooks/services not yet wired)

```
Socket.js / MockSocket.js
    │  raw WebSocket messages
    ▼
Protocol.js  ──→  message parsing / building
    │
    ▼
UseAgentSocket (hook)          ← components must NEVER touch socket directly
    │
    ├── ConnectionStore.setStatus()
    ├── AgentStore.setAgents()
    └── ModuleStore.setModuleData(agentId, module, payload)
                ▲
                │  store state read by components via Zustand selectors
                │
          Component renders

User action  →  store action  →  UseAgentSocket.sendCommand()  →  Socket.js TX
```

---

## View modes

| Mode      | Trigger                                           | Content area                                                           |
| --------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| **Grid**  | default on load, or LayoutGrid button             | `GridView` — responsive grid of AgentThumbnail tiles for online agents |
| **Focus** | click AgentCard or thumbnail, or Maximize2 button | `FocusView` — 7-tab bar + active module placeholder                    |

---

## UI states implemented

| State                     | Where shown                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Agent online              | Green `status-dot--online` in sidebar AgentCard + GridView thumbnail header           |
| Agent offline             | Gray `status-dot--offline` in sidebar AgentCard (offline agents hidden from GridView) |
| Agent in session          | Red `session-badge` in AgentCard, GridView thumbnail, and TopBar (ĐANG ĐIỀU KHIỂN)    |
| Gateway connected         | Green dot + "Connected" / Wifi icon in TopBar and sidebar footer                      |
| Gateway connecting        | Yellow Loader2 (spin) + "Connecting…" in TopBar                                       |
| Gateway disconnected      | Red WifiOff + "Disconnected" in TopBar; red dot in sidebar footer                     |
| No agents found (search)  | Inbox icon + "No agents found" in AgentList                                           |
| No agents online (grid)   | Inbox icon + "No agents online" in GridView                                           |
| No agent selected (focus) | "Select an agent from the sidebar" prompt in FocusView                                |
| Module placeholder        | Lucide icon + module name + "coming soon" in each module tab                          |

---

## JSON message types (draft — see docs/formatjson/ for full samples)

| Direction | `type` field                                        | Purpose                                                                 |
| --------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| TX        | `list_agents`                                       | request agent list                                                      |
| TX        | `request`                                           | start module (`module`, `params`, `target_agents[]`)                    |
| TX        | `power`                                             | `action`: lock \| restart \| shutdown \| sleep                          |
| TX        | `fs_list` / `fs_get` / `fs_put`                     | file ops (sandbox only)                                                 |
| TX        | `app_list` / `app_start` / `app_stop`               | application control (whitelist only)                                    |
| TX        | `proc_list` / `proc_kill`                           | process control (all processes)                                         |
| RX        | `frame_meta` + binary blob                          | JPEG frame for screen (`module:"screen"`) or webcam (`module:"webcam"`) |
| RX        | `keylog`                                            | `{ events: [] }` keystroke batch                                        |
| RX        | `agents_list`                                       | agent list response                                                     |
| RX        | `agent_status`                                      | single-agent online/offline push                                        |
| RX        | `*_result` / `*_started` / `*_stopped` / `*_denied` | per-module confirmation / error replies                                 |

> ⚠️ All formats are **draft proposals** by the Controller team.  
> Full samples: `docs/formatjson/`.  
> Fields marked TODO in those files still need confirmation with the Gateway/Agent team.

---

## CSS design tokens

Defined in `src/index.css`. All component styles use `var(--)` — no hardcoded colours.

| Group               | Tokens                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Grayscale           | `--gray-0` … `--gray-900`                                                                 |
| Semantic            | `--bg`, `--bg-surface`, `--bg-elevated`, `--border`, `--text`, `--text-muted`             |
| Accent (blue)       | `--accent`, `--accent-bg`, `--accent-border`                                              |
| Status              | `--success`/`-bg`, `--danger`/`-bg`, `--warning`/`-bg`                                    |
| Fixed dark surfaces | `--surface-feed`, `--border-feed`, `--text-feed`, `--surface-terminal`, `--text-terminal` |

Theme is toggled by setting/removing `data-theme="dark"` on `<html>` (done in `App.jsx` via `useEffect`).

---

## Naming conventions

| Identifier                     | Convention                                            |
| ------------------------------ | ----------------------------------------------------- |
| Variable                       | `snake_case`                                          |
| Function                       | `camelCase`                                           |
| React component / class / enum | `PascalCase`                                          |
| Constant                       | `UPPER_SNAKE_CASE`                                    |
| File                           | `PascalCase` — React convention, applied project-wide |
| CSS class                      | BEM-lite: `block__element--modifier`                  |

- Code comments always in English, simple words.
- Adjacent trailing `//` comments aligned to one column.
- Braces: Allman style — `{` on its own line.
- Components must not import `Socket.js` or `MockSocket.js` directly — only through `UseAgentSocket`.
