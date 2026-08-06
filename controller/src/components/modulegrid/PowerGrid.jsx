// PowerGrid.jsx — power actions for every connected agent; Lock/Restart/Shutdown/
// Sleep act on the SELECTED agents. Destructive actions show ONE 10 s countdown
// before firing; consent is requested per agent via batchSend.

import { useState, useEffect, useRef } from 'react'
import { Lock, RotateCcw, Power, Moon, X, ShieldCheck, ShieldAlert } from 'lucide-react'

import useAgentStore   from '../../store/AgentStore'
import usePermissionStore from '../../store/PermissionStore'
import useUiStore      from '../../store/UiStore'
import useBatchGuardedSend from '../../hooks/useBatchGuardedSend'
import { buildPower, POWER_ACTION, FEATURE } from '../../services/Protocol'
import ModuleGridShell from './ModuleGridShell'

const COUNTDOWN_SECONDS = 10

// Shared countdown for restart / shutdown / sleep on the whole selected set.
function CountdownModal({ label, count, onCancel })
{
    return (
        <div className="power-modal__overlay" role="dialog" aria-modal="true" onClick={onCancel}>
            <div className="power-modal__card" onClick={(e) => e.stopPropagation()}>
                <div className="power-modal__title">Confirm {label}</div>
                <div className="power-modal__msg">
                    About to <strong>{label.toLowerCase()}</strong> the selected agents. Click Cancel to stop.
                </div>
                <div className={`power-modal__count${count <= 3 ? ' power-modal__count--urgent' : ''}`}>{count}s</div>
                <div className="power-modal__actions">
                    <button className="screen-tab__btn screen-tab__btn--secondary" onClick={onCancel} autoFocus>
                        <X size={14} strokeWidth={2} /> Cancel
                    </button>
                </div>
            </div>
        </div>
    )
}

function PowerTile({ agent })
{
    const status = usePermissionStore((s) => s.permissions[agent.id]?.[FEATURE.POWER] ?? 'idle')
    const granted = status === 'granted'
    return (
        <div className="mg-power">
            <span className={`mg-badge${granted ? ' mg-badge--ok' : ''}`}>
                {granted ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                {granted ? 'Authorized' : 'Not authorized'}
            </span>
            <div className="mg-power__meta">{agent.os || '—'}</div>
        </div>
    )
}

function PowerGrid()
{
    const batchSend    = useBatchGuardedSend()
    const addToast     = useUiStore((s) => s.addToast)
    const agents       = useAgentStore((s) => s.agents)
    const selected_ids = useAgentStore((s) => s.selected_agent_ids)

    const targets = selected_ids.filter((id) => agents.some((a) => a.id === id && a.online))
    const disabled = targets.length === 0

    // { action, label } while a countdown modal is open; null otherwise.
    const [pending, setPending] = useState(null)
    const [count, setCount]     = useState(COUNTDOWN_SECONDS)
    const targets_ref = useRef([])   // snapshot the selection when the countdown starts

    // Drive the countdown; on reaching 0 fire the batch action for the snapshot.
    useEffect(function ()
    {
        if (!pending) return
        setCount(COUNTDOWN_SECONDS)
        const timer = setInterval(function ()
        {
            setCount(function (prev)
            {
                if (prev <= 1)
                {
                    clearInterval(timer)
                    const action = pending.action
                    batchSend(FEATURE.POWER, targets_ref.current, (id) => buildPower(action, [id]))
                    setPending(null)
                    return 0
                }
                return prev - 1
            })
        }, 1000)
        return () => clearInterval(timer)
    }, [pending, batchSend])

    function handleLock()
    {
        batchSend(FEATURE.POWER, targets, (id) => buildPower(POWER_ACTION.LOCK, [id]))
    }

    function askConfirm(action, label)
    {
        targets_ref.current = targets      // freeze the selected set for this action
        setPending({ action, label })
    }

    function handleCancel()
    {
        if (pending) addToast(`${pending.label} cancelled`, 'info')
        setPending(null)
    }

    const toolbar = (
        <>
            <button className="screen-tab__btn screen-tab__btn--secondary" onClick={handleLock} disabled={disabled}
                title={disabled ? 'Select agents to control' : 'Lock selected agents'}>
                <Lock size={14} strokeWidth={2} /> Lock ({targets.length})
            </button>
            <button className="screen-tab__btn screen-tab__btn--primary" onClick={() => askConfirm(POWER_ACTION.RESTART, 'Restart')} disabled={disabled}
                title={disabled ? 'Select agents to control' : 'Restart selected agents'}>
                <RotateCcw size={14} strokeWidth={2} /> Restart
            </button>
            <button className="screen-tab__btn screen-tab__btn--danger" onClick={() => askConfirm(POWER_ACTION.SHUTDOWN, 'Shutdown')} disabled={disabled}
                title={disabled ? 'Select agents to control' : 'Shut down selected agents'}>
                <Power size={14} strokeWidth={2} /> Shutdown
            </button>
            <button className="screen-tab__btn screen-tab__btn--secondary" onClick={() => askConfirm(POWER_ACTION.SLEEP, 'Sleep')} disabled={disabled}
                title={disabled ? 'Select agents to control' : 'Put selected agents to sleep'}>
                <Moon size={14} strokeWidth={2} /> Sleep
            </button>
        </>
    )

    return (
        <>
            <ModuleGridShell
                title="Power — all agents"
                hint="Lock/Restart/Shutdown/Sleep apply to selected agents · each agent confirms consent"
                toolbar={toolbar}
                renderTile={(agent) => <PowerTile agent={agent} />}
            />
            {pending && (
                <CountdownModal label={pending.label} count={count} onCancel={handleCancel} />
            )}
        </>
    )
}

export default PowerGrid
