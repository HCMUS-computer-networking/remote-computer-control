# Controller — Architecture

Single-page React app that operates as the admin console of a consent-based
remote administration tool. It talks to a Node.js Gateway over a raw WebSocket;
the Gateway relays JSON messages and binary frames to/from C# .NET 8 Agents
running on Windows machines in the lab. Controller is UI + state only — no
business logic runs on the Agent's behalf here.

The document describes the CURRENT state of the code only.

---

## 1. Tech stack

- **React 19** — UI.
- **Vite** — dev server + build.
- **Zustand 5** — global state (one store per concern; components subscribe with a selector).
- **lucide-react** — SVG icon set.
- **recharts** — line charts for the SysInfo dashboard.
- **Native WebSocket** — transport to the Gateway. No Socket.IO.
- Plain JavaScript, no TypeScript.

---

## 2. Directory tree

```
controller/
├── docs/formatjson/              # authoritative JSON message specs (one file per module)
│   ├── Application.json
│   ├── Connection.json
│   ├── File.json
│   ├── Input.json                # remote input (not wired to any component)
│   ├── Instruction.md
│   ├── Keylog.json
│   ├── Livescreen.json
│   ├── PolicyUpdate.json
│   ├── Power.json
│   ├── Process.json
│   ├── SysInfo.json
│   └── Webcam.json
├── Architecture.md               # this file
├── README.md
├── package.json                  # deps: react, react-dom, zustand, lucide-react, recharts
├── vite.config.js
└── src/
    ├── main.jsx                  # React root; mounts <App />
    ├── App.jsx                   # login gate + console shell + toast layer
    ├── App.css, index.css        # global styles + CSS custom properties (theme tokens)
    ├── services/
    │   ├── index.js              # picks MockSocket vs Socket via VITE_USE_MOCK
    │   ├── Socket.js              # real WebSocket wrapper
    │   ├── MockSocket.js          # in-process Gateway + Agent simulator
    │   ├── Protocol.js            # JSON builders / parsers / normalizer / enums
    │   └── AuthService.js         # login, refreshAccessToken, logout, apiFetch, getToken
    ├── store/                    # Zustand stores (one file per concern)
    │   ├── AgentStore.js
    │   ├── ConnectionStore.js
    │   ├── ModuleStore.js
    │   ├── PermissionStore.js
    │   ├── PolicyStore.js
    │   └── UiStore.js
    ├── hooks/
    │   └── UseAgentSocket.js     # sole bridge between socket service and stores
    └── components/
        ├── LoginScreen.jsx        # admin sign-in gate
        ├── ModuleTable.jsx        # shared sortable table template (App / Process)
        ├── FrameCanvas.jsx        # shared JPEG-decode + canvas template (Screen / Webcam)
        ├── PermissionGate.jsx     # consent context provider + status bar + Disconnect
        ├── agents/
        │   ├── AgentList.jsx
        │   ├── AgentCard.jsx
        │   └── MultiSelect.jsx
        ├── layout/
        │   ├── Sidebar.jsx
        │   ├── TopBar.jsx
        │   └── ThemeToggle.jsx
        ├── livescreen/
        │   ├── GridView.jsx       # all-agents grid preview
        │   └── FocusView.jsx      # single-agent 8-tab console
        └── modules/               # one folder per feature tab
            ├── SysInfoTab/index.jsx
            ├── ApplicationTab/index.jsx
            ├── ProcessTab/index.jsx
            ├── ScreenTab/index.jsx
            ├── KeylogTab/index.jsx
            ├── FileTab/index.jsx
            ├── WebcamTab/index.jsx
            └── PowerTab/index.jsx
```

---

## 3. Zustand stores

Each store is created once at module load and exported as a hook. Components
subscribe with `useStore((s) => s.x)` selectors — never the whole store.

### `AgentStore.js`
State
- `agents` — array of `{ id, name, os, ip, online, in_session }`.
- `selected_agent_ids` — array of ids in the multi-select set.
- `focused_agent_id` — id currently open in Focus view.
- `search_query` — sidebar filter text.

