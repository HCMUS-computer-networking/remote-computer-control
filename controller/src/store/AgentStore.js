// AgentStore.js — agent list, multi-select set, and focused agent for detail view.
import { create } from 'zustand'

// Scaffold agents matching MockSocket's FAKE_AGENTS exactly.
// Replaced by real data from agents_list message once UseAgentSocket is wired up.
const MOCK_AGENTS =
[
    { id: 'agent-01', name: 'PC-Lab-01',      os: 'Windows 11',   ip: '192.168.1.101', online: true,  in_session: false },
    { id: 'agent-02', name: 'PC-Lab-02',      os: 'Windows 11',   ip: '192.168.1.102', online: true,  in_session: true  },
    { id: 'agent-03', name: 'PC-Lab-03',      os: 'Windows 10',   ip: '192.168.1.103', online: false, in_session: false },
    { id: 'agent-04', name: 'PC-Lab-04',      os: 'Windows 11',   ip: '192.168.1.104', online: true,  in_session: false },
    { id: 'agent-05', name: 'DEV-Ubuntu-01',  os: 'Ubuntu 22.04', ip: '192.168.1.105', online: true,  in_session: false },
    { id: 'agent-06', name: 'PC-Lab-06',      os: 'Windows 10',   ip: '192.168.1.106', online: true,  in_session: true  },
    { id: 'agent-07', name: 'MacBook-Lab-01', os: 'macOS 14',     ip: '192.168.1.107', online: false, in_session: false },
]

const useAgentStore = create(function (set, get)
{
    return {
        agents              : MOCK_AGENTS,  // full agent list from gateway
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
