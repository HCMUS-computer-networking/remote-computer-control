# Architecture — Controller

Remote administration console frontend (React + Vite, JavaScript, no TypeScript).
Connects to a Gateway over WebSocket; renders data voluntarily sent by Agents after user consent.

**Note**: `architecture.md` and `docs/` are supporting documents during the build phase.
Once the project is complete they will be deleted. `README.md` is the only official documentation
that will remain — it is written to stand alone without depending on this file.

---

## Completion status

| Layer | Status |
|---|---|
| App shell, global CSS, theme toggle, toast notifications | ✅ Complete |
| 4 Zustand stores | ✅ Complete |
| Layout components (Sidebar, TopBar, ThemeToggle) | ✅ Complete |
| Agent components (AgentList, AgentCard, MultiSelect) | ✅ Complete |
| Livescreen components (GridView, FocusView, FrameCanvas) | ✅ Complete — GridView starts 2 fps streams on connect, FrameCanvas with full memory management |
| `Protocol.js` — message builders + type constants | ✅ Complete |
| `MockSocket.js` — Gateway + Agent simulator | ✅ Complete — stateful per-agent app/process data, frame stream engine (canvas test card → JPEG → frame_meta + binary) |
| `UseAgentSocket.js` hook — ref-count singleton + store dispatch | ✅ Complete — binary frame dispatch via onBinary + _pending_meta pairing, toast feedback for action results |
| `Socket.js` — real WebSocket wrapper | ⏳ 1-line stub, not yet implemented |
| `ApplicationTab` | ✅ App list table, client-side sort, Start/Stop with WHITELISTED_APPS guard, 3s poll |
| `ProcessTab` | ✅ Full process table, client-side sort, Kill action (removes from mock state), 3s poll |
| `ScreenTab` | ✅ Screenshot once + 24 fps live stream, auto-stop on unmount/agent switch |
| Remaining 4 module tab components | ⏳ Placeholder stubs (icon + label + "coming soon") |
| Module-level active-state flags in ModuleStore | ⏳ Not yet added |
| Binary frame dispatch (screen/webcam JPEG path) | ✅ Wired for screen module; webcam uses same path |
| Toast notification system | ✅ Complete — UiStore manages toast queue, auto-dismiss 3s, slide-in animation |

---

## File tree & roles

