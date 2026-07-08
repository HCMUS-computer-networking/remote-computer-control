# TÀI LIỆU ĐẶC TẢ KỸ THUẬT HỆ THỐNG GIÁM SÁT THỰC HÀNH (DÀNH CHO AI/LLM GENERATION)

---

## 1. TỔNG QUAN KIẾN TRÚC HỆ THỐNG (SYSTEM ARCHITECTURE OVERVIEW)

Hệ thống hoạt động theo mô hình **3-Tier Decoupled Architecture** dựa trên kết nối hướng đối tượng thời gian thực qua giao thức **WebSockets (TCP)**.

### 1.1. Gateway (Relay Proxy Server) - Tổng quan
* **Vai trò:** Trung tâm điều phối, định tuyến gói tin giữa Controller và các Agent.
* **Cơ chế hoạt động:** Hoạt động như một Reverse Proxy duy trì các kết nối song công (Full-Duplex). Khi nhận gói tin từ Controller có chứa mảng định danh `target_agents`, Gateway thực hiện bóc tách và chuyển tiếp dữ liệu đến đúng Agent tương ứng (hỗ trợ unicast 1-1, multicast 1-N, hoặc broadcast).
* **Quản lý kết nối:** Duy trì bảng Client Registry. Khi có Agent đăng ký (`REGISTER`), hệ thống lưu lại socket session. Tự động phát hiện ngắt kết nối thông qua cơ chế Heartbeat (Ping/Pong) và dọn dẹp bộ nhớ tránh gây crash luồng truyền tải.

### 1.2. Controller (Web Application) - Tổng quan
* **Vai trò:** Giao diện điều khiển và giám sát trung tâm của người quản lý (THQ).
* **Cơ chế hoạt động:** Chạy trực tiếp trên trình duyệt Web, độc lập với hệ điều hành. Có hai chế độ xem: Focus Mode (Giám sát tập trung 1 máy Agent) và Grid Mode (Giám sát đồng thời nhiều máy Agent). Hệ thống tự động điều chỉnh tốc độ yêu cầu dữ liệu (FPS/Quality) dựa trên chế độ hiển thị để tối ưu hóa băng thông truyền tải.

### 1.3. Quy ước Giao thức và Định dạng Tin nhắn (Protocol Conventions)
* **Giao tiếp cơ sở:** Toàn bộ tin nhắn điều khiển cấu trúc bằng định dạng **JSON**.
* **Trường bắt buộc toàn cục (Core Fields):**
  * `type`: Định danh loại hành động hoặc kết quả (ví dụ: `request`, `app_list_result`, `frame_meta`).
  * `module`: Tên phân hệ xử lý (chỉ bắt buộc khi `type` là `request`).
  * `target_agents`: Mảng chứa các ID của Agent đích (sử dụng trong luồng Controller $\rightarrow$ Gateway).
  * `agent_id`: Định danh của Agent phát sinh dữ liệu (sử dụng trong luồng Gateway $\rightarrow$ Controller).
* **Cơ chế truyền tải dữ liệu đa phương tiện (Binary Frame Pairing):**
  Đối với dữ liệu hình ảnh (Streaming màn hình hoặc Webcam), Agent gửi liên tiếp **hai gói tin WebSocket độc lập** mà không xen kẽ gói tin khác:
  1. **Gói tin 1 (JSON):** Chứa metadata `type: "frame_meta"`, kèm các chỉ số kích thước (`w`, `h`), độ dài byte nhị phân (`len`), số thứ tự khung hình (`seq`), nhãn phân hệ (`module: "screen" | "webcam"`).
  2. **Gói tin 2 (BINARY):** Khối dữ liệu nhị phân thô (`ArrayBuffer` chứa bytes ảnh JPEG). Độ dài của khối nhị phân này phải bằng chính xác giá trị `len` đã khai báo ở Gói tin 1.

---

## 2. ĐẶC TẢ CHI TIẾT THÀNH PHẦN AGENT (AGENT SPECIFICATION)

Agent là một ứng dụng chạy tường minh (Explicit GUI Application) trên hệ điều hành Windows, có nhiệm vụ tiếp nhận lệnh từ Gateway, kiểm tra các ràng buộc bảo mật, hiển thị giao diện tương tác người dùng khi cần và thực thi các can thiệp hệ thống.

