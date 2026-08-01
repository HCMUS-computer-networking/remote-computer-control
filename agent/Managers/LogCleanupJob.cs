using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Serilog;

namespace AgentSystem.Managers
{
    public static class LogCleanupJob
    {
        public static void Start(int retentionDays)
        {
            if (retentionDays <= 0) return; // Không xóa nếu cấu hình <= 0

            Task.Run(async () =>
            {
                using var timer = new PeriodicTimer(TimeSpan.FromHours(24)); // Chạy mỗi 24 giờ
                
                // Chạy lần đầu ngay lập tức
                DoCleanup(retentionDays);

                while (await timer.WaitForNextTickAsync())
                {
                    DoCleanup(retentionDays);
                }
            });
        }

        private static void DoCleanup(int retentionDays)
        {
            try
            {
                string logDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Logs");
                if (!Directory.Exists(logDir)) return;

                var files = Directory.GetFiles(logDir, "*.log");
                DateTime cutoffDate = DateTime.Now.AddDays(-retentionDays);

                int deletedCount = 0;
                foreach (var file in files)
                {
                    try
                    {
                        var fileInfo = new FileInfo(file);
                        if (fileInfo.LastWriteTime < cutoffDate)
                        {
                            fileInfo.Delete();
                            deletedCount++;
                        }
                    }
                    catch (IOException)
                    {
                        // File có thể đang được log ghi, bỏ qua
                    }
                }

                if (deletedCount > 0)
                {
                    Log.Information("[Maintenance] Đã tự động dọn dẹp {Count} file log cũ hơn {Days} ngày.", deletedCount, retentionDays);
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "[Maintenance] Lỗi khi dọn dẹp file log cũ: {Message}", ex.Message);
            }
        }
    }
}