Actions
- `setAgents(list)` — replace the whole list (from `agents_list`).
- `toggleSelect(id)` — add / remove id from the multi-select set.
- `setAgentStatus(id, patch)` — merge live online / in_session flags; no-op on unknown id.
- `setFocusedAgent(id)`.
- `setSelected(ids)` — bulk replace the selection (used by "select all").
- `clearSelected()`.
- `setSearchQuery(q)`.
- `getFilteredAgents()` — non-reactive helper for filtering.
- `getFocusedAgent()` — non-reactive helper.

### `ConnectionStore.js`
State
- `status` — `'idle' | 'connecting' | 'open' | 'closed'`.
- `gateway_url` — WS destination (`ws://localhost:8080` by default).
- `auth_token` — access JWT held **in memory only**; never in
  sessionStorage / localStorage. A page reload signs the operator out; the
  Gateway's HttpOnly refresh cookie is what lets `refreshAccessToken()`
  re-hydrate the token without a full login.

Actions
- `connect(url?)`, `disconnect()` — state-only signals; `UseAgentSocket` reacts.
- `setStatus(status)`, `setGatewayUrl(url)`.
- `setAuthToken(token)`, `clearAuthToken()`.

### `ModuleStore.js`
Shape `data[agent_id][module]` — one slot per agent per feature.

Per-agent slots
- `app` — array from `app_list_result`.
- `process` — array from `proc_list_result`.
- `keylog` — accumulated events (capped at `MAX_KEYLOG_EVENTS = 1000`).
- `keylog_active` — `true` while the Agent is emitting events.
- `screen` — `{ frame: ArrayBuffer|null, meta }` — latest screen JPEG.
- `webcam` — `{ frame: ArrayBuffer|null, meta }` — latest webcam JPEG.
- `webcam_active`, `screen_stream_active` — indicator flags.
- `file` — `{ tree: { [path]: entries }, path }` — cached sandbox directory listings.
- `file_downloads` — map keyed by `transfer_id`. Each entry:
  `{ transfer_id, path, total_size, total_chunks, received_chunks, chunks: Uint8Array[], _seq }`.
  Kept as a map (not a single slot) so bursts of chunks can never overwrite one another.
- `file_put_ack` — latest `fs_put_result` / `fs_put_complete` with `_seq` for effect re-fire.
- `sysinfo` — latest snapshot.
- `sysinfo_history` — rolling `{ t, cpu_percent, ram_percent, disk_percent }`
  samples (capped at `MAX_SYSINFO_HISTORY = 60`) that drives the sparkline charts.

Actions
- `setModuleData(agent_id, module, payload)` — merge / replace one slot.
- `appendKeylog(agent_id, events)` — append with buffer trim.
- `setKeylogActive`, `setWebcamActive`, `setScreenStreamActive` — flip indicator flags.
- `setFsEntries(agent_id, path, entries)` — merge a directory listing.
- `appendFileDownloadChunk(agent_id, { transfer_id, chunk_index, total_chunks, path, total_size, bytes })`
  — append one raw chunk into the download job map. Guards against out-of-range indices
  and duplicate slots.
- `removeFileDownload(agent_id, transfer_id)` — free a completed / cancelled job.
- `setFilePutAck(agent_id, result)` / `clearFilePutAck(agent_id)`.
- `appendSysInfo(agent_id, snapshot)` — store latest + push a compact percent-only
  sample into `sysinfo_history` (trimmed).
- `clearModule(agent_id, module)`, `clearAgent(agent_id)`.

### `PermissionStore.js`
State
- `permissions[agent_id][feature]` — one of `'idle' | 'requesting' | 'granted' | 'denied'`.

Actions
- `requestPermission(agent_id, feature)` — mark `'requesting'`.
- `setPermissionResult(agent_id, feature, granted)` — Agent reply → `'granted'` or `'denied'`.
- `revoke(agent_id, feature)` — reset to `'idle'`.
- `getStatus(agent_id, feature)` — non-reactive read for hook / callback code.

### `PolicyStore.js`
State
- `app_whitelist` — array of short app names allowed to Start/Stop.
- `sandbox_path` — Agent sandbox root that file operations are confined to.
- `policy_results[agent_id]` — `{ success, message }` from each Agent's `policy_update_result`.

