// PolicyStore.js — the security policy the Controller pushes to every Agent.
//
// Single source of truth for the app whitelist + sandbox path. The Controller
// sends this on connect (policy_update); the Agent overrides its local config
// in RAM and replies policy_update_result. Module tabs read the whitelist and
// sandbox path from HERE instead of hard-coding them, per project rules.
// Format: docs/formatjson/PolicyUpdate.json.
import { create } from 'zustand'

// Default policy the Controller ships with. Covers the common apps across the
// Windows / Linux / macOS agents so allowed apps can be Started / Stopped.
// Apps NOT listed here are still shown but their Start/Stop buttons stay
// disabled (e.g. "mspaint" is intentionally omitted to show a blocked case).
const DEFAULT_APP_WHITELIST =
[
    'notepad', 'calc', 'chrome', 'vlc',        // Windows
    'firefox', 'code', 'terminal', 'gedit',    // Linux
    'safari', 'textedit',                      // macOS
]

// Sandbox root that file operations are confined to on the Agent side.
const DEFAULT_SANDBOX_PATH = 'C:\\AgentSandbox\\'

const usePolicyStore = create(function (set)
{
    return {
        app_whitelist : DEFAULT_APP_WHITELIST,   // app short-names allowed to Start/Stop
        sandbox_path  : DEFAULT_SANDBOX_PATH,     // Agent sandbox root pushed in the policy
        results       : {},                       // { [agent_id]: { success, message } }

        // Replace the whitelist (e.g. from a future admin UI).
        setWhitelist: (list) => set({ app_whitelist: list }),

        // Replace the sandbox path.
        setSandboxPath: (path) => set({ sandbox_path: path }),

        // Record one agent's policy_update_result so the UI can show it.
        setPolicyResult: (agent_id, result) =>
            set(function (s)
            {
                return { results: { ...s.results, [agent_id]: result } }
            }),
    }
})

export default usePolicyStore
