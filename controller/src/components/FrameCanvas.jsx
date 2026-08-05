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
import frameEventBus from '../services/FrameEventBus'

// Props:
//   agent_id     — (Mới) ID của agent để subscribe EventBus
//   frame_buffer — (Legacy) Dữ liệu ảnh JPEG cứng (cho screenshot tĩnh).
//   module       — "screen" | "webcam"
//   label        — caption ngắn gọn
//   width        — chiều rộng CSS
//   height       — chiều cao CSS
function FrameCanvas({ agent_id, frame_buffer, frame_meta = null, module = 'screen', label, width = '100%', height = '100%', onFrameRendered })
{
    const canvas_ref = useRef(null)

    useEffect(function ()
    {
        let is_drawing = false
        // Khai báo mảng queue cục bộ cho từng instance của FrameCanvas
        let frame_queue = [] 
        let animation_frame_id = null
        let current_bitmap_ref = null
        let last_rendered_seq = -1
        let waiting_for_keyframe = true // Khởi tạo: luồng mới BẮT BUỘC phải chờ Keyframe đầu tiên

        const processFrame = (buffer, meta) => {
            if (!buffer || !canvas_ref.current) return

            if (meta) {
                if (last_rendered_seq !== -1) {
                    if (meta.seq < last_rendered_seq && (last_rendered_seq - meta.seq) > 100) {
                        last_rendered_seq = -1; // Reset on stream restart
                        waiting_for_keyframe = true;
                    } else if (meta.seq > last_rendered_seq + 1) {
                        waiting_for_keyframe = true; // We missed a UDP packet!
                    }
                } else if (meta.is_keyframe === false) {
                    // Chưa từng có frame nào (hoặc vừa restart) mà lại nhận được Delta frame
                    waiting_for_keyframe = true;
                }
                
                if (meta.seq <= last_rendered_seq) return;
                
                if (waiting_for_keyframe && meta.is_keyframe === false) {
                    last_rendered_seq = meta.seq; // keep tracking
                    return; // Drop delta frames until keyframe arrives
                }
                
                if (meta.is_keyframe === true) {
                    waiting_for_keyframe = false;
                }
            }

            if (is_drawing) {
                if (frame_queue.length >= 4) {
                    frame_queue.shift();
                    waiting_for_keyframe = true; // We dropped a frame locally!
                }
                frame_queue.push({ buffer, meta })
                return
            }

            is_drawing = true
            const blob = new Blob([buffer], { type: 'image/jpeg' })

            createImageBitmap(blob).then(function (bitmap) {
                current_bitmap_ref = bitmap

                // Vẽ đồng bộ với tần số quét của màn hình
                animation_frame_id = requestAnimationFrame(() => {
                    const cvs = canvas_ref.current
                    if (!cvs) { bitmap.close(); is_drawing = false; processNext(); return }

                    const ctx = cvs.getContext('2d')

                    const has_meta   = meta && typeof meta === 'object'
                    const is_delta   = has_meta && meta.is_keyframe === false
                    const draw_x     = is_delta ? (meta.x | 0) : 0
                    const draw_y     = is_delta ? (meta.y | 0) : 0

                    if (is_delta && cvs.width > 0 && cvs.height > 0) {
                        ctx.drawImage(bitmap, draw_x, draw_y)
                    } else {
                        const full_w = has_meta ? (meta.w | 0) || bitmap.width  : bitmap.width
                        const full_h = has_meta ? (meta.h | 0) || bitmap.height : bitmap.height
                        
                        // Chỉ cập nhật cvs.width / cvs.height khi thực sự thay đổi kích thước stream
                        if (cvs.width !== full_w || cvs.height !== full_h) {
                            cvs.width  = full_w
                            cvs.height = full_h
                        }
                        ctx.drawImage(bitmap, 0, 0)
                    }

                    if (meta) {
                        last_rendered_seq = Math.max(last_rendered_seq, meta.seq);
                    }
                    if (onFrameRendered) {
                        onFrameRendered(meta)
                    }

                    // Giải phóng bộ nhớ GPU ngay lập tức
                    bitmap.close()
                    current_bitmap_ref = null
                    is_drawing = false
                    
                    // Xử lý frame mới nhất bị kẹt lại (nếu có)
                    processNext()
                })
            }).catch(function (err) {
                console.warn('[FrameCanvas] failed to decode frame:', err)
                is_drawing = false
                processNext()
            })
        }

        const processNext = () => {
            while (frame_queue.length > 0) {
                const next = frame_queue.shift()
                if (next.meta) {
                    if (last_rendered_seq !== -1) {
                        if (next.meta.seq < last_rendered_seq && (last_rendered_seq - next.meta.seq) > 100) {
                            last_rendered_seq = -1;
                            waiting_for_keyframe = true;
                        } else if (next.meta.seq > last_rendered_seq + 1) {
                            waiting_for_keyframe = true;
                        }
                    } else if (next.meta.is_keyframe === false) {
                        waiting_for_keyframe = true;
                    }
                    if (next.meta.seq <= last_rendered_seq) continue;
                    
                    if (waiting_for_keyframe && next.meta.is_keyframe === false) {
                        last_rendered_seq = next.meta.seq;
                        continue;
                    }
                    if (next.meta.is_keyframe === true) {
                        waiting_for_keyframe = false;
                    }
                }
                processFrame(next.buffer, next.meta)
                break;
            }
        }

        // Đăng ký EventBus
        let unsubscribe = null
        if (agent_id) {
            unsubscribe = frameEventBus.on(agent_id, module, (buffer, meta) => {
                processFrame(buffer, meta)
            })
        }

        // Hỗ trợ Fallback Legacy (chụp ảnh 1 lần truyền trực tiếp bằng props)
        if (frame_buffer) {
            processFrame(frame_buffer, frame_meta)
        }

        // Gotcha 2: Cleanup (Gỡ Event Listener) để chống Memory Leak
        return function ()
        {
            if (unsubscribe) unsubscribe()
            if (animation_frame_id) cancelAnimationFrame(animation_frame_id)
            if (current_bitmap_ref) {
                current_bitmap_ref.close()
                current_bitmap_ref = null
            }
        }
    }, [agent_id, module, frame_buffer, frame_meta])

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