```
controller/
├── architecture.md                     This file — current code map (always up to date)
├── README.md                           Setup, run instructions, project overview
├── package.json                        react 19.2, react-dom 19.2, zustand 5.0,
│                                       lucide-react 1.23 (prod)
│                                       vite 8.1, @vitejs/plugin-react 6,
│                                       oxlint, prettier (dev)
├── vite.config.js                      Vite config (React plugin)
├── index.html                          HTML entry — mounts #root
│
├── docs/
│   ├── wireframe/
│   │   ├── color-palette.md            CSS variable token definitions (light + dark)
│   │   ├── icons.md                    Icon usage rules (lucide-react)
│   │   └── controller-wireframes.drawio Full UI wireframe — 4 pages
│   │
│   ├── formatjson/                     Draft JSON protocol templates (not yet
│   │   ├── instruction.md              confirmed with Gateway/Agent team)
│   │   ├── connection.json             list_agents, agents_list, agent_status
│   │   ├── application.json            app_list, app_start, app_stop + results
│   │   ├── process.json                proc_list, proc_kill + results
│   │   ├── livescreen.json             screenshot / stream + frame_meta / binary JPEG
│   │   ├── keylog.json                 keylog events + consent flow
│   │   ├── file.json                   fs_list, fs_get, fs_put (sandbox only)
│   │   ├── webcam.json                 frame_meta (module=webcam) + binary JPEG + consent
│   │   └── power.json                  lock / restart / shutdown / sleep
│   │
│   ├── technical_explanation/          Short academic notes on tech decisions (Vietnamese)
│   │   ├── 01_zustand_vs_redux_context.md
│   │   ├── 02_websocket_qua_gateway.md
│   │   ├── 03_json_lenh_binary_anh.md
│   │   ├── 04_tach_store_va_mock_pattern.md
│   │   └── 05_grid_fps_thap_focus_24fps.md
│   │
│   └── screenshot/wireframe_UI/
│       ├── darktheme.png
│       └── lighttheme.png
│
├── public/
│   ├── favicon.svg
│   └── icons.svg
│
└── src/
    ├── main.jsx                        Entry — StrictMode, mounts <App />, imports index.css
    ├── index.css                       ALL CSS: variables (light/dark themes), base reset,
    │                                   every component class (BEM-lite: block__element--modifier)
    │                                   Sections: CSS variables, base, app-shell layout,
    │                                   sidebar, topbar, agent-card, agent-list, multi-select-bar,
    │                                   grid-view, focus-view, module-placeholder, utils,
    │                                   module-table, action-btn, screen-tab, toast, responsive
    ├── App.css                         Empty — all styles live in index.css
    ├── App.jsx                         Root shell. Calls useAgentSocket() to open the socket
    │                                   on mount. Syncs data-theme attribute on <html> based on
    │                                   UiStore.theme. Renders <Sidebar> + <TopBar> + main area
    │                                   (<GridView> or <FocusView> depending on layout_mode).
    │                                   Renders toast notification container from UiStore.toasts.
    │
    ├── store/
    │   ├── UiStore.js                  Global UI state — see State section below
    │   ├── AgentStore.js               Agent list + selection state — see State section below
    │   ├── ConnectionStore.js          WebSocket connection state — see State section below
    │   └── ModuleStore.js              Per-agent, per-module data — see State section below
    │
    ├── services/
    │   ├── Socket.js                   STUB — real WebSocket wrapper (not yet implemented)
    │   ├── MockSocket.js               Full Gateway + Agent simulator. Class with identical
    │   │                               API shape to Socket.js: connect(), close(), send(),
    │   │                               onOpen(), onMessage(), onBinary(), onClose(), onError().
    │   │                               Dispatches on msg.type (list_agents / request / power).
    │   │                               Sub-dispatches on msg.module for all request commands.
    │   │                               Returns staggered per-agent replies (80 ms apart).
    │   │                               STATEFUL PER-AGENT DATA:
    │   │                                 _app_state[agent_id]  — mutable app list; app_start/
    │   │                                   app_stop toggle status; CPU/RAM randomised each poll.
    │   │                                 _proc_state[agent_id] — mutable process list; proc_kill
    │   │                                   removes the process permanently; CPU/RAM randomised.
    │   │                               Simulates: agents_list, app_list_result, app_action_result,
    │   │                               proc_list_result, proc_kill_result, stream_started/stopped,
    │   │                               keylog_started + keylog batch, keylog_stopped,
    │   │                               fs_list_result, fs_get_result, fs_put_result,
    │   │                               webcam_started/stopped, power_result.
    │   │                               FRAME STREAM ENGINE: _startFrameStream / _stopFrameStream
    │   │                               use an off-screen canvas to draw agent-specific test cards,
    │   │                               encode to JPEG blob → ArrayBuffer, emit frame_meta JSON
    │   │                               via onMessage then raw bytes via onBinary. Streams keyed
    │   │                               by "agentId:module"; all cleared on close().
    │   └── Protocol.js                 Pure builder/parser functions. No side effects.
    │                                   Exports: MSG_TYPE, MODULE, POWER_ACTION constants;
    │                                   buildMessage(), parseMessage();
    │                                   buildListAgents(), buildRequest();
    │                                   buildAppList/Start/Stop(), buildProcList/Kill(),
    │                                   buildScreenshot(), buildStreamStart/Stop(),
    │                                   buildKeylogStart/Stop(), buildFsList/Get/Put(),
    │                                   buildWebcamStart/Stop(), buildPower().
    │
    ├── hooks/
    │   └── UseAgentSocket.js           Sole glue layer between socket service and stores.
    │                                   Components NEVER import Socket/MockSocket directly.
    │                                   SINGLETON pattern: module-level _socket + _refcount so
    │                                   multiple components can call this hook safely without
    │                                   creating extra sockets. Socket created when refcount
    │                                   goes 0→1; closed when refcount goes 1→0 (app teardown).
    │                                   On first mount: creates MockSocket, wires all callbacks,
    │                                   calls connect(), sends list_agents immediately on open.
    │                                   dispatchMessage() routes every incoming message to the
    │                                   appropriate store action using MSG_TYPE constants.
    │                                   Action results (app_action_result, proc_kill_result)
    │                                   dispatch toast notifications via UiStore.addToast().
    │                                   Store actions read via getState() (not hook selectors)
    │                                   to keep hook count constant and avoid HMR issues.
    │                                   BINARY FRAME DISPATCH: holds _pending_meta (module-level).
    │                                   When frame_meta arrives it is saved; when onBinary fires
    │                                   the buffer is paired with _pending_meta and pushed into
    │                                   ModuleStore.data[agent_id][module] = {frame, meta}.
    │                                   Returns three TX helpers:
    │                                     sendCommand(json)   — raw send, no target injection
    │                                     sendToFocused(json) — injects [focused_agent_id]
    │                                     sendToSelected(json)— injects selected_agent_ids
    │                                   Module tabs (ApplicationTab, ProcessTab) use sendToFocused
    │                                   so they never need to thread agent.id into builders.
    │
    └── components/
        ├── layout/
        │   ├── Sidebar.jsx             Left panel (fixed width). Contains: CONTROLLER logo,
        │   │                           "Agents" label, search input (→ AgentStore.search_query),
        │   │                           scrollable AgentList, GatewayStatus footer (colored dot +
        │   │                           text based on ConnectionStore.status).
        │   ├── TopBar.jsx              Header bar. Contains: dynamic breadcrumb title
        │   │                           (Grid view / Focus view with agent name + tab name),
        │   │                           "ĐANG ĐIỀU KHIỂN" session badge (visible only when focused
        │   │                           agent has in_session=true in focus mode), Grid/Focus view
        │   │                           toggle buttons, ConnectionIndicator (Wifi/Loader2/WifiOff
        │   │                           icon + text), ThemeToggle, Admin button placeholder.
        │   │                           Subscribes to focused_agent_id + agents (not getFocusedAgent)
        │   │                           to correctly re-render when the focused agent changes.
        │   └── ThemeToggle.jsx         Sun/Moon icon button — calls UiStore.toggleTheme().
        │                               Renders Sun when dark, Moon when light.
        │
        ├── agents/
        │   ├── AgentList.jsx           Renders MultiSelect toolbar above a filtered list of
        │   │                           AgentCards. Shows Inbox empty-state when no agents match.
        │   ├── AgentCard.jsx           One agent row. Status dot (green=online, gray=offline),
        │   │                           name, SESSION badge (when in_session=true), OS — IP info
        │   │                           line, checkbox at far right. Card body click: setFocused +
        │   │                           setLayoutMode('focus'). Checkbox click: toggleSelect
        │   │                           (stopPropagation — does not change focus).
        │   │                           CSS: agent-card--active (focused), agent-card--selected
        │   │                           (in multi-select set).
        │   └── MultiSelect.jsx         "Select all / N agents selected / Clear" toolbar.
        │                               Hidden entirely when no online agents exist.
        │                               "Select all" toggles between selecting all online agents
        │                               and clearing. Shows count label when any are selected.
        │
        ├── livescreen/
        │   ├── GridView.jsx            Responsive grid of AgentThumbnail tiles (online agents
        │   │                           only). On mount (when conn_status is 'open'), starts a
        │   │                           2 fps / quality 50 stream for all online agents. On
        │   │                           unmount, stops all grid streams. Each tile subscribes to
        │   │                           its own agent's screen.frame slice via Zustand selector.
        │   │                           Clicking a tile: setFocused + setLayoutMode('focus').
        │   │                           Empty-state shown when no agents are online.
        │   ├── FocusView.jsx           Single-agent detail view. If no agent is focused: shows
        │   │                           a prompt. When focused: renders 7-tab navigation bar +
        │   │                           active module panel (TAB_PANELS map dispatches to the
        │   │                           correct module component). Uses key={focused_agent.id}
        │   │                           on the active panel to force remount when the user
        │   │                           switches agents. Subscribes to focused_agent_id + agents
        │   │                           (not getFocusedAgent) to correctly re-render on agent change.
        │   └── FrameCanvas.jsx         <canvas> that decodes an ArrayBuffer JPEG via
        │                               createImageBitmap, draws it, then calls bitmap.close()
        │                               to release GPU memory. Uses a "cancelled" flag to prevent
        │                               stale async decode callbacks from overwriting newer
        │                               frames. .catch() silently skips corrupted/invalid frames.
        │                               Cleanup closes any pending bitmap on unmount.
        │                               Width/height accept CSS values (default 100%).
        │
        └── modules/                    Each tab receives { agent } prop from FocusView.
            ├── ApplicationTab/
            │   └── index.jsx           App list table pulled from ModuleStore (agent.id slice).
            │                           WHITELISTED_APPS Set declared at module scope (UPPER_SNAKE_CASE).
            │                           Client-side sort: sort_col + sort_dir in component state.
            │                           Click any COLUMNS header to sort; click again to flip dir.
            │                           Polls every 3 s via setInterval in useEffect.
            │                           Start/Stop buttons disabled for apps not in whitelist.
            │                           Start/Stop mutate mock state — status changes on next poll.
            │                           CSS: module-table + action-btn--start/stop classes.
            ├── ProcessTab/
            │   └── index.jsx           Full process list from ModuleStore; polls every 3 s.
            │                           Client-side sort: sort_col + sort_dir in component state.
            │                           Click any COLUMNS header to sort; click again to flip dir.
            │                           Kill button on every row sends buildProcKill(pid).
            │                           Kill removes process from mock state — disappears on next poll.
            │                           CSS: module-table + action-btn--kill classes.
            ├── ScreenTab/
            │   └── index.jsx           Screenshot + live stream panel. "Chụp 1 lần" sends
            │                           a single screenshot request. "Bắt đầu stream" starts
            │                           a 24 fps / quality 70 continuous stream; "Dừng stream"
            │                           stops it. Auto-stops on unmount or agent switch via
            │                           useEffect cleanup (streaming_agent_ref). Shows LIVE
            │                           badge with fps, resolution, and seq number from frame_meta.
            ├── KeylogTab/
            │   └── index.jsx           Planned: terminal-style keystroke log, consent indicator.
            ├── FileTab/
            │   └── index.jsx           Planned: sandbox file tree, chunked upload/download.
            ├── WebcamTab/
            │   └── index.jsx           Planned: live webcam feed, consent indicator.
            └── PowerTab/
                └── index.jsx           Planned: Lock/Restart/Shutdown/Sleep, countdown confirm.
```

