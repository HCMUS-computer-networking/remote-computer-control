// index.js — the ONE place that decides mock vs real socket.
//
// Both classes share the exact same API shape (onOpen / onMessage / onBinary /
// onClose / onError / connect / close / send), so the rest of the app never
// needs to know which one it is using. UseAgentSocket imports AgentSocket from
// here — swapping backend is a single env flag, no code change.
//
//   VITE_USE_MOCK = "true"  → use MockSocket (default for local dev)
//   VITE_USE_MOCK = "false" → use the real Socket (talk to the Gateway)
//
// Default is mock when the flag is missing, so `npm run dev` works out of the box.

import MockSocket from './MockSocket'
import Socket     from './Socket'

// Read the env flag; treat anything other than the string "false" as mock.
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'

// The single socket class the whole app uses. Same shape either way.
const AgentSocket = USE_MOCK ? MockSocket : Socket

export default AgentSocket
