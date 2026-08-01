// ConnectionStore.js — tracks the WebSocket connection status and auth token.
// The actual socket lifecycle is managed by UseAgentSocket hook (not here).
// connect() / disconnect() are state-only signals; the hook reacts to them.
//
// AUTH — auth_token holds the JWT issued by the Gateway after a successful
// login. Socket.js reads it to build ?token=<JWT>. The real credential check
// (bcrypt password + JWT signing) lives on the GATEWAY; the client only stores
// and forwards the token, never the password.
import { create } from 'zustand'

// sessionStorage key shared with AuthService — survives a page refresh but is
// cleared when the tab closes. Kept as a literal in both files (no import) to
// avoid a store <-> service circular dependency.
const AUTH_TOKEN_KEY = 'controller_auth_token'

const useConnectionStore = create(function (set)
{
    return {
        status      : 'idle',                  // 'idle' | 'connecting' | 'open' | 'closed'
        gateway_url : 'ws://localhost:8080',   // destination for the real Socket.js
        // Seed from sessionStorage so a refresh keeps the operator signed in.
        auth_token  : sessionStorage.getItem(AUTH_TOKEN_KEY),   // JWT from /api/login

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
            sessionStorage.removeItem(AUTH_TOKEN_KEY);
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

        // Store the JWT after a successful login. Password is NEVER stored.
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
