# Tài Liệu Kỹ Thuật Hệ Thống
**Phân hệ:** Gateway Relay Proxy Server
**Phiên bản:** 1.0.0
**Nền tảng:** Node.js / WebSockets

---

## 1. Tổng quan hệ thống (System Overview)
Hệ thống giám sát và quản lý máy tính được thiết kế theo kiến trúc **3-Tier Decoupled Architecture** bao gồm Controller, Gateway và Agent. Trong đó, Gateway là thành phần trung gian (Middleware) cốt lõi đóng vai trò *Relay Proxy Server*, chịu trách nhiệm điều phối và định tuyến dữ liệu thời gian thực giữa một hệ thống Controller điều khiển trung tâm và nhiều hệ thống Agent vệ tinh (máy trạm).

**Triết lý thiết kế:** Gateway hoạt động như một "ống dẫn" (Pass-through) tốc độ cao, không can thiệp sâu vào nội dung gói tin nhằm giảm độ trễ, phục vụ cho các luồng truyền tải media nặng như Livestream hoặc Webcam với tốc độ tối thiểu 24 FPS.

## 2. Kiến trúc & Thiết kế Component
Gateway được xây dựng bằng **Node.js** và sử dụng thư viện `ws` cho truyền tải WebSocket không đồng bộ. Thiết kế chia thành 3 phân lớp logic xử lý:

### 2.1. Routing / Handlers (Lớp tiếp nhận)
Chia làm 2 luồng xử lý độc lập tại `src/socket/` nhằm cách ly bảo mật và logic cho 2 loại đối tượng kết nối:
*   `agentHandler.js`: Xử lý kết nối từ các máy trạm. Lắng nghe thông điệp `REGISTER` để lưu trữ thông tin. Phân loại gói tin (Binary/Text) và forward trực tiếp lên các Controller đang subscribe.
*   `controllerHandler.js`: Xử lý kết nối từ bảng điều khiển web. Xác thực danh sách đặc quyền (Whitelist). Lấy mảng `target_agents` từ câu lệnh và gọi Router để chuyển tin.

### 2.2. State Management (Lớp quản lý trạng thái in-memory)
Tránh sử dụng Database để đạt độ trễ $O(1)$. Trạng thái lưu trực tiếp trên RAM:
*   `agentStore.js`: Sử dụng cấu trúc `Map` ánh xạ `agent_id` đến object WebSocket. Cung cấp API `getAll()`, `getSocket()`, và `removeByWs()`.
*   `controllerStore.js`: Sử dụng cấu trúc `Set` để chứa tập hợp các kết nối WebSocket của bảng điều khiển. Cho phép tính năng Broadcast thông báo `agent_status`.
*   `heartbeat.js`: Cơ chế Ping/Pong định kỳ (mặc định 30 giây). Các kết nối bị treo hoặc không phản hồi sau 10 giây (Timeout) sẽ tự động bị huỷ (`ws.terminate()`).

### 2.3. Message Router (Lớp định tuyến)
Logic trong `src/router/messageRouter.js` xử lý truyền tải gói tin:
*   **Specific Routing:** Nếu trường `target_agents` có danh sách ID, Gateway sẽ chuyển nguyên chuỗi JSON (RAW String) cho từng Agent.
*   **Broadcast Routing:** Nếu `target_agents` rỗng, Gateway sẽ phát tán gói tin cho toàn bộ các Agent đang online trong `agentStore` (dùng cho lệnh `policy_update`).

## 3. Giao thức truyền thông & API Specs

### 3.1. REST API Endpoints
Cung cấp bởi framework Express (phục vụ qua HTTP):

| Method | Endpoint | Xác thực | Mô tả chức năng |
| :--- | :--- | :--- | :--- |
| GET | `/health` | Không | Health check kiểm tra trạng thái hoạt động và Uptime của server. |
| POST | `/api/login` | Username/Password | Nhận credentials định nghĩa trong `users.json` (mã hoá *bcrypt*). Trả về JWT Token có thời hạn 8 giờ. |
| GET | `/api/agents` | Không | Lấy danh sách các agent đang kết nối. |

### 3.2. WebSocket Endpoints & Handshake
Gateway can thiệp vào sự kiện `upgrade` của HTTP để kiểm tra Auth trước khi bàn giao socket:

| Endpoint | Xác thực | Mô tả kết nối |
| :--- | :--- | :--- |
| `/agent?key=<AGENT_KEY>` | Pre-Shared Key | So khớp `key` với biến môi trường. Tối ưu cho thiết bị tự động reconnect liên tục. |
| `/controller?token=<JWT>` | JWT / Fallback PSK | Xác thực chuỗi JWT được cấp từ API `/login`. Nếu không có cấu hình JWT, sử dụng fallback qua `?key=`. |

