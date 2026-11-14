/**
 * Bầy có danh tính (sói): theo dõi quy mô và tâm bầy, mục tiêu săn chung, việc tách bầy và lập bầy mới.
 *
 * Quy tắc xã hội (đều tất định theo thứ tự khe + RNG chung):
 *  - Bầy đông hơn `packMax`: con trưởng thành có thể tách ra đi một mình (ít gắn bó thì dễ tách hơn).
 *  - Hai con đơn độc khác giới, cùng phân loài, gặp nhau: lập bầy mới.
 *  - Con đơn độc gặp bầy còn chỗ: nhập bầy (ưu tiên bầy đang thiếu con trưởng thành thuộc giới của nó).
 * (Giao phối không bị giới hạn trong bầy — xem module `mate` — nên bầy toàn một giới không cần tan rã.)
 */
import { MAX_GENES } from './constants';
import { isAdult } from './reproduction';
import type { Simulation } from './simulation';

/** Bán kính để một con đơn độc nhập vào bầy đang thiếu giới của nó (u). */
const JOIN_RADIUS = 220;

export class GroupTable {
  /** Số bầy đã từng tạo (mã bầy không tái dùng). */
  count = 0;
  size = new Int32Array(64);
  centerX = new Float32Array(64);
  centerY = new Float32Array(64);
  private adultMales = new Int32Array(64);
  private adultFemales = new Int32Array(64);
  private target = new Int32Array(64).fill(-1);
  private targetId = new Uint32Array(64);
  private targetTick = new Int32Array(64);
  private sumX = new Float64Array(64);
  private sumY = new Float64Array(64);
  /** Xác con mồi gần nhất mà bầy hạ được (khe + mã định danh), để cả bầy cùng tới ăn. */
  private kill = new Int32Array(64).fill(-1);
  private killId = new Uint32Array(64);

  /** Tạo một bầy mới và trả về mã bầy. */
  create(): number {
    if (this.count >= this.size.length) {
      const grow = <T extends Int32Array | Float32Array | Uint32Array | Float64Array>(old: T): T => {
        const next = new (old.constructor as new (n: number) => T)(old.length * 2);
        next.set(old as never);
        return next;
      };
      const oldLength = this.target.length;
      this.size = grow(this.size);
      this.centerX = grow(this.centerX);
      this.centerY = grow(this.centerY);
      this.adultMales = grow(this.adultMales);
      this.adultFemales = grow(this.adultFemales);
      this.target = grow(this.target);
      this.target.fill(-1, oldLength);
      this.targetId = grow(this.targetId);
      this.targetTick = grow(this.targetTick);
      this.sumX = grow(this.sumX);
      this.sumY = grow(this.sumY);
      this.kill = grow(this.kill);
      this.kill.fill(-1, oldLength);
      this.killId = grow(this.killId);
    }
    return this.count++;
  }

  /** Đặt mục tiêu săn chung của bầy. */
  setHuntTarget(group: number, prey: number, preyId: number, tick: number): void {
    this.target[group] = prey;
    this.targetId[group] = preyId;
    this.targetTick[group] = tick;
  }

  /** Khe của con mồi mà bầy đang săn (còn sống, còn mới), hoặc −1. */
  huntTarget(group: number, tick: number, maxAge: number): number {
    const prey = this.target[group];
    if (prey < 0 || tick - this.targetTick[group] > maxAge) return -1;
    return prey;
  }

  /** Báo cho bầy biết vừa hạ được mồi (xác ở khe `corpse`). */
  setKill(group: number, corpse: number, corpseId: number): void {
    this.kill[group] = corpse;
    this.killId[group] = corpseId;
  }

  /** Khe của xác con mồi bầy vừa hạ nếu nó còn đó, ngược lại −1. */
  sharedKill(sim: Simulation, group: number): number {
    const corpse = this.kill[group];
    if (corpse < 0) return -1;
    if (sim.corpses.alive[corpse] === 0 || sim.corpses.id[corpse] !== this.killId[group]) {
      this.kill[group] = -1;
      return -1;
    }
    return corpse;
  }

