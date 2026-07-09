using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Timer = System.Threading.Timer;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using Serilog;

namespace AgentSystem.Core
{
    public class WebSocketClient
    {
        public event Action OnDisconnectedEvent;
        private readonly AgentClient context;
        private readonly string url;
        
        private ClientWebSocket webSocket;
        private CancellationTokenSource cts;
        private Timer heartbeatTimer;
        
        // Cờ kiểm soát trạng thái kết nối
        private bool isReconnecting = false;
        
        // SemaphoreSlim đảm bảo không có 2 luồng cùng gọi SendAsync cùng lúc
        // (ClientWebSocket của .NET sẽ văng lỗi nếu SendAsync bị gọi đồng thời)
        private readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);

        public WebSocketClient(AgentClient context, string url)
        {
            this.context = context;
            this.url = url;
        }

        public void Connect()
        {
            // Bắt đầu tiến trình kết nối bất đồng bộ trong nền
            _ = ConnectAsync();
        }

        private async Task ConnectAsync()
        {
            try
            {
                // 1. Kiểm tra bắt buộc phải dùng WSS
                if (!url.StartsWith("wss://", StringComparison.OrdinalIgnoreCase))
                {
                    Log.Warning("[CẢNH BÁO] Hệ thống đang yêu cầu chạy WSS, nhưng cấu hình là WS. Cố gắng kết nối không an toàn...");
                }

                cts = new CancellationTokenSource();
                webSocket = new ClientWebSocket();

                // 2. CẤU HÌNH BỎ QUA LỖI CHỨNG CHỈ TỰ KÝ (Chỉ dùng cho môi trường Lab/Nội bộ)
                // Nếu Gateway có chứng chỉ xịn (Let's Encrypt, Cloudflare), bạn có thể bỏ qua đoạn này.
                webSocket.Options.RemoteCertificateValidationCallback = delegate (
                    object sender, 
                    X509Certificate certificate, 
                    X509Chain chain, 
                    SslPolicyErrors sslPolicyErrors) 
                {
                    // Trả về true để chấp nhận mọi chứng chỉ (Kể cả Self-signed)
                    // Khuyến cáo thực tế: Nên so sánh Hash của chứng chỉ ở đây để chống Fake Server
                    return true; 
                };

                Log.Information("[WebSocket] Đang kết nối bảo mật (TLS) tới {url}...", url);
                await webSocket.ConnectAsync(new Uri(url), cts.Token);
                Log.Information("[WebSocket] KẾT NỐI BẢO MẬT WSS THÀNH CÔNG!");
                
                isReconnecting = false;
                context.SendResponse(new { type = "REGISTER", agent_id = context.AgentId });
                StartHeartbeat();
                _ = ReceiveLoopAsync();
            }
            catch (Exception ex)
            {
                Log.Error(ex, "[WebSocket Lỗi] Không thể kết nối tới Gateway");
                _ = HandleReconnectAsync();
            }
        }

        public void Disconnect()
        {
            try
            {
                heartbeatTimer?.Dispose();
                cts?.Cancel();
                
                if (webSocket != null && webSocket.State == WebSocketState.Open)
                {
                    // Đóng kết nối an toàn với timeout
                    webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Agent shutting down", CancellationToken.None).Wait(2000);
                }
                
                webSocket?.Dispose();
                Log.Information("[WebSocket] Đã ngắt kết nối.");
            }
            catch (Exception ex)
            {
                Log.Error(ex, "[WebSocket] Lỗi khi ngắt kết nối: {Message}", ex.Message );
            }
        }

        public void SendText(string json)
        {
            _ = SendDataAsync(Encoding.UTF8.GetBytes(json), WebSocketMessageType.Text);
        }

        public void SendBinary(byte[] bytes)
        {
            _ = SendDataAsync(bytes, WebSocketMessageType.Binary);
        }

