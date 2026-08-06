# Danh Mục Tất Cả File Tài Liệu & Giao Thức (Documentation & Schemas Index)

Tệp tin này tổng hợp và phân loại đường dẫn của tất cả các file tài liệu Markdown (`.md`) và file định nghĩa giao thức / cấu hình JSON (`.json`) hiện có trong dự án **Remote Computer Control**.

---

## I. Tài Liệu Gốc (Root Documentation)

- [README.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/README.md) — Trang chủ giới thiệu hệ thống, hướng dẫn khởi chạy & thiết lập
- [ARCHITECTURE.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/ARCHITECTURE.md) — Tổng quan kiến trúc Star Topology & các luồng dữ liệu chính
- [CONTRIBUTING.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/CONTRIBUTING.md) — Hướng dẫn đóng góp mã nguồn & quy chuẩn dự án
- [CHANGELOG.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/CHANGELOG.md) — Nhật ký lịch sử thay đổi qua các phiên bản
- [LICENSE](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/LICENSE) — Giấy phép phần mềm mã nguồn mở MIT

---

## II. Thư Mục Tài Liệu Kỹ Thuật (`docs/`)

### 1. Hướng Dẫn & Báo Cáo Đánh Giá (`docs/` & `docs/reports/`)

- [docs/guide.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/guide.md) — Hướng dẫn chi tiết thiết lập & chạy thử nghiệm mạng LAN/WSS
- [docs/reports/evaluation.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/reports/evaluation.md) — Báo cáo đánh giá toàn diện kiến trúc, tính năng & độ hoàn thiện
- [docs/reports/advance_problem.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/reports/advance_problem.md) — Báo cáo giải quyết các bài toán kỹ thuật nâng cao

---

### 2. Thiết Kế Hệ Thống Theo Component (`docs/design/`)

#### 🔹 Agent (C# .NET 8)
- [docs/design/agent/technical_design.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/agent/technical_design.md) — Thiết kế kỹ thuật chi tiết của Agent
- [docs/design/agent/specification.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/agent/specification.md) — Quy cách các yêu cầu chức năng & phi chức năng của Agent
- [docs/design/agent/checklist.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/agent/checklist.md) — Checklist đồng bộ tính năng & lộ trình triển khai Agent

#### 🔹 Gateway (Node.js)
- [docs/design/gateway/technical_design.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/gateway/technical_design.md) — Thiết kế kỹ thuật trung tâm Gateway
- [docs/design/gateway/description.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/gateway/description.md) — Mô tả tổng quan vai trò Routing & Relay của Gateway
- [docs/design/gateway/report.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/gateway/report.md) — Báo cáo phân tích giải pháp mã hóa WSS & FEC Worker

#### 🔹 Controller (React Frontend)
- [docs/design/controller/architecture.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/controller/architecture.md) — Kiến trúc tổng thể ứng dụng Web Controller
- **Giải thích kỹ thuật chuyên sâu:**
  - [docs/design/controller/technical_explanation/01_ZustandVsReduxContext.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/controller/technical_explanation/01_ZustandVsReduxContext.md)
  - [docs/design/controller/technical_explanation/02_WebsocketQuaGateway.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/controller/technical_explanation/02_WebsocketQuaGateway.md)
  - [docs/design/controller/technical_explanation/03_JsonLenhBinaryAnh.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/controller/technical_explanation/03_JsonLenhBinaryAnh.md)
  - [docs/design/controller/technical_explanation/04_TachStoreVaMockPattern.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/controller/technical_explanation/04_TachStoreVaMockPattern.md)
  - [docs/design/controller/technical_explanation/05_GridFpsThapFocus24fps.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/controller/technical_explanation/05_GridFpsThapFocus24fps.md)
- **Thiết kế Giao diện (Wireframe & Style):**
  - [docs/design/controller/wireframe/ColorPalette.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/controller/wireframe/ColorPalette.md)
  - [docs/design/controller/wireframe/Icons.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/design/controller/wireframe/Icons.md)

---

### 3. Giao Thức Truyền Tải (`docs/protocol/`)

Gồm tài liệu hướng dẫn chung và các file JSON Schema định nghĩa chi tiết gói tin cho từng module:

- [docs/protocol/Instruction.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/Instruction.md) — Quy ước định dạng tin nhắn JSON & mã hóa E2EE
- [docs/protocol/Connection.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/Connection.json) — Schema tin nhắn Kết nối & Danh sách Agent
- [docs/protocol/Application.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/Application.json) — Schema quản lý Ứng dụng (App List, Start, Stop)
- [docs/protocol/Process.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/Process.json) — Schema quản lý Tiến trình (Process List, Kill)
- [docs/protocol/Livescreen.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/Livescreen.json) — Schema truyền tải Màn hình (Screenshot, Delta Stream)
- [docs/protocol/Input.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/Input.json) — Schema điều khiển Từ xa (Mouse Move/Click, Key, Type)
- [docs/protocol/File.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/File.json) — Schema quản lý File & truyền tải Binary Frames
- [docs/protocol/Keylog.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/Keylog.json) — Schema theo dõi Bàn phím & Consent Flow
- [docs/protocol/Webcam.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/Webcam.json) — Schema luồng Webcam Stream
- [docs/protocol/Power.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/Power.json) — Schema điều khiển Nguồn (Lock, Restart, Shutdown, Sleep)
- [docs/protocol/SysInfo.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/SysInfo.json) — Schema thông số Hệ thống (CPU, RAM, Disk, Uptime)
- [docs/protocol/PolicyUpdate.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/docs/protocol/PolicyUpdate.json) — Schema cập nhật Chính sách (Whitelist, Sandbox Path)

---

## III. Các File Cấu Hình & Template Khác

- [.github/PULL_REQUEST_TEMPLATE.md](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/.github/PULL_REQUEST_TEMPLATE.md) — Mẫu Pull Request khi đóng góp mã nguồn
- **Gateway Configuration & Store:**
  - [gateway/package.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/gateway/package.json)
  - [gateway/nodemon.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/gateway/nodemon.json)
  - [gateway/repomix.config.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/gateway/repomix.config.json)
  - [gateway/src/store/agents.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/gateway/src/store/agents.json)
  - [gateway/src/store/users.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/gateway/src/store/users.json)
- **Controller Configuration:**
  - [controller/package.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/controller/package.json)
  - [controller/.oxlintrc.json](file:///c:/Users/ASUS%20Vivobook/Desktop/remote-computer-control/controller/.oxlintrc.json)
