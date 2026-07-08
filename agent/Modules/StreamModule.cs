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
        private Timer streamTimer;
        private int currentSequence = 0;
        private int currentQuality = 70;
        
        // Khóa đồng bộ đa luồng để tránh nghẽn khi mã hóa ảnh chậm hơn tốc độ Timer
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

            // 1. Ràng buộc bảo mật: Xin quyền Consent theo Đặc tả Kỹ thuật
            bool isApproved = ui.ShowConsentPopup("screen_stream", 30000);
            if (!isApproved)
            {
                context.SendResponse(new
                {
                    type = "stream_denied",
                    command_id = commandId,
                    module = "screen",
                    reason = "User declined permission"
                });
                return;
            }

            // 2. Thiết lập trạng thái
            isStreaming = true;
            currentSequence = 1;
            currentQuality = quality;

            // Gửi xác nhận luồng đã được bật
            context.SendResponse(new 
            { 
                type = "stream_started", 
                command_id = commandId, 
                module = "screen" 
            });

            // 3. Khởi tạo Timer chụp màn hình định kỳ
            streamTimer = new Timer(CaptureAndSendFrame, commandId, 0, intervalMs);
        }

        private void StopStream(string commandId)
        {
            if (!isStreaming) return;

            isStreaming = false;
            streamTimer?.Dispose();
            streamTimer = null;

            lock (captureLock)
            {
                // Dọn dẹp cả 2 bộ đệm
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

            context.SendResponse(new 
            { 
                type = "stream_stopped", 
                command_id = commandId, 
                module = "screen" 
            });
        }

        private void TakeSingleScreenshot(int quality, string commandId)
        {
             bool isApproved = ui.ShowConsentPopup("screenshot", 30000);
             if (!isApproved)
             {
                 context.SendResponse(new { type = "stream_denied", command_id = commandId, module = "screen" });
                 return;
             }
             
             currentQuality = quality;
             currentSequence = 1;
             
             // Thực thi chụp trực tiếp một lần
             CaptureAndSendFrame(commandId);
        }

        private void CaptureAndSendFrame(object state)
        {
            if (!isStreaming && state != null && !state.ToString().Contains("-")) 
            {
                if (!isStreaming && state is string command && command != "") return;
            }

            bool lockTaken = false;
            try
            {
                Monitor.TryEnter(captureLock, ref lockTaken);
                if (!lockTaken) return; 

                string commandId = state as string ?? string.Empty;
                Rectangle bounds = Screen.PrimaryScreen.Bounds;

                // 1. KHỞI TẠO BỘ NHỚ ĐỆM NẾU LÀ LẦN ĐẦU HOẶC MÀN HÌNH BỊ ĐỔI ĐỘ PHÂN GIẢI
                if (captureBitmap == null || lastScreenSize != bounds.Size)
                {
                    captureGraphics?.Dispose();
                    captureBitmap?.Dispose();
                    scaledGraphics?.Dispose();
                    scaledBitmap?.Dispose();
                    
                    // Khởi tạo vùng nhớ cho ảnh gốc (Full phân giải)
                    captureBitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
                    captureGraphics = Graphics.FromImage(captureBitmap);
                    
                    // Khởi tạo vùng nhớ cho ảnh đã thu nhỏ (Luôn là 1280x720)
                    scaledBitmap = new Bitmap(TargetSize.Width, TargetSize.Height, PixelFormat.Format32bppArgb);
                    scaledGraphics = Graphics.FromImage(scaledBitmap);
                    
                    // Sử dụng thuật toán Bilinear để thu nhỏ nhanh mà ít hao CPU nhất
                    scaledGraphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                    
                    lastScreenSize = bounds.Size;
                }

                // 2. Chụp màn hình vào ảnh gốc
                captureGraphics.CopyFromScreen(Point.Empty, Point.Empty, bounds.Size);
                
                // 3. Ép/Vẽ lại ảnh gốc xuống kích thước 720p
                scaledGraphics.DrawImage(captureBitmap, new Rectangle(0, 0, TargetSize.Width, TargetSize.Height));

                // 4. Nén thành JPEG từ ảnh 720p để gửi đi
                byte[] imageBytes = CompressImageToJpeg(scaledBitmap, currentQuality);

                context.SendResponse(new
                {
                    type = "frame_meta",
                    module = "screen",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    w = TargetSize.Width,   // Báo cho Controller biết khung hình là 1280
                    h = TargetSize.Height,  // Báo cho Controller biết khung hình là 720
                    len = imageBytes.Length,
                    seq = currentSequence++,
                    timestamp_ms = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                });

                context.SendBinaryFrame(imageBytes);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Lỗi quá trình chụp và scale Stream Màn hình: {ErrorMessage}", ex.Message);
                if (isStreaming) StopStream(state as string);
            }
            finally
            {
                if (lockTaken) Monitor.Exit(captureLock);
            }
        }

        private byte[] CompressImageToJpeg(Bitmap bmp, int quality)
        {
            ImageCodecInfo jpegEncoder = GetEncoder(ImageFormat.Jpeg);
            
            using (var encoderParameters = new EncoderParameters(1))
            using (var memoryStream = new MemoryStream())
            {
                var encoderParameter = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
                encoderParameters.Param[0] = encoderParameter;
                
                // Lưu vào luồng bộ nhớ với tham số nén
                bmp.Save(memoryStream, jpegEncoder, encoderParameters);
                return memoryStream.ToArray();
            }
        }

        private ImageCodecInfo GetEncoder(ImageFormat format)
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
            foreach (ImageCodecInfo codec in codecs)
            {
                if (codec.FormatID == format.Guid)
                {
                    return codec;
                }
            }
            return null;
        }
    }
}