using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgentSystem.Core;
using OpenCvSharp;
using OpenCvSharp.Extensions;
using Serilog;
using AgentSystem.Utils;
using AgentSystem.Managers;

namespace AgentSystem.Modules
{
    public class WebcamModule : BaseModule
    {
        private VideoCapture capture;
        private bool isCapturing = false;
        private int currentSequence = 0;
        private int currentQuality = 60;
        private int currentFps = 15;
        
        // Cải tiến sử dụng SemaphoreSlim thay thế lock để có thể dùng với async/await
        private readonly SemaphoreSlim captureSemaphore = new SemaphoreSlim(1, 1);
        private CancellationTokenSource webcamCts;

        public override string[] SupportedCommands => new[] { "webcam_start", "webcam_stop" };

        public WebcamModule(IAgentContext context, SecurityManager security, UIManager ui) 
            : base(context, security, ui) { }

        public override async Task ExecuteAsync(string action, JsonElement parameters, string commandId)
        {
            if (action == "webcam_start")
            {
                currentQuality = parameters.TryGetProperty("quality", out var qProp) ? qProp.GetInt32() : 60;
                currentFps = parameters.TryGetProperty("fps", out var fpsProp) ? fpsProp.GetInt32() : 15;
                await StartWebcamWithConsentAsync(commandId);
            }
            else if (action == "webcam_stop")
            {
                StopWebcam(commandId);
            }
        }

        public override void OnDisconnected()
        {
            if (isCapturing)
            {
                Log.Warning("[WebcamModule] Phát hiện mất kết nối mạng. Đang tự động tắt Webcam...");
                StopWebcam("auto_disconnect");
            }
        }

        private async Task StartWebcamWithConsentAsync(string commandId)
        {
            if (isCapturing)
            {
                Log.Information("Đã điều chỉnh Webcam sang FPS: {Fps}, Quality: {Quality}", currentFps, currentQuality);
                context.SendResponse(new { type = "webcam_updated", agent_id = context.AgentId, command_id = commandId });
                return;
            }

            ui.ShowCountdown(10, "Cảnh báo Ghi hình", "Camera sẽ được kích hoạt sau {0} giây...");
            await Task.Delay(10000);

            capture = new VideoCapture(0); 
            if (!capture.IsOpened())
            {
                context.SendResponse(new 
                { 
                    type = "ERROR", 
                    agent_id = context.AgentId,
                    command_id = commandId,
                    message = "No webcam found or access denied" 
                });
                return;
            }
            
            double currentWidth = capture.Get(VideoCaptureProperties.FrameWidth);
            double currentHeight = capture.Get(VideoCaptureProperties.FrameHeight);

            if (currentWidth > 1280 || currentHeight > 720)
            {
                capture.Set(VideoCaptureProperties.FrameWidth, 1280);
                capture.Set(VideoCaptureProperties.FrameHeight, 720);
                Log.Information("Đã giảm độ phân giải Webcam từ {W}x{H} xuống 1280x720", currentWidth, currentHeight);
            }

            ui.ShowRedDotOverlay();

            isCapturing = true;
            currentSequence = 1;
            
            webcamCts = new CancellationTokenSource();

            // Khởi động luồng chạy ngầm OpenCV (Vẫn dùng Task.Run vì capture.Read() có thể block)
            _ = Task.Run(() => CaptureLoopAsync(webcamCts.Token, commandId));

            context.SendResponse(new 
            { 
                type = "webcam_started", 
                agent_id = context.AgentId,
                command_id = commandId 
            });
        }

        private async Task CaptureLoopAsync(CancellationToken token, string commandId)
        {
            try
            {
                using (Mat frame = new Mat())
                {
                    while (isCapturing && capture != null && !capture.IsDisposed && !token.IsCancellationRequested)
                    {
                        if (capture.Read(frame) && !frame.Empty())
                        {
                            await ProcessAndSendFrameAsync(frame, commandId);
                        }

                        int sleepMs = 1000 / (currentFps > 0 ? currentFps : 15);
                        
                        // Thay thế Thread.Sleep bằng Delay bất đồng bộ
                        await Task.Delay(sleepMs, token);
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // Ngắt mượt mà khi huỷ Token
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Lỗi vòng lặp thu hình Webcam ngầm: {ErrorMessage}", ex.Message);
            }
            finally
            {
                isCapturing = false;

                if (capture != null)
                {
                    try
                    {
                        if (!capture.IsDisposed) capture.Release();
                        capture.Dispose();
                    }
                    catch { }
                    capture = null;
                }

                ui.HideRedDotOverlay(); 
            }
        }

        private async Task ProcessAndSendFrameAsync(Mat frame, string commandId)
        {
            bool lockTaken = await captureSemaphore.WaitAsync(0);
            if (!lockTaken) return;

            try
            {
                using (Bitmap bitmap = frame.ToBitmap())
                {
                    byte[] frameBytes = ImageUtils.CompressImageToJpeg(bitmap, currentQuality);

                    long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    ushort seq = (ushort)currentSequence++;
                    Rectangle bounds = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
                    await UdpStreamSender.SendFrameAsync(context.AgentId, commandId, 1, seq, frameBytes, timestamp, true, bounds, context.Crypto);
                }
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Lỗi xử lý và gửi khung hình Webcam: {ErrorMessage}", ex.Message);
            }
            finally
            {
                captureSemaphore.Release();
            }
        }

        private void StopWebcam(string commandId)
        {
            isCapturing = false;
            
            // Ra lệnh ngừng delay ngay lập tức
            webcamCts?.Cancel();
            webcamCts?.Dispose();
            webcamCts = null;

            context.SendResponse(new 
            { 
                type = "webcam_stopped", 
                agent_id = context.AgentId,
                command_id = commandId 
            });
        }
    }
}