---

## State (Zustand stores)

### UiStore — `src/store/UiStore.js`

| Field | Type | Values |
|---|---|---|
| `theme` | string | `'light'` \| `'dark'` |
| `layout_mode` | string | `'grid'` \| `'focus'` |
| `active_tab` | string | one of `MODULE_TABS` |
| `sidebar_open` | boolean | controls mobile sidebar visibility |
| `toasts` | `Toast[]` | `[]` — array of `{ id, message, variant, timestamp }` |

**Actions:**

| Action | Behaviour |
|---|---|
| `setTheme(theme)` | Set theme directly |
| `toggleTheme()` | Flip light ↔ dark |
| `setLayoutMode(mode)` | Set layout_mode |
| `setActiveTab(tab)` | Set active_tab; also sets layout_mode → `'focus'`. Silently ignores unknown tab IDs. |
| `toggleSidebar()` | Flip sidebar_open |
| `addToast(message, variant)` | Push a toast (`'success'` \| `'error'` \| `'info'`); auto-dismissed after 3 s |
| `dismissToast(id)` | Remove a toast by id (click to dismiss) |

**Exported constant:** `MODULE_TABS = ['application', 'process', 'screen', 'keylog', 'file', 'webcam', 'power']`

---

### AgentStore — `src/store/AgentStore.js`

