// UiStore.js — global UI state: theme, layout mode, active module tab, sidebar.
import { create } from 'zustand'

// Valid tab IDs — used by setActiveTab to reject unknown values.
const MODULE_TABS = ['application', 'process', 'screen', 'keylog', 'file', 'webcam', 'power']

let _toast_id = 0

const useUiStore = create(function (set)
{
    return {
        theme        : 'light',         // 'light' | 'dark'
        layout_mode  : 'grid',          // 'grid'  | 'focus'
        active_tab   : 'application',   // one of MODULE_TABS
        sidebar_open : true,            // controls mobile sidebar visibility
        toasts       : [],              // array of { id, message, variant, timestamp }

        setTheme: (theme) =>
        {
            set({ theme });
        },

        toggleTheme: () =>
            set(function (s)
            {
                const next_theme = s.theme === 'light' ? 'dark' : 'light'
                return { theme: next_theme }
            }),

        setLayoutMode: (mode) =>
        {
            set({ layout_mode: mode });
        },

        // Switching to a tab implies entering focus view for that agent.
        setActiveTab: (tab) =>
        {
            if (MODULE_TABS.includes(tab))
            {
                set({ active_tab: tab, layout_mode: 'focus' })
            }
        },

        toggleSidebar: () =>
            set(function (s)
            {
                return { sidebar_open: !s.sidebar_open }
            }),

        // Push a short-lived notification. Variant: 'success' | 'error' | 'info'.
        addToast: (message, variant = 'info') =>
        {
            const id = ++_toast_id
            set(function (s)
            {
                return { toasts: [...s.toasts, { id, message, variant, timestamp: Date.now() }] }
            })
            setTimeout(function ()
            {
                set(function (s)
                {
                    return { toasts: s.toasts.filter((t) => t.id !== id) }
                })
            }, 3000)
        },

        dismissToast: (id) =>
            set(function (s)
            {
                return { toasts: s.toasts.filter((t) => t.id !== id) }
            }),
    }
})

export { MODULE_TABS }
export default useUiStore
