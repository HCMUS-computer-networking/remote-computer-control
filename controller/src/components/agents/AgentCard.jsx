// AgentCard.jsx — one agent row in the sidebar list.
// Left checkbox: toggles multi-select. Clicking the card body: opens focus view.
import useAgentStore from '../../store/AgentStore'
import useUiStore    from '../../store/UiStore'
import useModuleStore from '../../store/ModuleStore'

/*
  Props:
    agent — { id, name, os, ip, online, in_session }
*/
function AgentCard({ agent })
{
    // subscribe to only the slice that affects THIS card to avoid re-rendering all cards on every selection change
    const is_focused   = useAgentStore((s) => s.focused_agent_id === agent.id)
    const is_selected  = useAgentStore((s) => s.selected_agent_ids.includes(agent.id))
    const setFocused   = useAgentStore((s) => s.setFocused)
    const toggleSelect = useAgentStore((s) => s.toggleSelect)
    const setLayoutMode = useUiStore((s) => s.setLayoutMode)

    // Transparency red-dot — visible whenever any sensitive module is active on
    // this agent, OR the agent is being remotely controlled (in_session).
    // Sensitive modules: Live Screen stream, Webcam feed, Input Activity (keylog).
    // The dot must ALWAYS reflect reality — never hide it behind a toggle.
    const screen_active = useModuleStore((s) => s.data[agent.id]?.screen_stream_active ?? false)
    const webcam_active = useModuleStore((s) => s.data[agent.id]?.webcam_active        ?? false)
    const keylog_active = useModuleStore((s) => s.data[agent.id]?.keylog_active        ?? false)
    const sensitive_on  = screen_active || webcam_active || keylog_active || agent.in_session
    const dot_class    = agent.online
        ? 'status-dot status-dot--online'
        : 'status-dot status-dot--offline'

    let card_class = 'agent-card'
    if (is_focused)  card_class += ' agent-card--active'
    if (is_selected) card_class += ' agent-card--selected'

    function handleCardClick()
    {
        setFocused(agent.id)
        setLayoutMode('focus')
    }

    function handleCheckboxChange(e)
    {
        e.stopPropagation()   // prevent handleCardClick from firing
        toggleSelect(agent.id)
    }

    return (
        <div
            className={card_class}
            onClick={handleCardClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && handleCardClick()}
            aria-pressed={is_focused}
            aria-label={`Agent ${agent.name}, ${agent.online ? 'online' : 'offline'}`}
        >
            <div className="agent-card__row">
                {/* status dot */}
                <span className={dot_class} aria-hidden="true" />

                {/* Red transparency dot — one glance tells the operator this
                    agent is currently under a sensitive activity (screen /
                    webcam / keylog / in_session). Placed next to the online
                    dot on purpose so it can never be missed. */}
                {sensitive_on && (
                    <span
                        aria-label="Sensitive module active"
                        title="Sensitive module active on this agent (screen, webcam, keylog, or session)"
                        style={{
                            display: 'inline-block',
                            width: 8, height: 8, borderRadius: '50%',
                            background: '#e53935',
                            boxShadow: '0 0 6px 2px rgba(229,57,53,0.55)',
                            animation: 'keylog-pulse 1.4s ease-in-out infinite',
                        }}
                    />
                )}

                {/* agent name — takes remaining space */}
                <span className="agent-card__name">{agent.name}</span>

                {/* session badge — only when actively controlled */}
                {agent.in_session && (
                    <span className="session-badge" aria-label="Session active">SESSION</span>
                )}

                {/* multi-select checkbox — placed at the far right */}
                <input
                    type="checkbox"
                    className="agent-card__checkbox"
                    checked={is_selected}
                    onChange={handleCheckboxChange}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${agent.name}`}
                    tabIndex={-1}   // card itself is the tab stop; checkbox reachable by click
                />
            </div>

            {/* OS and IP — secondary info line */}
            <div className="agent-card__info">
                {agent.os} &mdash; {agent.ip}
            </div>
        </div>
    )
}

export default AgentCard
