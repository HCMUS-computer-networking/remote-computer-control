using System;
using System.Drawing;
using System.Windows.Forms;
using AgentSystem.Core;
using Serilog;

namespace AgentSystem.Forms
{
    public class TrayApp : ApplicationContext
    {
        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;
        private AgentClient agent;

        public TrayApp(AgentClient agentClient)
        {
            this.agent = agentClient;

            // Context Menu
            trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("Mở thư mục Log", null, OpenLogFolder);
            trayMenu.Items.Add("-");
            trayMenu.Items.Add("Thoát", null, Exit);

            // Khởi tạo System Tray Icon
            trayIcon = new NotifyIcon()
            {
                Text = "Agent System đang chạy ẩn",
                Icon = SystemIcons.Shield, // Dùng biểu tượng khiên bảo mật mặc định
                ContextMenuStrip = trayMenu,
                Visible = true
            };
        }

        private void OpenLogFolder(object sender, EventArgs e)
        {
            try
            {
                string logPath = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Logs");
                if (System.IO.Directory.Exists(logPath))
                {
                    System.Diagnostics.Process.Start("explorer.exe", logPath);
                }
                else
                {
                    MessageBox.Show("Thư mục Log chưa được tạo.", "Thông báo", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Lỗi khi mở thư mục Log: {ex.Message}", "Lỗi", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Log.Error(ex, "[TrayApp] Lỗi mở thư mục log");
            }
        }

        private void Exit(object sender, EventArgs e)
        {
            // Dọn dẹp trước khi tắt app
            trayIcon.Visible = false;
            trayIcon.Dispose();
            Application.Exit();
        }
    }
}