Actions
- `setAppWhitelist(list)`, `setSandboxPath(path)`.
- `setPolicyResult(agent_id, result)`.

### `UiStore.js`
State
- `theme` — `'light' | 'dark'`.
- `view_mode` — `'grid' | 'focus'`.
- `active_tab` — one of `'sysinfo' | 'application' | 'process' | 'screen' | 'keylog' | 'file' | 'webcam' | 'power'`.
- `sidebar_open` — sidebar visibility.
- `toasts` — array of `{ id, message, variant }` for the notification stack.

Actions
- `toggleTheme()`, `setTheme(t)`.
- `setViewMode(mode)`.
- `setActiveTab(id)` — also flips `view_mode` to `'focus'`.
- `toggleSidebar()`, `setSidebar(open)`.
- `addToast(message, variant)` — auto-dismiss after ~4 s.
- `dismissToast(id)`.

---

## 4. Data flow

```
Component  →  UseAgentSocket (send*)  →  services/Socket|MockSocket  →  Gateway ⇄ Agent
                                              │
                        Gateway push          ↓
Component  ←  Zustand store (selector)  ←  dispatchMessage(…)  ←  onMessage / onBinary
```

- **Outbound**: every component calls `useAgentSocket()` and invokes one of
  `sendCommand / sendToFocused / sendToSelected / requestPermission /
  revokePermission / stopModule`. Components never import a store's setter to
  write outgoing data, and never touch the socket directly.
- **Inbound**: `UseAgentSocket` registers `onMessage` and `onBinary` once when
  the first hook consumer mounts. Every JSON message goes through
  `Protocol.normalizeIncoming` (real ↔ canonical shape) and then
  `dispatchMessage` routes it to the correct store action.
- **Binary pairing**: an `ArrayBuffer` arrives immediately after either a
  `frame_meta` (screen / webcam JPEG) or an `fs_get_result` metadata JSON with
  no `data_base64` field (binary-chunk file download). The hook holds
  `_pending_meta` and `_pending_fs_chunk` module-level slots and pairs each
  binary with the correct pending JSON on arrival. `_pending_fs_chunk` takes
  precedence because file transfers are request-driven and always paired 1:1.

### Multi-agent fan-out
`sendCommand` / `sendToFocused` / `sendToSelected` all funnel into a private
`fanoutSend(msg, target_ids)` that emits **one message per agent** with
`target_agents: [one_id]`. Agents whose `(agent_id, feature)` status is not
`'granted'` are skipped; the count of skipped agents is surfaced as one
aggregate error toast so a bulk action does not spam N warnings.

Some modules (screen / screenshot / webcam) only make sense for one agent at a
time — `sendCommand` routes them to `focused_agent_id` even when a multi-select
set is present (`FRAME_FOCUS_MODULES` set inside the hook).

---

## 5. Auth flow

Login and token lifecycle live in `services/AuthService.js`. All fetches use
`credentials: 'include'` so the browser attaches the HttpOnly refresh cookie
the Gateway sets on login.

- `login(username, password)` — `POST /api/login`. Success writes the short-lived
  access JWT to `ConnectionStore.auth_token`.
- `refreshAccessToken()` — `POST /api/refresh`. Concurrent callers are
  deduplicated onto a single in-flight promise (`_refresh_in_flight`) so the
  Gateway sees exactly one refresh at a time. Snapshots a monotonic
  `_session_epoch` at start; if `logout()` bumped the epoch mid-fetch, the
  result is silently dropped instead of un-logging the operator out.
- `logout()` — bumps `_session_epoch`, clears `auth_token` synchronously (UI
  drops to LoginScreen this tick), then fires `POST /api/logout` in the
  background best-effort so the Gateway can revoke the refresh cookie.
- `apiFetch(url, opts)` — interceptor around `fetch`. Injects
  `Authorization: Bearer <token>` + `credentials: 'include'`. On `401` it
  runs one refresh + one retry; on refresh failure it logs out.
- `getToken()` — non-reactive read from the store.

### Access-token expiry mid-session
Two paths converge on the same result:

