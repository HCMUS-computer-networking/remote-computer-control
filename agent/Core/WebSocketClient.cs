using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Timer = System.Threading.Timer;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using System.Net;
using System.Net.Sockets;
using Serilog;
using AgentSystem.Managers;
using System.Diagnostics;

namespace AgentSystem.Core
{
    public class WebSocketClient
    {
        public event Action OnConnectedEvent;
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
                cts = new CancellationTokenSource();
                webSocket = new ClientWebSocket();

                try
                {
                    webSocket.Options.RemoteCertificateValidationCallback = (sender, cert, chain, sslErrors) => true;
                }
                catch (Exception certEx)
                {
                    Log.Debug(certEx, "[WebSocket] Ignore cert validation config error for non-SSL connection");
                }

                string finalUrl = $"{url.TrimEnd('/')}/agent?key={ConfigManager.Current.AuthKey}";
                Log.Information("[WebSocket] Đang kết nối tới {finalUrl}...", finalUrl);
                await webSocket.ConnectAsync(new Uri(finalUrl), cts.Token);
                Log.Information("[WebSocket] KẾT NỐI THÀNH CÔNG!");
                OnConnectedEvent?.Invoke();
                
                isReconnecting = false;
                
                string ip = Dns.GetHostAddresses(Dns.GetHostName())
                    .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork)?.ToString() ?? "unknown";

                context.Crypto.Reset();
                context.SendResponse(new { 
                    type = "REGISTER", 
                    agent_id = context.AgentId,
                    secret = ConfigManager.Current.AuthKey,
                    hostname = Environment.MachineName,
                    ip = ip,
                    os = Environment.OSVersion.ToString()
                }, false);
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
                // Xóa sạch trạng thái E2EE cũ khi ngắt kết nối
                context.Crypto.Reset();
                
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
                        const int MAX_MESSAGE_SIZE = 4 * 1024 * 1024; // 4 MB
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

                            if (ms.Length > MAX_MESSAGE_SIZE)
                            {
                                Log.Warning("[Security] Message vượt quá kích thước cho phép ({Size} bytes). Bị bỏ qua.", ms.Length);
                                break; // Thoát khỏi vòng lặp đọc
                            }
                        } 
                        while (!result.EndOfMessage);

                        if (ms.Length > MAX_MESSAGE_SIZE)
                        {
                            continue; // Bỏ qua việc xử lý message này
                        }

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
                        else if (result.MessageType == WebSocketMessageType.Binary)
                        {
                            context.HandleBinaryFrame(ms.ToArray());
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

            // Xóa sạch trạng thái E2EE cũ trước khi thử kết nối lại
            context.Crypto.Reset();

            Log.Information("[WebSocket] Bắt đầu tiến trình tự động kết nối lại (Reconnect)...");
            heartbeatTimer?.Dispose();
            webSocket?.Dispose();

            int retryCount = 0;
            // Lặp lại việc kết nối với Exponential Backoff (5s, 10s, 20s... tối đa 120s)
            while (isReconnecting && !cts.IsCancellationRequested)
            {
                int delaySeconds = Math.Min(5 * (int)Math.Pow(2, retryCount), 120);
                Log.Information("[WebSocket] Đang thử kết nối lại sau {Delay}s (lần {Count})...", delaySeconds, retryCount + 1);
                await Task.Delay(delaySeconds * 1000);
                retryCount++;

                try
                {
                    webSocket = new ClientWebSocket();
                    string finalUrl = $"{url.TrimEnd('/')}/agent?key={ConfigManager.Current.AuthKey}";
                    await webSocket.ConnectAsync(new Uri(finalUrl), cts.Token);
                    
                    Log.Information("[WebSocket] TÁI KẾT NỐI THÀNH CÔNG!");
                    OnConnectedEvent?.Invoke();
                    isReconnecting = false;
                    
                    string ip = Dns.GetHostAddresses(Dns.GetHostName())
                        .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork)?.ToString() ?? "unknown";

                    // Gửi lại gói đăng ký AgentId sau khi có kết nối mới
                    context.Crypto.Reset();
                    context.SendResponse(new { 
                        type = "REGISTER", 
                        agent_id = context.AgentId,
                        secret = ConfigManager.Current.AuthKey,
                        hostname = Environment.MachineName,
                        ip = ip,
                        os = Environment.OSVersion.ToString()
                    }, false); 
                    
                    // Notify the Controller that permissions and E2EE must be re-established
                    context.NotifyReconnected();
                    
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