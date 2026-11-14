/**
 * Công cụ gỡ lỗi: theo dõi vài cá thể của một loài qua thời gian và in phân bố trạng thái của cả loài.
 *
 *   node scripts/run.mjs scripts/trace.ts --species frog --ticks 1200 --every 60 --follow 3
 */
import { STATE_LABELS } from '../src/sim/entities';
import { Simulation } from '../src/sim/simulation';
import { capacityOf } from '../src/sim/actions';
import { cellAt } from '../src/sim/terrain';
import { parseArgs } from './lib/report';

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const key = args.get('species') ?? 'rabbit';
  const ticks = Number(args.get('ticks') ?? 1200);
  const every = Number(args.get('every') ?? 60);
  const follow = Number(args.get('follow') ?? 3);
  const start = Number(args.get('start') ?? 0);
  const sim = new Simulation({ seed: Number(args.get('seed') ?? 1), species: args.get('only')?.split(',') });
  const species = sim.registry.animalByKey.get(key);
  if (!species) throw new Error(`Không có loài ${key}`);
  const a = sim.animals;
  const followed: number[] = [];
  sim.run(start);
  for (let i = 0; i < a.high && followed.length < follow; i++) {
    if (a.alive[i] === 1 && a.species[i] === species.index) followed.push(a.id[i]);
  }
  for (let t = 0; t <= ticks; t += every) {
    const states = new Array<number>(STATE_LABELS.length).fill(0);
    let count = 0;
    let energy = 0;
    let water = 0;
    let juveniles = 0;
    const behaviours = new Map<string, number>();
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] === 0 || a.species[i] !== species.index) continue;
      count++;
      states[a.state[i]]++;
      energy += a.energy[i] / capacityOf(sim, i);
      water += a.water[i];
      if (a.age[i] < species.maturity) juveniles++;
      const name = a.behavior[i] === 255 ? '-' : species.behaviors[a.behavior[i]].module.name;
      behaviours.set(name, (behaviours.get(name) ?? 0) + 1);
    }
    const climate = sim.world.climate;
    console.log(
      `t=${sim.tick} n=${count} non=${juveniles} E=${(energy / Math.max(1, count)).toFixed(2)} W=${(water / Math.max(1, count)).toFixed(2)} ` +
        `T=${climate.temperatureDaily.toFixed(1)} sáng=${climate.daylight.toFixed(2)} | ` +
        states
          .map((n, s) => (n > 0 ? `${STATE_LABELS[s]} ${n}` : ''))
          .filter(Boolean)
          .join(', ') +
        ' | ' +
        [...behaviours.entries()].map(([name, n]) => `${name} ${n}`).join(', '),
    );
    for (const id of followed) {
      const i = sim.findSlot(id);
      if (i < 0) {
        console.log(`   #${id} đã chết`);
        continue;
      }
      const cell = cellAt(a.x[i], a.y[i]);
      const world = sim.world;
      console.log(
        `   #${id} ${STATE_LABELS[a.state[i]]} E=${a.energy[i].toFixed(2)}/${capacityOf(sim, i).toFixed(2)} M=${a.structure[i].toFixed(1)} W=${a.water[i].toFixed(2)} ` +
          `HP=${a.health[i].toFixed(2)} tuổi=${a.age[i]} (${a.x[i].toFixed(0)},${a.y[i].toFixed(0)}) v=${Math.hypot(a.vx[i], a.vy[i]).toFixed(2)} ` +
          `ô: sâu=${world.depthAt(cell).toFixed(3)} cỏ=${world.grass[cell].toFixed(0)} quả=${world.fruit[cell].toFixed(1)} tảo=${world.algae[cell].toFixed(2)} ` +
          `ctr=${world.insects[cell].toFixed(2)} nước=${world.waterDistance[cell]}`,
      );
    }
    sim.run(every);
  }
  return 0;
}
