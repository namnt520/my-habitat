/**
 * Hệ các trường mật độ: cỏ, cây bụi + quả, tảo, côn trùng, mùn bã, nấm, và dinh dưỡng trong đất.
 *
 * Mỗi tick chỉ cập nhật 1/FIELD_STRIPES số hàng của lưới (với dt = FIELD_STRIPES) để dàn đều chi phí.
 * Mọi thay đổi năng lượng được cộng dồn rồi ghi vào sổ cái một lần ở cuối hàm.
 *
 * Mô hình (xem docs/MODELS.md để biết lý do và chỗ đơn giản hoá):
 *  - Thực vật: tăng trưởng logistic × (ánh sáng theo mùa) × (nhiệt) × (ẩm) × (N đất / (N + K)).
 *    Mỗi E quang hợp rút NUTRIENT_PER_ENERGY N khỏi đất của chính ô đó.
 *  - Côn trùng: ăn cỏ theo đáp ứng chức năng Holling II; tử vong phụ thuộc mật độ; hoạt động theo nhiệt.
 *  - Nấm: hấp thụ mùn bã theo Monod; phần hô hấp thành nhiệt và trả N về đất.
 */
import {
  CELLS,
  FIELD_STRIPES,
  GRID,
  LIGHT_BASE,
  LIGHT_SEASONAL,
  HILL_LEVEL,
  MOUNTAIN_LEVEL,
  NUTRIENT_DIFFUSION_LAND,
  NUTRIENT_DIFFUSION_WATER,
  NUTRIENT_HALF_SATURATION,
  NUTRIENT_LEACHING,
  NUTRIENT_PER_ENERGY,
  TEMP_LAPSE,
} from './constants';
import { PI, clamp01, dsin } from './detmath';
import { POOL_DETRITUS, POOL_EXTERNAL, POOL_HEAT, POOL_SUN, type Ledger } from './ledger';
import type { SimParams } from './params';
import type { World } from './world';

export interface GrassParams {
  /** Tốc độ tăng trưởng nội tại (1/tick) trong điều kiện lý tưởng. */
  growthRate: number;
  /** Sức chứa (E/ô) ở đồng trống. */
  capacity: number;
  /** Tỉ lệ sinh khối ô kề đóng vai "mầm" cho ô này — cơ chế mọc lan. */
  spread: number;
  /** Tỉ lệ lụi tàn nền, thêm khi có sương giá, thêm khi khô hạn (1/tick). */
  senescence: number;
  frostLoss: number;
  droughtLoss: number;
  /** Tán rừng dày làm giảm sức chứa đi tỉ lệ này. */
  shade: number;
  /** Hệ số sức chứa trên đồi và trên núi đá. */
  hillCapacity: number;
  mountainCapacity: number;
}

export interface ShrubParams {
  growthRate: number;
  capacity: number;
  /** Sức chứa tương đối ở đồng trống và trong rừng sâu (đạt 1 ở bìa rừng). */
  meadowFraction: number;
  deepForestFraction: number;
  /** Mỗi đơn vị hạt trong ngân hàng hạt tương đương bao nhiêu E "mầm" cho tăng trưởng. */
  germination: number;
  /** Tỉ lệ hạt mất sức nảy mầm mỗi tick. */
  seedDecay: number;
  /** Tỉ lệ hạt của quả rụng rơi lại đúng ô đó. */
  localSeeding: number;
  /** Tốc độ ra quả (E quả / E cây / tick) lúc cao điểm, và lượng quả tối đa trên mỗi E cây. */
  fruitRate: number;
  fruitCapacity: number;
  /** Tỉ lệ quả rụng/thối mỗi tick. */
  fruitRot: number;
  /** Mùa quả: bắt đầu và kết thúc theo pha năm [0, 1). */
  fruitStart: number;
  fruitEnd: number;
  senescence: number;
}

export interface AlgaeParams {
  growthRate: number;
  /** Sức chứa (E/ô) ở nước rất nông. */
  capacity: number;
  spread: number;
  mortality: number;
  /** Độ sâu mà tại đó sức chứa giảm còn một nửa (thiếu sáng). */
  depthHalf: number;
}