- `Socket.js` — on repeated failed opens with a token set
  (`AUTH_FAIL_THRESHOLD = 2`), calls `refreshAccessToken()` once. Success →
  `_openSocket()` again with the new JWT. Failure → toast + `logout()`.
- `UseAgentSocket.dispatchMessage(auth_expired)` — Gateway push during an open
  session. Refresh → `_socket.reopen()` (force-close then reopen without
  setting the "user closed" flag). Failure → toast + `logout()`.

---

## 6. `services/Protocol.js`

Pure JSON builders + parsers + type constants. No network calls, no store
touch. The four exported enum objects are the vocabulary the rest of the app
uses:

- `MSG_TYPE` — every wire `type` string: `LIST_AGENTS, REQUEST, POWER,
  POLICY_UPDATE, PERMISSION_REQUEST, PERMISSION_REVOKE, STOP_MODULE,
  AGENTS_LIST, AGENT_STATUS, FRAME_META, APP_LIST_RESULT, APP_ACTION_RESULT,
  PROC_LIST_RESULT, PROC_KILL_RESULT, KEYLOG, KEYLOG_STARTED, KEYLOG_STOPPED,
  KEYLOG_DENIED, STREAM_STARTED, STREAM_STOPPED, WEBCAM_STARTED,
  WEBCAM_STOPPED, WEBCAM_DENIED, FS_LIST_RESULT, FS_GET_RESULT, FS_PUT_RESULT,
  FS_PUT_COMPLETE, FS_ERROR, POWER_RESULT, POLICY_UPDATE_RESULT,
  PERMISSION_RESULT, SYSINFO_RESULT, AUTH_EXPIRED`.
- `FEATURE` — consent vocabulary: `APPLICATION, PROCESS, SCREEN, KEYLOG,
  FILE, WEBCAM, POWER`. One per sensitive capability.
- `MODULE` — value of the `"module"` field inside a REQUEST envelope:
  `APP_LIST, APP_START, APP_STOP, PROC_LIST, PROC_KILL, SCREENSHOT,
  SCREEN_STREAM, SCREEN_STREAM_STOP, KEYLOG_START, KEYLOG_STOP, FS_LIST,
  FS_GET, FS_PUT, WEBCAM_START, WEBCAM_STOP, SYSINFO`.
- `POWER_ACTION` — `LOCK, RESTART, SHUTDOWN, SLEEP`.

### Input validators (defense-in-depth)
Every builder that receives external input runs its arguments through small
assertion helpers before shaping the JSON — bad type or range throws a plain
`Error`. Primary validation still lives in the tab form UIs (inline red error +
disabled submit); these throws catch anything the UI let through.

- `assertPositiveInt` — PID, chunk counts.
- `assertIntInRange(v, min, max)` — fps, quality.
- `assertNonNegativeInt` — chunk_index, byte counts.
- `assertNonEmptyString` — app name, base64 chunks, transfer_id.
- `assertSafePath` — sandbox paths: non-empty, no NUL, starts with `/`, no `..`.
- `assertOneOf` — enumerated values (POWER_ACTION).

Callsites that receive user-typed input wrap the builder in try/catch and toast
the message; callsites that pass row-data or constants let the throw propagate
— an invalid value there is a bug.

### Exported builders
`buildListAgents`, `buildRequest`, `buildAppList`, `buildAppStart`,
`buildAppStop`, `buildProcList`, `buildProcKill`, `buildScreenshot`,
`buildStreamStart`, `buildStreamStop`, `buildKeylogStart`, `buildKeylogStop`,
`buildFsList`, `buildFsGet`, `buildFsPut` (params: `transfer_id`, `total_size`,
`chunk_index`, `total_chunks`, `data_base64`), `buildWebcamStart`,
`buildWebcamStop`, `buildSysInfo`, `buildPower`, `buildPolicyUpdate`,
`buildPermissionRequest`, `buildPermissionRevoke`, `buildStopModule`. Plus
`buildMessage` / `parseMessage`.

Every outgoing message auto-includes a short random `command_id` (the Agent's
validator rejects packets with empty command_id).

