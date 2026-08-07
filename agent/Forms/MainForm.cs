using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
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

        // Chừa lề trong cho TextBox để chữ cái đầu không bị sát/che mép trái.
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        private const int EM_SETMARGINS = 0xD3;
        private const int EC_LEFTMARGIN = 0x1;
        private const int EC_RIGHTMARGIN = 0x2;

        private static void SetTextBoxMargins(TextBox tb, int left, int right)
        {
            void Apply()
            {
                int lp = (right << 16) | (left & 0xFFFF);
                SendMessage(tb.Handle, EM_SETMARGINS, (IntPtr)(EC_LEFTMARGIN | EC_RIGHTMARGIN), (IntPtr)lp);
            }
            if (tb.IsHandleCreated) Apply();
            else tb.HandleCreated += (s, e) => Apply();
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
            this.SuspendLayout();

            this.Text = "Remote Computer Control - Agent";
            // Scale the whole layout from a 96-DPI baseline so it stays correct
            // under PerMonitorV2 DPI (see Program.cs). AutoScaleMode.Dpi pairs with
            // the (96,96) baseline; the AutoSize layout containers below keep every
            // label/button from clipping, overlapping, or wrapping.
            this.AutoScaleMode = AutoScaleMode.Dpi;
            this.AutoScaleDimensions = new SizeF(96F, 96F);
            this.FormBorderStyle = FormBorderStyle.Sizable;
            this.MinimumSize = new Size(480, 600);
            this.ClientSize = new Size(480, 600);
            this.MaximizeBox = true;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Icon = SystemIcons.Shield;
            this.BackColor = Color.White;
            this.Font = new Font("Segoe UI", 9F);

            // --- Bố cục gốc: 1 cột, các hàng tự co giãn theo nội dung ---
            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                ColumnCount = 1,
                RowCount = 6,
                Padding = new Padding(16),
                BackColor = Color.White
            };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // 0: title
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // 1: status
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // 2: agent info
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // 3: buttons
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // 4: module title
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F)); // 5: module list (fills)
            this.Controls.Add(root);

            lblTitle = new Label
            {
                Text = "AGENT DASHBOARD",
                Font = new Font("Segoe UI", 13F, FontStyle.Bold),
                AutoSize = true,
                Margin = new Padding(0, 0, 0, 8)
            };
            root.Controls.Add(lblTitle, 0, 0);

            // --- Thẻ trạng thái kết nối (dot + text trên cùng một hàng) ---
            var statusRow = new FlowLayoutPanel
            {
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Margin = new Padding(0, 0, 0, 10)
            };
            lblConnDot = new Label
            {
                Text = "●",
                Font = new Font("Segoe UI", 11F, FontStyle.Bold),
                AutoSize = true,
                Margin = new Padding(0, 2, 4, 0)
            };
            lblStatus = new Label
            {
                Text = "Checking...",
                Font = new Font("Segoe UI", 10F, FontStyle.Bold),
                AutoSize = true,
                Margin = new Padding(0, 4, 0, 0)
            };
            statusRow.Controls.Add(lblConnDot);
            statusRow.Controls.Add(lblStatus);
            root.Controls.Add(statusRow, 0, 1);

            // --- Thông tin Agent (label + textbox, 2 cột co giãn) ---
            var infoTable = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                AutoSize = true,
                ColumnCount = 2,
                RowCount = 2,
                Margin = new Padding(0, 0, 0, 10)
            };
            infoTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            infoTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            infoTable.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            infoTable.RowStyles.Add(new RowStyle(SizeType.AutoSize));

            var lblAgentId = new Label
            {
                Text = "Agent ID:",
                AutoSize = true,
                Anchor = AnchorStyles.Left,
                Margin = new Padding(0, 6, 10, 6)
            };
            txtAgentId = new TextBox
            {
                Text = _agent.AgentId,
                ReadOnly = true,
                TabStop = false,
                Dock = DockStyle.Fill,
                BorderStyle = BorderStyle.FixedSingle,
                Margin = new Padding(0, 4, 0, 4)
            };
            var lblGateway = new Label
            {
                Text = "Gateway URL:",
                AutoSize = true,
                Anchor = AnchorStyles.Left,
                Margin = new Padding(0, 6, 10, 6)
            };
            txtGateway = new TextBox
            {
                Text = _agent.GatewayUrl,
                ReadOnly = true,
                TabStop = false,
                Dock = DockStyle.Fill,
                BorderStyle = BorderStyle.FixedSingle,
                Margin = new Padding(0, 4, 0, 4)
            };
            infoTable.Controls.Add(lblAgentId, 0, 0);
            infoTable.Controls.Add(txtAgentId, 1, 0);
            infoTable.Controls.Add(lblGateway, 0, 1);
            infoTable.Controls.Add(txtGateway, 1, 1);
            root.Controls.Add(infoTable, 0, 2);

            // Chừa 4px lề trái/phải để chữ cái đầu hiện đầy đủ.
            SetTextBoxMargins(txtAgentId, 4, 4);
            SetTextBoxMargins(txtGateway, 4, 4);

            // --- Nút kết nối / ngắt kết nối ---
            var btnRow = new FlowLayoutPanel
            {
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                FlowDirection = FlowDirection.LeftToRight,
                WrapContents = false,
                Margin = new Padding(0, 0, 0, 14)
            };
            btnConnToggle = new Button
            {
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                MinimumSize = new Size(150, 34),
                Padding = new Padding(12, 0, 12, 0),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                Margin = new Padding(0, 0, 10, 0)
            };
            btnConnToggle.FlatAppearance.BorderSize = 0;
            btnConnToggle.Click += BtnConnToggle_Click;

            btnConfig = new Button
            {
                Text = "Change Gateway",
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                MinimumSize = new Size(150, 34),
                Padding = new Padding(12, 0, 12, 0),
                FlatStyle = FlatStyle.Flat
            };
            btnConfig.Click += BtnConfig_Click;

            btnRow.Controls.Add(btnConnToggle);
            btnRow.Controls.Add(btnConfig);
            root.Controls.Add(btnRow, 0, 3);

            // --- Tiêu đề khu module ---
            var lblModTitle = new Label
            {
                Text = "PER-MODULE CONTROL STATUS",
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                ForeColor = Color.FromArgb(80, 80, 80),
                AutoSize = true,
                Margin = new Padding(0, 0, 0, 6)
            };
            root.Controls.Add(lblModTitle, 0, 4);

            // --- Bảng 8 module: 3 cột (tên | trạng thái | nút), tự co giãn ---
            pnlModules = new Panel
            {
                Dock = DockStyle.Fill,
                BorderStyle = BorderStyle.FixedSingle,
                AutoScroll = true,
                Margin = new Padding(0)
            };
            root.Controls.Add(pnlModules, 0, 5);

            var modTable = new TableLayoutPanel
            {
                Dock = DockStyle.Top,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                ColumnCount = 3,
                Padding = new Padding(8, 6, 8, 6)
            };
            modTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F)); // tên (fill)
            modTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));      // trạng thái
            modTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));      // nút Exit
            pnlModules.Controls.Add(modTable);

            int rowIndex = 0;
            foreach (var feature in AgentClient.AllFeatures)
            {
                string display = FeatureNames.TryGetValue(feature, out var n) ? n : feature;
                modTable.RowStyles.Add(new RowStyle(SizeType.AutoSize));

                var name = new Label
                {
                    Text = display,
                    AutoSize = true,
                    Anchor = AnchorStyles.Left,
                    Margin = new Padding(4, 9, 12, 9)
                };
                modTable.Controls.Add(name, 0, rowIndex);

                var status = new Label
                {
                    Text = "Idle",
                    AutoSize = true,
                    Anchor = AnchorStyles.Left,
                    Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                    ForeColor = ClrIdle,
                    Margin = new Padding(4, 9, 12, 9),
                    MinimumSize = new Size(110, 0)
                };
                modTable.Controls.Add(status, 1, rowIndex);

                var exit = new Button
                {
                    Text = "Exit",
                    Tag = feature,
                    AutoSize = true,
                    AutoSizeMode = AutoSizeMode.GrowAndShrink,
                    MinimumSize = new Size(80, 30),
                    Padding = new Padding(10, 0, 10, 0),
                    FlatStyle = FlatStyle.Flat,
                    Enabled = false,
                    Margin = new Padding(4, 4, 4, 4)
                };
                exit.Click += BtnExitModule_Click;
                modTable.Controls.Add(exit, 2, rowIndex);

                _rows[feature] = new ModuleRow { Status = status, Exit = exit };
                rowIndex++;
            }

            this.FormClosing += MainForm_FormClosing;

            // Sau khi hiện form: đưa con trỏ text về đầu (không cuộn lệch, không bôi đen)
            // và trả focus cho nút Connect thay vì ô chỉ-đọc.
            this.Shown += (s, e) =>
            {
                txtAgentId.SelectionStart = 0;
                txtAgentId.SelectionLength = 0;
                txtGateway.SelectionStart = 0;
                txtGateway.SelectionLength = 0;
                this.ActiveControl = btnConnToggle;
            };

            this.ResumeLayout(true);
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

                btnConnToggle.Text = "Connect";
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