export interface InsectParams {
  /** Lượng cỏ ăn tối đa (E cỏ / E côn trùng / tick). */
  consumption: number;
  /** Lượng thức ăn khả dụng mà tại đó tốc độ ăn bằng một nửa tối đa (E/ô). */
  halfSaturation: number;
  /** Phần gốc cỏ côn trùng không ăn tới (E/ô). */
  grassFloor: number;
  /** Phần lá cây bụi tính là thức ăn khả dụng. */
  shrubShare: number;
  assimilation: number;
  respiration: number;
  mortality: number;
  /** Tử vong phụ thuộc mật độ (1/tick cho mỗi E/ô) — bệnh, ăn thịt lẫn nhau, ký sinh. */
  crowding: number;
  frostMortality: number;
  /** Tỉ lệ chênh lệch mật độ giữa hai ô kề được san bằng mỗi tick (phát tán). */
  dispersal: number;
  /** Dưới activityMin °C côn trùng bất động; từ activityFull °C trở lên hoạt động tối đa. */
  activityMin: number;
  activityFull: number;
}

export interface FungiParams {
  /** Tốc độ hấp thụ mùn tối đa (E mùn / E nấm / tick). */
  uptake: number;
  halfSaturation: number;
  /** Tỉ lệ mùn hấp thụ thành sinh khối nấm; phần còn lại hô hấp thành nhiệt. */
  efficiency: number;
  respiration: number;
  spread: number;
  /** Tốc độ khoáng hoá mùn dưới nước bởi vi sinh vật không được mô phỏng riêng (1/tick). */
  aquaticDecay: number;
}

export interface FieldParams {
  grass: GrassParams;
  shrub: ShrubParams;
  algae: AlgaeParams;
  insects: InsectParams;
  fungi: FungiParams;
}

/** Chỉ số kho trong sổ cái của 5 loài dạng trường. */
export interface FieldPools {
  grass: number;
  shrub: number;
  algae: number;
  insects: number;
  fungi: number;
}

/** Sức chứa cỏ tương đối của một ô theo địa hình (chưa nhân với capacity). */
function grassHabitat(elevation: number, canopy: number, p: GrassParams): number {
  let quality = 1 - p.shade * canopy;
  if (elevation > MOUNTAIN_LEVEL) quality *= p.mountainCapacity;
  else if (elevation > HILL_LEVEL) {
    quality *= 1 - (1 - p.hillCapacity) * ((elevation - HILL_LEVEL) / (MOUNTAIN_LEVEL - HILL_LEVEL));
  }
  return quality;
}

/** Sức chứa cây bụi tương đối: cao nhất ở bìa rừng (tán ~0,5). */
function shrubHabitat(elevation: number, canopy: number, p: ShrubParams): number {
  if (elevation > MOUNTAIN_LEVEL) return 0;
  const edge =
    canopy < 0.5
      ? p.meadowFraction + (1 - p.meadowFraction) * (canopy / 0.5)
      : 1 + (p.deepForestFraction - 1) * ((canopy - 0.5) / 0.5);
  return elevation > HILL_LEVEL ? edge * 0.6 : edge;
}

