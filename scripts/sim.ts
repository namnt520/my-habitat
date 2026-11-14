/**
 * CLI chạy mô phỏng không giao diện.
 *
 *   pnpm sim --seed 42 --ticks 50000 --out report.json
 *
 * Tuỳ chọn:
 *   --seed <n>            seed (mặc định 1)
 *   --ticks <n>           số tick (mặc định 20000)
 *   --out <file>          ghi báo cáo JSON
 *   --scenario <tên>      default | lotka-volterra
 *   --species a,b,c       chỉ thả các loài động vật này
 *   --count loài=n,...    ghi đè số lượng khởi đầu
 *   --param khoá=giá,...  ghi đè tham số mô phỏng (vd. sunlight=1.2)
 *   --sample <n>          khoảng lấy mẫu chuỗi thời gian (mặc định 100)
 *   --progress <n>        in tiến độ mỗi n tick (mặc định 2000; 0 = tắt)
 *   --quiet               chỉ in một dòng tóm tắt
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SimParams } from '../src/sim/params';
import type { Scenario } from '../src/sim/simulation';
import { type RunReport, parseArgs, runSimulation } from './lib/report';

function pairs(text: string | undefined): [string, string][] {
  if (!text) return [];
  return text.split(',').map((entry) => {
    const [key, value] = entry.split('=');
    return [key, value];
  });
}

/** In bảng tóm tắt một lần chạy. */
export function printSummary(report: RunReport): void {
  const pad = (value: string | number, width: number): string => String(value).padStart(width);
  console.log(
    `\nSeed ${report.seed} · ${report.ticksRun}/${report.ticksRequested} tick · ${report.msPerTick.toFixed(3)} ms/tick · ` +
      `đỉnh ${report.peakAnimals} cá thể · hash ${report.stateHash}`,
  );
  console.log(
    `${'Loài'.padEnd(10)}${pad('đầu', 7)}${pad('cuối', 7)}${pad('min', 7)}${pad('max', 7)}${pad('TB', 7)}${pad('sinh', 8)}  P/C    chết`,
  );
  for (const species of report.animals) {
    const deaths = Object.entries(species.deaths)
      .map(([cause, count]) => `${cause} ${count}`)
      .join(', ');
    console.log(
      `${species.name.padEnd(10)}${pad(species.initial, 7)}${pad(species.final, 7)}${pad(species.min, 7)}${pad(species.max, 7)}` +
        `${pad(species.mean, 7)}${pad(species.births, 8)}  ${(species.productionEfficiency * 100).toFixed(1).padStart(4)}%  ${deaths}` +
        (species.extinctAt >= 0 ? `  ✗ TUYỆT CHỦNG @${species.extinctAt}` : ''),
    );
  }
  for (const field of report.fields) {
    console.log(
      `${field.name.padEnd(16)} đầu ${pad(field.initial, 9)} · cuối ${pad(field.final, 9)} · min ${pad(field.min, 9)}` +
        (field.extinctAt >= 0 ? `  ✗ TUYỆT CHỦNG @${field.extinctAt}` : ''),
    );
  }
  const energy = report.energy;
  console.log(
    `Năng lượng: NPP ${energy.npp.toExponential(3)} · bậc 1→2 ${(energy.efficiencyProducerToHerbivore * 100).toFixed(1)}% · ` +
      `bậc 2→3 ${(energy.efficiencyHerbivoreToCarnivore * 100).toFixed(1)}% · sai số sổ cái ${energy.maxLedgerError.toExponential(2)} · ` +
      `sai số dinh dưỡng ${energy.nutrientError.toExponential(2)}`,
  );
  console.log(
    `Săn mồi: ${report.kills.map((k) => `${k.hunter}→${k.prey} ${k.count}`).join(' · ') || '(không có)'}`,
  );
  const branches = report.speciation.lineages.filter((lineage) => lineage.parent >= 0);
  console.log(
    `Phân loài: ${report.speciation.events} sự kiện` +
      (branches.length > 0
        ? ` — ${branches.map((b) => `${b.name}@${b.bornTick}(n=${b.founders}, d=${b.distance})`).join('; ')}`
        : ''),
  );
  console.log(
    report.survived
      ? '✓ Mọi loài khởi đầu còn sống.'
      : `✗ Tuyệt chủng: ${report.extinctions.map((e) => `${e.key}@${e.tick}`).join(', ')}`,
  );
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const seed = Number(args.get('seed') ?? 1);
  const ticks = Number(args.get('ticks') ?? 20000);
  const quiet = args.has('quiet');
  const progress = Number(args.get('progress') ?? 2000);
  const params: Record<string, number | boolean> = {};
  for (const [key, value] of pairs(args.get('param')))
    params[key] = value === 'true' ? true : value === 'false' ? false : Number(value);
  const counts: Record<string, number> = {};
  for (const [key, value] of pairs(args.get('count'))) counts[key] = Number(value);

  const report = runSimulation({
    seed,
    ticks,
    scenario: (args.get('scenario') as Scenario | undefined) ?? 'default',
    species: args.get('species')?.split(','),
    counts,
    params: params as Partial<SimParams>,
    sampleEvery: Number(args.get('sample') ?? 100),
    stopOnExtinction: args.has('stop-on-extinction'),
    onSample: (frame, sim) => {
      if (quiet || progress <= 0 || frame.tick % progress !== 0) return;
      const counts = sim.registry.animals
        .filter((species) => species.def.starting)
        .map((species) => `${species.key} ${frame.populations[species.index]}`)
        .join(' · ');
      console.log(
        `t=${String(frame.tick).padStart(6)}  ${counts}  | cỏ ${(frame.fields.grass / 1e6).toFixed(2)}M quả ${(frame.fields.fruit / 1e3).toFixed(0)}k tảo ${(frame.fields.algae / 1e3).toFixed(1)}k côn trùng ${(frame.fields.insects / 1e3).toFixed(1)}k`,
      );
    },
  });

  if (quiet) {
    console.log(
      `seed ${seed}: ${report.survived ? 'OK ' : 'FAIL'} ticks ${report.ticksRun} ${report.msPerTick.toFixed(3)}ms/tick ` +
        report.animals.map((s) => `${s.key}=${s.final}`).join(' ') +
        (report.survived ? '' : ` ✗ ${report.extinctions.map((e) => `${e.key}@${e.tick}`).join(',')}`),
    );
  } else {
    printSummary(report);
  }
  const out = args.get('out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report));
    if (!quiet) console.log(`Đã ghi ${out}`);
  }
  return 0;
}
