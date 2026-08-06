# Contributing to Remote Computer Control

Cảm ơn bạn đã quan tâm đóng góp cho dự án Remote Computer Control! Chúng tôi luôn hoan nghênh các ý tưởng, báo cáo lỗi, và các pull request từ cộng đồng.

## 1. Môi trường phát triển

Để đóng góp mã nguồn, bạn cần cài đặt:
- Node.js 18+ (cho Gateway và Controller)
- .NET 8 SDK (cho Agent)
- Visual Studio 2022 (khuyến nghị cho Agent) hoặc VS Code

## 2. Quy trình làm việc (Workflow)

1. **Fork** repository này về tài khoản GitHub của bạn.
2. **Clone** repository đã fork về máy cục bộ.
3. Tạo một **branch** mới cho tính năng hoặc sửa lỗi của bạn (ví dụ: `feature/new-ui` hoặc `bugfix/fix-gateway-crash`).
4. Viết code và **kiểm thử** cẩn thận trên cả 3 thành phần (Agent, Gateway, Controller).
5. **Commit** với thông điệp rõ ràng, tuân thủ theo chuẩn [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
6. Tạo **Pull Request (PR)** vào nhánh `main` của repository gốc.

## 3. Tiêu chuẩn mã nguồn (Coding Standards)

- **C# (Agent)**: Tuân thủ các quy tắc định dạng mặc định của Visual Studio. Không sử dụng `async void` ngoại trừ trong các event handler.
- **Node.js/React**: Sử dụng ESLint/Prettier (nếu có). Cố gắng giữ cấu trúc component sạch sẽ, không nhồi nhét quá nhiều logic vào giao diện.
- **Tài liệu**: Nếu tính năng của bạn làm thay đổi cách cài đặt, API hay cấu trúc, vui lòng cập nhật lại các file tài liệu trong thư mục `docs/`.

## 4. Báo cáo lỗi (Issue)

Khi tạo một Issue mới, vui lòng cung cấp:
1. Mô tả rõ lỗi gặp phải.
2. Các bước tái hiện lỗi.
3. Môi trường chạy (phiên bản Windows, Node.js, v.v.).
4. Log (nếu có).

Cảm ơn bạn đã đồng hành cùng dự án!