### Incoming adapter — `normalizeIncoming(raw_msg)`
Rewrites a real Gateway/Agent JSON message into the ONE canonical shape the
stores + `dispatchMessage` expect. `UseAgentSocket` runs it on every JSON
message before dispatch; canonical mock messages pass through unchanged.

- `TYPE_ALIASES` — real `type` string → canonical `MSG_TYPE` (identity if absent).
- Shared field aliases: `agent_id` ⟵ `agentId`/`agentID`/`machine_id`;
  `timestamp_ms` ⟵ `ts`/`time`/`timestamp`.
- Per-type `NORMALIZERS` reshape list/record types: `agents_list`,
  `agent_status`, `app_list_result`, `proc_list_result`, `keylog`, `frame_meta`,
  `fs_list_result`, `fs_get_result` (extracts `transfer_id`), `fs_put_result`,
  `fs_put_complete`, `power_result`, `policy_update_result`,
  `permission_result`, `sysinfo_result`.
- Types with no normalizer keep their body and only get `agent_id` +
  `timestamp_ms` fixed.
- All lookups use `pickField(obj, aliases, fallback)`.

---

## 7. `hooks/UseAgentSocket.js`

Singleton pattern — ref-counted so multiple components can call the hook
without opening extra WebSocket connections. The socket is created when
`_refcount` goes 0→1 and closed when it goes 1→0.

### TX helpers returned to callers
- `sendCommand(json_string)` — raw send. `request` / `power` messages get
  auto-target-resolution and fan-out; everything else (list_agents, etc.)
  passes through as-is.
- `sendToFocused(json_string)` — inject `[focused_agent_id]` as target.
- `sendToSelected(json_string)` — inject the whole `selected_agent_ids` set.
- `requestPermission(feature, agent_id?)` — loop-emit one `permission_request`
  per agent; marks each pair `'requesting'` locally.
- `revokePermission(feature, agent_id?)` — loop-emit one `permission_revoke`
  per agent, reset consent to `'idle'`, drop the live indicator for that
  feature on that agent.
- `stopModule(feature, agent_id?)` — loop-emit `stop_module` and drop the
  local indicator (`screen_stream_active` / `keylog_active` / `webcam_active`).

### Message dispatch (`dispatchMessage`)
Routes each incoming canonical message to the correct store action:

| Incoming `type` | Store action |
| --- | --- |
| `agents_list` | `AgentStore.setAgents(agents)` |
| `agent_status` | `AgentStore.setAgentStatus(id, patch)`; unknown id → resync `list_agents` |
| `app_list_result` | `ModuleStore.setModuleData(id, 'app', apps)` |
| `app_action_result` | toast (success / error) |
| `proc_list_result` | `ModuleStore.setModuleData(id, 'process', procs)` |
| `proc_kill_result` | toast |
| `keylog` | `ModuleStore.appendKeylog(id, events)` |
| `keylog_started` / `stopped` / `denied` | `setKeylogActive` + toast on denied |
| `stream_started` / `stopped` | `setScreenStreamActive(id, …)` |
| `webcam_started` / `stopped` / `denied` | `setWebcamActive` + toast on denied |
| `frame_meta` | stored in `_pending_meta` for the next binary |
| `fs_list_result` | `setFsEntries(id, path, entries)` |
| `fs_get_result` | JSON mode: decode `data_base64` → bytes → `appendFileDownloadChunk`; binary mode: stash meta in `_pending_fs_chunk`, next binary frame is the raw chunk |
| `fs_put_result` | `setFilePutAck(id, { ..., complete: false })` |
| `fs_put_complete` | `setFilePutAck(id, { ..., complete: true })` |
| `fs_error` | toast |
| `power_result` | toast |
| `policy_update_result` | `setPolicyResult(id, …)`; toast on failure |
| `permission_result` | `setPermissionResult(id, feature, granted)` + toast |
| `sysinfo_result` | `appendSysInfo(id, snapshot)` |
| `auth_expired` | `refreshAccessToken()`; success → `_socket.reopen()`; failure → toast + `logout()` |
| binary `ArrayBuffer` | pair with `_pending_fs_chunk` first (file chunk); otherwise with `_pending_meta` (screen / webcam frame) |

