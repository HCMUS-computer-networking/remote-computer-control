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
using System.Security.Cryptography;
using System.Linq;

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
        
        private Bitmap previousBitmap = null;
        private int framesSinceLastKeyframe = 0;
        private const int KeyframeInterval = 30;
        
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
            else
            {
                // Chỉ đếm ngược 10s nếu là phiên stream hoàn toàn mới
                ui.ShowCountdown(10, "Cảnh báo Chia sẻ Màn hình", "Màn hình sẽ bị theo dõi sau {0} giây...");
                await Task.Delay(10000);
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
                previousBitmap?.Dispose();
                previousBitmap = null;
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

             
             await CaptureAndSendAsync(commandId, quality, false);
        }
        public override void OnDisconnected()
        {
            if (isStreaming)
            {
                Log.Warning("[StreamModule] Phát hiện mất kết nối mạng. Đang tự động ngắt quay màn hình...");
                StopStream("auto_disconnect"); 
            }
        }

        private unsafe Rectangle GetDifferenceBoundingBox(Bitmap current, Bitmap previous)
        {
            if (current.Width != previous.Width || current.Height != previous.Height)
                return new Rectangle(0, 0, current.Width, current.Height);

            int width = current.Width;
            int height = current.Height;

            BitmapData dataCur = current.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            BitmapData dataPrev = previous.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);

            int minX = width, minY = height, maxX = 0, maxY = 0;
            bool hasChanges = false;

            try
            {
                byte* ptrCur = (byte*)dataCur.Scan0;
                byte* ptrPrev = (byte*)dataPrev.Scan0;
                int stride = dataCur.Stride;

                for (int y = 0; y < height; y++)
                {
                    int* rowCur = (int*)(ptrCur + y * stride);
                    int* rowPrev = (int*)(ptrPrev + y * stride);
                    
                    bool rowHasChange = false;
                    int rowMinX = width;
                    int rowMaxX = 0;

                    for (int x = 0; x < width; x++)
                    {
                        if (rowCur[x] != rowPrev[x])
                        {
                            if (x < rowMinX) rowMinX = x;
                            if (x > rowMaxX) rowMaxX = x;
                            rowHasChange = true;
                        }
                    }

                    if (rowHasChange)
                    {
                        hasChanges = true;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                        if (rowMinX < minX) minX = rowMinX;
                        if (rowMaxX > maxX) maxX = rowMaxX;
                    }
                }
            }
            finally
            {
                current.UnlockBits(dataCur);
                previous.UnlockBits(dataPrev);
            }

            if (!hasChanges)
                return Rectangle.Empty;

            return new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
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
                
                Rectangle diffRect;
                bool isKeyframe = false;

                if (!isFromStream || previousBitmap == null || framesSinceLastKeyframe >= KeyframeInterval)
                {
                    diffRect = new Rectangle(0, 0, TargetSize.Width, TargetSize.Height);
                    isKeyframe = true;
                    if (isFromStream) framesSinceLastKeyframe = 0;
                }
                else
                {
                    diffRect = GetDifferenceBoundingBox(scaledBitmap, previousBitmap);
                    if (diffRect == Rectangle.Empty) return; // Không có thay đổi
                    framesSinceLastKeyframe++;
                }

                byte[] imageBytes;
                if (diffRect.Width == TargetSize.Width && diffRect.Height == TargetSize.Height)
                {
                    imageBytes = ImageUtils.CompressImageToJpeg(scaledBitmap, quality);
                }
                else
                {
                    using (Bitmap diffBitmap = new Bitmap(diffRect.Width, diffRect.Height, PixelFormat.Format32bppArgb))
                    using (Graphics g = Graphics.FromImage(diffBitmap))
                    {
                        g.DrawImage(scaledBitmap, new Rectangle(0, 0, diffRect.Width, diffRect.Height), diffRect, GraphicsUnit.Pixel);
                        imageBytes = ImageUtils.CompressImageToJpeg(diffBitmap, quality);
                    }
                }

                if (isFromStream)
                {
                    if (previousBitmap == null || previousBitmap.Size != TargetSize)
                    {
                        previousBitmap?.Dispose();
                        previousBitmap = new Bitmap(TargetSize.Width, TargetSize.Height, PixelFormat.Format32bppArgb);
                    }
                    using (Graphics gPrev = Graphics.FromImage(previousBitmap))
                    {
                        gPrev.DrawImage(scaledBitmap, Point.Empty);
                    }
                }
                
                long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                ushort seq = (ushort)(isFromStream ? currentSequence++ : 0);
                await UdpStreamSender.SendFrameAsync(context.AgentId, commandId, 0, seq, imageBytes, timestamp, isKeyframe, diffRect, context.Crypto);
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