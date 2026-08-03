// MockSocket.js — simulates the Gateway + Agent for local development.
// Has the SAME API shape as Socket.js (real WebSocket wrapper) so swapping
// them only requires changing one import line — no component changes needed.
// All response formats follow docs/formatjson/*.json exactly.
// No external dependencies.

// ─── Timing constants ─────────────────────────────────────────────────────────

const CONNECT_DELAY_MS = 300;   // time before the mock connection "opens"
const REPLY_MIN_MS     = 400;   // minimum wait before a mock reply
const REPLY_MAX_MS     = 800;   // maximum wait before a mock reply
const STAGGER_MS       = 80;    // extra delay between each agent's reply

// ─── Keylog stream defaults ───────────────────────────────────────────────────

const KEYLOG_INTERVAL_MS = 1500   // ms between each fake keystroke batch
const KEYLOG_BATCH_MIN   = 2      // minimum events per batch
const KEYLOG_BATCH_MAX   = 5      // maximum events per batch

// Pool of key event templates sampled at random to build each fake batch.
// { key, ctrl, alt, shift } — timestamp_ms is stamped at emit time.
const FAKE_KEY_POOL =
[
    { key: 'h',         ctrl: false, alt: false, shift: false },
    { key: 'e',         ctrl: false, alt: false, shift: false },
    { key: 'l',         ctrl: false, alt: false, shift: false },
    { key: 'o',         ctrl: false, alt: false, shift: false },
    { key: ' ',         ctrl: false, alt: false, shift: false },
    { key: 'w',         ctrl: false, alt: false, shift: false },
    { key: 'r',         ctrl: false, alt: false, shift: false },
    { key: 'd',         ctrl: false, alt: false, shift: false },
    { key: 'a',         ctrl: false, alt: false, shift: false },
    { key: 't',         ctrl: false, alt: false, shift: false },
    { key: 'i',         ctrl: false, alt: false, shift: false },
    { key: 'n',         ctrl: false, alt: false, shift: false },
    { key: 's',         ctrl: false, alt: false, shift: false },
    { key: 'Enter',     ctrl: false, alt: false, shift: false },
    { key: 'Backspace', ctrl: false, alt: false, shift: false },
    { key: 'C',         ctrl: true,  alt: false, shift: false },   // Ctrl+C
    { key: 'V',         ctrl: true,  alt: false, shift: false },   // Ctrl+V
    { key: 'Z',         ctrl: true,  alt: false, shift: false },   // Ctrl+Z
    { key: 'S',         ctrl: true,  alt: false, shift: false },   // Ctrl+S
    { key: 'Tab',       ctrl: false, alt: true,  shift: false },   // Alt+Tab
]

// Build a small random batch of keystrokes with incrementing timestamps.
function generateFakeKeyBatch()
{
    const count  = randomInt(KEYLOG_BATCH_MIN, KEYLOG_BATCH_MAX)
    const now    = Date.now()
    const batch  = []
    for (let i = 0; i < count; i++)
    {
        const template = FAKE_KEY_POOL[randomInt(0, FAKE_KEY_POOL.length - 1)]
        batch.push({ ...template, timestamp_ms: now + i * 80 })
    }
    return batch
}

// ─── Frame stream defaults ────────────────────────────────────────────────────

const FRAME_W       = 320;      // simulated screen width (px)
const FRAME_H       = 180;      // simulated screen height (px)
const FRAME_QUALITY = 0.7;      // JPEG quality for canvas.toBlob

// ─── Static fake data ─────────────────────────────────────────────────────────

// 7 fake agents covering many test cases:
//   agent-01 : plain Windows online, idle          — baseline
//   agent-02 : Windows online, currently in-session — session badge + red indicator
//   agent-03 : Windows offline                      — offline UI + no focus
//   agent-04 : Windows online, short app list       — different app content
//   agent-05 : Ubuntu Linux online                  — Linux OS, different apps/procs
//   agent-06 : Windows online, DENIES consent       — keylog/webcam denied flow
//   agent-07 : macOS offline                        — non-Windows offline agent
const FAKE_AGENTS =
[
    { id: "agent-01", name: "PC-Lab-01",      os: "Windows 11",  ip: "192.168.1.101", online: true,  in_session: false },
    { id: "agent-02", name: "PC-Lab-02",      os: "Windows 11",  ip: "192.168.1.102", online: true,  in_session: true  },
    { id: "agent-03", name: "PC-Lab-03",      os: "Windows 10",  ip: "192.168.1.103", online: false, in_session: false },
    { id: "agent-04", name: "PC-Lab-04",      os: "Windows 11",  ip: "192.168.1.104", online: true,  in_session: false },
    { id: "agent-05", name: "DEV-Ubuntu-01",  os: "Ubuntu 22.04",ip: "192.168.1.105", online: true,  in_session: false },
    { id: "agent-06", name: "PC-Lab-06",      os: "Windows 10",  ip: "192.168.1.106", online: true,  in_session: true  },
    { id: "agent-07", name: "MacBook-Lab-01", os: "macOS 14",    ip: "192.168.1.107", online: false, in_session: false },
]

