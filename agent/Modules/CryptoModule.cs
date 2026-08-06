using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace agent.Modules
{
    public class CryptoModule : IDisposable
    {
        private ECDiffieHellman _ecdh;
        private byte[] _sessionKey;
        private byte[] _udpSessionKey;
        private readonly string _e2eeSharedSecret;

        public bool IsE2EEReady => _sessionKey != null;

        public CryptoModule(string e2eeSharedSecret)
        {
            _e2eeSharedSecret = e2eeSharedSecret;
            // Initialize ECDH with NIST P-256 (secp256r1)
            _ecdh = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        }

        // Sequence Number for Sliding Window
        private uint _sendSeq = 0;
        private uint _recvSeq = unchecked((uint)-1);
        private readonly object _seqLock = new object();

        public uint GetNextSendSeq()
        {
            lock (_seqLock)
            {
                return ++_sendSeq;
            }
        }

        public bool CheckAndUpdateRecvSeq(uint seq)
        {
            lock (_seqLock)
            {
                // Sliding window size = 5
                if (_recvSeq != unchecked((uint)-1) && seq + 5 <= _recvSeq)
                {
                    return false; // Replay / Too old
                }

                if (_recvSeq == unchecked((uint)-1) || seq > _recvSeq)
                {
                    _recvSeq = seq;
                }
                return true;
            }
        }

        /// <summary>
        /// Exports the Agent's Public Key as a Base64 SPKI string.
        /// </summary>
        public string GetPublicKeySPKIBase64()
        {
            byte[] spkiBytes = _ecdh.ExportSubjectPublicKeyInfo();
            return Convert.ToBase64String(spkiBytes);
        }

        /// <summary>
        /// Signs the Base64 SPKI string using HMAC-SHA256 and the shared PIN.
        /// </summary>
        public string SignHMAC(string dataBase64)
        {
            byte[] keyBytes = Encoding.UTF8.GetBytes(_e2eeSharedSecret);
            using (var hmac = new HMACSHA256(keyBytes))
            {
                byte[] dataBytes = Encoding.UTF8.GetBytes(dataBase64);
                byte[] signatureBytes = hmac.ComputeHash(dataBytes);
                return Convert.ToBase64String(signatureBytes);
            }
        }

        /// <summary>
        /// Verifies the HMAC-SHA256 signature from the Controller.
        /// </summary>
        public bool VerifyHMAC(string dataBase64, string signatureBase64)
        {
            string expectedSignature = SignHMAC(dataBase64);
            return expectedSignature == signatureBase64;
        }

        /// <summary>
        /// Derives the AES-256-GCM Session Key using HKDF.
        /// </summary>
        public void DeriveSessionKey(string controllerPublicKeySPKIBase64)
        {
            byte[] controllerSpki = Convert.FromBase64String(controllerPublicKeySPKIBase64);
            using (var controllerKey = ECDiffieHellman.Create())
            {
                controllerKey.ImportSubjectPublicKeyInfo(controllerSpki, out _);

                // Derive the raw shared secret (unhashed) to match Web Crypto API's deriveBits
                byte[] sharedSecret = _ecdh.DeriveRawSecretAgreement(controllerKey.PublicKey);

                // Use HKDF to derive the final session key, matching Web Crypto API
                _sessionKey = HKDF.DeriveKey(
                    hashAlgorithmName: HashAlgorithmName.SHA256,
                    ikm: sharedSecret,
                    outputLength: 32, // 256 bits
                    salt: Array.Empty<byte>(),
                    info: Encoding.UTF8.GetBytes("RemoteControl_E2EE_v1")
                );

                _udpSessionKey = HKDF.DeriveKey(
                    hashAlgorithmName: HashAlgorithmName.SHA256,
                    ikm: sharedSecret,
                    outputLength: 32, // 256 bits
                    salt: Array.Empty<byte>(),
                    info: Encoding.UTF8.GetBytes("RemoteControl_UDP_v1")
                );

                // Reset sequence numbers for the new session (important when Controller refreshes without Agent reconnecting)
                lock (_seqLock)
                {
                    _sendSeq = 0;
                    _recvSeq = unchecked((uint)-1);
                }
            }
        }

        /// <summary>
        /// Generates a random 12-byte IV for AES-GCM.
        /// </summary>
        public byte[] GenerateIV()
        {
            byte[] iv = new byte[12];
            RandomNumberGenerator.Fill(iv);
            return iv;
        }

        /// <summary>
        /// Encrypts data using AES-GCM.
        /// Returns a byte array structured as: [IV (12)] + [Ciphertext (N)] + [AuthTag (16)]
        /// </summary>
        public byte[] EncryptAESGCM(byte[] plaintext, byte[] aad = null)
        {
            if (!IsE2EEReady)
                throw new InvalidOperationException("E2EE is not ready. Session key is missing.");

            byte[] iv = GenerateIV();
            byte[] ciphertext = new byte[plaintext.Length];
            byte[] authTag = new byte[16];

            using (var aesGcm = new AesGcm(_sessionKey, 16))
            {
                aesGcm.Encrypt(iv, plaintext, ciphertext, authTag, aad);
            }

            // Pack the E2EE Packet: IV + Ciphertext + AuthTag
            byte[] e2eePacket = new byte[iv.Length + ciphertext.Length + authTag.Length];
            Buffer.BlockCopy(iv, 0, e2eePacket, 0, iv.Length);
            Buffer.BlockCopy(ciphertext, 0, e2eePacket, iv.Length, ciphertext.Length);
            Buffer.BlockCopy(authTag, 0, e2eePacket, iv.Length + ciphertext.Length, authTag.Length);

            return e2eePacket;
        }

        public byte[] EncryptUdpAESGCM(byte[] plaintext, byte[] aad = null)
        {
            if (!IsE2EEReady)
                throw new InvalidOperationException("E2EE is not ready. Session key is missing.");

            // Stable per-session UDP key (no auto-ratchet). Ratchet-by-frame-count desynced
            // whenever screen+webcam streamed together (shared counter, separate frameIds) or a
            // stream restarted (frameId reset, counter not), causing permanent GCM decrypt failure.
            // Confidentiality still holds: AES-256-GCM with a fresh random IV + AAD per frame.
            byte[] iv = GenerateIV();
            byte[] ciphertext = new byte[plaintext.Length];
            byte[] authTag = new byte[16];

            using (var aesGcm = new AesGcm(_udpSessionKey, 16))
            {
                aesGcm.Encrypt(iv, plaintext, ciphertext, authTag, aad);
            }

            byte[] e2eePacket = new byte[iv.Length + ciphertext.Length + authTag.Length];
            Buffer.BlockCopy(iv, 0, e2eePacket, 0, iv.Length);
            Buffer.BlockCopy(ciphertext, 0, e2eePacket, iv.Length, ciphertext.Length);
            Buffer.BlockCopy(authTag, 0, e2eePacket, iv.Length + ciphertext.Length, authTag.Length);

            return e2eePacket;
        }

        /// <summary>
        /// Decrypts an E2EE packet structured as: [IV (12)] + [Ciphertext (N)] + [AuthTag (16)]
        /// </summary>
        public byte[] DecryptAESGCM(byte[] e2eePacket, byte[] aad = null)
        {
            if (!IsE2EEReady)
                throw new InvalidOperationException("E2EE is not ready. Session key is missing.");

            if (e2eePacket.Length < 12 + 16)
                throw new ArgumentException("Packet is too small to be a valid E2EE packet.");

            byte[] iv = new byte[12];
            byte[] authTag = new byte[16];
            byte[] ciphertext = new byte[e2eePacket.Length - 12 - 16];

            Buffer.BlockCopy(e2eePacket, 0, iv, 0, 12);
            Buffer.BlockCopy(e2eePacket, 12, ciphertext, 0, ciphertext.Length);
            Buffer.BlockCopy(e2eePacket, 12 + ciphertext.Length, authTag, 0, 16);

            byte[] plaintext = new byte[ciphertext.Length];

            using (var aesGcm = new AesGcm(_sessionKey, 16))
            {
                aesGcm.Decrypt(iv, ciphertext, authTag, plaintext, aad);
            }

            return plaintext;
        }

        /// <summary>
        /// Resets the Crypto Module (e.g., for Reconnect)
        /// </summary>
        public void Reset()
        {
            if (_sessionKey != null)
            {
                Array.Clear(_sessionKey, 0, _sessionKey.Length);
                _sessionKey = null;
            }
            if (_udpSessionKey != null)
            {
                Array.Clear(_udpSessionKey, 0, _udpSessionKey.Length);
                _udpSessionKey = null;
            }
            _ecdh?.Dispose();
            _ecdh = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
            
            // Reset lại Sequence Number để khớp với Controller sau khi Reconnect
            lock (_seqLock)
            {
                _sendSeq = 0;
                _recvSeq = unchecked((uint)-1);
            }
        }

        public void Dispose()
        {
            _ecdh?.Dispose();
            if (_sessionKey != null)
            {
                Array.Clear(_sessionKey, 0, _sessionKey.Length);
            }
            if (_udpSessionKey != null)
            {
                Array.Clear(_udpSessionKey, 0, _udpSessionKey.Length);
            }
        }
    }
}
