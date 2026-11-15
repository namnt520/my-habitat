/**
 * Chế độ thí nghiệm ở dạng dòng lệnh: chạy kịch bản con mồi–kẻ săn, khớp tham số Lotka–Volterra từ chuỗi
 * thời gian đo được, giải hệ phương trình bằng RK4 và so sánh.
 *
 *   pnpm lv --seed 7 --ticks 48000 --out docs/data/lotka-volterra
 *
 * Xuất: <out>.csv (tick, thỏ, cáo, thỏ L–V, cáo L–V), <out>.json (tham số, chỉ số so sánh), <out>.svg (biểu đồ).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fitLotkaVolterra, integrateLotkaVolterra } from '../src/analysis/lotka';
import { Simulation } from '../src/sim/simulation';
import { parseArgs } from './lib/report';

/** Các đỉnh cục bộ của một chuỗi đã làm mượt (trả về chỉ số mẫu). */
function peaks(values: number[], window: number): number[] {
  const smooth = values.map((_, k) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, k - window); j <= Math.min(values.length - 1, k + window); j++) {
      sum += values[j];
      n++;
    }
    return sum / n;
  });
  const result: number[] = [];
  const reach = window * 4;
  for (let k = reach; k < smooth.length - reach; k++) {
    let isPeak = true;
    for (let j = k - reach; j <= k + reach && isPeak; j++) if (smooth[j] > smooth[k]) isPeak = false;
    if (isPeak && (result.length === 0 || k - result[result.length - 1] > reach)) result.push(k);
  }
  return result;
}

