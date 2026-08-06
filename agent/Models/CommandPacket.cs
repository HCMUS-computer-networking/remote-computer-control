using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgentSystem.Models
{
    public class CommandPacket
    {
        [JsonPropertyName("type")]
        public string Type { get; set; }

        [JsonPropertyName("command_id")]
        public string CommandId { get; set; }

        [JsonPropertyName("issuer")]
        public string Issuer { get; set; }

        [JsonPropertyName("module")]
        public string Module { get; set; }

        [JsonPropertyName("action")]
        public string Action { get; set; }

        [JsonPropertyName("params")]
        public JsonElement Params { get; set; }

        [JsonPropertyName("target_agents")]
        public string[] TargetAgents { get; set; }

        [JsonPropertyName("feature")]
        public string Feature { get; set; }

        [JsonPropertyName("publicKey")]
        public string PublicKey { get; set; }

        [JsonPropertyName("signature")]
        public string Signature { get; set; }

        [JsonPropertyName("seq")]
        public uint Seq { get; set; }

        [JsonPropertyName("data")]
        public string Data { get; set; }
    }
}