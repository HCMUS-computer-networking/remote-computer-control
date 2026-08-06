const dgram = require('dgram');
const logger = require('../utils/logger');
const controllerStore = require('../store/controllerStore');
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

const server = dgram.createSocket('udp4');
const PORT = 9000;

// Frame buffer map
// Key: `${agentId}_${moduleType}_${frameId}`
// Value: { chunks: Array, receivedCount: number, timestamp: number, total: number, meta: object, recovering: boolean }
// Cấu trúc: Map<streamKey, { expectedSeq: number, pending: Array<{seq, frame, fullBuffer}> }>
const streamBuffers = new Map();

// frameBuffer is used to assemble chunks of a single frame
const frameBuffer = new Map();

// Worker Pool State
const numWorkers = Math.max(1, Math.min(os.cpus().length - 1, 4));
const workers = [];
let nextWorkerIndex = 0;
const pendingTasks = new Map();
let taskCounter = 0;   // monotonic id so 2 frames sharing a frameKey (frameId wrap) never collide

function initWorkerPool() {
  for (let i = 0; i < numWorkers; i++) {
    const worker = new Worker(path.resolve(__dirname, 'fecWorker.js'));
    worker.on('message', (result) => {
      const task = pendingTasks.get(result.taskId);
      if (!task) return;
      pendingTasks.delete(result.taskId);
      if (task.timeoutId) clearTimeout(task.timeoutId);

      if (result.success) {
        task.resolve(result);
      } else {
        task.reject(new Error(result.error));
      }
    });
    worker.on('error', (err) => logger.error(`[FEC Worker ${i}] Error: ${err.message}`));
    workers.push(worker);
  }
}

function recoverChunkAsync(frameKey, total, totalPayloadLength, chunks, parityData) {
  return new Promise((resolve, reject) => {
    // Unique task id: frameId is a 16-bit value that wraps, so the same frameKey can
    // recur while an earlier recovery is still pending — a plain frameKey would clobber it.
    const taskId = `${frameKey}#${++taskCounter}`;

    // Timeout chống kẹt 40ms để drop frame cũ kịp thời
    const timeoutId = setTimeout(() => {
      pendingTasks.delete(taskId);
      reject(new Error('FEC calculation timed out (40ms)'));
    }, 40);

    pendingTasks.set(taskId, { resolve, reject, timeoutId });

    const worker = workers[nextWorkerIndex++ % workers.length];
    worker.postMessage({ taskId, total, totalPayloadLength, chunks, parityData });
  });
}

function finalizeFrame(frameKey, frame) {
  try {
    const fullBuffer = Buffer.concat(frame.chunks);
    frame.meta.len = fullBuffer.length;
    
    const streamKey = `${frame.meta.agent_id}_${frame.meta.module}`;
    let streamState = streamBuffers.get(streamKey);
    if (!streamState) {
        streamState = { expectedSeq: frame.meta.seq, pending: [] };
        streamBuffers.set(streamKey, streamState);
    }
    
    streamState.pending.push({ seq: frame.meta.seq, frame, fullBuffer });
    streamState.pending.sort((a, b) => a.seq - b.seq);
    
    while (streamState.pending.length > 0) {
        if (streamState.pending[0].seq <= streamState.expectedSeq || streamState.pending.length >= 8) {
            const next = streamState.pending.shift();
            streamState.expectedSeq = next.seq + 1;
            
            const metaString = JSON.stringify(next.frame.meta);
            
            if (controllerStore.hasCommand(next.frame.meta.command_id)) {
              controllerStore.sendToCommandInitiator(next.frame.meta.command_id, metaString);
              controllerStore.sendToCommandInitiator(next.frame.meta.command_id, next.fullBuffer);
            } else {
              controllerStore.broadcastToSubscribers(next.frame.meta.agent_id, metaString);
              controllerStore.broadcastToSubscribers(next.frame.meta.agent_id, next.fullBuffer, { binary: true });
            }
        } else {
            break;
        }
    }
  } catch (err) {
    logger.error(`[UDP] Error finalizing frame ${frameKey}: ${err.message}`);
  } finally {
    frameBuffer.delete(frameKey);
  }
}

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

    // FEC Logic (Chú ý 2: Tách biệt Parity Chunk)
    if (chunkIndex === totalChunks) {
      if (!frame.parityData && payload.length >= 4) {
        frame.totalPayloadLength = payload.readUInt32LE(0);
        frame.parityData = payload.subarray(4);
      }
    } else if (chunkIndex < totalChunks) {
      if (!frame.chunks[chunkIndex]) {
        frame.chunks[chunkIndex] = payload;
        frame.receivedCount++;
      }
    }

    // Kiểm tra đã nhận đủ, hoặc có thể khôi phục bằng FEC
    if (frame.receivedCount === frame.total) {
      finalizeFrame(frameKey, frame);
    } else if (frame.receivedCount === frame.total - 1 && frame.parityData && !frame.recovering) {
      frame.recovering = true; // Chặn các luồng xử lý trùng lặp
      
      recoverChunkAsync(frameKey, frame.total, frame.totalPayloadLength, frame.chunks, frame.parityData)
        .then((res) => {
             let finalFrame = frameBuffer.get(frameKey);
             if (!finalFrame) return; // Đã bị Garbage Collector xóa mất do timeout 100ms
             
             finalFrame.chunks[res.missingIndex] = Buffer.from(res.recovered);
             finalFrame.receivedCount++;
             
             finalizeFrame(frameKey, finalFrame);
        })
        .catch(err => {
             frameBuffer.delete(frameKey); // Xóa frame hỏng
        });
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
  initWorkerPool();
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
  for (const worker of workers) {
    worker.terminate();
  }
  try {
    server.close(() => {
      logger.info('[UDP] Server closed');
    });
  } catch (e) {}
}

module.exports = { start, shutdown };