| Field | Type | Initial value |
|---|---|---|
| `agents` | `Agent[]` | 3 scaffold agents matching MockSocket FAKE_AGENTS (replaced by real data after `agents_list` arrives) |
| `selected_agent_ids` | `string[]` | `[]` — IDs checked for multi-agent commands |
| `focused_agent_id` | `string \| null` | `null` — agent currently open in FocusView |
| `search_query` | string | `''` — text in the sidebar search box |

**Agent object shape:** `{ id, name, os, ip, online, in_session }`

**Actions:**

| Action | Behaviour |
|---|---|
| `setAgents(agents)` | Replace the entire agent list (called on `agents_list` message) |
| `toggleSelect(id)` | Add or remove one agent from selected_agent_ids |
| `setFocused(id)` | Set focused_agent_id |
| `setSelectedIds(ids)` | Replace selected_agent_ids entirely (used by "Select all") |
| `clearSelection()` | Empty selected_agent_ids |
| `setSearchQuery(q)` | Update the search query |
| `getFilteredAgents()` | Derived — filters agents by name or IP against search_query |
| `getFocusedAgent()` | Derived — returns the full agent object for focused_agent_id, or null. **Note**: components that need reactivity must subscribe to `focused_agent_id` + `agents` directly, not to this function reference. |

