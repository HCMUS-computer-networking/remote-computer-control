/* PermissionGate — shared consent wrapper for every module tab (Plan B).

   The Controller must obtain Agent consent for a feature BEFORE any module
   command may run. This gate shows Connect (permission_request) and Disconnect
   (permission_revoke + stop_module) controls and keeps the wrapped module
   command buttons DISABLED until the feature is 'granted'. It talks only to the
   PermissionStore (state) and useAgentSocket (transport) — never the socket. */
import { ShieldCheck, ShieldAlert, Plug, PlugZap, Loader } from 'lucide-react'

import usePermissionStore from '../store/PermissionStore'
import useAgentSocket     from '../hooks/UseAgentSocket'

// Map a status string to the short label shown next to the Connect button.
function statusLabel(status)
{
    if (status === 'requesting') return 'Chờ cấp quyền...'   // waiting for Agent reply
    if (status === 'granted')    return 'Đã cấp quyền'        // consent granted
    if (status === 'denied')     return 'Bị từ chối'          // consent denied
    return 'Chưa kết nối'                                     // idle — no request yet
}

function PermissionGate({ feature, agent_id, disabled, children })
{
    const { requestPermission, revokePermission, stopModule } = useAgentSocket()

    // Subscribe to just this (agent, feature) status — no re-render for others.
    const status = usePermissionStore((s) => s.permissions[agent_id]?.[feature] ?? 'idle')

    const is_granted    = status === 'granted'
    const is_requesting = status === 'requesting'

    // Connect = ask the Agent for consent (triggers its popup).
    function handleConnect()
    {
        requestPermission(feature, agent_id)
    }

    // Disconnect = revoke the grant AND tell the Agent to stop the feature.
    function handleDisconnect()
    {
        revokePermission(feature, agent_id)
        stopModule(feature, agent_id)
    }

    return (
        <div className="permission-gate">

            {/* ── consent bar ──────────────────────────────────────────── */}
            <div className="permission-gate__bar">

                <span className={`permission-gate__badge permission-gate__badge--${status}`}>
                    {is_granted
                        ? <ShieldCheck size={14} />
                        : <ShieldAlert size={14} />}
                    <span className="permission-gate__feature">{feature}</span>
                    <span className="permission-gate__status">{statusLabel(status)}</span>
                </span>

                <div className="permission-gate__actions">
                    {!is_granted
                        ? (
                            <button
                                className="action-btn action-btn--start"
                                onClick={handleConnect}
                                disabled={disabled || is_requesting}
                                title="Xin quyền truy cập tính năng này"
                            >
                                {is_requesting
                                    ? <Loader size={12} className="permission-gate__spin" />
                                    : <Plug size={12} />}
                                Connect
                            </button>
                        )
                        : (
                            <button
                                className="action-btn action-btn--stop"
                                onClick={handleDisconnect}
                                title="Thu hồi quyền và dừng tính năng"
                            >
                                <PlugZap size={12} /> Disconnect
                            </button>
                        )
                    }
                </div>

            </div>

            {/* ── module command area — disabled until granted ─────────────
                A <fieldset disabled> cascades to every button / input inside,
                so module tabs need no extra wiring to respect the gate. */}
            <fieldset className="permission-gate__body" disabled={!is_granted}>
                {children}
            </fieldset>

        </div>
    )
}

export default PermissionGate
