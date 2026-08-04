// PermissionStore.js — consent state per (agent_id, feature) for Plan B.
//
// Plan B requires the Controller to obtain Agent consent for a feature BEFORE
// sending any module command. This store tracks where each (agent, feature)
// pair is in that handshake so PermissionGate can enable / disable the module
// command buttons accordingly.
//
// Status values (one string per (agent_id, feature)):
//   'idle'       — no request sent yet (default)
//   'requesting' — permission_request sent, waiting for the Agent reply
//   'granted'    — Agent user approved; module commands are allowed
//   'denied'     — Agent user declined the consent popup
import { create } from 'zustand'

// Default status when a pair has never been touched.
const DEFAULT_STATUS = 'idle'

const usePermissionStore = create(function (set, get)
{
    return {
        // Nested map: permissions[agent_id][feature] = status string.
        permissions: {},

        // Mark a pair as 'requesting' right after we send permission_request.
        requestPermission: (agent_id, feature) =>
            set(function (s)
            {
                const agent_perms = s.permissions[agent_id] ?? {}
                return {
                    permissions:
                    {
                        ...s.permissions,
                        [agent_id]: { ...agent_perms, [feature]: 'requesting' },
                    },
                }
            }),

        // Apply the Agent reply: granted → 'granted', otherwise → 'denied'.
        setPermissionResult: (agent_id, feature, granted) =>
            set(function (s)
            {
                const agent_perms = s.permissions[agent_id] ?? {}
                return {
                    permissions:
                    {
                        ...s.permissions,
                        [agent_id]: { ...agent_perms, [feature]: granted ? 'granted' : 'denied' },
                    },
                }
            }),

        // Drop a granted feature back to 'idle' (called on revoke / disconnect).
        revoke: (agent_id, feature) =>
            set(function (s)
            {
                const agent_perms = s.permissions[agent_id] ?? {}
                return {
                    permissions:
                    {
                        ...s.permissions,
                        [agent_id]: { ...agent_perms, [feature]: 'idle' },
                    },
                }
            }),

        // Non-reactive read for hook / callback code (components use a selector).
        getStatus: (agent_id, feature) =>
        {
            return get().permissions[agent_id]?.[feature] ?? DEFAULT_STATUS
        },
    }
})

export default usePermissionStore
