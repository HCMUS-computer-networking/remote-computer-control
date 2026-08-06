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
        
        private MainForm mainForm;

        public TrayApp(AgentClient agentClient)
        {
            this.agent = agentClient;
            
            mainForm = new MainForm(agent);
            this.MainForm = mainForm;
            mainForm.Show();

            bool isAutoStart = CheckAutoStart();
            autoStartMenuItem = new ToolStripMenuItem("Start with Windows", null, ToggleAutoStart);
            autoStartMenuItem.Checked = isAutoStart;

            // Context Menu
            trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("Dashboard", null, ShowDashboard);
            trayMenu.Items.Add("-");
            trayMenu.Items.Add(autoStartMenuItem);
            trayMenu.Items.Add("-");
            trayMenu.Items.Add("Open Log Folder", null, OpenLogFolder);
            trayMenu.Items.Add("-");
            trayMenu.Items.Add("Exit", null, Exit);

            // Khởi tạo System Tray Icon
            trayIcon = new NotifyIcon()
            {
                Text = "Remote Computer Control - Agent",
                Icon = SystemIcons.Shield, // Dùng biểu tượng khiên bảo mật mặc định
                ContextMenuStrip = trayMenu,
                Visible = true
            };
            
            trayIcon.DoubleClick += ShowDashboard;
        }

        private void ShowDashboard(object sender, EventArgs e)
        {
            if (mainForm.IsDisposed)
            {
                mainForm = new MainForm(agent);
            }
            mainForm.Show();
            mainForm.WindowState = FormWindowState.Normal;
            mainForm.BringToFront();
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
                MessageBox.Show($"Unable to modify the Registry: {ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
                    MessageBox.Show("The Log folder has not been created yet.", "Notice", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Error opening the Log folder: {ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
