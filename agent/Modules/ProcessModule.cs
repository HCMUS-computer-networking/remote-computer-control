using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using AgentSystem.Core;

namespace AgentSystem.Modules
{
    public class ProcessModule : BaseModule
    {
        private readonly Dictionary<int, (TimeSpan CpuTime, DateTime LastCheck)> cpuHistory = new Dictionary<int, (TimeSpan, DateTime)>();
        public ProcessModule(AgentClient context) : base(context) { }

        public override void Execute(string action, JsonElement parameters, string commandId)
        {
            try
            {
                if (action == "proc_list")
                {
                    GetProcessList(commandId);
                }
                else if (action == "proc_kill")
                {
                    if (parameters.TryGetProperty("pid", out JsonElement pidElement) && pidElement.TryGetInt32(out int pid))
                    {
                        KillProcess(pid, commandId);
                    }
                    else
                    {
                        context.SendResponse(new
                        {
                            type = "proc_kill_result",
                            command_id = commandId,
                            pid = -1,
                            success = false,
                            message = "Missing or invalid 'pid' parameter."
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                context.SendResponse(new
                {
                    type = "ERROR",
                    command_id = commandId,
                    message = $"Error in ProcessModule: {ex.Message}"
                });
            }
        }

        private void GetProcessList(string commandId)
        {
            var processList = new List<object>();
            var processes = Process.GetProcesses();
            var currentTime = DateTime.UtcNow;

            foreach (var p in processes)
            {
                try
                {
                    double ramMb = Math.Round(p.WorkingSet64 / (1024.0 * 1024.0), 2);
                    double cpuPercent = 0.0;

                    try
                    {
                        // Phương pháp Non-blocking tính toán CPU Delta
                        TimeSpan currentCpuTime = p.TotalProcessorTime;

                        if (cpuHistory.TryGetValue(p.Id, out var history))
                        {
                            double msPassed = (currentTime - history.LastCheck).TotalMilliseconds;
                            double cpuMsPassed = (currentCpuTime - history.CpuTime).TotalMilliseconds;

                            if (msPassed > 0)
                            {
                                // Công thức tính % CPU đa luồng
                                cpuPercent = Math.Round((cpuMsPassed / msPassed) / Environment.ProcessorCount * 100, 2);
                            }
                        }
                        
                        // Cập nhật lại lịch sử cho lần quét sau
                        cpuHistory[p.Id] = (currentCpuTime, currentTime);
                    }
                    catch 
                    { 
                        // Truy cập bị từ chối với các System Process (Nếu Agent không chạy bằng quyền Admin) 
                    }

                    processList.Add(new
                    {
                        pid = p.Id,
                        name = p.ProcessName + ".exe",
                        cpu_percent = cpuPercent,
                        ram_mb = ramMb
                    });
                }
                catch { /* Bỏ qua tiến trình lỗi/vừa đóng */ }
            }

            // Dọn dẹp cache cho những tiến trình đã tắt để chống tràn RAM
            var currentPids = processes.Select(p => p.Id).ToHashSet();
            var pidsToRemove = cpuHistory.Keys.Where(pid => !currentPids.Contains(pid)).ToList();
            foreach (var pid in pidsToRemove) cpuHistory.Remove(pid);

            context.SendResponse(new
            {
                type = "proc_list_result",
                command_id = commandId,
                processes = processList
            });
        }

        private void KillProcess(int pid, string commandId)
        {
            try
            {
                var process = Process.GetProcessById(pid);
                process.Kill();

                // Chờ tối đa 2 giây để xác nhận tiến trình đã bị đóng
                process.WaitForExit(2000);

                context.SendResponse(new
                {
                    type = "proc_kill_result",
                    command_id = commandId,
                    pid = pid,
                    success = true,
                    message = "Process terminated"
                });
            }
            catch (ArgumentException)
            {
                // Bắt lỗi khi không tìm thấy PID
                context.SendResponse(new
                {
                    type = "proc_kill_result",
                    command_id = commandId,
                    pid = pid,
                    success = false,
                    message = "Process not found."
                });
            }
            catch (Exception ex)
            {
                // Bắt lỗi khi thiếu quyền quản trị (Access Denied)
                context.SendResponse(new
                {
                    type = "proc_kill_result",
                    command_id = commandId,
                    pid = pid,
                    success = false,
                    message = $"Failed to terminate process: {ex.Message}"
                });
            }
        }
    }
}