### Guards
- Every per-agent message must carry `agent_id` after normalization. Missing
  `agent_id` is dropped with a warning. `AGENTS_LIST` and `AUTH_EXPIRED` are
  exempt.
- `agent_status` for an unknown id triggers a `list_agents` resync so the
  sidebar picks up the new agent's `name / os / ip`, not just the flag.

---

## 8. Socket services

`services/Socket.js` (real) and `services/MockSocket.js` (simulator) expose the
identical API surface (`connect`, `close`, `send`, `onOpen`, `onMessage`,
`onBinary`, `onClose`, `onError`, plus `reopen` on the real Socket).
`services/index.js` picks one and exports it as `AgentSocket`; the hook imports
only from `../services`.

### `Socket.js` (real WebSocket)
- Base URL from `import.meta.env.VITE_GATEWAY_URL`, fallback `ws://localhost:8080`.
- `_buildEndpoint()` appends `/controller?token=<auth_token>` when
  `ConnectionStore.auth_token` is set; before login it falls back to
  `/controller?key=<VITE_CONTROLLER_KEY>`.
- `binaryType = "arraybuffer"` so image/video/chunk payloads arrive as `ArrayBuffer`.
- `onmessage` splits `typeof data === 'string'` (JSON → `onMessage`) from
  binary (`ArrayBuffer` → `onBinary`).
- Auto-reconnect with exponential backoff (500 ms base, 8 s cap); reset on a
  clean `close()`.
- Auth-fail handling: repeated failed opens with a token set (`AUTH_FAIL_THRESHOLD = 2`)
  triggers one `refreshAccessToken()`. Success → `_openSocket()` again with the
  new JWT. Failure → toast + `logout()`.
- `reopen()` — force-close the current underlying WebSocket without setting
  `_closed_by_user`, then open a fresh one. Used after a successful token
  refresh from `auth_expired`.

### `MockSocket.js` (dev simulator)
- Same public API as `Socket.js`. Simulates 5 agents (Windows / Ubuntu / macOS)
  with realistic `agents_list`, `agent_status`, `app_list_result`,
  `proc_list_result`, sysinfo, keylog, screenshot, screen stream, webcam,
  file list / download (single JSON chunk), file upload, and power messages.
- Streams frames as raw JPEG `ArrayBuffer` paired with a `frame_meta` JSON.
- Used when `VITE_USE_MOCK !== 'false'` — the default for `npm run dev`.

Swapping mock ↔ real requires changing only `VITE_USE_MOCK`; no component or
hook code changes.

---

## 9. Component layer

### `App.jsx` — login gate + console shell + toast layer
- Reads `ConnectionStore.auth_token`: no token → renders `<LoginScreen>`;
  with a token → renders `<ConsoleShell>`. `ConsoleShell` is the only component
  that calls `useAgentSocket`, so the socket opens only after login and, on
  logout, unmounts the shell → the ref-counted hook closes the socket.
- Renders the toast stack from `UiStore.toasts`.

### `LoginScreen.jsx`
Local `username / password` state, calls `AuthService.login`, shows the returned
message on failure. Success writes `auth_token` → App re-renders into the console.

### `layout/`
- `Sidebar.jsx` — search box + `<AgentList>` + a "select all online" checkbox
  + gateway status footer.
- `TopBar.jsx` — view-mode toggle (Grid / Focus), sensitive-activity banner,
  connection indicator, theme toggle, Logout button.
- `ThemeToggle.jsx` — light / dark theme switch driven by `UiStore.theme`.

### `agents/`
- `AgentList.jsx` — renders one `<AgentCard>` per filtered agent.
- `AgentCard.jsx` — name, OS, IP, online dot, sensitive-activity dot, selection
  checkbox. Clicking the card focuses the agent + switches to Focus view.
- `MultiSelect.jsx` — small "select all online" checkbox helper.

### `livescreen/`
- `GridView.jsx` — 6-up grid of live thumbnails for every online agent. Owns
  the cross-agent `stream_start` broadcast on mount and `stream_stop` on
  unmount so the wall is always live while shown.
