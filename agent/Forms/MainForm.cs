using System;
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
        private Label lblAgentIdLabel;
        private TextBox txtAgentId;
        private Label lblGatewayLabel;
        private TextBox txtGateway;
        private Label lblStatusLabel;
        private Label lblStatus;
        private Button btnConnect;
        
        public MainForm(AgentClient agent)
        {
            _agent = agent;
            InitializeComponent();
            
            // Lắng nghe sự kiện kết nối
            _agent.OnConnectedEvent += Agent_OnConnected;
            _agent.OnDisconnectedEvent += Agent_OnDisconnected;
            
            // Cập nhật trạng thái ban đầu
            UpdateStatus();
        }

        private void InitializeComponent()
        {
            this.Text = "Remote Computer Control - Agent";
            this.Size = new Size(400, 250);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Icon = SystemIcons.Shield;
            
            lblTitle = new Label();
            lblTitle.Text = "AGENT DASHBOARD";
            lblTitle.Font = new Font("Segoe UI", 12F, FontStyle.Bold);
            lblTitle.Location = new Point(20, 15);
            lblTitle.AutoSize = true;
            this.Controls.Add(lblTitle);

            lblAgentIdLabel = new Label();
            lblAgentIdLabel.Text = "Agent ID:";
            lblAgentIdLabel.Location = new Point(20, 60);
            lblAgentIdLabel.AutoSize = true;
            this.Controls.Add(lblAgentIdLabel);

            txtAgentId = new TextBox();
            txtAgentId.Text = _agent.AgentId;
            txtAgentId.ReadOnly = true;
            txtAgentId.Location = new Point(120, 57);
            txtAgentId.Width = 220;
            this.Controls.Add(txtAgentId);

            lblGatewayLabel = new Label();
            lblGatewayLabel.Text = "Gateway URL:";
            lblGatewayLabel.Location = new Point(20, 95);
            lblGatewayLabel.AutoSize = true;
            this.Controls.Add(lblGatewayLabel);

            txtGateway = new TextBox();
            txtGateway.Text = _agent.GatewayUrl;
            txtGateway.ReadOnly = true;
            txtGateway.Location = new Point(120, 92);
            txtGateway.Width = 220;
            this.Controls.Add(txtGateway);

            lblStatusLabel = new Label();
            lblStatusLabel.Text = "Trạng thái:";
            lblStatusLabel.Location = new Point(20, 130);
            lblStatusLabel.AutoSize = true;
            this.Controls.Add(lblStatusLabel);

            lblStatus = new Label();
            lblStatus.Text = "Đang kiểm tra...";
            lblStatus.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            lblStatus.Location = new Point(120, 130);
            lblStatus.AutoSize = true;
            this.Controls.Add(lblStatus);

            btnConnect = new Button();
            btnConnect.Text = "Kết nối lại";
            btnConnect.Location = new Point(120, 165);
            btnConnect.Width = 100;
            btnConnect.Click += BtnConnect_Click;
            this.Controls.Add(btnConnect);

            Button btnConfig = new Button();
            btnConfig.Text = "Đổi Gateway";
            btnConfig.Location = new Point(230, 165);
            btnConfig.Width = 110;
            btnConfig.Click += (s, e) => {
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
            };
            this.Controls.Add(btnConfig);
            
            this.FormClosing += MainForm_FormClosing;
        }

        private void BtnConnect_Click(object sender, EventArgs e)
        {
            if (!_agent.IsConnected)
            {
                lblStatus.Text = "Đang kết nối...";
                lblStatus.ForeColor = Color.Orange;
                _agent.Reconnect();
            }
        }

        private void Agent_OnConnected()
        {
            if (this.InvokeRequired)
            {
                this.BeginInvoke(new Action(Agent_OnConnected));
                return;
            }
            UpdateStatus();
        }

        private void Agent_OnDisconnected()
        {
            if (this.InvokeRequired)
            {
                this.BeginInvoke(new Action(Agent_OnDisconnected));
                return;
            }
            UpdateStatus();
        }

        private void UpdateStatus()
        {
            if (_agent.IsConnected)
            {
                lblStatus.Text = "Đã kết nối";
                lblStatus.ForeColor = Color.Green;
                btnConnect.Enabled = false;
            }
            else
            {
                lblStatus.Text = "Mất kết nối";
                lblStatus.ForeColor = Color.Red;
                btnConnect.Enabled = true;
            }
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            // Chỉ chặn nếu người dùng bấm dấu X. Nếu ứng dụng tắt (Application.Exit), cho phép tắt.
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                this.Hide();
            }
        }
    }
}
