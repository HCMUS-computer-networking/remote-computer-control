# 5. Lý do Grid view dùng FPS thấp, Focus view mới dùng 24 FPS

## Bài toán băng thông khi hiển thị nhiều Agent

Trong chế độ Grid view, Controller hiển thị thumbnail ảnh chụp màn hình của **nhiều Agent cùng lúc** (ví dụ: 4, 8, hoặc hơn). Mỗi Agent gửi về một luồng JPEG liên tục. Nếu tất cả Agent đều stream ở 24 FPS, tổng băng thông tiêu thụ tăng tuyến tính theo số Agent:

```
Băng thông ≈ (kích thước JPEG trung bình) × FPS × số Agent
```

Với JPEG 1080p nén chất lượng trung bình (~80KB/frame) và 8 Agent ở 24 FPS:

```
80KB × 24 × 8 = ~15 MB/s ≈ 120 Mbps
```

Đây là mức vượt quá băng thông thực tế của nhiều môi trường mạng nội bộ phòng lab, và hoàn toàn không cần thiết vì thumbnail Grid view nhỏ, người dùng không cần độ mượt cao để quan sát tổng quan.

## Giải pháp: FPS theo chế độ xem

Hệ thống áp dụng chiến lược phân cấp FPS:

- **Grid view**: FPS thấp (1–2 FPS). Đủ để cập nhật trạng thái màn hình tổng quan mỗi vài giây. Băng thông với 8 Agent ở 2 FPS chỉ còn ~10 Mbps, trong giới hạn chấp nhận được.
- **Focus view** (khi người dùng chọn một Agent cụ thể để giám sát): 24 FPS. Lúc này chỉ một Agent được stream với độ phân giải cao, băng thông tập trung cho một luồng duy nhất.

Controller gửi lệnh điều chỉnh FPS khi người dùng chuyển chế độ:

```json
{ "type": "request", "module": "screenshot", "params": { "fps": 2 }, "target_agents": ["all"] }
{ "type": "request", "module": "screenshot", "params": { "fps": 24 }, "target_agents": ["agent_01"] }
```

Agent điều chỉnh tần suất capture tương ứng, giảm tải cả phía Agent lẫn phía mạng.

## Đánh đổi

FPS thấp ở Grid view có nghĩa là sự kiện nhanh (ví dụ: cửa sổ bật lên trong 1 giây) có thể bị bỏ qua giữa hai frame. Đây là sự đánh đổi có chủ ý: Grid view phục vụ mục đích **quan sát tổng quan**, không phải giám sát chi tiết theo thời gian thực. Khi cần xem chi tiết, người dùng chuyển sang Focus view với 24 FPS.
