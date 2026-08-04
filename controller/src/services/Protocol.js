// Protocol.js — builds and parses all JSON messages exchanged over the WebSocket.
// All formats follow the templates in docs/protocol/*.json exactly.
// Components never call these directly; they go through UseAgentSocket (hook) only.
// No external dependencies — plain JSON only.

// ─── RX message type constants (Gateway → Controller) ────────────────────────

export const MSG_TYPE =
{
    // TX — Controller sends to Gateway
    LIST_AGENTS        : "list_agents",        // request current agent list
    REQUEST            : "request",            // generic wrapper for almost all commands
    POWER              : "power",              // power action (special type, not "request")
    POLICY_UPDATE      : "policy_update",      // push app_whitelist + sandbox_path to agents
    PERMISSION_REQUEST : "permission_request", // ask an Agent to grant a feature (consent popup)
    PERMISSION_REVOKE  : "permission_revoke",  // withdraw a previously granted feature
    STOP_MODULE        : "stop_module",        // tell the Agent to stop a running feature

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
    POLICY_UPDATE_RESULT : "policy_update_result", // agent confirms it applied the pushed policy
    PERMISSION_RESULT : "permission_result",  // agent grants or denies a permission_request
    SYSINFO_RESULT    : "sysinfo_result",     // reply to sysinfo request (CPU / RAM / Disk metrics)
    AUTH_EXPIRED      : "auth_expired",       // Gateway signals the access JWT is no longer valid — refresh + reopen
}

// ─── Feature constants (D6 vocab — used for permission request / revoke / stop) ─
// One value per sensitive capability the Controller must ask consent for before
// issuing any module command. These are the "feature" field values, distinct
// from the MODULE command names above (e.g. FEATURE.SCREEN vs MODULE.SCREENSHOT).

export const FEATURE =
{
    APPLICATION : "application",   // Application module (list / start / stop apps)
    PROCESS     : "process",       // Process module (list / kill)
    SCREEN      : "screen",        // Screenshot + live screen stream
    KEYLOG      : "keylog",        // Input activity (keystroke monitoring)
    FILE        : "file",          // Sandbox file operations
    WEBCAM      : "webcam",        // Webcam stream
    POWER       : "power",         // Power actions (lock / restart / shutdown / sleep)
}

// ─── Module name constants (value of the "module" field in REQUEST messages) ─

export const MODULE =
{
    // Application (docs/protocol/application.json)
    APP_LIST  : "app_list",   // request running / installed app list
    APP_START : "app_start",  // launch a whitelisted app by name
    APP_STOP  : "app_stop",   // stop a running whitelisted app by name

    // Process (docs/protocol/process.json)
    PROC_LIST : "proc_list",  // request full process list
    PROC_KILL : "proc_kill",  // terminate a process by PID

    // Screen (docs/protocol/livescreen.json)
    SCREENSHOT         : "screenshot",          // single capture (mode: "once")
    SCREEN_STREAM      : "screen_stream",       // start continuous stream
    SCREEN_STREAM_STOP : "screen_stream_stop",  // stop the stream

    // Keylog (docs/protocol/keylog.json)
    KEYLOG_START : "keylog_start",   // start keystroke capture (requires Agent consent)
    KEYLOG_STOP  : "keylog_stop",    // stop keystroke capture

    // File — sandbox only (docs/protocol/file.json)
    FS_LIST : "fs_list",   // list folder contents
    FS_GET  : "fs_get",    // download a file (base64 chunks)
    FS_PUT  : "fs_put",    // upload a file (base64 chunks)

    // Webcam (docs/protocol/webcam.json)
    WEBCAM_START : "webcam_start",   // start webcam stream (requires Agent consent)
    WEBCAM_STOP  : "webcam_stop",    // stop webcam stream

    // SysInfo (docs/protocol/SysInfo.json) — no consent required, read-only metrics
    SYSINFO : "sysinfo",   // request current CPU / RAM / Disk / uptime snapshot
}

