using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace AgentSystem.Models
{
    public class AppConfig
    {
        [JsonPropertyName("agent_id")]
        public string AgentId { get; set; } = "PC-Lab-01";

        [JsonPropertyName("gateway_url")]
        public string GatewayUrl { get; set; } = "wss://localhost:8080";

        [JsonPropertyName("app_whitelist")]
        public List<string> AppWhitelist { get; set; } = new List<string> { "notepad", "calc", "chrome", "winword" };

        [JsonPropertyName("sandbox_root_path")]
        public string SandboxRootPath { get; set; } = @"C:\AgentSandbox\";
    }
}