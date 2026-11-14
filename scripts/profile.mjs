/**
 * In các hàm tốn thời gian nhất từ một file .cpuprofile của Node.
 *   node --cpu-prof --cpu-prof-dir=out/prof out/cli/sim.mjs ... ; node scripts/profile.mjs out/prof
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'out/prof';
const file = readdirSync(dir)
  .filter((name) => name.endsWith('.cpuprofile'))
  .sort()
  .pop();
const profile = JSON.parse(readFileSync(join(dir, file), 'utf8'));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const self = new Map();
let total = 0;
profile.samples.forEach((id, index) => {
  const frame = nodes.get(id).callFrame;
  const key = `${frame.functionName || '(anonymous)'}:${frame.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + profile.timeDeltas[index]);
  total += profile.timeDeltas[index];
});
for (const [key, time] of [...self.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, Number(process.argv[3] ?? 25))) {
  console.log(`${((time / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
}
