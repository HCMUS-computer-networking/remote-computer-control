using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgentSystem.Core;
using AgentSystem.Managers;
using System.Security.Cryptography;

namespace AgentSystem.Modules
{
    public class FileModule : BaseModule
    {
        private readonly object _chunkLock = new object();
        private Dictionary<string, int> expectedChunks = new Dictionary<string, int>();
        private readonly ConcurrentDictionary<string, TaskCompletionSource<byte[]>> _binaryWaiters = new ConcurrentDictionary<string, TaskCompletionSource<byte[]>>();

        public override string[] SupportedCommands => new[] { "fs_list", "fs_get", "fs_put" };

        public FileModule(IAgentContext context, SecurityManager security, UIManager ui) 
            : base(context, security, ui) { }

        public void HandleBinaryChunk(byte[] bytes)
        {
            // Luồng dữ liệu Binary Frame (hiện tại fs_put đã chuyển qua dùng Base64).
            // Hàm này giữ lại để đảm bảo tương thích AgentClient.
        }

        public override async Task ExecuteAsync(string action, JsonElement parameters, string commandId)
        {
            try
            {
                bool isObj = parameters.ValueKind == JsonValueKind.Object;
                string relativePath = isObj && parameters.TryGetProperty("path", out var pathElement) ? pathElement.GetString() : "/";
                if (!security.IsPathInSandbox(relativePath))
                {
                    SendError(commandId, action, relativePath, "Path is outside the sandbox");
                    return;
                }

                string fullPath = security.NormalizeAndValidatePath(relativePath);

                switch (action)
                {
                    case "fs_list":
                        ListDirectory(fullPath, relativePath, commandId);
                        break;
                    case "fs_get":
                        await GetFileAsync(fullPath, relativePath, commandId, parameters);
                        break;
                    case "fs_put":
                        int chunkIndex = isObj && parameters.TryGetProperty("chunk_index", out var ci) ? ci.GetInt32() : 0;
                        int totalChunks = isObj && parameters.TryGetProperty("total_chunks", out var tc) ? tc.GetInt32() : 1;
                        string transferId = isObj && parameters.TryGetProperty("transfer_id", out var tid) ? tid.GetString() : commandId;

                        string base64Data = isObj && parameters.TryGetProperty("data_base64", out var b64) ? b64.GetString() : "";
                        byte[] fileBytes = string.IsNullOrEmpty(base64Data) ? Array.Empty<byte>() : Convert.FromBase64String(base64Data);

                        await PutFileAsync(fullPath, relativePath, transferId, chunkIndex, totalChunks, fileBytes, commandId);
                        break;
                    default:
                        SendError(commandId, action, relativePath, $"Unknown file system action: {action}");
                        break;
                }
            }
            catch (Exception ex)
            {
                string path = parameters.TryGetProperty("path", out var p) ? p.GetString() : "/";
                SendError(commandId, action, path, $"File operation failed: {ex.Message}");
            }
        }

        private async Task PutFileAsync(string fullPath, string relativePath, string transferId, int chunkIndex, int totalChunks, byte[] fileBytes, string commandId)
        {
            string directoryPath = Path.GetDirectoryName(fullPath);
            if (!Directory.Exists(directoryPath)) Directory.CreateDirectory(directoryPath);

            lock (_chunkLock)
            {
                if (chunkIndex == 0) expectedChunks[fullPath] = 0;
                if (!expectedChunks.ContainsKey(fullPath) || expectedChunks[fullPath] != chunkIndex)
                {
                    SendError(commandId, "fs_put", relativePath, "Out of order chunk received.");
                    expectedChunks.Remove(fullPath);
                    return;
                }
            }

            FileMode mode = (chunkIndex == 0) ? FileMode.Create : FileMode.Append;

            using (var stream = new FileStream(fullPath, mode, FileAccess.Write, FileShare.None, 4096, useAsync: true))
            {
                await stream.WriteAsync(fileBytes, 0, fileBytes.Length);
            }

            context.SendResponse(new
            {
                type = "fs_put_result",
                agent_id = context.AgentId,
                command_id = commandId,
                transfer_id = transferId,
                path = relativePath,
                chunk_index = chunkIndex,
                success = true,
                message = "Chunk received"
            });

            lock (_chunkLock)
            {
                expectedChunks[fullPath]++;
                if (chunkIndex == totalChunks - 1)
                {
                    expectedChunks.Remove(fullPath);
                    
                    string fileHash = ComputeFileSHA256(fullPath);

                    context.SendResponse(new
                    {
                        type = "fs_put_complete",
                        agent_id = context.AgentId,
                        command_id = commandId,
                        transfer_id = transferId,
                        path = relativePath,
                        success = true,
                        sha256 = fileHash,
                        message = "File saved successfully"
                    });
                }
            }
        }

