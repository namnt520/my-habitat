/**
 * Nạp dữ liệu loài, kiểm tra tính hợp lệ, và "biên dịch" thành dạng chạy được.
 *
 * Lõi mô phỏng chỉ làm việc với kết quả của hàm `createRegistry` — không nơi nào trong lõi nhắc tên một loài cụ thể.
 */
import { MAX_GENES } from '../sim/constants';
import { pow14 } from '../sim/detmath';
import type { FieldParams, FieldPools } from '../sim/fields';
import { COMMON_GENES } from '../sim/genetics';
import { POOL_FIRST_SPECIES } from '../sim/ledger';
import { BEHAVIORS } from './behaviors';
import {
  LOCO_AIR,
  LOCO_AMPHIBIOUS,
  LOCO_LAND,
  LOCO_WATER,
  STAGE_JUVENILE,
  STAGE_LARVA,
  STAGE_WEANED,
  type BehaviorModule,
  type SpeciesRuntime,
} from './runtime';
import type { AnimalDef, FieldDef, SpeciesDef, StageFilter } from './types';

const FIELD_KEYS = ['grass', 'shrub', 'algae', 'insects', 'fungi'] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

/** Các khoá tham số bắt buộc của từng trường — thiếu khoá nào là báo lỗi ngay lúc nạp. */
const FIELD_PARAM_KEYS: Record<FieldKey, readonly string[]> = {
  grass: [
    'growthRate',
    'capacity',
    'spread',
    'senescence',
    'frostLoss',
    'droughtLoss',
    'shade',
    'hillCapacity',
    'mountainCapacity',
  ],
  shrub: [
    'growthRate',
    'capacity',
    'meadowFraction',
    'deepForestFraction',
    'germination',
    'seedDecay',
    'localSeeding',
    'fruitRate',
    'fruitCapacity',
    'fruitRot',
    'fruitStart',
    'fruitEnd',
    'senescence',
  ],
  algae: ['growthRate', 'capacity', 'spread', 'mortality', 'depthHalf'],
  insects: [
    'consumption',
    'halfSaturation',
    'grassFloor',
    'shrubShare',
    'assimilation',
    'respiration',
    'mortality',
    'crowding',
    'frostMortality',
    'dispersal',
    'activityMin',
    'activityFull',
  ],
  fungi: ['uptake', 'halfSaturation', 'efficiency', 'respiration', 'spread', 'aquaticDecay'],
};

export interface SpeciesRegistry {
  /** Mọi định nghĩa loài theo thứ tự kho trong sổ cái (trường trước, động vật sau). */
  defs: SpeciesDef[];
  fieldDefs: FieldDef[];
  animals: SpeciesRuntime[];
  fields: FieldParams;
  pools: FieldPools;
  /** Tên các kho loài trong sổ cái, theo thứ tự. */
  poolNames: string[];
  animalByKey: Map<string, SpeciesRuntime>;
}

const LOCOMOTION = {
  land: LOCO_LAND,
  water: LOCO_WATER,
  amphibious: LOCO_AMPHIBIOUS,
  air: LOCO_AIR,
} as const;

function stageMask(stage: StageFilter | undefined): number {
  switch (stage) {
    case 'larva':
      return STAGE_LARVA;
    case 'postLarva':
      return STAGE_JUVENILE | STAGE_WEANED;
    case 'weaned':
      return STAGE_WEANED;
    default:
      return STAGE_LARVA | STAGE_JUVENILE | STAGE_WEANED;
  }
}

function validateGenes(def: AnimalDef): void {
  if (def.genes.length < COMMON_GENES.length || def.genes.length > MAX_GENES) {
    throw new Error(`${def.key}: cần ${COMMON_GENES.length}–${MAX_GENES} gen, đang có ${def.genes.length}`);
  }
  COMMON_GENES.forEach((name, index) => {
    if (def.genes[index].name !== name) {
      throw new Error(`${def.key}: gen thứ ${index} phải là "${name}", đang là "${def.genes[index].name}"`);
    }
  });
  for (const gene of def.genes) {
    if (!(gene.min < gene.max) || gene.mean < gene.min || gene.mean > gene.max || gene.sd < 0) {
      throw new Error(`${def.key}: gen "${gene.name}" có biên/trung bình không hợp lệ`);
    }
  }
}

