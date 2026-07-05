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

// ─── Static fake data ─────────────────────────────────────────────────────────

const FAKE_AGENTS =
[
    { id: "agent-01", name: "PC-Lab-01", os: "Windows 11", ip: "192.168.1.101", online: true,  in_session: false },
    { id: "agent-02", name: "PC-Lab-02", os: "Windows 11", ip: "192.168.1.102", online: true,  in_session: true  },
    { id: "agent-03", name: "PC-Lab-03", os: "Windows 10", ip: "192.168.1.103", online: false, in_session: false },
]

// App list — format matches docs/formatjson/application.json → app_list_result
const FAKE_APPS =
[
    { name: "notepad",  display_name: "Notepad",          status: "stopped", cpu_percent: 0.0, ram_mb: 0,   in_whitelist: true  },
    { name: "calc",     display_name: "Calculator",        status: "running", cpu_percent: 0.1, ram_mb: 8,   in_whitelist: true  },
    { name: "mspaint",  display_name: "Paint",             status: "stopped", cpu_percent: 0.0, ram_mb: 0,   in_whitelist: true  },
    { name: "chrome",   display_name: "Google Chrome",     status: "running", cpu_percent: 8.4, ram_mb: 420, in_whitelist: true  },
    { name: "vlc",      display_name: "VLC Media Player",  status: "stopped", cpu_percent: 0.0, ram_mb: 0,   in_whitelist: true  },
]

// Process names used when building a random process snapshot
const PROC_NAME_POOL =
[
    "System",               "svchost.exe",
    "explorer.exe",         "chrome.exe",
    "code.exe",             "notepad.exe",
    "taskmgr.exe",          "RuntimeBroker.exe",
    "SearchHost.exe",       "ShellExperienceHost.exe",
    "lsass.exe",            "dwm.exe",
]

// Sample sandbox file tree — format matches docs/formatjson/file.json → fs_list_result
const FAKE_FS_ROOT =
[
    { name: "reports",    type: "directory", size: null, modified_ms: 1719900000000 },
    { name: "uploads",    type: "directory", size: null, modified_ms: 1719900001000 },
    { name: "readme.txt", type: "file",      size: 1024, modified_ms: 1719900002000 },
    { name: "data.csv",   type: "file",      size: 204800, modified_ms: 1719900003000 },
]

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

