// Protocol.js — builds and parses all JSON messages exchanged over the WebSocket.
// All formats follow the templates in docs/formatjson/*.json exactly.
// Components never call these directly; they go through UseAgentSocket (hook) only.
// No external dependencies — plain JSON only.

// ─── RX message type constants (Gateway → Controller) ────────────────────────

export const MSG_TYPE =
{
    // TX — Controller sends to Gateway
    LIST_AGENTS : "list_agents",   // request current agent list
    REQUEST     : "request",       // generic wrapper for almost all commands
    POWER       : "power",         // power action (special type, not "request")

    // RX — Gateway / Agent sends to Controller
    AGENTS_LIST       : "agents_list",        // reply to list_agents
    AGENT_STATUS      : "agent_status",       // push when an agent goes online / offline
    FRAME_META        : "frame_meta",         // JSON header before a binary JPEG blob
    APP_LIST_RESULT   : "app_list_result",    // reply to app_list request
    APP_ACTION_RESULT : "app_action_result",  // reply to app_start / app_stop
    PROC_LIST_RESULT  : "proc_list_result",   // reply to proc_list request
    PROC_KILL_RESULT  : "proc_kill_result",   // reply to proc_kill request
    KEYLOG            : "keylog",             // batch of keystroke events
    KEYLOG_STARTED    : "keylog_started",     // agent confirmed keylog is active
    KEYLOG_STOPPED    : "keylog_stopped",     // agent confirmed keylog stopped
    KEYLOG_DENIED     : "keylog_denied",      // user rejected keylog consent popup
    STREAM_STARTED    : "stream_started",     // agent confirmed screen stream is active
    STREAM_STOPPED    : "stream_stopped",     // agent confirmed screen stream stopped
    WEBCAM_STARTED    : "webcam_started",     // agent confirmed webcam is active (consent granted)
    WEBCAM_STOPPED    : "webcam_stopped",     // agent confirmed webcam stopped
    WEBCAM_DENIED     : "webcam_denied",      // user rejected webcam consent popup
    FS_LIST_RESULT    : "fs_list_result",     // reply to fs_list request
    FS_GET_RESULT     : "fs_get_result",      // reply to fs_get (may be chunked)
    FS_PUT_RESULT     : "fs_put_result",      // agent acknowledges one upload chunk
    FS_PUT_COMPLETE   : "fs_put_complete",    // agent confirms the full file is saved
    FS_ERROR          : "fs_error",           // file operation error (e.g. path outside sandbox)
    POWER_RESULT      : "power_result",       // agent confirms or denies the power action
}

// ─── Module name constants (value of the "module" field in REQUEST messages) ─

export const MODULE =
{
    // Application (docs/formatjson/application.json)
    APP_LIST  : "app_list",   // request running / installed app list
    APP_START : "app_start",  // launch a whitelisted app by name
    APP_STOP  : "app_stop",   // stop a running whitelisted app by name

    // Process (docs/formatjson/process.json)
    PROC_LIST : "proc_list",  // request full process list
    PROC_KILL : "proc_kill",  // terminate a process by PID

    // Screen (docs/formatjson/livescreen.json)
    SCREENSHOT         : "screenshot",          // single capture (mode: "once")
    SCREEN_STREAM      : "screen_stream",       // start continuous stream
    SCREEN_STREAM_STOP : "screen_stream_stop",  // stop the stream

    // Keylog (docs/formatjson/keylog.json)
    KEYLOG_START : "keylog_start",   // start keystroke capture (requires Agent consent)
    KEYLOG_STOP  : "keylog_stop",    // stop keystroke capture

    // File — sandbox only (docs/formatjson/file.json)
    FS_LIST : "fs_list",   // list folder contents
    FS_GET  : "fs_get",    // download a file (base64 chunks)
    FS_PUT  : "fs_put",    // upload a file (base64 chunks)

    // Webcam (docs/formatjson/webcam.json)
    WEBCAM_START : "webcam_start",   // start webcam stream (requires Agent consent)
    WEBCAM_STOP  : "webcam_stop",    // stop webcam stream
}

// ─── Power action constants (docs/formatjson/power.json) ─────────────────────

export const POWER_ACTION =
{
    LOCK     : "lock",      // lock immediately — no countdown needed
    RESTART  : "restart",   // restart — send only after 10 s countdown on Controller
    SHUTDOWN : "shutdown",  // shutdown — send only after 10 s countdown on Controller
    SLEEP    : "sleep",     // sleep — send only after 10 s countdown on Controller
}

// ─── Base builders ────────────────────────────────────────────────────────────

// Merge type + payload into one object, then serialise to a JSON string.
// All specific builders below call this to produce the final string for socket.send().
export function buildMessage(type, payload)
{
    const msg = { type, ...payload }
    return JSON.stringify(msg)
}

// Parse a raw JSON string received from the WebSocket.
// Returns the parsed object on success, or null on failure (logs a warning).
export function parseMessage(raw)
{
    try
    {
        return JSON.parse(raw)
    }
    catch (err)
    {
        console.warn('[Protocol] Failed to parse message:', raw, err)
        return null
    }
}

