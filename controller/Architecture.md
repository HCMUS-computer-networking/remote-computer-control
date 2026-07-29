# Controller — Architecture

Single-page React application that lets an operator monitor and control many Agent
machines through one Gateway WebSocket. This document describes the code as it
stands right now.

---

## 1. Directory tree

```
controller/
├── index.html
├── package.json
├── vite.config.js
├── public/
├── docs/
│   ├── formatjson/          # JSON message templates (Application, Connection,
│   │                        # File, Keylog, Livescreen, PolicyUpdate, Power,
│   │                        # Process, Webcam)
│   ├── diagram/
│   ├── screenshot/
│   ├── technical_explanation/
│   └── wireframe/
└── src/
    ├── main.jsx              # ReactDOM.createRoot entry
    ├── App.jsx               # root shell: conn banner + sidebar + top bar + main + toasts
    ├── index.css, App.css    # design tokens + all component styles
    ├── assets/               # static images
    ├── store/                # Zustand global state (five stores)
    │   ├── AgentStore.js
    │   ├── ConnectionStore.js
    │   ├── ModuleStore.js
    │   ├── PolicyStore.js    # pushed security policy (whitelist + sandbox path)
    │   └── UiStore.js
    ├── hooks/
    │   └── UseAgentSocket.js # singleton hook: owns socket + RX dispatch
    ├── services/
    │   ├── index.js         # single mock-vs-real switch (VITE_USE_MOCK)
    │   ├── Protocol.js       # pure builders / parsers for JSON messages
    │   ├── Socket.js         # real WebSocket wrapper (arraybuffer + reconnect)
    │   └── MockSocket.js     # in-process Gateway + Agent simulator
    └── components/
        ├── FrameCanvas.jsx   # shared JPEG-frame → <canvas> primitive
        ├── ModuleTable.jsx   # shared sortable table primitive
        ├── agents/
        │   ├── AgentCard.jsx     # one row in the sidebar list
        │   ├── AgentList.jsx     # filtered list of AgentCards
        │   └── MultiSelect.jsx   # "Select all online" + selection count toolbar
        ├── layout/
        │   ├── Sidebar.jsx       # logo, search box, AgentList, gateway status
        │   ├── TopBar.jsx        # breadcrumb, session badge, transparency badge,
        │   │                     # view toggle, connection indicator, theme, admin
        │   └── ThemeToggle.jsx   # sun/moon light-dark toggle
        ├── livescreen/
        │   ├── GridView.jsx      # tiled 2-fps overview of all online agents
        │   └── FocusView.jsx     # 7-tab panel for the focused agent
        └── modules/
            ├── ApplicationTab/index.jsx
            ├── ProcessTab/index.jsx
            ├── ScreenTab/index.jsx
            ├── KeylogTab/index.jsx
            ├── FileTab/index.jsx
            ├── WebcamTab/index.jsx
            └── PowerTab/index.jsx
```

---

## 2. Data flow

```
   ┌───────────────┐    read state       ┌──────────────┐
   │  Components   │ ─────────────────►  │   Zustand    │
   │ (tabs, views) │                     │   stores     │
   └──────┬────────┘                     └──────▲───────┘
          │ call action                         │ set state
          │                                     │
          ▼                                     │
   ┌───────────────┐   send(json)        ┌─────┴────────┐
   │useAgentSocket │ ──────────────────► │  MockSocket  │
   │   (hook)      │ ◄────────────────── │  (or Socket) │
   └───────────────┘   onMessage/binary  └──────────────┘
```

- Components read state through Zustand selectors and dispatch commands only
  through `useAgentSocket` (never touch a service directly).
- `useAgentSocket` is a singleton ref-counted hook: one WebSocket connection is
  shared across every component that calls the hook.
- Outgoing messages are built by `services/Protocol.js` (pure builders) and
  handed to the socket by the hook.
- Incoming messages are dispatched by the hook's `dispatchMessage()` routing
  table straight into the correct store action.

---

## 3. Zustand stores

### `AgentStore.js`
State
- `agents` — full list of `{ id, name, os, ip, online, in_session }`.
- `selected_agent_ids` — IDs currently checked for multi-agent commands.
- `focused_agent_id` — single agent open in FocusView.
- `search_query` — current text in the sidebar search box.

