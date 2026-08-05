using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

class Program
{
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
    public static extern IntPtr LoadLibrary(string lpFileName);

    static void Main()
    {
        Console.WriteLine("GetModuleHandle(null): " + GetModuleHandle(null));
        Console.WriteLine("LoadLibrary(user32.dll): " + LoadLibrary("user32.dll"));
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule) {
            Console.WriteLine("GetModuleHandle(curModule.ModuleName): " + GetModuleHandle(curModule.ModuleName));
        }
    }
}
