/* FrameCanvas.jsx — draws one JPEG binary frame onto an HTML <canvas> */
import { useEffect, useRef } from 'react'

/*
  Props:
    frame_buffer — ArrayBuffer containing a JPEG image (null = no frame yet)
    width        — canvas display width  (CSS px)
    height       — canvas display height (CSS px)
*/
function FrameCanvas({ frame_buffer, width = '100%', height = '100%' })
{
  const canvas_ref = useRef(null)

  useEffect(function ()
  {
    if (!frame_buffer || !canvas_ref.current) return

    /* decode the raw JPEG bytes into an ImageBitmap then blit to canvas */
    const blob        = new Blob([frame_buffer], { type: 'image/jpeg' })
    let   bitmap_ref  = null   // keep reference so we can close it

    createImageBitmap(blob).then(function (bitmap)
    {
      bitmap_ref = bitmap
      const ctx  = canvas_ref.current.getContext('2d')

      /* resize canvas to match actual image dimensions */
      canvas_ref.current.width  = bitmap.width
      canvas_ref.current.height = bitmap.height
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()  // release GPU memory
    })

    return function ()
    {
      if (bitmap_ref) bitmap_ref.close()
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
