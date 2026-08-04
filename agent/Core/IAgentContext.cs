namespace AgentSystem.Core
{
    public interface IAgentContext
    {
        string AgentId { get; }
        void SendResponse(object responseData);
        void SendBinaryFrame(byte[] bytes);
        void HandleBinaryFrame(byte[] bytes);
        agent.Modules.CryptoModule Crypto { get; }
    }
}