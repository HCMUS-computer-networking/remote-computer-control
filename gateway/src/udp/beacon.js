const dgram = require('dgram');
const os = require('os');
const logger = require('../utils/logger');

let beaconSocket = null;
let beaconInterval = null;

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Lấy IPv4 và bỏ qua các IP nội bộ (ví dụ: 127.0.0.1)
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1'; // Fallback
}

function startBeacon(port, protocol) {
  if (beaconSocket) return;

  beaconSocket = dgram.createSocket('udp4');
  
  beaconSocket.on('error', (err) => {
    logger.error(`[UDP Beacon] Error: ${err.message}`);
    if (beaconSocket) beaconSocket.close();
  });

  beaconSocket.bind(() => {
    try {
        beaconSocket.setBroadcast(true);
        const localIp = getLocalIpAddress();
        const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
        const announceMessage = `GATEWAY_ANNOUNCE|${wsProtocol}://${localIp}:${port}`;
        const messageBuffer = Buffer.from(announceMessage);

        logger.info(`[UDP Beacon] Broadcasting presence on port 8888 (${announceMessage})`);

        beaconInterval = setInterval(() => {
        beaconSocket.send(messageBuffer, 0, messageBuffer.length, 8888, '255.255.255.255', (err) => {
            if (err) {
            logger.debug(`[UDP Beacon] Broadcast error: ${err.message}`);
            }
        });
        }, 3000);
    } catch (e) {
        logger.error(`[UDP Beacon] Failed to start broadcast: ${e.message}`);
    }
  });
}

function stopBeacon() {
  if (beaconInterval) {
    clearInterval(beaconInterval);
    beaconInterval = null;
  }
  if (beaconSocket) {
    try {
      beaconSocket.close();
    } catch (e) {}
    beaconSocket = null;
    logger.info('[UDP Beacon] Stopped');
  }
}

module.exports = { startBeacon, stopBeacon };
