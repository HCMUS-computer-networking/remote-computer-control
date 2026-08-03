// ModuleStore.js — per-agent, per-module data received from the Gateway.
// Shape: data[agent_id][module] — each module key holds its own data type.
import { create } from 'zustand'

// Hard limit on buffered keylog events to prevent unbounded memory growth.
const MAX_KEYLOG_EVENTS = 1000

// Number of sysinfo samples kept for the sparkline history (2s poll → ~2 min).
const MAX_SYSINFO_HISTORY = 60

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
        webcam_active : false,                      // true after Agent confirmed webcam_started (consent granted)
        screen_stream_active : false,               // true while Agent is streaming its screen (Livescreen)
        // file.tree caches directory listings keyed by path (sandbox only).
        // file_downloads is a map keyed by transfer_id — each entry accumulates
        //   raw chunk bytes (Uint8Array[]) so FileTab can render a progress bar
        //   per job and assemble a Blob when all chunks have arrived. Kept as a
        //   map (not a single slot) so bursts of chunks can never overwrite one
        //   another before React consumes them.
        // file_put_ack holds the latest fs_put_result / fs_put_complete so FileTab
        //   can advance the progress bar after each acknowledged chunk.
        file           : { tree: {}, path: '/' },
        file_downloads : {},
        file_put_ack   : null,
        // Latest sysinfo snapshot + a rolling history of samples for the sparkline.
        // Each history point: { t, cpu_percent, ram_percent, disk_percent }
        sysinfo         : null,
        sysinfo_history : [],
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

        // Set the screen-stream active flag for one agent (true = Agent is sending frames).
        // Drives the red transparency indicator on AgentCard / TopBar.
        setScreenStreamActive: (agent_id, active) =>
            set(function (s)
            {
                const agent_data = s.data[agent_id] ?? createAgentModuleState()
                return {
                    data: {
                        ...s.data,
                        [agent_id]: { ...agent_data, screen_stream_active: active },
                    },
                }
            }),

        // Set the webcam active flag for one agent (true = Agent granted consent + is streaming).
        // Drives the visible consent indicator in WebcamTab.
        setWebcamActive: (agent_id, active) =>
            set(function (s)
            {
                const agent_data = s.data[agent_id] ?? createAgentModuleState()
                return {
                    data: {
                        ...s.data,
                        [agent_id]: { ...agent_data, webcam_active: active },
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

        // Append one raw chunk (Uint8Array) into the download job keyed by
        // transfer_id. Creates the job on the first chunk. This preserves every
        // chunk even when the Gateway bursts them faster than React can render.
        // chunk_info = { transfer_id, chunk_index, total_chunks, path, total_size, bytes }
        appendFileDownloadChunk: (agent_id, chunk_info) =>
            set(function (s)
            {
                // Bounds guard: a buggy Agent or mis-paired binary frame could
                // hand us an out-of-range chunk_index. Writing past the array
                // would grow it silently and every() would never return true,
                // leaving the job stuck. Drop the chunk with a warning instead.
                const total  = chunk_info.total_chunks
                const index  = chunk_info.chunk_index
                if (!Number.isInteger(total) || total < 1
                    || !Number.isInteger(index) || index < 0 || index >= total)
                {
                    console.warn(
                        `[ModuleStore] appendFileDownloadChunk: out-of-range chunk ${index}/${total} ` +
                        `for transfer_id=${chunk_info.transfer_id} — dropped`
                    )
                    return s   // no state change
                }

                const agent_data = s.data[agent_id] ?? createAgentModuleState()
                const jobs       = agent_data.file_downloads ?? {}
                const prev_job   = jobs[chunk_info.transfer_id]
                const chunks     = prev_job
                    ? prev_job.chunks.slice()
                    : new Array(total).fill(null)

                // Skip duplicates: if this chunk slot is already filled, keep the
                // received count intact instead of double-counting.
                const is_new     = chunks[index] == null
                chunks[index] = chunk_info.bytes

                const next_job =
                {
                    transfer_id     : chunk_info.transfer_id,
                    path            : chunk_info.path,
                    total_size      : chunk_info.total_size,
                    total_chunks    : chunk_info.total_chunks,
                    received_chunks : (prev_job?.received_chunks ?? 0) + (is_new ? 1 : 0),
                    chunks,
                    _seq            : Date.now(),
                }

                return {
                    data: {
                        ...s.data,
                        [agent_id]:
                        {
                            ...agent_data,
                            file_downloads: { ...jobs, [chunk_info.transfer_id]: next_job },
                        },
                    },
                }
            }),

        // Remove one download job (called after the Blob has been assembled +
        // handed to the browser, or when the user cancels).
        removeFileDownload: (agent_id, transfer_id) =>
            set(function (s)
            {
                const agent_data = s.data[agent_id] ?? createAgentModuleState()
                const next_jobs  = { ...(agent_data.file_downloads ?? {}) }
                delete next_jobs[transfer_id]
                return {
                    data: {
                        ...s.data,
                        [agent_id]: { ...agent_data, file_downloads: next_jobs },
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

// Store the newest sysinfo snapshot and append a compact percent-only
        // sample to the rolling history (trimmed to MAX_SYSINFO_HISTORY).
        // The history keeps only percentages so the line charts have a single
        // y-axis domain (0..100) shared across CPU / RAM / Disk.
        appendSysInfo: (agent_id, snapshot) =>
            set(function (s)
            {
                const agent_data   = s.data[agent_id] ?? createAgentModuleState()
                const ram_percent  = snapshot.ram_total_mb  > 0
                    ? (snapshot.ram_used_mb  / snapshot.ram_total_mb)  * 100
                    : 0
                const disk_percent = snapshot.disk_total_gb > 0
                    ? (snapshot.disk_used_gb / snapshot.disk_total_gb) * 100
                    : 0
                const sample = {
                    t            : snapshot.timestamp_ms ?? Date.now(),
                    cpu_percent  : snapshot.cpu_percent ?? 0,
                    ram_percent,
                    disk_percent,
                }
                const merged  = [...agent_data.sysinfo_history, sample]
                const trimmed = merged.slice(-MAX_SYSINFO_HISTORY)
                return {
                    data: {
                        ...s.data,
                        [agent_id]:
                        {
                            ...agent_data,
                            sysinfo         : snapshot,
                            sysinfo_history : trimmed,
                        },
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
