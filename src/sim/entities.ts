/**
 * Kho dữ liệu cá thể theo kiểu Structure of Arrays.
 *
 * Mỗi thuộc tính là một typed array; cá thể là một "khe" (chỉ số). Khe của cá thể chết được tái sử dụng,
 * nhưng chỉ từ tick sau (xem `flushFreed`) để trong cùng một tick không ai nhầm con mới sinh với mục tiêu cũ.
 * Dung lượng tự nhân đôi khi đầy — không có giới hạn cứng nào về số lượng.
 */
import { MAX_GENES } from './constants';
import { GENOME_STRIDE } from './genetics';

/** Trạng thái hành vi hiện tại của một cá thể (renderer dùng để chọn hoạt ảnh). */
export const State = {
  IDLE: 0,
  WANDER: 1,
  FORAGE: 2,
  DRINK: 3,
  FLEE: 4,
  HUNT: 5,
  EAT: 6,
  MATE: 7,
  REST: 8,
  HIBERNATE: 9,
  FOLLOW: 10,
  STALK: 11,
} as const;

export const STATE_LABELS = [
  'Đứng yên',
  'Đi lang thang',
  'Kiếm ăn',
  'Uống nước',
  'Chạy trốn',
  'Săn mồi',
  'Ăn xác/mồi',
  'Tìm bạn đời',
  'Nghỉ ngơi',
  'Ngủ đông',
  'Theo mẹ',
  'Rình mồi',
] as const;

/** Nguyên nhân chết (chỉ số trong bảng thống kê). */
export const Death = {
  STARVATION: 0,
  THIRST: 1,
  AGE: 2,
  PREDATION: 3,
  DISEASE: 4,
  DROWNING: 5,
  FIRE: 6,
  INJURY: 7,
} as const;

export const DEATH_LABELS = [
  'Chết đói',
  'Chết khát',
  'Chết già',
  'Bị săn',
  'Dịch bệnh',
  'Đuối/mắc cạn',
  'Cháy',
  'Thương tích',
] as const;
export const DEATH_CAUSES = DEATH_LABELS.length;

/** Cờ bit trong `flags`. */
export const FLAG_BLOCKED = 1; // lần di chuyển gần nhất bị địa hình chặn
export const FLAG_ARRIVED = 2; // đã tới đích
export const FLAG_IMMUNE = 4; // đã khỏi bệnh, miễn dịch
export const FLAG_SAW_THREAT = 8; // đang chạy vì CHÍNH NÓ thấy mối nguy (không phải vì thấy đồng loại chạy)

type FloatArray = Float32Array | Float64Array;

function grow<T extends FloatArray | Uint8Array | Uint16Array | Uint32Array | Int32Array | Int16Array>(
  array: T,
  length: number,
): T {
  const next = new (array.constructor as new (n: number) => T)(length);
  next.set(array as never);
  return next;
}

export class AnimalStore {
  capacity: number;
  /** Chỉ số khe lớn nhất từng dùng + 1: các vòng lặp chỉ cần duyệt tới đây. */
  high = 0;
  /** Số cá thể đang sống. */
  count = 0;
  /** Mã định danh duy nhất kế tiếp (0 dành cho "không có"). */
  nextId = 1;

  alive: Uint8Array;
  species: Uint8Array;
  sex: Uint8Array; // 0 cái, 1 đực
  state: Uint8Array;
  /** Chỉ số (trong danh sách hành vi của loài) của module đang điều khiển cá thể. */
  behavior: Uint8Array;
  flags: Uint8Array;
  lineage: Uint16Array;
  generation: Uint16Array;
  id: Uint32Array;
  motherId: Uint32Array;
  fatherId: Uint32Array;
  /** Khe của mẹ (để con non theo mẹ); phải kiểm tra `id[motherSlot] === motherId`. */
  motherSlot: Int32Array;
  /** Mã định danh của bố của thai đang mang. */
  sireId: Uint32Array;

  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  /** Đích đang đi tới và tốc độ mong muốn (u/tick). */
  targetX: Float32Array;
  targetY: Float32Array;
  speed: Float32Array;
  /** Hướng nhìn (vector đơn vị) — giữ lại khi đứng yên để vẽ. */
  headingX: Float32Array;
  headingY: Float32Array;

  /** Dự trữ năng lượng (mỡ) và năng lượng cấu trúc cơ thể (E). */
  energy: Float64Array;
  structure: Float64Array;
  /** Nước cơ thể [0, 1] và máu [0, 1]. */
  water: Float32Array;
  health: Float32Array;
  age: Float32Array;
  /** Số tick còn lại tới lúc đẻ (0 = không mang thai). */
  gestation: Float32Array;
  /** Số tick còn lại trước khi sinh sản lại được. */
  reproCooldown: Float32Array;
  strikeCooldown: Float32Array;
  /** Số tick đã ở trạng thái hiện tại, và thời gian nghỉ săn còn lại. */
  stateTime: Float32Array;
  huntCooldown: Float32Array;