### 2.1. Vòng đời Kết nối của Agent (Connection Lifecycle)
1. **Khởi tạo:** Nhập địa chỉ IP/Port của Gateway thủ công hoặc tự động bắt gói tin Broadcast từ Gateway ở giai đoạn nâng cấp.
2. **Định danh (Handshake):** Gửi gói tin loại `REGISTER` chứa thông tin định danh máy trạm lên Gateway ngay khi thiết lập thành công Socket kết nối.
3. **Duy trì (Heartbeat):** Định kỳ gửi gói tin `PING` và đón nhận phản hồi `PONG` từ Gateway để xác nhận trạng thái kết nối thông suốt.
4. **Tái kết nối (Reconnection):** Nếu Socket bị ngắt đột ngột, Agent phải kích hoạt luồng tự động kết nối lại theo chu kỳ cố định cho đến khi thành công.

### 2.2. Luồng xử lý Cảnh báo & Chấp thuận (User Consent & Transparency State Machine)
Đối với các module nhạy cảm cao, Agent không được phép thực thi lệnh ngầm mà phải tuân thủ nghiêm ngặt sơ đồ chuyển trạng thái dưới đây:

```
[Nhận lệnh từ Gateway]
          |
    Kiểm tra Module
     /         \
 (Nhạy cảm)    (Thông thường: App/Process/File)
   /             \
  v               v
[Hiển thị Popup] [Thực thi trực tiếp]
  /          \
(Từ chối)   (Đồng ý / Approve)
  /            \
 v              v
[Hủy lệnh &     Kiểm tra có phải Module WEBCAM?
 Trả về           /                         \
 Denied]       (YES)                        (NO)
                 /                            \
                v                              v
        [Đếm ngược 10 giây]             [Thực thi Module]
                |                              |
                v                              v
        [Bật Chấm đỏ nhấp nháy]        [Trả dữ liệu về]
                |
                v
        [Thực thi Webcam & Stream]
```

* **Quy tắc Popup Consent:** Áp dụng cho các module `Screenshot/Stream`, `Keylogger`, `Webcam`, và `Power` (ngoại trừ lệnh khóa máy `lock`). Giao diện Popup (WPF/WinForms) xuất hiện ở lớp trên cùng màn hình (Topmost). Nếu người dùng chọn *Reject* hoặc hết thời gian chờ (Timeout), Agent lập tức gửi gói tin phản hồi từ chối (`*_denied`) về Controller và đóng luồng.
* **Quy tắc Minh bạch Webcam (Transparency):** Khi được Approve quyền Webcam, Agent bắt buộc phải thực hiện đếm ngược 10 giây hiển thị rõ trên giao diện trước khi phần cứng Camera chính thức ghi hình. Trong suốt quá trình Camera hoạt động, một cửa sổ Overlay chứa **dấu chấm đỏ nhấp nháy (Flashing Red Indicator)** bắt buộc phải neo cố định ở góc màn hình với thuộc tính `Always-on-top`, chỉ biến mất khi luồng stream Webcam bị đóng.

---

## 3. THIẾT KẾ CHI TIẾT CÁC MODULE CHỨC NĂNG CỦA AGENT

### 3.1. Phân hệ Quản lý Ứng dụng (`app_list`, `app_start`, `app_stop`)
* **Chức năng:** Liệt kê ứng dụng đang chạy (có Window GUI Handle), mức chiếm dụng tài nguyên hệ thống (CPU %, RAM MB) và thực hiện đóng/mở ứng dụng theo yêu cầu.
* **Ràng buộc Bảo mật (Whitelist Enforcement):** * Agent duy trì nội bộ một danh sách các ứng dụng an toàn (`Whitelist`).
  * Khi nhận lệnh `app_start` hoặc `app_stop`, Agent phải kiểm tra thuộc tính tên tệp thực thi (`name`). Nếu ứng dụng không nằm trong Whitelist, Agent **không thực thi** và trả về kết quả thất bại kèm thông báo vi phạm chính sách an toàn.
  * Lệnh lấy danh sách (`app_list`) không bị ràng buộc bởi Whitelist, nhưng trong danh sách trả về phải biểu thị rõ trạng thái `in_whitelist` (true/false) của từng ứng dụng để Controller hiển thị.

