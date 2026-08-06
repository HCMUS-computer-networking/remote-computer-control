// KeylogGrid.jsx — keylog status for every connected agent; Start/Stop act on the
// SELECTED agents. Each selected-but-not-granted agent gets its own consent popup.

import { Play, Square, Circle } from 'lucide-react'

import useAgentStore   from '../../store/AgentStore'
import useModuleStore  from '../../store/ModuleStore'
import useAgentSocket  from '../../hooks/UseAgentSocket'
import useBatchGuardedSend from '../../hooks/useBatchGuardedSend'
import { buildKeylogStart, buildKeylogStop, FEATURE } from '../../services/Protocol'
import usePermissionStore from '../../store/PermissionStore'
import ModuleGridShell from './ModuleGridShell'

const EMPTY_EVENTS = []

// Compact preview: last few keystrokes joined, printable chars only.
function previewKeys(events)
{
    if (events.length === 0) return ''
    return events.slice(-24).map((e) => (e.key && e.key.length === 1 ? e.key : `⟨${e.key}⟩`)).join('')
}

function KeylogTile({ agent })
{
    const events    = useModuleStore((s) => s.data[agent.id]?.keylog        ?? EMPTY_EVENTS)
    const is_active = useModuleStore((s) => s.data[agent.id]?.keylog_active ?? false)
    const status    = usePermissionStore((s) => s.permissions[agent.id]?.[FEATURE.KEYLOG] ?? 'idle')

    if (status !== 'granted' && !is_active)
    {
        return <div className="mg-tile__nogrant">Not authorized</div>
    }

    return (
        <div className="mg-keylog">
            <span className={`mg-badge${is_active ? ' mg-badge--live' : ''}`}>
                <Circle size={7} fill="currentColor" /> {is_active ? 'LIVE' : 'IDLE'}
            </span>
            <div className="mg-keylog__preview">{previewKeys(events) || '—'}</div>
            <div className="mg-keylog__count">{events.length} keys</div>
        </div>
    )
}

function KeylogGrid()
{
    const { sendCommand } = useAgentSocket()
    const batchSend       = useBatchGuardedSend()
    const agents          = useAgentStore((s) => s.agents)
    const selected_ids    = useAgentStore((s) => s.selected_agent_ids)

    const targets = selected_ids.filter((id) => agents.some((a) => a.id === id && a.online))
    const disabled = targets.length === 0

    function handleStart()
    {
        batchSend(FEATURE.KEYLOG, targets, (id) => buildKeylogStart([id]))
    }

    function handleStop()
    {
        // Stop is not consent-gated fresh — sendCommand drops any agent that has
        // not granted, so looping the selected set is safe.
        for (const id of targets) sendCommand(buildKeylogStop([id]))
    }

    const toolbar = (
        <>
            <button className="action-btn action-btn--start" onClick={handleStart} disabled={disabled}
                title={disabled ? 'Select agents to control' : 'Start keylog on selected agents'}>
                <Play size={12} /> Start ({targets.length})
            </button>
            <button className="action-btn action-btn--stop" onClick={handleStop} disabled={disabled}
                title={disabled ? 'Select agents to control' : 'Stop keylog on selected agents'}>
                <Square size={12} /> Stop
            </button>
        </>
    )

    return (
        <ModuleGridShell
            title="Keylog — all agents"
            hint="Actions apply to selected agents · each agent shows its own consent popup"
            toolbar={toolbar}
            renderTile={(agent) => <KeylogTile agent={agent} />}
        />
    )
}

export default KeylogGrid
