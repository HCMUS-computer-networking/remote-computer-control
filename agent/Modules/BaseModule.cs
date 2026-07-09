using AgentSystem.Core;
using AgentSystem.Managers;
using System.Threading.Tasks;
using System.Text.Json;

namespace AgentSystem.Modules
{
    public abstract class BaseModule
    {
        protected IAgentContext context;
        protected SecurityManager security;
        protected UIManager ui;

        public abstract string[] SupportedCommands { get; }

        protected BaseModule(IAgentContext context, SecurityManager security, UIManager ui)
        {
            this.context = context;
            this.security = security;
            this.ui = ui;
        }
        
        public abstract Task ExecuteAsync(string action, JsonElement parameters, string commandId);    }
}