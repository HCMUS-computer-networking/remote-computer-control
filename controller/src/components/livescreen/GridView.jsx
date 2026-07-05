/* GridView.jsx — overview grid of low-fps thumbnails for all online agents */
import { Inbox, Expand } from 'lucide-react'
import useAgentStore  from '../../store/AgentStore'
import useUiStore     from '../../store/UiStore'
import useModuleStore from '../../store/ModuleStore'
import FrameCanvas    from './FrameCanvas'

/* one tile in the grid — clicking opens focus mode for that agent */
function AgentThumbnail({ agent })
{
  const setFocused    = useAgentStore((s) => s.setFocused)
  const setLayoutMode = useUiStore((s) => s.setLayoutMode)
  // subscribe to only this agent's screen frame so other agents' updates don't re-render this tile
  const frame_buffer  = useModuleStore((s) => s.data[agent.id]?.screen?.frame ?? null)

  function handleExpand()
  {
    setFocused(agent.id)
    setLayoutMode('focus')
  }

  const dot_color = agent.online ? 'var(--success)' : 'var(--gray-400)'

  return (
    <div className="agent-thumbnail" onClick={handleExpand}>
      {/* tile header — always dark to remain legible over the feed */}
      <div className="agent-thumbnail__header">
        <span
          className="status-dot status-dot--sm"
          style={{ background: dot_color }}
          aria-hidden="true"
        />
        <span className="agent-thumbnail__name">{agent.name}</span>

        {agent.in_session && (
          <span className="session-badge" aria-label="Session active">SESSION</span>
        )}

        <Expand size={12} strokeWidth={1.75} style={{ color: 'var(--text-feed)', flexShrink: 0 }} />
      </div>

      {/* feed area — shows live frame if available, placeholder otherwise */}
      <div className="agent-thumbnail__feed">
        {frame_buffer
          ? <FrameCanvas frame_buffer={frame_buffer} width="100%" height="100%" />
          : <span className="agent-thumbnail__placeholder">[ LIVE THUMBNAIL — low fps ]</span>}
      </div>
    </div>
  )
}

function GridView()
{
  const { agents } = useAgentStore()

  /* only show online agents in the grid */
  const online_agents = agents.filter((a) => a.online)

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
