/**
 * Chạy một script TypeScript trong Node bằng Module Runner có sẵn của Vite.
 *
 * Vì sao không dùng tsx/ts-node: Vite đã là dependency, và dùng chính pipeline biến đổi của Vite
 * bảo đảm CLI, test (Vitest) và trình duyệt cùng phân giải module (kể cả import JSON) theo một cách.
 *
 * Cách dùng: node scripts/run.mjs scripts/<tên>.ts [tham số...]
 * Script đích phải export hàm `main(argv: string[]): Promise<number | void>`.
 */
import { resolve } from 'node:path';
import { runnerImport } from 'vite';

const [, , script, ...args] = process.argv;
if (!script) {
  console.error('Thiếu đường dẫn script. Ví dụ: node scripts/run.mjs scripts/sim.ts --seed 42');
  process.exit(2);
}

const { module } = await runnerImport(resolve(script), { configFile: false, logLevel: 'error' });
if (typeof module.main !== 'function') {
  console.error(`${script} không export hàm main(argv).`);
  process.exit(2);
}
const exitCode = await module.main(args);
process.exit(typeof exitCode === 'number' ? exitCode : 0);
