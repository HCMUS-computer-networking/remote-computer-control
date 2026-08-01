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
        
        // THÊM: Quản lý phân quyền
        private readonly HashSet<string> _grantedFeatures = new HashSet<string>();
        private readonly Dictionary<string, string> _commandToFeatureMap = new Dictionary<string, string>
        {
            { "app_list", "application" }, { "app_start", "application" }, { "app_stop", "application" },
            { "proc_list", "process" }, { "proc_kill", "process" },
            { "screenshot", "screen" }, { "screen_stream", "screen" }, { "screen_stream_stop", "screen" },
            { "keylog_start", "keylog" }, { "keylog_stop", "keylog" },
            { "fs_list", "file" }, { "fs_get", "file" }, { "fs_put", "file" },
            { "webcam_start", "webcam" }, { "webcam_stop", "webcam" },
            { "power", "power" }
        };

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
            
            // B3: Reset quyền khi mất kết nối — Controller sẽ phải xin lại
            lock (_grantedFeatures)
            {
                _grantedFeatures.Clear();
            }
            
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

        /// <summary>
        /// Gọi sau khi reconnect thành công và REGISTER xong.
        /// Thông báo Controller rằng Agent đã reconnect và cần xin lại quyền.
        /// </summary>
        public void NotifyReconnected()
        {
            SendResponse(new 
            { 
                type = "permissions_reset", 
                agent_id = AgentId,
                message = "Agent reconnected. Please re-grant permissions." 
            });
            Log.Information("[AgentClient] Đã gửi permissions_reset tới Gateway.");
        }

        public void Start() { /* Nội dung giữ nguyên */ wsClient.Connect(); }
        public void Stop() { /* Nội dung giữ nguyên */ wsClient.Disconnect(); }
        public void SendResponse(object responseData) { /* Nội dung giữ nguyên */ string json = JsonSerializer.Serialize(responseData); wsClient.SendText(json); }
        public void SendBinaryFrame(byte[] bytes) { /* Nội dung giữ nguyên */ wsClient.SendBinary(bytes); }

        public void RouteCommand(CommandPacket packet)
        {
            if (!ValidatePacket(packet))
            {
                Log.Warning("[Security] Nhận được gói tin không hợp lệ hoặc không dành cho Agent này. Đã bỏ qua.");
                return;
            }

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

            if (packet.Type == "permission_request")
            {
                _ = Task.Run(async () =>
                {
                    bool granted = await UIManager.ShowConsentPopupAsync(packet.Feature, 30000);
                    if (granted)
                    {
                        lock (_grantedFeatures)
                        {
                            _grantedFeatures.Add(packet.Feature);
                        }
                    }
                    AuditLogger.LogCommand(packet.CommandId, "permission_request", packet.Feature, granted);
                    SendResponse(new 
                    { 
                        type = "permission_result", 
                        agent_id = AgentId, 
                        feature = packet.Feature, 
                        granted = granted 
                    });
                });
                return;
            }

            if (packet.Type == "permission_revoke")
            {
                lock (_grantedFeatures)
                {
                    _grantedFeatures.Remove(packet.Feature);
                }
                AuditLogger.LogCommand(packet.CommandId, "permission_revoke", packet.Feature, false);
                return;
            }

            if (packet.Type == "stop_module")
            {
                string commandToStop = packet.Feature switch
                {
                    "screen" => "screen_stream_stop",
                    "keylog" => "keylog_stop",
                    "webcam" => "webcam_stop",
                    _ => null
                };
                
                if (commandToStop != null && _moduleRegistry.TryGetValue(commandToStop, out BaseModule mod))
                {
                    _ = Task.Run(async () => await mod.ExecuteAsync(commandToStop, packet.Params, packet.CommandId));
                }
                return;
            }

            // SỬA: Định tuyến thông minh, gộp chung xử lý cho mọi module kể cả Power
            string routingKey = packet.Module ?? packet.Type; 
            
            // THÊM: Gate kiểm tra quyền
            if (_commandToFeatureMap.TryGetValue(routingKey, out string requiredFeature))
            {
                bool hasPermission;
                lock (_grantedFeatures)
                {
                    hasPermission = _grantedFeatures.Contains(requiredFeature);
                }
                
                if (!hasPermission)
                {
                    AuditLogger.LogCommand(packet.CommandId, packet.Type, requiredFeature, false);
                    SendResponse(new { 
                        type = "module_error", 
                        agent_id = AgentId, 
                        feature = requiredFeature, 
                        message = "Chưa được cấp quyền" 
                    });
                    return;
                }
            }

            if (routingKey != null && _moduleRegistry.TryGetValue(routingKey, out BaseModule module))
            {
                if (_commandToFeatureMap.TryGetValue(routingKey, out string f))
                {
                    AuditLogger.LogCommand(packet.CommandId, packet.Type, f, true);
                }

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

        private bool ValidatePacket(CommandPacket packet)
        {
            // command_id không được rỗng (trừ một số lệnh đặc biệt nếu có)
            if (string.IsNullOrWhiteSpace(packet.CommandId)) 
                return false;
            
            // target_agents phải chứa AgentId này (hoặc rỗng/null = broadcast)
            if (packet.TargetAgents != null && packet.TargetAgents.Length > 0)
            {
                if (!Array.Exists(packet.TargetAgents, t => t == AgentId || t == "all"))
                    return false;
            }
            
            return true;
        }
    }
}