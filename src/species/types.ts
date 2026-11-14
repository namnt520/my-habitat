/**
 * Lược đồ dữ liệu của một loài. Mọi loài được khai báo trong `src/species/data/*.json` theo các kiểu này;
 * lõi mô phỏng không biết tên loài cụ thể nào.
 */
import type { GeneSpec } from '../sim/genetics';

/** Cách di chuyển: quyết định địa hình nào cản đường. */
export type Locomotion = 'land' | 'water' | 'amphibious' | 'air';
/** Sinh cảnh để rải quần thể khởi tạo. */
export type Habitat = 'meadow' | 'forest' | 'land' | 'water' | 'shore';
/** Các trường mật độ mà động vật có thể ăn. */
export type FoodField = 'grass' | 'shrub' | 'fruit' | 'algae' | 'insects';
/** Giai đoạn sống dùng để lọc module hành vi. */
export type StageFilter = 'any' | 'larva' | 'postLarva' | 'weaned';

/** Một module hành vi gắn vào loài, kèm tham số riêng. */
export interface BehaviorUse {
  /** Tên module trong `src/species/behaviors`. */
  use: string;
  /** Chỉ áp dụng cho giai đoạn sống này (mặc định: mọi giai đoạn). */
  stage?: StageFilter;
  params?: Record<string, unknown>;
}

export interface AnimalBody {
  /** Năng lượng cấu trúc cơ thể của con trưởng thành có gen kích thước = 1 (E). */
  mass: number;
  /** Sức chứa dự trữ (mỡ) = reserveRatio × cấu trúc hiện tại. */
  reserveRatio: number;
  /** Tốc độ đi và chạy (u/tick) khi gen tốc độ = 1. */
  walkSpeed: number;
  runSpeed: number;
  /** Tầm nhìn ban ngày (u) khi gen tầm nhìn = 1, và hệ số tầm nhìn ban đêm. */
  vision: number;
  nightVision: number;
  /** Tầm với để ăn/đánh (u). */
  reach: number;
  /** Hệ số tấn công và phản đòn. */
  attack: number;
  defense: number;
  /** Hệ số nhân chuyển hoá cơ bản và chi phí di chuyển (bay lượn rẻ hơn chạy). */
  metabolism: number;
  moveCost: number;
  /** Lượng ăn tối đa (E/tick cho mỗi khối lượng^0,75). */
  intake: number;
  /** Tỉ lệ nước cơ thể mất mỗi tick. */
  thirst: number;
  /** Khoảng nhiệt độ dễ chịu (°C) khi gen chịu lạnh = 0. */
  comfortLow: number;
  comfortHigh: number;
  /** Hiệu suất đồng hoá thịt/xác. */
  meatAssimilation: number;
  /** Sức bền: số tick chạy nước rút (trốn hoặc đuổi) trước khi bắt đầu đuối sức. */
  endurance: number;
}

export interface AnimalLife {
  /** Tuổi thành thục sinh dục và tuổi thọ điển hình (tick). */
  maturity: number;
  lifespan: number;
  /** Thời gian mang thai (tick); 0 với loài đẻ trứng. */
  gestation: number;
  /** Số con mỗi lứa (nếu loài không có gen litterSize). */
  litter: number;
  /** Thời gian nghỉ sau khi sinh (tick). */
  cooldown: number;
  /** Các mùa giao phối: 0 xuân, 1 hạ, 2 thu, 3 đông. */
  breedingSeasons: number[];
  /** 'live': mang thai rồi đẻ con; 'spawn': đẻ trứng dưới nước, thụ tinh ngoài. */
  mode: 'live' | 'spawn';
  /** Tầm phát hiện bạn tình (tiếng gọi, mùi) — thường xa hơn tầm nhìn (u). */
  mateRange: number;
  /** Khối lượng sơ sinh theo tỉ lệ khối lượng trưởng thành. */
  birthMass: number;
  /** Con non được mẹ cấp dự trữ bằng tỉ lệ này của sức chứa của nó. */
  offspringReserve: number;
  /** Khi đẻ, mẹ giữ lại cho mình ít nhất tỉ lệ này của sức chứa dự trữ (loài nuôi con lâu phải giữ nhiều hơn). */
  motherReserve: number;
  /**
   * Bán kính lãnh thổ sinh sản (u); 0 nếu loài không giữ lãnh thổ. Con cái chỉ sinh sản khi trong bán kính này
   * quanh "nhà" của nó không có con cái trưởng thành nào lớn tuổi hơn — mật độ càng cao càng ít con được đẻ.
   */
  territory: number;
  /** Dưới tuổi này là ấu trùng thuỷ sinh (nòng nọc); 0 nếu không có. */
  larvaUntil: number;
  /** Dưới tuổi này con non theo mẹ và được mẹ nuôi; 0 nếu không chăm con. */
  weanAge: number;
  /** Tốc độ lớn tối đa (E cấu trúc/tick cho mỗi khối lượng^0,75). */
  growth: number;
}

export interface AnimalDef {
  kind: 'animal';
  key: string;
  name: string;
  nameEn: string;
  /** Vai trò sinh thái và cơ chế riêng (để hiển thị). */
  role: string;
  mechanism: string;
  trophicLevel: number;
  /** Có mặt trong quần xã khởi đầu hay không (loài xâm lấn: false). */
  starting: boolean;
  initialCount: number;
  /** Số cá thể mỗi cụm khi rải quần thể khởi tạo (1 = rải đều). */
  spawnCluster: number;
  habitat: Habitat;
  locomotion: Locomotion;
  canSwim: boolean;
  /** Hoạt động về đêm (đảo chu kỳ ngủ). */
  nocturnal: boolean;
  /** Biến nhiệt: chuyển hoá và hoạt động phụ thuộc nhiệt độ môi trường. */
  ectotherm: boolean;
  /** Có hang: khi nghỉ thì chui xuống hang, kẻ săn gần như không phát hiện được. */
  burrows: boolean;
  body: AnimalBody;
  life: AnimalLife;
  /** 7 gen chung theo đúng thứ tự COMMON_GENES, rồi tối đa 3 gen đặc thù. */
  genes: GeneSpec[];
  behaviors: BehaviorUse[];
  appearance: { shape: string; saturation: number };
}

export interface FieldDef {
  kind: 'field';
  key: 'grass' | 'shrub' | 'algae' | 'insects' | 'fungi';
  name: string;
  nameEn: string;
  role: string;
  mechanism: string;
  trophicLevel: number;
  color: string;
  /** Tham số động lực của trường; ý nghĩa từng khoá xem `src/sim/fields.ts`. */
  params: Record<string, number>;
}

export type SpeciesDef = AnimalDef | FieldDef;