---

### ConnectionStore — `src/store/ConnectionStore.js`

| Field | Type | Values |
|---|---|---|
| `status` | string | `'idle'` \| `'connecting'` \| `'open'` \| `'closed'` |
| `gateway_url` | string | default `'ws://localhost:8080'` |
| `token` | `string \| null` | auth token after handshake (not yet used) |

**Actions:**

| Action | Behaviour |
|---|---|
| `connect(url?)` | Set status → `'connecting'`; optionally update gateway_url |
| `disconnect()` | Set status → `'closed'`, clear token |
| `setStatus(status)` | Called by UseAgentSocket when socket events fire |
| `setGatewayUrl(url)` | Update target URL |
| `setToken(token)` | Store the auth token |

*Note: `connect()` and `disconnect()` only update state — the actual socket lifecycle is managed by UseAgentSocket.*

---

### ModuleStore — `src/store/ModuleStore.js`

Top-level shape: `data: { [agent_id]: AgentModuleState }`

**AgentModuleState fields:**

| Key | Type | Content |
|---|---|---|
| `app` | `object[]` | app_list_result: array of app objects |
| `process` | `object[]` | proc_list_result: array of process objects |
| `keylog` | `object[]` | accumulated keystroke event objects (ring buffer) |
| `screen` | `{ frame, meta }` | latest screen JPEG (ArrayBuffer) + frame_meta object |
| `webcam` | `{ frame, meta }` | latest webcam JPEG (ArrayBuffer) + frame_meta object |
| `file` | `{ entries, path }` | fs_list_result: folder contents + current directory path |

**Actions:**

| Action | Behaviour |
|---|---|
| `setModuleData(agent_id, module, payload)` | Write payload into data[agent_id][module]; creates agent slot if not present |
| `appendKeylog(agent_id, events)` | Append events to keylog buffer; trims oldest entries to stay within MAX_KEYLOG_EVENTS (500) |
| `clearModule(agent_id, module)` | Reset one module slot to its default empty value |
| `clearAgent(agent_id)` | Remove all module data for one agent |

---

## Data flow

