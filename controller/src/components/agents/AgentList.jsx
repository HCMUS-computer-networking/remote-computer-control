/* AgentList.jsx — renders filtered agent cards inside the sidebar */
import { Inbox } from 'lucide-react'
import useAgentStore from '../../store/AgentStore'
import AgentCard     from './AgentCard'

function AgentList()
{
  const { getFilteredAgents } = useAgentStore()
  const filtered_agents       = getFilteredAgents()

  if (filtered_agents.length === 0)
  {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px 0', color: 'var(--text-muted)' }}>
        <Inbox size={28} strokeWidth={1.5} />
        <span style={{ fontSize: 11 }}>No agents found</span>
      </div>
    )
  }

  return (
    <div>
      {filtered_agents.map(function (agent)
      {
        return <AgentCard key={agent.id} agent={agent} />
      })}
    </div>
  )
}

export default AgentList
