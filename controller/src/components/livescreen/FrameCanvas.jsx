// FrameCanvas.jsx — draws one JPEG binary frame onto an HTML <canvas>.
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
//   width        — CSS width  for the <canvas> element (default "100%")
//   height       — CSS height for the <canvas> element (default "100%")
function FrameCanvas({ frame_buffer, width = '100%', height = '100%' })
{
    const canvas_ref = useRef(null)

    useEffect(function ()
    {
        if (!frame_buffer || !canvas_ref.current) return

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

            // Match canvas internal resolution to the actual image dimensions
            // so drawImage renders 1:1 without scaling artifacts.
            cvs.width  = bitmap.width
            cvs.height = bitmap.height
            ctx.drawImage(bitmap, 0, 0)

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

    return (
        <canvas
            ref={canvas_ref}
            style={{ width, height, display: 'block', objectFit: 'contain' }}
            aria-label="Live screen frame"
        />
    )
}

export default FrameCanvas
