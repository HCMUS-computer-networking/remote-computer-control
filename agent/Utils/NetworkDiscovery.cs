using System;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Serilog;

namespace AgentSystem.Utils
{
    public static class NetworkDiscovery
    {
        public static async Task<string> ScanForGatewayAsync(int timeoutMs)
        {
            using (CancellationTokenSource cts = new CancellationTokenSource(timeoutMs))
            {
                try
                {
                    using (UdpClient udpClient = new UdpClient(8888))
                    {
                        var receiveTask = udpClient.ReceiveAsync();
                        var tcs = new TaskCompletionSource<bool>();
                        
                        // Hủy khi timeout
                        cts.Token.Register(() => tcs.TrySetResult(false));

                        var completedTask = await Task.WhenAny(receiveTask, tcs.Task);

                        if (completedTask == receiveTask)
                        {
                            var result = await receiveTask;
                            string message = Encoding.UTF8.GetString(result.Buffer);

                            if (message.StartsWith("GATEWAY_ANNOUNCE|"))
                            {
                                string[] parts = message.Split('|');
                                if (parts.Length == 2)
                                {
                                    string discoveredUrl = parts[1];
                                    Log.Information("[Discovery] Tìm thấy Gateway tại: {Url}", discoveredUrl);
                                    return discoveredUrl;
                                }
                            }
                        }
                        
                        Log.Debug("[Discovery] Không tìm thấy tín hiệu Gateway sau {Time}ms", timeoutMs);
                        return null;
                    }
                }
                catch (SocketException ex)
                {
                    Log.Warning("[Discovery] Lỗi UDP Socket: {Message} (Port 8888 có thể đang bận)", ex.Message);
                    return null;
                }
                catch (Exception ex)
                {
                    Log.Error("[Discovery] Lỗi quá trình dò tìm: {Message}", ex.Message);
                    return null;
                }
            }
        }
    }
}