Actions
- `setAgents(agents)` — replace the list when `agents_list` arrives.
- `toggleSelect(id)` — add / remove one agent from the multi-select set.
- `setSelectedIds(ids)` — replace the whole selection (used by "Select all").
- `clearSelection()` — empty the multi-select set.
- `setFocused(id)` — open one agent in FocusView.
- `setSearchQuery(q)` — update the search box text.
- `getFilteredAgents()` — agents whose name or IP match `search_query`.
- `getFocusedAgent()` — object for `focused_agent_id` or `null`.

### `ConnectionStore.js`
State
- `status` — `'idle' | 'connecting' | 'open' | 'closed'`.
- `gateway_url` — destination WebSocket URL for the real `Socket.js`.
- `token` — auth token received after handshake.

Actions
- `connect(url)`, `disconnect()`, `setStatus(s)`, `setGatewayUrl(url)`,
  `setToken(t)`.

### `ModuleStore.js`
Root state: `data` keyed by `agent_id`. Each agent has:
- `app` — array from `app_list_result`.
- `process` — array from `proc_list_result`.
- `keylog` — accumulated events (capped at 1000).
- `keylog_active` — Agent is streaming keystrokes.
- `screen` — `{ frame: ArrayBuffer|null, meta }` — latest screen JPEG.
- `webcam` — `{ frame: ArrayBuffer|null, meta }` — latest webcam JPEG.
- `webcam_active` — Agent confirmed `webcam_started` (consent granted).
- `screen_stream_active` — Agent confirmed `stream_started`.
- `file` — `{ tree: { [path]: entries }, path }`.
- `file_download` — latest `fs_get_result` (consumed by FileTab).
- `file_put_ack` — latest per-chunk / complete upload ack.

Actions
- `setModuleData(agent_id, module, payload)` — merge / replace a slot.
- `appendKeylog(agent_id, events)` — append with buffer trim.
- `setKeylogActive`, `setWebcamActive`, `setScreenStreamActive` — flip
  transparency flags used by the red indicator.
- `setFsEntries(agent_id, path, entries)` — merge a directory listing.
- `setFileDownload(agent_id, result)` / `clearFileDownload`.
- `setFilePutAck(agent_id, result)` / `clearFilePutAck`.
- `clearModule(agent_id, module)`, `clearAgent(agent_id)`.

### `PolicyStore.js`
State
- `app_whitelist` — app short-names allowed to Start/Stop (the policy the
  Controller pushes to agents). Single source of truth — module tabs read this,
  never a hard-coded list.
- `sandbox_path` — Agent sandbox root pushed in the policy.
- `results` — `{ [agent_id]: { success, message } }` from `policy_update_result`.

Actions
- `setWhitelist(list)`, `setSandboxPath(path)`, `setPolicyResult(agent_id, result)`.

### `UiStore.js`
State
- `theme` — `'light' | 'dark'`.
- `layout_mode` — `'grid' | 'focus'`.
- `active_tab` — one of `'application' | 'process' | 'screen' | 'keylog' |
  'file' | 'webcam' | 'power'` (also exported as `MODULE_TABS`).
- `sidebar_open` — mobile sidebar visibility.
- `toasts` — array of `{ id, message, variant, timestamp }`.

Actions
- `setTheme`, `toggleTheme`, `setLayoutMode`, `setActiveTab` (also flips
  `layout_mode` to `'focus'`), `toggleSidebar`.
- `addToast(message, variant)` — auto-dismissed after 3 s.
- `dismissToast(id)`.

---

## 4. `useAgentSocket` — the sole glue layer

Singleton lifecycle
- Module-level `_socket`, `_refcount`, `_pending_meta`.
- The first component to call the hook creates one socket; the last to unmount
  closes it. `_pending_meta` holds the last `frame_meta` until its binary
  companion arrives.
- On `onOpen` the hook sends `list_agents` and then pushes the security policy
  (`buildPolicyUpdate` from `PolicyStore`, empty `target_agents` = all agents).

TX helpers returned by the hook
- `sendCommand(json)` — smart auto-targeting:
  - If the payload already has a non-empty `target_agents`, it is respected.
  - If `type` is not `"request"` or `"power"`, the message is passed through
    unchanged (e.g. `list_agents`).
  - For frame-focus modules (`screenshot`, `screen_stream`,
    `screen_stream_stop`, `webcam_start`, `webcam_stop`) `target_agents` is
    set to `[focused_agent_id]`.
  - For every other module command, `target_agents` is set to
    `selected_agent_ids` if the multi-select set is non-empty, otherwise falls
    back to `[focused_agent_id]`.
  - TODO in the code: confirm with the Gateway team that `target_agents` with
    multiple IDs is fan-out on the server side.
