using AgentSystem.Core;
using AgentSystem.Managers;

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

        public abstract void Execute(string action, System.Text.Json.JsonElement parameters, string commandId);
    }
}