// ─── Power action constants (docs/protocol/power.json) ─────────────────────

export const POWER_ACTION =
{
    LOCK     : "lock",      // lock immediately — no countdown needed
    RESTART  : "restart",   // restart — send only after 10 s countdown on Controller
    SHUTDOWN : "shutdown",  // shutdown — send only after 10 s countdown on Controller
    SLEEP    : "sleep",     // sleep — send only after 10 s countdown on Controller
}

// ─── Input validators (defense-in-depth) ──────────────────────────────────────
//
// Every builder that receives a value from OUTSIDE (a UI form, a store row,
// dev-console) runs its inputs through these validators before shaping the
// JSON. On failure they throw a plain Error — the callsite (button onClick,
// form submit) is expected to catch and surface a toast. This is the SECOND
// line of defense: the primary line is inline form validation in the module
// tabs. Bugs that let bad data through the UI still get stopped here rather
// than reaching the Agent as malformed JSON.

// Integer greater than zero (used for PID, chunk counts, etc.).
function assertPositiveInt(value, field_name)
{
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    {
        throw new Error(`Protocol: ${field_name} must be a positive integer (got ${JSON.stringify(value)})`)
    }
}

// Integer inside an inclusive [min, max] range (fps, quality, etc.).
function assertIntInRange(value, min, max, field_name)
{
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    {
        throw new Error(`Protocol: ${field_name} must be an integer in [${min}, ${max}] (got ${JSON.stringify(value)})`)
    }
}

// Non-negative integer (chunk_index, byte counts, etc.).
function assertNonNegativeInt(value, field_name)
{
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    {
        throw new Error(`Protocol: ${field_name} must be a non-negative integer (got ${JSON.stringify(value)})`)
    }
}

// Non-empty string (app names, base64 chunks, etc.).
function assertNonEmptyString(value, field_name)
{
    if (typeof value !== 'string' || value.length === 0)
    {
        throw new Error(`Protocol: ${field_name} must be a non-empty string`)
    }
}

// Sandbox path. Must start with '/', have no NUL byte, and contain no ".."
// segment (belt-and-suspenders — the Agent already enforces sandbox root).
function assertSafePath(value, field_name)
{
    assertNonEmptyString(value, field_name)
    if (value.indexOf('\0') !== -1)
    {
        throw new Error(`Protocol: ${field_name} must not contain NUL bytes`)
    }
    if (!value.startsWith('/'))
    {
        throw new Error(`Protocol: ${field_name} must start with '/' (sandbox-relative)`)
    }
    const segments = value.split('/')
    if (segments.includes('..'))
    {
        throw new Error(`Protocol: ${field_name} must not contain '..' segments`)
    }
}

// Value must be one of the enumerated allowed strings (POWER_ACTION, etc.).
function assertOneOf(value, allowed, field_name)
{
    if (!allowed.includes(value))
    {
        throw new Error(`Protocol: ${field_name} must be one of [${allowed.join(', ')}] (got ${JSON.stringify(value)})`)
    }
}

// target_agents envelope: must be an array of non-empty strings.
// Empty array is legal (meaning "broadcast to all agents"). null/undefined is
// accepted at the callsite and normalised to [] there — this validator is only
// reached with a real value.
function assertAgentIdList(value, field_name)
{
    if (!Array.isArray(value))
    {
        throw new Error(`Protocol: ${field_name} must be an array (got ${JSON.stringify(value)})`)
    }
    for (let i = 0; i < value.length; i++)
    {
        if (typeof value[i] !== 'string' || value[i].length === 0)
        {
            throw new Error(`Protocol: ${field_name}[${i}] must be a non-empty string`)
        }
    }
}

// ─── Base builders ────────────────────────────────────────────────────────────