// ─── Connection ───────────────────────────────────────────────────────────────

// Ask the Gateway for the current list of all known agents.
// Format: docs/formatjson/connection.json → list_agents
export function buildListAgents()
{
    return buildMessage(MSG_TYPE.LIST_AGENTS, {})
}

// ─── Generic request (all module commands go through this) ───────────────────

// Build a "request" envelope for any module command.
// module      — one of the MODULE constants above.
// params      — plain object with module-specific fields (pass {} when none needed).
// targetAgents — array of agent id strings; empty array means all agents.
export function buildRequest(module, params, targetAgents)
{
    return buildMessage(MSG_TYPE.REQUEST,
    {
        module,
        params        : params       ?? {},
        target_agents : targetAgents ?? [],
    })
}

// ─── Application module (docs/formatjson/application.json) ───────────────────

export function buildAppList(targetAgents)
{
    return buildRequest(MODULE.APP_LIST, {}, targetAgents)
}

// name — the short app name used by the Agent whitelist (e.g. "notepad", "chrome")
export function buildAppStart(name, targetAgents)
{
    return buildRequest(MODULE.APP_START, { name }, targetAgents)
}

export function buildAppStop(name, targetAgents)
{
    return buildRequest(MODULE.APP_STOP, { name }, targetAgents)
}

// ─── Process module (docs/formatjson/process.json) ───────────────────────────

export function buildProcList(targetAgents)
{
    return buildRequest(MODULE.PROC_LIST, {}, targetAgents)
}

// pid — numeric process ID to terminate
export function buildProcKill(pid, targetAgents)
{
    return buildRequest(MODULE.PROC_KILL, { pid }, targetAgents)
}

// ─── Screen module (docs/formatjson/livescreen.json) ─────────────────────────

// Request one screenshot from the given agents.
export function buildScreenshot(targetAgents)
{
    return buildRequest(MODULE.SCREENSHOT, { mode: 'once' }, targetAgents)
}

// Start a continuous screen stream.
// fps     — frames per second (default: 24 per livescreen.json template)
// quality — JPEG quality 0–100 (default: 70 per livescreen.json template)
export function buildStreamStart(fps, quality, targetAgents)
{
    return buildRequest(MODULE.SCREEN_STREAM,
    {
        mode    : 'stream',
        fps     : fps     ?? 24,
        quality : quality ?? 70,
    },
    targetAgents)
}

export function buildStreamStop(targetAgents)
{
    return buildRequest(MODULE.SCREEN_STREAM_STOP, {}, targetAgents)
}

// ─── Keylog module (docs/formatjson/keylog.json) ─────────────────────────────

// Start keystroke capture — Agent will show a consent popup first.
export function buildKeylogStart(targetAgents)
{
    return buildRequest(MODULE.KEYLOG_START, {}, targetAgents)
}

export function buildKeylogStop(targetAgents)
{
    return buildRequest(MODULE.KEYLOG_STOP, {}, targetAgents)
}

// ─── File module — sandbox only (docs/formatjson/file.json) ──────────────────

// List the contents of a sandbox folder.
// path — relative path inside the sandbox root (e.g. "/" for root, "/reports/")
export function buildFsList(path, targetAgents)
{
    return buildRequest(MODULE.FS_LIST, { path }, targetAgents)
}

// Request a file download from the sandbox.
export function buildFsGet(filePath, targetAgents)
{
    return buildRequest(MODULE.FS_GET, { path: filePath }, targetAgents)
}

// Upload one chunk of a file to the sandbox.
// chunk_info = { data_base64, total_size, chunk_index, total_chunks }
export function buildFsPut(filePath, chunk_info, targetAgents)
{
    return buildRequest(MODULE.FS_PUT,
    {
        path         : filePath,
        total_size   : chunk_info.total_size,
        chunk_index  : chunk_info.chunk_index,
        total_chunks : chunk_info.total_chunks,
        data_base64  : chunk_info.data_base64,
    },
    targetAgents)
}

// ─── Webcam module (docs/formatjson/webcam.json) ─────────────────────────────

// Start webcam stream — Agent will show a consent popup and on-screen indicator.
// fps     — frames per second (default: 15 per webcam.json template)
// quality — JPEG quality 0–100 (default: 60 per webcam.json template)
export function buildWebcamStart(fps, quality, targetAgents)
{
    return buildRequest(MODULE.WEBCAM_START,
    {
        fps     : fps     ?? 15,
        quality : quality ?? 60,
    },
    targetAgents)
}

export function buildWebcamStop(targetAgents)
{
    return buildRequest(MODULE.WEBCAM_STOP, {}, targetAgents)
}

// ─── Power module (docs/formatjson/power.json) ───────────────────────────────

// Send a power action. Uses its own "power" type, NOT the generic "request" type.
// action — one of the POWER_ACTION constants: lock / restart / shutdown / sleep
// Note: lock is immediate; restart / shutdown / sleep must be sent only after
//       the Controller shows a 10-second countdown to the operator.
export function buildPower(action, targetAgents)
{
    return buildMessage(MSG_TYPE.POWER,
    {
        action,
        target_agents : targetAgents ?? [],
    })
}