```
┌─────────────────────────────────────────────────────────┐
│  User action in a Component                             │
│  e.g. click "Kill" in ProcessTab                        │
└───────────────────────────┬─────────────────────────────┘
                            │ calls sendCommand(json_string)
                            │ (returned by useAgentSocket())
                            ▼
┌─────────────────────────────────────────────────────────┐
│  UseAgentSocket (hook)  — src/hooks/UseAgentSocket.js   │
│  Owns the socket instance; components never touch it.   │
│                                                         │
│  TX path: sendCommand() → socket.send(json_string)      │
│                                                         │
│  RX path: socket.onMessage(msg) → dispatchMessage(msg)  │
│    MSG_TYPE.AGENTS_LIST       → AgentStore.setAgents()  │
│    MSG_TYPE.APP_LIST_RESULT   → ModuleStore.setModuleData│
│    MSG_TYPE.APP_ACTION_RESULT → UiStore.addToast()      │
│    MSG_TYPE.PROC_LIST_RESULT  → ModuleStore.setModuleData│
│    MSG_TYPE.PROC_KILL_RESULT  → UiStore.addToast()      │
│    MSG_TYPE.KEYLOG            → ModuleStore.appendKeylog │
│    MSG_TYPE.FRAME_META        → saved to _pending_meta  │
│    onBinary(buffer)           → pair with _pending_meta →│
│                                 ModuleStore.setModuleData│
│    MSG_TYPE.FS_LIST_RESULT    → ModuleStore.setModuleData│
│    all other RX types         → TODO stubs (no-op)      │
└────────────┬──────────────────────────────┬─────────────┘
             │                              │
             ▼                              ▼
┌────────────────────────┐    ┌─────────────────────────────┐
│  MockSocket.js         │    │  Zustand Stores             │
│  (or Socket.js — same  │    │  UiStore / AgentStore /     │
│   API, swap 1 import)  │    │  ConnectionStore /          │
│                        │    │  ModuleStore                │
│  Simulates Gateway +   │    │                             │
│  Agent; sends staggered│    │  Components subscribe to    │
│  per-agent replies.    │    │  store slices via selectors; │
│  Keeps mutable per-    │    │  re-render only when their  │
│  agent app/process     │    │  slice changes.             │
│  state so Start/Stop/  │    └─────────────────────────────┘
│  Kill have visible     │
│  effects.              │
└────────────────────────┘
```

**Protocol.js** sits as a pure utility layer — `buildXxx()` functions produce the JSON strings that
`sendCommand()` transmits; `parseMessage()` is available for raw WebSocket contexts (MockSocket parses
internally and passes the object directly to the callback).

---

## JSON message types

> **Nguồn chính thức duy nhất cho field names và ví dụ đầy đủ: [`docs/formatjson/`](docs/formatjson/)**
> Thư mục `docs/` là tài liệu làm việc trong suốt quá trình làm đồ án.
> Các bảng dưới đây chỉ là bảng index/tóm tắt — khi code hoặc kiểm tra message, **luôn tra file nguồn**.

All Controller→Gateway module commands use `type:"request"` with a `module` field.
Only `list_agents` and `power` have their own top-level `type`.

### TX (Controller → Gateway)

| `type` | `module` | Key params | Purpose |
|---|---|---|---|
| `list_agents` | — | — | Request current agent list |
| `request` | `app_list` | `target_agents[]` | Request app list from agents |
| `request` | `app_start` | `name`, `target_agents[]` | Launch a whitelisted app |
| `request` | `app_stop` | `name`, `target_agents[]` | Stop a running whitelisted app |
| `request` | `proc_list` | `target_agents[]` | Request process list |
| `request` | `proc_kill` | `pid`, `target_agents[]` | Terminate a process |
| `request` | `screenshot` | `mode:"once"`, `target_agents[]` | Single screenshot |
| `request` | `screen_stream` | `mode:"stream"`, `fps`, `quality`, `target_agents[]` | Start screen stream |
| `request` | `screen_stream_stop` | `target_agents[]` | Stop screen stream |
| `request` | `keylog_start` | `target_agents[]` | Start keystroke capture (Agent consent required) |
| `request` | `keylog_stop` | `target_agents[]` | Stop keystroke capture |
| `request` | `fs_list` | `path`, `target_agents[]` | List sandbox folder |
| `request` | `fs_get` | `path`, `target_agents[]` | Download file (base64 chunks) |
| `request` | `fs_put` | `path`, `total_size`, `chunk_index`, `total_chunks`, `data_base64`, `target_agents[]` | Upload one chunk |
| `request` | `webcam_start` | `fps`, `quality`, `target_agents[]` | Start webcam stream (Agent consent required) |
| `request` | `webcam_stop` | `target_agents[]` | Stop webcam stream |
| `power` | — | `action` (lock\|restart\|shutdown\|sleep), `target_agents[]` | Power action |