// Merge type + payload into one object, then serialise to a JSON string.
// All specific builders below call this to produce the final string for socket.send().
// The Agent (C#) ValidatePacket rejects any packet whose command_id is empty and
// silently drops it, so we auto-generate a short random id here. A caller-supplied
// command_id inside `payload` still wins (spread runs after the default).
export function buildMessage(type, payload)
{
    const command_id = Math.random().toString(36).substring(2, 9)
    const msg = { type, command_id, ...payload }
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

// ─── Incoming adapter (real Gateway/Agent JSON → canonical shape) ─────────────
//
// The real Gateway/Agent may name fields slightly differently from our mock
// (e.g. "agentId" instead of "agent_id", "procs" instead of "processes").
// This adapter rewrites every incoming message into the ONE canonical shape the
// store + dispatch table already expect, so no component/store code changes.
//
// The canonical shape per type is exactly what MockSocket produces today and
// what dispatchMessage() in UseAgentSocket reads. See the field map below.
//
// HOW TO EXTEND — when you see a real message with a different field name:
//   1) add the real name to the alias array (marked "EDIT POINT" below), or
//   2) add / adjust the per-type normalizer in NORMALIZERS.
// Everything defaults to identity, so an unknown message passes through safely.

// Return the first present value among the given alias keys, else fallback.
// Used to accept several possible source names for one canonical field.
function pickField(obj, alias_keys, fallback)
{
    for (const key of alias_keys)
    {
        if (obj != null && obj[key] !== undefined) return obj[key]
    }
    return fallback
}

// ── Type-name aliases (real "type" string → canonical MSG_TYPE) ──────────────
// EDIT POINT: left side = whatever the real server sends; right = our constant.
// Identity entries are omitted — unknown types keep their original name.
const TYPE_ALIASES =
{
    // "agentList"       : MSG_TYPE.AGENTS_LIST,     // example: camelCase variant
    // "processList"     : MSG_TYPE.PROC_LIST_RESULT,
    // "frameMeta"       : MSG_TYPE.FRAME_META,
}

// ── Common field aliases shared by many message types ───────────────────────
// EDIT POINT: add real source names here; the FIRST match wins.
const AGENT_ID_ALIASES  = ['agent_id', 'agentId', 'agentID', 'machine_id']   // → agent_id
const TIMESTAMP_ALIASES = ['timestamp_ms', 'ts', 'time', 'timestamp']        // → timestamp_ms

// Copy the canonical agent_id onto a message from any accepted alias.
// Every per-agent RX message needs agent_id for store keying.
function withAgentId(msg, src)
{
    const agent_id = pickField(src, AGENT_ID_ALIASES)
    if (agent_id !== undefined) msg.agent_id = agent_id
    return msg
}

// Normalize one agent record inside agents_list.
// Canonical: { id, name, os, ip, online, in_session }
function normalizeAgent(a)
{
    return {
        id         : pickField(a, ['id', 'agent_id', 'agentId']),
        name       : pickField(a, ['name', 'hostname', 'machine_name']),
        os         : pickField(a, ['os', 'os_name', 'platform']),
        ip         : pickField(a, ['ip', 'ip_addr', 'address']),
        online     : pickField(a, ['online', 'is_online', 'connected'], false),
        in_session : pickField(a, ['in_session', 'inSession', 'busy'], false),
    }
}

// Normalize one app record inside app_list_result.
// Canonical: { name, display_name, status, cpu_percent, ram_mb, in_whitelist }
function normalizeApp(a)
{
    return {
        name         : pickField(a, ['name', 'app_name']),
        display_name : pickField(a, ['display_name', 'displayName', 'title']),
        status       : pickField(a, ['status', 'state']),
        cpu_percent  : pickField(a, ['cpu_percent', 'cpu', 'cpuPercent'], 0),
        ram_mb       : pickField(a, ['ram_mb', 'ram', 'memory_mb'], 0),
        in_whitelist : pickField(a, ['in_whitelist', 'whitelisted', 'allowed'], false),
    }
}

// Normalize one process record inside proc_list_result.
// Canonical: { pid, name, cpu_percent, ram_mb }
function normalizeProc(p)
{
    return {
        pid         : pickField(p, ['pid', 'process_id']),
        name        : pickField(p, ['name', 'proc_name', 'image_name']),
        cpu_percent : pickField(p, ['cpu_percent', 'cpu', 'cpuPercent'], 0),
        ram_mb      : pickField(p, ['ram_mb', 'ram', 'memory_mb'], 0),
    }
}

// Normalize one keystroke event inside a keylog batch.
// Canonical: { key, ctrl, alt, shift, timestamp_ms }
function normalizeKeyEvent(e)
{
    return {
        key          : pickField(e, ['key', 'k', 'char']),
        ctrl         : pickField(e, ['ctrl', 'ctrlKey'], false),
        alt          : pickField(e, ['alt', 'altKey'], false),
        shift        : pickField(e, ['shift', 'shiftKey'], false),
        timestamp_ms : pickField(e, TIMESTAMP_ALIASES),
    }
}

// Normalize one filesystem entry inside fs_list_result.
// Canonical: { name, type, size, modified_ms }
function normalizeFsEntry(e)
{
    return {
        name        : pickField(e, ['name', 'filename']),
        type        : pickField(e, ['type', 'kind']),               // "file" | "directory"
        size        : pickField(e, ['size', 'bytes'], null),
        modified_ms : pickField(e, ['modified_ms', 'mtime_ms', 'modified'], null),
    }
}

// Per-type structural normalizers. Each takes the raw message and returns the
// canonical message. Types NOT listed here fall through to a shallow copy that
// only fixes agent_id + timestamp aliases.
const NORMALIZERS =
{
    [MSG_TYPE.AGENTS_LIST]: (m) =>
    ({
        type   : MSG_TYPE.AGENTS_LIST,
        agents : (pickField(m, ['agents', 'agent_list', 'list'], [])).map(normalizeAgent),
    }),

    [MSG_TYPE.AGENT_STATUS]: (m) =>
        withAgentId({
            type       : MSG_TYPE.AGENT_STATUS,
            // Left undefined when the field is absent so the store patch only
            // touches the flags the Gateway actually reported.
            online     : pickField(m, ['online', 'is_online', 'connected']),
            in_session : pickField(m, ['in_session', 'inSession', 'busy']),
        }, m),

    [MSG_TYPE.APP_LIST_RESULT]: (m) =>
        withAgentId({
            type : MSG_TYPE.APP_LIST_RESULT,
            apps : (pickField(m, ['apps', 'applications', 'app_list'], [])).map(normalizeApp),
        }, m),

    [MSG_TYPE.PROC_LIST_RESULT]: (m) =>
        withAgentId({
            type      : MSG_TYPE.PROC_LIST_RESULT,
            processes : (pickField(m, ['processes', 'procs', 'process_list'], [])).map(normalizeProc),
        }, m),

    [MSG_TYPE.KEYLOG]: (m) =>
        withAgentId({
            type   : MSG_TYPE.KEYLOG,
            events : (pickField(m, ['events', 'keys', 'batch'], [])).map(normalizeKeyEvent),
        }, m),

    [MSG_TYPE.FRAME_META]: (m) =>
        withAgentId({
            type         : MSG_TYPE.FRAME_META,
            module       : pickField(m, ['module', 'kind', 'source']),         // "screen" | "webcam"
            w            : pickField(m, ['w', 'width']),
            h            : pickField(m, ['h', 'height']),
            len          : pickField(m, ['len', 'length', 'byte_len']),
            seq          : pickField(m, ['seq', 'sequence', 'frame_no']),
            timestamp_ms : pickField(m, TIMESTAMP_ALIASES),
        }, m),

    [MSG_TYPE.FS_LIST_RESULT]: (m) =>
        withAgentId({
            type    : MSG_TYPE.FS_LIST_RESULT,
            path    : pickField(m, ['path', 'dir', 'folder']),
            entries : (pickField(m, ['entries', 'files', 'items'], [])).map(normalizeFsEntry),
        }, m),

    [MSG_TYPE.FS_GET_RESULT]: (m) =>
        withAgentId({
            type         : MSG_TYPE.FS_GET_RESULT,
            // transfer_id groups all chunks of one download; fall back to
            // command_id (Gateway guarantees one of the two is present).
            transfer_id  : pickField(m, ['transfer_id', 'transferId', 'command_id', 'commandId']),
            path         : pickField(m, ['path', 'filepath']),
            total_size   : pickField(m, ['total_size', 'size', 'totalSize']),
            chunk_index  : pickField(m, ['chunk_index', 'chunkIndex', 'index'], 0),
            total_chunks : pickField(m, ['total_chunks', 'totalChunks', 'chunks'], 1),
            // Present only in JSON-chunk mode. Absent in binary-chunk mode —
            // in that case the next WS binary frame carries the raw bytes.
            data_base64  : pickField(m, ['data_base64', 'data', 'base64', 'content']),
        }, m),

    // Per-chunk ack for uploads. transfer_id lets FileTab match this ack to
    // the correct upload job — required once multiple uploads to the same
    // path can be in flight at once (rename-on-conflict, retries, etc.).
    [MSG_TYPE.FS_PUT_RESULT]: (m) =>
        withAgentId({
            type        : MSG_TYPE.FS_PUT_RESULT,
            transfer_id : pickField(m, ['transfer_id', 'transferId', 'command_id', 'commandId']),
            path        : pickField(m, ['path', 'filepath']),
            chunk_index : pickField(m, ['chunk_index', 'chunkIndex', 'index'], 0),
            success     : pickField(m, ['success', 'ok'], false),
            message     : pickField(m, ['message', 'msg', 'detail'], ''),
        }, m),

    // Final ack when the Agent has stored the whole file. sha256 is optional
    // (spec says the Agent may include an integrity checksum).
    [MSG_TYPE.FS_PUT_COMPLETE]: (m) =>
        withAgentId({
            type        : MSG_TYPE.FS_PUT_COMPLETE,
            transfer_id : pickField(m, ['transfer_id', 'transferId', 'command_id', 'commandId']),
            path        : pickField(m, ['path', 'filepath']),
            success     : pickField(m, ['success', 'ok'], true),
            sha256      : pickField(m, ['sha256', 'checksum'], null),
            message     : pickField(m, ['message', 'msg', 'detail'], ''),
        }, m),

    [MSG_TYPE.POWER_RESULT]: (m) =>
        withAgentId({
            type      : MSG_TYPE.POWER_RESULT,
            action    : pickField(m, ['action', 'power_action']),
            confirmed : pickField(m, ['confirmed', 'success', 'ok'], false),
            message   : pickField(m, ['message', 'msg', 'detail'], ''),
        }, m),

    [MSG_TYPE.POLICY_UPDATE_RESULT]: (m) =>
        withAgentId({
            type    : MSG_TYPE.POLICY_UPDATE_RESULT,
            success : pickField(m, ['success', 'ok', 'applied'], false),
            message : pickField(m, ['message', 'msg', 'detail'], ''),
        }, m),

    [MSG_TYPE.SYSINFO_RESULT]: (m) =>
        withAgentId({
            type           : MSG_TYPE.SYSINFO_RESULT,
            cpu_percent    : pickField(m, ['cpu_percent', 'cpu', 'cpuPercent'], 0),
            ram_used_mb    : pickField(m, ['ram_used_mb', 'ramUsedMb', 'ram_used'], 0),
            ram_total_mb   : pickField(m, ['ram_total_mb', 'ramTotalMb', 'ram_total'], 0),
            disk_used_gb   : pickField(m, ['disk_used_gb', 'diskUsedGb', 'disk_used'], 0),
            disk_total_gb  : pickField(m, ['disk_total_gb', 'diskTotalGb', 'disk_total'], 0),
            uptime_seconds : pickField(m, ['uptime_seconds', 'uptimeSeconds', 'uptime'], 0),
            hostname       : pickField(m, ['hostname', 'host', 'machine_name'], ''),
            ip             : pickField(m, ['ip', 'ip_addr', 'address'], ''),
            os             : pickField(m, ['os', 'os_name', 'platform'], ''),
            timestamp_ms   : pickField(m, TIMESTAMP_ALIASES, Date.now()),
        }, m),

    [MSG_TYPE.PERMISSION_RESULT]: (m) =>
        withAgentId({
            type         : MSG_TYPE.PERMISSION_RESULT,
            feature      : pickField(m, ['feature', 'capability', 'module']),
            granted      : pickField(m, ['granted', 'allowed', 'approved', 'ok'], false),
            message      : pickField(m, ['message', 'msg', 'reason', 'detail'], ''),
            timestamp_ms : pickField(m, TIMESTAMP_ALIASES),
        }, m),
}

// Public entry point — normalize ONE parsed incoming message into canonical shape.
// UseAgentSocket calls this on every JSON message before dispatchMessage().
// Safe on already-canonical messages (mock) — they pass through unchanged.
export function normalizeIncoming(raw_msg)
{
    if (raw_msg == null || typeof raw_msg !== 'object') return raw_msg

    // 1) Canonicalize the type name first (camelCase → snake_case, etc.).
    const canonical_type = TYPE_ALIASES[raw_msg.type] ?? raw_msg.type

    // 2) Run the type-specific normalizer if we have one.
    const normalizer = NORMALIZERS[canonical_type]
    if (normalizer)
    {
        return normalizer(raw_msg)
    }

    // 3) Default path: keep the message, but fix the type + shared aliases so
    //    simple confirm/deny messages (keylog_started, webcam_denied, ...)
    //    still carry a canonical agent_id + timestamp_ms.
    const out = { ...raw_msg, type: canonical_type }
    withAgentId(out, raw_msg)
    const ts = pickField(raw_msg, TIMESTAMP_ALIASES)
    if (ts !== undefined) out.timestamp_ms = ts
    return out
}

// ─── Connection ───────────────────────────────────────────────────────────────

// Ask the Gateway for the current list of all known agents.
// Format: docs/protocol/connection.json → list_agents
export function buildListAgents()
{
    return buildMessage(MSG_TYPE.LIST_AGENTS, {})
}

// ─── Policy update (docs/protocol/PolicyUpdate.json) ───────────────────────

// Push the security policy to one or more agents. The Agent overrides its local
// config in RAM and replies policy_update_result. Uses its own "policy_update"
// type (NOT the generic "request").
// app_whitelist — array of app short-names allowed to Start/Stop.
// sandbox_path  — Agent sandbox root that file operations are confined to.
// targetAgents  — array of agent id strings; empty array means all agents.
export function buildPolicyUpdate(app_whitelist, sandbox_path, targetAgents)
{
    if (!Array.isArray(app_whitelist))
    {
        throw new Error('Protocol: app_whitelist must be an array')
    }
    for (let i = 0; i < app_whitelist.length; i++)
    {
        assertNonEmptyString(app_whitelist[i], `app_whitelist[${i}]`)
    }
    assertSafePath(sandbox_path, 'sandbox_path')
    const target_agents = targetAgents ?? []
    assertAgentIdList(target_agents, 'target_agents')
    return buildMessage(MSG_TYPE.POLICY_UPDATE,
    {
        params        : { app_whitelist, sandbox_path },
        target_agents,
    })
}

// ─── Permission flow (Plan B — consent before every module command) ──────────
//
// The Controller must ask the Agent for consent (feature-level) BEFORE sending
// any module command. The Agent shows a popup; its reply comes back as a
// "permission_result" message. feature — one of the FEATURE constants above.
// targetAgents — array of agent id strings; empty array means all agents.

// Ask the given agents to grant a feature (triggers the Agent consent popup).
export function buildPermissionRequest(feature, targetAgents)
{
    assertOneOf(feature, Object.values(FEATURE), 'feature')
    const target_agents = targetAgents ?? []
    assertAgentIdList(target_agents, 'target_agents')
    return buildMessage(MSG_TYPE.PERMISSION_REQUEST,
    {
        feature,
        target_agents,
    })
}

// Withdraw a feature we no longer need (the Agent drops the granted consent).
export function buildPermissionRevoke(feature, targetAgents)
{
    assertOneOf(feature, Object.values(FEATURE), 'feature')
    const target_agents = targetAgents ?? []
    assertAgentIdList(target_agents, 'target_agents')
    return buildMessage(MSG_TYPE.PERMISSION_REVOKE,
    {
        feature,
        target_agents,
    })
}

// Tell the Agent to stop a currently running feature (e.g. stop the stream).
export function buildStopModule(feature, targetAgents)
{
    assertOneOf(feature, Object.values(FEATURE), 'feature')
    const target_agents = targetAgents ?? []
    assertAgentIdList(target_agents, 'target_agents')
    return buildMessage(MSG_TYPE.STOP_MODULE,
    {
        feature,
        target_agents,
    })
}

// ─── Generic request (all module commands go through this) ───────────────────

// Build a "request" envelope for any module command.
// module      — one of the MODULE constants above.
// params      — plain object with module-specific fields (pass {} when none needed).
// targetAgents — array of agent id strings; empty array means all agents.
export function buildRequest(module, params, targetAgents)
{
    assertNonEmptyString(module, 'module')
    const target_agents = targetAgents ?? []
    assertAgentIdList(target_agents, 'target_agents')
    return buildMessage(MSG_TYPE.REQUEST,
    {
        module,
        params        : params ?? {},
        target_agents,
    })
}

// ─── Application module (docs/protocol/application.json) ───────────────────

export function buildAppList(targetAgents)
{
    return buildRequest(MODULE.APP_LIST, {}, targetAgents)
}

// name — the short app name used by the Agent whitelist (e.g. "notepad", "chrome")
export function buildAppStart(name, targetAgents)
{
    assertNonEmptyString(name, 'app name')
    return buildRequest(MODULE.APP_START, { name }, targetAgents)
}

export function buildAppStop(name, targetAgents)
{
    assertNonEmptyString(name, 'app name')
    return buildRequest(MODULE.APP_STOP, { name }, targetAgents)
}

// ─── Process module (docs/protocol/process.json) ───────────────────────────

export function buildProcList(targetAgents)
{
    return buildRequest(MODULE.PROC_LIST, {}, targetAgents)
}

// pid — numeric process ID to terminate
export function buildProcKill(pid, targetAgents)
{
    assertPositiveInt(pid, 'pid')
    return buildRequest(MODULE.PROC_KILL, { pid }, targetAgents)
}

// ─── Screen module (docs/protocol/livescreen.json) ─────────────────────────

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
    const fps_final     = fps     ?? 24
    const quality_final = quality ?? 70
    assertIntInRange(fps_final,     1,  60,  'fps')
    assertIntInRange(quality_final, 1,  100, 'quality')
    return buildRequest(MODULE.SCREEN_STREAM,
    {
        mode    : 'stream',
        fps     : fps_final,
        quality : quality_final,
    },
    targetAgents)
}

