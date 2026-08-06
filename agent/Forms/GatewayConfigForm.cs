using System;
using System.Drawing;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using AgentSystem.Utils;

namespace AgentSystem.Forms
{
    // --- LỚP GIAO DIỆN NHẬP ĐỊA CHỈ & DÒ TÌM GATEWAY ---
    internal class GatewayConfigForm : Form
    {
        public string GatewayUrl { get; private set; }
        private TextBox txtUrl;
        private Button btnScan;
        private Label lblStatus;

        public GatewayConfigForm(string defaultUrl)
        {
            this.GatewayUrl = defaultUrl;

            this.Text = "System Connection Settings";
            this.Size = new Size(460, 220); // Widen the form to fit the extra button and label
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.ShowInTaskbar = true;
            this.TopMost = true;
            this.Shown += (s, e) => { this.BringToFront(); this.Activate(); };
            this.BackColor = Color.White;

            Label lblInstruction = new Label
            {
                Text = "Enter the Gateway address or click Auto-scan (UDP):",
                Location = new Point(20, 20),
                Size = new Size(400, 20),
                Font = new Font("Arial", 9, FontStyle.Bold)
            };
            this.Controls.Add(lblInstruction);

            txtUrl = new TextBox
            {
                Text = defaultUrl,
                Location = new Point(20, 50),
                Size = new Size(400, 25),
                Font = new Font("Arial", 10, FontStyle.Regular)
            };
            this.Controls.Add(txtUrl);

            // Nút: Tự động quét UDP
            btnScan = new Button
            {
                Text = "Auto-scan",
                Location = new Point(20, 95),
                Size = new Size(110, 35),
                BackColor = Color.LightSkyBlue
            };
            btnScan.Click += BtnScan_Click;
            this.Controls.Add(btnScan);

            // Nút: Kết nối
            Button btnConnect = new Button
            {
                Text = "Connect",
                Location = new Point(160, 95),
                Size = new Size(120, 35),
                BackColor = Color.LightGreen,
                DialogResult = DialogResult.OK
            };
            btnConnect.Click += (s, e) => { this.GatewayUrl = txtUrl.Text; };
            this.Controls.Add(btnConnect);

            // Nút: Thoát
            Button btnCancel = new Button
            {
                Text = "Cancel",
                Location = new Point(300, 95),
                Size = new Size(120, 35),
                BackColor = Color.LightGray,
                DialogResult = DialogResult.Cancel
            };
            this.Controls.Add(btnCancel);

            // Nhãn hiển thị trạng thái quét
            lblStatus = new Label
            {
                Text = "Ready.",
                Location = new Point(20, 145),
                Size = new Size(400, 20),
                Font = new Font("Arial", 8, FontStyle.Italic),
                ForeColor = Color.Gray
            };
            this.Controls.Add(lblStatus);

            this.AcceptButton = btnConnect;
            this.CancelButton = btnCancel;
        }

        private async void BtnScan_Click(object sender, EventArgs e)
        {
            btnScan.Enabled = false;
            lblStatus.Text = "Listening for Gateway beacons on the LAN (port 8888)...";
            lblStatus.ForeColor = Color.Blue;

            try
            {
                string discoveredUrl = await NetworkDiscovery.ScanForGatewayAsync(5000);
                if (!string.IsNullOrEmpty(discoveredUrl))
                {
                    txtUrl.Text = discoveredUrl;
                    lblStatus.Text = $"Found a secure Gateway at: {discoveredUrl}";
                    lblStatus.ForeColor = Color.Green;
                }
                else
                {
                    lblStatus.Text = "Timed out (5s). No Gateway beacon found.";
                    lblStatus.ForeColor = Color.Red;
                }
            }
            finally
            {
                btnScan.Enabled = true;
            }
        }
    }
}
