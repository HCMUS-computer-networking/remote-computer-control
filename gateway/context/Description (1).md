# TÀI LIỆU ĐẶC TẢ YÊU CẦU KỸ THUẬT 

---

## 1. TỔNG QUAN DỰ ÁN (PROJECT OVERVIEW)
Đây là đồ án môn mạng máy tính hcmus.
### 1.1. Giới thiệu bài toán
Tạo công cụ để THQ giám sát/kiểm soát (máy tính) sinh viên khi học TH

### 1.2. Triết lý thiết kế (Design Philosophy)
- Tách biệt các thành phần, cân bằng giữa quyền kiểm soát của controller và sự bảo mật để bảo vệ agent.
## 2. KIẾN TRÚC HỆ THỐNG (SYSTEM ARCHITECTURE)
3-Tier Decoupled Architecture
- Dự án gồm 1 controller (máy điều khiển của THQ), 1 gateway và *nhiều* agent (máy sinh viên). Gateway đóng vai trò là server điều phối các gói tin giữa controller và agent.
- Khi được khởi động, controller và agent đều phải gửi gói tin đầu tiên cho gateway để định danh. Sau đó định kỳ gửi ping (nhận pong) để duy trì kết nối.
- Ban đầu, có thể để agent/controller tìm thấy gateway bằng cách nhập địa chỉ thủ công (controller có option chạy chung trên 1 máy, gateway dùng địa chỉ của máy).
- **Giai đoạn sau** gateway broadcast để controller và agent tự nhận diện.
### 2.1. Các thành phần cốt lõi
* **Controller (Web Application):**
    * *Vai trò:* Giao diện quản trị trung tâm cho người điều khiển.
    * *Đặc tính:* Chạy trực tiếp trên trình duyệt Web, độc lập với hệ điều hành của Controller. Có khả năng quản lý trạng thái và chuyển đổi kết nối linh hoạt giữa **nhiều** Agent khác nhau trong hệ thống.
    * Một số lưu ý:
	    * Phải xử lý giao diện phù hợp cho việc theo dõi **nhiều** máy agent cùng lúc và cả focus vào 1 máy.
	    * Trong chế độ webcam, livestream phải có tín hiệu khi thay đổi chế độ xem (1 máy, ít máy, nhiều máy) để thay đổi FPS cho phù hợp.
	    * xử lý được thao tác gửi lệnh cho *tất cả*/1 nhóm/1 agent trong cùng 1 lần.
	    * Tổ chức kiến trúc và chia trạng thái các module **hợp lý**, **dễ sử dụng** và đẹp mắt.
* **Agent (Client Application):**
    * *Vai trò:* Thành phần thực thi lệnh trực tiếp trên máy mục tiêu.
    * *Đặc tính:* Ứng dụng chạy tường minh (Explicit Application) trên hệ điều hành Windows, có giao diện tương tác và cảnh báo trực quan tới người dùng cuối.
* **Gateway (Relay Proxy Server):**
    * *Vai trò:* Thành phần trung gian điều phối và định tuyến dữ liệu.
    * *Đặc tính:* Hoạt động như một Reverse Proxy sử dụng giao thức **WebSockets**. Gateway duy trì các kết nối song công (Full-Duplex) liên tục, nhận lệnh từ Controller, biên dịch/định tuyến xuống Agent tương ứng và trả kết quả ngược lại theo thời gian thực.
    * Một số lưu ý:
	    * Phải duy trì kết nối với các client, nhận diện được khi có client mất kết nối và phản hồi phù hợp.
	    * Khi có client đăng ký (gửi gói tin đầu tiên khi khỏi động), lưu lại địa chỉ cho những lần sau.
	    * Tránh bị crash do gửi tin thấy bại cho 1 client mất kết nối.
	    * Nhận diện loại gói tin hiệu quả và chuyển tiếp (json, binary)
	    * Dùng các thư viện xử lý tốc độ cao (hình như ws)
	    * Nhận diện gói tin cần gửi cho 1/nhiều agent