export function buildStreamStop(targetAgents)
{
    return buildRequest(MODULE.SCREEN_STREAM_STOP, {}, targetAgents)
}

// ─── Keylog module (docs/protocol/keylog.json) ─────────────────────────────

// Start keystroke capture — Agent will show a consent popup first.
export function buildKeylogStart(targetAgents)
{
    return buildRequest(MODULE.KEYLOG_START, {}, targetAgents)
}

export function buildKeylogStop(targetAgents)
{
    return buildRequest(MODULE.KEYLOG_STOP, {}, targetAgents)
}

// ─── File module — sandbox only (docs/protocol/file.json) ──────────────────

// List the contents of a sandbox folder.
// path — relative path inside the sandbox root (e.g. "/" for root, "/reports/")
export function buildFsList(path, targetAgents)
{
    assertSafePath(path, 'fs_list path')
    return buildRequest(MODULE.FS_LIST, { path }, targetAgents)
}

// Request a file download from the sandbox.
export function buildFsGet(filePath, targetAgents)
{
    assertSafePath(filePath, 'fs_get path')
    return buildRequest(MODULE.FS_GET, { path: filePath }, targetAgents)
}

// Upload one chunk of a file to the sandbox.
// chunk_info = { transfer_id, data_base64, total_size, chunk_index, total_chunks }
// transfer_id groups every chunk of ONE file upload — the Agent uses it to
// stitch chunks back into a single stream. Must be the SAME string for every
// chunk of one file (generate once per file, e.g. via crypto.randomUUID()).
export function buildFsPut(filePath, chunk_info, targetAgents)
{
    assertSafePath(filePath, 'fs_put path')
    if (chunk_info == null || typeof chunk_info !== 'object')
    {
        throw new Error('Protocol: fs_put chunk_info must be an object')
    }
    assertNonEmptyString(chunk_info.transfer_id, 'chunk_info.transfer_id')
    assertNonNegativeInt(chunk_info.total_size,   'chunk_info.total_size')
    assertNonNegativeInt(chunk_info.chunk_index,  'chunk_info.chunk_index')
    assertPositiveInt   (chunk_info.total_chunks, 'chunk_info.total_chunks')
    if (chunk_info.chunk_index >= chunk_info.total_chunks)
    {
        throw new Error('Protocol: chunk_info.chunk_index must be < total_chunks')
    }
    assertNonEmptyString(chunk_info.data_base64,  'chunk_info.data_base64')
    return buildRequest(MODULE.FS_PUT,
    {
        path         : filePath,
        transfer_id  : chunk_info.transfer_id,
        total_size   : chunk_info.total_size,
        chunk_index  : chunk_info.chunk_index,
        total_chunks : chunk_info.total_chunks,
        data_base64  : chunk_info.data_base64,
    },
    targetAgents)
}

