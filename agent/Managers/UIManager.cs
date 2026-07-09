using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
using Timer = System.Windows.Forms.Timer;

namespace AgentSystem.Managers
{
    public class UIManager
    {
        private OverlayForm currentOverlay;
        private Thread overlayThread;
        private static HashSet<string> _activePermissionPopups = new HashSet<string>();
        private static readonly object _lock = new object();
        
        // 1. Popup Xin Quyền (Chặn luồng và chờ kết quả)
        public Task<bool> ShowConsentPopupAsync(string moduleName, int timeoutMs)        {
            lock (_lock)
            {
                // Nếu đang có popup của module này hiển thị -> Tự động Từ chối (Reject) ngay lập tức
                if (_activePermissionPopups.Contains(moduleName))
                {
                    Console.WriteLine($"[UIManager] Request xin quyền module '{moduleName}' bị từ chối do popup cũ chưa đóng (Anti-DoS).");
                    return Task.FromResult(false);  
                }

                // Đánh dấu module này đang hiện popup
                _activePermissionPopups.Add(moduleName);
            }
            // bool isApproved = false;
            var tcs = new TaskCompletionSource<bool>(); // Sử dụng TCS để báo trạng thái

            Thread uiThread = new Thread(() =>
            {
                try
                {
                    using (var form = new ConsentForm(moduleName, timeoutMs))
                    {
                        form.ShowDialog();
                        tcs.TrySetResult(form.IsApproved);
                    }
                }
                catch (Exception ex)
                {
                    // CHỮA LỖI: Cảnh báo ngược cho luồng Task thay vì làm ngầm lỗi (chặn "treo await vĩnh viễn")
                    tcs.TrySetException(ex); 
                }
                finally
                {
                    // === [GIẢI PHÓNG MODULE KHỎI HASHSET KHI POPUP ĐÓNG] ===
                    lock (_lock)
                    {
                        _activePermissionPopups.Remove(moduleName);
                    }
                }
            });
            uiThread.SetApartmentState(ApartmentState.STA);
            uiThread.Start();

            // Chờ kết quả đồng bộ mà không làm chết Thread
            return tcs.Task; 
        }

        // 2. Giao diện đếm ngược (Dùng cho Webcam)
        public void ShowWebcamCountdown(int seconds)
        {
            Thread uiThread = new Thread(() =>
            {
                using (var form = new CountdownForm(seconds))
                {
                    form.ShowDialog();
                }
            });

            uiThread.SetApartmentState(ApartmentState.STA);
            uiThread.Start();
            // Không gọi Join() ở đây vì luồng gọi (WebcamModule) đã có sẵn Thread.Sleep(10000)
        }

        // 3. Chấm đỏ cảnh báo Always-On-Top
        public void ShowRedDotOverlay()
        {
            if (overlayThread != null && overlayThread.IsAlive) return;

            overlayThread = new Thread(() =>
            {
                currentOverlay = new OverlayForm();
                Application.Run(currentOverlay); // Duy trì vòng lặp UI
            });

            overlayThread.SetApartmentState(ApartmentState.STA);
            overlayThread.Start();
        }

        public void HideRedDotOverlay()
        {
            if (currentOverlay != null && !currentOverlay.IsDisposed)
            {
                // Yêu cầu UI thread của Overlay đóng Form
                currentOverlay.Invoke(new Action(() =>
                {
                    currentOverlay.Close();
                }));
            }
        }
    }

    #region --- Các Lớp Giao Diện (WinForms) ---

    // 1. Form Xin Quyền
    internal class ConsentForm : Form
    {
        public bool IsApproved { get; private set; } = false;
        private int timeLeft;
        private Label lblMessage;
        private Timer timeoutTimer;