---

## 3. ĐẶC TẢ CHỨC NĂNG (FUNCTIONAL REQUIREMENTS)

Hệ thống được chia thành 7 phân hệ chức năng quản trị cốt lõi, liên kết chặt chẽ với cơ chế bảo mật:

### 3.1. Phân hệ Quản lý Ứng dụng (Application Module)
* **Yêu cầu:** Liệt kê danh sách các ứng dụng đang mở, trạng thái hoạt động và mức tiêu thụ tài nguyên CPU của từng ứng dụng.
* **Ràng buộc bảo mật:** Cho phép khởi chạy (Start) hoặc đóng (Stop) ứng dụng. Tuy nhiên, Controller chỉ được phép can thiệp vào các ứng dụng nằm trong **Danh sách an toàn (Whitelist)** được định nghĩa trước bởi hệ thống.
* TCP
### 3.2. Phân hệ Quản lý Tiến trình (Process Module)
* **Yêu cầu:** Truy xuất dữ liệu thời gian thực của toàn bộ tiến trình hệ thống (kèm chỉ số % CPU, dung lượng RAM chiếm dụng... tương tự task manager của window).
* **Quyền hạn:** Cho phép gửi lệnh chấm dứt tác vụ (`Kill Process`) dựa trên ID tiến trình (PID).
* TCP

### 3.3. Phân hệ Giám sát Màn hình (Screenshot & Live Stream)
* **Yêu cầu:** Chụp ảnh màn hình đơn lẻ (Snapshot) hoặc truyền tải luồng màn hình trực tiếp (Live Stream).
* **Chỉ số kỹ thuật:** Tốc độ truyền tải luồng tối thiểu đạt **24 FPS** nhằm đảm bảo độ mượt mà về mặt thị giác.
* TCP 

### 3.4. Phân hệ Ghi nhận Thao tác (Keylogger Module)
* **Yêu cầu:** Theo dõi và ghi lại toàn bộ chuỗi ký tự được gõ từ bàn phím vật lý trên máy Agent.
* **Đầu ra:** Dữ liệu text được đồng bộ hóa và hiển thị theo luồng thời gian trên giao diện Controller.
* TCP

### 3.5. Phân hệ Quản lý Tập tin (File Sandbox Module)
* **Yêu cầu:** Hỗ trợ truy cập và truyền tải tệp tin hai chiều (Upload và Download file) giữa Controller và Agent.
* **Ràng buộc bảo mật:** Áp dụng cơ chế **Sandbox**. Các thao tác đọc/ghi file bị giới hạn nghiêm ngặt trong một phân vùng/thư mục được chỉ định. Agent từ chối mọi yêu cầu duyệt cây thư mục hoặc truy cập ngoài vùng an toàn.
* TCP

### 3.6. Phân hệ Quan sát Camera (Webcam Module)
* **Yêu cầu:** Kết nối và truyền tải hình ảnh trực tiếp từ thiết bị camera/webcam tích hợp trên máy Agent.
* TCP

### 3.7. Phân hệ Quản lý Nguồn (Power Module)
* **Yêu cầu:** Thực thi các lệnh thay đổi trạng thái hoạt động của máy trạm bao gồm: Khóa máy (Lock), Khởi động lại (Restart), Tắt máy (Shutdown), và Ngủ (Sleep).
* TCP

---

## 4. TIÊU CHUẨN BẢO MẬT & QUYỀN RIÊNG TƯ (SECURITY & PRIVACY REQUIREMENTS)

Đây là các yêu cầu phi chức năng mang tính bắt buộc (Mandatory) nhằm định hình độ tin cậy của hệ thống.

### 4.1. Cơ chế Xác thực (Authentication)
* Controller bắt buộc phải vượt qua bước kiểm tra danh tính (Xác thực tài khoản/mật khẩu hoặc Token) ở lần thiết lập phiên làm việc đầu tiên. 
* Mọi kết nối chưa qua xác thực từ phía Web App đều bị Gateway từ chối chuyển tiếp dữ liệu.

