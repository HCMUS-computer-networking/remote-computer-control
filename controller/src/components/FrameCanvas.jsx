// FrameCanvas.jsx — shared primitive that draws one JPEG binary frame onto a <canvas>.
//
// Placed directly under src/components/ (not in livescreen/) because both the
// live-screen views (GridView, FocusView, ScreenTab) and WebcamTab import it.
//
// MEMORY MANAGEMENT (important — read before modifying):
//
// Each JPEG ArrayBuffer is decoded into an ImageBitmap via createImageBitmap().
// ImageBitmap holds GPU-backed pixel data that is NOT garbage-collected
// automatically — we MUST call bitmap.close() to release that memory.
//
// Lifecycle:
//   1. New frame_buffer arrives → create Blob → createImageBitmap()
//   2. Draw the bitmap onto the canvas with drawImage()
//   3. Immediately call bitmap.close() to free GPU memory
//   4. On unmount or before processing the next frame, close any bitmap
//      that might still be pending from an in-flight decode
//
// The "cancelled" flag prevents a stale decode callback from drawing
// onto a canvas that already shows a newer frame or has been unmounted.

import { useEffect, useRef } from 'react'

// Props:
//   frame_buffer — ArrayBuffer containing raw JPEG bytes (null = no frame yet)
//   module       — "screen" | "webcam" (data attribute for CSS / debugging hooks)
//   label        — optional short caption (e.g. "LIVE", "WEBCAM"). When provided,
//                  drives the aria-label and shows a small corner badge.
//                  Views that already render their own status badge (GridView tile
//                  header, ScreenTab toolbar) simply omit this prop.
//   width        — CSS width  for the <canvas> element (default "100%")
//   height       — CSS height for the <canvas> element (default "100%")
function FrameCanvas({ frame_buffer, frame_meta = null, module = 'screen', label, width = '100%', height = '100%' })
{
    const canvas_ref = useRef(null)

    useEffect(function ()
    {
        if (!frame_buffer || !canvas_ref.current) return

        // Delta-encoding contract (see docs/protocol/Livescreen.json):                             //
        //   is_keyframe=true  → bitmap is the FULL frame; meta.w/h is full size, x/y = 0.         //
        //   is_keyframe=false → bitmap covers only the diff rect at (meta.x, meta.y); the         //
        //                       canvas MUST NOT be resized — that would wipe prior pixels.        //
        // When meta is absent (Webcam sends full frames only, or single screenshot), fall         //
        // back to the legacy behavior of sizing the canvas to the bitmap and drawing at 0,0.      //
        const has_meta   = frame_meta && typeof frame_meta === 'object'
        const is_delta   = has_meta && frame_meta.is_keyframe === false
        const draw_x     = is_delta ? (frame_meta.x | 0) : 0
        const draw_y     = is_delta ? (frame_meta.y | 0) : 0

        // Track whether this effect was cleaned up before the async decode finished.
        // If cancelled is true when the promise resolves, skip drawing — the canvas
        // may already belong to a newer frame or the component may be unmounted.
        let cancelled  = false
        let bitmap_ref = null

        const blob = new Blob([frame_buffer], { type: 'image/jpeg' })

        createImageBitmap(blob).then(function (bitmap)
        {
            // Another frame arrived (or unmount happened) while we were decoding.
            // Close the bitmap immediately — drawing it would overwrite newer data.
            if (cancelled)
            {
                bitmap.close()
                return
            }

            bitmap_ref = bitmap

            const cvs = canvas_ref.current
            if (!cvs) { bitmap.close(); return }

            const ctx = cvs.getContext('2d')

            if (is_delta && cvs.width > 0 && cvs.height > 0)
            {
                // Partial redraw: paste the diff bitmap at its bounding-box origin.                //
                // Do NOT touch cvs.width/height — that would clear the whole canvas.               //
                ctx.drawImage(bitmap, draw_x, draw_y)
            }
            else
            {
                // Keyframe (or first frame, or meta-less full frame): resize canvas to             //
                // the full-frame dimensions and repaint from origin. Setting width/height         //
                // implicitly clears the canvas, which is exactly what a keyframe wants.           //
                const full_w = has_meta ? (frame_meta.w | 0) || bitmap.width  : bitmap.width
                const full_h = has_meta ? (frame_meta.h | 0) || bitmap.height : bitmap.height
                cvs.width  = full_w
                cvs.height = full_h
                ctx.drawImage(bitmap, 0, 0)
            }

            // Release GPU memory right after drawing.
            // The pixels are now copied into the canvas framebuffer,
            // so the ImageBitmap is no longer needed.
            bitmap.close()
            bitmap_ref = null
        })
        .catch(function (err)
        {
            // Corrupted or non-JPEG binary data — skip this frame silently.
            if (!cancelled)
            {
                console.warn('[FrameCanvas] failed to decode frame:', err)
            }
        })

        // Cleanup: if a new frame arrives before the current decode finishes,
        // React runs this cleanup first. We set cancelled=true so the stale
        // promise callback above will discard the old bitmap instead of drawing it.
        return function ()
        {
            cancelled = true
            if (bitmap_ref)
            {
                bitmap_ref.close()
                bitmap_ref = null
            }
        }
    }, [frame_buffer])

    const aria_label = label ? `${label} frame` : 'Live frame'

    // When no label is passed, we render the canvas alone — GridView and ScreenTab
    // already show their own status badges around it. When a label is passed
    // (WebcamTab), we wrap in a positioned container and add a corner badge.
    if (!label)
    {
        return (
            <canvas
                ref={canvas_ref}
                data-module={module}
                style={{ width, height, display: 'block', objectFit: 'contain' }}
                aria-label={aria_label}
            />
        )
    }

    return (
        <div className="frame-canvas" style={{ position: 'relative', width, height }}>
            <canvas
                ref={canvas_ref}
                data-module={module}
                style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
                aria-label={aria_label}
            />
            <span className="frame-canvas__badge" aria-hidden="true">
                <span className="frame-canvas__badge-dot" />
                {label}
            </span>
        </div>
    )
}

export default FrameCanvas
