# Coding Style

> Reference: `controller/src/` (React + Vite + Zustand). Gateway (JS) và Agent (C#) áp dụng convention chung ở phần **Universal**, cộng phần riêng cho mỗi ngôn ngữ. Style hiện có trong controller là **canonical** — mọi khác biệt so với gateway/agent, controller thắng trừ khi ngôn ngữ ép ngược lại (vd C# .NET conventions).

---

## 1. Universal (bắt buộc mọi ngôn ngữ)

### 1.1. Constants — UPPER_SNAKE_CASE

Mọi giá trị bất biến (true constant) — bất kể module-level, class-level, hay hoisted — dùng `UPPER_SNAKE_CASE`.

✅ Đúng (từ `Protocol.js`, `ProcessTab/index.jsx`):
```js
export const MSG_TYPE = { LIST_AGENTS: "list_agents", ... }
export const FEATURE  = { APPLICATION: "application", ... }
const POLL_INTERVAL_MS = 3000
const EMPTY_PROCS      = []
```

❌ Sai:
```js
const pollIntervalMs = 3000   // primitive không đổi → phải UPPER_SNAKE
const msgType = { ... }       // enum-like constant → phải UPPER_SNAKE
```

C# tương ứng: `const int POLL_INTERVAL_MS = 3000;`, `static readonly string GATEWAY_ANNOUNCE = "...";`. Field private mutable vẫn theo `.NET` convention (`_camelCase`).

### 1.2. Comment — chỉ WHY, tiếng Anh, đơn giản

**Rule vàng:** nếu xoá comment mà reader vẫn hiểu code làm gì, thì comment đó là WHAT — xoá.

Comment tồn tại khi có:
- Hidden constraint (nghiệp vụ, protocol, race condition).
- Workaround cho bug cụ thể.
- Invariant không thể hiện qua tên biến.
- Lý do chọn giải pháp kỳ lạ.

✅ Đúng (từ `ConnectionStore.js`):
```js
// AUTH — auth_token holds the SHORT-LIVED access JWT issued by the Gateway
// after a successful login. It lives ONLY in this store (memory) — never in
// sessionStorage / localStorage. A page reload therefore signs the operator
// out; the HttpOnly refresh cookie is what lets AuthService re-hydrate it.
```
→ Giải thích **vì sao** giữ token trong RAM (bảo mật), không phải mô tả code.

✅ Đúng (từ `AgentStore.js`):
```js
// No-op if the agent id is unknown — the dispatch layer then resyncs
// the whole list via list_agents.
setAgentStatus: (agent_id, patch) => ...
```
→ Cảnh báo hành vi không hiển nhiên.

❌ Sai:
```js
// Set the status
setStatus: (status) => set({ status })   // xoá comment vẫn hiểu

// Loop through agents
for (const a of agents) { ... }          // WHAT
```

### 1.3. Comment `//` cuối dòng — căn cột thẳng khi liên tiếp

Nhiều dòng liên tiếp có trailing `//` phải align cột `//` bằng space.

✅ Đúng (từ `Protocol.js:MSG_TYPE`):
```js
LIST_AGENTS        : "list_agents",        // request current agent list
REQUEST            : "request",            // generic wrapper for almost all commands
POWER              : "power",              // power action (special type, not "request")
POLICY_UPDATE      : "policy_update",      // push app_whitelist + sandbox_path to agents
```

❌ Sai:
```js
LIST_AGENTS : "list_agents", // request current agent list
REQUEST : "request",  // generic wrapper
POWER : "power",    // power action
```

Chỉ căn khi ≥ 2 dòng liên tiếp. Rời rạc không cần.

### 1.4. File header khi file > 100 dòng

Dòng 1-2 đầu file: tên file — mục đích 1 câu. Nếu có invariant kiến trúc, thêm 1 khối `//` giải thích.

✅ Đúng (từ `UseAgentSocket.js`):
```js
// UseAgentSocket.js — sole glue layer between the socket service and Zustand stores.
//
// Components must NEVER import MockSocket or Socket directly; they use this hook.
// Swapping MockSocket for the real Socket only requires changing the one import below.
// ...
```

File < 100 dòng: header 1 dòng vẫn khuyến khích (`// AgentStore.js — agent list, multi-select set, and focused agent for detail view.`) nhưng không bắt buộc.

### 1.5. Import / using — sắp theo cụm

Thứ tự: **stdlib → third-party → local**. Giữa cụm chèn 1 dòng trống.

✅ Đúng (từ `App.jsx`):
```js
import { useEffect }        from 'react'                       // third-party (framework)
import { WifiOff, Loader2 } from 'lucide-react'                // third-party

import useUiStore           from './store/UiStore'             // local
import useConnectionStore   from './store/ConnectionStore'
import useAgentSocket       from './hooks/UseAgentSocket'
import LoginScreen          from './components/LoginScreen'
```

C# tương ứng: `System.*` → `Microsoft.*` / third-party → project namespace (`AgentSystem.*`).

---

## 2. JavaScript — Gateway

### 2.1. Naming

| Loại | Convention | Ví dụ |
|---|---|---|
| Biến, param, property | `snake_case` | `agent_id`, `pid_input`, `target_agents` |
| Function, method | `camelCase` | `handleAgent`, `verifyControllerAuth`, `sendCommand` |
| Constant module-level | `UPPER_SNAKE_CASE` | `PING_INTERVAL`, `MSG_TYPE` |
| Class, constructor | `PascalCase` | `WebSocketServer` (từ `ws` lib) |
| File | `camelCase.js` | `messageRouter.js`, `agentStore.js` (đã có sẵn, giữ) |

### 2.2. Semicolons — giữ `semi-full` của gateway

Gateway hiện tại dùng `;` cuối mọi statement (consistent). **Không đổi.** Controller dùng no-semi style, cũng consistent nội tại. 2 codebase không đồng bộ chỗ này — đây là quyết định có ý thức để tránh rewrite lớn.

### 2.3. Braces — giữ K&R của gateway

Gateway JS hiện dùng K&R (`function foo() {` cùng dòng). Controller JS dùng Allman. **Không ép Allman cho gateway** — churn khổng lồ, không đổi behavior. Allman chỉ bắt buộc cho C# (đã default).

### 2.4. `const` mọi giá trị không reassign

Không dùng `var`. `let` chỉ khi reassign thật sự.

✅
```js
const config = require('./config');
const wss    = new WebSocketServer({ noServer: true });
let   server;                            // reassign trong if/else TLS
```

### 2.5. Arrow function cho callback, function declaration cho top-level export

✅
```js
// top-level exported / reusable → function declaration
function handleAgent(ws, req) { ... }
module.exports = handleAgent;

// callback / one-off → arrow
app.use((req, res, next) => { ... });
process.on('SIGINT', () => shutdown('SIGINT'));
```

### 2.6. Kiểm tra require cụm

CommonJS `require`, sắp: stdlib Node → third-party npm → local.

✅ (từ `server.js`):
```js
// stdlib
const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const { URL } = require('url');

// third-party
const express          = require('express');
const rateLimit        = require('express-rate-limit');
const { WebSocketServer } = require('ws');

// local
const config              = require('./config');
const logger              = require('./utils/logger');
const { verifyControllerAuth } = require('./middleware/auth');
```

---

## 3. C# — Agent

**Không ép rule conflict .NET.** C# có convention lâu đời (`PascalCase` cho method/property, `_camelCase` cho private field, `I<Name>` cho interface). Giữ nguyên.

### 3.1. Chỉ enforce

- **Allman braces** — C# default đã Allman, kiểm tra không có ai đổi sang K&R. Nếu bắt gặp file K&R, đổi lại.
- **Constant primitive** — `const int MAX_RETRY = 3;`, `static readonly TimeSpan CONSENT_TIMEOUT = TimeSpan.FromSeconds(30);` → `UPPER_SNAKE_CASE`. Field `readonly` non-primitive (reference type như Dictionary) giữ `_camelCase` theo .NET convention.
- **Comment WHY + English + `//` align** — như phần Universal.
- **File header khi > 100 dòng** — như phần Universal.
- **`using` sắp theo cụm** — `System.*` → `Microsoft.*` / third-party → `AgentSystem.*`.

### 3.2. KHÔNG rename symbol

Không đổi `PascalCase` method sang `camelCase`, không đổi `_camelCase` field sang `snake_case`. Rename là task riêng, cần user duyệt từng cái.

### 3.3. Ví dụ 1 file C# đúng convention

```csharp
// StreamModule.cs — screen live-stream capture with delta encoding + MD5 change detection.
// Runs on PeriodicTimer; sends frame_meta + binary JPEG pair per frame that actually changed.

using System;                                                                       // stdlib
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;

using Serilog;                                                                      // third-party

using AgentSystem.Core;                                                             // local
using AgentSystem.Managers;

namespace AgentSystem.Modules
{
    public class StreamModule : BaseModule
    {
        // Force a full keyframe every N frames so a Controller joining mid-stream
        // has a reference to reconstruct against. See docs/protocol/Livescreen.json.
        private const int KEYFRAME_INTERVAL = 30;

        private readonly SemaphoreSlim _sendLock = new(1, 1);   // .NET convention: _camelCase
        private int _frameCounter;

        public async Task HandleScreenshotAsync(string commandId)
        {
            // ...
        }
    }
}
```

---

## 4. Checklist khi review 1 file

- [ ] File header 1-2 dòng (nếu > 100 dòng).
- [ ] `using` / `import` / `require` chia cụm stdlib → third-party → local, có dòng trống giữa cụm.
- [ ] Constant `UPPER_SNAKE_CASE`, không lẫn `camelCase`.
- [ ] Comment chỉ WHY, không WHAT.
- [ ] Trailing `//` liên tiếp căn cột.
- [ ] Naming khớp ngôn ngữ (JS: `snake_case`/`camelCase`; C#: giữ .NET).
- [ ] Không rename bừa symbol.
- [ ] Không đổi semi/brace style giữa các codebase — mỗi codebase consistent nội tại.

---

## 5. Áp dụng — thứ tự và scope

Theo plan R5:

1. **Gateway trước:** ưu tiên `src/server.js`, `src/router/*.js`, `src/socket/*.js`. File > 30 dòng diff → 1 commit riêng.
2. **Agent sau:** ưu tiên `Program.cs`, `Modules/*.cs`.
3. **Sau mỗi thư mục:** chạy build/test, báo cáo.
4. **KHÔNG rename symbol** trong task này.
