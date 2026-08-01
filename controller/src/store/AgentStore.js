// AgentStore.js — agent list, multi-select set, and focused agent for detail view.
import { create } from 'zustand'

// Start empty; the real list arrives via agents_list right after the socket
// opens (MockSocket also emits one on connect, so mock mode still populates).
const useAgentStore = create(function (set, get)
{
    return {
        agents              : [],           // full agent list from gateway
        selected_agent_ids  : [],           // IDs checked for multi-agent commands
        focused_agent_id    : null,         // single agent open in FocusView
        search_query        : '',           // text in the sidebar search box

        // Replace the entire agent list (called when agents_list message arrives).
        setAgents: (agents) =>
        {
            set({ agents });
        },

        // Add or remove an agent from the multi-select set.
        toggleSelect: (id) =>
            set(function (s)
            {
                const already_selected = s.selected_agent_ids.includes(id)
                const next_ids = already_selected
                    ? s.selected_agent_ids.filter((x) => x !== id)
                    : [...s.selected_agent_ids, id]
                return { selected_agent_ids: next_ids }
            }),

        // Patch ONE agent's live status (online / in_session) from an
        // agent_status push. No-op if the agent id is unknown — the dispatch
        // layer then resyncs the whole list via list_agents.
        setAgentStatus: (agent_id, patch) =>
            set(function (s)
            {
                let found = false
                const next_agents = s.agents.map(function (a)
                {
                    if (a.id !== agent_id) return a
                    found = true
                    return { ...a, ...patch }
                })
                return found ? { agents: next_agents } : {}
            }),

        // Open one agent in the detail (Focus) view.
        setFocused: (id) =>
        {
            set({ focused_agent_id: id });
        },

        // Replace the entire multi-select set with a given array of IDs.
        // Used by MultiSelect "select all" to avoid calling toggleSelect in a loop.
        setSelectedIds: (ids) =>
        {
            set({ selected_agent_ids: ids });
        },

        // Deselect all agents from the multi-select set.
        clearSelection: () =>
        {
            set({ selected_agent_ids: [] });
        },

        setSearchQuery: (q) =>
        {
            set({ search_query: q });
        },

        // Return agents whose name or IP contain the search query.
        getFilteredAgents: () =>
        {
            const { agents, search_query } = get()
            const q = search_query.trim().toLowerCase()
            if (!q) return agents
            return agents.filter(function (a)
            {
                return a.name.toLowerCase().includes(q) || a.ip.includes(q)
            })
        },

        // Return the agent object that is currently open in FocusView, or null.
        getFocusedAgent: () =>
        {
            const { agents, focused_agent_id } = get()
            return agents.find((a) => a.id === focused_agent_id) ?? null
        },
    }
})

export default useAgentStore
