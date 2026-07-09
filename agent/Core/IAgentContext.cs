namespace AgentSystem.Core
{
    public interface IAgentContext
    {
        string AgentId { get; }
        void SendResponse(object responseData);
        void SendBinaryFrame(byte[] bytes);
    }
}