### RX (Gateway / Agent → Controller)

| `type` | Key fields | Dispatched to |
|---|---|---|
| `agents_list` | `agents[]` | `AgentStore.setAgents()` |
| `agent_status` | `agent_id`, `online` | TODO — update single agent online flag |
| `frame_meta` + binary blob | `agent_id`, `module`, `w`, `h`, `len`, `seq`, `timestamp_ms` | `_pending_meta` → paired with binary → `ModuleStore.setModuleData()` |
| `app_list_result` | `agent_id`, `apps[]` | `ModuleStore.setModuleData(id, 'app', apps)` |
| `app_action_result` | `agent_id`, `action`, `name`, `success`, `message` | `UiStore.addToast()` — success/error notification |
| `proc_list_result` | `agent_id`, `processes[]` | `ModuleStore.setModuleData(id, 'process', processes)` |
| `proc_kill_result` | `agent_id`, `pid`, `name`, `success`, `message` | `UiStore.addToast()` — success/error notification |
| `keylog` | `agent_id`, `events[]` | `ModuleStore.appendKeylog(id, events)` |
| `keylog_started` | `agent_id` | TODO — update active-state flag |
| `keylog_stopped` | `agent_id` | TODO — update active-state flag |
| `keylog_denied` | `agent_id` | TODO — show consent-denied notice |
| `stream_started` | `agent_id`, `module:"screen"` | TODO — update active-state flag |
| `stream_stopped` | `agent_id`, `module:"screen"` | TODO — update active-state flag |
| `webcam_started` | `agent_id` | TODO — update active-state flag |
| `webcam_stopped` | `agent_id` | TODO — update active-state flag |
| `webcam_denied` | `agent_id` | TODO — show consent-denied notice |
| `fs_list_result` | `agent_id`, `path`, `entries[]` | `ModuleStore.setModuleData(id, 'file', {entries,path})` |
| `fs_get_result` | `agent_id`, `path`, `chunk_index`, `total_chunks`, `data_base64` | TODO — forward to FileModule |
| `fs_put_result` | `agent_id`, `path`, `chunk_index`, `success` | TODO — forward to FileModule |
| `fs_put_complete` | `agent_id`, `path` | TODO — notify FileModule upload done |
| `fs_error` | `agent_id`, `path`, `message` | TODO — surface error in FileModule |
| `power_result` | `agent_id`, `action`, `confirmed`, `message` | TODO — surface in PowerModule |

### Binary frame transport

Binary JPEG frames (screen/webcam) arrive as two consecutive messages:
1. **JSON** — `frame_meta` with `{type, module, agent_id, w, h, len, seq, timestamp_ms}`
2. **Binary** — raw JPEG bytes as `ArrayBuffer`

UseAgentSocket holds `_pending_meta` (module-level). When `frame_meta` arrives via `onMessage`,
it is saved. When `onBinary(buffer)` fires immediately after, the buffer is paired with
`_pending_meta` and pushed into `ModuleStore.data[agent_id][module] = { frame: buffer, meta }`.
The `module` field ("screen" or "webcam") determines the store slot.

MockSocket simulates this with an off-screen canvas test card → `toBlob('image/jpeg')` →
`arrayBuffer()`, emitting the pair via `_on_message(frame_meta)` then `_on_binary(buffer)`.