### 3.2. Phân hệ Quản lý Tiến trình (`proc_list`, `proc_kill`)
* **Chức năng:** Truy xuất danh sách toàn bộ các tiến trình hệ thống đang vận hành ngầm và tường minh (tương tự Windows Task Manager) và cho phép cưỡng chế chấm dứt tác vụ.
* **Cơ chế & Quyền hạn:** Sử dụng Windows API hệ thống (`Process.GetProcesses()`, `Process.Kill()`). Luồng này yêu cầu Agent chạy dưới quyền quản trị phù hợp để có thể can thiệp vào Process Token. Phân hệ này **không áp dụng** Whitelist khi thực hiện lệnh `proc_kill`, cho phép diệt bất kỳ tiến trình nào theo chỉ định ID (`pid`) từ Controller.

### 3.3. Phân hệ Giám sát Màn hình (`screenshot`, `screen_stream`, `screen_stream_stop`)
* **Chức năng:** Chụp ảnh màn hình đơn lẻ hoặc thiết lập luồng truyền tải màn hình liên tục về Controller.
* **Ràng buộc kỹ thuật:** Luồng Stream liên tục yêu cầu độ mượt tối thiểu đạt **24 FPS**. Agent thực hiện chụp màn hình $\rightarrow$ Nén ảnh định dạng JPEG/WebP theo độ phân giải và chất lượng cấu hình (`quality`) $\rightarrow$ Chuyển đổi thành mảng bytes $\rightarrow$ Phát đi theo cấu trúc cặp 2 gói tin (JSON `frame_meta` trước, BINARY `ArrayBuffer` sau).
* **Ràng buộc bảo mật:** Phải được thông qua Popup User Consent trước khi phát khung hình đầu tiên.

### 3.4. Phân hệ Ghi nhận Thao tác (`keylog_start`, `keylog_stop`)
* **Chức năng:** Theo dõi và ghi lại chuỗi ký tự được nhập từ bàn phím vật lý trên máy Agent.
* **Cơ chế hoạt động:** Thiết lập cơ chế kiểm soát phần cứng mức thấp (Low-level Keyboard Hook) thông qua hàm Win32 API `SetWindowsHookEx`.
* **Đầu ra dữ liệu:** Các sự kiện phím được gom lại thành mảng các đối tượng (Batching) bao gồm mã phím (`key`), trạng thái các phím bổ trợ (`ctrl`, `alt`, `shift`) và nhãn thời gian Unix tính theo mili-giây (`timestamp_ms`), gửi định kỳ về Controller để hiển thị theo dạng Timeline.
* **Ràng buộc bảo mật:** Bắt buộc kích hoạt Popup User Consent. Agent tuyệt đối không được ghi nhận phím khi người dùng bấm từ chối.