// Agents that will refuse to grant consent for sensitive modules.
// When keylog_start / webcam_start targets one of these, MockSocket replies
// with keylog_denied / webcam_denied instead of the started confirmation.
// Used to test the "consent denied" flow and the transparency indicator.
const DENIED_AGENTS = new Set(["agent-06"])

// OS families used to pick the right app/process pool for each agent.
function getOsFamily(agent_id)
{
    const agent = FAKE_AGENTS.find((a) => a.id === agent_id)
    if (!agent) return 'windows'
    if (agent.os.startsWith('Ubuntu') || agent.os.startsWith('Linux')) return 'linux'
    if (agent.os.startsWith('macOS'))                                  return 'macos'
    return 'windows'
}

// Template app lists per OS family — cloned per agent into _app_state on first request.
// Each list mixes whitelisted (safe to Start/Stop) and non-whitelisted apps so the
// Application tab can visibly disable Start/Stop for the latter.
const INITIAL_APPS_BY_OS =
{
    windows :
    [
        { name: "notepad",  display_name: "Notepad",          status: "stopped", cpu_percent: 0.0, ram_mb: 0,   in_whitelist: true  },
        { name: "calc",     display_name: "Calculator",        status: "running", cpu_percent: 0.1, ram_mb: 8,   in_whitelist: true  },
        { name: "mspaint",  display_name: "Paint",             status: "stopped", cpu_percent: 0.0, ram_mb: 0,   in_whitelist: true  },
        { name: "chrome",   display_name: "Google Chrome",     status: "running", cpu_percent: 8.4, ram_mb: 420, in_whitelist: true  },
        { name: "vlc",      display_name: "VLC Media Player",  status: "stopped", cpu_percent: 0.0, ram_mb: 0,   in_whitelist: true  },
    ],
    linux :
    [
        { name: "firefox",   display_name: "Firefox",           status: "running", cpu_percent: 6.5, ram_mb: 380, in_whitelist: true  },
        { name: "gedit",     display_name: "Text Editor",       status: "stopped", cpu_percent: 0.0, ram_mb: 0,   in_whitelist: true  },
        { name: "terminal",  display_name: "GNOME Terminal",    status: "running", cpu_percent: 0.3, ram_mb: 24,  in_whitelist: true  },
        { name: "code",      display_name: "Visual Studio Code",status: "stopped", cpu_percent: 0.0, ram_mb: 0,   in_whitelist: true  },
    ],
    macos :
    [
        { name: "safari",    display_name: "Safari",            status: "running", cpu_percent: 5.2, ram_mb: 260, in_whitelist: true  },
        { name: "textedit",  display_name: "TextEdit",          status: "stopped", cpu_percent: 0.0, ram_mb: 0,   in_whitelist: true  },
        { name: "terminal",  display_name: "Terminal",          status: "stopped", cpu_percent: 0.0, ram_mb: 0,   in_whitelist: true  },
    ],
}

// Process pools per OS family — used when building a random process snapshot.
const PROC_NAME_POOL_BY_OS =
{
    windows :
    [
        "System",               "svchost.exe",
        "explorer.exe",         "chrome.exe",
        "code.exe",             "notepad.exe",
        "taskmgr.exe",          "RuntimeBroker.exe",
        "SearchHost.exe",       "ShellExperienceHost.exe",
        "lsass.exe",            "dwm.exe",
    ],
    linux :
    [
        "systemd",              "systemd-journald",
        "bash",                 "sshd",
        "firefox",              "gnome-shell",
        "Xorg",                 "node",
        "python3",              "cron",
        "NetworkManager",       "dbus-daemon",
    ],
    macos :
    [
        "kernel_task",          "launchd",
        "WindowServer",         "Finder",
        "Safari",               "coreaudiod",
        "mds",                  "cfprefsd",
        "syslogd",              "distnoted",
    ],
}

