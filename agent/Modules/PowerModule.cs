using System;
using System.Diagnostics;
using System.Text.Json;
using System.Threading;
using AgentSystem.Core;
using AgentSystem.Managers;

namespace AgentSystem.Modules
{
    public class PowerModule : BaseModule
    {
        public override string[] SupportedCommands => new[] { "power" };
        public PowerModule(IAgentContext context, SecurityManager security, UIManager ui) : base(context, security, ui) { }

        public override void Execute(string action, JsonElement parameters, string commandId)
        {
            try
            {
                string safeAction = action?.ToLower() ?? string.Empty;

                // 1. Kiểm tra quyền thực thi (Popup Consent)
                // Lệnh "lock" được phép chạy ngay lập tức, các lệnh khác phải xin phép.
                if (safeAction == "shutdown" || safeAction == "restart" || safeAction == "sleep")
                {
                    // Hiển thị popup chờ tối đa 30 giây (30000ms)
                    bool isApproved = ui.ShowConsentPopup("power", 30000);

                    if (!isApproved)
                    {
                        context.SendResponse(new
                        {
                            type = "power_result",
                            agent_id = context.AgentId,
                            action = safeAction,
                            confirmed = false,
                            message = "User declined permission"
                        });
                        return; // Ngắt luồng, không thực thi
                    }
                }

                bool success = true;
                string message = $"System is executing {safeAction}";

                // 2. Thực thi lệnh
                switch (safeAction)
                {
                    case "shutdown":
                        ExecuteSystemCommand("shutdown", "/s /t 0 /f");
                        break;
                    case "restart":
                        ExecuteSystemCommand("shutdown", "/r /t 0 /f");
                        break;
                    case "sleep":
                        // Lệnh đưa Windows vào chế độ Sleep (hoặc Hibernate tùy cấu hình)
                        ExecuteSystemCommand("rundll32.exe", "powrprof.dll,SetSuspendState 0,1,0");
                        break;
                    case "lock":
                        ExecuteSystemCommand("rundll32.exe", "user32.dll,LockWorkStation");
                        break;
                    default:
                        success = false;
                        message = $"Unknown power action: {action}";
                        break;
                }

                // 3. Trả về kết quả
                context.SendResponse(new
                {
                    type = "power_result",
                    command_id = commandId,
                    action = safeAction,
                    confirmed = success,
                    message = message
                });
            }
            catch (Exception ex)
            {
                context.SendResponse(new
                {
                    type = "power_result",
                    command_id = commandId,
                    action = action,
                    confirmed = false,
                    message = $"Error executing power command: {ex.Message}"
                });
            }
        }

        private void ExecuteSystemCommand(string fileName, string arguments)
        {
            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                CreateNoWindow = true,
                UseShellExecute = false
            };
            Process.Start(psi);
        }
    }
}