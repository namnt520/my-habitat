/**
 * Dạng "đã biên dịch" của một loài động vật: tham số được làm phẳng để vòng lặp nóng đọc nhanh,
 * và các module hành vi đã được gắn kèm tham số đã kiểm tra.
 */
import type { GeneSpec } from '../sim/genetics';
import type { ThinkContext } from '../sim/context';
import type { AnimalDef } from './types';

export const LOCO_LAND = 0;
export const LOCO_WATER = 1;
export const LOCO_AMPHIBIOUS = 2;
export const LOCO_AIR = 3;

/** Bit giai đoạn sống: một module chỉ chạy nếu `stageMask & ctx.stage` khác 0. */
export const STAGE_LARVA = 1;
export const STAGE_JUVENILE = 2; // đã qua ấu trùng nhưng chưa cai sữa
export const STAGE_WEANED = 4;

/**
 * Một module hành vi. Mỗi lần cá thể "suy nghĩ", lõi gọi `score` của mọi module gắn với loài,
 * rồi gọi `apply` của module có điểm cao nhất.
 */
export interface BehaviorModule<P = unknown> {
  readonly name: string;
  /** Mô tả ngắn (hiển thị trong tài liệu/giao diện). */
  readonly description: string;
  /**
   * Kiểm tra và chuẩn hoá tham số đọc từ JSON. Gọi một lần lúc nạp loài.
   * Module có thể bật cờ năng lực trên `species` (ví dụ `hunts`, `preyMask`).
   */
  configure(raw: Record<string, unknown>, species: SpeciesRuntime, lookup: SpeciesLookup): P;
  /** Điểm hữu dụng ≥ 0; không được thay đổi trạng thái mô phỏng (ngoài vùng nháp trong ctx). */
  score(ctx: ThinkContext, params: P): number;
  /** Thực thi: đặt trạng thái, đích di chuyển, và làm hành động tức thời (ăn, uống…). */
  apply(ctx: ThinkContext, params: P): void;
}

export type SpeciesLookup = (key: string) => SpeciesRuntime;

export interface BoundBehavior {
  module: BehaviorModule;
  params: unknown;
  stageMask: number;
}

export interface SpeciesRuntime {
  /** Chỉ số loài động vật (0‑based) và chỉ số kho trong sổ cái. */
  index: number;
  pool: number;
  key: string;
  def: AnimalDef;

  locomotion: number;
  canSwim: boolean;
  nocturnal: boolean;
  ectotherm: boolean;
  burrows: boolean;

  mass: number;
  reserveRatio: number;
  walkSpeed: number;
  runSpeed: number;
  vision: number;
  nightVision: number;
  reach: number;
  attack: number;
  defense: number;
  metabolism: number;
  moveCost: number;
  intake: number;
  thirst: number;
  comfortLow: number;
  comfortHigh: number;
  meatAssimilation: number;
  endurance: number;
  /** Hệ số "dễ bị nhìn thấy" theo kích thước cơ thể. */
  visibility: number;

  maturity: number;
  lifespan: number;
  gestation: number;
  litter: number;
  cooldown: number;
  /** Bit i bật nếu mùa i là mùa giao phối. */
  seasonMask: number;
  spawns: boolean;
  mateRange: number;
  birthMass: number;
  offspringReserve: number;
  motherReserve: number;
  territory: number;
  larvaUntil: number;
  weanAge: number;
  growth: number;

  genes: GeneSpec[];
  /** Vị trí các gen đặc thù mà lõi biết cách dùng; −1 nếu loài không có gen đó. */
  gLitter: number;
  gNocturnal: number;
  gWingspan: number;
  gFat: number;
  gCarnivory: number;
  gAquatic: number;

  behaviors: BoundBehavior[];
  /** Bit theo chỉ số loài: những loài mà loài này săn, và những loài săn loài này. */
  preyMask: number;
  predatorMask: number;
  /** Cờ năng lực do các module bật khi cấu hình. */
  hunts: boolean;
  scavenges: boolean;
  alarm: boolean;
  usesGroups: boolean;
  territorial: boolean;
  /** Cần thông tin về đồng loại xung quanh (đàn, bầy, lãnh thổ); nếu không, giác quan bỏ qua đồng loại để tiết kiệm. */
  social: boolean;
  /** Săn từ trên không: bỏ qua con mồi dưới tán rừng dày. */
  aerialHunter: boolean;
  /** Tỉ lệ khối lượng (kẻ săn / con mồi) tối thiểu để săn đơn lẻ; dưới mức này con mồi là "mồi lớn". */
  soloMassRatio: number;
  /** Chỉ săn khi dự trữ dưới tỉ lệ này. */
  huntBelow: number;
  /** Tầm phát hiện xác (u); 0 nếu không ăn xác. */
  corpseRange: number;
  /** Kích thước bầy tối đa trước khi con trưởng thành tách đi, và vị trí gen gắn bó với bầy (−1 nếu không có). */
  packMax: number;
  gSocial: number;
  /** Khoảng cách hoảng sợ theo tỉ lệ tầm nhìn: kẻ săn tới gần hơn mức này thì bỏ chạy dù nó không săn. */
  panicFraction: number;
}