  /** Tính lại quy mô/tâm bầy và áp dụng các quy tắc tách–lập bầy. */
  update(sim: Simulation): void {
    const a = sim.animals;
    const species = sim.registry.animals;
    const rng = sim.rng;
    this.size.fill(0);
    this.adultMales.fill(0);
    this.adultFemales.fill(0);
    this.sumX.fill(0);
    this.sumY.fill(0);
    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] === 0) continue;
      const group = a.group[i];
      if (group < 0) continue;
      this.size[group]++;
      this.sumX[group] += a.x[i];
      this.sumY[group] += a.y[i];
      if (isAdult(sim, i)) {
        if (a.sex[i] === 1) this.adultMales[group]++;
        else this.adultFemales[group]++;
      }
    }
    for (let group = 0; group < this.count; group++) {
      if (this.size[group] > 0) {
        this.centerX[group] = this.sumX[group] / this.size[group];
        this.centerY[group] = this.sumY[group] / this.size[group];
      }
      // Mục tiêu săn chung hết hiệu lực nếu con mồi đã chết hoặc khe đã về tay cá thể khác.
      const prey = this.target[group];
      if (prey >= 0 && (a.alive[prey] === 0 || a.id[prey] !== this.targetId[group])) this.target[group] = -1;
    }

    for (let i = 0; i < a.high; i++) {
      if (a.alive[i] === 0) continue;
      const sp = species[a.species[i]];
      if (!sp.usesGroups || !isAdult(sim, i)) continue;
      const group = a.group[i];
      const male = a.sex[i] === 1;
      if (group >= 0) {
        const affinity = sp.gSocial >= 0 ? a.phenotype[i * MAX_GENES + sp.gSocial] : 0.5;
        const leave =
          this.size[group] > sp.packMax && a.gestation[i] === 0 && rng.next() < 0.3 * (1.2 - affinity);
        if (leave) {
          a.group[i] = -1;
          a.homeX[i] = a.x[i];
          a.homeY[i] = a.y[i];
          this.size[group]--;
          if (male) this.adultMales[group]--;
          else this.adultFemales[group]--;
        }
        continue;
      }

      // Con đơn độc: tìm con đơn độc khác giới để lập bầy, hoặc bầy đang thiếu giới của mình để nhập.
      const members = sim.members;
      const range2 = sp.mateRange * sp.mateRange;
      let partner = -1;
      let best2 = range2;
      let joinGroup = -1;
      let join2 = JOIN_RADIUS * JOIN_RADIUS;
      for (let k = members.start[sp.index]; k < members.start[sp.index + 1]; k++) {
        const j = members.items[k];
        if (j === i || a.alive[j] === 0 || a.lineage[j] !== a.lineage[i]) continue;
        const dx = a.x[j] - a.x[i];
        const dy = a.y[j] - a.y[i];
        const d2 = dx * dx + dy * dy;
        const other = a.group[j];
        if (other < 0) {
          if (d2 < best2 && a.sex[j] !== a.sex[i] && isAdult(sim, j)) {
            best2 = d2;
            partner = j;
          }
        } else if (this.size[other] < sp.packMax) {
          // Bầy thiếu giới của mình được coi như "gần hơn" một nửa.
          const needed = (male ? this.adultMales[other] : this.adultFemales[other]) === 0;
          const score = needed ? d2 * 0.25 : d2;
          if (score < join2) {
            join2 = score;
            joinGroup = other;
          }
        }
      }
      if (partner >= 0) {
        const created = this.create();
        a.group[i] = created;
        a.group[partner] = created;
        const homeX = (a.x[i] + a.x[partner]) / 2;
        const homeY = (a.y[i] + a.y[partner]) / 2;
        a.homeX[i] = a.homeX[partner] = homeX;
        a.homeY[i] = a.homeY[partner] = homeY;
        this.size[created] = 2;
        this.centerX[created] = homeX;
        this.centerY[created] = homeY;
        this.adultMales[created] = 1;
        this.adultFemales[created] = 1;
      } else if (joinGroup >= 0) {
        a.group[i] = joinGroup;
        a.homeX[i] = this.centerX[joinGroup];
        a.homeY[i] = this.centerY[joinGroup];
        this.size[joinGroup]++;
        if (male) this.adultMales[joinGroup]++;
        else this.adultFemales[joinGroup]++;
      }
    }
  }
}
