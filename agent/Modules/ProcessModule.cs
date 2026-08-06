using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.ComponentModel;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using AgentSystem.Core;
using System.Threading.Tasks;
using System.Threading;
using AgentSystem.Managers;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace AgentSystem.Modules
{
    public class ProcessModule : BaseModule
    {
        private readonly ConcurrentDictionary<int, (TimeSpan CpuTime, DateTime LastCheck)> cpuHistory = new ConcurrentDictionary<int, (TimeSpan, DateTime)>();

        public override string[] SupportedCommands => new[] { "proc_list", "proc_kill" };
        
        public ProcessModule(IAgentContext context, SecurityManager security, UIManager ui) 
            : base(context, security, ui) { }

        public override async Task ExecuteAsync(string action, JsonElement parameters, string commandId)
        {
            try
            {
                if (action == "proc_list")
                {
                    // Chạy ngầm thao tác liệt kê để không block luồng xử lý gói tin WebSocket
                    await Task.Run(() => GetProcessList(commandId));
                }
                else if (action == "proc_kill")
                {
                    if (parameters.TryGetProperty("pid", out JsonElement pidElement) && pidElement.TryGetInt32(out int pid))
                    {
                        await KillProcessAsync(pid, commandId);
                    }
                    else
                    {
                        context.SendResponse(new
                        {
                            type = "proc_kill_result",
                            agent_id = context.AgentId,
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
                    agent_id = context.AgentId,
                    command_id = commandId,
                    message = $"Error in ProcessModule: {ex.Message}"
                });
            }
        }

        private void GetProcessList(string commandId)
        {
            var processList = new ConcurrentBag<object>();
            var processes = Process.GetProcesses();
            var currentTime = DateTime.UtcNow;

            var currentPids = processes.Select(p => p.Id).ToHashSet();

            Parallel.ForEach(processes, p =>
            {
                try
                {
                    double ramMb = Math.Round(p.WorkingSet64 / (1024.0 * 1024.0), 2);
                    double cpuPercent = 0.0;

                    try
                    {
                        TimeSpan currentCpuTime = p.TotalProcessorTime;
                        
                        if (cpuHistory.TryGetValue(p.Id, out var history))
                        {
                            double msPassed = (currentTime - history.LastCheck).TotalMilliseconds;
                            double cpuMsPassed = (currentCpuTime - history.CpuTime).TotalMilliseconds;
                            
                            if (msPassed > 0)
                            {
                                cpuPercent = Math.Round((cpuMsPassed / msPassed) / Environment.ProcessorCount * 100, 2);
                            }
                        }
                        
                        cpuHistory[p.Id] = (currentCpuTime, currentTime);
                    }
                    catch (Win32Exception) { }
                    catch (InvalidOperationException) { }

                    string username = GetProcessOwner(p);

                    processList.Add(new
                    {
                        pid = p.Id,
                        name = p.ProcessName + ".exe",
                        username = username,
                        cpu_percent = cpuPercent,
                        ram_mb = ramMb
                    });
                }
                catch { }
                finally
                {
                    p.Dispose();
                }
            });


            var pidsToRemove = cpuHistory.Keys.Where(pid => !currentPids.Contains(pid)).ToList();
            
            foreach (var pid in pidsToRemove) 
            {
                cpuHistory.TryRemove(pid, out _); 
            }

            context.SendResponse(new
            {
                type = "proc_list_result",
                agent_id = context.AgentId,
                command_id = commandId,
                processes = processList.ToList() 
            });
        }

        private readonly string[] criticalSystemProcesses = { 
            "csrss", "winlogon", "lsass", "smss", "services", "system", "explorer" 
        };

        private async Task KillProcessAsync(int pid, string commandId)
        {
            try
            {
                var process = Process.GetProcessById(pid);
                
                // 1. Chặn can thiệp tiến trình lõi của hệ điều hành (Case-insensitive)
                if (criticalSystemProcesses.Contains(process.ProcessName.ToLower()))
                {
                    context.SendResponse(new {
                        type = "proc_kill_result",
                        agent_id = context.AgentId,
                        command_id = commandId,
                        pid = pid,
                        success = false,
                        message = "Access Denied: Cannot terminate critical system process."
                    });
                    return;
                }

                // 2. Chặn can thiệp tiến trình của hệ thống (Case-insensitive)
                string owner = GetProcessOwner(process);
                string ownerLower = owner.ToLower();
                if (ownerLower.Contains("nt authority\\system") || ownerLower.Contains("local service") || ownerLower.Contains("network service"))
                {
                    context.SendResponse(new {
                        type = "proc_kill_result",
                        agent_id = context.AgentId,
                        command_id = commandId,
                        pid = pid,
                        success = false,
                        message = $"Access Denied: Process is owned by privileged account ({owner})."
                    });
                    return;
                }

                process.Kill();
                
                // Đợi bất đồng bộ với Timeout 2 giây thay vì chặn luồng như WaitForExit()
                using (var cts = new CancellationTokenSource(2000))
                {
                    try
                    {
                        await process.WaitForExitAsync(cts.Token);
                    }
                    catch (OperationCanceledException)
                    {
                        // Tiến trình chưa thoát hẳn sau 2s, bỏ qua
                    }
                }
                
                context.SendResponse(new
                {
                    type = "proc_kill_result",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    pid = pid,
                    success = true,
                    message = "Process terminated"
                });
            }
            catch (ArgumentException)
            {
                context.SendResponse(new
                {
                    type = "proc_kill_result",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    pid = pid,
                    success = false,
                    message = "Process not found."
                });
            }
            catch (Exception ex)
            {
                context.SendResponse(new
                {
                    type = "proc_kill_result",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    pid = pid,
                    success = false,
                    message = $"Failed to terminate process: {ex.Message}"
                });
            }
        }

        private static string GetProcessOwner(Process process)
        {
            IntPtr tokenHandle = IntPtr.Zero;
            try
            {
                if (NativeMethods.OpenProcessToken(process.Handle, NativeMethods.TOKEN_QUERY, out tokenHandle))
                {
                    using (var identity = new WindowsIdentity(tokenHandle))
                    {
                        return identity.Name;
                    }
                }
            }
            catch
            {
                // Fallback for system or protected processes
            }
            finally
            {
                if (tokenHandle != IntPtr.Zero)
                {
                    NativeMethods.CloseHandle(tokenHandle);
                }
            }
            return "Unknown";
        }

        private static class NativeMethods
        {
            public const uint TOKEN_QUERY = 0x0008;

            [DllImport("advapi32.dll", SetLastError = true)]
            [return: MarshalAs(UnmanagedType.Bool)]
            public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

            [DllImport("kernel32.dll", SetLastError = true)]
            [return: MarshalAs(UnmanagedType.Bool)]
            public static extern bool CloseHandle(IntPtr hObject);
        }
    }
}