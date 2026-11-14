/**
 * Chạy một script TypeScript của dự án trong Node.
 *
 * Cách làm: dùng chính Vite (đã là dependency) để đóng gói script thành một file JS trong `out/cli/`, rồi chạy file đó.
 * Vì sao đóng gói thay vì dùng module runner của Vite: runner biến mọi hằng số import thành lời gọi getter,
 * làm lõi mô phỏng chậm ~3 lần; bản đóng gói thì nội tuyến hằng số — đúng như mã chạy trong trình duyệt,
 * nên số đo hiệu năng trong Node mới có ý nghĩa. Không cần thêm tsx/ts-node.
 *
 * Cách dùng: node scripts/run.mjs scripts/<tên>.ts [tham số...]
 * Script đích phải export hàm `main(argv: string[]): Promise<number | void>`.
 */
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const [, , script, ...args] = process.argv;
if (!script) {
  console.error('Thiếu đường dẫn script. Ví dụ: node scripts/run.mjs scripts/sim.ts --seed 42');
  process.exit(2);
}

const name = basename(script).replace(/\.ts$/, '');
const outDir = resolve('out/cli');
await build({
  configFile: false,
  logLevel: 'error',
  build: {
    ssr: resolve(script),
    outDir,
    emptyOutDir: false,
    minify: false,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: `${name}.mjs`, chunkFileNames: `${name}-[hash].mjs` } },
  },
});

const module = await import(pathToFileURL(resolve(outDir, `${name}.mjs`)).href);
if (typeof module.main !== 'function') {
  console.error(`${script} không export hàm main(argv).`);
  process.exit(2);
}
const exitCode = await module.main(args);
process.exit(typeof exitCode === 'number' ? exitCode : 0);
