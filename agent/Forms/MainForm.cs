using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;
using AgentSystem.Core;
using AgentSystem.Managers;

namespace AgentSystem.Forms
{
    public class MainForm : Form
    {
        private AgentClient _agent;

        private Label lblTitle;
        private Label lblConnDot;
        private Label lblStatus;
        private TextBox txtAgentId;
        private TextBox txtGateway;
        private Button btnConnToggle;
        private Button btnConfig;

        private Panel pnlModules;

        // Ánh xạ feature -> các control của một dòng module để cập nhật nhanh.
        private readonly Dictionary<string, ModuleRow> _rows = new Dictionary<string, ModuleRow>();

        // Display names for the 8 modules (matches AgentClient.AllFeatures).
        private static readonly Dictionary<string, string> FeatureNames = new Dictionary<string, string>
        {
            { "application", "Application" },
            { "process",     "Process" },
            { "screen",      "Screen" },
            { "keylog",      "Keylogger" },
            { "file",        "File Transfer" },
            { "webcam",      "Webcam" },
            { "power",       "Power" },
            { "input",       "Remote Input" },
        };

        private static readonly Color ClrControlled = Color.FromArgb(200, 40, 40);
        private static readonly Color ClrIdle       = Color.FromArgb(120, 120, 120);
        private static readonly Color ClrConnected  = Color.FromArgb(30, 150, 60);
        private static readonly Color ClrDisconnect = Color.FromArgb(200, 40, 40);

        private sealed class ModuleRow
        {
            public Label Status;
            public Button Exit;
        }

        public MainForm(AgentClient agent)
        {
            _agent = agent;
            InitializeComponent();

            _agent.OnConnectedEvent          += Agent_OnConnected;
            _agent.OnDisconnectedEvent       += Agent_OnDisconnected;
            _agent.OnPermissionsChangedEvent += Agent_OnPermissionsChanged;

            this.Disposed += (s, e) =>
            {
                _agent.OnConnectedEvent          -= Agent_OnConnected;
                _agent.OnDisconnectedEvent       -= Agent_OnDisconnected;
                _agent.OnPermissionsChangedEvent -= Agent_OnPermissionsChanged;
            };

            RefreshAll();
        }

        private void InitializeComponent()
        {
            this.Text = "Remote Computer Control - Agent";
            this.Size = new Size(470, 560);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Icon = SystemIcons.Shield;
            this.BackColor = Color.White;
            this.Font = new Font("Segoe UI", 9F);

            lblTitle = new Label
            {
                Text = "AGENT DASHBOARD",
                Font = new Font("Segoe UI", 13F, FontStyle.Bold),
                Location = new Point(20, 15),
                AutoSize = true
            };
            this.Controls.Add(lblTitle);

            // --- Thẻ trạng thái kết nối ---
            lblConnDot = new Label
            {
                Text = "●",
                Font = new Font("Segoe UI", 12F, FontStyle.Bold),
                Location = new Point(22, 50),
                AutoSize = true
            };
            this.Controls.Add(lblConnDot);

            lblStatus = new Label
            {
                Text = "Checking...",
                Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                Location = new Point(42, 52),
                AutoSize = true
            };
            this.Controls.Add(lblStatus);

            // --- Thông tin Agent ---
            var lblAgentId = new Label { Text = "Agent ID:", Location = new Point(20, 88), AutoSize = true };
            this.Controls.Add(lblAgentId);
            txtAgentId = new TextBox
            {
                Text = _agent.AgentId,
                ReadOnly = true,
                Location = new Point(120, 85),
                Width = 320,
                BorderStyle = BorderStyle.FixedSingle
            };
            this.Controls.Add(txtAgentId);

            var lblGateway = new Label { Text = "Gateway URL:", Location = new Point(20, 118), AutoSize = true };
            this.Controls.Add(lblGateway);
            txtGateway = new TextBox
            {
                Text = _agent.GatewayUrl,
                ReadOnly = true,
                Location = new Point(120, 115),
                Width = 320,
                BorderStyle = BorderStyle.FixedSingle
            };
            this.Controls.Add(txtGateway);

            // --- Nút kết nối / ngắt kết nối ---
            btnConnToggle = new Button
            {
                Location = new Point(120, 148),
                Size = new Size(150, 32),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold)
            };
            btnConnToggle.FlatAppearance.BorderSize = 0;
            btnConnToggle.Click += BtnConnToggle_Click;
            this.Controls.Add(btnConnToggle);

            btnConfig = new Button
            {
                Text = "Change Gateway",
                Location = new Point(285, 148),
                Size = new Size(155, 32),
                FlatStyle = FlatStyle.Flat
            };
            btnConfig.Click += BtnConfig_Click;
            this.Controls.Add(btnConfig);

            // --- Tiêu đề khu module ---
            var lblModTitle = new Label
            {
                Text = "PER-MODULE CONTROL STATUS",
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                ForeColor = Color.FromArgb(80, 80, 80),
                Location = new Point(20, 195),
                AutoSize = true
            };
            this.Controls.Add(lblModTitle);

