// Điểm vào để đo profile: chạy bản CLI đã đóng gói (out/cli/sim.mjs) với tham số dòng lệnh.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const module = await import(pathToFileURL(resolve('out/cli/sim.mjs')).href);
await module.main(process.argv.slice(2));
