using System;
using Xunit;
using AgentSystem.Managers;

namespace AgentSystem.Tests
{
    public class SecurityManagerTests
    {
        private readonly SecurityManager _securityManager;

        public SecurityManagerTests()
        {
            // Cần khởi tạo cấu hình trước để SecurityManager constructor không bị lỗi (NullReferenceException)
            ConfigManager.Load();
            
            // Khởi tạo với cấu hình Sandbox giả lập
            _securityManager = new SecurityManager();
            _securityManager.UpdatePolicy(null, @"C:\AgentSandbox\");
        }

        [Theory]
        [InlineData("../../Windows/System32/cmd.exe")]
        [InlineData("..\\..\\boot.ini")]
        [InlineData("C:\\Windows\\System32\\config\\SAM")]
        [InlineData("/../../etc/passwd")]
        public void NormalizeAndValidatePath_PathTraversalAttacks_ThrowsUnauthorizedAccessException(string maliciousPath)
        {
            // Assert
            Assert.Throws<UnauthorizedAccessException>(() => 
                _securityManager.NormalizeAndValidatePath(maliciousPath)
            );
        }

        [Theory]
        [InlineData("test_file.txt")]
        [InlineData("subfolder/image.png")]
        public void NormalizeAndValidatePath_ValidSandboxPaths_ReturnsFullPath(string validPath)
        {
            // Act
            string result = _securityManager.NormalizeAndValidatePath(validPath);

            // Assert
            Assert.StartsWith(@"C:\AgentSandbox\", result, StringComparison.OrdinalIgnoreCase);
        }
    }
}
