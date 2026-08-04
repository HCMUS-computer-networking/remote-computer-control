# 1. Lý do chọn Zustand thay vì Redux Toolkit và Context API

## Vấn đề đặt ra

Controller nhận dữ liệu cập nhật liên tục từ Agent thông qua WebSocket: danh sách tiến trình làm mới mỗi vài giây, khung hình ảnh chụp màn hình hoặc webcam gửi về theo tần số cao, sự kiện bàn phím đến từng luồng. Với tần suất cập nhật như vậy, cơ chế quản lý trạng thái phải đảm bảo chỉ những component thực sự phụ thuộc vào dữ liệu thay đổi mới được render lại.

## Hạn chế của Context API

Context API của React sử dụng cơ chế so sánh tham chiếu để xác định component cần render lại. Khi một giá trị trong Context thay đổi, **toàn bộ cây component** tiêu thụ Context đó sẽ bị render lại, bất kể component con có thực sự dùng đến giá trị thay đổi hay không. Trong kịch bản cập nhật liên tục với nhiều module đồng thời, điều này tạo ra số lượng lớn re-render thừa, ảnh hưởng đến hiệu năng giao diện.

## Hạn chế của Redux Toolkit

Redux Toolkit giải quyết vấn đề re-render thông qua selector, nhưng đi kèm chi phí cấu hình đáng kể: định nghĩa slice, action, reducer, và middleware. Với quy mô của đồ án (nhóm nhỏ, thời gian có hạn), phần lớn boilerplate này không mang lại giá trị tương xứng. Ngoài ra, Redux sử dụng mô hình bất biến (immutable update), đòi hỏi viết logic cập nhật cẩn thận hơn khi state chứa dữ liệu nhị phân như ArrayBuffer của khung hình ảnh.

## Lý do chọn Zustand

Zustand cho phép component **subscribe vào từng trường cụ thể** trong store thông qua selector. Khi một trường thay đổi, chỉ component subscribe vào trường đó mới được render lại. Thư viện không yêu cầu Provider bao ngoài, không có boilerplate action/reducer, và hỗ trợ cập nhật state đồng thời với dữ liệu nhị phân mà không cần xử lý đặc biệt. Zustand cũng cho phép gọi `getState()` từ bên ngoài component (ví dụ từ lớp xử lý WebSocket), giúp tách biệt hoàn toàn lớp service khỏi lớp UI.

## Đánh đổi

Zustand không có DevTools mạnh như Redux (mặc dù có hỗ trợ Redux DevTools cơ bản). Với dự án lớn cần audit luồng dữ liệu phức tạp, Redux Toolkit vẫn là lựa chọn phù hợp hơn. Trong phạm vi đồ án này, sự đơn giản và hiệu năng của Zustand được ưu tiên hơn khả năng tracing nâng cao.