/** Dựng sổ đăng ký từ danh sách định nghĩa loài (thứ tự danh sách quyết định chỉ số loài). */
export function createRegistry(defs: readonly SpeciesDef[]): SpeciesRegistry {
  const fieldDefs: FieldDef[] = [];
  const animalDefs: AnimalDef[] = [];
  for (const def of defs) {
    if (def.kind === 'field') fieldDefs.push(def);
    else animalDefs.push(def);
  }
  if (animalDefs.length > 31) throw new Error('Tối đa 31 loài động vật (mặt nạ bit 32‑bit)');

  // Trường: đủ 5 loài, đủ tham số.
  const fields = {} as Record<FieldKey, Record<string, number>>;
  const pools = {} as Record<FieldKey, number>;
  FIELD_KEYS.forEach((key) => {
    const index = fieldDefs.findIndex((def) => def.key === key);
    if (index < 0) throw new Error(`Thiếu định nghĩa trường "${key}"`);
    for (const param of FIELD_PARAM_KEYS[key]) {
      if (typeof fieldDefs[index].params[param] !== 'number')
        throw new Error(`${key}: thiếu tham số "${param}"`);
    }
    fields[key] = fieldDefs[index].params;
    pools[key] = POOL_FIRST_SPECIES + index;
  });

  const animals: SpeciesRuntime[] = animalDefs.map((def, index) => {
    validateGenes(def);
    const geneIndex = (name: string): number => def.genes.findIndex((gene) => gene.name === name);
    let seasonMask = 0;
    for (const season of def.life.breedingSeasons) seasonMask |= 1 << season;
    return {
      index,
      pool: POOL_FIRST_SPECIES + fieldDefs.length + index,
      key: def.key,
      def,
      locomotion: LOCOMOTION[def.locomotion],
      canSwim: def.canSwim,
      nocturnal: def.nocturnal,
      ectotherm: def.ectotherm,
      burrows: def.burrows,
      ...def.body,
      // Thân lớn dễ bị nhìn thấy từ xa hơn: ∝ khối lượng^(1/8), chuẩn hoá quanh cỡ cáo.
      visibility: Math.sqrt(pow14(def.body.mass / 60)),
      ...def.life,
      seasonMask,
      spawns: def.life.mode === 'spawn',
      genes: def.genes,
      gLitter: geneIndex('litterSize'),
      gNocturnal: geneIndex('nocturnality'),
      gWingspan: geneIndex('wingspan'),
      gFat: geneIndex('fatStorage'),
      gCarnivory: geneIndex('carnivory'),
      gAquatic: geneIndex('aquatic'),
      behaviors: [],
      preyMask: 0,
      predatorMask: 0,
      hunts: false,
      scavenges: false,
      alarm: false,
      usesGroups: false,
      territorial: false,
      social: false,
      aerialHunter: false,
      soloMassRatio: 0.9,
      huntBelow: 0,
      corpseRange: 0,
      packMax: 8,
      packBreeders: 1,
      gSocial: -1,
      panicFraction: 0.45,
    };
  });

  const animalByKey = new Map(animals.map((species) => [species.key, species]));
  const lookup = (key: string): SpeciesRuntime => {
    const found = animalByKey.get(key);
    if (!found) throw new Error(`Không có loài động vật nào tên "${key}"`);
    return found;
  };

  for (const species of animals) {
    for (const use of species.def.behaviors) {
      const module = BEHAVIORS[use.use] as BehaviorModule | undefined;
      if (!module) throw new Error(`${species.key}: không có module hành vi "${use.use}"`);
      let params: unknown;
      try {
        params = module.configure(use.params ?? {}, species, lookup);
      } catch (error) {
        throw new Error(`${species.key} / ${use.use}: ${(error as Error).message}`, { cause: error });
      }
      species.behaviors.push({ module, params, stageMask: stageMask(use.stage) });
    }
  }
  for (const species of animals) {
    if (species.alarm || species.usesGroups || species.territorial) species.social = true;
  }
  // Ai săn ai: suy ra "kẻ săn của tôi" từ danh sách con mồi của các loài khác.
  for (const hunter of animals) {
    for (const prey of animals) {
      if ((hunter.preyMask & (1 << prey.index)) !== 0) prey.predatorMask |= 1 << hunter.index;
    }
  }

  return {
    defs: [...fieldDefs, ...animalDefs],
    fieldDefs,
    animals,
    fields: fields as unknown as FieldParams,
    pools: pools as unknown as FieldPools,
    poolNames: [...fieldDefs.map((def) => def.key), ...animalDefs.map((def) => def.key)],
    animalByKey,
  };
}
