using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using AgentSystem.Models;
using Serilog;

namespace AgentSystem.Managers
{
    public class SecurityManager
    {
        private List<string> appWhitelist = new List<string>();
        private string sandboxRootPath = @"C:\AgentSandbox\";

        public void UpdatePolicy(List<string> newWhitelist, string newSandboxPath)
        {
            if (newWhitelist != null)
            {
                // Xóa danh sách cũ, nạp danh sách chuẩn từ Server vào RAM
                this.appWhitelist = new List<string>(newWhitelist.Select(x => x.ToLower()));
            }

            if (!string.IsNullOrEmpty(newSandboxPath))
            {
                this.sandboxRootPath = newSandboxPath;
            }

            Log.Information("Đã cập nhật chính sách bảo mật từ Server vào RAM thành công!");
        }
        public SecurityManager()
        {
            appWhitelist = ConfigManager.Current.AppWhitelist;
            sandboxRootPath = ConfigManager.Current.SandboxRootPath;

            if (!Directory.Exists(sandboxRootPath))
            {
                Directory.CreateDirectory(sandboxRootPath);
            }
        }

        public bool IsAppWhitelisted(string appName)
        {
            return appWhitelist.Contains(appName.ToLower());
        }

        public bool IsPathInSandbox(string targetPath)
        {
            string normalizedPath = NormalizeAndValidatePath(targetPath);
            return normalizedPath.StartsWith(sandboxRootPath, StringComparison.OrdinalIgnoreCase);
        }

        public string NormalizeAndValidatePath(string relativePath)
        {
            if (relativePath.StartsWith("/"))
            {
                relativePath = relativePath.Substring(1);
            }

            string absoluteSandboxRoot = Path.GetFullPath(sandboxRootPath);

            // FIX: Đảm bảo đường dẫn gốc luôn kết thúc bằng dấu \
            // Nếu không có, thêm vào để tránh trường hợp C:\AgentSandbox khớp với C:\AgentSandbox_Hacked
            if (!absoluteSandboxRoot.EndsWith(Path.DirectorySeparatorChar.ToString()))
            {
                absoluteSandboxRoot += Path.DirectorySeparatorChar;
            }

            // Sử dụng đường dẫn gốc đã chuẩn hóa để tạo fullPath
            string fullPath = Path.GetFullPath(Path.Combine(absoluteSandboxRoot, relativePath));

            // Kiểm tra Path Traversal với đường dẫn gốc đã có dấu \
            if (!fullPath.StartsWith(absoluteSandboxRoot, StringComparison.OrdinalIgnoreCase))
            {
                throw new UnauthorizedAccessException("Attempted Path Traversal detected!");
            }

            return fullPath;
        }
    }
}