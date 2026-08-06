// AuthService.js — admin login + refresh + logout against the Gateway REST API.
//
// TOKEN MODEL (C4):
//   - Access token  : short-lived JWT (~30 min) returned in the /api/login JSON
//                     body. Held ONLY in memory (Zustand ConnectionStore) —
//                     NEVER in sessionStorage/localStorage. Vanishes on page
//                     reload; the refresh flow re-hydrates it.
//   - Refresh token : ~7 days, set by the Gateway as an HttpOnly Cookie. The
//                     Controller code NEVER touches it directly — the browser
//                     attaches it automatically via `credentials: 'include'`.
//                     HttpOnly means it is not reachable from JS, which stops
//                     an XSS from stealing it.
//
// INTERCEPTOR: `apiFetch` wraps `fetch` so any authenticated call that comes
// back 401 tries a single refresh, then retries once. If the refresh itself
// fails (401 / network) we log out — the operator lands on LoginScreen.
//
// REFRESH DEDUP: many components / handlers may race a refresh at once
// (WS `auth_expired` + a pending REST 401). We coalesce with a single
// in-flight promise so the Gateway only sees one /api/refresh call.

import useConnectionStore from '../store/ConnectionStore'

// Derive the HTTP base URL from the WebSocket gateway URL by swapping the
// scheme: ws:// -> http://  and  wss:// -> https://.
function gatewayHttpUrl()
{
    if (import.meta.env.VITE_GATEWAY_URL) {
        return import.meta.env.VITE_GATEWAY_URL.replace(/^ws(s?):\/\//i, 'http$1://')
    }
    return window.location.origin
}

// One shared promise for the current /api/refresh call — new callers reuse it
// instead of firing another network request.
let _refresh_in_flight = null

// Monotonic session counter. Bumped on every logout so a refresh in flight can
// tell it belongs to a stale session and MUST NOT write the new token back
// into the store (which would silently un-logout the operator).
let _session_epoch = 0

// ─── Public: login ────────────────────────────────────────────────────────────

// Attempt an admin login. Returns { ok, token, message }.
// On success the access token is written to ConnectionStore.auth_token
// (memory only). The refresh token is set by the Gateway as an HttpOnly Cookie
// via Set-Cookie — the client never sees it.
export async function login(username, password)
{
    let response
    try
    {
        response = await fetch(`${gatewayHttpUrl()}/api/login`,
        {
            method      : 'POST',
            headers     : { 'Content-Type': 'application/json' },
            body        : JSON.stringify({ username, password }),
            credentials : 'include',   // let the Gateway set the refresh cookie
        })
    }
    catch (err)
    {
        console.error('[AuthService] login network error:', err)
        return { ok: false, message: 'Không kết nối được Gateway. Kiểm tra máy chủ và thử lại.' }
    }

    let body = {}
    try { body = await response.json() }
    catch { body = {} }

    if (!response.ok || !body.ok || !body.token)
    {
        return { ok: false, message: body.message ?? 'Sai tài khoản hoặc mật khẩu.' }
    }

    // Access token lives in memory only — no sessionStorage / localStorage.
    useConnectionStore.getState().setAuthToken(body.token)

    return { ok: true, token: body.token, message: body.message ?? 'Đăng nhập thành công.' }
}

// ─── Public: refresh access token ─────────────────────────────────────────────

// Ask the Gateway for a new access token using the HttpOnly refresh cookie.
// Returns { ok, token, message }. On success the new token replaces the one in
// ConnectionStore. Callers that race are coalesced onto one in-flight request.
export function refreshAccessToken()
{
    if (_refresh_in_flight) return _refresh_in_flight

    // Snapshot the session at request-start; a logout during the fetch will
    // bump _session_epoch and this refresh must NOT write its result back.
    const started_epoch = _session_epoch

    _refresh_in_flight = (async function ()
    {
        let response
        try
        {
            response = await fetch(`${gatewayHttpUrl()}/api/refresh`,
            {
                method      : 'POST',
                credentials : 'include',   // sends the HttpOnly refresh cookie
            })
        }
        catch (err)
        {
            console.error('[AuthService] refresh network error:', err)
            return { ok: false, message: 'Không kết nối được Gateway để làm mới phiên.' }
        }

        let body = {}
        try { body = await response.json() }
        catch { body = {} }

        if (!response.ok || !body.ok || !body.token)
        {
            return { ok: false, message: body.message ?? 'Phiên đã hết hạn, cần đăng nhập lại.' }
        }

        // Race guard: if the operator logged out while this fetch was in
        // flight, silently drop the new token instead of un-logging them out.
        if (started_epoch !== _session_epoch)
        {
            return { ok: false, message: 'Đã đăng xuất trong lúc làm mới phiên.' }
        }

        useConnectionStore.getState().setAuthToken(body.token)
        return { ok: true, token: body.token, message: body.message ?? '' }
    })().finally(function ()
    {
        _refresh_in_flight = null
    })

    return _refresh_in_flight
}

// ─── Public: logout ───────────────────────────────────────────────────────────

// Clear the in-memory access token immediately (UI drops to LoginScreen this
// tick) and fire a best-effort /api/logout in the background so the Gateway
// can invalidate the refresh cookie. A network failure is logged and ignored
// — the client is already logged out locally.
export function logout()
{
    // Bump the epoch FIRST so any refresh that resolves after this point sees
    // a mismatched snapshot and drops its token result.
    _session_epoch++
    useConnectionStore.getState().clearAuthToken()

    fetch(`${gatewayHttpUrl()}/api/logout`,
    {
        method      : 'POST',
        credentials : 'include',   // sends the cookie so the server can revoke it
    })
    .catch(function (err)
    {
        console.warn('[AuthService] logout network error (ignored):', err)
    })
}

// ─── Public: authenticated fetch with 401 → refresh → retry ───────────────────

// Wrap fetch so any 401 response triggers ONE refresh + retry. If the refresh
// itself fails we log out and reject so the caller stops. Every call includes
// the refresh cookie via `credentials: 'include'`.
export async function apiFetch(url, opts = {})
{
    const auth_token = useConnectionStore.getState().auth_token
    const with_auth  =
    {
        ...opts,
        credentials : 'include',
        headers     :
        {
            ...(opts.headers ?? {}),
            ...(auth_token ? { Authorization: `Bearer ${auth_token}` } : {}),
        },
    }

    let response = await fetch(url, with_auth)
    if (response.status !== 401) return response

    const refreshed = await refreshAccessToken()
    if (!refreshed.ok)
    {
        // Refresh cookie is dead — force the operator back to LoginScreen.
        await logout()
        return response   // return the original 401 so the caller sees it
    }

    // Retry ONCE with the newly-issued access token.
    const retry_token = useConnectionStore.getState().auth_token
    const retry_opts  =
    {
        ...opts,
        credentials : 'include',
        headers     :
        {
            ...(opts.headers ?? {}),
            ...(retry_token ? { Authorization: `Bearer ${retry_token}` } : {}),
        },
    }
    return fetch(url, retry_opts)
}

// ─── Public: read current token ───────────────────────────────────────────────

export function getToken()
{
    return useConnectionStore.getState().auth_token
}