- `sendToFocused(json)` — force target to `[focused_agent_id]`.
- `sendToSelected(json)` — force target to `selected_agent_ids`.

Binary frame dispatch
- When `frame_meta` arrives it is stored in `_pending_meta`.
- The next `onBinary` ArrayBuffer is paired with that meta and pushed into
  `ModuleStore.data[agent_id].screen` or `.webcam` depending on `meta.module`.

RX routing table (`dispatchMessage`)

| Message `type`         | Effect |
|------------------------|--------|
| `agents_list`          | `AgentStore.setAgents(agents)` |
| `agent_status`         | (placeholder) |
| `app_list_result`      | `ModuleStore.setModuleData(id, 'app', apps)` |
| `app_action_result`    | toast (success or error) |
| `proc_list_result`     | `ModuleStore.setModuleData(id, 'process', procs)` |
| `proc_kill_result`     | toast (success or error) |
| `keylog`               | `ModuleStore.appendKeylog(id, events)` |
| `keylog_started`       | `setKeylogActive(id, true)` |
| `keylog_stopped`       | `setKeylogActive(id, false)` |
| `keylog_denied`        | `setKeylogActive(id, false)` + toast |
| `frame_meta`           | held in `_pending_meta` for the next binary |
| `stream_started`       | `setScreenStreamActive(id, true)` |
| `stream_stopped`       | `setScreenStreamActive(id, false)` |
| `webcam_started`       | `setWebcamActive(id, true)` |
| `webcam_stopped`       | `setWebcamActive(id, false)` |
| `webcam_denied`        | `setWebcamActive(id, false)` + toast |
| `fs_list_result`       | `setFsEntries(id, path, entries)` |
| `fs_get_result`        | `setFileDownload(id, result)` |
| `fs_put_result`        | `setFilePutAck(id, { ..., complete: false })` |
| `fs_put_complete`      | `setFilePutAck(id, { ..., complete: true })` |
| `fs_error`             | toast |
| `power_result`         | toast (confirmed or cancelled) |
| `policy_update_result` | `PolicyStore.setPolicyResult`; toast only on failure |
| binary (ArrayBuffer)   | paired with `_pending_meta` → `setModuleData(id, meta.module, { frame, meta })` |

---

## 5. Protocol — supported messages

`services/Protocol.js` exports constants and builders. All formats mirror the
templates in `docs/formatjson/*.json`.

### TX message types (Controller → Gateway)
- `list_agents` — `buildListAgents()`.
- `request` — generic envelope with `{ module, params, target_agents }` for
  every module command. Built by module-specific helpers below.
- `power` — separate top-level type carrying `{ action, target_agents }`.
- `policy_update` — separate top-level type carrying
  `{ params: { app_whitelist, sandbox_path }, target_agents }`. Built by
  `buildPolicyUpdate`; pushed on connect.

### Module constants (value of `request.module`)
Application: `app_list`, `app_start`, `app_stop`.
Process:     `proc_list`, `proc_kill`.
Screen:      `screenshot`, `screen_stream`, `screen_stream_stop`.
Keylog:      `keylog_start`, `keylog_stop`.
File:        `fs_list`, `fs_get`, `fs_put`.
Webcam:      `webcam_start`, `webcam_stop`.

### Power actions
`lock` (immediate), `restart`, `shutdown`, `sleep`.

### RX message types (Gateway / Agent → Controller)
`agents_list`, `agent_status`, `frame_meta`, `app_list_result`,
`app_action_result`, `proc_list_result`, `proc_kill_result`, `keylog`,
`keylog_started`, `keylog_stopped`, `keylog_denied`, `stream_started`,
`stream_stopped`, `webcam_started`, `webcam_stopped`, `webcam_denied`,
`fs_list_result`, `fs_get_result`, `fs_put_result`, `fs_put_complete`,
`fs_error`, `power_result`, `policy_update_result`.