// Multi-level sandbox file tree (read-only mock).
// Keys are sandbox paths; values are the entry arrays returned by fs_list_result.
// All paths are relative to the sandbox root — nothing outside "/" is accessible.
const FAKE_FS_TREE =
{
    '/' :
    [
        { name: "reports",    type: "directory", size: null,   modified_ms: 1719900000000 },
        { name: "uploads",    type: "directory", size: null,   modified_ms: 1719900001000 },
        { name: "readme.txt", type: "file",      size: 1024,   modified_ms: 1719900002000 },
        { name: "data.csv",   type: "file",      size: 204800, modified_ms: 1719900003000 },
    ],
    '/reports' :
    [
        { name: "log_2024-01.txt", type: "file", size: 8192,  modified_ms: 1719800000000 },
        { name: "summary.txt",     type: "file", size: 51200, modified_ms: 1719810000000 },
    ],
    '/uploads' :
    [
        { name: "photo.jpg",   type: "file", size: 102400, modified_ms: 1719850000000 },
        { name: "config.json", type: "file", size: 2048,   modified_ms: 1719860000000 },
    ],
}

// Generate fake text content for a sandbox file and return it as a base64 string.
// Content varies by file extension so downloaded files look realistic in a text editor.
function generateFakeFileContent(file_path)
{
    const ext     = file_path.split('.').pop().toLowerCase()
    let   content = ''

    switch (ext)
    {
        case 'txt':
            content = `[Sandbox file: ${file_path}]\n\nLine 1: Hello from the sandbox.\nLine 2: This is simulated content.\nLine 3: All operations are sandbox-restricted.\n`
            break
        case 'csv':
            content = `id,name,value\n1,alpha,100\n2,beta,200\n3,gamma,300\n`
            break
        case 'json':
            content = JSON.stringify({ sandbox: true, path: file_path, note: 'Simulated config file' }, null, 2)
            break
        default:
            content = `[Binary placeholder]\nFile: ${file_path}\nThis is a fake binary file generated by MockSocket.\n`
    }

    // Encode to base64 safely (handles ASCII content from our fake data above).
    return btoa(unescape(encodeURIComponent(content)))
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function randomFloat(min, max)
{
    return parseFloat((Math.random() * (max - min) + min).toFixed(1))
}

function randomInt(min, max)
{
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomDelay()
{
    return randomInt(REPLY_MIN_MS, REPLY_MAX_MS)
}

// Clamp a percentage into [0, 100] — used to keep the fake CPU sample bounded.
function clampPercent(v)
{
    return Math.max(0, Math.min(100, parseFloat(v.toFixed(1))))
}

// Clamp any value into an arbitrary [min, max] range with one-decimal rounding.
function clampRange(v, min, max)
{
    return Math.max(min, Math.min(max, parseFloat(v.toFixed(1))))
}

// Build a fresh process list with random cpu_percent / ram_mb values.
// Uses the OS-specific pool so process names look realistic per platform.
// Called each time proc_list is requested so numbers look "live".
// Format matches docs/formatjson/process.json → proc_list_result
function generateFakeProcs(os_family)
{
    const pool = PROC_NAME_POOL_BY_OS[os_family] ?? PROC_NAME_POOL_BY_OS.windows
    return pool.map((name, index) =>
    ({
        pid         : 1000 + index * 100 + randomInt(0, 99),
        name,
        cpu_percent : randomFloat(0, 25),
        ram_mb      : randomFloat(10, 512),
    }))
}

// ─── MockSocket class ─────────────────────────────────────────────────────────

class MockSocket
{
    constructor()
    {
        this._on_message     = null;   // fired for every incoming JSON message
        this._on_binary      = null;   // fired for incoming binary (ArrayBuffer) data
        this._on_open        = null;   // fired once when the connection opens
        this._on_close       = null;   // fired when the connection closes
        this._on_error       = null;   // kept for API parity with real Socket (unused here)
        this._connected      = false;  // true after connect() fires _on_open
        this._connect_timer  = null;   // saved so close() can cancel it

        // Per-agent mutable state so Start/Stop/Kill have visible effects.
        // Keyed by agent_id. Lazily initialised on first request.
        this._app_state      = {};   // { [agent_id]: [ ...app objects ] }
        this._proc_state     = {};   // { [agent_id]: [ ...proc objects ] }
        this._sysinfo_state  = {};   // { [agent_id]: { cpu_percent, ram_used_mb, ram_total_mb, disk_used_gb, disk_total_gb, started_at, hostname, ip, os } }

        // Per-agent uploaded files, keyed by parent directory path.
        // Shape: { [agent_id]: { [parent_path]: [ { name, type:'file', size, modified_ms } ] } }
        // Merged into FAKE_FS_TREE on fs_list so uploads appear on Refresh.
        this._uploaded_files = {};

        // Active frame streams keyed by "agentId:module" (e.g. "agent-01:screen").
        // Each value is a setInterval ID. Cleared on stop or close.
        this._streams        = {};

        // Active keylog streams keyed by agent_id. Each value is a setInterval ID.
        this._keylog_streams = {};

        // Security policy last pushed by the Controller (policy_update). When set,
        // app_list computes each app's in_whitelist from this whitelist Set,
        // simulating the Agent applying the pushed policy in RAM.
        // Shape: { whitelist: Set<string>, sandbox_path: string } | null
        this._policy = null;

        // Sequence counter per stream key. Increments with every frame.
        this._seq_counters   = {};

        // Shared off-screen canvas for generating fake JPEG frames.
        // Created lazily by _getCanvas().
        this._canvas         = null;
        this._canvas_ctx     = null;
    }

    // ── Callback registration (mirror the real Socket API) ─────────────────

    onOpen(callback)    { this._on_open    = callback; }
    onMessage(callback) { this._on_message = callback; }
    onBinary(callback)  { this._on_binary  = callback; }
    onClose(callback)   { this._on_close   = callback; }
    onError(callback)   { this._on_error   = callback; }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    connect()
    {
        this._connect_timer = setTimeout(() =>
        {
            this._connected = true;
            if (this._on_open) this._on_open();
        }, CONNECT_DELAY_MS);
    }

    close()
    {
        clearTimeout(this._connect_timer);   // cancel pending connect timer if still waiting

        // Stop all running frame streams to prevent leaked intervals
        for (const key of Object.keys(this._streams))
        {
            clearInterval(this._streams[key]);
        }
        this._streams      = {};
        this._seq_counters = {};

        // Stop all keylog streams
        for (const key of Object.keys(this._keylog_streams))
        {
            clearInterval(this._keylog_streams[key]);
        }
        this._keylog_streams = {};

        this._connected = false;
        if (this._on_close) this._on_close();
    }

    // ── Send (entry point for outgoing commands) ───────────────────────────

    // Receive a JSON string from the app (same contract as a real WebSocket send).
    send(message)
    {
        if (!this._connected)
        {
            console.warn('[MockSocket] send() called before connect()');
            return;
        }

        let parsed;
        try
        {
            parsed = JSON.parse(message);
        }
        catch (err)
        {
            console.warn('[MockSocket] Received non-JSON message:', message, err);
            return;
        }

        this._dispatch(parsed);
    }

    // ── Per-agent state helpers ──────────────────────────────────────────

    // Return (and lazily create) the mutable app list for one agent.
    // Template is picked based on the agent's OS family (Windows/Linux/macOS).
    _getApps(agent_id)
    {
        if (!this._app_state[agent_id])
        {
            const os_family = getOsFamily(agent_id)
            const template  = INITIAL_APPS_BY_OS[os_family] ?? INITIAL_APPS_BY_OS.windows
            this._app_state[agent_id] = template.map((a) => ({ ...a }))
        }
        return this._app_state[agent_id]
    }

    // Return (and lazily create) the mutable process list for one agent.
    // Template is picked based on the agent's OS family (Windows/Linux/macOS).
    _getProcs(agent_id)
    {
        if (!this._proc_state[agent_id])
        {
            this._proc_state[agent_id] = generateFakeProcs(getOsFamily(agent_id))
        }
        return this._proc_state[agent_id]
    }

    // Return (and lazily create) the mutable sysinfo snapshot for one agent.
    // Different agents get different hardware profiles so the tab looks alive.
    _getSysInfoState(agent_id)
    {
        if (!this._sysinfo_state[agent_id])
        {
            const agent = FAKE_AGENTS.find((a) => a.id === agent_id) ?? {}
            // Vary hardware size across agents so RAM/Disk totals are not identical.
            const ram_total  = randomInt(8192, 32768)
            const disk_total = randomInt(256, 1024)
            this._sysinfo_state[agent_id] = {
                cpu_percent   : randomFloat(5, 40),
                ram_used_mb   : randomFloat(2048, ram_total  * 0.6),
                ram_total_mb  : ram_total,
                disk_used_gb  : randomFloat(disk_total * 0.2, disk_total * 0.7),
                disk_total_gb : disk_total,
                started_at    : Date.now() - randomInt(60, 86400) * 1000,   // fake uptime seed
                hostname      : agent.name ?? agent_id,
                ip            : agent.ip   ?? '0.0.0.0',
                os            : agent.os   ?? 'Unknown',
            }
        }
        return this._sysinfo_state[agent_id]
    }

    // Return the merged directory listing for one agent + path.
    // Combines the static FAKE_FS_TREE with per-agent uploaded files.
    _getFsEntries(agent_id, path)
    {
        const base    = FAKE_FS_TREE[path] ?? []
        const extra   = this._uploaded_files[agent_id]?.[path] ?? []
        return [...base, ...extra]
    }

    // Record an uploaded file so it appears on the next fs_list of its parent dir.
    // Deduplicates by name — re-uploading the same filename replaces the old entry.
    _recordUpload(agent_id, full_path, size)
    {
        const slash_at    = full_path.lastIndexOf('/')
        const parent_path = slash_at <= 0 ? '/' : full_path.slice(0, slash_at)
        const file_name   = full_path.slice(slash_at + 1)

        if (!this._uploaded_files[agent_id])            this._uploaded_files[agent_id] = {}
        if (!this._uploaded_files[agent_id][parent_path]) this._uploaded_files[agent_id][parent_path] = []

        const list = this._uploaded_files[agent_id][parent_path]
        const idx  = list.findIndex((e) => e.name === file_name)
        const entry = { name: file_name, type: 'file', size, modified_ms: Date.now() }
        if (idx >= 0) list[idx] = entry
        else          list.push(entry)
    }

    // ── Private: dispatch ──────────────────────────────────────────────────

    // Route a parsed message to the matching handler by its type field.
    // All module commands arrive as type "request" — sub-dispatch on msg.module.
    _dispatch(msg)
    {
        switch (msg.type)
        {
            case 'list_agents':   this._handleListAgents(msg); break;
            case 'request':       this._handleRequest(msg);    break;
            case 'power':         this._handlePower(msg);      break;
            case 'policy_update': this._handlePolicy(msg);     break;

            // TODO: add handlers for new top-level message types here

            default:
                console.warn('[MockSocket] Unknown message type:', msg.type);
        }
    }

    // ── Private: message handlers ──────────────────────────────────────────

    _handleListAgents()
    {
        // Reply quickly — agent list is always ready on the Gateway side.
        this._reply({ type: 'agents_list', agents: FAKE_AGENTS }, 200);
    }

    // All module commands arrive as type:"request"; dispatch on msg.module.
    _handleRequest(msg)
    {
        switch (msg.module)
        {
            // ── Application (application.json) ─────────────────────────────
            case 'app_list':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                {
                    // Return current stateful app list with fresh random CPU/RAM for running apps.
                    // in_whitelist is derived from the pushed policy when present,
                    // simulating the Agent applying the Controller's whitelist.
                    const policy_set = this._policy?.whitelist
                    const apps = this._getApps(agent_id).map((a) =>
                    ({
                        ...a,
                        in_whitelist : policy_set ? policy_set.has(a.name) : a.in_whitelist,
                        cpu_percent  : a.status === 'running' ? randomFloat(0.1, 15) : 0,
                        ram_mb       : a.status === 'running' ? randomInt(5, 500)     : 0,
                    }))
                    return { type: 'app_list_result', agent_id, apps }
                },
                300);
                break;

            case 'app_start':
            case 'app_stop':
            {
                const app_name   = msg.params?.name ?? ''
                const new_status = msg.module === 'app_start' ? 'running' : 'stopped'

                this._replyPerAgent(msg.target_agents, (agent_id) =>
                {
                    // Mutate the persistent app state so the next poll reflects the change
                    const apps = this._getApps(agent_id)
                    const target = apps.find((a) => a.name === app_name)
                    if (target) target.status = new_status

                    return {
                        type    : 'app_action_result',
                        agent_id,
                        action  : msg.module,
                        name    : app_name,
                        success : true,
                        message : msg.module === 'app_start'
                            ? `${app_name} started successfully`
                            : `${app_name} stopped successfully`,
                    }
                },
                300);
                break;
            }

            // ── Process (process.json) ─────────────────────────────────────
            case 'proc_list':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                {
                    // Return persistent list with fresh random CPU/RAM each poll
                    const procs = this._getProcs(agent_id).map((p) =>
                    ({
                        ...p,
                        cpu_percent : randomFloat(0, 25),
                        ram_mb      : randomFloat(10, 512),
                    }))
                    return { type: 'proc_list_result', agent_id, processes: procs }
                },
                300);
                break;

            case 'proc_kill':
            {
                const kill_pid = msg.params?.pid

                this._replyPerAgent(msg.target_agents, (agent_id) =>
                {
                    // Remove the process from persistent state so it disappears on next poll
                    const procs = this._getProcs(agent_id)
                    const idx   = procs.findIndex((p) => p.pid === kill_pid)
                    const name  = idx >= 0 ? procs[idx].name : `PID ${kill_pid}`
                    if (idx >= 0) procs.splice(idx, 1)

                    return {
                        type    : 'proc_kill_result',
                        agent_id,
                        pid     : kill_pid,
                        name,
                        success : idx >= 0,
                        message : idx >= 0 ? `${name} terminated` : `PID ${kill_pid} not found`,
                    }
                },
                300);
                break;
            }

            // ── SysInfo (SysInfo.json) ─────────────────────────────────────
            case 'sysinfo':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                {
                    // Smoothly evolve fake metrics per agent so the sparkline
                    // shows a plausible waveform instead of pure white noise.
                    const state = this._getSysInfoState(agent_id)
                    state.cpu_percent  = clampPercent(state.cpu_percent  + randomFloat(-6, 6))
                    state.ram_used_mb  = clampRange(state.ram_used_mb + randomFloat(-150, 150), 1024, state.ram_total_mb - 512)
                    state.disk_used_gb = clampRange(state.disk_used_gb + randomFloat(-0.3, 0.3), 20, state.disk_total_gb - 5)

                    return {
                        type           : 'sysinfo_result',
                        agent_id,
                        cpu_percent    : state.cpu_percent,
                        ram_used_mb    : state.ram_used_mb,
                        ram_total_mb   : state.ram_total_mb,
                        disk_used_gb   : state.disk_used_gb,
                        disk_total_gb  : state.disk_total_gb,
                        uptime_seconds : Math.floor((Date.now() - state.started_at) / 1000),
                        hostname       : state.hostname,
                        ip             : state.ip,
                        os             : state.os,
                    }
                },
                200);
                break;

            // ── Screen (livescreen.json) ───────────────────────────────────
            case 'screenshot':
                // Single capture: emit one frame_meta + binary pair per agent
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                {
                    this._emitSingleFrame(agent_id, 'screen');
                    return null;   // _emitSingleFrame calls _reply itself
                },
                0);
                break;

            case 'screen_stream':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                {
                    const fps = msg.params?.fps ?? 24;
                    this._startFrameStream(agent_id, 'screen', fps);

                    // Confirm stream started
                    this._reply({ type: 'stream_started', agent_id, module: 'screen' }, 100);
                    return null;
                },
                0);
                break;

            case 'screen_stream_stop':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                {
                    this._stopFrameStream(agent_id, 'screen');
                    return { type: 'stream_stopped', agent_id, module: 'screen' };
                },
                200);
                break;

            // ── Keylog (keylog.json) ───────────────────────────────────────
            case 'keylog_start':
                this._replyPerAgent(msg.target_agents, (agent_id, i) =>
                {
                    const base = 400 + i * STAGGER_MS;

                    // Agents in DENIED_AGENTS refuse consent — reply keylog_denied
                    // instead of keylog_started so the Controller can show the
                    // consent-denied UX (toast + IDLE indicator staying gray).
                    if (DENIED_AGENTS.has(agent_id))
                    {
                        this._reply({ type: 'keylog_denied', agent_id, reason: 'User declined on Agent machine' }, base);
                        return null;
                    }

                    // 1) Confirm keylog started (simulates Agent consent granted)
                    this._reply({ type: 'keylog_started', agent_id }, base);

                    // 2) Begin continuous stream once the start confirmation fires
                    setTimeout(() => this._startKeylogStream(agent_id), base + 50);

                    return null;   // _replyPerAgent skips null returns
                },
                0);
                break;

            case 'keylog_stop':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                {
                    // Stop the interval first so no extra batches arrive after stopped
                    this._stopKeylogStream(agent_id);
                    return { type: 'keylog_stopped', agent_id };
                },
                300);
                break;

            // ── File (file.json) ───────────────────────────────────────────
            case 'fs_list':
            {
                // Merge static tree + per-agent uploads so uploaded files appear.
                // This simulates the sandbox restriction: only known paths have content.
                const list_path = msg.params?.path ?? '/'
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                ({
                    type    : 'fs_list_result',
                    agent_id,
                    path    : list_path,
                    entries : this._getFsEntries(agent_id, list_path),
                }),
                300);
                break;
            }

            case 'fs_get':
            {
                // Return fake file content encoded as base64 (single chunk, sandbox only).
                const get_path = msg.params?.path ?? ''
                const content  = generateFakeFileContent(get_path)
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                ({
                    type         : 'fs_get_result',
                    agent_id,
                    path         : get_path,
                    total_size   : content.length,
                    chunk_index  : 0,
                    total_chunks : 1,
                    data_base64  : content,
                }),
                400);
                break;
            }

            case 'fs_put':
            {
                // All operations are sandbox-restricted on the Agent side.
                const put_path      = msg.params?.path        ?? ''
                const total_size    = msg.params?.total_size  ?? 0
                const chunk_index   = msg.params?.chunk_index ?? 0
                const total_chunks  = msg.params?.total_chunks ?? 1
                const is_last_chunk = chunk_index === total_chunks - 1

                this._replyPerAgent(msg.target_agents, (agent_id, i) =>
                {
                    // After the last chunk is acked, persist the file and send fs_put_complete.
                    if (is_last_chunk)
                    {
                        // Record the upload so it shows up on the next fs_list.
                        this._recordUpload(agent_id, put_path, total_size)

                        this._reply(
                        {
                            type    : 'fs_put_complete',
                            agent_id,
                            path    : put_path,
                            success : true,
                            message : 'File saved to sandbox',
                        },
                        280 + i * STAGGER_MS);   // slightly after the per-chunk ack
                    }

                    return {
                        type        : 'fs_put_result',
                        agent_id,
                        path        : put_path,
                        chunk_index,
                        success     : true,
                        message     : 'Chunk received',
                    }
                },
                150);   // fast reply so progress bar moves smoothly
                break;
            }

            // ── Webcam (webcam.json) ───────────────────────────────────────
            // Reuses the SAME frame stream engine as screen — the only
            // difference is frame_meta.module = "webcam". This mirrors the
            // Controller side, where FrameCanvas is shared between Livescreen
            // and WebcamTab so both modules go through one decode/render path.
            case 'webcam_start':
                this._replyPerAgent(msg.target_agents, (agent_id, i) =>
                {
                    const base = 400 + i * STAGGER_MS;

                    // Agents in DENIED_AGENTS refuse consent — reply webcam_denied
                    // instead of webcam_started so the Controller can display the
                    // consent-denied UX (toast + no camera feed).
                    if (DENIED_AGENTS.has(agent_id))
                    {
                        this._reply({ type: 'webcam_denied', agent_id, reason: 'User declined on Agent machine' }, base);
                        return null;
                    }

                    // 1) Confirm webcam started (simulates Agent consent granted)
                    this._reply({ type: 'webcam_started', agent_id }, base);

                    // 2) Begin continuous webcam frame stream once confirmation fires.
                    //    Uses the shared _startFrameStream engine — same code path as
                    //    screen streams, only the module tag differs.
                    const fps = msg.params?.fps ?? 15;
                    setTimeout(() => this._startFrameStream(agent_id, 'webcam', fps), base + 50);

                    return null;
                },
                0);
                break;

            case 'webcam_stop':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                {
                    this._stopFrameStream(agent_id, 'webcam');
                    return { type: 'webcam_stopped', agent_id };
                },
                300);
                break;

            // TODO: add mock responses for new modules here

            default:
                this._resolveTargets(msg.target_agents).forEach((agent_id) =>
                {
                    this._reply({ type: 'module_denied', agent_id, module: msg.module, reason: 'unknown module' });
                });
        }
    }

    // Apply a pushed security policy and confirm per agent.
    // Format: docs/formatjson/PolicyUpdate.json → policy_update_result
    _handlePolicy(msg)
    {
        const app_whitelist = msg.params?.app_whitelist ?? []
        const sandbox_path  = msg.params?.sandbox_path  ?? ''

        // Store in RAM — next app_list uses this whitelist to set in_whitelist.
        this._policy = { whitelist: new Set(app_whitelist), sandbox_path }

        this._replyPerAgent(msg.target_agents, (agent_id) =>
        ({
            type    : 'policy_update_result',
            agent_id,
            success : true,
            message : 'Policy updated successfully on memory',
        }),
        350);
    }

    _handlePower(msg)
    {
        // Format: docs/formatjson/power.json → power_result
        this._replyPerAgent(msg.target_agents, (agent_id) =>
        ({
            type      : 'power_result',
            agent_id,
            action    : msg.action,
            confirmed : true,
            message   : `System action "${msg.action}" executed`,
        }),
        400);
    }

    // ── Private: keylog stream engine ─────────────────────────────────────
    //
    // Emits batches of random fake keystrokes on a fixed interval until stopped.

    _startKeylogStream(agent_id)
    {
        // Cancel any existing stream for this agent before creating a new one
        this._stopKeylogStream(agent_id);

        this._keylog_streams[agent_id] = setInterval(() =>
        {
            if (!this._connected || !this._on_message) return;

            this._on_message(
            {
                type     : 'keylog',
                agent_id,
                events   : generateFakeKeyBatch(),
            });
        }, KEYLOG_INTERVAL_MS);
    }

    _stopKeylogStream(agent_id)
    {
        if (this._keylog_streams[agent_id])
        {
            clearInterval(this._keylog_streams[agent_id]);
            delete this._keylog_streams[agent_id];
        }
    }

    // ── Private: frame stream engine ──────────────────────────────────────
    //
    // Simulates the Agent capturing its screen and sending JPEG frames.
    // Uses an off-screen <canvas> to draw a numbered card with the agent id
    // and a timestamp, then encodes it to a JPEG blob → ArrayBuffer.
    // Each frame produces TWO messages in order (matching real protocol):
    //   1) JSON   — frame_meta  (type, agent_id, module, w, h, len, seq, timestamp_ms)
    //   2) Binary — raw JPEG bytes as ArrayBuffer

    // Lazily create a shared off-screen canvas (no DOM attachment needed).
    _getCanvas()
    {
        if (!this._canvas)
        {
            this._canvas     = document.createElement('canvas');
            this._canvas.width  = FRAME_W;
            this._canvas.height = FRAME_H;
            this._canvas_ctx = this._canvas.getContext('2d');
        }
        return { canvas: this._canvas, ctx: this._canvas_ctx };
    }

    // Draw a visually distinct test card on the shared canvas.
    // Each agent gets a different background hue so tiles are distinguishable.
    _drawTestCard(agent_id, module, seq)
    {
        const { canvas, ctx } = this._getCanvas();

        // Derive a stable hue from the agent_id string
        let hash = 0;
        for (let i = 0; i < agent_id.length; i++)
        {
            hash = agent_id.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = Math.abs(hash) % 360;

        // Fill background with agent-specific colour
        ctx.fillStyle = `hsl(${hue}, 40%, 25%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw agent name at top
        ctx.fillStyle = '#FFFFFF';
        ctx.font      = 'bold 16px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(agent_id, canvas.width / 2, 40);

        // Draw module label
        ctx.font = '12px monospace';
        ctx.fillText(module.toUpperCase(), canvas.width / 2, 65);

        // Draw frame sequence number (large, centered)
        ctx.font = 'bold 48px monospace';
        ctx.fillText(`#${seq}`, canvas.width / 2, 120);

        // Draw current timestamp at bottom
        ctx.font = '11px monospace';
        ctx.fillStyle = '#AAAAAA';
        const time_str = new Date().toLocaleTimeString();
        ctx.fillText(time_str, canvas.width / 2, 165);
    }

    // Emit a single frame_meta + binary JPEG pair for one agent.
    // Used by both screenshot (one-shot) and stream (repeated).
    _emitSingleFrame(agent_id, module)
    {
        const key = `${agent_id}:${module}`;
        if (!this._seq_counters[key]) this._seq_counters[key] = 0;
        const seq = ++this._seq_counters[key];

        this._drawTestCard(agent_id, module, seq);

        const { canvas } = this._getCanvas();

        // Convert canvas to JPEG blob, then to ArrayBuffer
        canvas.toBlob((blob) =>
        {
            if (!blob || !this._connected) return;

            blob.arrayBuffer().then((buffer) =>
            {
                if (!this._connected) return;

                // 1) Send frame_meta JSON (matches docs/formatjson/livescreen.json)
                if (this._on_message)
                {
                    this._on_message(
                    {
                        type         : 'frame_meta',
                        module,
                        agent_id,
                        w            : FRAME_W,
                        h            : FRAME_H,
                        len          : buffer.byteLength,
                        seq,
                        timestamp_ms : Date.now(),
                    });
                }

                // 2) Send raw JPEG binary immediately after
                if (this._on_binary)
                {
                    this._on_binary(buffer);
                }
            });
        }, 'image/jpeg', FRAME_QUALITY);
    }

    // Start a repeating frame stream at the given fps.
    // If a stream is already running for this agent+module, stop it first.
    _startFrameStream(agent_id, module, fps)
    {
        const key = `${agent_id}:${module}`;

        // Stop any existing stream for this key (prevents duplicate intervals)
        if (this._streams[key])
        {
            clearInterval(this._streams[key]);
        }

        const interval_ms = Math.round(1000 / fps);

        this._streams[key] = setInterval(() =>
        {
            this._emitSingleFrame(agent_id, module);
        }, interval_ms);
    }

    // Stop a running frame stream for one agent+module.
    _stopFrameStream(agent_id, module)
    {
        const key = `${agent_id}:${module}`;
        if (this._streams[key])
        {
            clearInterval(this._streams[key]);
            delete this._streams[key];
        }
    }

    // ── Private: utilities ─────────────────────────────────────────────────

    // Push a response object to the caller after `delay` ms.
    // Skips silently if the socket was closed before the timer fires.
    _reply(payload, delay)
    {
        const wait = delay ?? randomDelay();
        setTimeout(() =>
        {
            if (this._connected && this._on_message)
            {
                this._on_message(payload);
            }
        }, wait);
    }

    // Call builder(agent_id, index) for each resolved target and _reply the result.
    // If builder returns null the reply is skipped (used when the builder
    // calls _reply itself, e.g. keylog_start which sends two messages).
    _replyPerAgent(target_agents, builder, base_delay)
    {
        const target_ids = this._resolveTargets(target_agents);
        target_ids.forEach((agent_id, i) =>
        {
            const payload = builder(agent_id, i);
            if (payload !== null)
            {
                this._reply(payload, base_delay + i * STAGGER_MS);
            }
        });
    }

    // Return the list of agent IDs to reply to.
    // Empty / missing target_agents means all online agents.
    _resolveTargets(target_agents)
    {
        if (!target_agents || target_agents.length === 0)
        {
            return FAKE_AGENTS
                .filter((a) => a.online)
                .map((a) => a.id);
        }
        return target_agents;
    }
}

export default MockSocket;
