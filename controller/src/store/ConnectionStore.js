/* ConnectionStore.js — tracks the WebSocket connection to the Gateway */
import { create } from 'zustand'

const useConnectionStore = create(function (set)
{
  return {
    status:      'connected',  // 'connected' | 'connecting' | 'disconnected'
    gateway_url: '',           // ws://host:port — set by Socket.js

    setStatus:     (status) => set({ status }),
    setGatewayUrl: (url)    => set({ gateway_url: url }),
  }
})

export default useConnectionStore