            // --- Bảng 8 module ---
            pnlModules = new Panel
            {
                Location = new Point(20, 218),
                Size = new Size(420, 300),
                BorderStyle = BorderStyle.FixedSingle,
                AutoScroll = true
            };
            this.Controls.Add(pnlModules);

            int y = 6;
            foreach (var feature in AgentClient.AllFeatures)
            {
                string display = FeatureNames.TryGetValue(feature, out var n) ? n : feature;

                var name = new Label
                {
                    Text = display,
                    Location = new Point(8, y + 6),
                    Width = 190,
                    AutoEllipsis = true
                };
                pnlModules.Controls.Add(name);

                var status = new Label
                {
                    Text = "Idle",
                    Location = new Point(200, y + 6),
                    Width = 110,
                    Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                    ForeColor = ClrIdle
                };
                pnlModules.Controls.Add(status);

                var exit = new Button
                {
                    Text = "Exit",
                    Tag = feature,
                    Location = new Point(315, y + 2),
                    Size = new Size(90, 28),
                    FlatStyle = FlatStyle.Flat,
                    Enabled = false
                };
                exit.Click += BtnExitModule_Click;
                pnlModules.Controls.Add(exit);

                _rows[feature] = new ModuleRow { Status = status, Exit = exit };
                y += 36;
            }

            this.FormClosing += MainForm_FormClosing;
        }

        // ================= Sự kiện =================

        private void BtnConnToggle_Click(object sender, EventArgs e)
        {
            if (_agent.IsConnected)
            {
                lblStatus.Text = "Disconnecting...";
                lblStatus.ForeColor = Color.Orange;
                lblConnDot.ForeColor = Color.Orange;
                _agent.DisconnectManually();
            }
            else
            {
                lblStatus.Text = "Connecting...";
                lblStatus.ForeColor = Color.Orange;
                lblConnDot.ForeColor = Color.Orange;
                _agent.Reconnect();
            }
        }

        private void BtnConfig_Click(object sender, EventArgs e)
        {
            using (var configForm = new GatewayConfigForm(_agent.GatewayUrl))
            {
                if (configForm.ShowDialog() == DialogResult.OK)
                {
                    string newUrl = configForm.GatewayUrl;
                    if (!string.IsNullOrWhiteSpace(newUrl))
                    {
                        ConfigManager.Current.GatewayUrl = newUrl;
                        ConfigManager.Save();
                        txtGateway.Text = newUrl;
                        _agent.Reconnect();
                    }
                }
            }
        }

        private void BtnExitModule_Click(object sender, EventArgs e)
        {
            if (sender is Button btn && btn.Tag is string feature)
            {
                string display = FeatureNames.TryGetValue(feature, out var n) ? n : feature;
                var confirm = MessageBox.Show(
                    $"Exit controlled mode for the [{display}] module?\n\n" +
                    "The permission will be revoked and the Controller must request it again to continue.",
                    "Confirm exit control",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Warning);

                if (confirm == DialogResult.Yes)
                {
                    _agent.RevokeFeatureLocally(feature);
                }
            }
        }

        private void Agent_OnConnected()          => RunOnUi(RefreshAll);
        private void Agent_OnDisconnected()       => RunOnUi(RefreshAll);
        private void Agent_OnPermissionsChanged() => RunOnUi(RefreshModules);

        private void RunOnUi(Action action)
        {
            if (this.IsDisposed) return;
            if (this.InvokeRequired)
            {
                try { this.BeginInvoke(action); } catch (ObjectDisposedException) { }
                return;
            }
            action();
        }

        // ================= Cập nhật giao diện =================

        private void RefreshAll()
        {
            if (_agent.IsConnected)
            {
                lblStatus.Text = "Connected";
                lblStatus.ForeColor = ClrConnected;
                lblConnDot.ForeColor = ClrConnected;

                btnConnToggle.Text = "Disconnect";
                btnConnToggle.BackColor = ClrDisconnect;
                btnConnToggle.Enabled = true;
            }
            else
            {
                lblStatus.Text = "Disconnected";
                lblStatus.ForeColor = ClrDisconnect;
                lblConnDot.ForeColor = ClrDisconnect;

                btnConnToggle.Text = "Reconnect";
                btnConnToggle.BackColor = ClrConnected;
                btnConnToggle.Enabled = true;
            }

            RefreshModules();
        }

        private void RefreshModules()
        {
            bool connected = _agent.IsConnected;
            foreach (var feature in AgentClient.AllFeatures)
            {
                if (!_rows.TryGetValue(feature, out var row)) continue;

                bool controlled = connected && _agent.IsFeatureGranted(feature);
                if (controlled)
                {
                    row.Status.Text = "● Controlled";
                    row.Status.ForeColor = ClrControlled;
                    row.Exit.Enabled = true;
                }
                else
                {
                    row.Status.Text = "Idle";
                    row.Status.ForeColor = ClrIdle;
                    row.Exit.Enabled = false;
                }
            }
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            // Chỉ ẩn khi người dùng bấm dấu X; cho phép tắt khi Application.Exit.
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                this.Hide();
            }
        }
    }
}
