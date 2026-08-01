using System;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Text.Json;
using AgentSystem.Models;
using Serilog;

namespace AgentSystem.Managers
{
    public static class ConfigManager
    {
        private static string GetConfigFilePath()
        {
            string baseDirConfig = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "config.json");
            if (File.Exists(baseDirConfig)) return baseDirConfig;
            
            string cwdConfig = Path.Combine(Directory.GetCurrentDirectory(), "config.json");
            if (File.Exists(cwdConfig)) return cwdConfig;

            return baseDirConfig;
        }

        public static AppConfig Current { get; private set; }

        public static void Load()
        {
            string configPath = GetConfigFilePath();
            try
            {
                if (File.Exists(configPath))
                {
                    string json = File.ReadAllText(configPath);
                    Current = JsonSerializer.Deserialize<AppConfig>(json) ?? new AppConfig();
                }
                else
                {
                    Current = new AppConfig();
                }

                // NẾU AGENT_ID ĐANG ĐỂ TRỐNG HOẶC MẶC ĐỊNH -> TỰ ĐỘNG LẤY TÊN MÁY WINDOWS
                if (string.IsNullOrWhiteSpace(Current.AgentId) || Current.AgentId == "AUTO" || Current.AgentId == "PC-Lab-01")
                {
                    Current.AgentId = GetAutoAgentId();
                }

                Save(); // Lưu lại cấu hình chuẩn
                Log.Information("[Config] Đã tải config thành công: AgentId={AgentId}, GatewayUrl={GatewayUrl}", Current.AgentId, Current.GatewayUrl);
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Lỗi đọc config.json, dùng cấu hình mặc định: {ErrorMessage}", ex.Message);                Current = new AppConfig { AgentId = GetAutoAgentId() };
            }
        }

        /// <summary>
        /// Tự động tạo Agent ID duy nhất dựa trên Tên máy Windows + 4 ký tự cuối MAC Address
        /// </summary>
        private static string GetAutoAgentId()
        {
            try
            {
                // 1. Lấy tên máy Windows (ví dụ: LAB01-PC15)
                string machineName = Environment.MachineName;

                // 2. Lấy địa chỉ MAC card mạng đầu tiên đang hoạt động (Để đảm bảo 100% không trùng)
                var macAddress = NetworkInterface.GetAllNetworkInterfaces()
                    .Where(nic => nic.OperationalStatus == OperationalStatus.Up && nic.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                    .Select(nic => nic.GetPhysicalAddress().ToString())
                    .FirstOrDefault();

                string macSuffix = !string.IsNullOrEmpty(macAddress) && macAddress.Length >= 4 
                    ? "-" + macAddress.Substring(macAddress.Length - 4) 
                    : "";

                return $"{machineName}{macSuffix}"; // Kết quả dạng: LAB01-PC15-8A2F
            }
            catch
            {
                // Fallback nếu không đọc được thông tin phần cứng
                return $"AGENT-{Environment.MachineName}";
            }
        }

        public static void Save()
        {
            try
            {
                var options = new JsonSerializerOptions { WriteIndented = true };
                string json = JsonSerializer.Serialize(Current, options);
                File.WriteAllText(GetConfigFilePath(), json);
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Lỗi khi lưu config.json: {ErrorMessage}", ex.Message);
            }
        }
    }
}