  /** Mục tiêu (khe động vật khi săn/giao phối, khe xác khi ăn) và mã định danh của nó để phát hiện khe bị tái dùng. */
  target: Int32Array;
  targetId: Uint32Array;
  /** Bầy có tổ chức (sói); −1 nếu không thuộc bầy nào. */
  group: Int32Array;
  homeX: Float32Array;
  homeY: Float32Array;
  /** Lượng hạt đang mang trong ruột (đơn vị E quả đã ăn). */
  seedLoad: Float32Array;
  /** Vùng (quần thể con) hiện tại và vùng nơi sinh — dùng để phát hiện dòng gen giữa các vùng. */
  region: Int16Array;
  natalRegion: Int16Array;
  /** Số tick nhiễm bệnh còn lại (0 = khoẻ). */
  sick: Float32Array;

  /** Bộ gen (2 alen mỗi gen), bộ gen của bố của thai đang mang, và kiểu hình đã tính sẵn. */
  alleles: Float32Array;
  sireAlleles: Float32Array;
  phenotype: Float32Array;

  private freeList: number[] = [];
  private pendingFree: number[] = [];

  constructor(capacity = 4096) {
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
    this.species = new Uint8Array(capacity);
    this.sex = new Uint8Array(capacity);
    this.state = new Uint8Array(capacity);
    this.behavior = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.lineage = new Uint16Array(capacity);
    this.generation = new Uint16Array(capacity);
    this.id = new Uint32Array(capacity);
    this.motherId = new Uint32Array(capacity);
    this.fatherId = new Uint32Array(capacity);
    this.motherSlot = new Int32Array(capacity);
    this.sireId = new Uint32Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.targetX = new Float32Array(capacity);
    this.targetY = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);
    this.headingX = new Float32Array(capacity);
    this.headingY = new Float32Array(capacity);
    this.energy = new Float64Array(capacity);
    this.structure = new Float64Array(capacity);
    this.water = new Float32Array(capacity);
    this.health = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.gestation = new Float32Array(capacity);
    this.reproCooldown = new Float32Array(capacity);
    this.strikeCooldown = new Float32Array(capacity);
    this.stateTime = new Float32Array(capacity);
    this.huntCooldown = new Float32Array(capacity);
    this.target = new Int32Array(capacity);
    this.targetId = new Uint32Array(capacity);
    this.group = new Int32Array(capacity);
    this.homeX = new Float32Array(capacity);
    this.homeY = new Float32Array(capacity);
    this.seedLoad = new Float32Array(capacity);
    this.region = new Int16Array(capacity);
    this.natalRegion = new Int16Array(capacity);
    this.sick = new Float32Array(capacity);
    this.alleles = new Float32Array(capacity * GENOME_STRIDE);
    this.sireAlleles = new Float32Array(capacity * GENOME_STRIDE);
    this.phenotype = new Float32Array(capacity * MAX_GENES);
  }

  private resize(capacity: number): void {
    this.alive = grow(this.alive, capacity);
    this.species = grow(this.species, capacity);
    this.sex = grow(this.sex, capacity);
    this.state = grow(this.state, capacity);
    this.behavior = grow(this.behavior, capacity);
    this.flags = grow(this.flags, capacity);
    this.lineage = grow(this.lineage, capacity);
    this.generation = grow(this.generation, capacity);
    this.id = grow(this.id, capacity);
    this.motherId = grow(this.motherId, capacity);
    this.fatherId = grow(this.fatherId, capacity);
    this.motherSlot = grow(this.motherSlot, capacity);
    this.sireId = grow(this.sireId, capacity);
    this.x = grow(this.x, capacity);
    this.y = grow(this.y, capacity);
    this.vx = grow(this.vx, capacity);
    this.vy = grow(this.vy, capacity);
    this.targetX = grow(this.targetX, capacity);
    this.targetY = grow(this.targetY, capacity);
    this.speed = grow(this.speed, capacity);
    this.headingX = grow(this.headingX, capacity);
    this.headingY = grow(this.headingY, capacity);
    this.energy = grow(this.energy, capacity);
    this.structure = grow(this.structure, capacity);
    this.water = grow(this.water, capacity);
    this.health = grow(this.health, capacity);
    this.age = grow(this.age, capacity);
    this.gestation = grow(this.gestation, capacity);
    this.reproCooldown = grow(this.reproCooldown, capacity);
    this.strikeCooldown = grow(this.strikeCooldown, capacity);
    this.stateTime = grow(this.stateTime, capacity);
    this.huntCooldown = grow(this.huntCooldown, capacity);
    this.target = grow(this.target, capacity);
    this.targetId = grow(this.targetId, capacity);
    this.group = grow(this.group, capacity);
    this.homeX = grow(this.homeX, capacity);
    this.homeY = grow(this.homeY, capacity);
    this.seedLoad = grow(this.seedLoad, capacity);
    this.region = grow(this.region, capacity);
    this.natalRegion = grow(this.natalRegion, capacity);
    this.sick = grow(this.sick, capacity);
    this.alleles = grow(this.alleles, capacity * GENOME_STRIDE);
    this.sireAlleles = grow(this.sireAlleles, capacity * GENOME_STRIDE);
    this.phenotype = grow(this.phenotype, capacity * MAX_GENES);
    this.capacity = capacity;
  }

  /** Cấp một khe mới với các trường về giá trị mặc định. Trả về chỉ số khe. */
  allocate(): number {
    let slot: number;
    if (this.freeList.length > 0) {
      slot = this.freeList.pop()!;
    } else {
      if (this.high >= this.capacity) this.resize(this.capacity * 2);
      slot = this.high++;
    }
    this.alive[slot] = 1;
    this.id[slot] = this.nextId++;
    this.state[slot] = State.IDLE;
    this.behavior[slot] = 255;
    this.flags[slot] = FLAG_ARRIVED;
    this.vx[slot] = 0;
    this.vy[slot] = 0;
    this.speed[slot] = 0;
    this.headingX[slot] = 1;
    this.headingY[slot] = 0;
    this.water[slot] = 1;
    this.health[slot] = 1;
    this.age[slot] = 0;
    this.gestation[slot] = 0;
    this.reproCooldown[slot] = 0;
    this.strikeCooldown[slot] = 0;
    this.stateTime[slot] = 0;
    this.huntCooldown[slot] = 0;
    this.target[slot] = -1;
    this.targetId[slot] = 0;
    this.group[slot] = -1;
    this.seedLoad[slot] = 0;
    this.sick[slot] = 0;
    this.motherId[slot] = 0;
    this.fatherId[slot] = 0;
    this.motherSlot[slot] = -1;
    this.generation[slot] = 0;
    this.count++;
    return slot;
  }

  /** Đánh dấu khe đã chết. Khe chỉ được tái dùng sau `flushFreed()`. */
  release(slot: number): void {
    this.alive[slot] = 0;
    this.count--;
    this.pendingFree.push(slot);
  }

  /** Cuối tick: cho phép tái dùng các khe vừa giải phóng (theo thứ tự tất định). */
  flushFreed(): void {
    if (this.pendingFree.length === 0) return;
    // Khe nhỏ được dùng lại trước để mảng đặc về phía đầu.
    this.pendingFree.sort((a, b) => b - a);
    for (const slot of this.pendingFree) this.freeList.push(slot);
    this.freeList.sort((a, b) => b - a);
    this.pendingFree.length = 0;
  }
}

