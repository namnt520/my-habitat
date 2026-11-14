/**
 * Ngữ cảnh "suy nghĩ" của một cá thể: tình trạng cơ thể + những gì nó cảm nhận được ở lượt này.
 * Chỉ có MỘT đối tượng ngữ cảnh, được ghi đè cho từng cá thể, để vòng lặp nóng không cấp phát bộ nhớ.
 */
import type { SpeciesRuntime } from '../species/runtime';
import type { Simulation } from './simulation';

export interface ThinkContext {
  sim: Simulation;
  /** Khe của cá thể đang suy nghĩ và loài của nó. */
  i: number;
  sp: SpeciesRuntime;
  x: number;
  y: number;
  cell: number;
  /** Khoảng thời gian giữa hai lần suy nghĩ (tick). */
  dt: number;
  /** Chỉ số của module đang được chấm điểm/thực thi; so với `animals.behavior[i]` để biết "mình đang cầm lái". */
  behaviorIndex: number;

  // ── Tình trạng cơ thể ──
  /** Năng lượng cấu trúc hiện tại và luỹ thừa 0,75 của nó. */
  mass: number;
  m34: number;
  /** Sức chứa dự trữ và tỉ lệ đang có. */
  capacity: number;
  energyFrac: number;
  /** Đã thành thục sinh dục. */
  adult: boolean;
  /** Bit giai đoạn sống (STAGE_*). */
  stage: number;
  /** Độ sâu nước tại chỗ (> 0 là đang ở trong nước), độ dày tán rừng, nhiệt độ tại chỗ. */
  depth: number;
  canopy: number;
  temperature: number;
  /** Mức hoạt động theo nhiệt độ của loài biến nhiệt (1 với loài hằng nhiệt). */
  activity: number;
  /** Tầm phát hiện hữu hiệu ở lượt này (đã tính gen, ánh sáng, tán rừng chỗ đứng). */
  visionRange: number;
  /** Tốc độ đi và chạy hữu hiệu (đã tính gen, tuổi, thể trạng). */
  walk: number;
  run: number;
  /** Có hoạt động về đêm hay không (theo loài hoặc gen). */
  nightActive: boolean;

  // ── Mong muốn (quyết định cảm nhận những gì) ──
  wantsPrey: boolean;
  wantsMate: boolean;
  wantsCorpse: boolean;

  // ── Cảm nhận ──
  /** Kẻ săn gần nhất đáng sợ: khe, khoảng cách; vector tổng hợp hướng chạy trốn. */
  threat: number;
  threatDist: number;
  awayX: number;
  awayY: number;
  /** Đồng loại trong tầm nhìn: số lượng, tổng vị trí, tổng vận tốc. */
  kinCount: number;
  kinX: number;
  kinY: number;
  kinVX: number;
  kinVY: number;
  /** Có đồng loại đang hoảng chạy gần đây, và hướng chạy của chúng. */
  alarm: boolean;
  alarmX: number;
  alarmY: number;
  /** Thành viên cùng bầy ở gần: số lượng và tổng (khối lượng × máu) — "sức mạnh bầy". */
  groupNear: number;
  groupPower: number;
  /** Đối thủ cùng loài khác bầy gần nhất (cho loài có lãnh thổ). */
  rival: number;
  rivalDist: number;
  /** Bạn tình sẵn sàng gần nhất. */
  mate: number;
  mateDist: number;
  /** Con mồi săn đơn lẻ được tốt nhất, và con mồi lớn (cần cả bầy) tốt nhất. */
  prey: number;
  preyDist: number;
  preyValue: number;
  largePrey: number;
  largePreyDist: number;
  /** Xác tốt nhất trong tầm. */
  corpse: number;
  corpseDist: number;

  // ── Vùng nháp cho kế hoạch của module kiếm ăn ──
  forageSource: number;
  forageCell: number;
  forageHere: boolean;
}

export function createContext(sim: Simulation): ThinkContext {
  return {
    sim,
    i: 0,
    sp: sim.registry.animals[0],
    x: 0,
    y: 0,
    cell: 0,
    dt: 1,
    behaviorIndex: 0,
    mass: 0,
    m34: 0,
    capacity: 0,
    energyFrac: 0,
    adult: false,
    stage: 0,
    depth: 0,
    canopy: 0,
    temperature: 0,
    activity: 1,
    visionRange: 0,
    walk: 0,
    run: 0,
    nightActive: false,
    wantsPrey: false,
    wantsMate: false,
    wantsCorpse: false,
    threat: -1,
    threatDist: 0,
    awayX: 0,
    awayY: 0,
    kinCount: 0,
    kinX: 0,
    kinY: 0,
    kinVX: 0,
    kinVY: 0,
    alarm: false,
    alarmX: 0,
    alarmY: 0,
    groupNear: 0,
    groupPower: 0,
    rival: -1,
    rivalDist: 0,
    mate: -1,
    mateDist: 0,
    prey: -1,
    preyDist: 0,
    preyValue: 0,
    largePrey: -1,
    largePreyDist: 0,
    corpse: -1,
    corpseDist: 0,
    forageSource: -1,
    forageCell: -1,
    forageHere: false,
  };
}
