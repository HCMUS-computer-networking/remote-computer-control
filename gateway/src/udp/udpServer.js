// src/udp/udpServer.js
const dgram = require('dgram');
const logger = require('../utils/logger');
const controllerStore = require('../store/controllerStore');

const server = dgram.createSocket('udp4');
const PORT = 9000;

// Frame buffer map
// Key: `${agentId}_${moduleType}_${frameId}`
// Value: { chunks: Array, receivedCount: number, timestamp: number, total: number, meta: object }
const frameBuffer = new Map();

server.on('error', (err) => {
  logger.error(`[UDP] Server error:\n${err.stack}`);
  server.close();
});

server.on('message', (msg, rinfo) => {
  // UDP Header Layout (24 bytes fixed + dynamic strings)
  // [0] : Chunk_Index
  // [1] : Total_Chunks
  // [2] : Module_Type (0: Screen, 1: Webcam)
  // [3] : Is_Keyframe (0: false, 1: true)
  // [4-5] : Frame_ID (ushort LE)
  // [6-13] : X, Y, Width, Height (ushort LE x 4)
  // [14-21] : Timestamp_MS (ulong LE / bigint)
  // [22] : AgentID_Length (L1)
  // [23] : CommandID_Length (L2)
  // [24 .. 24+L1-1] : AgentID
  // [24+L1 .. 24+L1+L2-1] : CommandID
  // [Remaining] : Payload

  if (msg.length < 24) return; // Invalid packet

  try {
    const chunkIndex = msg.readUInt8(0);
    const totalChunks = msg.readUInt8(1);
    const moduleTypeByte = msg.readUInt8(2);
    const isKeyframe = msg.readUInt8(3) === 1;
    const frameId = msg.readUInt16LE(4);
    const x = msg.readUInt16LE(6);
    const y = msg.readUInt16LE(8);
    const w = msg.readUInt16LE(10);
    const h = msg.readUInt16LE(12);
    const timestampMs = Number(msg.readBigUInt64LE(14));
    
    const l1 = msg.readUInt8(22);
    const l2 = msg.readUInt8(23);

    if (msg.length < 24 + l1 + l2) return; // Incomplete packet

    let offset = 24;
    const agentId = msg.toString('utf8', offset, offset + l1);
    offset += l1;
    const commandId = msg.toString('utf8', offset, offset + l2);
    offset += l2;

    const payload = msg.subarray(offset);
    const moduleName = moduleTypeByte === 1 ? 'webcam' : 'screen';

    const frameKey = `${agentId}_${moduleName}_${frameId}`;

    let frame = frameBuffer.get(frameKey);
    if (!frame) {
      frame = {
        chunks: new Array(totalChunks),
        receivedCount: 0,
        timestamp: Date.now(),
        total: totalChunks,
        meta: {
          type: "frame_meta",
          module: moduleName,
          agent_id: agentId,
          command_id: commandId,
          x, y, w, h,
          is_keyframe: isKeyframe,
          seq: frameId,
          timestamp_ms: timestampMs
        }
      };
      frameBuffer.set(frameKey, frame);
    }

    // Place chunk in the correct index
    if (!frame.chunks[chunkIndex]) {
      frame.chunks[chunkIndex] = payload;
      frame.receivedCount++;
    }

    // If all chunks received
    if (frame.receivedCount === frame.total) {
      const fullBuffer = Buffer.concat(frame.chunks);
      frame.meta.len = fullBuffer.length;
      
      const metaString = JSON.stringify(frame.meta);

      // Send Metadata (Text) then Payload (Binary)
      // We use broadcastToSubscribers or sendToCommandInitiator
      // Wait, Controller needs both Text then Binary sequentially on the same websocket.
      // Let's send directly to the initiator
      if (controllerStore.hasCommand(commandId)) {
        controllerStore.sendToCommandInitiator(commandId, metaString);
        controllerStore.sendToCommandInitiator(commandId, fullBuffer);
      } else {
        // Fallback: broadcast to subscribers if commandId isn't found
        // But send meta first!
        // We'll write a custom broadcast loop so we send them synchronously per socket.
        const subs = controllerStore.getAll();
        for (const ws of subs) {
          if (controllerStore.isSubscribed(ws, agentId) && ws.readyState === ws.OPEN) {
            ws.send(metaString, { binary: false });
            ws.send(fullBuffer, { binary: true });
          }
        }
      }

      frameBuffer.delete(frameKey);
    }
  } catch (err) {
    logger.error(`[UDP] Packet parsing error: ${err.message}`);
  }
});

server.on('listening', () => {
  const address = server.address();
  logger.info(`[UDP] Server listening on ${address.address}:${address.port}`);
});

// Garbage collector for incomplete frames
let gcInterval;

function start(port = PORT) {
  server.bind(port);
  
  gcInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, frame] of frameBuffer.entries()) {
      if (now - frame.timestamp > 100) { // 100ms timeout is plenty for local/fast UDP
        frameBuffer.delete(key);
      }
    }
  }, 100);
}

function shutdown() {
  if (gcInterval) clearInterval(gcInterval);
  try {
    server.close(() => {
      logger.info('[UDP] Server closed');
    });
  } catch (e) {}
}

module.exports = { start, shutdown };
