# Architecture — Controller

Remote administration console frontend (React + Vite, JavaScript, no TypeScript).
Connects to a Gateway over WebSocket; renders data voluntarily sent by Agents after user consent.

**Note**: `Architecture.md` and `docs/` are supporting documents during the build phase.
Once the project is complete they will be deleted. `README.md` is the only official documentation
that will remain — it is written to stand alone without depending on this file.

---

## Completion status

Reflects the code state at the end of Playbook Week 3 (Keylog + File finished).

| Layer | Status |
|---|---|
| App shell, global CSS, theme toggle, toast notifications | ✅ Complete |
| 4 Zustand stores (UiStore, AgentStore, ConnectionStore, ModuleStore) | ✅ Complete |
| Layout components (Sidebar, TopBar, ThemeToggle) | ✅ Complete |
| Agent components (AgentList, AgentCard, MultiSelect) | ✅ Complete |
| Livescreen components (GridView, FocusView) | ✅ Complete — GridView starts 2 fps streams on connect, keyed on the sorted online-id set so an A↔B swap is detected. Both import `FrameCanvas` from `components/FrameCanvas.jsx` |
| Shared primitives at `components/` root (`ModuleTable.jsx`, `FrameCanvas.jsx`) | ✅ `ModuleTable` — template for App/Process (columns, rows, actionColumn, empty_label, title, poll_badge, row_key; owns sort state, click-to-sort, scroll, empty state). `FrameCanvas` — JPEG ArrayBuffer decoder with full ImageBitmap memory management; `module` + optional `label` props (label triggers a corner badge overlay for WebcamTab) |
| `Protocol.js` — message builders + type constants | ✅ Complete |
| `MockSocket.js` — Gateway + Agent simulator | ✅ Complete — 7 fake agents (5 online, 2 offline; Windows / Ubuntu / macOS), OS-specific app + process pools, consent-denied agent (agent-06 → keylog_denied / webcam_denied), stateful per-agent app/process, uploaded-file persistence, frame stream engine (canvas test card → JPEG → frame_meta + binary) |
| `UseAgentSocket.js` hook — ref-count singleton + store dispatch | ✅ Complete — binary frame dispatch via onBinary + _pending_meta pairing, toast on app_action / proc_kill / keylog_denied / webcam_denied / fs_error |
| `Socket.js` — real WebSocket wrapper | ⏳ 1-line stub, planned for Playbook Week 5 |
| `ApplicationTab` | ✅ App list table, client-side sort, Start/Stop with WHITELISTED_APPS guard, 3 s poll |
| `ProcessTab` | ✅ Full process table, client-side sort, Kill action (removes from mock state), 3 s poll |
| `ScreenTab` | ✅ Screenshot once + 24 fps live stream, auto-stop on unmount / agent switch |
| `KeylogTab` | ✅ Terminal log, consent indicator, auto-scroll / pause, Start / Stop / Clear / Export |
| `FileTab` | ✅ Sandbox file tree (accordion), per-path fetch, Download with chunk assembly, Drag & Drop Upload with per-file progress bars; uploaded files persist in MockSocket and appear on Refresh |
| `WebcamTab`, `PowerTab` | ⏳ Placeholder stubs (Playbook Week 4) |
| Module-level active-state flags in ModuleStore | ⏳ `keylog_active` per agent done; `screen_active` / `webcam_active` still TODO (Week 4) |
| Binary frame dispatch (screen / webcam JPEG path) | ✅ Wired for screen; webcam uses same code path when Week 4 lands |
| Toast notification system | ✅ Complete — UiStore manages toast queue, auto-dismiss 3 s, slide-in animation |
| Multi-agent target injection helpers | ✅ `sendToFocused` + `sendToSelected`; UI wiring for multi-agent commands lands in Week 4 |

---

## File tree & roles

