// Socket.js — real WebSocket wrapper that talks to the Gateway.
//
// This class has the SAME API shape as MockSocket.js on purpose:
//   onOpen / onMessage / onBinary / onClose / onError   (callback registration)
//   connect() / close() / send(message)                 (lifecycle + TX)
// Because of that, swapping mock ↔ real only changes ONE import in
// src/services/index.js — no component or hook code needs to change.
//
// FRAME PROTOCOL — screen/webcam frames arrive as two messages in order:
//   1) a text message  = JSON "frame_meta"  → delivered to onMessage
//   2) a binary message = raw JPEG bytes     → delivered to onBinary
// We set binaryType = "arraybuffer" so binary frames arrive as ArrayBuffer,
// exactly like MockSocket hands them to onBinary.
//
// RECONNECT — if the connection drops (not a clean close() by us), we retry
// with a simple exponential backoff and keep ConnectionStore.status in sync.

import useConnectionStore from '../store/ConnectionStore'
import useUiStore         from '../store/UiStore'
import { logout, refreshAccessToken } from './AuthService'

// ─── Config ───────────────────────────────────────────────────────────────────

// Gateway address comes from the Vite env; falls back to localhost for dev.
// Set VITE_GATEWAY_URL in a .env file to point at the real Gateway.
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const DEFAULT_GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? `${wsProtocol}//${window.location.host}`

// ─── Reconnect backoff ────────────────────────────────────────────────────────

const RECONNECT_BASE_MS = 500;     // first retry waits this long
const RECONNECT_MAX_MS  = 8000;    // cap so we never wait too long between tries

// ─── Socket class ───────────────────────────────────────────────────────────────

class Socket
{
    // url is optional; when omitted we use the env/default gateway address.
    constructor(url)
    {
        this._url            = url ?? DEFAULT_GATEWAY_URL;

        this._on_message     = null;    // fired for every incoming JSON message
        this._on_binary      = null;    // fired for incoming binary (ArrayBuffer) data
        this._on_open        = null;    // fired each time the connection opens
        this._on_close       = null;    // fired when the connection closes
        this._on_error       = null;    // fired on socket error

        this._ws             = null;    // the underlying WebSocket instance
        this._closed_by_user = false;   // true after close() so we do NOT reconnect
        this._retry_count    = 0;       // how many reconnect attempts so far
        this._reconnect_timer = null;   // saved so close() can cancel a pending retry
        this._opened_once    = false;   // true after the current WS reached onopen
        this._auth_fail_count = 0;      // consecutive closes that never opened while a JWT was set
    }

    // Threshold: after this many consecutive failed opens with a JWT present,
    // assume the JWT is expired/invalid (Gateway responds 401 at upgrade, which
    // the browser surfaces as onclose code 1006 — indistinguishable from network
    // errors, so we rely on repeated failures instead of a specific code).
    static AUTH_FAIL_THRESHOLD = 2;

    // ── Callback registration (mirror the MockSocket API) ──────────────────

    onOpen(callback)    { this._on_open    = callback; }
    onMessage(callback) { this._on_message = callback; }
    onBinary(callback)  { this._on_binary  = callback; }
    onClose(callback)   { this._on_close   = callback; }
    onError(callback)   { this._on_error   = callback; }

    // ── Lifecycle ──────────────────────────────────────────────────────────

    // Open the WebSocket. Safe to call once; reconnect is handled internally.
    connect()
    {
        this._closed_by_user = false;
        this._openSocket();
    }

    // Force-close the current underlying WebSocket without setting the
    // "user closed" flag, then reconnect. Used after a successful token
    // refresh so the next handshake carries the fresh JWT in the URL.
    reopen()
    {
        // Cancel any pending backoff so we open immediately.
        if (this._reconnect_timer)
        {
            clearTimeout(this._reconnect_timer);
            this._reconnect_timer = null;
        }
        if (this._ws)
        {
            // Detach handlers so the close event does NOT trigger auto-reconnect;
            // we open the new socket ourselves right after.
            this._ws.onopen    = null;
            this._ws.onmessage = null;
            this._ws.onclose   = null;
            this._ws.onerror   = null;
            try { this._ws.close(); } catch { /* ignore */ }
            this._ws = null;
        }
        this._retry_count      = 0;
        this._auth_fail_count  = 0;
        this._opened_once      = false;
        this._closed_by_user   = false;
        this._openSocket();
    }

    // Close the connection for good and stop any pending reconnect attempts.
    close()
    {
        this._closed_by_user = true;

        // Cancel a scheduled reconnect if we are waiting between retries.
        if (this._reconnect_timer)
        {
            clearTimeout(this._reconnect_timer);
            this._reconnect_timer = null;
        }

        if (this._ws)
        {
            // Detach handlers first so the close event does not trigger reconnect.
            this._ws.onopen    = null;
            this._ws.onmessage = null;
            this._ws.onclose   = null;
            this._ws.onerror   = null;
            this._ws.close();
            this._ws = null;
        }
    }

