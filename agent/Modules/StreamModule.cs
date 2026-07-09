using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;
using AgentSystem.Core;
using Timer = System.Threading.Timer;
using Serilog;
using AgentSystem.Utils;

namespace AgentSystem.Modules
{
    public class StreamModule : BaseModule
    {
        private Bitmap captureBitmap;
        private Graphics captureGraphics;
        private Bitmap scaledBitmap;
        private Graphics scaledGraphics;
        private Size lastScreenSize;
        private readonly Size TargetSize = new Size(1280, 720);
        
        private bool isStreaming = false;
        private string streamCommandId = string.Empty;
        private Timer streamTimer;
        private int currentSequence = 0;
        private int currentQuality = 70;
        
        // Khóa đồng bộ đa luồng để tránh nghẽn
        private readonly object captureLock = new object();

        public StreamModule(AgentClient context) : base(context) { }

        public override void Execute(string action, JsonElement parameters, string commandId)
        {
            try
            {
                if (action == "screen_stream")
                {
                    int fps = parameters.TryGetProperty("fps", out var fpsProp) ? fpsProp.GetInt32() : 24;
                    int quality = parameters.TryGetProperty("quality", out var qProp) ? qProp.GetInt32() : 70;
                    StartStream(fps, quality, commandId);
                }
                else if (action == "screen_stream_stop")
                {
                    StopStream(commandId);
                }
                else if (action == "screenshot")
                {
                    int quality = parameters.TryGetProperty("quality", out var qProp) ? qProp.GetInt32() : 90;
                    TakeSingleScreenshot(quality, commandId);
                }
            }
            catch (Exception ex)
            {
                context.SendResponse(new
                {
                    type = "ERROR",
                    command_id = commandId,
                    module = "screen",
                    message = $"Error in StreamModule: {ex.Message}"
                });
            }
        }

        private void StartStream(int fps, int quality, string commandId)
        {
            int safeFps = fps > 0 ? fps : 24;
            int intervalMs = 1000 / safeFps;
            currentQuality = quality;

            if (isStreaming)
            {
                streamTimer?.Change(0, intervalMs); // Đổi chu kỳ phát ảnh lập tức
                Log.Information("Đã điều chỉnh luồng Stream sang FPS: {Fps}, Quality: {Quality}", safeFps, quality);
                return;
            }

            bool isApproved = ui.ShowConsentPopup("screen_stream", 30000);
            if (!isApproved)
            {
                context.SendResponse(new { type = "stream_denied", command_id = commandId, module = "screen", reason = "User declined permission" });
                return;
            }

            isStreaming = true;
            streamCommandId = commandId; // Lưu commandId của luồng stream
            currentSequence = 1;
            currentQuality = quality;

            context.SendResponse(new { type = "stream_started", command_id = commandId, module = "screen" });
            
            // Truyền cờ isFromStream = true để phân biệt đây là ảnh từ luồng liên tục
            streamTimer = new Timer(state => CaptureAndSend(streamCommandId, currentQuality, true), null, 0, intervalMs);
        }

        private void StopStream(string commandId)
        {
            if (!isStreaming) return;
            isStreaming = false;
            
            streamTimer?.Dispose();
            streamTimer = null;

            lock (captureLock)
            {
                captureGraphics?.Dispose();
                captureGraphics = null;
                captureBitmap?.Dispose();
                captureBitmap = null;
                scaledGraphics?.Dispose();
                scaledGraphics = null;
                scaledBitmap?.Dispose();
                scaledBitmap = null;
                lastScreenSize = Size.Empty;
            }

            context.SendResponse(new { type = "stream_stopped", command_id = commandId, module = "screen" });
        }

        private void TakeSingleScreenshot(int quality, string commandId)
        {
             bool isApproved = ui.ShowConsentPopup("screenshot", 30000);
             if (!isApproved)
             {
                 context.SendResponse(new { type = "stream_denied", command_id = commandId, module = "screen" });
                 return;
             }
             
             // Gọi hàm capture với cờ isFromStream = false cho lệnh đơn lẻ
             CaptureAndSend(commandId, quality, false);
        }

        // HÀM ĐÃ ĐƯỢC CẢI TIẾN ĐỂ FIX LỖI "SILENT FAILURE"
        private void CaptureAndSend(string commandId, int quality, bool isFromStream)
        {
            bool lockTaken = false;
            try
            {
                // Thay vì TryEnter ngay lập tức (0ms), cho phép chờ tối đa 1000ms
                Monitor.TryEnter(captureLock, 1000, ref lockTaken);
                
                if (!lockTaken)
                {
                    // Nếu Timer Stream rớt 1 frame (do đang kẹt xử lý lệnh khác) -> Bỏ qua, không sao
                    if (isFromStream) return;
                    
                    // Nếu là lệnh chụp đơn lẻ bị kẹt -> BẮT BUỘC BÁO LỖI VỀ CONTROLLER
                    context.SendResponse(new
                    {
                        type = "ERROR",
                        command_id = commandId,
                        module = "screen",
                        message = "Hệ thống đang bận xử lý luồng ảnh khác, không thể chụp màn hình lúc này."
                    });
                    return; 
                }

                Rectangle bounds = Screen.PrimaryScreen.Bounds;
                
                if (captureBitmap == null || lastScreenSize != bounds.Size)
                {
                    captureGraphics?.Dispose();
                    captureBitmap?.Dispose();
                    scaledGraphics?.Dispose();
                    scaledBitmap?.Dispose();
                    
                    captureBitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
                    captureGraphics = Graphics.FromImage(captureBitmap);
                    
                    scaledBitmap = new Bitmap(TargetSize.Width, TargetSize.Height, PixelFormat.Format32bppArgb);
                    scaledGraphics = Graphics.FromImage(scaledBitmap);
                    scaledGraphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                    
                    lastScreenSize = bounds.Size;
                }

                captureGraphics.CopyFromScreen(Point.Empty, Point.Empty, bounds.Size);
                scaledGraphics.DrawImage(captureBitmap, new Rectangle(0, 0, TargetSize.Width, TargetSize.Height));
                
                byte[] imageBytes = ImageUtils.CompressImageToJpeg(scaledBitmap, quality);
                
                context.SendResponse(new
                {
                    type = "frame_meta",
                    module = "screen",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    w = TargetSize.Width,
                    h = TargetSize.Height,
                    len = imageBytes.Length,
                    seq = isFromStream ? currentSequence++ : 0, // Ảnh đơn lẻ không cần đếm sequence
                    timestamp_ms = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                });
                
                context.SendBinaryFrame(imageBytes);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Lỗi quá trình chụp và scale ảnh: {ErrorMessage}", ex.Message);
                
                // Báo lỗi về nếu là ảnh chụp đơn lẻ
                if (!isFromStream)
                {
                    context.SendResponse(new { type = "ERROR", command_id = commandId, module = "screen", message = $"Lỗi chụp ảnh: {ex.Message}" });
                }
                else if (isStreaming)
                {
                    StopStream(commandId);
                }
            }
            finally
            {
                if (lockTaken) Monitor.Exit(captureLock);
            }
        }
    }
}