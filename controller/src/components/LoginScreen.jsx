/* LoginScreen.jsx — admin sign-in gate shown until a JWT is present.

   The form POSTs to the Gateway via AuthService.login; the Gateway does the
   real bcrypt + JWT check. On success AuthService stores the token in
   ConnectionStore.auth_token, which makes App swap this screen for the console.
   This component never stores the password — it lives only in local state until
   the request is sent. */
import { useState } from 'react'
import { LogIn, Loader2, ShieldAlert } from 'lucide-react'

import { login } from '../services/AuthService'

function LoginScreen()
{
    const [username, setUsername]   = useState('')
    const [password, setPassword]   = useState('')
    const [error, setError]         = useState('')
    const [submitting, setSubmitting] = useState(false)

    async function handleSubmit(event)
    {
        event.preventDefault()
        if (submitting) return

        setError('')
        setSubmitting(true)

        // AuthService updates ConnectionStore.auth_token on success, which makes
        // App re-render into the console — no navigation needed here.
        const result = await login(username.trim(), password)

        if (!result.ok)
        {
            setError(result.message)
            setSubmitting(false)   // keep the form so the operator can retry
        }
        // On success we intentionally leave submitting=true; this component
        // unmounts as App switches to the console.
    }

    return (
        <div className="login-screen">
            <form className="login-card" onSubmit={handleSubmit}>

                <div className="login-card__header">
                    <ShieldAlert size={22} strokeWidth={1.75} />
                    <h1 className="login-card__title">Controller — Admin Login</h1>
                </div>

                <p className="login-card__hint">
                    Đăng nhập để mở console điều khiển. Xác thực do Gateway xử lý.
                </p>

                <label className="login-card__field">
                    <span className="login-card__label">Username</span>
                    <input
                        className="login-card__input"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username"
                        autoFocus
                        required
                        disabled={submitting}
                    />
                </label>

                <label className="login-card__field">
                    <span className="login-card__label">Password</span>
                    <input
                        className="login-card__input"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                        disabled={submitting}
                    />
                </label>

                {/* Error message — shown on wrong credentials or network failure. */}
                {error && (
                    <div className="login-card__error" role="alert">
                        {error}
                    </div>
                )}

                <button
                    className="login-card__submit"
                    type="submit"
                    disabled={submitting || !username || !password}
                >
                    {submitting
                        ? <Loader2 size={16} strokeWidth={2} className="spin" />
                        : <LogIn size={16} strokeWidth={2} />}
                    {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
                </button>

            </form>
        </div>
    )
}

export default LoginScreen
