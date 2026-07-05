# Bảng màu đề xuất (Light / Dark)

> Bản nháp để dựng UI ban đầu. Đơn sắc (1 thang xám + 1 accent) cho dễ đồng bộ, các màu
> trạng thái (success/danger/warning) tách riêng vì bắt buộc phải có theo mục 5-6 của kế
> hoạch (đèn đỏ session, cảnh báo module nhạy cảm...). Team thống nhất xong thì sửa lại giá
> trị hex ở đây và ở `src/index.css`, không cần đổi tên biến.

## 1. Thang xám gốc (dùng chung 2 theme)

| Token | Hex | Dùng cho |
|---|---|---|
| `--gray-0` | `#FFFFFF` | nền trắng tuyệt đối, chữ trên nền tối |
| `--gray-50` | `#F8FAFC` | nền phụ (sidebar, topbar, hàng bảng so le) |
| `--gray-100` | `#F1F5F9` | nền phụ đậm hơn 1 chút (card, ô input) |
| `--gray-200` | `#E2E8F0` | viền nhạt |
| `--gray-300` | `#CBD5E1` | viền chuẩn |
| `--gray-400` | `#94A3B8` | icon phụ, trạng thái offline |
| `--gray-500` | `#64748B` | chữ phụ (muted text) |
| `--gray-600` | `#475569` | chữ phụ đậm (dark theme) |
| `--gray-700` | `#334155` | viền tối (dark theme) |
| `--gray-800` | `#1E293B` | chữ chính (light theme) / nền card (dark theme) |
| `--gray-900` | `#0F172A` | nền chính (dark theme) |

## 2. Accent (đơn sắc — 1 hue duy nhất)

| Token | Light | Dark | Dùng cho |
|---|---|---|---|
| `--accent` | `#3B82F6` | `#60A5FA` | nút chính, tab đang active, viền focus |
| `--accent-bg` | `#DBEAFE` | `rgba(96,165,250,0.16)` | nền nhẹ cho tab/badge active |
| `--accent-border` | `#93C5FD` | `rgba(96,165,250,0.4)` | viền phụ của accent-bg |

## 3. Màu trạng thái (functional — bắt buộc, không thuộc thang đơn sắc)

| Token | Hex | Dùng cho |
|---|---|---|
| `--success` | `#22C55E` | Agent online, thao tác thành công |
| `--success-bg` | `#DCFCE7` | badge/nền nhẹ trạng thái thành công |
| `--danger` | `#EF4444` | Agent đang trong phiên điều khiển (đèn đỏ), Kill, Shutdown |
| `--danger-bg` | `#FEE2E2` | badge "SESSION", banner lỗi mất kết nối |
| `--warning` | `#F59E0B` | Restart, cảnh báo, trạng thái "Connecting..." |
| `--warning-bg` | `#FEF3C7` | ghi chú/annotation cảnh báo |

## 4. Bề mặt đặc biệt (cố định 2 theme — như khối code)

Live Screen / Webcam feed và Keylog terminal luôn nền tối kiểu "màn hình/camera",
không đổi theo theme để tránh chói mắt khi xem live:

| Token | Hex | Dùng cho |
|---|---|---|
| `--surface-feed` | `#0F172A` | nền khung Live Screen / Webcam (chưa có frame) |
| `--border-feed` | `#334155` | viền khung feed |
| `--text-feed` | `#94A3B8` | placeholder text trong khung feed |
| `--surface-terminal` | `#0B1220` | nền log Keylogger |
| `--text-terminal` | `#4ADE80` | chữ log Keylogger (kiểu terminal xanh lá) |

## 5. CSS variables — Light theme (`:root`)

```css
:root {
  /* grayscale */
  --gray-0: #FFFFFF;
  --gray-50: #F8FAFC;
  --gray-100: #F1F5F9;
  --gray-200: #E2E8F0;
  --gray-300: #CBD5E1;
  --gray-400: #94A3B8;
  --gray-500: #64748B;
  --gray-800: #1E293B;

  /* semantic */
  --bg: var(--gray-0);
  --bg-surface: var(--gray-50);
  --bg-elevated: var(--gray-0);
  --border: var(--gray-200);
  --text: var(--gray-800);
  --text-muted: var(--gray-500);

  /* accent */
  --accent: #3B82F6;
  --accent-bg: #DBEAFE;
  --accent-border: #93C5FD;

  /* status */
  --success: #22C55E;
  --success-bg: #DCFCE7;
  --danger: #EF4444;
  --danger-bg: #FEE2E2;
  --warning: #F59E0B;
  --warning-bg: #FEF3C7;

  /* fixed dark surfaces (feed/terminal) */
  --surface-feed: #0F172A;
  --border-feed: #334155;
  --text-feed: #94A3B8;
  --surface-terminal: #0B1220;
  --text-terminal: #4ADE80;
}
```

## 6. CSS variables — Dark theme

```css
[data-theme="dark"] {
  --gray-0: #0F172A;
  --gray-50: #16181D;
  --gray-100: #1E293B;
  --gray-200: #334155;
  --gray-300: #475569;
  --gray-400: #64748B;
  --gray-500: #94A3B8;
  --gray-800: #F1F5F9;

  --bg: var(--gray-0);
  --bg-surface: var(--gray-50);
  --bg-elevated: var(--gray-100);
  --border: var(--gray-200);
  --text: var(--gray-800);
  --text-muted: var(--gray-500);

  --accent: #60A5FA;
  --accent-bg: rgba(96, 165, 250, 0.16);
  --accent-border: rgba(96, 165, 250, 0.4);

  --success: #4ADE80;
  --success-bg: rgba(74, 222, 128, 0.14);
  --danger: #F87171;
  --danger-bg: rgba(248, 113, 113, 0.16);
  --warning: #FBBF24;
  --warning-bg: rgba(251, 191, 36, 0.14);

  /* surface-feed / surface-terminal giữ nguyên, không đổi theo theme */
}
```

## Ghi chú

- Đây là màu **tạm** dùng cho wireframe (khớp với [controller-wireframes.drawio](wireframes/controller-wireframes.drawio)). Khi nhóm chốt bảng màu chính thức, chỉ cần sửa giá trị hex trong 2 khối CSS ở trên và copy vào `src/index.css` — tên biến giữ nguyên nên không phải sửa component nào khác.
- Hiện `src/index.css` đang là theme mặc định của Vite starter (tím `--accent: #aa3bff`), chưa áp bảng màu này — cần thay khi bắt đầu code layout thật (tuần 1, mục 13 của Playbook).
