using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using AgentSystem.Core;
using AgentSystem.Managers; 

namespace AgentSystem.Modules
{
    public class AppModule : BaseModule
    {
        public override string[] SupportedCommands => new[] { "app_start", "app_stop", "app_list" };
        public AppModule(IAgentContext context, SecurityManager security, UIManager ui) 
            : base(context, security, ui) { }

        public override async Task ExecuteAsync(string action, JsonElement parameters, string commandId)
        {
            try
            {
                if (action == "app_list")
                {
                    GetRunningApps(commandId);
                }
                else if (action == "app_start" || action == "app_stop")
                {
                    string appName = parameters.GetProperty("name").GetString();

                    // Ràng buộc bảo mật: Bắt buộc đối chiếu Whitelist
                    if (!security.IsAppWhitelisted(appName))
                    {
                        // SỬA LỖI: Sửa cấu trúc phản hồi cho đúng chuẩn từ chối lệnh
                        context.SendResponse(new
                        {
                            type = "app_action_result", 
                            agent_id = context.AgentId,
                            command_id = commandId,
                            action = action,
                            name = appName,
                            success = false,
                            message = "Application is not in the whitelist."
                        });
                        return;
                    }

                    if (action == "app_start") StartApp(appName, commandId);
                    else StopApp(appName, commandId);
                }
                await Task.CompletedTask;
            }
            catch (Exception ex)
            {
                context.SendResponse(new
                {
                    type = "ERROR",
                    agent_id = context.AgentId, // BỔ SUNG
                    command_id = commandId,
                    message = $"Error in AppModule: {ex.Message}"
                });
            }
        }

        private void GetRunningApps(string commandId)
        {
            var appList = new List<object>();

            // Lọc các tiến trình có giao diện (MainWindowHandle != 0)
            var processes = Process.GetProcesses().Where(p => p.MainWindowHandle != IntPtr.Zero);

            foreach (var p in processes)
            {
                try
                {
                    // 1. Tính toán dung lượng RAM (Chuyển từ Bytes sang MB)
                    double ramMb = Math.Round(p.WorkingSet64 / (1024.0 * 1024.0), 2);

                    // 2. Xác định trạng thái ứng dụng
                    string status = p.Responding ? "running" : "not_responding";

                    // 3. SỬA LỖI: Tính toán CPU tức thời bằng PerformanceCounter
                    double cpuPercent = 0.0;
                    try
                    {
                        using (var counter = new PerformanceCounter("Process", "% Processor Time", p.ProcessName, true))
                        {
                            counter.NextValue(); // Lần lấy mẫu đầu tiên luôn bằng 0
                            System.Threading.Thread.Sleep(50); // Cần một độ trễ nhỏ để tính toán sự thay đổi
                            cpuPercent = Math.Round(counter.NextValue() / Environment.ProcessorCount, 2);
                        }
                    }
                    catch
                    {
                        // Bỏ qua nếu Agent không đủ quyền đọc chỉ số CPU của tiến trình này
                    }

                    appList.Add(new
                    {
                        name = p.ProcessName.ToLower(),
                        display_name = string.IsNullOrEmpty(p.MainWindowTitle) ? p.ProcessName : p.MainWindowTitle,
                        status = status,
                        cpu_percent = cpuPercent,
                        ram_mb = ramMb,
                        in_whitelist = security.IsAppWhitelisted(p.ProcessName)
                    });
                }
                catch
                {
                    // Bỏ qua các tiến trình gặp lỗi đọc thông tin hoặc vừa bị đóng trong lúc vòng lặp chạy
                }
            }

            context.SendResponse(new
            {
                type = "app_list_result",
                agent_id = context.AgentId, // BỔ SUNG
                command_id = commandId,
                apps = appList
            });
        }

        private void StartApp(string name, string commandId)
        {
            try
            {
                Process.Start(name);
                context.SendResponse(new
                {
                    type = "app_action_result",
                    agent_id = context.AgentId, // BỔ SUNG
                    command_id = commandId,
                    action = "app_start",
                    name = name,
                    success = true,
                    message = "Application started successfully."
                });
            }
            catch (Exception ex)
            {
                context.SendResponse(new
                {
                    type = "app_action_result",
                    agent_id = context.AgentId, // BỔ SUNG
                    command_id = commandId,
                    action = "app_start",
                    name = name,
                    success = false,
                    message = $"Failed to start app: {ex.Message}"
                });
            }
        }

        private void StopApp(string name, string commandId)
        {
            try
            {
                var processes = Process.GetProcessesByName(name);

                if (processes.Length == 0)
                {
                    context.SendResponse(new
                    {
                        type = "app_action_result",
                        agent_id = context.AgentId, // BỔ SUNG
                        command_id = commandId,
                        action = "app_stop",
                        name = name,
                        success = false,
                        message = "Application is not currently running."
                    });
                    return;
                }

                foreach (var process in processes)
                {
                    process.Kill();
                    process.WaitForExit(2000);
                }

                context.SendResponse(new
                {
                    type = "app_action_result",
                    agent_id = context.AgentId, // BỔ SUNG
                    command_id = commandId,
                    action = "app_stop",
                    name = name,
                    success = true,
                    message = "Application stopped successfully."
                });
            }
            catch (Exception ex)
            {
                context.SendResponse(new
                {
                    type = "app_action_result",
                    agent_id = context.AgentId, // BỔ SUNG
                    command_id = commandId,
                    action = "app_stop",
                    name = name,
                    success = false,
                    message = $"Failed to stop app: {ex.Message}"
                });
            }
        }
    }
}