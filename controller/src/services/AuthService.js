// AuthService.js — admin login against the Gateway HTTP endpoint.
//
// SECURITY NOTE: the REAL credential check lives on the GATEWAY — it verifies
// the password with bcrypt and signs a JWT. The Controller (this client) only
// POSTs the username/password once, then stores and forwards the returned JWT.
// The password is NEVER kept anywhere on the client; only the token is stored
// in sessionStorage (cleared when the tab closes).
//
// Socket.js reads ConnectionStore.auth_token to build ws://.../controller?token=
// so a reconnect after login authenticates with the JWT automatically.

import useConnectionStore from '../store/ConnectionStore'

// Same key literal as ConnectionStore (kept duplicated to avoid a circular
// import between the store and this service).
const AUTH_TOKEN_KEY = 'controller_auth_token'

// Derive the HTTP base URL from the WebSocket gateway URL by swapping the
// scheme: ws:// -> http://  and  wss:// -> https://.
// Example: ws://localhost:8080 -> http://localhost:8080
function gatewayHttpUrl()
{
    const ws_url = import.meta.env.VITE_GATEWAY_URL ?? 'ws://localhost:8080'
    return ws_url.replace(/^ws(s?):\/\//i, 'http$1://')
}

// Attempt an admin login. Returns { ok, token, message }.
// On success the JWT is saved to sessionStorage AND ConnectionStore.auth_token.
// On network error or ok:false it returns a friendly { ok:false, message }.
export async function login(username, password)
{
    let response
    try
    {
        response = await fetch(`${gatewayHttpUrl()}/api/login`,
        {
            method  : 'POST',
            headers : { 'Content-Type': 'application/json' },
            body    : JSON.stringify({ username, password }),
        })
    }
    catch (err)
    {
        // Network failure — Gateway unreachable / CORS / DNS, etc.
        console.error('[AuthService] login network error:', err)
        return { ok: false, message: 'Không kết nối được Gateway. Kiểm tra máy chủ và thử lại.' }
    }

    // Parse the JSON body defensively — a non-JSON error page must not throw.
    let body = {}
    try { body = await response.json() }
    catch { body = {} }

    // Gateway contract (D8): { ok, token, message }. Treat a non-2xx or ok:false
    // as a failed login and surface the server message when present.
    if (!response.ok || !body.ok || !body.token)
    {
        return { ok: false, message: body.message ?? 'Sai tài khoản hoặc mật khẩu.' }
    }

    // Success — persist the token only (never the password).
    sessionStorage.setItem(AUTH_TOKEN_KEY, body.token)
    useConnectionStore.getState().setAuthToken(body.token)

    return { ok: true, token: body.token, message: body.message ?? 'Đăng nhập thành công.' }
}

// Clear the stored JWT everywhere. The caller is responsible for closing the
// socket (App re-renders to LoginScreen, which unmounts the socket owner).
export function logout()
{
    sessionStorage.removeItem(AUTH_TOKEN_KEY)
    useConnectionStore.getState().clearAuthToken()
}

// Read the current JWT (from the store, which is seeded from sessionStorage).
export function getToken()
{
    return useConnectionStore.getState().auth_token
}