        public ConsentForm(string moduleName, int timeoutMs)
        {
            timeLeft = timeoutMs / 1000;
            
            // Cấu hình Form
            this.Text = "Cảnh báo Bảo mật Hệ thống";
            this.Size = new Size(400, 200);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.TopMost = true; // Luôn nằm trên cùng
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.BackColor = Color.White;

            // Nhãn thông báo
            lblMessage = new Label
            {
                Text = $"Hệ thống Trung tâm đang yêu cầu quyền truy cập vào: [{moduleName.ToUpper()}].\n\nBạn có đồng ý không? (Tự động từ chối sau {timeLeft}s)",
                Location = new Point(20, 20),
                Size = new Size(340, 60),
                Font = new Font("Arial", 10, FontStyle.Regular)
            };
            this.Controls.Add(lblMessage);

            // Nút Đồng ý
            Button btnAccept = new Button
            {
                Text = "Đồng ý (Approve)",
                Location = new Point(50, 100),
                Size = new Size(120, 40),
                BackColor = Color.LightGreen
            };
            btnAccept.Click += (s, e) => { IsApproved = true; this.Close(); };
            this.Controls.Add(btnAccept);

            // Nút Từ chối
            Button btnReject = new Button
            {
                Text = "Từ chối (Reject)",
                Location = new Point(210, 100),
                Size = new Size(120, 40),
                BackColor = Color.LightCoral
            };
            btnReject.Click += (s, e) => { IsApproved = false; this.Close(); };
            this.Controls.Add(btnReject);

            // Bộ đếm thời gian
            timeoutTimer = new Timer { Interval = 1000 };
            timeoutTimer.Tick += (s, e) =>
            {
                timeLeft--;
                if (timeLeft <= 0)
                {
                    timeoutTimer.Stop();
                    IsApproved = false;
                    this.Close(); // Tự động đóng và trả về Reject
                }
                else
                {
                    lblMessage.Text = $"Hệ thống Trung tâm đang yêu cầu quyền truy cập vào: [{moduleName.ToUpper()}].\n\nBạn có đồng ý không? (Tự động từ chối sau {timeLeft}s)";
                }
            };
            timeoutTimer.Start();
        }
    }

    // 2. Form Đếm ngược (Webcam)
    internal class CountdownForm : Form
    {
        private int timeLeft;
        private Label lblCount;
        private Timer countdownTimer;

        public CountdownForm(int seconds)
        {
            timeLeft = seconds;

            this.Text = "Cảnh báo Ghi hình";
            this.Size = new Size(300, 150);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.TopMost = true;
            this.FormBorderStyle = FormBorderStyle.FixedToolWindow;
            this.BackColor = Color.FromArgb(255, 240, 240);

            lblCount = new Label
            {
                Text = $"Camera sẽ được kích hoạt sau {timeLeft} giây...",
                Location = new Point(10, 40),
                Size = new Size(260, 30),
                TextAlign = ContentAlignment.MiddleCenter,
                Font = new Font("Arial", 11, FontStyle.Bold),
                ForeColor = Color.Red
            };
            this.Controls.Add(lblCount);

            countdownTimer = new Timer { Interval = 1000 };
            countdownTimer.Tick += (s, e) =>
            {
                timeLeft--;
                if (timeLeft <= 0)
                {
                    countdownTimer.Stop();
                    this.Close();
                }
                else
                {
                    lblCount.Text = $"Camera sẽ được kích hoạt sau {timeLeft} giây...";
                }
            };
            countdownTimer.Start();
        }
    }

    // 3. Form Chấm đỏ Overlay
    internal class OverlayForm : Form
    {
        private bool isDotVisible = true;
        private Timer flashTimer;

        public OverlayForm()
        {
            // Thiết lập cửa sổ trong suốt, không viền, xuyên thấu click chuột
            this.FormBorderStyle = FormBorderStyle.None;
            this.TopMost = true;
            this.ShowInTaskbar = false;
            this.BackColor = Color.Magenta;
            this.TransparencyKey = Color.Magenta; // Màu Magenta sẽ trở nên trong suốt hoàn toàn
            
            // Kích thước và vị trí (Góc trên cùng bên phải màn hình)
            this.Size = new Size(50, 50);
            Rectangle bounds = Screen.PrimaryScreen.Bounds;
            this.Location = new Point(bounds.Width - 70, 20);

            // Timer tạo hiệu ứng nhấp nháy 500ms
            flashTimer = new Timer { Interval = 500 };
            flashTimer.Tick += (s, e) =>
            {
                isDotVisible = !isDotVisible;
                this.Invalidate(); // Yêu cầu vẽ lại Form
            };
            flashTimer.Start();
        }

        // Ghi đè sự kiện Paint để vẽ chấm đỏ
        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            if (isDotVisible)
            {
                // Vẽ một chấm tròn màu đỏ
                using (Brush brush = new SolidBrush(Color.Red))
                {
                    e.Graphics.FillEllipse(brush, 10, 10, 20, 20);
                }
            }
        }

        // Đảm bảo các sự kiện chuột xuyên qua Form này xuống ứng dụng bên dưới
        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x20; // WS_EX_TRANSPARENT
                return cp;
            }
        }
    }

    

    #endregion
}