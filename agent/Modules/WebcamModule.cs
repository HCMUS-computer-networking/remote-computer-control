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
        private readonly object captureLock = new object();
        private int currentFps = 15;

        public override string[] SupportedCommands => new[] { "webcam_start", "webcam_stop" };

        public WebcamModule(IAgentContext context, SecurityManager security, UIManager ui) 
            : base(context, security, ui) { }

        public override void Execute(string action, JsonElement parameters, string commandId)
        {
            if (action == "webcam_start")
            {
                currentQuality = parameters.TryGetProperty("quality", out var qProp) ? qProp.GetInt32() : 60;
                currentFps = parameters.TryGetProperty("fps", out var fpsProp) ? fpsProp.GetInt32() : 15; // Đọc FPS
                StartWebcamWithConsent(commandId);
            }
            else if (action == "webcam_stop")
            {
                StopWebcam(commandId);
            }
        }

        // 1. SỬA: Thêm từ khóa 'async' để cho phép dùng 'await Task.Delay'
        private async void StartWebcamWithConsent(string commandId)
        {
            // 1. Xin quyền Consent
            bool isApproved = ui.ShowConsentPopup("webcam", 30000);
            if (!isApproved)
            {
                // 2. SỬA: Bổ sung agent_id vào phản hồi
                context.SendResponse(new 
                { 
                    type = "webcam_denied", 
                    agent_id = context.AgentId,
                    command_id = commandId, 
                    reason = "User declined permission" 
                });
                return;
            }

            // 2. Minh bạch: Đếm ngược 10 giây bất đồng bộ
            ui.ShowWebcamCountdown(10);
            await Task.Delay(10000);

            // Kích hoạt phần cứng bằng OpenCV
            capture = new VideoCapture(0); // Mở camera mặc định (index 0)
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
            else
            {
                Log.Information("Độ phân giải Webcam hiện tại: {W}x{H}", currentWidth, currentHeight);
            }

            // Hiển thị overlay cảnh báo
            ui.ShowRedDotOverlay();

            isCapturing = true;
            currentSequence = 1;

            // Bắt đầu vòng lặp đọc khung hình ở background thread
            _ = Task.Run(CaptureLoop); //chu dong chay ngam

            context.SendResponse(new 
            { 
                type = "webcam_started", 
                agent_id = context.AgentId,
                command_id = commandId 
            });
        }

        private void CaptureLoop()
        {
            try
            {
                using (Mat frame = new Mat())
                {
                    while (isCapturing && capture != null && !capture.IsDisposed)
                    {
                        if (capture.Read(frame) && !frame.Empty())
                            ProcessAndSendFrame(frame);

                        int sleepMs = 1000 / (currentFps > 0 ? currentFps : 15);
                        Thread.Sleep(sleepMs);
                    }
                }
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Lỗi vòng lặp thu hình Webcam ngầm: {ErrorMessage}", ex.Message);
            }
            finally
            {
                // 3. SỬA: An toàn giải phóng phần cứng và giao diện khi ngắt luồng
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

        private void ProcessAndSendFrame(Mat frame)
        {
            bool lockTaken = false;
            Monitor.TryEnter(captureLock, ref lockTaken);
            if (!lockTaken) return;

            try
            {
                using (Bitmap bitmap = frame.ToBitmap())
                {
                    byte[] frameBytes = ImageUtils.CompressImageToJpeg(bitmap, currentQuality);

                    context.SendResponse(new
                    {
                        type = "frame_meta",
                        module = "webcam",
                        agent_id = context.AgentId,
                        w = bitmap.Width,
                        h = bitmap.Height,
                        len = frameBytes.Length,
                        seq = currentSequence++,
                        timestamp_ms = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                    });

                    context.SendBinaryFrame(frameBytes);
                }
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Lỗi xử lý và gửi khung hình Webcam: {ErrorMessage}", ex.Message);
            }
            finally
            {
                if (lockTaken) Monitor.Exit(captureLock);
            }
        }

        private void StopWebcam(string commandId)
        {
            // 4. SỬA: Chỉ cần hạ cờ isCapturing. CaptureLoop sẽ thoát vòng lặp 
            // và tự động giải phóng 'capture' + ẩn Red Dot trong khối finally một cách an toàn.
            isCapturing = false;

            context.SendResponse(new 
            { 
                type = "webcam_stopped", 
                agent_id = context.AgentId,
                command_id = commandId 
            });
        }
    }
}