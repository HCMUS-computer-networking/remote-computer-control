using AgentSystem.Core;
using AgentSystem.Managers;

namespace AgentSystem.Modules
{
    public abstract class BaseModule
    {
        protected AgentClient context;
        protected SecurityManager security;
        protected UIManager ui;

        protected BaseModule(AgentClient context)
        {
            this.context = context;
            this.security = context.SecurityManager;
            this.ui = context.UIManager;
        }

        public abstract void Execute(string action, System.Text.Json.JsonElement parameters, string commandId);
    }
}