/* ModuleStore.js — per-agent, per-module data received from the Gateway */
import { create } from 'zustand'

/*
  Shape:
    data = {
      [agent_id]: {
        application: [...],
        process:     [...],
        screen:      { frame: ArrayBuffer | null, meta: {} },
        keylog:      { events: [] },
        file:        { tree: [], cwd: '' },
        webcam:      { frame: ArrayBuffer | null },
        power:       {},
      }
    }
*/
const useModuleStore = create(function (set)
{
  return {
    data: {},

    /* write (or merge) data for one agent + module combination */
    setModuleData: (agent_id, module, payload) =>
      set(function (s)
      {
        return {
          data: {
            ...s.data,
            [agent_id]: { ...s.data[agent_id], [module]: payload },
          },
        }
      }),

    /* clear data for one agent + module (e.g. when stopping a module) */
    clearModuleData: (agent_id, module) =>
      set(function (s)
      {
        const agent_data = { ...s.data[agent_id] }
        delete agent_data[module]
        return { data: { ...s.data, [agent_id]: agent_data } }
      }),

    /* remove all data for an agent that disconnects */
    clearAgentData: (agent_id) =>
      set(function (s)
      {
        const next = { ...s.data }
        delete next[agent_id]
        return { data: next }
      }),
  }
})

export default useModuleStore