// ─── Webcam module (docs/protocol/webcam.json) ─────────────────────────────

// Start webcam stream — Agent will show a consent popup and on-screen indicator.
// fps     — frames per second (default: 15 per webcam.json template)
// quality — JPEG quality 0–100 (default: 60 per webcam.json template)
export function buildWebcamStart(fps, quality, targetAgents)
{
    const fps_final     = fps     ?? 15
    const quality_final = quality ?? 60
    assertIntInRange(fps_final,     1,  30,  'fps')
    assertIntInRange(quality_final, 1,  100, 'quality')
    return buildRequest(MODULE.WEBCAM_START,
    {
        fps     : fps_final,
        quality : quality_final,
    },
    targetAgents)
}

export function buildWebcamStop(targetAgents)
{
    return buildRequest(MODULE.WEBCAM_STOP, {}, targetAgents)
}

// ─── SysInfo module (docs/protocol/SysInfo.json) ───────────────────────────
// Read-only hardware / OS metrics — Agent does NOT ask for consent on this.
// Reply is a "sysinfo_result" message with cpu_percent / ram_used_mb /
// ram_total_mb / disk_used_gb / disk_total_gb / uptime_seconds / hostname / ip / os.
export function buildSysInfo(targetAgents)
{
    return buildRequest(MODULE.SYSINFO, {}, targetAgents)
}

// ─── Power module (docs/protocol/power.json) ───────────────────────────────

// Send a power action. Uses its own "power" type, NOT the generic "request" type.
// action — one of the POWER_ACTION constants: lock / restart / shutdown / sleep
// Note: lock is immediate; restart / shutdown / sleep must be sent only after
//       the Controller shows a 10-second countdown to the operator.
export function buildPower(action, targetAgents)
{
    assertOneOf(action, Object.values(POWER_ACTION), 'power action')
    const target_agents = targetAgents ?? []
    assertAgentIdList(target_agents, 'target_agents')
    return buildMessage(MSG_TYPE.POWER,
    {
        action,
        target_agents,
    })
}