/** Đặt trạng thái ban đầu cho các trường và ghi năng lượng khởi tạo vào sổ cái (nguồn: bên ngoài). */
export function initFields(
  world: World,
  fp: FieldParams,
  pools: FieldPools,
  ledger: Ledger,
  include: { shrubs: boolean; insects: boolean },
): void {
  const { elevation, canopy } = world.terrain;
  const level = world.climate.waterLevel;
  let grass = 0;
  let shrub = 0;
  let algae = 0;
  let insects = 0;
  let fungi = 0;
  let detritus = 0;
  for (let c = 0; c < CELLS; c++) {
    const e = elevation[c];
    if (e < level) {
      world.algae[c] = (0.5 * fp.algae.capacity) / (1 + (level - e) / fp.algae.depthHalf);
      algae += world.algae[c];
      continue;
    }
    world.grass[c] = 0.55 * fp.grass.capacity * grassHabitat(e, canopy[c], fp.grass);
    if (include.shrubs) world.shrub[c] = 0.5 * fp.shrub.capacity * shrubHabitat(e, canopy[c], fp.shrub);
    if (e < MOUNTAIN_LEVEL) {
      if (include.insects) world.insects[c] = 0.5;
      world.fungi[c] = 4;
      world.detritus[c] = 30;
    }
    grass += world.grass[c];
    shrub += world.shrub[c];
    insects += world.insects[c];
    fungi += world.fungi[c];
    detritus += world.detritus[c];
  }
  ledger.flow(POOL_EXTERNAL, pools.grass, grass);
  ledger.flow(POOL_EXTERNAL, pools.shrub, shrub);
  ledger.flow(POOL_EXTERNAL, pools.algae, algae);
  ledger.flow(POOL_EXTERNAL, pools.insects, insects);
  ledger.flow(POOL_EXTERNAL, pools.fungi, fungi);
  ledger.flow(POOL_EXTERNAL, POOL_DETRITUS, detritus);
}

