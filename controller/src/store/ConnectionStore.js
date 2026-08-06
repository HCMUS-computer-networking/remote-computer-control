// ConnectionStore.js — tracks the WebSocket connection status and auth token.
// The actual socket lifecycle is managed by UseAgentSocket hook (not here).
// connect() / disconnect() are state-only signals; the hook reacts to them.
//
// AUTH — auth_token holds the SHORT-LIVED access JWT issued by the Gateway
// after a successful login. It lives ONLY in this store (memory) — never in
// sessionStorage / localStorage. A page reload therefore signs the operator
// out; the HttpOnly refresh cookie held by the browser is what lets
// AuthService.refreshAccessToken() re-hydrate the token without a full login.
// Socket.js reads this value to build ws://.../controller?token=<JWT>.
import { create } from 'zustand'

const useConnectionStore = create(function (set)
{
    return {
        status      : 'idle',                  // 'idle' | 'connecting' | 'open' | 'closed'
        gateway_url : 'wss://localhost:8080',   // destination for the real Socket.js
        auth_token  : null,                    // access JWT from /api/login (memory only)

        // Mark connection as pending. UseAgentSocket hook watches this and opens the socket.
        connect: (url) =>
        {
            if (url) set({ gateway_url: url });
            set({ status: 'connecting' });
        },

        // Mark connection as closed and clear the JWT so the next reconnect
        // will not carry a token the operator no longer wants used.
        disconnect: () =>
        {
            set({ status: 'closed', auth_token: null });
        },

        setStatus: (status) =>
        {
            set({ status });
        },

        setGatewayUrl: (url) =>
        {
            set({ gateway_url: url });
        },

        // Store the JWT after a successful login OR refresh. Password is NEVER stored.
        setAuthToken: (auth_token) =>
        {
            set({ auth_token });
        },

        // Drop the JWT on logout so the next reconnect falls back to ?key=.
        clearAuthToken: () =>
        {
            set({ auth_token: null });
        },
    }
})

export default useConnectionStore