- `FocusView.jsx` — 8-tab navigation bar + active module panel for the focused
  agent. `sysinfo` renders directly (read-only); every other tab is wrapped by
  `<PermissionGate feature={active_tab} agent_id={focused_agent.id}>`.

### Shared templates
- `ModuleTable.jsx` — sortable table with a toolbar, empty state, and one
  optional action column. Used by `ApplicationTab` and `ProcessTab`.
- `FrameCanvas.jsx` — decodes an `ArrayBuffer` JPEG via `createImageBitmap`,
  paints it to a `<canvas>`, revokes the bitmap on the next frame. Used by
  `ScreenTab`, `WebcamTab`, and every `GridView` tile.

### `PermissionGate.jsx`
Shared consent wrapper. `FocusView` applies it uniformly around every active
module panel. Module tabs do not import it directly — they import its two
hooks.

- Bar: shows badge status. When `granted` and not currently requesting, shows
  a **Disconnect** button (`revokePermission` + `stopModule` + reset queue).
  There is no separate "Connect" button — consent is driven from action clicks.
- Provides React Context `{ guardedSend, is_pending_consent }`:
  - **`useGuardedSend()`** — every module action wraps its `sendFn` here.
    Already `granted` → run `sendFn` immediately. Not granted → queue
    `sendFn`, fire `permission_request`, start a 30 s timer; on `granted`
    drain the queue in order; on `denied` or timeout, toast an error and
    clear the queue.
  - **`usePendingConsent()`** — `true` while awaiting consent; action buttons
    use it to disable themselves and show "Đang xin quyền..." in the title.
- Children are NOT wrapped in a disabled fieldset — buttons stay clickable and
  drive the consent flow themselves via the hooks above.
- Ctx value is memoized so consumers only re-render when `guardedSend` or
  `is_pending_consent` actually change identity.

### Module tabs

Every sensitive tab: subscribes to its own store slice with a selector, wraps
every action send in `guardedSend(() => ...)`, disables its buttons while
`is_pending_consent` is true, and has a `useEffect` cleanup for any timer /
subscription / stream it started.

| Tab | Store slice | Send helper | Notable UI |
| --- | --- | --- | --- |
| **SysInfoTab** | `sysinfo`, `sysinfo_history` | `sendToFocused` (no consent — read-only) | 3 stat tiles + 3 recharts sparklines (CPU / RAM / Disk), 2 s polling. |
| **ApplicationTab** | `app`, `PolicyStore.app_whitelist` | `sendToFocused` | Sortable table via `<ModuleTable>`; Start / Stop per row disabled when out-of-whitelist. 3 s polling. |
| **ProcessTab** | `process` | `sendToFocused` | `<ModuleTable>` + Kill per row + **"Kill by PID"** form (number input, integer > 0, inline error). 3 s polling. |
| **ScreenTab** | `screen.frame` / `screen.meta`, `screen_stream_active` | `sendCommand` | `<FrameCanvas>`, "Chụp 1 lần" button, "Bắt đầu / Dừng stream" toggle, editable FPS / Quality fields (fps 1–60, quality 1–100). |
| **KeylogTab** | `keylog`, `keylog_active` | `sendToFocused` | Terminal-style log, LIVE indicator, Clear + Export .txt buttons. |
| **FileTab** | `file`, `file_downloads`, `file_put_ack`, `PolicyStore.sandbox_path` | `sendToFocused` | Sandbox tree browser, per-file download button with progress bar per `transfer_id`, drag-drop upload with per-file progress bar, "Go to path" form (validated non-empty / no NUL / starts `/` / no `..`). Assembles binary or base64 chunks into a Blob on completion; TTL 15 s auto-drops stale jobs. |
| **WebcamTab** | `webcam.frame` / `webcam.meta`, `webcam_active` | `sendCommand` | `<FrameCanvas>`, consent-confirmed indicator, editable FPS / Quality fields (fps 1–30, quality 1–100). |
| **PowerTab** | — | `sendCommand` | 4 buttons: Lock (immediate), Restart / Shutdown / Sleep (10 s countdown modal with Cancel). `handleConfirm` re-checks consent status right before send. |

---

## 10. Message catalog