// Build a fresh process list with random cpu_percent / ram_mb values.
// Called each time proc_list is requested so numbers look "live".
// Format matches docs/formatjson/process.json → proc_list_result
function generateFakeProcs()
{
    return PROC_NAME_POOL.map((name, index) =>
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
        this._on_message     = null;   // fired for every incoming message object
        this._on_open        = null;   // fired once when the connection opens
        this._on_close       = null;   // fired when the connection closes
        this._on_error       = null;   // kept for API parity with real Socket (unused here)
        this._connected      = false;  // true after connect() fires _on_open
        this._connect_timer  = null;   // saved so close() can cancel it
    }

    // ── Callback registration (mirror the real Socket API) ─────────────────

    onOpen(callback)    { this._on_open    = callback; }
    onMessage(callback) { this._on_message = callback; }
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

    // ── Private: dispatch ──────────────────────────────────────────────────

    // Route a parsed message to the matching handler by its type field.
    // All module commands arrive as type "request" — sub-dispatch on msg.module.
    _dispatch(msg)
    {
        switch (msg.type)
        {
            case 'list_agents': this._handleListAgents(msg); break;
            case 'request':     this._handleRequest(msg);    break;
            case 'power':       this._handlePower(msg);      break;

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
                this._replyPerAgent(msg.target_agents, (agent_id, i) =>
                ({
                    type     : 'app_list_result',
                    agent_id,
                    apps     : FAKE_APPS,
                }),
                300);
                break;

            case 'app_start':
            case 'app_stop':
                this._replyPerAgent(msg.target_agents, (agent_id, i) =>
                ({
                    type    : 'app_action_result',
                    agent_id,
                    action  : msg.module,
                    name    : msg.params?.name ?? '',
                    success : true,
                    message : msg.module === 'app_start' ? 'Application started successfully' : 'Application stopped successfully',
                }),
                300);
                break;

            // ── Process (process.json) ─────────────────────────────────────
            case 'proc_list':
                this._replyPerAgent(msg.target_agents, (agent_id, i) =>
                ({
                    type      : 'proc_list_result',
                    agent_id,
                    processes : generateFakeProcs(),   // fresh random data each call
                }),
                300);
                break;

            case 'proc_kill':
                this._replyPerAgent(msg.target_agents, (agent_id, i) =>
                ({
                    type    : 'proc_kill_result',
                    agent_id,
                    pid     : msg.params?.pid,
                    success : true,
                    message : 'Process terminated',
                }),
                300);
                break;

            // ── Screen (livescreen.json) ───────────────────────────────────
            case 'screenshot':
            case 'screen_stream':
                // Binary JPEG frames are handled separately by FrameCanvas.
                // For now only acknowledge that the stream has started.
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                ({
                    type     : 'stream_started',
                    agent_id,
                    module   : 'screen',
                }),
                400);
                break;

            case 'screen_stream_stop':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                ({
                    type     : 'stream_stopped',
                    agent_id,
                    module   : 'screen',
                }),
                300);
                break;

            // ── Keylog (keylog.json) ───────────────────────────────────────
            case 'keylog_start':
                this._replyPerAgent(msg.target_agents, (agent_id, i) =>
                {
                    const base = 400 + i * STAGGER_MS;

                    this._reply({ type: 'keylog_started', agent_id }, base);

                    // Send a small fake keystroke batch after the start is confirmed.
                    this._reply(
                    {
                        type     : 'keylog',
                        agent_id,
                        events   :
                        [
                            { key: 'H',   ctrl: false, alt: false, shift: true,  timestamp_ms: Date.now()       },
                            { key: 'e',   ctrl: false, alt: false, shift: false, timestamp_ms: Date.now() + 80  },
                            { key: 'l',   ctrl: false, alt: false, shift: false, timestamp_ms: Date.now() + 160 },
                            { key: 'l',   ctrl: false, alt: false, shift: false, timestamp_ms: Date.now() + 240 },
                            { key: 'o',   ctrl: false, alt: false, shift: false, timestamp_ms: Date.now() + 320 },
                            { key: 'Tab', ctrl: false, alt: true,  shift: false, timestamp_ms: Date.now() + 800 },
                        ],
                    },
                    base + 600);

                    return null;   // _replyPerAgent skips null returns
                },
                0);
                break;

            case 'keylog_stop':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                ({
                    type     : 'keylog_stopped',
                    agent_id,
                }),
                300);
                break;

            // ── File (file.json) ───────────────────────────────────────────
            case 'fs_list':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                ({
                    type    : 'fs_list_result',
                    agent_id,
                    path    : msg.params?.path ?? '/',
                    entries : FAKE_FS_ROOT,
                }),
                300);
                break;

            case 'fs_get':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                ({
                    type         : 'fs_get_result',
                    agent_id,
                    path         : msg.params?.path ?? '',
                    total_size   : 64,
                    chunk_index  : 0,
                    total_chunks : 1,
                    data_base64  : btoa('fake file content for: ' + msg.params?.path),
                }),
                400);
                break;

            case 'fs_put':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                ({
                    type        : 'fs_put_result',
                    agent_id,
                    path        : msg.params?.path ?? '',
                    chunk_index : msg.params?.chunk_index ?? 0,
                    success     : true,
                    message     : 'Chunk received',
                }),
                300);
                break;

            // ── Webcam (webcam.json) ───────────────────────────────────────
            case 'webcam_start':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                ({
                    type     : 'webcam_started',
                    agent_id,
                }),
                400);
                break;

            case 'webcam_stop':
                this._replyPerAgent(msg.target_agents, (agent_id) =>
                ({
                    type     : 'webcam_stopped',
                    agent_id,
                }),
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
