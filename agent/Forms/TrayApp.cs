using System;
using System.Drawing;
using System.Windows.Forms;
using AgentSystem.Core;
using Serilog;
using Microsoft.Win32;
using AgentSystem.Managers;

namespace AgentSystem.Forms
{
    public class TrayApp : ApplicationContext
    {
        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;
        private AgentClient agent;
        
        private ToolStripMenuItem autoStartMenuItem;
        private const string RunKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
        private const string AppName = "AgentSystem";

        public TrayApp(AgentClient agentClient)
        {
            this.agent = agentClient;

            bool isAutoStart = CheckAutoStart();
            autoStartMenuItem = new ToolStripMenuItem("Khởi động cùng Windows", null, ToggleAutoStart);
            autoStartMenuItem.Checked = isAutoStart;

            // Context Menu
            trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add(autoStartMenuItem);
            trayMenu.Items.Add("-");
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

        private bool Authenticate()
        {
            if (string.IsNullOrEmpty(ConfigManager.Current.TrayPassword)) return true;

            using (var form = new PasswordPromptForm())
            {
                form.ShowDialog();
                return form.IsAuthenticated;
            }
        }

        private bool CheckAutoStart()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey))
                {
                    if (key != null)
                    {
                        var val = key.GetValue(AppName);
                        return val != null && val.ToString() == Application.ExecutablePath;
                    }
                }
            }
            catch { }
            return false;
        }

        private void ToggleAutoStart(object sender, EventArgs e)
        {
            if (!Authenticate()) return;

            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey, true))
                {
                    if (autoStartMenuItem.Checked)
                    {
                        key.DeleteValue(AppName, false);
                        autoStartMenuItem.Checked = false;
                        Log.Information("[TrayApp] Đã TẮT khởi động cùng Windows.");
                    }
                    else
                    {
                        key.SetValue(AppName, Application.ExecutablePath);
                        autoStartMenuItem.Checked = true;
                        Log.Information("[TrayApp] Đã BẬT khởi động cùng Windows.");
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Không thể thay đổi Registry: {ex.Message}", "Lỗi", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void OpenLogFolder(object sender, EventArgs e)
        {
            if (!Authenticate()) return;

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
            if (!Authenticate()) return;

            // Dọn dẹp trước khi tắt app
            trayIcon.Visible = false;
            trayIcon.Dispose();
            Application.Exit();
        }
    }
}
