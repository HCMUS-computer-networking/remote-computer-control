using System;
using System.Collections.Generic;
using System.Text.Json;
using AgentSystem.Managers;
using AgentSystem.Models;
using AgentSystem.Modules;

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

        public void Start() { /* Nội dung giữ nguyên */ wsClient.Connect(); SendResponse(new { type = "REGISTER", agent_id = AgentId }); }
        public void Stop() { /* Nội dung giữ nguyên */ wsClient.Disconnect(); }
        public void SendResponse(object responseData) { /* Nội dung giữ nguyên */ string json = JsonSerializer.Serialize(responseData); wsClient.SendText(json); }
        public void SendBinaryFrame(byte[] bytes) { /* Nội dung giữ nguyên */ wsClient.SendBinary(bytes); }

        public void RouteCommand(CommandPacket packet)
        {
            if (packet.Type == "policy_update")
            {
                var whitelist = JsonSerializer.Deserialize<List<string>>(packet.Params.GetProperty("app_whitelist").GetRawText());
                var sandbox = packet.Params.GetProperty("sandbox_path").GetString();
                SecurityManager.UpdatePolicy(whitelist, sandbox);
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