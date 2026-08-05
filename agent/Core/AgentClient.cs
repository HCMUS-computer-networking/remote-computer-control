using System;
using System.Collections.Generic;
using System.Text.Json;
using AgentSystem.Managers;
using AgentSystem.Models;
using AgentSystem.Modules;
using agent.Modules;
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
        public CryptoModule Crypto { get; private set; }
        
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
            { "fs_list", "file" }, { "fs_get", "file" }, { "fs_put", "file" }, { "fs_delete", "file" },
            { "webcam_start", "webcam" }, { "webcam_stop", "webcam" },
            { "power", "power" }, { "power_lock", "power" }, { "power_restart", "power" }, { "power_shutdown", "power" }, { "power_sleep", "power" },
            { "input_mouse_move", "input" }, { "input_mouse_click", "input" }, { "input_key", "input" }, { "input_type", "input" }
        };

        public bool IsConnected { get; private set; }
        public event Action OnConnectedEvent;
        public event Action OnDisconnectedEvent;
        
        public string GatewayUrl => gatewayUrl;

        public AgentClient(string agentId, string gatewayUrl, SecurityManager security, UIManager ui)
        {
            AgentId = agentId; 
            this.gatewayUrl = gatewayUrl;
            
            SecurityManager = security;
            UIManager = ui;
            Crypto = new CryptoModule(ConfigManager.Current.E2EESharedSecret);
            
            Dispatcher = new MessageDispatcher(this);
            wsClient = new WebSocketClient(this, gatewayUrl);

            wsClient.OnConnectedEvent += HandleAgentConnected;
            wsClient.OnDisconnectedEvent += HandleAgentDisconnected;
            _moduleRegistry = new Dictionary<string, BaseModule>();
        }

        public void RegisterModules(IEnumerable<BaseModule> injectedModules)
        {
            foreach (var module in injectedModules)
            {
                foreach (var cmd in module.SupportedCommands)
                {
                    _moduleRegistry[cmd] = module;
                }
            }
        }

        private void HandleAgentConnected()
        {
            IsConnected = true;
            OnConnectedEvent?.Invoke();
        }

        private void HandleAgentDisconnected()
        {
            IsConnected = false;
            OnDisconnectedEvent?.Invoke();
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
            Crypto.Reset();
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
            }, false);
            Log.Information("[AgentClient] Đã gửi permissions_reset tới Gateway.");
        }

        public void Start() { /* Nội dung giữ nguyên */ wsClient.Connect(); }
        public void Stop() { /* Nội dung giữ nguyên */ wsClient.Disconnect(); }
        public void Reconnect() 
        { 
            wsClient.Disconnect(); 
            wsClient.Connect(); 
        }
        
        public void SendResponse(object responseData) { SendResponse(responseData, true); }
        
        public void SendResponse(object responseData, bool encrypt)
        {
            string json = JsonSerializer.Serialize(responseData);
            if (encrypt && Crypto != null && Crypto.IsE2EEReady)
            {
                try
                {
                    byte[] plaintext = System.Text.Encoding.UTF8.GetBytes(json);
                    byte[] e2eeBytes = Crypto.EncryptAESGCM(plaintext);
                    string dataBase64 = Convert.ToBase64String(e2eeBytes);
                    
                    var wrapper = new
                    {
                        type = "e2ee_payload",
                        agent_id = AgentId,
                        seq = Crypto.GetNextSendSeq(),
                        data = dataBase64
                    };
                    string wrapperJson = JsonSerializer.Serialize(wrapper);
                    wsClient.SendText(wrapperJson);
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "[E2EE] Lỗi mã hóa SendResponse");
                }
            }
            else
            {
                wsClient.SendText(json);
            }
        }
        
        public void SendBinaryFrame(byte[] bytes) { /* Nội dung giữ nguyên */ wsClient.SendBinary(bytes); }

        public void HandleBinaryFrame(byte[] bytes)
        {
            if (_moduleRegistry.TryGetValue("fs_put", out BaseModule mod) && mod is FileModule fileMod)
            {
                fileMod.HandleBinaryChunk(bytes);
            }
        }

        // Grab the singleton InputModule so the permission handlers can toggle its                 //
        // visual indicator and emit input_started/stopped. Any of the four input_*                 //
        // commands maps to the same instance in the registry.                                      //
        private InputModule ResolveInputModule()
        {
            if (_moduleRegistry.TryGetValue("input_mouse_move", out BaseModule bm) && bm is InputModule im)
            {
                return im;
            }
            return null;
        }

        public void RouteCommand(CommandPacket packet)
        {
            if (!ValidatePacket(packet))
            {
                Log.Warning("[Security] Nhận được gói tin không hợp lệ hoặc không dành cho Agent này. Đã bỏ qua.");
                return;
            }

            if (packet.Type == "e2ee_init")
            {
                try
                {
                    string pubKeyBase64 = packet.PublicKey;
                    string signature = packet.Signature;
                    
                    if (string.IsNullOrEmpty(pubKeyBase64) || string.IsNullOrEmpty(signature))
                    {
                        Log.Warning("[E2EE] Missing PublicKey or Signature in e2ee_init packet.");
                        return;
                    }

                    // Kiểm tra chữ ký bằng mã PIN. Nếu sai, ném lỗi về thẳng Controller để hiển thị thông báo.
                    if (!Crypto.VerifyHMAC(pubKeyBase64, signature))
                    {
                        Log.Warning("[E2EE] Invalid Controller Signature. Sai mã PIN hoặc có MitM.");
                        SendResponse(new {
                            type = "e2ee_error",
                            agent_id = AgentId,
                            message = "Invalid PIN"
                        }, false); // encrypt = false
                        return;
                    }
                    
                    // Nếu đúng PIN, tạo Session Key và phản hồi e2ee_ready
                    Crypto.DeriveSessionKey(pubKeyBase64);
                    
                    string myPubKeyBase64 = Crypto.GetPublicKeySPKIBase64();
                    string mySignature = Crypto.SignHMAC(myPubKeyBase64);
                    
                    SendResponse(new {
                        type = "e2ee_ready",
                        agent_id = AgentId,
                        publicKey = myPubKeyBase64,
                        signature = mySignature
                    }, false); // encrypt = false
                    
                    Log.Information("[E2EE] Handshake completed successfully. Session Key is ready.");
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "[E2EE] Handshake failed.");
                }
                return;
            }

            if (packet.Type != "policy_update" && packet.Type != "permissions_reset" && packet.Type != "e2ee_init" && !Crypto.IsE2EEReady)
            {
                Log.Warning($"[E2EE] Đang chờ Handshake, tạm chặn lệnh {packet.Type}.");
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
                    ConsentOutcome outcome = await UIManager.ShowConsentPopupOutcomeAsync(packet.Feature, 30000);
                    bool granted = outcome == ConsentOutcome.Granted;
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

                    // Remote Input has NO start/stop command of its own (each input_*
                    // packet is one-shot) — so the "started/denied" signal must be
                    // synthesised here from the consent outcome. Distinguish timeout
                    // vs decline vs busy so the operator sees an accurate toast.
                    if (packet.Feature == "input")
                    {
                        InputModule inputMod = ResolveInputModule();
                        if (granted)
                        {
                            inputMod?.OnInputGranted(packet.CommandId);
                        }
                        else
                        {
                            string reason = outcome switch
                            {
                                ConsentOutcome.Timeout  => "timeout",
                                ConsentOutcome.Busy     => "busy",
                                _                       => "user declined",
                            };
                            SendResponse(new
                            {
                                type       = "input_denied",
                                agent_id   = AgentId,
                                command_id = packet.CommandId,
                                reason     = reason,
                            });
                        }
                    }
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

                if (packet.Feature == "input")
                {
                    ResolveInputModule()?.OnInputRevoked();                                         // Hide overlay + emit input_stopped
                }
                return;
            }

            if (packet.Type == "stop_module")
            {
                // Remote Input is stateless — stop just means "hide indicator + notify".          //
                if (packet.Feature == "input")
                {
                    ResolveInputModule()?.OnInputRevoked();
                    return;
                }

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