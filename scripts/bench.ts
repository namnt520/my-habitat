/**
 * Đo hiệu năng lõi mô phỏng trong Node: thời gian mỗi tick theo quy mô quần thể và theo từng hệ con.
 *
 *   pnpm bench [--seed 42] [--ticks 3000] [--out docs/data/bench.json]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname } from 'node:path';
import { Simulation } from '../src/sim/simulation';
import { SPECIES_DATA } from '../src/species/data';
import { parseArgs } from './lib/report';

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const seed = Number(args.get('seed') ?? 42);
  const ticks = Number(args.get('ticks') ?? 3000);
  const machine = `${cpus()[0].model} · ${cpus().length} nhân · ${(totalmem() / 2 ** 30).toFixed(0)} GB RAM · Node ${process.version}`;
  console.log(machine);

  // 1. Chạy mặc định: thời gian mỗi tick theo từng hệ con.
  const sim = new Simulation({ seed });
  sim.enableProfiling(() => performance.now());
  const windows: { tick: number; animals: number; msPerTick: number }[] = [];
  let windowStart = performance.now();
  for (let t = 0; t < ticks; t++) {
    sim.step();
    if (sim.tick % 250 === 0) {
      const now = performance.now();
      windows.push({ tick: sim.tick, animals: sim.animals.count, msPerTick: (now - windowStart) / 250 });
      windowStart = now;
    }
  }
  const p = sim.profile!;
  const total = p.environment + p.indexes + p.fields + p.animals + p.other;
  const breakdown = {
    environment: p.environment / p.ticks,
    indexes: p.indexes / p.ticks,
    fields: p.fields / p.ticks,
    animals: p.animals / p.ticks,
    other: p.other / p.ticks,
    total: total / p.ticks,
  };
  console.log(`\nSeed ${seed}, ${ticks} tick — trung bình ${breakdown.total.toFixed(3)} ms/tick`);
  for (const [name, label] of [
    ['animals', 'động vật (giác quan, hành vi, di chuyển)'],
    ['fields', 'trường (cỏ, bụi, tảo, côn trùng, nấm, N)'],
    ['indexes', 'dựng spatial hash + danh sách loài'],
    ['other', 'xác, bầy, phân loài'],
    ['environment', 'khí hậu, thời tiết'],
  ] as const) {
    console.log(
      `  ${label.padEnd(44)} ${breakdown[name].toFixed(3)} ms  ${((breakdown[name] / breakdown.total) * 100).toFixed(0).padStart(3)}%`,
    );
  }
  console.log('\n  tick   số cá thể   ms/tick   µs/cá thể');
  for (const w of windows) {
    console.log(
      `  ${String(w.tick).padStart(5)} ${String(w.animals).padStart(10)} ${w.msPerTick.toFixed(3).padStart(9)} ${((w.msPerTick * 1000) / w.animals).toFixed(3).padStart(10)}`,
    );
  }

  // 2. Thay đổi quy mô: nhân số lượng khởi đầu của mọi loài để xem chi phí tăng tuyến tính hay bậc hai.
  console.log('\nQuy mô (300 tick đầu, số lượng khởi đầu × hệ số):');
  const scaling: { factor: number; animals: number; msPerTick: number }[] = [];
  for (const factor of [0.5, 1, 2, 4, 8]) {
    const counts: Record<string, number> = {};
    for (const def of SPECIES_DATA)
      if (def.kind === 'animal' && def.starting) counts[def.key] = Math.round(def.initialCount * factor);
    const scaled = new Simulation({ seed, counts });
    scaled.run(60); // làm nóng JIT
    const start = performance.now();
    let animalTicks = 0;
    for (let t = 0; t < 300; t++) {
      scaled.step();
      animalTicks += scaled.animals.count;
    }
    const msPerTick = (performance.now() - start) / 300;
    scaling.push({ factor, animals: Math.round(animalTicks / 300), msPerTick });
    console.log(
      `  ×${String(factor).padEnd(4)} ${String(Math.round(animalTicks / 300)).padStart(7)} cá thể  ${msPerTick.toFixed(3).padStart(8)} ms/tick  ${((msPerTick * 1000) / (animalTicks / 300)).toFixed(3)} µs/cá thể`,
    );
  }

  const out = args.get('out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify({ machine, seed, ticks, breakdown, windows, scaling }, null, 2));
    console.log(`Đã ghi ${out}`);
  }
  return 0;
}
