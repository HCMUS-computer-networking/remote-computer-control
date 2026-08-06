// ModuleGridShell.jsx — shared frame for every per-module multi-agent grid.
//
// LAYOUT CONTRACT (agreed with the user):
//   - The grid ALWAYS shows one tile per CONNECTED (online) agent.
//   - The toolbar's batch actions act ONLY on the SELECTED agents
//     (selected_agent_ids). Selected tiles are highlighted so the operator can
//     see exactly what a batch action will hit.
//   - Clicking a tile toggles its selection (mirrors the sidebar checkbox).
//
// Each concrete grid (SysInfoGrid, KeylogGrid, …) supplies:
//   - title      — heading text
//   - toolbar    — ReactNode with the batch buttons (reads selection itself)
//   - renderTile — (agent) => ReactNode drawn inside each tile body
//   - hint       — optional one-line helper under the toolbar

import { Inbox } from 'lucide-react'
import useAgentStore from '../../store/AgentStore'

// One tile: header (status dot + name + select checkbox) + body from renderTile.
function GridTile({ agent, is_selected, onToggle, children })
{
    const dot_class = agent.online
        ? 'status-dot status-dot--sm status-dot--online'
        : 'status-dot status-dot--sm status-dot--offline'

    return (
        <div
            className={`mg-tile${is_selected ? ' mg-tile--selected' : ''}`}
            onClick={() => onToggle(agent.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle(agent.id)}
            aria-pressed={is_selected}
        >
            <div className="mg-tile__header">
                <span className={dot_class} aria-hidden="true" />
                <span className="mg-tile__name">{agent.name}</span>
                <input
                    type="checkbox"
                    className="mg-tile__checkbox"
                    checked={is_selected}
                    onChange={() => onToggle(agent.id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${agent.name}`}
                    tabIndex={-1}
                />
            </div>
            <div className="mg-tile__body">{children}</div>
        </div>
    )
}

function ModuleGridShell({ title, toolbar, hint, renderTile })
{
    const agents             = useAgentStore((s) => s.agents)
    const selected_agent_ids = useAgentStore((s) => s.selected_agent_ids)
    const toggleSelect       = useAgentStore((s) => s.toggleSelect)

    const online_agents = agents.filter((a) => a.online)

    return (
        <div className="module-grid">
            <div className="module-grid__bar">
                <span className="module-grid__title">{title}</span>
                <div className="module-grid__toolbar">{toolbar}</div>
            </div>

            {hint && <div className="module-grid__hint">{hint}</div>}

            {online_agents.length === 0
                ? (
                    <div className="module-grid__empty">
                        <Inbox size={36} strokeWidth={1.5} />
                        <span>No agents online</span>
                    </div>
                )
                : (
                    <div className="module-grid__tiles">
                        {online_agents.map(function (agent)
                        {
                            return (
                                <GridTile
                                    key={agent.id}
                                    agent={agent}
                                    is_selected={selected_agent_ids.includes(agent.id)}
                                    onToggle={toggleSelect}
                                >
                                    {renderTile(agent)}
                                </GridTile>
                            )
                        })}
                    </div>
                )
            }
        </div>
    )
}

export default ModuleGridShell