function polyline(
  time: number[],
  values: number[],
  toX: (t: number) => number,
  toY: (v: number) => number,
): string {
  return values.map((value, k) => `${toX(time[k]).toFixed(1)},${toY(value).toFixed(1)}`).join(' ');
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const seed = Number(args.get('seed') ?? 7);
  const ticks = Number(args.get('ticks') ?? 48000);
  const every = Number(args.get('sample') ?? 100);
  const out = args.get('out') ?? 'out/lotka-volterra';

  const sim = new Simulation({ seed, scenario: 'lotka-volterra' });
  const rabbit = sim.registry.animalByKey.get('rabbit')!.index;
  const fox = sim.registry.animalByKey.get('fox')!.index;
  const time: number[] = [];
  const prey: number[] = [];
  const predator: number[] = [];
  const started = performance.now();
  for (let tick = 0; tick <= ticks; tick += every) {
    const counts = sim.populations();
    time.push(sim.tick);
    prey.push(counts[rabbit]);
    predator.push(counts[fox]);
    if (counts[rabbit] === 0 || counts[fox] === 0) break;
    sim.run(every);
  }
  const wall = performance.now() - started;

  const fit = fitLotkaVolterra(time, prey, predator, 8);
  if (!fit) {
    console.log('Không đủ dữ liệu để khớp Lotka–Volterra.');
    return 1;
  }
  const model = integrateLotkaVolterra(fit, prey[0], predator[0], time);

  // Chu kỳ đo được: khoảng cách trung bình giữa các đỉnh của thỏ; độ trễ pha: đỉnh cáo sau đỉnh thỏ bao lâu.
  const preyPeaks = peaks(prey, 6);
  const predatorPeaks = peaks(predator, 6);
  const gaps = preyPeaks.slice(1).map((index, k) => time[index] - time[preyPeaks[k]]);
  const observedPeriod = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : NaN;
  const lags = preyPeaks
    .map((index) => {
      const next = predatorPeaks.find((p) => p > index);
      return next === undefined ? NaN : time[next] - time[index];
    })
    .filter((lag) => !Number.isNaN(lag));
  const lag = lags.length > 0 ? lags.reduce((a, b) => a + b, 0) / lags.length : NaN;
  const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
  const summary = {
    seed,
    ticks: sim.tick,
    msPerTick: wall / Math.max(1, sim.tick),
    fit,
    observed: {
      periodTicks: observedPeriod,
      predatorLagTicks: lag,
      lagFractionOfPeriod: lag / observedPeriod,
      preyMean: mean(prey),
      predatorMean: mean(predator),
      preyRange: [Math.min(...prey), Math.max(...prey)],
      predatorRange: [Math.min(...predator), Math.max(...predator)],
      preyPeakTicks: preyPeaks.map((index) => time[index]),
      predatorPeakTicks: predatorPeaks.map((index) => time[index]),
    },
    lotkaVolterra: {
      periodTicks: fit.period,
      preyEquilibrium: fit.preyEquilibrium,
      predatorEquilibrium: fit.predatorEquilibrium,
      lagFractionOfPeriod: 0.25,
      preyRange: [Math.min(...model.prey), Math.max(...model.prey)],
      predatorRange: [Math.min(...model.predator), Math.max(...model.predator)],
    },
    energyAudit: sim.audit().maxEnergyError,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    `${out}.csv`,
    [
      'tick,rabbits,foxes,lv_rabbits,lv_foxes',
      ...time.map(
        (t, k) =>
          `${t},${prey[k]},${predator[k]},${model.prey[k].toFixed(1)},${model.predator[k].toFixed(1)}`,
      ),
    ].join('\n'),
  );
  writeFileSync(`${out}.json`, JSON.stringify(summary, null, 2));

  // Biểu đồ SVG: thỏ (trục trái) và cáo (trục phải), mô phỏng nét liền, Lotka–Volterra nét đứt.
  const W = 920;
  const H = 380;
  const pad = { left: 56, right: 56, top: 28, bottom: 40 };
  const maxPrey = Math.max(...prey, ...model.prey.map((v) => Math.min(v, Math.max(...prey) * 1.6))) * 1.05;
  const maxPredator =
    Math.max(...predator, ...model.predator.map((v) => Math.min(v, Math.max(...predator) * 1.6))) * 1.05;
  const toX = (t: number): number => pad.left + (t / time[time.length - 1]) * (W - pad.left - pad.right);
  const yPrey = (v: number): number =>
    pad.top + (1 - Math.min(v, maxPrey) / maxPrey) * (H - pad.top - pad.bottom);
  const yPredator = (v: number): number =>
    pad.top + (1 - Math.min(v, maxPredator) / maxPredator) * (H - pad.top - pad.bottom);
  const years = Math.floor(time[time.length - 1] / 2400);
  const grid = Array.from(
    { length: years + 1 },
    (_, y) =>
      `<line x1="${toX(y * 2400).toFixed(1)}" y1="${pad.top}" x2="${toX(y * 2400).toFixed(1)}" y2="${H - pad.bottom}" stroke="#e3e3e3"/>` +
      (y % 2 === 0
        ? `<text x="${toX(y * 2400).toFixed(1)}" y="${H - pad.bottom + 16}" font-size="11" text-anchor="middle" fill="#555">${y}</text>`
        : ''),
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">
<rect width="${W}" height="${H}" fill="#fff"/>
${grid}
<text x="${W / 2}" y="${H - 6}" font-size="12" text-anchor="middle" fill="#333">Thời gian (năm mô phỏng; 1 năm = 2400 tick) — seed ${seed}</text>
<text x="${pad.left}" y="16" font-size="12" fill="#b07a2a">Thỏ (trục trái, 0–${Math.round(maxPrey)})</text>
<text x="${W - pad.right}" y="16" font-size="12" text-anchor="end" fill="#d6521a">Cáo (trục phải, 0–${Math.round(maxPredator)})</text>
<text x="${W / 2}" y="16" font-size="12" text-anchor="middle" fill="#333">nét liền: mô phỏng · nét đứt: Lotka–Volterra đã khớp</text>
<polyline fill="none" stroke="#b07a2a" stroke-width="2" points="${polyline(time, prey, toX, yPrey)}"/>
<polyline fill="none" stroke="#d6521a" stroke-width="2" points="${polyline(time, predator, toX, yPredator)}"/>
<polyline fill="none" stroke="#b07a2a" stroke-width="1.4" stroke-dasharray="6 4" points="${polyline(time, model.prey, toX, yPrey)}"/>
<polyline fill="none" stroke="#d6521a" stroke-width="1.4" stroke-dasharray="6 4" points="${polyline(time, model.predator, toX, yPredator)}"/>
<rect x="${pad.left}" y="${pad.top}" width="${W - pad.left - pad.right}" height="${H - pad.top - pad.bottom}" fill="none" stroke="#999"/>
</svg>`;
  writeFileSync(`${out}.svg`, svg);

  console.log(`Seed ${seed} · ${sim.tick} tick · ${summary.msPerTick.toFixed(2)} ms/tick`);
  console.log(
    `Khớp L–V: α=${fit.alpha.toExponential(3)} β=${fit.beta.toExponential(3)} δ=${fit.delta.toExponential(3)} γ=${fit.gamma.toExponential(3)} · R² thỏ ${fit.r2Prey.toFixed(2)}, cáo ${fit.r2Predator.toFixed(2)}`,
  );
  console.log(
    `Chu kỳ: đo được ${observedPeriod.toFixed(0)} tick · L–V (dao động nhỏ) ${fit.period.toFixed(0)} tick`,
  );
  console.log(
    `Độ trễ đỉnh cáo sau đỉnh thỏ: ${lag.toFixed(0)} tick = ${(summary.observed.lagFractionOfPeriod * 100).toFixed(0)}% chu kỳ (L–V: 25%)`,
  );
  console.log(
    `Trung bình: thỏ ${summary.observed.preyMean.toFixed(0)} (N* L–V = ${fit.preyEquilibrium.toFixed(0)}) · cáo ${summary.observed.predatorMean.toFixed(0)} (P* L–V = ${fit.predatorEquilibrium.toFixed(0)})`,
  );
  console.log(
    `Biên độ thỏ: mô phỏng ${summary.observed.preyRange.join('–')} · L–V ${summary.lotkaVolterra.preyRange.map((v) => v.toFixed(0)).join('–')}`,
  );
  console.log(
    `Biên độ cáo: mô phỏng ${summary.observed.predatorRange.join('–')} · L–V ${summary.lotkaVolterra.predatorRange.map((v) => v.toFixed(0)).join('–')}`,
  );
  console.log(`Đã ghi ${out}.csv, ${out}.json, ${out}.svg`);
  return 0;
}
