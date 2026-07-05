/* Sidebar.jsx — left panel: logo, agent search, agent list, gateway status */
import { Search }         from 'lucide-react'
import useAgentStore      from '../../store/AgentStore'
import useConnectionStore from '../../store/ConnectionStore'
import useUiStore         from '../../store/UiStore'
import AgentList          from '../agents/AgentList'

function GatewayStatus({ status })
{
  /* pick dot colour based on connection state */
  const dot_style =
    status === 'open'
      ? { background: 'var(--success)' }
      : status === 'connecting'
      ? { background: 'var(--warning)' }
      : { background: 'var(--danger)' }   // 'idle' or 'closed'

  const label =
    status === 'open'       ? 'Gateway: Connected'   :
    status === 'connecting' ? 'Gateway: Connecting…' :
                              'Gateway: Disconnected'

  return (
    <footer className="sidebar__footer">
      <span className="status-dot" style={dot_style} aria-hidden="true" />
      <span className="sidebar__footer-text">{label}</span>
    </footer>
  )
}

function Sidebar()
{
  const { search_query, setSearchQuery } = useAgentStore()
  const { status }                       = useConnectionStore()
  const { sidebar_open }                 = useUiStore()

  return (
    <aside className={`sidebar${sidebar_open ? '' : ''}`} aria-label="Agent list">
      {/* logo and section label */}
      <div className="sidebar__header">
        <div className="sidebar__logo">CONTROLLER</div>
        <div className="sidebar__label">Agents</div>
      </div>

      {/* agent search */}
      <div className="sidebar__search-wrap">
        <input
          className="sidebar__search-input"
          type="search"
          placeholder="Search agent..."
          value={search_query}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search agents by name or IP"
        />
      </div>

      {/* scrollable agent list */}
      <div className="sidebar__agent-list">
        <AgentList />
      </div>

      <GatewayStatus status={status} />
    </aside>
  )
}

export default Sidebar