    // ── Send (entry point for outgoing commands) ───────────────────────────

    // Send a JSON string to the Gateway (same contract as MockSocket.send).
    send(message)
    {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN)
        {
            console.warn('[Socket] send() called while socket is not open');
            return;
        }
        this._ws.send(message);
    }

    // ── Private: build the final /controller endpoint URL ──────────────────

    // Prefer the JWT auth_token from ConnectionStore. Before login there is no
    // token yet, so we fall back to the pre-JWT CONTROLLER_KEY from the env.
    _buildEndpoint()
    {
        const auth_token = useConnectionStore.getState().auth_token;

        if (auth_token)
        {
            return `${this._url}/controller?token=${auth_token}`;
        }

        const controller_key = import.meta.env.VITE_CONTROLLER_KEY ?? '';
        return `${this._url}/controller?key=${controller_key}`;
    }

    // ── Private: open + wire up one WebSocket ──────────────────────────────

    _openSocket()
    {
        // Tell the store we are trying to connect (covers the reconnect gap too).
        useConnectionStore.getState().setStatus('connecting');

        let ws;
        try
        {
            ws = new WebSocket(this._buildEndpoint());
        }
        catch (err)
        {
            // Bad URL or blocked scheme — report and schedule a retry.
            console.error('[Socket] failed to create WebSocket:', err);
            this._scheduleReconnect();
            return;
        }

        // Receive image/video frames as ArrayBuffer, not Blob.
        ws.binaryType = 'arraybuffer';
        this._ws      = ws;

        ws.onopen = () =>
        {
            this._retry_count      = 0;   // reset backoff on success
            this._opened_once      = true;
            this._auth_fail_count  = 0;   // handshake succeeded → JWT is good
            useConnectionStore.getState().setStatus('open');
            if (this._on_open) this._on_open();
        };

        ws.onmessage = (event) =>
        {
            // Distinguish JSON (string) from binary frame (ArrayBuffer),
            // exactly like MockSocket splits onMessage vs onBinary.
            if (typeof event.data === 'string')
            {
                let parsed;
                try
                {
                    parsed = JSON.parse(event.data);
                }
                catch (err)
                {
                    console.warn('[Socket] received non-JSON text message:', event.data, err);
                    return;
                }
                if (this._on_message) this._on_message(parsed);
            }
            else
            {
                // Binary path: raw JPEG bytes that pair with the last frame_meta.
                if (this._on_binary) this._on_binary(event.data);
            }
        };

        ws.onerror = (event) =>
        {
            console.warn('[Socket] socket error:', event);
            if (this._on_error) this._on_error(event);
        };

        ws.onclose = () =>
        {
            const never_opened = !this._opened_once;
            this._ws           = null;
            this._opened_once  = false;      // reset for the next attempt
            useConnectionStore.getState().setStatus('closed');
            if (this._on_close) this._on_close();

            // JWT expired detection: Gateway rejects at HTTP upgrade with 401,
            // browser reports onclose without ever calling onopen. Count these
            // consecutive failed opens while an auth_token is set; past the
            // threshold, force logout so the operator lands on LoginScreen.
            const has_token = !!useConnectionStore.getState().auth_token;
            if (never_opened && has_token && !this._closed_by_user)
            {
                this._auth_fail_count++;
                if (this._auth_fail_count >= Socket.AUTH_FAIL_THRESHOLD)
                {
                    // Try one refresh (HttpOnly refresh cookie is what the
                    // server needs — the browser sends it automatically). Only
                    // give up and log out if the refresh itself fails.
                    this._closed_by_user = true;   // pause the reconnect loop while we refresh
                    refreshAccessToken().then((result) =>
                    {
                        if (result.ok)
                        {
                            this._auth_fail_count = 0;
                            this._closed_by_user  = false;
                            this._openSocket();    // handshake with the new JWT
                        }
                        else
                        {
                            useUiStore.getState().addToast(
                                'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
                                'error'
                            );
                            logout();               // clears auth_token → LoginScreen
                        }
                    });
                    return;
                }
            }

            // Auto-reconnect unless WE closed it on purpose.
            if (!this._closed_by_user)
            {
                this._scheduleReconnect();
            }
        };
    }

    // ── Private: exponential backoff reconnect ─────────────────────────────

    _scheduleReconnect()
    {
        if (this._closed_by_user) return;

        // Backoff: base * 2^retries, capped. e.g. 500, 1000, 2000, ... up to 8000 ms.
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** this._retry_count, RECONNECT_MAX_MS);
        this._retry_count++;

        console.info(`[Socket] reconnecting in ${delay} ms (attempt ${this._retry_count})`);

        this._reconnect_timer = setTimeout(() =>
        {
            this._reconnect_timer = null;
            if (!this._closed_by_user) this._openSocket();
        }, delay);
    }
}

export default Socket;
