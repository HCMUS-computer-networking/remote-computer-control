// AgentList.jsx — renders the MultiSelect toolbar followed by filtered agent cards.
import { Inbox }     from 'lucide-react'
import useAgentStore from '../../store/AgentStore'
import AgentCard     from './AgentCard'
import MultiSelect   from './MultiSelect'

function AgentList()
{
    // subscribe to only agents + search_query so the list re-renders only when these change,
    // not on every focused/selected change happening in other components
    const agents       = useAgentStore((s) => s.agents)
    const search_query = useAgentStore((s) => s.search_query)

    const q = search_query.trim().toLowerCase()
    const filtered_agents = q
        ? agents.filter(function (a)
        {
            return a.name.toLowerCase().includes(q) || a.ip.includes(q)
        })
        : agents

    return (
        <div>
            {/* multi-agent selection controls above the list */}
            <MultiSelect />

            {filtered_agents.length === 0
                ? (
                    <div className="agent-list__empty">
                        <Inbox size={28} strokeWidth={1.5} />
                        <span>No agents found</span>
                    </div>
                )
                : filtered_agents.map(function (agent)
                {
                    return <AgentCard key={agent.id} agent={agent} />
                })
            }
        </div>
    )
}

export default AgentList
