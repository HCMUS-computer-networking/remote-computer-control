using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using AgentSystem.Core;

namespace AgentSystem.Modules
{
    public class FileModule : BaseModule
    {
        private readonly object _chunkLock = new object();
        private Dictionary<string, int> expectedChunks = new Dictionary<string, int>();

        public FileModule(AgentClient context) : base(context) { }

        public override void Execute(string action, JsonElement parameters, string commandId)
        {
            try
            {
                string relativePath = parameters.TryGetProperty("path", out var pathElement) ? pathElement.GetString() : "/";

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
                        GetFile(fullPath, relativePath, commandId);
                        break;
                    case "fs_put":
                        int chunkIndex = parameters.TryGetProperty("chunk_index", out var ci) ? ci.GetInt32() : 0;
                        int totalChunks = parameters.TryGetProperty("total_chunks", out var tc) ? tc.GetInt32() : 1;
                        string base64Content = parameters.GetProperty("data_base64").GetString();

                        PutFile(fullPath, relativePath, base64Content, chunkIndex, totalChunks, commandId);
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

        private void PutFile(string fullPath, string relativePath, string base64Content, int chunkIndex, int totalChunks, string commandId)
        {
            string directoryPath = Path.GetDirectoryName(fullPath);
            if (!Directory.Exists(directoryPath)) Directory.CreateDirectory(directoryPath);

            byte[] fileBytes = Convert.FromBase64String(base64Content);

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
            using (var stream = new FileStream(fullPath, mode, FileAccess.Write, FileShare.None))
            {
                stream.Write(fileBytes, 0, fileBytes.Length);
            }

            context.SendResponse(new
            {
                type = "fs_put_result",
                agent_id = context.AgentId,
                command_id = commandId,
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
                    context.SendResponse(new
                    {
                        type = "fs_put_complete",
                        agent_id = context.AgentId,
                        command_id = commandId,
                        path = relativePath,
                        success = true,
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

            // Khai báo lại các biến directories và files trong scope của phương thức
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

        private void GetFile(string fullPath, string relativePath, string commandId)
        {
            if (!File.Exists(fullPath))
            {
                SendError(commandId, "fs_get", relativePath, "File does not exist.");
                return;
            }

            byte[] fileBytes = File.ReadAllBytes(fullPath);
            // Khai báo biến base64String
            string base64String = Convert.ToBase64String(fileBytes);

            context.SendResponse(new
            {
                type = "fs_get_result",
                agent_id = context.AgentId,
                command_id = commandId,
                success = true,
                path = relativePath,
                content = base64String
            });
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
    }
}