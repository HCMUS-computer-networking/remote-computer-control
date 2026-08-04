using System;
using System.Drawing;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using AgentSystem.Core;
using AgentSystem.Managers;
using Serilog;
using Microsoft.Extensions.DependencyInjection;
using AgentSystem.Modules;
using AgentSystem.Forms;

namespace AgentSystem
{
    internal class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // === THÊM ĐOẠN NÀY ĐỂ KHỞI TẠO LOG ===
            Log.Logger = new LoggerConfiguration()
                .MinimumLevel.Debug() // Ghi lại từ mức Debug trở lên
                .WriteTo.Console()    // Hiển thị log ra cửa sổ Console
                .WriteTo.File("Logs/agent-.log", rollingInterval: RollingInterval.Day) // Lưu vào file theo ngày
                .CreateLogger();

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            
            // Thay thế Console.WriteLine bằng Log.Information để đồng bộ
            Log.Information("===========================================");
            Log.Information("       AGENT SYSTEM IS STARTING...        ");
            Log.Information("===========================================");

            try
            {
                ConfigManager.Load();

                // Khởi chạy dọn dẹp log định kỳ
                LogCleanupJob.Start(ConfigManager.Current.LogRetentionDays);

                string agentId = ConfigManager.Current.AgentId;
                string gatewayUrl = ConfigManager.Current.GatewayUrl;

                bool forceConfig = Array.Exists(args, arg => arg.Equals("--config", StringComparison.OrdinalIgnoreCase));
                if (string.IsNullOrEmpty(gatewayUrl) || forceConfig)
                {
                    using (var configForm = new GatewayConfigForm(gatewayUrl))
                    {
                        if (configForm.ShowDialog() == DialogResult.OK)
                        {
                            gatewayUrl = configForm.GatewayUrl;
                            if (ConfigManager.Current.GatewayUrl != gatewayUrl)
                            {
                                ConfigManager.Current.GatewayUrl = gatewayUrl;
                                ConfigManager.Save();
                                Log.Information("[INFO] Đã lưu URL Gateway mới vào cấu hình.");
                            }
                        }
                        else
                        {
                            Log.Information("[INFO] Người dùng đã hủy cấu hình. Đang thoát hệ thống...");
                            return;
                        }
                    }
                }

                var services = new ServiceCollection();
                services.AddSingleton<SecurityManager>();
                services.AddSingleton<UIManager>();
                services.AddTransient<BaseModule, AppModule>();
                services.AddTransient<BaseModule, ProcessModule>();
                services.AddTransient<BaseModule, KeyloggerModule>();
                services.AddTransient<BaseModule, WebcamModule>();
                services.AddTransient<BaseModule, FileModule>();
                services.AddTransient<BaseModule, StreamModule>();
                services.AddTransient<BaseModule, PowerModule>();
                services.AddTransient<BaseModule, SysInfoModule>();
                services.AddTransient<BaseModule, InputModule>();

                services.AddSingleton<AgentClient>(provider => 
                {
                    var security = provider.GetRequiredService<SecurityManager>();
                    var ui = provider.GetRequiredService<UIManager>();
                    return new AgentClient(agentId, gatewayUrl, security, ui);
                });
                services.AddSingleton<IAgentContext>(provider => provider.GetRequiredService<AgentClient>());

                var serviceProvider = services.BuildServiceProvider();
                AgentClient agent = serviceProvider.GetRequiredService<AgentClient>();
                var modules = serviceProvider.GetServices<BaseModule>();
                agent.RegisterModules(modules);

                agent.Start();
                Log.Information("[INFO] Agent '{agentId}' started.", agentId);
                Log.Information("[INFO] Connecting to Gateway: {gatewayUrl}", gatewayUrl);
                Log.Information("[INFO] Running in background via System Tray...");
                Application.Run(new TrayApp(agent));
            }
            catch (Exception ex)
            {
                Log.Error(ex, "[ERROR] Fatal System Error: {Message}", ex.Message);
            }
            finally
            {
                Log.Information("[INFO] Agent main loop exited.");
                Log.CloseAndFlush();
            }
        }
    }
}
