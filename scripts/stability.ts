/**
 * Test ổn định: chạy nhiều seed song song (mỗi seed một worker thread) và in bảng kết quả.
 *
 *   pnpm stability                         # 20 seed × 20.000 tick
 *   pnpm stability --seeds 1-8 --ticks 6000 --out out/stability.json
 *
 * Tuỳ chọn: --seeds a-b | a,b,c   --ticks n   --jobs n   --out file   --param k=v,...   --detail (in bảng từng seed)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { SimParams } from '../src/sim/params';
import { type RunReport, parseArgs, runSimulation } from './lib/report';
import { printSummary } from './sim';

interface Job {
  seed: number;
  ticks: number;
  params: Partial<SimParams>;
}

// Khi file này được nạp trong worker thread, nó chạy một seed rồi gửi báo cáo về luồng chính.
if (!isMainThread && workerData && typeof (workerData as Job).seed === 'number') {
  const job = workerData as Job;
  const report = runSimulation({ seed: job.seed, ticks: job.ticks, params: job.params, sampleEvery: 100 });
  parentPort!.postMessage(report);
}

function parseSeeds(text: string): number[] {
  if (text.includes('-')) {
    const [from, to] = text.split('-').map(Number);
    return Array.from({ length: to - from + 1 }, (_, k) => from + k);
  }
  return text.split(',').map(Number);
}

function runJob(job: Job): Promise<RunReport> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: job });
    worker.once('message', (report: RunReport) => resolve(report));
    worker.once('error', reject);
  });
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const seeds = parseSeeds(args.get('seeds') ?? '1-20');
  const ticks = Number(args.get('ticks') ?? 20000);
  const jobs = Number(args.get('jobs') ?? Math.max(1, availableParallelism() - 2));
  const params: Record<string, number | boolean> = {};
  for (const entry of (args.get('param') ?? '').split(',').filter(Boolean)) {
    const [key, value] = entry.split('=');
    params[key] = value === 'true' ? true : value === 'false' ? false : Number(value);
  }

  const started = Date.now();
  const reports: RunReport[] = [];
  const queue = [...seeds];
  await Promise.all(
    Array.from({ length: Math.min(jobs, seeds.length) }, async () => {
      for (let seed = queue.shift(); seed !== undefined; seed = queue.shift()) {
        const report = await runJob({ seed, ticks, params: params as Partial<SimParams> });
        reports.push(report);
        if (args.has('detail')) printSummary(report);
        const line = report.animals
          .map((s) => `${s.key.slice(0, 3)} ${String(s.final).padStart(4)}`)
          .join(' ');
        console.log(
          `seed ${String(seed).padStart(3)} ${report.survived ? '✓' : '✗'} ${String(report.ticksRun).padStart(6)}t ${report.msPerTick.toFixed(2)}ms đỉnh ${String(report.peakAnimals).padStart(5)} | ${line}` +
            (report.survived ? '' : `  ✗ ${report.extinctions.map((e) => `${e.key}@${e.tick}`).join(', ')}`),
        );
      }
    }),
  );
  reports.sort((p, q) => p.seed - q.seed);

  const keys = reports[0].animals.map((species) => species.key);
  const passed = reports.filter((report) => report.survived).length;
  console.log(
    `\n── Tổng kết: ${passed}/${reports.length} seed qua ${ticks} tick mà không loài nào tuyệt chủng (${((Date.now() - started) / 1000).toFixed(0)} s) ──`,
  );
  console.log(
    `${'loài'.padEnd(9)}${'min mọi seed'.padStart(13)}${'TB cuối'.padStart(9)}${'TB trung bình'.padStart(15)}  số seed tuyệt chủng`,
  );
  for (const key of keys) {
    const rows = reports.map((report) => report.animals.find((species) => species.key === key)!);
    const min = Math.min(...rows.map((row) => row.min));
    const final = rows.reduce((sum, row) => sum + row.final, 0) / rows.length;
    const mean = rows.reduce((sum, row) => sum + row.mean, 0) / rows.length;
    const extinct = rows.filter((row) => row.extinctAt >= 0).length;
    console.log(
      `${key.padEnd(9)}${String(min).padStart(13)}${final.toFixed(0).padStart(9)}${mean.toFixed(0).padStart(15)}  ${extinct > 0 ? `${extinct} ✗` : '0'}`,
    );
  }
  const eff12 =
    reports.reduce((sum, report) => sum + report.energy.efficiencyProducerToHerbivore, 0) / reports.length;
  const eff23 =
    reports.reduce((sum, report) => sum + report.energy.efficiencyHerbivoreToCarnivore, 0) / reports.length;
  const maxError = Math.max(...reports.map((report) => report.energy.maxLedgerError));
  const speciations = reports.reduce((sum, report) => sum + report.speciation.events, 0);
  console.log(
    `Tiêu thụ bậc 1→2: ${(eff12 * 100).toFixed(1)}% · bậc 2→3: ${(eff23 * 100).toFixed(1)}% · sai số sổ cái lớn nhất ${maxError.toExponential(1)} · ` +
      `${speciations} sự kiện phân loài · ${(reports.reduce((s, r) => s + r.msPerTick, 0) / reports.length).toFixed(2)} ms/tick`,
  );

  const out = args.get('out');
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    // Bỏ chuỗi thời gian chi tiết khỏi file tổng hợp cho gọn (chạy `pnpm sim --seed N --out …` để có đủ).
    writeFileSync(
      out,
      JSON.stringify(
        reports.map((report) => ({
          ...report,
          series: undefined,
          energy: { ...report.energy, flows: undefined },
        })),
        null,
        1,
      ),
    );
    console.log(`Đã ghi ${out}`);
  }
  return passed === reports.length ? 0 : 1;
}
