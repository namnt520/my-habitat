// Chạy mô phỏng trong một worker thread và gửi chuỗi băm trạng thái về luồng chính.
// Dùng bản CLI đã đóng gói để worker không phụ thuộc vào bộ biến đổi TypeScript của Vitest.
import { execFileSync } from 'node:child_process';
import { parentPort, workerData } from 'node:worker_threads';

const output = execFileSync(
  'node',
  ['scripts/run.mjs', 'scripts/hash.ts', '--seed', String(workerData.seed), '--ticks', String(workerData.ticks)],
  { encoding: 'utf8' },
);
parentPort.postMessage(output.trim().split('\n').pop());