### Binary channel
Screen and webcam frames arrive as a pair:
1. JSON `frame_meta { type, module, agent_id, w, h, len, seq, timestamp_ms }`.
2. Raw JPEG bytes as an `ArrayBuffer` on the socket's binary handler.

### Exported builders
`buildListAgents`, `buildRequest`, `buildAppList`, `buildAppStart`,
`buildAppStop`, `buildProcList`, `buildProcKill`, `buildScreenshot`,
`buildStreamStart`, `buildStreamStop`, `buildKeylogStart`, `buildKeylogStop`,
`buildFsList`, `buildFsGet`, `buildFsPut`, `buildWebcamStart`,
`buildWebcamStop`, `buildPower`, `buildPolicyUpdate`. Plus `buildMessage` /
`parseMessage`.

### Incoming adapter — `normalizeIncoming(raw_msg)`
Rewrites a real Gateway/Agent JSON message into the ONE canonical shape the
store + `dispatchMessage` already expect, so the wire format can differ from the
mock without touching any component or store. `UseAgentSocket` runs it on every
JSON message before dispatch; already-canonical mock messages pass through
unchanged.
- `TYPE_ALIASES` — real `type` string → canonical `MSG_TYPE` (identity if absent).
- Shared field aliases: `agent_id` ⟵ `agentId`/`agentID`/`machine_id`;
  `timestamp_ms` ⟵ `ts`/`time`/`timestamp`.
- Per-type `NORMALIZERS` reshape list/record types: `agents_list`,
  `app_list_result`, `proc_list_result`, `keylog`, `frame_meta`,
  `fs_list_result`, `fs_get_result`, `power_result`, `policy_update_result`.
  Types with no normalizer keep their body and only get `agent_id` +
  `timestamp_ms` fixed.
- All lookups use `pickField(obj, aliases, fallback)` (first match wins), so
  unknown messages degrade to a safe pass-through. Alias arrays are the single
  "EDIT POINT" to extend when a new real field name appears.

---

## 6. Feature status per module

### Application (`ApplicationTab/index.jsx`)
- Table via `ModuleTable`: App Name (`display_name`), Status (badge), CPU %,
  RAM (MB).
- Start / Stop buttons per row, disabled for non-whitelisted apps. The
  whitelist is NOT hard-coded: each row's `in_whitelist` (from the Agent, which
  applies the pushed policy) is used, falling back to `PolicyStore.app_whitelist`.
- 3-second polling loop dispatching `buildAppList`.
- Toast on Start / Stop confirmation from `app_action_result`.

### Process (`ProcessTab/index.jsx`)
- Table via `ModuleTable`: Process Name, PID, CPU %, RAM (MB).
- Kill button per row, dispatching `buildProcKill`.
- 3-second polling loop dispatching `buildProcList`.
- Toast on Kill confirmation from `proc_kill_result`.

### Screen (`ScreenTab/index.jsx`)
- "Chụp 1 lần" → `buildScreenshot`.
- "Bắt đầu / Dừng stream" → `buildStreamStart(24, 70, [id])` and
  `buildStreamStop([id])`.
- Renders frames via `FrameCanvas` (shared primitive).
- Cleanup effect stops the stream on tab switch or agent change.
- Status bar shows resolution, sequence, and a `● LIVE` badge.

### Grid live-screen (`livescreen/GridView.jsx`)
- Tiled thumbnails of every online agent via `FrameCanvas`.
- Low-fps continuous stream (2 fps by default).

### Focus live-screen (`livescreen/FocusView.jsx`)
- 7-tab bar (Application / Process / Screen / Keylog / File / Webcam / Power)
  and the active module panel for `focused_agent_id`.

### Keylog (`KeylogTab/index.jsx`)
- Start / Stop buttons dispatching `buildKeylogStart` / `buildKeylogStop`.
- Terminal-style scrollable log fed by `appendKeylog`.
- Uses `keylog_active` for the running / consent-denied UI state.

### File (`FileTab/index.jsx`)
- Sandbox-only browser of `fs_list_result` under `data[id].file.tree`. The
  "sandbox only" badge tooltip shows `PolicyStore.sandbox_path` (from the pushed
  policy, not hard-coded).
- Download via `buildFsGet` (single-chunk base64 → Blob download).
- Chunked upload via `buildFsPut`, progress bar advances on each
  `fs_put_result`, marked complete on `fs_put_complete`.
