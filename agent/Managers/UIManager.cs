using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
using Timer = System.Windows.Forms.Timer;
using Serilog;
using System.Runtime.InteropServices;

namespace AgentSystem.Managers
{
    // Outcome of a consent popup. The bool return of ShowConsentPopupAsync
    // conflated three cases; callers that need to surface a precise reason
    // (e.g. Remote Input toast on the Controller) use the enum overload.
    public enum ConsentOutcome
    {
        Granted,                                                                                    // User clicked Approve
        Declined,                                                                                   // User clicked Reject
        Timeout,                                                                                    // ConsentForm auto-closed without a click
        Busy,                                                                                       // Anti-DoS: previous popup for same module still open
    }

    public class UIManager
    {
        private OverlayForm currentOverlay;                                                         //
        private Thread overlayThread;                                                               //
        private InputOverlayForm currentInputOverlay;                                               // Separate overlay for Remote Input so it does not collide with Webcam red dot
        private Thread inputOverlayThread;                                                          //
        private static HashSet<string> _activePermissionPopups = new HashSet<string>();
        private static readonly object _lock = new object();
        
        // 1. Consent popup — blocks the caller until the user answers or timeout fires.
        //    ConsentOutcome tells the caller WHICH negative case happened so it can
        //    surface a clearer reason to the operator (e.g. Remote Input toast).
        public async Task<ConsentOutcome> ShowConsentPopupOutcomeAsync(string moduleName, int timeoutMs)
        {
            lock (_lock)
            {
                // Anti-DoS: an earlier popup for the SAME module is still open, so
                // reject this request immediately instead of stacking dialogs.
                if (_activePermissionPopups.Contains(moduleName))
                {
                    Log.Information("[UIManager] Consent request for '{moduleName}' auto-rejected (previous popup still open — Anti-DoS).", moduleName);
                    return ConsentOutcome.Busy;
                }
                _activePermissionPopups.Add(moduleName);
            }

            var tcs = new TaskCompletionSource<bool>();                                             // true = user clicked Approve

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
                    // Surface the exception to the awaiting Task rather than
                    // silently hanging the permission_request pipeline.
                    tcs.TrySetException(ex);
                }
                finally
                {
                    lock (_lock)
                    {
                        _activePermissionPopups.Remove(moduleName);
                    }
                }
            });
            uiThread.SetApartmentState(ApartmentState.STA);
            uiThread.Start();

            // Hard timeout guard = form's own timeout + 2 s slack for teardown.
            // When THIS delay wins, the ConsentForm never posted a result, so
            // we treat it as a genuine hard-timeout (not a user decline).
            var completedTask = await Task.WhenAny(tcs.Task, Task.Delay(timeoutMs + 2000));
            if (completedTask == tcs.Task)
            {
                bool approved = await tcs.Task;
                return approved ? ConsentOutcome.Granted : ConsentOutcome.Declined;
            }

            Log.Warning("[UIManager] ConsentForm hard-timeout triggered for '{moduleName}'.", moduleName);
            lock (_lock) { _activePermissionPopups.Remove(moduleName); }
            return ConsentOutcome.Timeout;
        }

        // Legacy bool wrapper — kept so PowerModule and any other caller that
        // only cares about "did the user say yes" does not need to change.
        public async Task<bool> ShowConsentPopupAsync(string moduleName, int timeoutMs)
        {
            ConsentOutcome outcome = await ShowConsentPopupOutcomeAsync(moduleName, timeoutMs);
            return outcome == ConsentOutcome.Granted;
        }

        // 2. Giao diện đếm ngược chung (Webcam, Screen)
        public void ShowCountdown(int seconds, string title, string formatMessage)
        {
            Thread uiThread = new Thread(() =>
            {
                using (var form = new CountdownForm(seconds, title, formatMessage))
                {
                    Application.Run(form);
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

        // 4. Blue keyboard-icon Overlay for Remote Input (top-LEFT so it does                      //
        //    NOT overlap the webcam red dot at top-right). Distinct visual so the                 //
        //    Agent user can tell at a glance which feature is currently active.                   //
        public void ShowInputOverlay()
        {
            if (inputOverlayThread != null && inputOverlayThread.IsAlive) return;

            inputOverlayThread = new Thread(() =>
            {
                currentInputOverlay = new InputOverlayForm();
                Application.Run(currentInputOverlay);
            });

            inputOverlayThread.SetApartmentState(ApartmentState.STA);
            inputOverlayThread.Start();
        }

        public void HideInputOverlay()
        {
            if (currentInputOverlay != null && !currentInputOverlay.IsDisposed)
            {
                currentInputOverlay.Invoke(new Action(() =>
                {
                    currentInputOverlay.Close();
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
            this.Text = "System Security Alert";
            this.Size = new Size(400, 200);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.TopMost = true; // Luôn nằm trên cùng
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.BackColor = Color.White;

            this.Shown += (s, e) =>
            {
                this.Activate();
                SetForegroundWindow(this.Handle);
                this.Focus();
            };

            // Nhãn thông báo
            lblMessage = new Label
            {
                Text = $"The Control Center is requesting access to: [{moduleName.ToUpper()}].\n\nDo you allow it? (Auto-declines in {timeLeft}s)",
                Location = new Point(20, 20),
                Size = new Size(340, 60),
                Font = new Font("Arial", 10, FontStyle.Regular)
            };
            this.Controls.Add(lblMessage);

            // Nút Đồng ý
            Button btnAccept = new Button
            {
                Text = "Approve",
                Location = new Point(50, 100),
                Size = new Size(120, 40),
                BackColor = Color.LightGreen
            };
            btnAccept.Click += (s, e) => 
            { 
                IsApproved = true;
                Log.Information("[Security] Người dùng ĐÃ ĐỒNG Ý cấp quyền cho module: {ModuleName}", moduleName);
                this.Close(); 
            };
            this.Controls.Add(btnAccept);

            // Nút Từ chối
            Button btnReject = new Button
            {
                Text = "Reject",
                Location = new Point(210, 100),
                Size = new Size(120, 40),
                BackColor = Color.LightCoral
            };
            btnReject.Click += (s, e) => 
            { 
                IsApproved = false; 
                Log.Information("[Security] Người dùng ĐÃ TỪ CHỐI cấp quyền cho module: {ModuleName}", moduleName);
                this.Close(); 
            };
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
                    lblMessage.Text = $"The Control Center is requesting access to: [{moduleName.ToUpper()}].\n\nDo you allow it? (Auto-declines in {timeLeft}s)";
                }
            };
            timeoutTimer.Start();
        }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetForegroundWindow(IntPtr hWnd);
    }

    // 2. Form Đếm ngược (Webcam)
    internal class CountdownForm : Form
    {
        private int timeLeft;
        private Label lblCount;
        private Timer countdownTimer;

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        public CountdownForm(int seconds, string title, string formatMessage)
        {
            timeLeft = seconds;

            this.Text = title;
            this.Size = new Size(300, 150);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.TopMost = true;
            this.FormBorderStyle = FormBorderStyle.FixedToolWindow;
            this.BackColor = Color.FromArgb(255, 240, 240);

            this.Shown += (s, e) =>
            {
                this.Activate();
                SetForegroundWindow(this.Handle);
                this.Focus();
            };

            lblCount = new Label
            {
                Text = string.Format(formatMessage, timeLeft),
                Location = new Point(10, 40),
                Size = new Size(260, 50),
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
                    lblCount.Text = string.Format(formatMessage, timeLeft);
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

    // 4. Blue keyboard-icon Overlay for Remote Input (top-LEFT corner)                             //
    //    Rendered as a solid blue square with a white "K" so it is instantly                       //
    //    distinguishable from the webcam red dot (top-right).                                      //
    internal class InputOverlayForm : Form
    {
        private bool isIconVisible = true;                                                          //
        private Timer flashTimer;                                                                   //

        public InputOverlayForm()
        {
            this.FormBorderStyle = FormBorderStyle.None;
            this.TopMost         = true;
            this.ShowInTaskbar   = false;
            this.BackColor       = Color.Magenta;
            this.TransparencyKey = Color.Magenta;

            // Top-LEFT so it never overlaps the webcam overlay at top-right.
            this.Size     = new Size(50, 50);
            this.Location = new Point(20, 20);

            flashTimer = new Timer { Interval = 700 };                                              // Slower flash than webcam so the two are visually distinct
            flashTimer.Tick += (s, e) =>
            {
                isIconVisible = !isIconVisible;
                this.Invalidate();
            };
            flashTimer.Start();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            if (!isIconVisible) return;

            using (Brush bg = new SolidBrush(Color.DodgerBlue))
            {
                e.Graphics.FillRectangle(bg, 5, 5, 40, 40);                                         // Solid blue rounded-ish square
            }
            using (Brush fg = new SolidBrush(Color.White))
            using (Font  font = new Font("Arial", 18, FontStyle.Bold))
            {
                e.Graphics.DrawString("K", font, fg, 13, 8);                                        // "K" = keyboard/input
            }
        }

        // Click-through so it never steals input from the Agent user's own apps.
        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= 0x20;                                                                 // WS_EX_TRANSPARENT
                return cp;
            }
        }

        // Stop + Dispose the flashing Timer when the form is torn down.                            //
        // Without this, every grant/revoke cycle would leak one WinForms                           //
        // Timer (and its GDI handle) — the loop runs on Application.Run's                          //
        // pumped thread and outlives the form otherwise.                                           //
        protected override void Dispose(bool disposing)
        {
            if (disposing && flashTimer != null)
            {
                flashTimer.Stop();
                flashTimer.Dispose();
                flashTimer = null;
            }
            base.Dispose(disposing);
        }
    }

    #endregion
}