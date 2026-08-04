using System;
using System.Text.Json;
using AgentSystem.Models;
using Serilog;

namespace AgentSystem.Core
{
    public class MessageDispatcher
    {
        private AgentClient context;

        public MessageDispatcher(AgentClient context)
        {
            this.context = context;
        }

        public void Dispatch(string rawJson)
        {
            try
            {
                // Cố gắng phân tích chuỗi JSON thành CommandPacket
                var packet = JsonSerializer.Deserialize<CommandPacket>(rawJson);
                if (packet != null)
                {
                    if (packet.Type == "e2ee_payload")
                    {
                        if (!context.Crypto.IsE2EEReady)
                        {
                            Log.Warning("[E2EE] Nhận được e2ee_payload nhưng E2EE chưa sẵn sàng. Bỏ qua.");
                            return;
                        }

                        if (!context.Crypto.CheckAndUpdateRecvSeq(packet.Seq))
                        {
                            Log.Warning($"[E2EE] Lỗi Sequence (Replay Attack/Quá hạn), seq = {packet.Seq}. Bỏ qua.");
                            return;
                        }

                        try
                        {
                            byte[] e2eeBytes = Convert.FromBase64String(packet.Data);
                            byte[] plaintext = context.Crypto.DecryptAESGCM(e2eeBytes);
                            string innerJson = System.Text.Encoding.UTF8.GetString(plaintext);
                            
                            var innerPacket = JsonSerializer.Deserialize<CommandPacket>(innerJson);
                            if (innerPacket != null)
                            {
                                context.RouteCommand(innerPacket);
                            }
                        }
                        catch (Exception ex)
                        {
                            Log.Error(ex, "[E2EE] Lỗi giải mã e2ee_payload.");
                        }
                    }
                    else
                    {
                        context.RouteCommand(packet);
                    }
                }
            }
            catch (JsonException ex)
            {
                // Bắt lỗi khi cấu trúc JSON bị sai (thiếu ngoặc, sai kiểu dữ liệu...)
                Log.Error(ex, "[Dispatcher] Lỗi định dạng JSON từ Server: {Message}", ex.Message);
                context.SendResponse(new
                {
                    type = "ERROR",
                    agent_id = context.AgentId,
                    command_id = "unknown", // Vì không parse được JSON nên không lấy được command_id
                    message = "Malformed JSON received from Gateway."
                });
            }
            catch (Exception ex)
            {
                // Bắt mọi rủi ro ngoại lệ khác có thể xảy ra trong khối lệnh
                Log.Error(ex, "[Dispatcher] Lỗi điều phối lệnh: {Message}", ex.Message);
                context.SendResponse(new
                {
                    type = "ERROR",
                    agent_id = context.AgentId,
                    command_id = "unknown",
                    message = $"Dispatcher error: {ex.Message}"
                });
            }
        }
    }
}