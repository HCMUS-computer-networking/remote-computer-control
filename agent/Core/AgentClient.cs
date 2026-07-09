using System;
using System.Collections.Generic;
using System.Text.Json;
using AgentSystem.Managers;
using AgentSystem.Models;
using AgentSystem.Modules;
using Serilog;

namespace AgentSystem.Core
{
    // SỬA: Implement IAgentContext
    public class AgentClient : IAgentContext
    {
        public string AgentId { get; private set; }
        private string gatewayUrl;
        private WebSocketClient wsClient;
        public MessageDispatcher Dispatcher { get; private set; }
        public SecurityManager SecurityManager { get; private set; }
        public UIManager UIManager { get; private set; }
        
        // THÊM: Registry tự động
        private readonly Dictionary<string, BaseModule> _moduleRegistry;

        // SỬA: Constructor nhận Dependencies
        public AgentClient(string agentId, string gatewayUrl, SecurityManager security, UIManager ui, IEnumerable<BaseModule> injectedModules)
        {
            AgentId = agentId; 
            this.gatewayUrl = gatewayUrl;
            
            // Gán service được tiêm
            SecurityManager = security;
            UIManager = ui;
            
            // Các class con thuộc Core tự khởi tạo (vì chúng gắn chặt với vòng đời AgentClient)
            Dispatcher = new MessageDispatcher(this);
            wsClient = new WebSocketClient(this, gatewayUrl);

            wsClient.OnDisconnectedEvent += HandleAgentDisconnected;

            // Tự động map các Module dựa trên SupportedCommands
            _moduleRegistry = new Dictionary<string, BaseModule>();
            foreach (var module in injectedModules)
            {
                foreach (var cmd in module.SupportedCommands)
                {
                    _moduleRegistry[cmd] = module;
                }
            }
        }

        private void HandleAgentDisconnected()
        {
            Log.Information("[AgentClient] Mất kết nối! Đang yêu cầu các module dọn dẹp tài nguyên...");
            
            foreach (var module in _moduleRegistry.Values)
            {
                try
                {
                    module.OnDisconnected(); 
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "[AgentClient] Lỗi dọn dẹp module: {Message}", ex.Message);
                }
            }
        }

        public void Start() { /* Nội dung giữ nguyên */ wsClient.Connect(); SendResponse(new { type = "REGISTER", agent_id = AgentId }); }
        public void Stop() { /* Nội dung giữ nguyên */ wsClient.Disconnect(); }
        public void SendResponse(object responseData) { /* Nội dung giữ nguyên */ string json = JsonSerializer.Serialize(responseData); wsClient.SendText(json); }
        public void SendBinaryFrame(byte[] bytes) { /* Nội dung giữ nguyên */ wsClient.SendBinary(bytes); }

        public void RouteCommand(CommandPacket packet)
        {
            if (packet.Type == "policy_update")
            {
                try
                {
                    List<string> whitelist = null;
                    string sandbox = null;

                    // Xử lý an toàn: Có biến nào thì đọc biến đó (Hỗ trợ Update từng phần)
                    if (packet.Params.TryGetProperty("app_whitelist", out var wlProp) && wlProp.ValueKind != JsonValueKind.Null)
                    {
                        whitelist = JsonSerializer.Deserialize<List<string>>(wlProp.GetRawText());
                    }

                    if (packet.Params.TryGetProperty("sandbox_path", out var sbProp) && sbProp.ValueKind != JsonValueKind.Null)
                    {
                        sandbox = sbProp.GetString();
                    }

                    SecurityManager.UpdatePolicy(whitelist, sandbox);

                    // Gửi xác nhận thành công về cho Gateway
                    SendResponse(new 
                    {
                        type = "policy_update_result",
                        agent_id = AgentId,
                        command_id = packet.CommandId,
                        success = true,
                        message = "Policy updated successfully in RAM."
                    });
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "[AgentClient] Lỗi khi giải mã tham số policy_update");
                    
                    // Gửi báo cáo lỗi về cho Gateway
                    SendResponse(new 
                    {
                        type = "policy_update_result",
                        agent_id = AgentId,
                        command_id = packet.CommandId,
                        success = false,
                        message = $"Failed to parse policy data: {ex.Message}"
                    });
                }
                return;
            }

            // SỬA: Định tuyến thông minh, gộp chung xử lý cho mọi module kể cả Power
            string routingKey = packet.Module ?? packet.Type; 
            if (routingKey != null && _moduleRegistry.TryGetValue(routingKey, out BaseModule module))
            {
                // Sử dụng Fire-and-Forget Task với async/await
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await module.ExecuteAsync(packet.Action ?? routingKey, packet.Params, packet.CommandId);
                    }
                    catch (Exception ex)
                    {
                        SendResponse(new { type = "ERROR", agent_id = AgentId, command_id = packet.CommandId, message = ex.Message });
                    }
                });
            }
        }
    }
}