        private void ListDirectory(string fullPath, string relativePath, string commandId)
        {
            if (!Directory.Exists(fullPath))
            {
                SendError(commandId, "fs_list", relativePath, "Directory does not exist.");
                return;
            }

            DirectoryInfo dirInfo = new DirectoryInfo(fullPath);

            var directories = dirInfo.GetDirectories().Select(d => new
            {
                name = d.Name,
                type = "directory",
                size = (long?)null,
                modified_ms = new DateTimeOffset(d.LastWriteTimeUtc).ToUnixTimeMilliseconds()
            });

            var files = dirInfo.GetFiles().Select(f => new
            {
                name = f.Name,
                type = "file",
                size = (long?)f.Length,
                modified_ms = new DateTimeOffset(f.LastWriteTimeUtc).ToUnixTimeMilliseconds()
            });

            context.SendResponse(new
            {
                type = "fs_list_result",
                agent_id = context.AgentId,
                command_id = commandId,
                path = relativePath,
                entries = directories.Concat(files).ToList()
            });
        }

        private async Task GetFileAsync(string fullPath, string relativePath, string commandId, JsonElement parameters)
        {
            if (!File.Exists(fullPath))
            {
                SendError(commandId, "fs_get", relativePath, "File does not exist.");
                return;
            }

            const int CHUNK_SIZE = 512 * 1024; // 512 KB mỗi chunk
            bool isObj = parameters.ValueKind == JsonValueKind.Object;
            string transferId = isObj && parameters.TryGetProperty("transfer_id", out var tid) ? tid.GetString() : commandId;

            string fileHash = ComputeFileSHA256(fullPath);

            using var stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, useAsync: true);
            long totalSize = stream.Length;
            int totalChunks = (int)Math.Ceiling((double)totalSize / CHUNK_SIZE);
            if (totalChunks == 0) totalChunks = 1;

            byte[] buffer = new byte[CHUNK_SIZE];
            int chunkIndex = 0;
            int bytesRead;

            while ((bytesRead = await stream.ReadAsync(buffer, 0, CHUNK_SIZE)) > 0)
            {
                context.SendResponse(new
                {
                    type = "fs_get_result",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    transfer_id = transferId,
                    success = true,
                    path = relativePath,
                    total_size = totalSize,
                    chunk_index = chunkIndex,
                    total_chunks = totalChunks,
                    sha256 = (chunkIndex == totalChunks - 1) ? fileHash : null
                });

                if (bytesRead == CHUNK_SIZE)
                {
                    context.SendBinaryFrame(buffer);
                }
                else
                {
                    byte[] chunkData = new byte[bytesRead];
                    Buffer.BlockCopy(buffer, 0, chunkData, 0, bytesRead);
                    context.SendBinaryFrame(chunkData);
                }

                chunkIndex++;
            }
        }

        private void SendError(string commandId, string action, string path, string message)
        {
            context.SendResponse(new
            {
                type = "fs_error",
                agent_id = context.AgentId,
                command_id = commandId,
                operation = action,
                path = path,
                message = message
            });
        }
    
        private string ComputeSHA256(byte[] data)
        {
            using (SHA256 sha256 = SHA256.Create())
            {
                byte[] hashBytes = sha256.ComputeHash(data);
                return BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
            }
        }

        private string ComputeFileSHA256(string filePath)
        {
            using (SHA256 sha256 = SHA256.Create())
            using (FileStream stream = File.OpenRead(filePath))
            {
                byte[] hashBytes = sha256.ComputeHash(stream);
                return BitConverter.ToString(hashBytes).Replace("-", "").ToLowerInvariant();
            }
        }

        public override void OnDisconnected()
        {
            foreach (var kvp in _binaryWaiters)
            {
                kvp.Value.TrySetCanceled();
            }
            _binaryWaiters.Clear();

            lock (_chunkLock)
            {
                expectedChunks.Clear();
            }

            base.OnDisconnected();
        }
    }
}