        private async Task SendDataAsync(byte[] data, WebSocketMessageType type)
        {
            if (webSocket == null || webSocket.State != WebSocketState.Open) return;

            await sendLock.WaitAsync();
            try
            {
                await webSocket.SendAsync(new ArraySegment<byte>(data), type, true, cts.Token);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "[WebSocket TX Lỗi] {Message}", ex.Message);
                _ = HandleReconnectAsync();
            }
            finally
            {
                sendLock.Release();
            }
        }

        private async Task ReceiveLoopAsync()
        {
            var buffer = new byte[8192]; // Bộ đệm 8KB cho mỗi chunk

            try
            {
                while (webSocket.State == WebSocketState.Open && !cts.Token.IsCancellationRequested)
                {
                    using (var ms = new MemoryStream())
                    {
                        WebSocketReceiveResult result;
                        do
                        {
                            result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), cts.Token);
                            
                            if (result.MessageType == WebSocketMessageType.Close)
                            {
                                Log.Information("[WebSocket] Server chủ động ngắt kết nối.");
                                OnDisconnectedEvent?.Invoke();
                                _ = HandleReconnectAsync();
                                return;
                            }
                            
                            ms.Write(buffer, 0, result.Count);
                        } 
                        while (!result.EndOfMessage);

                        // Xử lý gói tin văn bản (Điều khiển từ Controller)
                        if (result.MessageType == WebSocketMessageType.Text)
                        {
                            string message = Encoding.UTF8.GetString(ms.ToArray());
                            
                            // Lọc các gói tin Heartbeat để tránh làm rác log / Dispatcher
                            if (message.Contains("\"type\":\"PONG\"") || message.Contains("\"type\": \"PONG\""))
                            {
                                // Bỏ qua hoặc log lại
                                continue;
                            }

                            // Chuyển thông điệp cho MessageDispatcher phân tích
                            context.Dispatcher.Dispatch(message);
                        }
                    }
                }
            }
            catch (OperationCanceledException)
            {
                // Bị hủy chủ động từ hàm Disconnect
            }
            catch (Exception ex)
            {
                Log.Error(ex, "[WebSocket RX Lỗi] Vòng lặp nhận dữ liệu bị ngắt: {Message}", ex.Message);
                OnDisconnectedEvent?.Invoke();
                _ = HandleReconnectAsync();
            }
        }

        private void StartHeartbeat()
        {
            heartbeatTimer?.Dispose();
            // Thiết lập gửi PING mỗi 15 giây
            heartbeatTimer = new Timer((state) =>
            {
                if (webSocket != null && webSocket.State == WebSocketState.Open)
                {
                    string pingMsg = "{\"type\":\"PING\"}";
                    SendText(pingMsg);
                }
            }, null, 15000, 15000);
        }

        private async Task HandleReconnectAsync()
        {
            if (isReconnecting || (cts != null && cts.IsCancellationRequested)) return;
            isReconnecting = true;

            Log.Information("[WebSocket] Bắt đầu tiến trình tự động kết nối lại (Reconnect)...");
            heartbeatTimer?.Dispose();
            webSocket?.Dispose();

            // Lặp lại việc kết nối sau mỗi 5 giây cho đến khi thành công
            while (isReconnecting && !cts.IsCancellationRequested)
            {
                await Task.Delay(5000);
                Log.Information("[WebSocket] Đang thử kết nối lại...");
                try
                {
                    webSocket = new ClientWebSocket();
                    await webSocket.ConnectAsync(new Uri(url), cts.Token);
                    
                    Log.Information("[WebSocket] TÁI KẾT NỐI THÀNH CÔNG!");
                    isReconnecting = false;
                    
                    // Gửi lại gói đăng ký AgentId sau khi có kết nối mới
                    context.SendResponse(new { type = "REGISTER" }); 
                    
                    StartHeartbeat();
                    _ = ReceiveLoopAsync();
                }
                catch
                {
                    // Ghi đè rác bộ nhớ cho lượt kết nối tiếp theo
                    webSocket?.Dispose();
                }
            }
        }
    }
}