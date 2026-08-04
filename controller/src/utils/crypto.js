/**
 * E2EE Crypto Utilities for Controller (React)
 * Uses Web Crypto API for ECDH, HKDF, HMAC, and AES-GCM.
 */

// --- Base64 / ArrayBuffer Utilities ---

export const arrayBufferToBase64 = (buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
};

export const base64ToArrayBuffer = (base64) => {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

// --- Key Management (ECDH) ---

/**
 * Generates an ECDH KeyPair using the P-256 curve.
 * @returns {Promise<CryptoKeyPair>} { publicKey, privateKey }
 */
export const generateECDHKeyPair = async () => {
    return await window.crypto.subtle.generateKey(
        {
            name: 'ECDH',
            namedCurve: 'P-256',
        },
        true, // extractable
        ['deriveKey', 'deriveBits']
    );
};

/**
 * Exports a CryptoKey to SPKI format (Base64)
 * @param {CryptoKey} publicKey 
 * @returns {Promise<string>} Base64 SPKI string
 */
export const exportPublicKeyToSPKI = async (publicKey) => {
    const spkiBuffer = await window.crypto.subtle.exportKey('spki', publicKey);
    return arrayBufferToBase64(spkiBuffer);
};

/**
 * Imports a Base64 SPKI string into a CryptoKey for ECDH.
 * @param {string} spkiBase64 
 * @returns {Promise<CryptoKey>}
 */
export const importPublicKeyFromSPKI = async (spkiBase64) => {
    const spkiBuffer = base64ToArrayBuffer(spkiBase64);
    return await window.crypto.subtle.importKey(
        'spki',
        spkiBuffer,
        {
            name: 'ECDH',
            namedCurve: 'P-256'
        },
        true,
        [] // public keys don't have operations like 'deriveKey' directly, they are passed as inputs
    );
};

// --- Authentication (HMAC) ---

const getHMACKey = async (secretPIN) => {
    const enc = new TextEncoder();
    return await window.crypto.subtle.importKey(
        'raw',
        enc.encode(secretPIN),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
    );
};

/**
 * Signs a Base64 string (Public Key) using HMAC-SHA256 and the shared PIN.
 * @param {string} dataBase64 
 * @param {string} secretPIN 
 * @returns {Promise<string>} Base64 Signature
 */
export const signHMAC = async (dataBase64, secretPIN) => {
    const key = await getHMACKey(secretPIN);
    const dataBuffer = new TextEncoder().encode(dataBase64);
    const signatureBuffer = await window.crypto.subtle.sign('HMAC', key, dataBuffer);
    return arrayBufferToBase64(signatureBuffer);
};

/**
 * Verifies an HMAC-SHA256 signature.
 * @param {string} dataBase64 
 * @param {string} signatureBase64 
 * @param {string} secretPIN 
 * @returns {Promise<boolean>} true if valid
 */
export const verifyHMAC = async (dataBase64, signatureBase64, secretPIN) => {
    const key = await getHMACKey(secretPIN);
    const dataBuffer = new TextEncoder().encode(dataBase64);
    const signatureBuffer = base64ToArrayBuffer(signatureBase64);
    return await window.crypto.subtle.verify('HMAC', key, signatureBuffer, dataBuffer);
};

// --- Key Derivation (HKDF) ---

/**
 * Derives a 256-bit AES-GCM Session Key using HKDF.
 * @param {CryptoKey} myPrivateKey 
 * @param {CryptoKey} agentPublicKey 
 * @returns {Promise<CryptoKey>} AES-GCM Session Key
 */
export const deriveSessionKey = async (myPrivateKey, agentPublicKey) => {
    // 1. Derive the raw shared secret (IKM) using ECDH
    const sharedSecretBuffer = await window.crypto.subtle.deriveBits(
        {
            name: 'ECDH',
            public: agentPublicKey
        },
        myPrivateKey,
        256 // length in bits
    );

    // 2. Import the shared secret as an HKDF key material
    const hkdfKeyMaterial = await window.crypto.subtle.importKey(
        'raw',
        sharedSecretBuffer,
        { name: 'HKDF' },
        false,
        ['deriveKey']
    );

    // 3. Derive the final AES-GCM key using HKDF
    const infoBuffer = new TextEncoder().encode('RemoteControl_E2EE_v1');
    const tcpKey = await window.crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(0),
            info: infoBuffer
        },
        hkdfKeyMaterial,
        { name: 'AES-GCM', length: 256 },
        false, 
        ['encrypt', 'decrypt']
    );

    const udpInfoBuffer = new TextEncoder().encode('RemoteControl_UDP_v1');
    const udpKey = await window.crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(0),
            info: udpInfoBuffer
        },
        hkdfKeyMaterial,
        { name: 'AES-GCM', length: 256 },
        true, // Must be extractable to step the ratchet
        ['encrypt', 'decrypt']
    );

    const udpKeyBuffer = await window.crypto.subtle.exportKey('raw', udpKey);
    return { tcpKey, udpKeyBuffer };
};

/**
 * Steps the Symmetric Ratchet Key for PFS (Forward Secrecy).
 * NextKey = SHA256(CurrentKey + "Ratchet_v1")
 */
export const stepRatchetKey = async (currentKeyBuffer) => {
    const currentBytes = new Uint8Array(currentKeyBuffer);
    const suffix = new TextEncoder().encode("Ratchet_v1");
    const msg = new Uint8Array(currentBytes.byteLength + suffix.byteLength);
    msg.set(currentBytes);
    msg.set(suffix, currentBytes.byteLength);
    return await window.crypto.subtle.digest('SHA-256', msg);
};

// --- Encryption / Decryption (AES-GCM) ---

/**
 * Generates a random 12-byte IV.
 * @returns {Uint8Array}
 */
export const generateIV = () => {
    return window.crypto.getRandomValues(new Uint8Array(12));
};

/**
 * Encrypts data using AES-GCM.
 * @param {CryptoKey} sessionKey 
 * @param {Uint8Array} dataBuffer 
 * @param {Uint8Array} iv 12 bytes
 * @param {Uint8Array} [aadBuffer] Optional AAD
 * @returns {Promise<ArrayBuffer>} Ciphertext + AuthTag
 */
export const encryptAESGCM = async (sessionKey, dataBuffer, iv, aadBuffer = new Uint8Array(0)) => {
    return await window.crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,
            additionalData: aadBuffer
        },
        sessionKey,
        dataBuffer
    );
};

/**
 * Decrypts data using AES-GCM.
 * @param {CryptoKey} sessionKey 
 * @param {Uint8Array} dataToDecrypt (Ciphertext + AuthTag)
 * @param {Uint8Array} iv 12 bytes
 * @param {Uint8Array} [aadBuffer] Optional AAD
 * @returns {Promise<ArrayBuffer>} Decrypted original data
 */
export const decryptAESGCM = async (sessionKey, dataToDecrypt, iv, aadBuffer = new Uint8Array(0)) => {
    return await window.crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: iv,
            additionalData: aadBuffer
        },
        sessionKey,
        dataToDecrypt
    );
};
