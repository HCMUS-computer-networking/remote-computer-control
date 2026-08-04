using System;
using System.Drawing;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;
using AgentSystem.Managers;

namespace AgentSystem.Utils
{
    public static class UdpStreamSender
    {
        private static UdpClient _udpClient;
        private static string _gatewayIp;
        private static int _gatewayPort = 9000;
        private static bool _isInitialized = false;
        private const int MAX_PAYLOAD_SIZE = 1300;

        public static void Initialize()
        {
            if (_isInitialized) return;

            try
            {
                _udpClient = new UdpClient();
                // Extract IP from GatewayUrl (e.g., ws://localhost:8080)
                Uri uri = new Uri(ConfigManager.Current.GatewayUrl);
                _gatewayIp = uri.Host;
                _isInitialized = true;
                Serilog.Log.Information("[UdpStreamSender] Initialized UDP Client. Target: {Ip}:{Port}", _gatewayIp, _gatewayPort);
            }
            catch (Exception ex)
            {
                Serilog.Log.Error(ex, "[UdpStreamSender] Failed to initialize UDP client");
            }
        }

        public static async Task SendFrameAsync(string agentId, string commandId, byte moduleType, ushort frameId, byte[] payloadData, long timestamp, bool isKeyframe, Rectangle bounds, agent.Modules.CryptoModule crypto)
        {
            if (!_isInitialized) Initialize();
            if (!_isInitialized || payloadData == null || payloadData.Length == 0) return;

            try
            {
                byte[] finalPayload = payloadData;
                if (crypto != null && crypto.IsE2EEReady)
                {
                    // AAD: Frame_ID (2 bytes) + Timestamp (8 bytes) = 10 bytes
                    byte[] aad = new byte[10];
                    BitConverter.GetBytes((ushort)frameId).CopyTo(aad, 0);
                    BitConverter.GetBytes((ulong)timestamp).CopyTo(aad, 2);
                    
                    finalPayload = crypto.EncryptUdpAESGCM(payloadData, aad);
                }

                int totalChunks = (int)Math.Ceiling((double)finalPayload.Length / MAX_PAYLOAD_SIZE);
                if (totalChunks > 255)
                {
                    Serilog.Log.Warning("[UdpStreamSender] Frame size too large. Chunks: {Count} > 255", totalChunks);
                    return;
                }

                byte[] agentIdBytes = Encoding.UTF8.GetBytes(agentId ?? "");
                byte[] commandIdBytes = Encoding.UTF8.GetBytes(commandId ?? "");
                
                byte l1 = (byte)agentIdBytes.Length;
                byte l2 = (byte)commandIdBytes.Length;

                for (int i = 0; i < totalChunks; i++)
                {
                    byte chunkIndex = (byte)i;
                    int offset = i * MAX_PAYLOAD_SIZE;
                    int chunkSize = Math.Min(MAX_PAYLOAD_SIZE, finalPayload.Length - offset);

                    // Allocate Header Buffer
                    int headerSize = 24 + l1 + l2;
                    byte[] packet = new byte[headerSize + chunkSize];

                    // Fixed Header (24 bytes)
                    packet[0] = chunkIndex;
                    packet[1] = (byte)totalChunks;
                    packet[2] = moduleType;
                    packet[3] = (byte)(isKeyframe ? 1 : 0);
                    
                    BitConverter.GetBytes((ushort)frameId).CopyTo(packet, 4);
                    BitConverter.GetBytes((ushort)bounds.X).CopyTo(packet, 6);
                    BitConverter.GetBytes((ushort)bounds.Y).CopyTo(packet, 8);
                    BitConverter.GetBytes((ushort)bounds.Width).CopyTo(packet, 10);
                    BitConverter.GetBytes((ushort)bounds.Height).CopyTo(packet, 12);
                    BitConverter.GetBytes((ulong)timestamp).CopyTo(packet, 14);
                    
                    packet[22] = l1;
                    packet[23] = l2;

                    // Dynamic Strings
                    if (l1 > 0) Buffer.BlockCopy(agentIdBytes, 0, packet, 24, l1);
                    if (l2 > 0) Buffer.BlockCopy(commandIdBytes, 0, packet, 24 + l1, l2);

                    // Payload
                    Buffer.BlockCopy(finalPayload, offset, packet, headerSize, chunkSize);

                    // Send Datagram
                    await _udpClient.SendAsync(packet, packet.Length, _gatewayIp, _gatewayPort);
                }

                // --- Forward Error Correction (FEC) Parity Chunk ---
                if (totalChunks > 1)
                {
                    byte[] parityPayload = new byte[4 + MAX_PAYLOAD_SIZE]; // 4 bytes for length + max chunk size (auto padded with 0x00)
                    BitConverter.GetBytes(finalPayload.Length).CopyTo(parityPayload, 0);

                    for (int i = 0; i < totalChunks; i++)
                    {
                        int offset = i * MAX_PAYLOAD_SIZE;
                        int size = Math.Min(MAX_PAYLOAD_SIZE, finalPayload.Length - offset);
                        for (int j = 0; j < size; j++)
                        {
                            parityPayload[4 + j] ^= finalPayload[offset + j];
                        }
                        // Chú ý 3: Mặc định mảng byte trong C# khởi tạo bằng 0. 
                        // Vòng lặp chỉ chạy tới size thật của chunk cuối, 
                        // tương đương với việc các byte dư (padding) của chunk cuối là 0x00 khi XOR.
                    }

                    int headerSize = 24 + l1 + l2;
                    byte[] parityPacket = new byte[headerSize + parityPayload.Length];

                    // Fixed Header for Parity Chunk (Chú ý 1)
                    parityPacket[0] = (byte)totalChunks; // Chunk_Index = totalChunks identifies the parity chunk
                    parityPacket[1] = (byte)totalChunks;
                    parityPacket[2] = moduleType;
                    parityPacket[3] = (byte)(isKeyframe ? 1 : 0);
                    
                    BitConverter.GetBytes((ushort)frameId).CopyTo(parityPacket, 4);
                    BitConverter.GetBytes((ushort)bounds.X).CopyTo(parityPacket, 6);
                    BitConverter.GetBytes((ushort)bounds.Y).CopyTo(parityPacket, 8);
                    BitConverter.GetBytes((ushort)bounds.Width).CopyTo(parityPacket, 10);
                    BitConverter.GetBytes((ushort)bounds.Height).CopyTo(parityPacket, 12);
                    BitConverter.GetBytes((ulong)timestamp).CopyTo(parityPacket, 14);
                    
                    parityPacket[22] = l1;
                    parityPacket[23] = l2;

                    if (l1 > 0) Buffer.BlockCopy(agentIdBytes, 0, parityPacket, 24, l1);
                    if (l2 > 0) Buffer.BlockCopy(commandIdBytes, 0, parityPacket, 24 + l1, l2);

                    Buffer.BlockCopy(parityPayload, 0, parityPacket, headerSize, parityPayload.Length);

                    await _udpClient.SendAsync(parityPacket, parityPacket.Length, _gatewayIp, _gatewayPort);
                }
            }
            catch (Exception ex)
            {
                Serilog.Log.Error("[UdpStreamSender] Error sending UDP frame: {Message}", ex.Message);
            }
        }
    }
}
