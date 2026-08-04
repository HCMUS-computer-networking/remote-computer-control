# CHECKLIST — AGENT (C# .NET 8)

> Nguồn định hướng: `report.md` mục **III.1 (Agent)** và **IV.4 (Giai đoạn 4)**. Phương án B đã HOÀN THÀNH end-to-end. Nhóm làm theo triết lý **3 team code độc lập, chốt cross-team ngay từ đầu ở buổi kick-off** — không có ai chờ ai giữa lúc code.
>
> **Trạng thái Agent hiện tại (03/08/2026):** Agent đã CODE XONG 3 hạng mục lớn — Remote Input, Binary File Transfer, Delta Encoding — trước buổi kick-off nhóm. Code Agent hiện đi TRƯỚC spec chung ở `docs/protocol/` → nhiệm vụ còn lại là **sync spec** để buổi kick-off ratify + Controller/Gateway theo cùng.
>
> File này gồm 3 phần:
> - **PHẦN A** — **Sync spec docs/protocol/** (ưu tiên 1, làm trước buổi kick-off nhóm). Đây là input để nhóm chốt.
> - **PHẦN S** — Phối hợp Gateway Giai đoạn 1 (S1 per-agent secret, S2 issuer field) — chờ Gateway xong G5/G6 rồi làm, không block ai.
> - **PHẦN LƯU TRỮ** — các prompt A1/A2 checklist cũ (Remote Input, Binary File Transfer) đã CODE XONG trong commit `b0977f9` — giữ để tra cứu.
>
> 7 quyết định cross-team nhóm phải chốt ở kick-off — trao đổi trực tiếp trong buổi họp nhóm.

---

## 0. TRẠNG THÁI HIỆN TẠI CỦA AGENT (đọc trước)

**Đã HOÀN THÀNH (ghi nhận từ `git log`):**

| Việc | Commit | File chính |
|------|--------|-----------|
| Remote Input (mouse + keyboard qua Win32 P/Invoke) | `b0977f9` (03/08) | `Modules/InputModule.cs` — 302 dòng, 4 command `input_mouse_move/click/key/type` |
| Binary File Transfer + `transfer_id` + SHA256 (bỏ Base64) | `b0977f9` (03/08) | `Modules/FileModule.cs` — `fs_get_result` gửi JSON metadata + binary frame; ConcurrentDictionary cho concurrent uploads; OnDisconnected cancel pending |
| Delta Encoding Bounding Box + `is_keyframe` | `1e1c5d2` (03/08) | `Modules/StreamModule.cs` — thêm `previousBitmap`, `KeyframeInterval=30`, hàm `GetDifferenceBoundingBox`, field `is_keyframe` vào `frame_meta` |
| Consent memory trong session | (đã có từ lâu) | `Core/AgentClient.cs:25` `_grantedFeatures` HashSet |
| SysInfo module | `cbf047f` (đã cũ) | `Modules/SysInfoModule.cs` — command `sysinfo` trả 10 field |

**Vấn đề hiện tại:** Code Agent LỆCH spec chung ở `docs/protocol/`:
- ✅ `SysInfo.json` — chưa tồn tại (code có nhưng spec không) [CẦN BỔ SUNG TRONG FORMATJSON]
- ✅ `Input.json` — chưa tồn tại (code có nhưng spec không) [CẦN BỔ SUNG TRONG FORMATJSON]
- ✅ `File.json` — spec còn ghi base64 + không `transfer_id`, LỆCH code binary + `transfer_id` + `sha256` hiện tại [CẦN UPDATE FORMATJSON]
- ✅ `Livescreen.json` — chưa có field `is_keyframe` trong `frame_meta` [CẦN UPDATE FORMATJSON]

→ Nếu merge bây giờ Controller sẽ hỏng ngay. **PHẦN A dưới đây phải xong TRƯỚC buổi kick-off nhóm** — không có spec đúng thì không ai chốt được cái gì.

---

## 1. PROMPT CONTEXT (dán đầu mỗi session Agent)

```
Tôi đang code phần AGENT (C# .NET 8, Windows) của đồ án môn Mạng máy tính. 3 thành phần: Controller (React) — Gateway (Node.js relay) — Agent. Codebase Agent: forclaude/agent/.

TRẠNG THÁI DỰ ÁN:
Phương án B (raw-WS formatjson) đã HOÀN THÀNH end-to-end. Nhóm áp dụng triết lý "chốt cross-team upfront rồi 3 team code độc lập" — không có ai block ai giữa lúc code.

VIỆC AGENT ĐÃ XONG (trong 3 commit gần nhất):
- Remote Input (Modules/InputModule.cs, commit b0977f9): 4 command input_mouse_move/input_mouse_click/input_key/input_type qua Win32 P/Invoke SetCursorPos, SendInput. Fire-and-forget cho mouse_move tránh CPU spike.
- Binary File Transfer (Modules/FileModule.cs, commit b0977f9): fs_get_result và fs_put chuyển từ Base64 sang WebSocket binary frame + JSON metadata gửi trước. Có transfer_id trong header, SHA256 chunk cuối, ConcurrentDictionary cho concurrent upload, OnDisconnected cancel pending.
- Delta Encoding Screen (Modules/StreamModule.cs, commit 1e1c5d2): GetDifferenceBoundingBox tính vùng thay đổi so frame trước; thêm is_keyframe vào frame_meta; KeyframeInterval=30 (mỗi 30 frame gửi 1 keyframe).

VIỆC AGENT CÒN LẠI:
- PHẦN A: Sync spec docs/protocol/*.json khớp code hiện tại — SysInfo.json (MỚI), Input.json (MỚI), File.json (UPDATE binary+transfer_id), Livescreen.json (UPDATE is_keyframe). Đây là input cho buổi kick-off nhóm — làm SỚM.
- PHẦN S: chờ Gateway xong G5 (per-agent secret) rồi làm S1; chờ G6 (issuer field) rồi làm S2.
- KHÔNG code thêm tính năng ngoài report.md — Giai đoạn 4 đã coi như xong.

TECH STACK & KIẾN TRÚC HIỆN TẠI (không tự đổi):
- C# .NET 8, Windows Forms cho Tray/Consent popup. WebSocket client thô.
- Core/AgentClient.cs (line 25 _grantedFeatures HashSet — nhớ consent trong session; line 165 popup 30s hard-timeout).
- Core/WebSocketClient.cs (có sẵn SendBinaryFrame sau commit b0977f9).
- Core/IAgentContext.cs (đã thêm SendBinaryFrame).
- Modules/*.cs: SysInfo, Stream (delta encoding), File (binary), Process (WMI), Power, Keylog, Webcam, App, Input.
- Managers/UIManager.cs (consent popup), SecurityManager.cs (sandbox+whitelist), AuditLogger.cs (log lệnh+granted).
- Forms/TrayApp.cs (tray icon, mật khẩu bảo vệ, auto-start).
- config.json (chứa AGENT_KEY tĩnh — sẽ đổi ở S1 sau khi Gateway G5 xong).

QUY TẮC:
- KHÔNG refactor kiến trúc. KHÔNG thêm tính năng ngoài yêu cầu.
- Với PHẦN A: chỉ viết/sửa file *.json trong docs/protocol/ — KHÔNG đụng file .cs.
- Với PHẦN S: chỉ sửa file .cs khi Gateway đã xong prereq — có thể check bằng cách grep G5/G6 trong gateway/src/.
- Comment tiếng Anh, ngắn gọn WHY-not-WHAT. Giữ style code hiện tại.
- Trước khi sửa: đọc file liên quan rồi liệt kê ngắn file/hàm sẽ đụng. KHÔNG động vào code Controller/Gateway.
- Trả lời tiếng Việt kèm keyword tiếng Anh, đưa diff/patch rõ ràng.

Nếu hiểu, đáp "OK, ready" ngắn và chờ yêu cầu cụ thể. KHÔNG code cho tới khi tôi yêu cầu.
```

---

## PHẦN A. SYNC SPEC `docs/protocol/` (ưu tiên 1 — trước kick-off)

> Cả 4 mục dưới đây CHỈ viết file JSON — không đụng code C#. Bám format của file có sẵn (vd `Process.json`, `Application.json`) — cấu trúc `TX` + `RX` + `_desc`. Viết vào `docs/protocol/*.json` (single source of truth cho cả 3 team).

### 🧩 A1. Tạo `SysInfo.json` (MỚI)

**Bối cảnh:** [SysInfoModule.cs:71-85](agent/Modules/SysInfoModule.cs) trả 10 field cứng. Cần spec để Controller code C1 (SysInfo Dashboard) không phải đọc code C# đoán.

**Prompt:**
```
Tạo docs/protocol/SysInfo.json.

Bám format Process.json làm mẫu. Bắt buộc:

TX (Controller gửi):
{
  "type": "request",
  "module": "sysinfo",
  "target_agents": ["PC-Lab-01"]
}
(không có params — SysInfoModule.cs không đọc params)

RX (Agent trả — khớp CHÍNH XÁC SysInfoModule.cs:71-85, KHÔNG đổi tên field):
{
  "type": "sysinfo_result",
  "agent_id": "PC-Lab-01",
  "command_id": "<uuid>",
  "cpu_percent": 12.34,           // double, 2 chữ số thập phân
  "ram_used_mb": 4096.50,
  "ram_total_mb": 16384.00,
  "disk_used_gb": 120.45,
  "disk_total_gb": 512.00,
  "uptime_seconds": 3600,          // long
  "hostname": "PC-Lab-01",
  "ip": "192.168.1.10",
  "os": "Microsoft Windows NT 10.0.22621.0"
}

ERROR (Agent trả khi PerformanceCounter fail — SysInfoModule.cs:87-96):
{
  "type": "ERROR",
  "agent_id": "PC-Lab-01",
  "command_id": "<uuid>",
  "message": "Error getting sysinfo: <exception>"
}

Thêm _desc ngắn tiếng Anh cho mỗi mục TX/RX/ERROR. KHÔNG sửa code C#.
```

**✅ Xong khi:** file merge vào 2 repo, `grep sysinfo_result` trong `SysInfoModule.cs` khớp 100% với `sysinfo_result` trong `SysInfo.json`.

---

### 🧩 A2. Tạo `Input.json` (MỚI)

**Bối cảnh:** [InputModule.cs](agent/Modules/InputModule.cs) đã có 4 command sau commit `b0977f9`. Không có spec → Controller không dựng được UI Remote Input, Gateway G7 input validation không whitelist được `input_*`.

**Prompt:**
```
Tạo docs/protocol/Input.json.

Bám format Process.json làm mẫu. Bắt buộc — grep SupportedCommands trong InputModule.cs và các Handle* method để lấy đúng params:

TX các lệnh (đều bọc trong {type:"request", module:"<x>", target_agents:[...], params:{...}}):
- module "input_mouse_move", params: {x: int, y: int}  (tọa độ tuyệt đối màn hình chính pixel)
- module "input_mouse_click", params: {button: "left"|"right"|"middle", action: "down"|"up"|"click"}  (default: left, click)
- module "input_key", params: {vk: int, action: "down"|"up"|"press"}  (vk = Virtual Key code)
- module "input_type", params: {text: string}  (gõ Unicode qua SendInput UNICODE)

RX cho tất cả:
{
  "type": "input_result",
  "agent_id": "PC-Lab-01",
  "command_id": "<uuid>",
  "success": true|false,
  "message": "<optional error>"
}

NOTE quan trọng ghi vào _desc: input_mouse_move dùng "Fire-and-Forget" (Agent KHÔNG gửi ACK cho mỗi move để tránh flood khi bắn 60+ event/s — chỉ gửi ACK khi có error). Controller không expect ACK cho move.

KHÔNG sửa code C#. Thêm _desc tiếng Anh cho mỗi mục.
```

**✅ Xong khi:** file merge, Controller có thể đọc thấy 4 command + params. Nhóm quyết định ở kick-off có làm InputTab hay không (Q6 mục 13.4) — spec có sẵn dù chưa quyết.

---

### 🧩 A3. Cập nhật `File.json` — binary + `transfer_id` + `sha256`

**Bối cảnh:** Sau commit `b0977f9`, [FileModule.cs:198-249](agent/Modules/FileModule.cs) gửi `fs_get_result` theo pattern MỚI:
- JSON metadata gửi trước (có `transfer_id`, `total_size`, `chunk_index`, `total_chunks`, `sha256` nullable — chỉ ở chunk cuối)
- Binary WebSocket frame kế tiếp chứa raw bytes (KHÔNG còn `data_base64`)

Spec hiện tại `docs/protocol/File.json` vẫn ghi base64 + không có `transfer_id` → LỆCH code Agent.

**Prompt:**
```
Cập nhật docs/protocol/File.json. ĐỌC FileModule.cs (GetFileAsync line 198-249, PutFileAsync line 65-110) TRƯỚC khi viết spec.

Thay đổi cần làm:

1. Mục fs_get_result: bỏ field data_base64. Thay bằng pattern 2-message:
   {
     "_desc": "Metadata for the next binary WebSocket frame. Agent sends this JSON immediately followed by a binary frame containing raw chunk bytes.",
     "type": "fs_get_result",
     "agent_id": "PC-Lab-01",
     "command_id": "<uuid>",
     "transfer_id": "<uuid — used to group chunks; falls back to command_id if client did not provide one>",
     "success": true,
     "path": "/reports/log.txt",
     "total_size": 1024,
     "chunk_index": 0,
     "total_chunks": 4,
     "sha256": null    // chỉ non-null ở chunk cuối cùng (chunk_index == total_chunks - 1)
   }
   Ghi rõ: binary frame kế tiếp là raw bytes của chunk, size = 512KB trừ chunk cuối có thể nhỏ hơn (FileModule.cs CHUNK_SIZE=512*1024, line 206).

2. Mục fs_put — cập nhật TX: Controller cũng gửi JSON metadata (transfer_id, chunk_index, total_chunks) TRƯỚC binary frame kế tiếp. Bỏ data_base64 khỏi TX fs_put.

3. Mục fs_put_result: giữ nguyên cấu trúc cũ (ack theo chunk_index).

4. Giữ fs_list, fs_list_result, fs_error nguyên (không đổi).

5. Thêm ghi chú ở đầu file: "File transfer now uses binary WebSocket frames. Each chunk = 1 JSON metadata message + 1 binary frame. Group chunks by transfer_id; verify integrity with sha256 at the last chunk."

Ưu tiên field name khớp CHÍNH XÁC code C# (grep để verify — dùng snake_case cho JSON).
```

**✅ Xong khi:**
- Grep `data_base64` trong `File.json` không còn kết quả.
- Grep `transfer_id` và `sha256` xuất hiện.
- Controller đọc spec mới, biết ghép chunk theo `transfer_id` (không phải `path`) và verify SHA256 chunk cuối.

---

### 🧩 A4. Cập nhật `Livescreen.json` — thêm `is_keyframe`

**Bối cảnh:** Commit `1e1c5d2` thêm field `is_keyframe` (bool) vào `frame_meta` cho Delta Encoding. Controller cần biết để: (a) reset canvas ở keyframe, (b) apply delta partial ở non-keyframe (nếu Agent gửi bounding box crop trong tương lai — hiện vẫn full JPEG mỗi frame).

**Prompt:**
```
Cập nhật docs/protocol/Livescreen.json.

ĐỌC StreamModule.cs (grep "frame_meta" hoặc "is_keyframe") TRƯỚC khi viết spec.

Thay đổi:

1. Trong mục frame_meta (RX): thêm field is_keyframe (boolean).
   Ghi rõ trong _desc: "true nếu frame là keyframe (full state); false nếu chỉ chứa vùng đã thay đổi so frame trước. Agent gửi keyframe mỗi KeyframeInterval frame (30 frame) hoặc khi bắt đầu stream. Controller nhận keyframe = reset canvas, non-keyframe = có thể apply partial (hiện tại Agent vẫn gửi full JPEG cho cả 2 loại — chỉ dùng cờ để signal chu kỳ)."

2. Nếu StreamModule.cs có thêm field khác trong frame_meta sau commit 1e1c5d2 (vd bbox_x, bbox_y, bbox_w, bbox_h cho bounding box) — grep để verify — thêm vào spec.

3. Giữ nguyên các message khác (screenshot, screen_stream, screen_stream_stop, stream_started, stream_stopped).

KHÔNG sửa code C#. Verify field name khớp CHÍNH XÁC.
```

**✅ Xong khi:**
- `is_keyframe` xuất hiện trong `Livescreen.json`.
- Controller ScreenTab team hiểu semantic (hiện tại có thể không phải sửa gì — cả keyframe và delta vẫn là full JPEG — nhưng spec ghi rõ để tương lai).

---

## PHẦN S. PHỐI HỢP GATEWAY (chờ Gateway xong prereq)

> S1, S2 chỉ code khi Gateway đã xong hạng mục tương ứng — check bằng `git log` trong `gateway/` hoặc hỏi team Gateway. Trước đó KHÔNG code, tránh mock rồi làm lại.

### 🧩 S1. Chuyển sang per-agent secret (chờ Gateway G5)

**Prereq:** Gateway đã có `scripts/add_agent.js` + bảng `agents.json` với `secret_hash` (bcrypt) — kiểm bằng `ls gateway/scripts/add_agent.js`.

**Prompt:**
```
Sau khi Gateway G5 xong (kiểm ls gateway/scripts/add_agent.js). Sửa:

1. Core/AgentClient.cs — phần REGISTER handshake: gửi kèm {agent_id, secret} thay vì chỉ AGENT_KEY. Field name khớp với parse phía Gateway (bàn 1 dòng với Gateway team nếu cần).
2. Managers/ConfigManager.cs — đọc field mới "agent_secret" từ config.json thay vì "AGENT_KEY". KHÔNG hardcode secret.
3. Cập nhật config.json (example, KHÔNG commit secret thật): thêm field "agent_secret": "<paste from scripts/add_agent.js output>".
4. Giữ backwards-compat 1 phiên: nếu config.json không có agent_secret, fallback đọc AGENT_KEY cũ + log warning "Deprecated: use agent_secret".

Đọc AgentClient.cs phần connect + ConfigManager.cs trước khi sửa.
```

**✅ Check lại S1:** Agent register với secret đúng → connect OK; sai secret → Gateway đóng 1008; 2 socket cùng agent_id → socket thứ 2 bị Gateway từ chối.

---

### 🧩 S2. Đọc và log field `issuer` từ Gateway stamp (chờ Gateway G6)

**Prereq:** Gateway đã xong G6 (stamp `issuer` string username vào message trước forward). Kiểm bằng grep `issuer` trong `gateway/src/router/messageRouter.js`.

**Prompt:**
```
Sau khi Gateway G6 xong (grep issuer trong gateway/src/router/messageRouter.js thấy có stamp). Sửa 2 chỗ:

1. Core/AgentClient.cs — parse packet: đọc thêm field top-level "issuer" (string, có thể null nếu Gateway cũ chưa stamp).
2. Managers/AuditLogger.cs — hàm LogCommand thêm tham số issuer (nullable string). Ghi dòng log dạng "[YYYY-MM-DD HH:MM:SS] issuer=<value> cmd=<command_id> feature=<feature> granted=<bool>". Nếu issuer null → log "issuer=unknown", KHÔNG reject message.

Schema issuer đã chốt ở nhóm là STRING username (không phải object).

Đọc AgentClient.cs phần dispatch packet và AuditLogger.cs trước khi sửa.
```

**✅ Check lại S2:** Audit log thấy `issuer` cho mọi lệnh Controller phát; log không crash khi Gateway cũ gửi lệnh không kèm `issuer` (fallback "unknown").

---

## Z1. TỰ RÀ SOÁT (sau khi PHẦN A xong; sau khi PHẦN S xong)

**Prompt:**
```
KHÔNG code. Tự rà soát toàn bộ thay đổi vừa thực hiện. Trả lời từng câu Có/Không (N/A nếu không áp dụng) + 1 dòng giải thích + file:line:

Với PHẦN A (spec sync):
1. Field name trong docs/protocol/*.json vừa viết có khớp CHÍNH XÁC với property name trong code C# không (grep chéo)?
2. Có field nào trong code C# gửi mà spec quên không?
3. Có mục nào trong spec mô tả field/hành vi mà code C# không có (bịa)?
4. docs/protocol/ đã reflect đúng field / hành vi code Agent chưa?

Với PHẦN S:
5. Có backwards-compat để Agent chạy được cả khi Gateway CHƯA xong G5/G6 không (fallback secret cũ, fallback issuer=unknown)?
6. Có hardcode secret trong code không?
7. Có class/handler nào giao tiếp WS trực tiếp thay vì qua IAgentContext.SendResponse/SendBinaryFrame không?

Chung:
8. Comment tiếng Anh ngắn gọn WHY-not-WHAT không?
9. Có code refactor vượt scope không (chỉ được sửa thứ tôi yêu cầu)?

Ngoài ra liệt kê bug tiềm ẩn: WS drop giữa lúc gửi binary frame; race condition ConcurrentDictionary; deprecated warning không bị silent; secret leak vào log.

Mỗi vi phạm: file:line + hướng sửa. KHÔNG viết code.
```

**✅ Check lại:** báo cáo đủ.

---

## Z2. LỌC LẠI LỖI THẬT

**Prompt:**
```
Xem lại DANH SÁCH Z1. Với TỪNG mục phân loại:
- LỖI THẬT — cần sửa: 1 dòng vì sao chắc chắn là bug.
- KHÔNG PHẢI LỖI — chưa code tới hoặc ngoài phạm vi.
- KHÔNG PHẢI LỖI — hiểu sai code (cite file:line xử lý ở chỗ khác).

Bullet ngắn, không code. Cuối cùng shortlist lỗi thật xếp Cao/Trung bình/Thấp.
```

**✅ Check lại:** shortlist → fix từng cái → lặp Z1+Z2 tới khi rỗng.

---

## PHẦN LƯU TRỮ — CÁC PROMPT CHECKLIST CŨ (ĐÃ CHẠY XONG)

> Giữ nguyên văn để tra cứu. Cả 2 prompt dưới đây ĐÃ RUN + code merge trong commit `b0977f9`. **Không chạy lại**.

### 🧩 [DONE — commit b0977f9] A1 cũ. Remote Input — Mouse & Keyboard (user32.dll)

Prompt gốc yêu cầu tạo `Modules/InputModule.cs` với 4 command `input_mouse_move/click/key/type` qua P/Invoke `user32.dll`. Kết quả: `InputModule.cs` 302 dòng, dùng `SetCursorPos` + `mouse_event` + `keybd_event`/`SendInput UNICODE`, fire-and-forget cho `input_mouse_move` (không ACK) tránh CPU spike + WebSocket flood.

### 🧩 [DONE — commit b0977f9] A2 cũ. File Transfer — Base64 JSON → Binary WebSocket Frames

Prompt gốc yêu cầu chuyển `FileModule` sang binary + thêm `transfer_id`. Kết quả: `FileModule.cs` `GetFileAsync` gửi JSON `fs_get_result` (có `transfer_id`, `sha256` nullable ở chunk cuối) + `context.SendBinaryFrame(chunk)` kế tiếp. `PutFileAsync` nhận binary + JSON metadata song song. `Core/IAgentContext.cs` thêm `SendBinaryFrame`. `Core/WebSocketClient.cs` thêm 4 dòng support binary.

---

## KẾT THÚC & THỨ TỰ

1. **PHẦN A (A1→A4)** — làm SỚM, xong trước buổi kick-off nhóm Giai đoạn 3. Đây là input để nhóm chốt spec (mục 13 Context). Không đụng code C#, chỉ viết file JSON.
2. **Chờ buổi kick-off nhóm** — ratify các quyết định (mục 13.4). Nếu nhóm không đồng ý điểm nào (vd Q6 Input scope) → điều chỉnh spec cho phù hợp.
3. **PHẦN S** — S1 khi Gateway xong G5; S2 khi Gateway xong G6. Cả 2 có backwards-compat, không block ai.
4. **KHÔNG code thêm** ngoài scope trên. Nếu phát sinh, ghi vào mục 13 Context để bàn nhóm.

Sau khi xong: commit branch `feature/agent-spec-sync` (PHẦN A) + `feature/agent-gateway-coop` (PHẦN S), chuyển sang `Merge_Guide.md`.
