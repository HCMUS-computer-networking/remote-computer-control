// MultiSelect.jsx — toolbar that lets the user select multiple agents at once.
// Sits above the agent list in the sidebar.
// "Select all" picks every online agent; clicking again clears the selection.
import useAgentStore from '../../store/AgentStore'

function MultiSelect()
{
    const agents             = useAgentStore((s) => s.agents)
    const selected_agent_ids = useAgentStore((s) => s.selected_agent_ids)
    const setSelectedIds     = useAgentStore((s) => s.setSelectedIds)
    const clearSelection     = useAgentStore((s) => s.clearSelection)

    // only online agents can be targeted by multi-agent commands
    const online_ids     = agents.filter((a) => a.online).map((a) => a.id)
    const selected_count = selected_agent_ids.length
    const all_selected   = online_ids.length > 0 &&
                           online_ids.every((id) => selected_agent_ids.includes(id))

    function handleSelectAll()
    {
        if (all_selected)
        {
            clearSelection()
        }
        else
        {
            setSelectedIds(online_ids)   // select every online agent
        }
    }

    // hide the bar completely when there are no agents to select
    if (online_ids.length === 0) return null

    return (
        <div className="multi-select-bar">
            <label className="multi-select-bar__label">
                <input
                    type="checkbox"
                    className="multi-select-bar__checkbox"
                    checked={all_selected}
                    onChange={handleSelectAll}
                    aria-label="Select all online agents"
                />
                {selected_count > 0
                    ? `${selected_count} agent${selected_count > 1 ? 's' : ''} selected`
                    : 'Select all'}
            </label>

            {/* show the clear button only when at least one agent is checked */}
            {selected_count > 0 && (
                <button
                    className="multi-select-bar__clear"
                    onClick={clearSelection}
                    aria-label="Clear selection"
                >
                    Clear
                </button>
            )}
        </div>
    )
}

export default MultiSelect