FrameCanvas decodes the ArrayBuffer via `createImageBitmap()`, draws it, and immediately
calls `bitmap.close()` to release GPU memory. A `cancelled` flag prevents stale async
decode callbacks from drawing over newer frames.

GridView starts 2 fps streams on connect; ScreenTab starts 24 fps on "Bắt đầu stream".
Both stop their streams on unmount via useEffect cleanup.

---

## Mock → Real swap pattern

Swapping MockSocket for the real Socket.js requires changing **exactly one import line** in
`UseAgentSocket.js`:

```js
// Development (current)
import MockSocket from '../services/MockSocket'

// Production — change only this line
import MockSocket from '../services/Socket'
```

No component, no store, no other file needs to change.
Both classes expose the same API: `connect()`, `close()`, `send(jsonString)`,
`onOpen(cb)`, `onMessage(cb)`, `onBinary(cb)`, `onClose(cb)`, `onError(cb)`.

The `onMessage` callback receives a **pre-parsed object** (not a raw JSON string) from both
MockSocket and the real Socket wrapper, so `parseMessage()` from Protocol.js is not called
inside UseAgentSocket.

---

## UI states

| State | Where rendered |
|---|---|
| Agent online | Green `status-dot--online` in AgentCard and GridView thumbnail header |
| Agent offline | Gray `status-dot--offline` in AgentCard; offline agents hidden from GridView |
| Agent in session | Red `session-badge` in AgentCard, GridView tile, TopBar (ĐANG ĐIỀU KHIỂN) |
| Agent focused | `agent-card--active` CSS modifier on the focused AgentCard |
| Agent selected (multi) | `agent-card--selected` CSS modifier; checkbox checked |
| Gateway open | Green Wifi icon + "Connected" in TopBar; green dot in Sidebar footer |
| Gateway connecting | Yellow Loader2 (spin) + "Connecting…" in TopBar |
| Gateway idle/closed | Red WifiOff + "Disconnected" in TopBar; red dot in Sidebar footer |
| No agents found (search) | Inbox icon + "No agents found" in AgentList |
| No agents online (grid) | Inbox icon + "No agents online" in GridView |
| No agent selected (focus) | "Select an agent from the sidebar" prompt in FocusView |
| Module placeholder | Lucide icon + module name + "coming soon" in each module tab |
| Action feedback | Toast notification (bottom-right), auto-dismiss 3 s, click to dismiss early |

---

## CSS design tokens

All defined in `src/index.css`. Every component style uses `var(--*)` — no hardcoded colours.

| Group | Tokens |
|---|---|
| Grayscale | `--gray-0` … `--gray-900` |
| Semantic (theme-aware) | `--bg`, `--bg-surface`, `--bg-elevated`, `--border`, `--text`, `--text-muted` |
| Accent (blue) | `--accent`, `--accent-hover`, `--accent-bg`, `--accent-border` |
| Status | `--success` / `-bg`, `--danger` / `-bg`, `--warning` / `-bg` |
| Fixed dark surfaces | `--surface-feed`, `--border-feed`, `--text-feed`, `--text-feed-name`, `--surface-terminal`, `--text-terminal` |
| Overlay | `--shadow-overlay`, `--bg-overlay` |

Theme is toggled by setting / removing `data-theme="dark"` on `<html>` inside a `useEffect` in `App.jsx`.

---

## Naming conventions

| Identifier | Convention |
|---|---|
| Variable | `snake_case` |
| Function | `camelCase` |
| React component / class / enum | `PascalCase` |
| Constant | `UPPER_SNAKE_CASE` |
| File (component) | `PascalCase.jsx` |
| File (non-component) | `PascalCase.js` (hook/service) or `snake_case.js` |
| CSS class | BEM-lite: `block__element--modifier` |

- Code comments always in **English**, simple words.
- Adjacent trailing `//` comments aligned to one column.
- Braces: **Allman style** — `{` on its own line, aligned with the opening statement.
- Components must not import `Socket.js` or `MockSocket.js` directly — only through `UseAgentSocket`.
- No TypeScript, no Redux, no Context API for continuous state.
