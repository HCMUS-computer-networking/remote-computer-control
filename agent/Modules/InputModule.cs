using System;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using AgentSystem.Core;
using AgentSystem.Managers;
using Serilog;

namespace AgentSystem.Modules
{
    public class InputModule : BaseModule
    {
        public override string[] SupportedCommands => new[]
        {
            "input_mouse_move",
            "input_mouse_click",
            "input_key",
            "input_type"
        };

        public InputModule(IAgentContext context, SecurityManager security, UIManager ui) 
            : base(context, security, ui) { }

        public override Task ExecuteAsync(string action, JsonElement parameters, string commandId)
        {
            switch (action)
            {
                case "input_mouse_move":
                    HandleMouseMove(parameters, commandId);
                    break;
                case "input_mouse_click":
                    HandleMouseClick(parameters, commandId);
                    break;
                case "input_key":
                    HandleKey(parameters, commandId);
                    break;
                case "input_type":
                    HandleType(parameters, commandId);
                    break;
                default:
                    context.SendResponse(new
                    {
                        type = "input_result",
                        agent_id = context.AgentId,
                        command_id = commandId,
                        success = false,
                        message = $"Unknown action: {action}"
                    });
                    break;
            }

            return Task.CompletedTask;
        }

        private void HandleMouseMove(JsonElement parameters, string commandId)
        {
            if (parameters.ValueKind == JsonValueKind.Object && parameters.TryGetProperty("x", out var xProp) && parameters.TryGetProperty("y", out var yProp))
            {
                int x = xProp.GetInt32();
                int y = yProp.GetInt32();
                SetCursorPos(x, y);
            }
            else
            {
                context.SendResponse(new
                {
                    type = "input_result",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    success = false,
                    message = "Missing x or y parameters."
                });
            }
        }

        private void HandleMouseClick(JsonElement parameters, string commandId)
        {
            bool isObj = parameters.ValueKind == JsonValueKind.Object;
            string button = isObj && parameters.TryGetProperty("button", out var bProp) ? bProp.GetString() : "left";
            string act = isObj && parameters.TryGetProperty("action", out var aProp) ? aProp.GetString() : "click";

            uint downFlag, upFlag;
            switch (button?.ToLower())
            {
                case "right":
                    downFlag = MOUSEEVENTF_RIGHTDOWN;
                    upFlag = MOUSEEVENTF_RIGHTUP;
                    break;
                case "middle":
                    downFlag = MOUSEEVENTF_MIDDLEDOWN;
                    upFlag = MOUSEEVENTF_MIDDLEUP;
                    break;
                case "left":
                default:
                    downFlag = MOUSEEVENTF_LEFTDOWN;
                    upFlag = MOUSEEVENTF_LEFTUP;
                    break;
            }

            switch (act?.ToLower())
            {
                case "down":
                    SendMouseInput(downFlag);
                    break;
                case "up":
                    SendMouseInput(upFlag);
                    break;
                case "click":
                default:
                    SendMouseInput(downFlag);
                    SendMouseInput(upFlag);
                    break;
            }

            context.SendResponse(new
            {
                type = "input_result",
                agent_id = context.AgentId,
                command_id = commandId,
                success = true
            });
        }

        private void HandleKey(JsonElement parameters, string commandId)
        {
            if (parameters.ValueKind == JsonValueKind.Object && parameters.TryGetProperty("vk", out var vkProp))
            {
                int vk = vkProp.GetInt32();
                string act = parameters.TryGetProperty("action", out var aProp) ? aProp.GetString() : "press";

                switch (act?.ToLower())
                {
                    case "down":
                        SendKeyInput((ushort)vk, KEYEVENTF_KEYDOWN);
                        break;
                    case "up":
                        SendKeyInput((ushort)vk, KEYEVENTF_KEYUP);
                        break;
                    case "press":
                    default:
                        SendKeyInput((ushort)vk, KEYEVENTF_KEYDOWN);
                        SendKeyInput((ushort)vk, KEYEVENTF_KEYUP);
                        break;
                }

                context.SendResponse(new
                {
                    type = "input_result",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    success = true
                });
            }
            else
            {
                context.SendResponse(new
                {
                    type = "input_result",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    success = false,
                    message = "Missing vk parameter."
                });
            }
        }

        private void HandleType(JsonElement parameters, string commandId)
        {
            if (parameters.ValueKind == JsonValueKind.Object && parameters.TryGetProperty("text", out var textProp))
            {
                string text = textProp.GetString();
                if (!string.IsNullOrEmpty(text))
                {
                    foreach (char c in text)
                    {
                        SendUnicodeChar(c);
                    }
                }

                context.SendResponse(new
                {
                    type = "input_result",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    success = true
                });
            }
            else
            {
                context.SendResponse(new
                {
                    type = "input_result",
                    agent_id = context.AgentId,
                    command_id = commandId,
                    success = false,
                    message = "Missing text parameter."
                });
            }
        }

        #region P/Invoke SendInput
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        private const uint INPUT_MOUSE = 0;
        private const uint INPUT_KEYBOARD = 1;

        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;

        private const uint KEYEVENTF_KEYDOWN = 0x0000;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint KEYEVENTF_UNICODE = 0x0004;

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public InputUnion u;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public KEYBDINPUT ki;
            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        private void SendMouseInput(uint dwFlags)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_MOUSE;
            inputs[0].u.mi.dwFlags = dwFlags;
            SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private void SendKeyInput(ushort vk, uint dwFlags)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].u.ki.wVk = vk;
            inputs[0].u.ki.dwFlags = dwFlags;
            SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private void SendUnicodeChar(char c)
        {
            INPUT[] inputs = new INPUT[2];

            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].u.ki.wScan = c;
            inputs[0].u.ki.dwFlags = KEYEVENTF_UNICODE;

            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].u.ki.wScan = c;
            inputs[1].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

            SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
        }
        #endregion
    }
}