Full specs live in `docs/formatjson/*.json`. Types actually implemented in the
Controller code:

Outbound envelopes
- `list_agents` — bare.
- `{ type: "request", command_id, module, params, target_agents }` — the
  generic wrapper for every module command.
- `{ type: "power", command_id, action, target_agents }`.
- `{ type: "policy_update", command_id, params: { app_whitelist, sandbox_path },
  target_agents }`.
- `{ type: "permission_request" | "permission_revoke" | "stop_module",
  command_id, feature, target_agents }`.

Modules per feature
- Application: `app_list`, `app_start`, `app_stop`.
- Process: `proc_list`, `proc_kill`.
- Screen: `screenshot`, `screen_stream`, `screen_stream_stop`.
- Keylog: `keylog_start`, `keylog_stop`.
- File: `fs_list`, `fs_get` (optional `transfer_id`), `fs_put` (required
  `transfer_id`, `chunk_index`, `total_chunks`, `total_size`, `data_base64`).
- Webcam: `webcam_start`, `webcam_stop`.
- SysInfo: `sysinfo` (no consent).
- Power: `lock`, `restart`, `shutdown`, `sleep`.

Inbound
- `agents_list`, `agent_status`.
- `app_list_result`, `app_action_result`, `proc_list_result`, `proc_kill_result`.
- `keylog`, `keylog_started`, `keylog_stopped`, `keylog_denied`.
- `stream_started`, `stream_stopped`, `webcam_started`, `webcam_stopped`,
  `webcam_denied`.
- `frame_meta` — always followed by exactly one binary `ArrayBuffer` (JPEG).
- `fs_list_result`, `fs_get_result` (JSON-chunk mode with `data_base64` OR
  binary-chunk mode where the next `ArrayBuffer` carries the raw bytes),
  `fs_put_result`, `fs_put_complete`, `fs_error`.
- `power_result`, `policy_update_result`, `permission_result`.
- `sysinfo_result`.
- `auth_expired` — triggers refresh + WS reopen.

The Gateway stamps `agent_id` onto every message coming from an Agent.

---

## 11. Conventions

Enforced across every file the Controller owns:

- **File names** — PascalCase (`ConnectionStore.js`, `FileTab/index.jsx`).
- **Identifiers** — snake_case variables, camelCase functions, PascalCase
  classes / components / enums, UPPER_SNAKE_CASE for true constants.
- **Braces** — Allman style (opening `{` on its own line, aligned with the
  statement that opens the block).
- **Comments** — English, concise, explain WHY not WHAT. Adjacent trailing
  `//` comments align the `//` into a single column.
- **No hardcoded colors / font-sizes / spacing** — use the CSS custom
  properties in `index.css` (`--danger`, `--space-*`, `--radius-*`, `--text`,
  `--bg-elevated`, `--border`, `--font-sans`, …). Two themes (`:root` +
  `[data-theme='dark']`) share the same tokens.
- **Zustand** — subscribe with a selector: `useStore((s) => s.x)`. Never
  subscribe to the whole store.
- **useEffect cleanup** — mandatory for `setInterval` polls, event listeners,
  WS handlers, `ImageBitmap.close`, revoked Object URLs, and any per-job GC
  timer.
- **No new dependencies** without necessity. The current list is:
  `react, react-dom, zustand, lucide-react, recharts`.
- **Transport only through the hook + service layer**. Components never import
  `Socket`, `MockSocket`, or call `fetch` directly (except through
  `AuthService`).
- **Whitelisted app list + sandbox path** come from `PolicyStore` (which was
  seeded from a Controller-side default and can be replaced by the future
  admin UI or a server-pushed policy). Never hard-coded inside a tab.

---

## 12. Mock ↔ real transport

- `VITE_USE_MOCK` (env var, default treated as `true` unless the string
  `"false"`) picks which implementation `services/index.js` re-exports.
- Both `Socket.js` and `MockSocket.js` expose the same public methods, so
  swapping is a one-line change. The rest of the app is transport-agnostic.
- `MockSocket` runs a small in-process Gateway + Agent simulation with 5
  fake agents and realistic replies so the UI is fully driveable without a
  real Gateway or Agent.
