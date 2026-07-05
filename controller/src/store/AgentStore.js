/* AgentStore.js — list of connected agents, selection, and search filter */
import { create } from 'zustand'

/* scaffold data — replaced by real socket messages later */
const MOCK_AGENTS = [
  { id: 'a1', name: 'DESKTOP-01', os: 'Windows 11',     ip: '192.168.1.11', online: true,  in_session: false },
  { id: 'a2', name: 'DESKTOP-02', os: 'Windows 10',     ip: '192.168.1.12', online: true,  in_session: true  },
  { id: 'a3', name: 'LAPTOP-VU',  os: 'Windows 11',     ip: '192.168.1.20', online: true,  in_session: false },
  { id: 'a4', name: 'SRV-TEST',   os: 'Windows Server', ip: '192.168.1.30', online: false, in_session: false },
  { id: 'a5', name: 'PC-LAB-05',  os: 'Windows 10',     ip: '192.168.1.45', online: true,  in_session: false },
]

const useAgentStore = create(function (set, get)
{
  return {
    agents:            MOCK_AGENTS, // full list received from gateway
    selected_agent_id: null,        // agent currently open in focus mode
    search_query:      '',          // text typed in sidebar search box

    setAgents: (agents) => set({ agents }),

    setSelectedAgent: (id) => set({ selected_agent_id: id }),

    setSearchQuery: (q) => set({ search_query: q }),

    /* returns only agents whose name or IP match the search query */
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

    /* returns the currently selected agent object, or null */
    getSelectedAgent: () =>
    {
      const { agents, selected_agent_id } = get()
      return agents.find((a) => a.id === selected_agent_id) ?? null
    },
  }
})

export default useAgentStore
