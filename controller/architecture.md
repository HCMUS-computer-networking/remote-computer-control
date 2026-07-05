# Architecture

React + Vite (JavaScript, no TypeScript) controller app for a remote-agent monitoring/control panel.

## Naming convention

Store, service, hook, and layout/agent/livescreen component files use `PascalCase.js` / `PascalCase.jsx` (e.g. `AgentStore.js`, `Sidebar.jsx`). Module tab folders are `PascalCase` directories each containing a single `index.jsx`. This is the convention already in place in `src/` and is kept consistently instead of switching to `snake_case` files.

## Folder layout

```
src/
├─ store/          Zustand/Redux-style state containers
├─ services/        Socket transport and protocol definitions
├─ components/
│  ├─ layout/       App shell pieces (sidebar, top bar, theme toggle)
│  ├─ agents/       Agent list/card/selection UI
│  ├─ livescreen/    Live screen viewing UI (grid, focus, canvas)
│  └─ modules/      One folder per feature tab, each with an index.jsx
├─ hooks/           Custom hooks bridging components and services/stores
└─ App.jsx          Root component (currently the default Vite starter page)
```

## Files and their role

### store/
- `ConnectionStore.js` — connection state to the server (connected/disconnected/reconnecting, server address).
- `AgentStore.js` — list of connected agents, their info, and current selection.
- `ModuleStore.js` — per-agent data for each feature module (application, process, screen, keylog, file, webcam, power).
- `UiStore.js` — general UI state (theme, active tab, sidebar open/closed, view mode).

### services/
- `Socket.js` — real WebSocket connection to the server, sends/receives raw messages.
- `MockSocket.js` — fake socket for local testing without a real server.
- `Protocol.js` — message formats and command names used between controller and agents.

### components/layout/
- `Sidebar.jsx` — navigation between modules/pages.
- `TopBar.jsx` — header with app title, connection status, quick actions.
- `ThemeToggle.jsx` — light/dark theme switch.

### components/agents/
- `AgentList.jsx` — renders the list of agents using `AgentCard`.
- `AgentCard.jsx` — summary info for one agent, selectable.
- `MultiSelect.jsx` — lets user select multiple agents for bulk actions.

### components/livescreen/
- `GridView.jsx` — multiple agents' live screens in a grid.
- `FocusView.jsx` — one agent's live screen enlarged.
- `FrameCanvas.jsx` — draws a single incoming frame on a canvas.

### components/modules/ (each folder has one `index.jsx`)
- `ApplicationTab/` — installed/running applications management.
- `ProcessTab/` — running processes inspection/kill.
- `ScreenTab/` — live screen streaming controls.
- `KeylogTab/` — captured keystrokes viewer.
- `FileTab/` — remote file browse/upload/download.
- `WebcamTab/` — live webcam feed.
- `PowerTab/` — power actions (shutdown/restart/sleep).

### hooks/
- `UseAgentSocket.js` — connects components to the socket service and keeps stores updated with live data.

### App.jsx
Root component. Currently still the default Vite starter markup; will be replaced with the real layout (`TopBar` + `Sidebar` + main content area) as modules are implemented.

## Data flow

```
User interaction (click / select agent / open tab)
        |
        v
components/ (layout, agents, livescreen, modules/*)
        |  reads state from, dispatches actions to
        v
store/ (ConnectionStore, AgentStore, ModuleStore, UiStore)
        ^
        |  updated by
        |
hooks/UseAgentSocket.js  <---- subscribes to incoming events from ---- services/Socket.js (or MockSocket.js)
        |                                                                 |
        |                                                                 v
        +----------------------------------------------------> services/Protocol.js
                                                            (encodes/decodes messages)
```

Explanation:
1. Components render from store state and call store actions on user interaction (e.g. select an agent, click a power action).
2. Some store actions need to talk to the server — they go through `hooks/UseAgentSocket.js`, which wraps `services/Socket.js` (or `MockSocket.js` for local testing).
3. `services/Protocol.js` defines how outgoing commands and incoming messages are shaped, used by both `Socket.js`/`MockSocket.js` and `UseAgentSocket.js`.
4. Incoming server messages (agent list updates, live frames, command results) flow back through the socket, get parsed via `Protocol.js`, and are written into the relevant store, which re-renders the subscribed components.