### 3.5. Phân hệ Quản lý Tập tin Sandbox (`fs_list`, `fs_get`, `fs_put`)
* **Chức năng:** Duyệt thư mục, tải tệp tin lên và xuống giữa Controller và Agent.
* **Ràng buộc Bảo mật Tuyệt đối (Sandbox Isolation):**
  * Agent cấu hình một thư mục gốc cố định làm phân vùng an toàn (ví dụ: `C:\AgentSandbox\`). Đường dẫn gốc này được ánh xạ thành ký tự `/` trong giao thức truyền thông.
  * Mọi tham số đường dẫn (`path`) gửi từ Controller xuống đều phải được Agent chuẩn hóa về đường dẫn tuyệt đối trên ổ đĩa vật lý để kiểm tra.
  * Nếu đường dẫn yêu cầu nằm ngoài phân vùng Sandbox (ví dụ: sử dụng kỹ thuật Directory Traversal `../../win.ini` hoặc cố ý truy cập `C:\Windows\`), Agent phải **chặn ngay lập tức** và phản hồi gói tin lỗi `fs_error` chứa thông điệp `"Path is outside the sandbox"`.
* **Cơ chế Upload/Download file:** Tệp tin lớn được chia nhỏ thành các phân đoạn (`chunks`). Dữ liệu trong cấu trúc JSON được mã hóa dưới dạng chuỗi Base64 (`data_base64`). Agent phản hồi xác nhận thành công sau khi nhận từng chunk (`fs_put_result`) và ghi tổng hợp hoàn chỉnh tệp tin xuống đĩa khi nhận đủ toàn bộ phân đoạn (`fs_put_complete`).

### 3.6. Phân hệ Quan sát Camera (`webcam_start`, `webcam_stop`)
* **Chức năng:** Kích hoạt phần cứng Camera tích hợp trên máy Agent để truyền video trực tiếp về Controller.
* **Luồng truyền tải hình ảnh:** Sử dụng chung kiến trúc truyền tải cặp 2 gói tin liên tiếp (JSON `frame_meta` với trường `module: "webcam"` $\rightarrow$ BINARY JPEG bytes) tương tự như module giám sát màn hình.
* **Ràng buộc bảo mật:** Áp dụng đầy đủ quy trình bảo mật cao nhất: Popup Consent $\rightarrow$ Đếm ngược công khai 10 giây $\rightarrow$ Hiển thị chấm đỏ nhấp nháy Always-on-top xuyên suốt thời gian Camera thu hình.

### 3.7. Phân hệ Quản lý Nguồn (`power`)
* **Chức năng:** Thay đổi trạng thái hoạt động của máy trạm thông qua các hành động: `lock` (Khóa màn hình), `restart` (Khởi động lại), `shutdown` (Tắt máy), `sleep` (Ngủ máy).
* **Cơ chế thực thi:** Gọi trực tiếp lệnh Command Line của hệ điều hành hoặc Windows API tương ứng (`LockWorkStation`, `shutdown.exe /r`, `shutdown.exe /s`).
* **Ràng buộc bảo mật:** Hành động `lock` được phép thực thi ngay lập tức để phục vụ tình huống khẩn cấp. Các hành động tác động đến phần cứng và dữ liệu như `restart`, `shutdown`, `sleep` bắt buộc phải kích hoạt Popup Consent tại máy Agent để sinh viên xác nhận trước khi hệ thống thực thi lệnh tắt nguồn.

---

## 4. ĐẶC TẢ CHI TIẾT CẤU TRÚC GÓI TIN JSON ĐỐI ỨNG

AI cần tuân thủ chính xác các cấu trúc dữ liệu JSON dưới đây khi phát sinh mã nguồn cho Agent để đảm bảo tính đồng bộ hoàn toàn với Controller và Gateway.

### 4.1. Phân hệ Ứng dụng (Application)
* **Yêu cầu danh sách:**
```json
{
  "type": "request",
  "module": "app_list",
  "params": {},
  "target_agents": ["PC-Lab-01"]
}
```
* **Kết quả trả về danh sách từ Agent:**
```json
{
  "type": "app_list_result",
  "agent_id": "PC-Lab-01",
  "apps": [
    {
      "name": "notepad",
      "display_name": "Notepad",
      "status": "running",
      "cpu_percent": 0.1,
      "ram_mb": 12,
      "in_whitelist": true
    },
    {
      "name": "winword",
      "display_name": "Microsoft Word",
      "status": "stopped",
      "cpu_percent": 0.0,
      "ram_mb": 0,
      "in_whitelist": false
    }
  ]
}
```
* **Yêu cầu Thực thi (Khởi chạy/Đóng ứng dụng):**
```json
{
  "type": "request",
  "module": "app_start", // hoặc "app_stop"
  "params": {
    "name": "notepad"
  },
  "target_agents": ["PC-Lab-01"]
}
```
* **Kết quả phản hồi thực thi:**
```json
{
  "type": "app_action_result",
  "agent_id": "PC-Lab-01",
  "action": "app_start",
  "name": "notepad",
  "success": true,
  "message": "Application started successfully"
}
```

### 4.2. Phân hệ Tiến trình (Process)
* **Yêu cầu lấy danh sách:**
```json
{
  "type": "request",
  "module": "proc_list",
  "params": {},
  "target_agents": ["PC-Lab-01"]
}
```
* **Kết quả trả về:**
```json
{
  "type": "proc_list_result",
  "agent_id": "PC-Lab-01",
  "processes": [
    {
      "pid": 4512,
      "name": "notepad.exe",
      "cpu_percent": 0.0,
      "ram_mb": 11.2
    }
  ]
}
```
* **Yêu cầu diệt tiến trình:**
```json
{
  "type": "request",
  "module": "proc_kill",
  "params": {
    "pid": 4512
  },
  "target_agents": ["PC-Lab-01"]
}
```
* **Kết quả diệt tiến trình:**
```json
{
  "type": "proc_kill_result",
  "agent_id": "PC-Lab-01",
  "pid": 4512,
  "success": true,
  "message": "Process terminated"
}
```

### 4.3. Phân hệ Giám sát Màn hình & Livestream
* **Yêu cầu kích hoạt luồng Stream:**
```json
{
  "type": "request",
  "module": "screen_stream",
  "params": {
    "mode": "stream",
    "fps": 24,
    "quality": 70
  },
  "target_agents": ["PC-Lab-01"]
}
```
* **Xác nhận luồng đã bật từ Agent:**
```json
{
  "type": "stream_started",
  "agent_id": "PC-Lab-01",
  "module": "screen"
}
```
* **Gói tin Metadata của khung hình (Gói tin 1 trước khi gửi Binary bytes):**
```json
{
  "type": "frame_meta",
  "module": "screen",
  "agent_id": "PC-Lab-01",
  "w": 1920,
  "h": 1080,
  "len": 48320,
  "seq": 42,
  "timestamp_ms": 1720000000000
}
```

### 4.4. Phân hệ Ghi nhận Thao tác bàn phím (Keylogger)
* **Yêu cầu kích hoạt:**
```json
{
  "type": "request",
  "module": "keylog_start",
  "params": {},
  "target_agents": ["PC-Lab-01"]
}
```
* **Phản hồi khi được chấp thuận hoặc từ chối từ Agent:**
```json
{
  "type": "keylog_started", // Hoặc "keylog_denied" nếu sinh viên bấm từ chối
  "agent_id": "PC-Lab-01",
  "reason": "User declined permission" // Chỉ đính kèm khi ở gói tin keylog_denied
}
```
* **Gói tin đẩy dữ liệu phím định kỳ từ Agent:**
```json
{
  "type": "keylog",
  "agent_id": "PC-Lab-01",
  "events": [
    {
      "key": "H",
      "ctrl": false,
      "alt": false,
      "shift": true,
      "timestamp_ms": 1720000001000
    },
    {
      "key": "e",
      "ctrl": false,
      "alt": false,
      "shift": false,
      "timestamp_ms": 1720000001120
    }
  ]
}
```

### 4.5. Phân hệ Quản lý Tập tin Sandbox (File System)
* **Yêu cầu lấy danh sách tệp/thư mục:**
```json
{
  "type": "request",
  "module": "fs_list",
  "params": {
    "path": "/"
  },
  "target_agents": ["PC-Lab-01"]
}
```
* **Kết quả trả về danh sách từ Agent:**
```json
{
  "type": "fs_list_result",
  "agent_id": "PC-Lab-01",
  "path": "/",
  "entries": [
    { "name": "reports", "type": "directory", "size": null, "modified_ms": 1719900000000 },
    { "name": "readme.txt", "type": "file", "size": 1024, "modified_ms": 1719900002000 }
  ]
}
```
* **Yêu cầu Upload file lên Agent (Controller gửi từng chunk):**
```json
{
  "type": "request",
  "module": "fs_put",
  "params": {
    "path": "/uploads/data.csv",
    "total_size": 20480,
    "chunk_index": 0,
    "total_chunks": 4,
    "data_base64": "bWFuaGhjby..."
  },
  "target_agents": ["PC-Lab-01"]
}
```
* **Xác nhận nhận thành công từng chunk từ Agent:**
```json
{
  "type": "fs_put_result",
  "agent_id": "PC-Lab-01",
  "path": "/uploads/data.csv",
  "chunk_index": 0,
  "success": true,
  "message": "Chunk received"
}
```
* **Xác nhận lưu hoàn tất toàn bộ file từ Agent:**
```json
{
  "type": "fs_put_complete",
  "agent_id": "PC-Lab-01",
  "path": "/uploads/data.csv",
  "success": true,
  "message": "File saved successfully"
}
```
* **Gói tin Phản hồi lỗi vi phạm Sandbox của Agent:**
```json
{
  "type": "fs_error",
  "agent_id": "PC-Lab-01",
  "operation": "fs_get",
  "path": "../../secret.txt",
  "message": "Path is outside the sandbox"
}
```

### 4.6. Phân hệ Quan sát Camera (Webcam)
* **Yêu cầu kích hoạt luồng Webcam:**
```json
{
  "type": "request",
  "module": "webcam_start",
  "params": {
    "fps": 15,
    "quality": 60
  },
  "target_agents": ["PC-Lab-01"]
}
```
* **Phản hồi từ chối hoặc xác nhận đã mở từ Agent:**
```json
{
  "type": "webcam_started", // Hoặc "webcam_denied" nếu sinh viên Reject quyền
  "agent_id": "PC-Lab-01",
  "reason": "User declined permission" // Chỉ đính kèm khi luồng bị denied
}
```
* **Gói tin Metadata của khung hình Webcam (Gói tin 1 trước BINARY bytes):**
```json
{
  "type": "frame_meta",
  "module": "webcam",
  "agent_id": "PC-Lab-01",
  "w": 640,
  "h": 480,
  "len": 18700,
  "seq": 1,
  "timestamp_ms": 1720000005000
}
```

### 4.7. Phân hệ Quản lý Nguồn (Power Control)
* **Lệnh điều khiển nguồn từ Controller:**
```json
{
  "type": "power",
  "action": "lock", // Hoặc "restart", "shutdown", "sleep"
  "target_agents": ["PC-Lab-01"]
}
```
* **Xác nhận thực thi thành công từ Agent:**
```json
{
  "type": "power_result",
  "agent_id": "PC-Lab-01",
  "action": "restart",
  "confirmed": true,
  "message": "System is restarting"
}
```

---

## 5. MA TRẬN PHÂN LOẠI EVENT & CHỈ THỊ XỬ LÝ LỖI (ERROR HANDLING MATRIX)

Khi thiết kế logic xử lý cho Agent, AI cần tuân thủ ma trận phân loại hành vi và xử lý ngoại lệ sau:

| Module tên      | Giá trị trường `module`             |   Yêu cầu Consent?   | Ràng buộc bảo mật / Kỹ thuật của Agent                                                   | Hành vi xử lý lỗi của Agent                                                                          |
| :-------------- | :---------------------------------- | :------------------: | :--------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| **Application** | `app_list`, `app_start`, `app_stop` |          ❌           | Bắt buộc đối chiếu `name` với Whitelist nội bộ trước khi Start/Stop.                     | Trả về `success: false` kèm `message` chỉ định rõ ứng dụng không thuộc danh mục Whitelist.           |
| **Process**     | `proc_list`, `proc_kill`            |          ❌           | Thực thi trực tiếp qua lệnh hệ điều hành Windows bằng PID, không check whitelist.        | Trả lỗi `success: false` nếu không tìm thấy PID hoặc Agent thiếu quyền quản trị (Access Denied).     |
| **Stream**      | `screenshot`, `screen_stream`       |       **YES**        | Đảm bảo tốc độ luồng gửi ảnh chụp màn hình đạt mốc tối thiểu 24 FPS.                     | Gửi gói `stream_stopped` nếu tiến trình chụp màn hình hệ thống bị lỗi phần cứng đồ họa.              |
| **Keylog**      | `keylog_start`, `keylog_stop`       |       **YES**        | Chèn Low-level Keyboard Hook (`SetWindowsHookEx`) và đóng Hook ngay khi dừng.            | Trả gói `keylog_denied` ngay lập tức nếu sinh viên click từ chối trên giao diện Popup.               |
| **File**        | `fs_list`, `fs_get`, `fs_put`       |          ❌           | Chuẩn hóa đường dẫn tương đối thành tuyệt đối để xác minh có nằm trong Sandbox.          | Phát gói tin lỗi cấu trúc `fs_error` nếu phát hiện Directory Traversal (`..`) hoặc ra ngoài Sandbox. |
| **Webcam**      | `webcam_start`, `webcam_stop`       |       **YES**        | Bắt buộc trì hoãn đếm ngược 10 giây công khai + Duy trì chỉ báo chấm đỏ ở lớp trên cùng. | Trả gói `webcam_denied` nếu bị từ chối hoặc Camera đang bị chiếm dụng bởi ứng dụng khác.             |
| **Power**       | `power` (trường `type`)             | **YES** *(Trừ lock)* | Gọi lệnh OS thực hiện thay đổi trạng thái nguồn (`shutdown.exe`, `LockWorkStation`).     | Không phản hồi kết quả nguồn nếu sinh viên chọn Từ chối trên Popup.                                  |