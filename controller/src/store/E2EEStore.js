import { create } from 'zustand'

// Simple Native IndexedDB Wrapper
const DB_NAME = 'RemoteControl_E2EE'
const STORE_NAME = 'agent_pins'

const getDB = () => {
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(DB_NAME, 1)
        request.onupgradeneeded = (event) => {
            const db = event.target.result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'agentId' })
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
}

const idbGet = async (key) => {
    const db = await getDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)
        const request = store.get(key)
        request.onsuccess = () => resolve(request.result?.data)
        request.onerror = () => reject(request.error)
    })
}

const idbSet = async (key, data) => {
    const db = await getDB()
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        const request = store.put({ agentId: key, data })
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
    })
}

// Master Password Crypto (PBKDF2 + AES-GCM)
const getMasterKey = async (password) => {
    const enc = new TextEncoder()
    const keyMaterial = await window.crypto.subtle.importKey(
        'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
    )
    return await window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: enc.encode('RemoteControl_Salt_V1'),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    )
}

const arrayBufferToBase64 = (buffer) => {
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return window.btoa(binary)
}

const base64ToArrayBuffer = (base64) => {
    const binary = window.atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
}

const encryptData = async (key, plainText) => {
    const iv = window.crypto.getRandomValues(new Uint8Array(12))
    const enc = new TextEncoder()
    const cipherBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, enc.encode(plainText)
    )
    
    // Combine IV and Ciphertext for storage
    const combined = new Uint8Array(12 + cipherBuffer.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(cipherBuffer), 12)
    return arrayBufferToBase64(combined.buffer)
}

const decryptData = async (key, base64Data) => {
    const combined = new Uint8Array(base64ToArrayBuffer(base64Data))
    const iv = combined.slice(0, 12)
    const data = combined.slice(12)
    const plainBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, key, data
    )
    return new TextDecoder().decode(plainBuffer)
}

// Zustand Store
const useE2EEStore = create((set, get) => ({
    isUnlocked: false,
    masterKey: null, // CryptoKey instance
    
    // Per-agent sessions
    // Structure: { [agentId]: { state: 'uninitialized' | 'handshaking' | 'ready', sessionKey: CryptoKey, sendSeq: number, recvSeq: number } }
    sessions: {},

    setSessionState: (agentId, state, sessionKey = null) => {
        set((prev) => ({
            sessions: {
                ...prev.sessions,
                [agentId]: {
                    ...prev.sessions[agentId],
                    state,
                    sessionKey: sessionKey || prev.sessions[agentId]?.sessionKey,
                    sendSeq: state === 'handshaking' ? 0 : (prev.sessions[agentId]?.sendSeq ?? 0),
                    recvSeq: state === 'handshaking' ? -1 : (prev.sessions[agentId]?.recvSeq ?? -1)
                }
            }
        }))
    },

    resetSession: (agentId) => {
        set((prev) => {
            const nextSessions = { ...prev.sessions };
            delete nextSessions[agentId];
            return { sessions: nextSessions };
        })
    },

    getSendSeqAndIncrement: (agentId) => {
        const session = get().sessions[agentId]
        if (!session || session.state !== 'ready') return null
        
        const seq = session.sendSeq
        set((prev) => ({
            sessions: {
                ...prev.sessions,
                [agentId]: { ...prev.sessions[agentId], sendSeq: seq + 1 }
            }
        }))
        return seq
    },

    checkAndUpdateRecvSeq: (agentId, seq) => {
        const session = get().sessions[agentId]
        if (!session || session.state !== 'ready') return false

        // Sliding window of 5
        const WINDOW_SIZE = 5
        if (seq <= session.recvSeq - WINDOW_SIZE) return false // Too old
        
        // Update max recv sequence
        set((prev) => ({
            sessions: {
                ...prev.sessions,
                [agentId]: { ...prev.sessions[agentId], recvSeq: Math.max(session.recvSeq, seq) }
            }
        }))
        return true
    },

    getSessionKey: (agentId) => {
        const session = get().sessions[agentId]
        return session?.state === 'ready' ? session.sessionKey : null
    },

    unlock: async (password) => {
        try {
            const key = await getMasterKey(password)
            // To verify if password is correct, we could check a test encryption,
            // but for TOFU (Trust On First Use) or simple design, we just store it.
            // If decrypt fails later, we know it's wrong.
            set({ isUnlocked: true, masterKey: key })
            return true
        } catch (e) {
            console.error('Failed to unlock E2EE', e)
            return false
        }
    },

    lock: () => {
        set({ isUnlocked: false, masterKey: null })
    },

    saveAgentPin: async (agentId, pin) => {
        const { masterKey, isUnlocked } = get()
        if (!isUnlocked) throw new Error("E2EE Store is locked")
        
        const encryptedPin = await encryptData(masterKey, pin)
        await idbSet(agentId, encryptedPin)
    },

    getAgentPin: async (agentId) => {
        const { masterKey, isUnlocked } = get()
        if (!isUnlocked) throw new Error("E2EE Store is locked")

        const encryptedPin = await idbGet(agentId)
        if (!encryptedPin) return null // No PIN saved yet
        
        try {
            return await decryptData(masterKey, encryptedPin)
        } catch (e) {
            console.error("Failed to decrypt PIN, maybe wrong master password?", e)
            return null // Decryption failed
        }
    }
}))

export default useE2EEStore
