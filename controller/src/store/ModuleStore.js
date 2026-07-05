// ModuleStore.js — per-agent, per-module data received from the Gateway.
// Shape: data[agent_id][module] — each module key holds its own data type.
import { create } from 'zustand'

// Hard limit on buffered keylog events to prevent unbounded memory growth.
const MAX_KEYLOG_EVENTS = 500

// Return the default empty state for one agent's module slots.
function createAgentModuleState()
{
    return {
        app     : [],                         // app_list_result: array of app objects
        process : [],                         // proc_list_result: array of process objects
        keylog  : [],                         // accumulated keystroke event objects
        screen  : { frame: null, meta: null },// latest screen JPEG (ArrayBuffer) + frame_meta
        webcam  : { frame: null, meta: null },// latest webcam JPEG (ArrayBuffer) + frame_meta
        file    : { entries: [], path: '' },  // fs_list_result: folder contents + current path
    }
}

const useModuleStore = create(function (set)
{
    return {
        data: {},

        // Write (or merge) a payload into one agent + module slot.
        // Creates the agent entry if it does not exist yet.
        setModuleData: (agent_id, module, payload) =>
            set(function (s)
            {
                const agent_data = s.data[agent_id] ?? createAgentModuleState()
                return {
                    data: {
                        ...s.data,
                        [agent_id]:
                        {
                            ...agent_data,
                            [module]: payload,
                        },
                    },
                }
            }),

        // Append incoming keylog events to the buffer instead of replacing it.
        // Old entries are trimmed when the buffer exceeds MAX_KEYLOG_EVENTS.
        appendKeylog: (agent_id, events) =>
            set(function (s)
            {
                const agent_data   = s.data[agent_id] ?? createAgentModuleState()
                const merged       = [...agent_data.keylog, ...events]
                const trimmed      = merged.slice(-MAX_KEYLOG_EVENTS)
                return {
                    data: {
                        ...s.data,
                        [agent_id]: { ...agent_data, keylog: trimmed },
                    },
                }
            }),

        // Reset one module slot back to its default empty value.
        clearModule: (agent_id, module) =>
            set(function (s)
            {
                const agent_data    = { ...(s.data[agent_id] ?? createAgentModuleState()) }
                const default_state = createAgentModuleState()
                agent_data[module]  = default_state[module] ?? null
                return { data: { ...s.data, [agent_id]: agent_data } }
            }),

        // Remove all module data for an agent (called when an agent disconnects).
        clearAgent: (agent_id) =>
            set(function (s)
            {
                const next = { ...s.data }
                delete next[agent_id]
                return { data: next }
            }),
    }
})

export default useModuleStore
