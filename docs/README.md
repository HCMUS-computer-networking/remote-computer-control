# docs/

Nguồn tài liệu tập trung cho monorepo `remote-computer-control` (agent + gateway + controller).

## Mục lục

- **`protocol/`** — JSON message schema canonical (Controller ↔ Gateway ↔ Agent). Tra trước khi thêm/sửa message; `Instruction.md` là mô tả tổng quan.
- **`design/agent/`** — technical design, specification và checklist của module Agent (C# .NET 8).
- **`design/gateway/`** — technical design của Gateway (Node.js) + description + report nội bộ.
- **`design/controller/`** — architecture snapshot của Controller (React + Vite), `technical_explanation/` (5 note kỹ thuật), `wireframe/` (color palette, icons, draw.io).
- **`reports/`** — báo cáo đánh giá tổng thể (`evaluation.md`).

## Nguyên tắc

- `protocol/` là **single source of truth** cho message format cho cả agent, gateway và controller. Mọi drift phải sync về đây.
- Mỗi file `design/<component>/*.md` chỉ mô tả component tương ứng; kiến trúc tổng thể của monorepo nằm ở [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
