using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading.Tasks;
using AgentSystem.Core;
using AgentSystem.Managers;

namespace AgentSystem.Modules
{
    public class SysInfoModule : BaseModule
    {
        public override string[] SupportedCommands => new[] { "sysinfo" };
        
        public SysInfoModule(IAgentContext context, SecurityManager security, UIManager ui) 
            : base(context, security, ui) { }

        public override async Task ExecuteAsync(string action, JsonElement parameters, string commandId)
        {
            if (action == "sysinfo")
            {
                await GetSysInfoAsync(commandId);
            }
        }

        private async Task GetSysInfoAsync(string commandId)
        {
            try
            {
                // CPU
                double cpuPercent = await GetCpuUsageAsync();
                
                // RAM
                var gcMemoryInfo = GC.GetGCMemoryInfo();
                double ramTotalMb = Math.Round(gcMemoryInfo.TotalAvailableMemoryBytes / (1024.0 * 1024.0), 2);
                
                double ramAvailableMb = 0;
                try
                {
                    using (var ramCounter = new PerformanceCounter("Memory", "Available MBytes", true))
                    {
                        ramAvailableMb = ramCounter.NextValue();
                    }
                }
                catch { }

                double ramUsedMb = Math.Max(0, ramTotalMb - ramAvailableMb);

                // Disk
                double diskTotalGb = 0;
                double diskUsedGb = 0;
                foreach (DriveInfo drive in DriveInfo.GetDrives())
                {
                    if (drive.IsReady && drive.DriveType == DriveType.Fixed)
                    {
                        diskTotalGb += drive.TotalSize / (1024.0 * 1024.0 * 1024.0);
                        diskUsedGb += (drive.TotalSize - drive.TotalFreeSpace) / (1024.0 * 1024.0 * 1024.0);
                    }
                }

                // Uptime
                long uptimeSeconds = Environment.TickCount64 / 1000;

                // IP
                string ip = Dns.GetHostAddresses(Dns.GetHostName())
                    .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork)?.ToString() ?? "unknown";

                context.SendResponse(new
                {
                    type = "sysinfo_result",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    cpu_percent = Math.Round(cpuPercent, 2),
                    ram_used_mb = Math.Round(ramUsedMb, 2),
                    ram_total_mb = Math.Round(ramTotalMb, 2),
                    disk_used_gb = Math.Round(diskUsedGb, 2),
                    disk_total_gb = Math.Round(diskTotalGb, 2),
                    uptime_seconds = uptimeSeconds,
                    hostname = Environment.MachineName,
                    ip = ip,
                    os = Environment.OSVersion.ToString()
                });
            }
            catch (Exception ex)
            {
                context.SendResponse(new
                {
                    type = "ERROR",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    message = $"Error getting sysinfo: {ex.Message}"
                });
            }
        }

        private async Task<double> GetCpuUsageAsync()
        {
            try
            {
                using (var cpuCounter = new PerformanceCounter("Processor", "% Processor Time", "_Total", true))
                {
                    cpuCounter.NextValue();
                    await Task.Delay(500); // Non-blocking wait
                    return cpuCounter.NextValue();
                }
            }
            catch
            {
                return 0;
            }
        }
    }
}
