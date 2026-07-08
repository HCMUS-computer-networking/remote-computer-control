# Bộ icon đề xuất (lucide-react)

> Icon đơn giản, nét mảnh, dễ nhìn ở kích thước nhỏ — phù hợp cho bảng điều khiển
> nhiều module cập nhật liên tục. Chưa cài package, chỉ liệt kê để thống nhất với team
> trước. Khi chốt xong, cài bằng:
> ```
> npm install lucide-react
> ```

## Cách dùng

```jsx
import { LayoutGrid, Cpu, Power } from "lucide-react";

<LayoutGrid size={18} strokeWidth={1.75} />
```

Quy ước chung: `size={18}` cho icon trong sidebar/tab, `size={16}` cho icon trong bảng/nút nhỏ, `strokeWidth={1.75}` cho nét mảnh nhất quán.

## 1. Khung ứng dụng (layout)

| Icon | Tên import | Dùng cho |
|---|---|---|
| ▦ | `LayoutGrid` | Nút chuyển sang Grid view |
| ⤢ | `Maximize2` | Nút chuyển sang Focus view |
| 🔍 | `Search` | Ô tìm kiếm Agent trong sidebar |
| ☰ | `Menu` | Nút thu/mở sidebar (mobile) |
| ☀ | `Sun` | Theme toggle — chế độ sáng |
| ☾ | `Moon` | Theme toggle — chế độ tối |
| ▾ | `ChevronDown` | Dropdown (Admin ▾, sort cột bảng) |
| 👤 | `User` | Avatar/khu vực tài khoản ở TopBar |

## 2. Trạng thái Agent

| Icon | Tên import | Dùng cho |
|---|---|---|
| ● | `Circle` (fill qua CSS) | Chấm tròn online/offline cạnh tên Agent |
| 📶 | `Wifi` | Agent online / Gateway connected |
| 📵 | `WifiOff` | Agent offline / mất kết nối Gateway |
| 🔴 | `Radio` | Đang trong phiên điều khiển (session đỏ) |
| ⏳ | `Loader2` (kèm class `animate-spin`) | Đang tải dữ liệu module |
| 📥 | `Inbox` | Trạng thái rỗng — "Chưa có Agent nào kết nối" |
| ⚠ | `AlertTriangle` | Banner lỗi/mất kết nối |
| ✅ | `CheckCircle2` | Xác nhận thao tác thành công |

## 3. 7 tab module

| Icon | Tên import | Module |
|---|---|---|
| 🪟 | `AppWindow` | Application |
| ⚙ | `Cpu` | Process |
| 🖥 | `MonitorPlay` | Screenshot & Live Stream |
| ⌨ | `Keyboard` | Keylogger |
| 📁 | `FolderTree` | File |
| 🎥 | `Video` | Webcam |
| ⏻ | `Power` | Power |

## 4. Hành động trong bảng Application/Process

| Icon | Tên import | Dùng cho |
|---|---|---|
| ▶ | `Play` | Nút Start (Application whitelist) |
| ⏹ | `Square` | Nút Stop (Application whitelist) |
| ✖ | `XCircle` | Nút Kill (Process, mọi dòng) |
| ⬍ | `ArrowUpDown` | Icon sort cạnh tên cột bảng |

## 5. Live Stream / Webcam

| Icon | Tên import | Dùng cho |
|---|---|---|
| 📷 | `Camera` | Nút chụp Screenshot 1 lần |
| ⏺ | `Circle` (đỏ, fill) | Badge "LIVE" khi đang xem Focus 24fps |
| ⏸ | `Pause` | Tạm dừng luồng live (nếu có) |
| ⤢ | `Expand` | Phóng to 1 ô trong Grid sang Focus |

## 6. Keylogger

| Icon | Tên import | Dùng cho |
|---|---|---|
| 🗑 | `Trash2` | Nút Clear log |
| ⬇ | `FileDown` | Nút Export log |
| ⬇⬇ | `ChevronsDown` | Nút "cuộn xuống mới nhất" khi user cuộn lên xem lại |

## 7. File

| Icon | Tên import | Dùng cho |
|---|---|---|
| 📁 | `Folder` | Thư mục đóng trong cây |
| 📂 | `FolderOpen` | Thư mục đang mở trong cây |
| 📄 | `File` | File chung không rõ loại |
| 📝 | `FileText` | File văn bản/tài liệu |
| ⬆☁ | `UploadCloud` | Vùng Drag & Drop Upload |
| ⬇ | `Download` | Nút Download từng file |

## 8. Power

| Icon | Tên import | Nút |
|---|---|---|
| 🔒 | `Lock` | Lock |
| ↺ | `RotateCcw` | Restart |
| ⏻ | `Power` | Shutdown |
| 🌙 | `Moon` | Sleep |
| ⏱ | `TimerReset` | Đếm ngược trong modal xác nhận |

## Ghi chú

- Danh sách map 1-1 với các trang trong [ControllerWireframes.drawio](wireframes/ControllerWireframes.drawio) và bảng màu ở [ColorPalette.md](ColorPalette.md) — icon trạng thái dùng chung màu `--success` / `--danger` / `--warning` / `--gray-400` đã định nghĩa ở đó.
- Nếu team muốn "0 phụ thuộc" (không thêm package) như mục 13 gợi ý, có thể thay bảng này bằng emoji/ký tự tương ứng đã ghi ở cột đầu — không cần đổi vị trí sử dụng.