```
controller/
├── Architecture.md                     This file — current code map (always up to date)
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
│   │   ├── ColorPalette.md            CSS variable token definitions (light + dark)
│   │   ├── Icons.md                    Icon usage rules (lucide-react)
│   │   └── ControllerWireframes.drawio Full UI wireframe — 4 pages
│   │
│   ├── formatjson/                     Draft JSON protocol templates (not yet
│   │   ├── Instruction.md              confirmed with Gateway/Agent team)
│   │   ├── Connection.json             list_agents, agents_list, agent_status
│   │   ├── Application.json            app_list, app_start, app_stop + results
│   │   ├── Process.json                proc_list, proc_kill + results
│   │   ├── Livescreen.json             screenshot / stream + frame_meta / binary JPEG
│   │   ├── Keylog.json                 keylog events + consent flow
│   │   ├── File.json                   fs_list, fs_get, fs_put (sandbox only)
│   │   ├── Webcam.json                 frame_meta (module=webcam) + binary JPEG + consent
│   │   ├── Power.json                  lock / restart / shutdown / sleep
│   │   └── PolicyUpdate.json          Controller pushes app_whitelist + sandbox_path to
│   │                                   agents on connect; agent overrides local config in RAM
│   │                                   and replies policy_update_result
│   │
│   ├── technical_explanation/          Short academic notes on tech decisions (Vietnamese)
│   │   ├── 01_ZustandVsReduxContext.md
│   │   ├── 02_WebsocketQuaGateway.md
│   │   ├── 03_JsonLenhBinaryAnh.md
│   │   ├── 04_TachStoreVaMockPattern.md
│   │   └── 05_GridFpsThapFocus24fps.md
│   │
│   └── screenshot/wireframe_UI/
│       ├── DarkTheme.png
│       └── LightTheme.png
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
    │   │                               FAKE_AGENTS: 7 agents — 5 online, 2 offline; mix of
    │   │                                 Windows 10/11, Ubuntu 22.04, macOS 14. Two agents
    │   │                                 (agent-02, agent-06) start with in_session=true.
    │   │                               DENIED_AGENTS = {"agent-06"}: this agent replies
    │   │                                 keylog_denied / webcam_denied instead of _started,
    │   │                                 to exercise the consent-denied UX flow.
    │   │                               OS-SPECIFIC POOLS:
    │   │                                 INITIAL_APPS_BY_OS   — windows / linux / macos app
    │   │                                   templates (whitelisted apps only per OS).
    │   │                                 PROC_NAME_POOL_BY_OS — realistic process names per OS
    │   │                                   (svchost.exe / systemd / kernel_task etc.).
    │   │                                 getOsFamily(agent_id) picks the right pool.
    │   │                               STATEFUL PER-AGENT DATA:
    │   │                                 _app_state[agent_id]  — mutable app list; app_start/
    │   │                                   app_stop toggle status; CPU/RAM randomised each poll.
    │   │                                 _proc_state[agent_id] — mutable process list; proc_kill
    │   │                                   removes the process permanently; CPU/RAM randomised.
    │   │                                 _uploaded_files[agent_id][parent_path] — files persisted
    │   │                                   by fs_put; merged with FAKE_FS_TREE on fs_list so
    │   │                                   uploaded files reappear on Refresh (dedup by name).
    │   │                               Simulates: agents_list, app_list_result, app_action_result,
    │   │                               proc_list_result, proc_kill_result, stream_started/stopped,
    │   │                               keylog_started + keylog batch, keylog_stopped, keylog_denied,
    │   │                               fs_list_result, fs_get_result, fs_put_result, fs_put_complete,
    │   │                               webcam_started/stopped, webcam_denied, power_result.
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
        │
        ├── ModuleTable.jsx             Shared table template used by ApplicationTab and
        │                               ProcessTab. Placed directly under components/ (not
        │                               in a subfolder) because it is a cross-feature primitive.
        │                               Props: { columns:[{key,label,numeric?,render?(row)}], rows,
        │                               actionColumn:{header,render(row)}, empty_label, title,
        │                               poll_badge, row_key(row) }. Owns internal sort state
        │                               (sort_col + sort_dir, defaults: first column, 'desc'),
        │                               click-to-sort headers with ChevronUp/Down indicator on
        │                               the active column, scrollable body, empty-state fallback.
        │                               Sorts a copy of rows (never mutates parent's array);
        │                               numeric columns are right-aligned + sorted as numbers.
        │                               Row keys default to the first column value when row_key
        │                               is not passed.
        │                               Pure UI — imports neither store nor service.
        │                               CSS classes reused: module-table + module-table__toolbar
        │                               / __title / __poll-badge / __scroll / __th / __th--sortable
        │                               / __th--active / __th--num / __th--action / __th-inner /
        │                               __row / __td / __td--num / __td--action / __empty.
        │
        ├── FrameCanvas.jsx             Shared <canvas> primitive — decodes an ArrayBuffer JPEG
        │                               via createImageBitmap, draws it, then calls bitmap.close()
        │                               to release GPU memory. Uses a "cancelled" flag to prevent
        │                               stale async decode callbacks from overwriting newer frames.
        │                               .catch() silently skips corrupted/invalid frames.
        │                               Cleanup closes any pending bitmap on unmount.
        │                               Props: { frame_buffer, module ('screen' | 'webcam';
        │                               default 'screen' — becomes canvas data-module attribute),
        │                               label (optional short caption; when truthy, wraps canvas
        │                               in a positioned container with a corner badge and uses
        │                               "<label> frame" as aria-label; when omitted, renders
        │                               canvas alone with "Live frame" aria-label), width, height
        │                               (CSS values, default "100%") }. GridView and ScreenTab
        │                               omit `label` because they render their own status badges
        │                               around the canvas; WebcamTab will pass label="WEBCAM".
        │                               Placed at components/ root (not livescreen/) because
        │                               both Livescreen and Webcam import it.
        │
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
        ├── livescreen/                 (Both files import FrameCanvas from ../FrameCanvas.jsx)
        │   ├── GridView.jsx            Responsive grid of AgentThumbnail tiles (online agents
        │   │                           only). On mount (when conn_status is 'open'), starts a
        │   │                           2 fps / quality 50 stream for all online agents. On
        │   │                           unmount, stops all grid streams. Each tile subscribes to
        │   │                           its own agent's screen.frame slice via Zustand selector.
        │   │                           Effect deps use online_ids_key (sorted + joined id set)
        │   │                           so an A-offline/B-online swap in the same tick still
        │   │                           re-runs the effect — length alone would miss that case.
        │   │                           Clicking a tile: setFocused + setLayoutMode('focus').
        │   │                           Empty-state shown when no agents are online.
        │   ├── FocusView.jsx           Single-agent detail view. If no agent is focused: shows
        │   │                           a prompt. When focused: renders 7-tab navigation bar +
        │   │                           active module panel (TAB_PANELS map dispatches to the
        │   │                           correct module component). Uses key={focused_agent.id}
        │   │                           on the active panel to force remount when the user
        │   │                           switches agents. Subscribes to focused_agent_id + agents
        │   │                           (not getFocusedAgent) to correctly re-render on agent change.
        │                               (FrameCanvas lives at components/FrameCanvas.jsx —
        │                               see the shared-primitive block above.)
        │
        └── modules/                    Each tab receives { agent } prop from FocusView.
            ├── ApplicationTab/
            │   └── index.jsx           Thin wrapper around <ModuleTable /> (see components/ModuleTable.jsx).
            │                           Reads app list from ModuleStore (agent.id slice), fallback
            │                           to a module-level EMPTY_APPS constant to keep the Zustand
            │                           selector reference stable.
            │                           Declares only:
            │                             - WHITELISTED_APPS Set at module scope (UPPER_SNAKE_CASE).
            │                             - COLUMNS array: display_name, status (custom render with
            │                               module-table__badge--<status>), cpu_percent (numeric,
            │                               toFixed(1)), ram_mb (numeric).
            │                             - renderAction(row): returns Start or Stop button based on
            │                               row.status; disabled when !WHITELISTED_APPS.has(row.name),
            │                               with a tooltip explaining why.
            │                           Polls buildAppList() every 3 s via setInterval; cleanup on
            │                           unmount / agent switch. Uses row_key={row.name}.
            │                           Sort state, thead click-to-sort, tbody layout, scroll
            │                           container, empty state — all owned by ModuleTable.
            ├── ProcessTab/
            │   └── index.jsx           Thin wrapper around <ModuleTable />. Reads full process list
            │                           from ModuleStore (fallback EMPTY_PROCS); polls buildProcList()
            │                           every 3 s.
            │                           Declares only:
            │                             - COLUMNS: name, pid (numeric), cpu_percent (numeric,
            │                               toFixed(1)), ram_mb (numeric, toFixed(0)).
            │                             - renderAction(row): Kill button on every row →
            │                               buildProcKill(row.pid).
            │                           Uses row_key={row.pid}. Kill removes process from mock state
            │                           — the row disappears on the next 3 s poll.
            │                           Sort/scroll/empty owned by ModuleTable.
            ├── ScreenTab/
            │   └── index.jsx           Screenshot + live stream panel. "Chụp 1 lần" sends
            │                           a single screenshot request. "Bắt đầu stream" starts
            │                           a 24 fps / quality 70 continuous stream; "Dừng stream"
            │                           stops it. Auto-stops on unmount or agent switch via
            │                           useEffect cleanup (streaming_agent_ref). Shows LIVE
            │                           badge with fps, resolution, and seq number from frame_meta.
            ├── KeylogTab/
            │   └── index.jsx           Terminal-style keystroke log from ModuleStore keylog slice.
            │                           Toolbar: IDLE/LIVE consent indicator (pulses red when active),
            │                           Start/Stop toggle (sends buildKeylogStart/Stop via sendToFocused),
            │                           Clear (clears keylog buffer in store), Export (download .txt).
            │                           Auto-scroll: scrolls to latest row on each new event unless
            │                           user has scrolled up; a "↓ Scroll to latest" pill resumes it.
            │                           Scroll detection via onScroll + SCROLL_THRESHOLD (60 px).
            │                           formatEvent() renders "Ctrl+C", "Alt+Tab", "h", etc.
            │                           formatTime() renders HH:MM:SS from event.timestamp_ms.
            ├── FileTab/
            │   └── index.jsx           Sandbox file tree with read, download, and upload.
            │                           Toolbar: title, "sandbox only" warning badge, Refresh.
            │                           Tree: accordion expand/collapse; dirs fetched on first open
            │                           via sendToFocused(buildFsList(path)); results cached in
            │                           ModuleStore file.tree[path]. File rows show size + Download
            │                           button; click sends buildFsGet(path) → fs_get_result arrives
            │                           in file_download slot → useEffect assembles chunks and calls
            │                           triggerBlobDownload (atob → Blob → anchor click).
            │                           Refresh clears file.tree and re-fetches root.
            │                           Upload: drag & drop zone (+ click-to-browse fallback input)
            │                           reads each dropped File via arrayBuffer(), splits into
            │                           CHUNK_SIZE_BYTES (32 KB) base64 chunks, sends first chunk via
            │                           buildFsPut(dest_path, chunk_info) to "/uploads/<filename>".
            │                           Each job renders a progress-bar row (sending/done/error).
            │                           Ack arrives in file_put_ack slot → useEffect advances the
            │                           progress counter and sends the next chunk; fs_put_complete
            │                           marks the job done. Multiple files upload independently and
            │                           concurrently since jobs are keyed by dest_path.
            │                           CSS: file-tab, file-tab__row--dir/file, file-tab__sandbox-badge,
            │                           file-tab__drop-zone, file-tab__upload-list, file-tab__progress-*.
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
| `agents` | `Agent[]` | 7 scaffold agents matching MockSocket FAKE_AGENTS (replaced by real data after `agents_list` arrives) |
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
| `keylog` | `object[]` | accumulated keystroke event objects (ring buffer, max 1000) |
| `keylog_active` | boolean | true while Agent is actively sending keylog data |
| `screen` | `{ frame, meta }` | latest screen JPEG (ArrayBuffer) + frame_meta object |
| `webcam` | `{ frame, meta }` | latest webcam JPEG (ArrayBuffer) + frame_meta object |
| `file` | `{ tree, path }` | `tree`: `{ [path]: entry[] }` — cached per-path listings; `path`: last fetched |
| `file_download` | `object \| null` | latest `fs_get_result` + monotonic `_seq`; FileTab watches and triggers download |

**Actions:**

| Action | Behaviour |
|---|---|
| `setModuleData(agent_id, module, payload)` | Write payload into data[agent_id][module]; creates agent slot if not present |
| `appendKeylog(agent_id, events)` | Append events to keylog buffer; trims oldest entries to stay within MAX_KEYLOG_EVENTS (1000) |
| `setKeylogActive(agent_id, active)` | Set `keylog_active` boolean for one agent (true on `keylog_started`, false on `keylog_stopped`/`keylog_denied`) |
| `setFsEntries(agent_id, path, entries)` | Merge a directory listing into `file.tree[path]` (called on `fs_list_result`) |
| `setFileDownload(agent_id, result)` | Store `fs_get_result` + monotonic `_seq` in `file_download` (FileTab watches this) |
| `clearFileDownload(agent_id)` | Null out `file_download` after the component has consumed it |
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
| `policy_update` | — | `app_whitelist[]`, `sandbox_path`, `target_agents[]` | Push security policy (whitelist + sandbox path). Agent applies to RAM immediately, overriding local config |

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
| `keylog_started` | `agent_id` | `ModuleStore.setKeylogActive(id, true)` |
| `keylog_stopped` | `agent_id` | `ModuleStore.setKeylogActive(id, false)` |
| `keylog_denied` | `agent_id`, `reason` | `setKeylogActive(id, false)` + `UiStore.addToast()` (error) |
| `stream_started` | `agent_id`, `module:"screen"` | TODO — update active-state flag (Week 4) |
| `stream_stopped` | `agent_id`, `module:"screen"` | TODO — update active-state flag (Week 4) |
| `webcam_started` | `agent_id` | TODO — update active-state flag (Week 4) |
| `webcam_stopped` | `agent_id` | TODO — update active-state flag (Week 4) |
| `webcam_denied` | `agent_id`, `reason` | `UiStore.addToast()` (error) |
| `fs_list_result` | `agent_id`, `path`, `entries[]` | `ModuleStore.setFsEntries(id, path, entries)` |
| `fs_get_result` | `agent_id`, `path`, `chunk_index`, `total_chunks`, `data_base64` | `ModuleStore.setFileDownload(id, msg)` — FileTab watches, assembles chunks, triggers browser download |
| `fs_put_result` | `agent_id`, `path`, `chunk_index`, `success` | `ModuleStore.setFilePutAck(id, {...msg, complete:false})` — FileTab advances progress, sends next chunk |
| `fs_put_complete` | `agent_id`, `path` | `ModuleStore.setFilePutAck(id, {...msg, complete:true})` — FileTab marks upload done |
| `fs_error` | `agent_id`, `path`, `message` | `UiStore.addToast()` (error) |
| `power_result` | `agent_id`, `action`, `confirmed`, `message` | TODO — surface in PowerTab (Week 4) |
| `policy_update_result` | `agent_id`, `success`, `message` | Confirms agent has applied the pushed whitelist + sandbox path |

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

`FrameCanvas` (the shared primitive at `src/components/FrameCanvas.jsx`) decodes the
ArrayBuffer via `createImageBitmap()`, draws it, and immediately calls `bitmap.close()`
to release GPU memory. A `cancelled` flag prevents stale async decode callbacks from
drawing over newer frames. It accepts a `module` prop ("screen" | "webcam", surfaced
as the canvas `data-module` attribute) and an optional `label` prop; when `label` is
provided the canvas is wrapped in a positioned container with a corner badge and the
aria-label becomes `"${label} frame"`. Livescreen views (GridView, FocusView, ScreenTab)
render their own status badges around the canvas and omit `label`; WebcamTab passes
`label="WEBCAM"` to display the built-in badge.

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
| Fixed dark surfaces | `--surface-feed`, `--border-feed`, `--text-feed`, `--text-feed-name`, `--surface-terminal`, `--text-terminal`, `--text-terminal-dim` |
| Misc UI tokens | `--text-on-accent`, `--shadow-notice` |
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
