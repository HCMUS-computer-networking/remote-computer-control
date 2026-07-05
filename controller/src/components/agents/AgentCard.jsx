/* AgentCard.jsx — single agent row in the sidebar list */
import useAgentStore from '../../store/AgentStore'
import useUiStore    from '../../store/UiStore'

/*
  Props:
    agent — { id, name, os, ip, online, in_session }
*/
function AgentCard({ agent })
{
  const { selected_agent_id, setSelectedAgent } = useAgentStore()
  const { setViewMode }                         = useUiStore()

  const is_active   = selected_agent_id === agent.id
  const dot_class   = agent.online ? 'status-dot status-dot--online' : 'status-dot status-dot--offline'
  const card_class  = `agent-card${is_active ? ' agent-card--active' : ''}`

  function handleClick()
  {
    setSelectedAgent(agent.id)
    setViewMode('focus')  // clicking an agent switches to focus mode
  }

  return (
    <div
      className={card_class}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      aria-pressed={is_active}
      aria-label={`Agent ${agent.name}, ${agent.online ? 'online' : 'offline'}`}
    >
      <div className="agent-card__row">
        {/* online / offline indicator dot */}
        <span className={dot_class} aria-hidden="true" />

        <span className="agent-card__name">{agent.name}</span>

        {/* session badge only when agent is currently being controlled */}
        {agent.in_session && (
          <span className="session-badge" aria-label="Session active">SESSION</span>
        )}
      </div>

      {/* OS and IP — secondary info line */}
      <div className="agent-card__info">
        {agent.os} &mdash; {agent.ip}
      </div>
    </div>
  )
}

export default AgentCard
