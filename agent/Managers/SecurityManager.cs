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
            bool isChanged = false;

            if (newWhitelist != null)
            {
                this.appWhitelist = new List<string>(newWhitelist.Select(x => x.ToLower()));
                isChanged = true;
            }
            
            if (!string.IsNullOrEmpty(newSandboxPath))
            {
                this.sandboxRootPath = newSandboxPath;
                isChanged = true;
            }

            if (isChanged)
            {
                // Audit log chuẩn: Ghi rõ số lượng ứng dụng và đường dẫn Sandbox đang áp dụng
                Log.Information("[SecurityPolicy] Cập nhật Policy thành công (In-Memory). Whitelist: {AppCount} apps, Sandbox: '{SandboxPath}'", 
                    this.appWhitelist.Count, this.sandboxRootPath);
            }
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
            try
            {
                NormalizeAndValidatePath(targetPath);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public string NormalizeAndValidatePath(string relativePath)
        {
            if (relativePath.StartsWith("/"))
            {
                relativePath = relativePath.Substring(1);
            }

            string absoluteSandboxRoot = Path.GetFullPath(sandboxRootPath);
            string rootWithSeparator = absoluteSandboxRoot.EndsWith(Path.DirectorySeparatorChar.ToString())
                ? absoluteSandboxRoot
                : absoluteSandboxRoot + Path.DirectorySeparatorChar;

            string fullPath = Path.GetFullPath(Path.Combine(rootWithSeparator, relativePath));

            bool isRoot = fullPath.Equals(absoluteSandboxRoot, StringComparison.OrdinalIgnoreCase);
            bool isSub = fullPath.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase);

            if (!isRoot && !isSub)
            {
                throw new UnauthorizedAccessException("Attempted Path Traversal detected!");
            }

            return fullPath;
        }
    }
}