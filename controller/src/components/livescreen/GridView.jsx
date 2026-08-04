// GridView.jsx — overview grid of low-fps thumbnails for all online agents.
//
// STREAM LIFECYCLE:
// On mount, requests a 2 fps screen stream for every online agent so the
// grid tiles show live thumbnails without consuming excessive bandwidth.
// On unmount (user switches to focus mode or navigates away), all grid
// streams are stopped to free network and CPU resources.
//
// The stream commands go through useAgentSocket → MockSocket (or real Socket),
// which sends frame_meta + binary pairs. UseAgentSocket dispatches each
// completed frame into ModuleStore.data[agent_id].screen. Each AgentThumbnail
// subscribes to its own agent's screen.frame slice via a Zustand selector,
// so only the tile whose frame changed will re-render.

import { useEffect, useRef }  from 'react'
import { Inbox, Expand, Loader2 }      from 'lucide-react'
import useAgentStore           from '../../store/AgentStore'
import useUiStore              from '../../store/UiStore'
import useModuleStore          from '../../store/ModuleStore'
import useConnectionStore      from '../../store/ConnectionStore'
import useAgentSocket          from '../../hooks/UseAgentSocket'
import useE2EEStore            from '../../store/E2EEStore'
import { buildStreamStart, buildStreamStop } from '../../services/Protocol'
import FrameCanvas             from '../FrameCanvas'

// Low fps for grid thumbnails — saves bandwidth vs. 24 fps focus stream
const GRID_FPS     = 2
const GRID_QUALITY = 50

// One tile in the grid — clicking opens focus mode for that agent.
function AgentThumbnail({ agent })
{
    const setFocused    = useAgentStore((s) => s.setFocused)
    const setLayoutMode = useUiStore((s) => s.setLayoutMode)

    // Subscribe to ONLY this agent's screen frame buffer.
    // Other agents' frame updates will not cause this tile to re-render.
    const frame_buffer = useModuleStore((s) => s.data[agent.id]?.screen?.frame ?? null)
    const e2eeState = useE2EEStore(s => s.sessions[agent.id]?.state || 'uninitialized')

    function handleExpand()
    {
        setFocused(agent.id)
        setLayoutMode('focus')
    }

    const dot_class = agent.online
        ? 'status-dot status-dot--sm status-dot--online'
        : 'status-dot status-dot--sm status-dot--offline'

    return (
        <div className="agent-thumbnail" onClick={handleExpand}>
            {/* tile header — always dark to remain legible over the feed */}
            <div className="agent-thumbnail__header">
                <span
                    className={dot_class}
                    aria-hidden="true"
                />
                <span className="agent-thumbnail__name">{agent.name}</span>

                {agent.in_session && (
                    <span className="session-badge" aria-label="Session active">SESSION</span>
                )}

                <Expand size={12} strokeWidth={1.75} style={{ color: 'var(--text-feed)', flexShrink: 0 }} />
            </div>

            {/* feed area — FrameCanvas when frame data exists, placeholder otherwise */}
            <div className="agent-thumbnail__feed">
                {e2eeState !== 'ready'
                    ? (
                        <div className="agent-thumbnail__placeholder" style={{flexDirection: 'column', color: 'var(--brand)'}}>
                            <Loader2 size={24} className="spin" style={{marginBottom: '0.5rem'}} />
                            <span style={{color: 'var(--text-dim)', fontSize: '0.75rem'}}>E2EE Negotiating...</span>
                        </div>
                    )
                    : frame_buffer
                        ? <FrameCanvas frame_buffer={frame_buffer} width="100%" height="100%" />
                        : <span className="agent-thumbnail__placeholder">Waiting for stream…</span>}
            </div>
        </div>
    )
}

function GridView()
{
    const agents          = useAgentStore((s) => s.agents)
    const conn_status     = useConnectionStore((s) => s.status)
    const { sendCommand } = useAgentSocket()

    // Keep track of which agent IDs we started streams for,
    // so we can stop exactly those on unmount.
    const streaming_ids_ref = useRef([])

    const online_agents = agents.filter((a) => a.online)

    // Stable signature of the online agent id set — sorted + joined so the string
    // changes whenever the SET changes (not just the count). This catches the
    // simultaneous swap case where one agent goes offline and another comes
    // online in the same tick: length stays the same but the set is different.
    const online_ids_key = online_agents.map((a) => a.id).sort().join(',')

    // Start low-fps streams once the socket is connected and agents are known.
    // Depends on conn_status so the effect waits until the socket is actually
    // open before sending any commands (the socket has a 300 ms connect delay).
    // Also re-runs when the online agent SET changes (via online_ids_key).
    // On unmount (user leaves grid view), cleanup stops all streams.
    useEffect(function ()
    {
        if (conn_status !== 'open') return
        if (online_ids_key === '') return

        const online_ids = online_ids_key.split(',')

        sendCommand(buildStreamStart(GRID_FPS, GRID_QUALITY, online_ids))
        streaming_ids_ref.current = online_ids

        // Cleanup: stop every stream we started when leaving the grid view
        // or when the online agent set changes. This prevents frames from
        // being sent after the component unmounts, which would waste
        // bandwidth and leave orphaned intervals in MockSocket.
        return function ()
        {
            if (streaming_ids_ref.current.length > 0)
            {
                sendCommand(buildStreamStop(streaming_ids_ref.current))
                streaming_ids_ref.current = []
            }
        }
    }, [conn_status, online_ids_key])

    return (
        <div className="grid-view">
            <p className="grid-view__subtitle">
                Quick overview of all online Agents. Click a tile to open Focus mode.
            </p>

            {online_agents.length === 0
                ? (
                    <div className="grid-view__empty">
                        <Inbox size={36} strokeWidth={1.5} />
                        <span>No agents online</span>
                    </div>
                )
                : (
                    <div className="grid-view__grid">
                        {online_agents.map(function (agent)
                        {
                            return <AgentThumbnail key={agent.id} agent={agent} />
                        })}
                    </div>
                )
            }
        </div>
    )
}

export default GridView
