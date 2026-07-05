// ConnectionStore.js — tracks the WebSocket connection status and auth token.
// The actual socket lifecycle is managed by UseAgentSocket hook (not here).
// connect() / disconnect() are state-only signals; the hook reacts to them.
import { create } from 'zustand'

const useConnectionStore = create(function (set)
{
    return {
        status      : 'idle',                  // 'idle' | 'connecting' | 'open' | 'closed'
        gateway_url : 'ws://localhost:8080',   // destination for the real Socket.js
        token       : null,                    // auth token received after handshake

        // Mark connection as pending. UseAgentSocket hook watches this and opens the socket.
        connect: (url) =>
        {
            if (url) set({ gateway_url: url });
            set({ status: 'connecting' });
        },

        // Mark connection as closed and clear the auth token.
        disconnect: () =>
        {
            set({ status: 'closed', token: null });
        },

        setStatus: (status) =>
        {
            set({ status });
        },

        setGatewayUrl: (url) =>
        {
            set({ gateway_url: url });
        },

        setToken: (token) =>
        {
            set({ token });
        },
    }
})

export default useConnectionStore