- Toast on `fs_error`.

### Webcam (`WebcamTab/index.jsx`)
- "Bật / Tắt webcam" → `buildWebcamStart(15, 60, [id])` and
  `buildWebcamStop([id])`.
- Renders frames via `FrameCanvas` with `module="webcam"` and label
  `"WEBCAM"`.
- Consent indicator: red "● CAM ON" badge when `webcam_active` is `true`,
  amber "Waiting for consent…" while `streaming && !webcam_active`.
- Cleanup effect stops the stream on unmount to release the camera LED.

### Power (`PowerTab/index.jsx`)
- Four buttons: Lock, Restart, Shutdown, Sleep.
- Lock dispatches `buildPower(POWER_ACTION.LOCK, [id])` immediately.
- Restart / Shutdown / Sleep open a reusable `<CountdownModal>` (10 s
  countdown, Cancel button, Esc, click-outside).
- On countdown reaching 0 the corresponding `buildPower(action, [id])` is
  sent; on cancel nothing is sent (the countdown lives Controller-side).
- Toast on `power_result`.

### Empty / loading / offline states
- Each module tab distinguishes three states through a friendly message and
  disabled controls: loading (waiting for the first reply), agent offline
  (`agent.online === false`), and Gateway disconnected (`ConnectionStore.status
  !== 'open'`). Offline agents are not polled and their action buttons /
  upload zone / power actions are disabled.
- `ApplicationTab` / `ProcessTab` pass a computed `empty_label` to `ModuleTable`
  and hide the poll badge when offline.
- `ScreenTab` / `WebcamTab` / `FileTab` / `PowerTab` show a `WifiOff`
  placeholder when offline; `KeylogTab` shows an `OFFLINE` indicator.
- `App.jsx` renders a full-width `ConnectionBanner` above the TopBar while the
  socket is `connecting` (warning) or `closed` (danger); hidden when open.
- Sidebar `AgentCard` dims offline agents and adds an `OFFLINE` text pill next
  to the gray status dot.

### Transparency indicators
- `AgentCard.jsx` shows a pulsing red dot (`.transparency-dot`) next to the online dot whenever any
  of `screen_stream_active`, `webcam_active`, `keylog_active`, or `in_session`
  is true for that agent.
- `TopBar.jsx` shows a global red badge `● SENSITIVE · N` listing every agent
  id currently in a sensitive state; always visible across Grid and Focus.
  The badge subscribes to `ModuleStore` through `useShallow` on a derived
  per-agent boolean map so incoming frames do not re-render the top bar.

---

## 7. Shared primitives

### `FrameCanvas.jsx`
- Decodes a JPEG `ArrayBuffer` with `createImageBitmap`, draws it onto a
  `<canvas>`, and releases GPU memory with `bitmap.close()` on every frame
  and on unmount.
- One-shot `cancelled` flag guards against late decode callbacks on stale
  frames.
- Props: `frame_buffer`, `module` (`"screen" | "webcam"`), `label`, `width`,
  `height`. When `label` is passed, wraps the canvas in a positioned
  container with a corner badge — used by WebcamTab. Without `label`, renders
  the bare canvas — used by GridView / FocusView / ScreenTab that already
  have their own status badges.

### `ModuleTable.jsx`
- Pure-UI sortable table used by ApplicationTab and ProcessTab.
- Props: `columns`, `rows`, `actionColumn`, `empty_label`, `title`,
  `poll_badge`, `row_key`.
- Sort state is local; click a header to toggle direction or switch column.
- Never imports any store or service.

---

## 8. Socket services

`services/Socket.js` (real) and `services/MockSocket.js` (simulator) expose the
identical API surface (`connect`, `close`, `send`, `onOpen`, `onMessage`,
`onBinary`, `onClose`, `onError`). `services/index.js` picks one and exports it
as `AgentSocket`; `UseAgentSocket` imports only from `../services`.

### `Socket.js` (real WebSocket)
- Target URL from `import.meta.env.VITE_GATEWAY_URL`, fallback
  `ws://localhost:8080`.
- `binaryType = "arraybuffer"` so image/video frames arrive as `ArrayBuffer`.
- `onmessage` splits `typeof data === 'string'` (JSON → `onMessage`) from
  binary (`ArrayBuffer` → `onBinary`), matching the frame_meta + binary pair.