/** Cập nhật một dải hàng của lưới trường cho tick hiện tại. */
export function updateFields(
  world: World,
  tick: number,
  params: SimParams,
  fp: FieldParams,
  pools: FieldPools,
  ledger: Ledger,
): void {
  const { elevation, canopy, downhill } = world.terrain;
  const { soilN, grass, shrub, fruit, seedBank, algae, insects, detritus, fungi, waterDistance } = world;
  const climate = world.climate;
  const dt = FIELD_STRIPES;
  const level = climate.waterLevel;
  const wet = climate.soilWetness;
  const rain = climate.rain;
  const airTemp = climate.temperatureDaily;
  const waterTemp = climate.temperatureWater;
  // Ánh sáng hữu hiệu theo mùa (độ dài ngày + góc mặt trời).
  const light = params.sunlight * (LIGHT_BASE + LIGHT_SEASONAL * climate.seasonal);
  const rho = NUTRIENT_PER_ENERGY;

  const g = fp.grass;
  const s = fp.shrub;
  const al = fp.algae;
  const ins = fp.insects;
  const fu = fp.fungi;

  // Cường độ ra quả theo mùa: hình sin giữa fruitStart và fruitEnd.
  const phase = climate.yearPhase;
  const fruiting =
    params.seasons && (phase <= s.fruitStart || phase >= s.fruitEnd)
      ? 0
      : params.seasons
        ? dsin((PI * (phase - s.fruitStart)) / (s.fruitEnd - s.fruitStart))
        : 0.6;
  const waterGrowth = clamp01((waterTemp - 1) / 11);

  let sunGrass = 0;
  let sunShrub = 0;
  let sunAlgae = 0;
  let grassLitter = 0;
  let shrubLitter = 0;
  let algaeLitter = 0;
  let grassToInsects = 0;
  let shrubToInsects = 0;
  let insectsToDetritus = 0;
  let insectsToHeat = 0;
  let detritusToFungi = 0;
  let fungiToHeat = 0;
  let detritusToHeat = 0;
  let uptake = 0;
  let returned = 0;

  const stripe = tick % FIELD_STRIPES;
  for (let cy = stripe; cy < GRID; cy += FIELD_STRIPES) {
    const row = cy * GRID;
    for (let cx = 0; cx < GRID; cx++) {
      const c = row + cx;
      const e = elevation[c];
      const depth = level - e;
      let n = soilN[c];
      let d = detritus[c];
      const left = cx > 0 ? c - 1 : c;
      const right = cx < GRID - 1 ? c + 1 : c;
      const up = cy > 0 ? c - GRID : c;
      const down = cy < GRID - 1 ? c + GRID : c;

      if (depth > 0) {
        // ── Ô nước ──
        // Sinh vật trên cạn bị ngập chết dần thành mùn.
        if (grass[c] > 0 || shrub[c] > 0 || fruit[c] > 0 || insects[c] > 0 || fungi[c] > 0) {
          const drown = 0.4;
          const dg = grass[c] * drown;
          const ds = (shrub[c] + fruit[c]) * drown;
          const di = insects[c] * drown;
          const df = fungi[c] * drown;
          grass[c] -= dg;
          shrub[c] -= shrub[c] * drown;
          fruit[c] -= fruit[c] * drown;
          insects[c] -= di;
          fungi[c] -= df;
          if (grass[c] < 0.01) {
            grassLitter += grass[c];
            d += grass[c];
            grass[c] = 0;
          }
          if (shrub[c] + fruit[c] < 0.01) {
            shrubLitter += shrub[c] + fruit[c];
            d += shrub[c] + fruit[c];
            shrub[c] = 0;
            fruit[c] = 0;
          }
          if (insects[c] < 0.001) {
            insectsToDetritus += insects[c];
            d += insects[c];
            insects[c] = 0;
          }
          if (fungi[c] < 0.001) {
            // Nấm chết được tính là hô hấp cuối cùng: năng lượng thành nhiệt, N về nước.
            fungiToHeat += fungi[c];
            n += rho * fungi[c];
            returned += rho * fungi[c];
            fungi[c] = 0;
          }
          grassLitter += dg;
          shrubLitter += ds;
          insectsToDetritus += di;
          fungiToHeat += df;
          n += rho * df;
          returned += rho * df;
          d += dg + ds + di;
        }

        let a = algae[c];
        const capacity = al.capacity / (1 + depth / al.depthHalf);
        const neighbours = 0.25 * (algae[left] + algae[right] + algae[up] + algae[down]);
        const nutrient = n / (n + NUTRIENT_HALF_SATURATION);
        let growth =
          al.growthRate *
          light *
          waterGrowth *
          nutrient *
          (a + al.spread * neighbours) *
          (1 - a / capacity) *
          dt;
        if (growth > 0) {
          const byNutrient = (0.5 * n) / rho;
          if (growth > byNutrient) growth = byNutrient;
          a += growth;
          n -= rho * growth;
          sunAlgae += growth;
          uptake += rho * growth;
        }
        const loss = Math.min(a, al.mortality * a * dt + (a > capacity ? 0.2 * (a - capacity) : 0));
        a -= loss;
        d += loss;
        algaeLitter += loss;
        algae[c] = a;

        const decay = fu.aquaticDecay * d * dt * (0.3 + 0.7 * waterGrowth);
        d -= decay;
        detritusToHeat += decay;
        n += rho * decay;
        returned += rho * decay;
      } else {
        // ── Ô đất ──
        if (algae[c] > 0) {
          // Hồ cạn: tảo mắc cạn chết thành mùn.
          d += algae[c];
          algaeLitter += algae[c];
          algae[c] = 0;
        }
        const temperature = airTemp - TEMP_LAPSE * (e > 0.5 ? e - 0.5 : 0);
        const wd = waterDistance[c];
        const moisture = clamp01(wet * (1.2 - 0.5 * e) + (wd < 10 ? 0.45 * (1 - wd / 10) : 0));
        const warmth = clamp01((temperature + 2) / 14);
        const moist = (1.25 * moisture) / (moisture + 0.25);
        const nutrient = n / (n + NUTRIENT_HALF_SATURATION);
        const vigour = light * warmth * moist * nutrient;
        const frost = temperature < 0;
        let nutrientBudget = (0.5 * n) / rho;

        // Cỏ
        let gr = grass[c];
        const grassCapacity = g.capacity * grassHabitat(e, canopy[c], g);
        if (grassCapacity > 0.5) {
          const neighbours = 0.25 * (grass[left] + grass[right] + grass[up] + grass[down]);
          let growth = g.growthRate * vigour * (gr + g.spread * neighbours) * (1 - gr / grassCapacity) * dt;
          if (growth > 0) {
            if (growth > nutrientBudget) growth = nutrientBudget;
            gr += growth;
            nutrientBudget -= growth;
            n -= rho * growth;
            sunGrass += growth;
            uptake += rho * growth;
          }
        }
        if (gr > 0) {
          let rate = g.senescence + (frost ? g.frostLoss : 0);
          if (moisture < 0.15) rate += (g.droughtLoss * (0.15 - moisture)) / 0.15;
          let loss = rate * gr * dt;
          if (gr > grassCapacity) loss += 0.2 * (gr - grassCapacity);
          if (loss > gr) loss = gr;
          gr -= loss;
          d += loss;
          grassLitter += loss;
        }

        // Cây bụi và quả
        let sh = shrub[c];
        let fr = fruit[c];
        let seeds = seedBank[c];
        const shrubCapacity = s.capacity * shrubHabitat(e, canopy[c], s);
        if (shrubCapacity > 0.5 && (sh > 0 || seeds > 0)) {
          let growth = s.growthRate * vigour * (sh + s.germination * seeds) * (1 - sh / shrubCapacity) * dt;
          if (growth > 0) {
            if (growth > nutrientBudget) growth = nutrientBudget;
            sh += growth;
            nutrientBudget -= growth;
            n -= rho * growth;
            sunShrub += growth;
            uptake += rho * growth;
          }
          if (fruiting > 0 && sh > 1) {
            let fruitGrowth =
              s.fruitRate *
              sh *
              fruiting *
              params.sunlight *
              moist *
              nutrient *
              (1 - fr / (s.fruitCapacity * sh)) *
              dt;
            if (fruitGrowth > 0) {
              if (fruitGrowth > nutrientBudget) fruitGrowth = nutrientBudget;
              fr += fruitGrowth;
              n -= rho * fruitGrowth;
              sunShrub += fruitGrowth;
              uptake += rho * fruitGrowth;
            }
          }
        }
        if (seeds > 0) seeds *= 1 - s.seedDecay * dt;
        if (fr > 0) {
          let rot = s.fruitRot * (frost ? 4 : 1) * fr * dt;
          if (rot > fr || fr < 0.01) rot = fr;
          fr -= rot;
          d += rot;
          shrubLitter += rot;
          seeds += rot * s.localSeeding;
        }
        if (sh > 0) {
          let loss = s.senescence * sh * dt;
          if (sh > shrubCapacity) loss += 0.1 * (sh - shrubCapacity);
          if (loss > sh || sh < 0.01) loss = sh;
          sh -= loss;
          d += loss;
          shrubLitter += loss;
        }

        // Côn trùng
        let bugs = insects[c];
        if (bugs > 0) {
          const activity = clamp01((temperature - ins.activityMin) / (ins.activityFull - ins.activityMin));
          const grassFood = gr > ins.grassFloor ? gr - ins.grassFloor : 0;
          const shrubFood = ins.shrubShare * sh;
          const food = grassFood + shrubFood;
          if (activity > 0 && food > 0) {
            let eaten = ((ins.consumption * activity * bugs * food) / (food + ins.halfSaturation)) * dt;
            if (eaten > 0.5 * food) eaten = 0.5 * food;
            const fromGrass = (eaten * grassFood) / food;
            const fromShrub = eaten - fromGrass;
            gr -= fromGrass;
            sh -= fromShrub;
            grassToInsects += fromGrass;
            shrubToInsects += fromShrub;
            bugs += ins.assimilation * eaten;
            const frass = (1 - ins.assimilation) * eaten;
            d += frass;
            insectsToDetritus += frass;
          }
          let breath = ins.respiration * (0.02 + 0.98 * activity) * bugs * dt;
          if (breath > bugs) breath = bugs;
          bugs -= breath;
          insectsToHeat += breath;
          n += rho * breath;
          returned += rho * breath;
          // Côn trùng ngủ đông (trứng, nhộng) hầu như không chết vì già/bị ăn; chỉ sương giá mới giết chúng.
          let deaths =
            (ins.mortality * (0.2 + 0.8 * activity) +
              ins.crowding * bugs +
              (frost ? ins.frostMortality : 0)) *
            bugs *
            dt;
          if (deaths > bugs) deaths = bugs;
          bugs -= deaths;
          d += deaths;
          insectsToDetritus += deaths;
        }

        // Nấm phân huỷ mùn
        let fg = fungi[c];
        if (e < MOUNTAIN_LEVEL) {
          const neighbours = 0.25 * (fungi[left] + fungi[right] + fungi[up] + fungi[down]);
          const activity = moist * clamp01((temperature + 2) / 16) + 0.02;
          let eaten =
            ((fu.uptake * (fg + fu.spread * neighbours) * d) / (d + fu.halfSaturation)) * activity * dt;
          if (eaten > 0.5 * d) eaten = 0.5 * d;
          d -= eaten;
          detritusToFungi += eaten;
          fg += eaten;
          let breath = (1 - fu.efficiency) * eaten + fu.respiration * fg * dt;
          if (breath > fg) breath = fg;
          fg -= breath;
          fungiToHeat += breath;
          n += rho * breath;
          returned += rho * breath;
        }

        // Côn trùng phát tán sang ô phải và ô dưới (mỗi cặp ô chỉ trao đổi một lần mỗi chu kỳ).
        if (right !== c && elevation[right] >= level && elevation[right] < MOUNTAIN_LEVEL) {
          const flux = ins.dispersal * dt * (bugs - insects[right]);
          bugs -= flux;
          insects[right] += flux;
        }
        if (down !== c && elevation[down] >= level && elevation[down] < MOUNTAIN_LEVEL) {
          const flux = ins.dispersal * dt * (bugs - insects[down]);
          bugs -= flux;
          insects[down] += flux;
        }

        grass[c] = gr;
        shrub[c] = sh;
        fruit[c] = fr;
        seedBank[c] = seeds;
        insects[c] = bugs;
        fungi[c] = fg;

        // Mưa rửa trôi N xuống ô thấp hơn.
        if (rain > 0 && downhill[c] >= 0) {
          const leached = NUTRIENT_LEACHING * rain * dt * n;
          n -= leached;
          soilN[downhill[c]] += leached;
        }
      }

      // Khuếch tán N với ô phải và ô dưới.
      if (right !== c) {
        const k =
          depth > 0 && level - elevation[right] > 0 ? NUTRIENT_DIFFUSION_WATER : NUTRIENT_DIFFUSION_LAND;
        const flux = k * dt * (n - soilN[right]);
        n -= flux;
        soilN[right] += flux;
      }
      if (down !== c) {
        const k =
          depth > 0 && level - elevation[down] > 0 ? NUTRIENT_DIFFUSION_WATER : NUTRIENT_DIFFUSION_LAND;
        const flux = k * dt * (n - soilN[down]);
        n -= flux;
        soilN[down] += flux;
      }
      soilN[c] = n;
      detritus[c] = d;
    }
  }

  ledger.flow(POOL_SUN, pools.grass, sunGrass);
  ledger.flow(POOL_SUN, pools.shrub, sunShrub);
  ledger.flow(POOL_SUN, pools.algae, sunAlgae);
  ledger.flow(pools.grass, POOL_DETRITUS, grassLitter);
  ledger.flow(pools.shrub, POOL_DETRITUS, shrubLitter);
  ledger.flow(pools.algae, POOL_DETRITUS, algaeLitter);
  ledger.flow(pools.grass, pools.insects, grassToInsects);
  ledger.flow(pools.shrub, pools.insects, shrubToInsects);
  ledger.flow(pools.insects, POOL_DETRITUS, insectsToDetritus);
  ledger.flow(pools.insects, POOL_HEAT, insectsToHeat);
  ledger.flow(POOL_DETRITUS, pools.fungi, detritusToFungi);
  ledger.flow(pools.fungi, POOL_HEAT, fungiToHeat);
  ledger.flow(POOL_DETRITUS, POOL_HEAT, detritusToHeat);
  ledger.nutrientUptake += uptake;
  ledger.nutrientReturn += returned;
}
