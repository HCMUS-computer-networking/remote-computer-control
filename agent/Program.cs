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

namespace AgentSystem
{
    internal class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Console.WriteLine("===========================================");
            Console.WriteLine("       AGENT SYSTEM IS STARTING...        ");
            Console.WriteLine("===========================================");

            ConfigManager.Load();
            string agentId = ConfigManager.Current.AgentId;
            string gatewayUrl = ConfigManager.Current.GatewayUrl;

            using (var configForm = new GatewayConfigForm(gatewayUrl))
            {
                if (configForm.ShowDialog() == DialogResult.OK)
                {
                    gatewayUrl = configForm.GatewayUrl;
                    
                    // Nếu người dùng nhập URL mới, cập nhật lại vào Config và lưu xuống đĩa
                    if (ConfigManager.Current.GatewayUrl != gatewayUrl)
                    {
                        ConfigManager.Current.GatewayUrl = gatewayUrl;
                        ConfigManager.Save();
                        Console.WriteLine("[INFO] Đã lưu URL Gateway mới vào cấu hình.");
                    }
                }
                else
                {
                    Console.WriteLine("[INFO] Người dùng đã hủy cấu hình. Đang thoát hệ thống...");
                    return;
                }
            }

            AgentClient agent = new AgentClient(agentId, gatewayUrl);

            try
            {
                agent.Start();
                Console.WriteLine($"[INFO] Agent '{agentId}' started.");
                Console.WriteLine($"[INFO] Connecting to Gateway: {gatewayUrl}");
                Console.WriteLine("[INFO] Press ENTER to stop Agent...\n");
                Console.ReadLine();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ERROR] System error: {ex.Message}");
            }
            finally
            {
                agent.Stop();
                Console.WriteLine("[INFO] Agent stopped successfully.");
            }
        }
    }

    // --- LỚP GIAO DIỆN NHẬP ĐỊA CHỈ & DÒ TÌM GATEWAY ---
    internal class GatewayConfigForm : Form
    {
        public string GatewayUrl { get; private set; }
        private TextBox txtUrl;
        private Button btnScan;
        private Label lblStatus;
        private CancellationTokenSource cts;

        public GatewayConfigForm(string defaultUrl)
        {
            this.GatewayUrl = defaultUrl;

            this.Text = "Cấu hình kết nối hệ thống";
            this.Size = new Size(460, 220); // Mở rộng Form để chứa thêm nút và label
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.TopMost = true;
            this.BackColor = Color.White;

            Label lblInstruction = new Label
            {
                Text = "Nhập địa chỉ Gateway hoặc nhấn Tự động quét (UDP):",
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
                Text = "Tự động quét",
                Location = new Point(20, 95),
                Size = new Size(110, 35),
                BackColor = Color.LightSkyBlue
            };
            btnScan.Click += BtnScan_Click;
            this.Controls.Add(btnScan);

            // Nút: Kết nối
            Button btnConnect = new Button
            {
                Text = "Kết nối (Connect)",
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
                Text = "Thoát (Exit)",
                Location = new Point(300, 95),
                Size = new Size(120, 35),
                BackColor = Color.LightGray,
                DialogResult = DialogResult.Cancel
            };
            this.Controls.Add(btnCancel);

            // Nhãn hiển thị trạng thái quét
            lblStatus = new Label
            {
                Text = "Sẵn sàng.",
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
            lblStatus.Text = "Đang lắng nghe tín hiệu Gateway trên mạng LAN (Port 8888)...";
            lblStatus.ForeColor = Color.Blue;

            cts = new CancellationTokenSource();
            
            try
            {
                // Mở cổng UDP 8888 để lắng nghe Broadcast
                using (UdpClient udpClient = new UdpClient(8888))
                {
                    // Chờ tối đa 5 giây
                    var receiveTask = udpClient.ReceiveAsync();
                    var delayTask = Task.Delay(5000, cts.Token);
                    
                    var completedTask = await Task.WhenAny(receiveTask, delayTask);

                    if (completedTask == receiveTask)
                    {
                        var result = receiveTask.Result;
                        string message = Encoding.UTF8.GetString(result.Buffer);
                        
                        // Quy ước: Gateway gửi chuỗi "GATEWAY_ANNOUNCE|wss://192.168.X.X:8080"
                        if (message.StartsWith("GATEWAY_ANNOUNCE|"))
                        {
                            string[] parts = message.Split('|');
                            if (parts.Length == 2)
                            {
                                // Kiểm tra an toàn: Đảm bảo Gateway trả về link WSS
                                string discoveredUrl = parts[1];
                                if (discoveredUrl.StartsWith("ws://"))
                                {
                                    discoveredUrl = discoveredUrl.Replace("ws://", "wss://");
                                }
                                
                                txtUrl.Text = discoveredUrl;
                                lblStatus.Text = $"Tìm thấy Gateway an toàn tại: {result.RemoteEndPoint.Address}";
                                lblStatus.ForeColor = Color.Green;
                            }
                        }
                    }
                    else
                    {
                        lblStatus.Text = "Hết thời gian (5s). Không tìm thấy Gateway nào phát tín hiệu.";
                        lblStatus.ForeColor = Color.Red;
                    }
                }
            }
            catch (SocketException ex)
            {
                lblStatus.Text = $"Lỗi cổng UDP: {ex.Message} (Có thể app khác đang dùng port 8888)";
                lblStatus.ForeColor = Color.Red;
            }
            catch (Exception ex)
            {
                lblStatus.Text = $"Lỗi: {ex.Message}";
                lblStatus.ForeColor = Color.Red;
            }
            finally
            {
                btnScan.Enabled = true;
                cts.Dispose();
            }
        }
    }
}