### 4.2. Cơ chế Chấp thuận từ Người dùng (User Consent)
* **Phạm vi áp dụng:** Toàn bộ các module nhạy cảm cao, bao gồm: *Keylogger, Live Stream, Screenshot, Webcam, và Power*.
* **Cơ chế hoạt động:** Khi nhận lệnh từ Controller, Agent không thực thi ngay mà bắt buộc phải kích hoạt một hộp thoại (Popup) cảnh báo trên màn hình máy trạm. Hệ thống chỉ kích hoạt luồng dữ liệu khi người dùng tại máy trạm bấm chọn **Đồng ý (Approve)**. Nếu người dùng chọn Từ chối (Reject) hoặc không phản hồi, lệnh sẽ bị hủy.

### 4.3. Cơ chế Cảnh báo Minh bạch (Transparency Alert)
* **Đối với module Webcam:** Áp dụng quy trình trì hoãn chủ động. Hệ thống kích hoạt đồng hồ đếm ngược **10 giây (Countdown)** hiển thị rõ ràng trên màn hình Agent để người dùng chuẩn bị trước khi Camera chính thức ghi hình.
* **Đối với luồng trạng thái hoạt động:** Trong suốt quá trình Webcam thu tín hiệu, một **dấu chấm đỏ nhấp nháy (Flashing Red Indicator)** bắt buộc phải xuất hiện cố định ở lớp trên cùng của màn hình (Always-on-top Overlay), đảm bảo người dùng luôn nhận biết được trạng thái bị giám sát.

---

## 5. BẢNG TÓM TẮT TRẠNG THÁI RÀNG BUỘC CHỨC NĂNG

| Tên Module            | Yêu cầu Tương tác                 | Cơ chế Bảo mật đi kèm                     |
| :-------------------- | :-------------------------------- | :---------------------------------------- |
| **Application**       | Xem / Start / Stop                | Giới hạn theo danh sách Whitelist         |
| **Process**           | Xem / Kill                        | Yêu cầu quyền thực thi của hệ điều hành   |
| **Screenshot/Stream** | Xem thời gian thực (24 FPS)       | Bắt buộc phải có **User Consent**         |
| **Keylogger**         | Ghi log bàn phím                  | Bắt buộc phải có **User Consent**         |
| **File**              | Upload / Download                 | Giới hạn tuyệt đối trong vùng **Sandbox** |
| **Webcam**            | Quay hình trực tiếp               | Đếm ngược 10s + Hiện chấm đỏ nhấp nháy    |
| **Power**             | Lock / Restart / Shutdown / Sleep | Bắt buộc phải có **User Consent**         |
## 6. Nâng cấp 

| Tên                                  | Yêu cầu                                                                                         |     |
| :----------------------------------- | :---------------------------------------------------------------------------------------------- | :-- |
| Xác thực quyền Controller            | JWT (JSON Web Token)                                                                            |     |
| Tự động dò tìm gateway               | Gateway broadcast địa chỉ chỉ, agent và controller dò để xác định địa chỉ                       |     |
| Điều chỉnh FPS & Chất lượng ảnh động | Tính năng điều chỉnh FPS trong các chế độ xem (1,4, nhiều) agent                                |     |
| Bảng điều khiển Real-time            | Thay vì chỉ gửi ping pong, gửi thêm thông tin app, process theo chu kỳ để cập nhật thường xuyên |     |
| Mã hóa dữ liệu đầu cuối              | Dùng các thuật toán mã hóa để các gói tin có bị bắt cũng không lộ thông tin                     |     |
|                                      |                                                                                                 |     |
| cải tiến webcam/livestream           | Dùng webtrc để truyền video<br>Option 2: Tách luồng Control/Media Separation                    |     |
|                                      |                                                                                                 |     |
