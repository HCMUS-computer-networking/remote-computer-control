using System;
using Serilog;

namespace AgentSystem.Managers
{
    public static class AuditLogger
    {
        private static readonly ILogger _audit = new LoggerConfiguration()
            .WriteTo.File("Logs/audit-.log", rollingInterval: RollingInterval.Day)
            .CreateLogger();

        public static void LogCommand(string commandId, string type, string feature, bool allowed)
        {
            _audit.Information("[AUDIT] {Time} | Type={Type} | Feature={Feature} | Allowed={Allowed} | CmdID={CmdId}",
                DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss"), type, feature, allowed, commandId);
        }
    }
}
