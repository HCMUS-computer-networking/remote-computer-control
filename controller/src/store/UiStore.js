/* UiStore.js — global UI state: theme, view mode, active tab, sidebar */
import { create } from 'zustand'

const MODULE_TABS = ['application', 'process', 'screen', 'keylog', 'file', 'webcam', 'power']

const useUiStore = create(function (set)
{
  return {
    theme:        'light',       // 'light' | 'dark'
    view_mode:    'grid',        // 'grid'  | 'focus'
    active_tab:   'application', // one of MODULE_TABS
    sidebar_open: true,          // controls mobile sidebar visibility

    setTheme: (theme) => set({ theme }),

    toggleTheme: () => set(function (s)
    {
      return { theme: s.theme === 'light' ? 'dark' : 'light' }
    }),

    setViewMode: (view_mode) => set({ view_mode }),

    setActiveTab: (tab) =>
    {
      if (MODULE_TABS.includes(tab))
      {
        set({ active_tab: tab, view_mode: 'focus' })
      }
    },

    toggleSidebar: () => set((s) => ({ sidebar_open: !s.sidebar_open })),
  }
})

export { MODULE_TABS }
export default useUiStore
