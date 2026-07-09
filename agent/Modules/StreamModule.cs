using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using AgentSystem.Core;
using Serilog;
using AgentSystem.Utils;
using AgentSystem.Managers;

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
        
        // Quản lý luồng Stream bằng PeriodicTimer và CancellationToken
        private CancellationTokenSource streamCts;
        private Task streamTask;
        
        private int currentSequence = 0;
        private int currentQuality = 70;
        
        // Sử dụng SemaphoreSlim thay cho 'lock' truyền thống để hỗ trợ async/await
        private readonly SemaphoreSlim captureSemaphore = new SemaphoreSlim(1, 1);

        public override string[] SupportedCommands => new[] { "screenshot", "screen_stream", "screen_stream_stop" };
        
        public StreamModule(IAgentContext context, SecurityManager security, UIManager ui) 
            : base(context, security, ui) { }

        public override async Task ExecuteAsync(string action, JsonElement parameters, string commandId)
        {
            try
            {
                if (action == "screen_stream")
                {
                    int fps = parameters.TryGetProperty("fps", out var fpsProp) ? fpsProp.GetInt32() : 24;
                    int quality = parameters.TryGetProperty("quality", out var qProp) ? qProp.GetInt32() : 70;
                    await StartStreamAsync(fps, quality, commandId);
                }
                else if (action == "screen_stream_stop")
                {
                    StopStream(commandId);
                }
                else if (action == "screenshot")
                {
                    int quality = parameters.TryGetProperty("quality", out var qProp) ? qProp.GetInt32() : 90;
                    await TakeSingleScreenshotAsync(quality, commandId);
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

        private async Task StartStreamAsync(int fps, int quality, string commandId)
        {
            int safeFps = fps > 0 ? fps : 24;
            int intervalMs = 1000 / safeFps;
            currentQuality = quality;

            if (isStreaming)
            {
                // Nếu đang stream, khởi động lại luồng với cấu hình mới
                StopStream(commandId);
                Log.Information("Đã điều chỉnh luồng Stream sang FPS: {Fps}, Quality: {Quality}", safeFps, quality);
            }

            // Gọi Popup bất đồng bộ, không chặn Thread
            bool isApproved = await ui.ShowConsentPopupAsync("screen_stream", 30000);
            if (!isApproved)
            {
                context.SendResponse(new { type = "stream_denied", command_id = commandId, module = "screen", reason = "User declined permission" });
                return;
            }

            isStreaming = true;
            streamCommandId = commandId;
            currentSequence = 1;
            currentQuality = quality;

            context.SendResponse(new { type = "stream_started", command_id = commandId, module = "screen" });
            
            // Khởi tạo và chạy vòng lặp Stream ngầm
            streamCts = new CancellationTokenSource();
            streamTask = StreamLoopAsync(intervalMs, streamCts.Token);
        }

        private async Task StreamLoopAsync(int intervalMs, CancellationToken token)
        {
            // Sử dụng PeriodicTimer giúp tối ưu CPU và tránh nghẽn vòng lặp
            using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(intervalMs));
            
            try
            {
                while (await timer.WaitForNextTickAsync(token))
                {
                    await CaptureAndSendAsync(streamCommandId, currentQuality, true);
                }
            }
            catch (OperationCanceledException)
            {
                // Luồng stream bị hủy chủ động
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Lỗi nghiêm trọng trong vòng lặp Stream: {ErrorMessage}", ex.Message);
            }
        }

        private void StopStream(string commandId)
        {
            if (!isStreaming) return;
            isStreaming = false;
            
            // Hủy luồng PeriodicTimer an toàn
            streamCts?.Cancel();
            streamCts?.Dispose();
            streamCts = null;

            // Chặn tạm thời để dọn dẹp GDI+ an toàn
            captureSemaphore.Wait();
            try
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
            finally
            {
                captureSemaphore.Release();
            }

            context.SendResponse(new { type = "stream_stopped", command_id = commandId, module = "screen" });
        }

        private async Task TakeSingleScreenshotAsync(int quality, string commandId)
        {
             bool isApproved = await ui.ShowConsentPopupAsync("screenshot", 30000);
             if (!isApproved)
             {
                 context.SendResponse(new { type = "stream_denied", command_id = commandId, module = "screen" });
                 return;
             }
             
             await CaptureAndSendAsync(commandId, quality, false);
        }

        private async Task CaptureAndSendAsync(string commandId, int quality, bool isFromStream)
        {
            // Chờ tối đa 1000ms để vào vùng Critical Section (thay thế cho TryEnter)
            bool lockTaken = await captureSemaphore.WaitAsync(1000);
            
            if (!lockTaken)
            {
                if (isFromStream) return; // Rớt 1 frame stream thì bỏ qua
                
                context.SendResponse(new
                {
                    type = "ERROR",
                    command_id = commandId,
                    module = "screen",
                    message = "Hệ thống đang bận xử lý luồng ảnh khác, không thể chụp màn hình lúc này."
                });
                return; 
            }

            try
            {
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

                // Thực hiện copy pixel từ màn hình
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
                    seq = isFromStream ? currentSequence++ : 0, 
                    timestamp_ms = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                });
                
                context.SendBinaryFrame(imageBytes);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Lỗi quá trình chụp và scale ảnh: {ErrorMessage}", ex.Message);
                
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
                // Giải phóng Semaphore
                captureSemaphore.Release();
            }
        }
    }
}