/** Xác động vật: thực thể tĩnh mang năng lượng, bị ăn bởi kẻ ăn xác và rữa dần thành mùn. */
export class CorpseStore {
  capacity = 1024;
  high = 0;
  count = 0;
  nextId = 1;
  alive = new Uint8Array(this.capacity);
  id = new Uint32Array(this.capacity);
  x = new Float32Array(this.capacity);
  y = new Float32Array(this.capacity);
  energy = new Float64Array(this.capacity);
  /** Loài của con vật đã chết, và loài của kẻ giết nó (255 = không bị săn). */
  species = new Uint8Array(this.capacity);
  killer = new Uint8Array(this.capacity);
  age = new Float32Array(this.capacity);
  private freeList: number[] = [];

  add(x: number, y: number, energy: number, species: number, killer: number): number {
    let slot: number;
    if (this.freeList.length > 0) {
      slot = this.freeList.pop()!;
    } else {
      if (this.high >= this.capacity) {
        const capacity = this.capacity * 2;
        this.alive = grow(this.alive, capacity);
        this.id = grow(this.id, capacity);
        this.x = grow(this.x, capacity);
        this.y = grow(this.y, capacity);
        this.energy = grow(this.energy, capacity);
        this.species = grow(this.species, capacity);
        this.killer = grow(this.killer, capacity);
        this.age = grow(this.age, capacity);
        this.capacity = capacity;
      }
      slot = this.high++;
    }
    this.alive[slot] = 1;
    this.id[slot] = this.nextId++;
    this.x[slot] = x;
    this.y[slot] = y;
    this.energy[slot] = energy;
    this.species[slot] = species;
    this.killer[slot] = killer;
    this.age[slot] = 0;
    this.count++;
    return slot;
  }

  remove(slot: number): void {
    this.alive[slot] = 0;
    this.energy[slot] = 0;
    this.count--;
    this.freeList.push(slot);
    // Giữ thứ tự tái dùng tất định và ưu tiên khe nhỏ.
    this.freeList.sort((a, b) => b - a);
  }
}
