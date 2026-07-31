# Gateway Relay Proxy Server

WebSocket relay server điều phối giao tiếp giữa **Controller** (Web App) và nhiều **Agent** (Windows client) cho hệ thống giám sát phòng máy.

## Kiến trúc

```
Controller (Web) ◄──ws──► Gateway (:8080) ◄──ws──► Agent (Windows)
     /controller              │                    /agent
                          HTTP REST
                        POST /api/login
                         GET /health
```

## Cài đặt

```bash
npm install
```

## Cấu hình

Copy `.env.example` thành `.env` và chỉnh sửa:

```env
PORT=8080
AGENT_KEY=agent-secret-key-2024
CONTROLLER_KEY=controller-secret-key-2024
JWT_SECRET=jwt-super-secret-key-2024
PING_INTERVAL=30000
PING_TIMEOUT=10000
LOG_LEVEL=info
```

## Chạy

```bash
# Development (auto-restart)
npm run dev

# Production
npm start
```

## API Endpoints

### REST

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/login` | Login → JWT token |

**Login request:**
```json
POST /api/login
{ "username": "admin", "password": "admin123" }
```

**Login response:**
```json
{ "ok": true, "token": "eyJ...", "message": "Login successful" }
```

### WebSocket

| Path | Auth | Mô tả |
|---|---|---|
| `/agent?key=<AGENT_KEY>` | Shared key | Kết nối Agent |
| `/controller?token=<JWT>` | JWT token | Kết nối Controller |
| `/controller?key=<CONTROLLER_KEY>` | Shared key (fallback) | Kết nối Controller |

## Protocol

### Agent → Gateway
1. **REGISTER** (message đầu tiên):
   ```json
   { "type": "REGISTER", "agent_id": "PC-Lab-01", "hostname": "PC-Lab-01", "ip": "192.168.1.10", "os": "Windows 11" }
   ```
2. **Response messages**: Gateway tự đóng dấu `agent_id` rồi broadcast tới mọi Controller.
3. **Binary frames** (JPEG): Forward nguyên byte tới mọi Controller.

### Controller → Gateway
1. **list_agents**: Gateway trả trực tiếp (không xuống Agent):
   ```json
   { "type": "list_agents" }
   → { "type": "agents_list", "agents": [{ "id": "PC-Lab-01", "name": "PC-Lab-01", "os": "Windows 11", "ip": "192.168.1.10", "online": true }] }
   ```
2. **Request messages**: Gateway đọc `target_agents` rồi forward nguyên message tới từng Agent.

### Status Broadcast
- Agent online: `{ "type": "agent_status", "agent_id": "PC-Lab-01", "online": true, ... }`
- Agent offline: `{ "type": "agent_status", "agent_id": "PC-Lab-01", "online": false }`

## Cấu trúc thư mục

```
src/
├── index.js                 # Entry point
├── config.js                # Load .env
├── server.js                # Express + WS server + graceful shutdown
├── socket/
│   ├── agentHandler.js      # Agent WS handler
│   └── controllerHandler.js # Controller WS handler
├── managers/
│   ├── agentStore.js        # Agent registry (Map)
│   ├── controllerStore.js   # Controller sockets (Set)
│   └── heartbeat.js         # Ping-Pong mechanism
├── router/
│   └── messageRouter.js     # Route by target_agents
├── middleware/
│   └── auth.js              # verifyAgentKey / verifyControllerAuth
├── auth/
│   ├── login.js             # POST /api/login
│   └── users.json           # User credentials (bcrypt)
└── utils/
    └── logger.js            # Winston logger
```

## Logs

- `logs/gateway.log` — Tất cả log (max 10MB, 5 files rotation)
- `logs/error.log` — Chỉ error (max 5MB, 3 files rotation)