> **Nguyên tắc bảo mật:** Mọi kết nối sai key, thiếu token, hoặc gọi sai path sẽ lập tức bị Gateway chặn từ chối với mã HTTP 401 hoặc 404, ngắt socket ngay lập tức (destroy).

### 3.3. Cấu trúc Payload giao tiếp
Dữ liệu qua WebSockets phải theo định dạng quy định, trừ dữ liệu Binary (ảnh, video) sẽ truyền dạng raw buffer.

**1. Agent Register (Bắt buộc đầu tiên):**
```json
{
  "type": "REGISTER",
  "agent_id": "PC-Lab-01",
  "hostname": "PC-Lab-01",
  "ip": "192.168.1.10",
  "os": "Windows 11"
}
```

**2. Controller Routing Command:**
```json
{
  "type": "request",
  "module": "process",
  "action": "kill",
  "pid": 1024,
  "target_agents": ["PC-Lab-01", "PC-Lab-02"] 
}
```

**3. Gateway Status Broadcast:** (Gửi lên Controller)
```json
{
  "type": "agent_status",
  "agent_id": "PC-Lab-01",
  "online": true
}
```

## 4. Data Flow & Xử lý nhị phân

Một tính năng cốt lõi của Gateway là khả năng đóng vai trò trung gian "nhẹ" (lightweight proxy) để tiết kiệm CPU và tài nguyên.

### 4.1. Luồng JSON Text
1. Controller gửi chuỗi JSON yêu cầu thông tin.
2. Gateway xác định tính hợp lệ của lệnh dựa trên Whitelist (chỉ cho phép các `type` như *request, power, policy_update, permission_request...*).
3. Gateway chuyển **nguyên bản (raw data)** JSON xuống Agent.
4. Agent trả về phản hồi JSON. Gateway nhận được, sẽ **ghi đè thêm** trường `agent_id` vào JSON để Controller phân biệt được nguồn, sau đó broadcast.

### 4.2. Luồng nhị phân (Webcam / Live Stream / File Chunk)
Đối với chế độ Stream yêu cầu tối thiểu 24 FPS:
1. Agent gửi một frame meta (JSON) chứa thông tin frame. Gateway gán `agent_id` và đẩy đi.
2. Ngay sau đó, Agent gửi một gói tin nhị phân (Binary Buffer chứa JPEG hoặc File chunk).
3. Gateway phát hiện cờ `isBinary == true` từ event `ws.on('message')`. Gateway không thực hiện giải mã (decode) hay chuyển về Base64, mà **broadcast thẳng Buffer này** tới toàn bộ Controller (pass-through).

> **Lưu ý kỹ thuật:** Do Gateway đẩy Binary trực tiếp, Controller cần đồng bộ Frame Meta trước đó để biết gói Binary sắp tới thuộc về `agent_id` nào.

## 5. Cấu hình hệ thống (Deployment Configuration)
Gateway vận hành hoàn toàn phụ thuộc vào các biến môi trường cấu hình tại file `.env`.

| Tên Biến | Giá trị mặc định | Ý nghĩa chức năng |
| :--- | :--- | :--- |
| `PORT` | 8080 | Cổng dịch vụ lắng nghe HTTP/WS. |
| `AGENT_KEY` | *Bắt buộc* | Khóa Pre-Shared Key cho Agent Handshake. |
| `CONTROLLER_KEY` | *Bắt buộc* | Khóa dự phòng khi JWT không được thiết lập. |
| `JWT_SECRET` | (Rỗng) | Mã bí mật dùng để ký và xác thực JWT token của Controller. |
| `PING_INTERVAL` | 30000 (ms) | Khoảng thời gian Gateway tự động gửi tín hiệu Ping tới Clients. |
| `PING_TIMEOUT` | 10000 (ms) | Khoảng thời gian chờ Pong tối đa trước khi ngắt socket. |

### Cơ chế Logging
Hệ thống sử dụng thư viện `winston` với 3 transport đồng thời:
*   **Console:** In log màu sắc phục vụ môi trường Dev (level `LOG_LEVEL`).
*   **logs/gateway.log:** Lưu toàn bộ quá trình kết nối, ngắt kết nối, định tuyến gói tin (Max 10MB, Rotate 5 files).
*   **logs/error.log:** Chỉ ghi nhận những lỗi exception hoặc crash để dễ dàng rà soát.