- Auto-reconnect with exponential backoff (500 ms base, 8 s cap); reset on a
  clean open; suppressed after a user `close()`.
- Keeps `ConnectionStore.status` in sync (`connecting` / `open` / `closed`).

### MockSocket

- 7 fake agents cover every UI state: Windows online / offline,
  in-session, Ubuntu, macOS, and one agent (`agent-06`) that always denies
  consent for keylog and webcam.
- Per-agent mutable state so Start / Stop / Kill / Upload have visible
  effects across polls (`_app_state`, `_proc_state`, `_uploaded_files`).
- Frame stream engine (`_startFrameStream`) draws a coloured test card on an
  off-screen `<canvas>`, encodes to JPEG, and emits `frame_meta` + binary
  pair at the requested fps. Reused by screen and webcam (only
  `frame_meta.module` differs).
- Keylog stream engine emits random batches every 1.5 s from a fixed pool.
- Sandbox file tree is static, extended with per-agent uploaded files on the
  next `fs_list`.
- Consent-denied agents reply `keylog_denied` / `webcam_denied` instead of
  the corresponding `*_started`.
- Power replies `power_result` with `confirmed: true`.
- `policy_update` is stored in RAM; the whitelist then drives each app's
  `in_whitelist` in `app_list_result`, and the mock replies
  `policy_update_result` per agent — a full end-to-end policy demo.
- All timers (frame streams, keylog streams, connect timer) are cancelled on
  `close()`.

---

## 9. Conventions

- **State**: Zustand only. No Redux, no Context API for continuous state.
  Actions live inside the store; components read via selectors.
- **File naming**: `PascalCase.jsx` for components, `camelCase.js` for
  hooks / services / stores. Module tabs live in their own folder as
  `<Name>Tab/index.jsx`.
- **Formatting**: Allman braces, single quotes, no semicolons in JSX.
  Comments in English, one line above the code they describe.
- **Component structure**: one selector per state slice used, effects at the
  top, event handlers next, JSX at the bottom.
- **Styling**: CSS in `src/index.css` and `src/App.css`. Tokens live at the
  top of `index.css` and are flipped by the `data-theme="dark"` attribute
  set by `App.jsx`. A spacing scale (`--space-1..6`) and radius scale
  (`--radius-sm/md/lg`) are theme-independent and used by newer rules.
  Shared helpers: `.spin` (generic icon spinner), `.transparency-dot`
  (red pulsing sensitive-activity dot), `.conn-banner` (offline strip),
  `.module-offline` (offline module state), `.screen-tab__consent-badge`
  (webcam consent), and the `.power-tab__grid` / `.power-modal__*` classes.
  Two palette groups coexist:
  - Theme-tinted tokens (`--danger`, `--warning`, `--accent`, ...) shift
    between light and dark.
  - Solid alert tokens (`--danger-solid`, `--danger-solid-glow`,
    `--danger-deep`, `--warning-solid`, `--on-danger`, `--on-warning-solid`,
    `--overlay-scrim`, `--shadow-modal`) stay identical in both themes so
    sensitive-activity dots and modal chrome keep the same vivid look
    regardless of theme.
  Components never inline hex or rgba values — they always reference a token.
- **Socket access**: components never import a service directly; they use
  `useAgentSocket`. Only `useAgentSocket` and `Protocol` know about the
  wire format.

---

## 10. Mock → real switch

- `services/index.js` is the ONLY place that chooses mock vs real. It reads
  `import.meta.env.VITE_USE_MOCK`: any value other than the string `"false"`
  keeps the mock (default), `"false"` uses the real `Socket`. No import edit is
  needed to switch — just the env flag.
- `hooks/UseAgentSocket.js` imports `AgentSocket` from `../services` and never
  references `MockSocket` or `Socket` directly.
- Both socket classes expose the same surface (`connect`, `close`, `send`,
  `onOpen`, `onMessage`, `onBinary`, `onClose`, `onError`), so no component or
  store change is ever needed.
- Real Gateway URL comes from `VITE_GATEWAY_URL` (fallback `ws://localhost:8080`);
  `ConnectionStore.gateway_url` mirrors the same default for display.
- The `target_agents` fan-out semantics that `sendCommand` relies on need
  explicit confirmation from the Gateway team; the TODO note is in
  `UseAgentSocket.js`.
