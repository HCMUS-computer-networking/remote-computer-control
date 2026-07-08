using System.Text.Json;
using AgentSystem.Models;

namespace AgentSystem.Core
{
    public class MessageDispatcher
    {
        private AgentClient context;

        public MessageDispatcher(AgentClient context)
        {
            this.context = context;
        }

        public void Dispatch(string rawJson)
        {
            var packet = JsonSerializer.Deserialize<CommandPacket>(rawJson);
            if (packet != null)
            {
                context.RouteCommand(packet);
            }
        }
    }
}