import { useState } from 'react'
import { Lock, Unlock, Key, Loader2 } from 'lucide-react'
import useE2EEStore from '../store/E2EEStore'

export default function E2EEUnlockModal() {
    const isUnlocked = useE2EEStore((s) => s.isUnlocked)
    const unlock = useE2EEStore((s) => s.unlock)
    
    const [password, setPassword] = useState('')
    const [isUnlocking, setIsUnlocking] = useState(false)
    const [error, setError] = useState('')

    // If already unlocked, don't show the modal
    if (isUnlocked) return null

    const handleUnlock = async (e) => {
        e.preventDefault()
        setError('')
        if (!password) {
            setError('Please enter a Master Password')
            return
        }

        setIsUnlocking(true)
        const success = await unlock(password)
        setIsUnlocking(false)

        if (!success) {
            setError('Failed to initialize E2EE Crypto.')
        }
    }

    return (
        <div className="modal-backdrop">
            <div className="modal-content e2ee-modal">
                <div className="modal-header">
                    <Lock size={24} className="text-warning" />
                    <h2>E2EE Master Password</h2>
                </div>
                <div className="modal-body">
                    <p>
                        End-to-End Encryption requires a Master Password to encrypt and store your Agent PINs securely in your browser. 
                        Please enter or create your Master Password for this session.
                    </p>
                    <form onSubmit={handleUnlock}>
                        <div className="input-group">
                            <Key size={18} />
                            <input 
                                type="password" 
                                placeholder="Master Password" 
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoFocus
                            />
                        </div>
                        {error && <div className="text-danger mt-1 text-sm">{error}</div>}
                        
                        <div className="modal-actions mt-4">
                            <button 
                                type="submit" 
                                className="btn btn-primary w-full"
                                disabled={isUnlocking}
                            >
                                {isUnlocking ? <Loader2 className="spin" size={18} /> : <Unlock size={18} />}
                                {isUnlocking ? 'Unlocking...' : 'Unlock E2EE'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
            
            <style>{`
                .modal-backdrop {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.7);
                    backdrop-filter: blur(4px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 9999;
                }
                .modal-content.e2ee-modal {
                    background: var(--bg-panel, #1e1e2e);
                    border: 1px solid var(--border, #313244);
                    border-radius: 8px;
                    padding: 24px;
                    width: 100%;
                    max-width: 400px;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
                }
                .modal-header {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 16px;
                }
                .modal-header h2 {
                    margin: 0;
                    font-size: 1.25rem;
                    color: var(--text-primary, #cdd6f4);
                }
                .modal-body p {
                    color: var(--text-secondary, #a6adc8);
                    font-size: 0.9rem;
                    margin-bottom: 20px;
                    line-height: 1.5;
                }
                .input-group {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    background: var(--bg-input, #181825);
                    border: 1px solid var(--border, #313244);
                    border-radius: 6px;
                    padding: 0 12px;
                }
                .input-group input {
                    flex: 1;
                    background: transparent;
                    border: none;
                    color: var(--text-primary, #cdd6f4);
                    padding: 12px 0;
                    outline: none;
                }
                .input-group svg {
                    color: var(--text-secondary, #a6adc8);
                }
                .text-warning { color: #f9e2af; }
                .text-danger { color: #f38ba8; }
                .text-sm { font-size: 0.8rem; }
                .mt-1 { margin-top: 4px; }
                .mt-4 { margin-top: 16px; }
                .w-full { width: 100%; }
                .btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 10px 16px;
                    border-radius: 6px;
                    border: none;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                }
                .btn:disabled { opacity: 0.6; cursor: not-allowed; }
                .btn-primary {
                    background: var(--accent, #89b4fa);
                    color: #11111b;
                }
                .btn-primary:hover:not(:disabled) {
                    filter: brightness(1.1);
                }
            `}</style>
        </div>
    )
}
