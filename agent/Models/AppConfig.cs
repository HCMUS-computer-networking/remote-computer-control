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
    }
}