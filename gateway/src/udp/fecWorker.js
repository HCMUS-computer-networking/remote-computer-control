const { parentPort } = require('worker_threads');

// Lắng nghe yêu cầu tính toán XOR từ Main Thread
parentPort.on('message', (task) => {
  try {
    const { taskId, total, totalPayloadLength, chunks, parityData } = task;
    const MAX_PAYLOAD_SIZE = 1300;

    let missingIndex = -1;
    for (let i = 0; i < total; i++) {
      if (!chunks[i]) {
        missingIndex = i;
        break;
      }
    }

    if (missingIndex === -1 || !parityData) {
      parentPort.postMessage({ taskId, success: false, error: 'Không tìm thấy chunk thiếu hoặc không có parity data' });
      return;
    }

    // Thực hiện tính toán XOR nặng trên Worker Thread (không làm nghẽn Event Loop chính)
    let recovered = Buffer.from(parityData);
    for (let i = 0; i < total; i++) {
      if (i !== missingIndex && chunks[i]) {
        const chunk = Buffer.from(chunks[i]); // Chuyển đổi an toàn
        for (let j = 0; j < chunk.length; j++) {
          recovered[j] ^= chunk[j];
        }
      }
    }

    // Xử lý padding của chunk cuối cùng
    if (missingIndex === total - 1 && totalPayloadLength > 0) {
      let lastChunkSize = totalPayloadLength % MAX_PAYLOAD_SIZE;
      if (lastChunkSize === 0) lastChunkSize = MAX_PAYLOAD_SIZE;
      recovered = recovered.subarray(0, lastChunkSize);
    }

    // Copy sang ArrayBuffer đúng kích thước rồi mới transfer. `recovered` có thể là     //
    // view (subarray / Buffer từ pool) nằm trên ArrayBuffer lớn hơn với byteOffset ≠ 0, //
    // nên KHÔNG được gửi thẳng `recovered.buffer` — nó sẽ kèm padding/rác của pool.      //
    const out = new Uint8Array(recovered.length);
    out.set(recovered);

    // Trả kết quả về Main Thread; transfer ArrayBuffer riêng (zero-copy an toàn)
    parentPort.postMessage({ taskId, success: true, missingIndex, recovered: out.buffer }, [out.buffer]);
  } catch (err) {
    parentPort.postMessage({ taskId, success: false, error: err.message });
  }
});
