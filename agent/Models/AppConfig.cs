using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace AgentSystem.Models
{
    public class AppConfig
    {
        [JsonPropertyName("agent_id")]
        public string AgentId { get; set; } = "PC-Lab-01";

        [JsonPropertyName("gateway_url")]
        public string GatewayUrl { get; set; } = "ws://localhost:8080";

        [JsonPropertyName("auth_key")]
        public string AuthKey { get; set; } = "agent-secret-key-2024";

        [JsonPropertyName("app_whitelist")]
        public List<string> AppWhitelist { get; set; } = new List<string> { "notepad", "calc", "chrome", "winword" };

        [JsonPropertyName("sandbox_root_path")]
        public string SandboxRootPath { get; set; } = @"C:\AgentSandbox\";

        [JsonPropertyName("log_retention_days")]
        public int LogRetentionDays { get; set; } = 7;

        [JsonPropertyName("consent_timeout_ms")]
        public int ConsentTimeoutMs { get; set; } = 30000;

        [JsonPropertyName("tray_password")]
        public string TrayPassword { get; set; } = "";

        [JsonPropertyName("e2ee_shared_secret")]
        public string E2EESharedSecret { get; set; } = "default-pin-12345";
    }
}