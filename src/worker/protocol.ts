/**
 * Giao thức tin nhắn giữa luồng giao diện và Web Worker chạy mô phỏng.
 * Luồng giao diện KHÔNG bao giờ giữ tham chiếu tới `Simulation`: nó chỉ gửi lệnh và nhận dữ liệu thuần.
 */
import type { SimEvent } from '../sim/disasters';
import type { GeneSpec } from '../sim/genetics';
import type { SimParams } from '../sim/params';
import type { InspectInfo, Scenario } from '../sim/simulation';
import type { RenderSnapshot } from '../sim/snapshot';
import type { LineageNode } from '../sim/speciation';
import type { StatsFrame } from '../sim/stats';

/** Mô tả tĩnh của một loài động vật cho giao diện và renderer. */
export interface AnimalMeta {
  index: number;
  key: string;
  name: string;
  role: string;
  mechanism: string;
  shape: string;
  saturation: number;
  /** Khối lượng trưởng thành chuẩn (E) — renderer dùng để suy ra kích thước vẽ. */
  mass: number;
  flying: boolean;
  aquatic: boolean;
  starting: boolean;
  genes: GeneSpec[];
  /** Chỉ số kho của loài trong sổ cái. */
  pool: number;
  /** Tên các module hành vi gắn với loài. */
  behaviors: string[];
}

export interface FieldMeta {
  key: string;
  name: string;
  role: string;
  mechanism: string;
  color: string;
  pool: number;
}

/** Dữ liệu tĩnh của thế giới, gửi một lần khi khởi tạo. */
export interface WorldMeta {
  seed: number;
  scenario: Scenario;
  params: SimParams;
  elevation: Float32Array;
  canopy: Float32Array;
  river: Uint8Array;
  landRegion: Int16Array;
  animals: AnimalMeta[];
  fields: FieldMeta[];
  /** Tên mọi kho của sổ cái theo chỉ số. */
  pools: string[];
}

export interface PerfInfo {
  /** Thời gian trung bình của một tick mô phỏng (ms), làm mượt. */
  tickMs: number;
  /** Số tick/giây thực tế đạt được và số tick/giây mong muốn. */
  ticksPerSecond: number;
  targetTicksPerSecond: number;
}

export type ToWorker =
  | { type: 'init'; seed: number; scenario: Scenario; params?: Partial<SimParams> }
  /** 0 = tạm dừng; Infinity = chạy nhanh nhất có thể. */
  | { type: 'speed'; ticksPerSecond: number }
  /** Xin một ảnh chụp để vẽ (luồng giao diện xin mỗi khung hình → tự điều tiết). */
  | { type: 'frame'; fields: boolean }
  | { type: 'event'; event: SimEvent }
  | { type: 'param'; key: keyof SimParams; value: number | boolean }
  | { type: 'inspect'; id: number }
  | { type: 'hash' }
  /** Chạy đúng N tick ngay lập tức rồi trả về băm (dùng cho đo đạc và kiểm chứng tất định). */
  | { type: 'run'; ticks: number };

export type FromWorker =
  | { type: 'ready'; meta: WorldMeta }
  | { type: 'frame'; snapshot: RenderSnapshot; tickFraction: number; perf: PerfInfo }
  | {
      type: 'stats';
      frame: StatsFrame;
      lineages: LineageNode[];
      /** Dòng năng lượng tích luỹ theo sổ cái (ma trận kho × kho) và ma trận "ai ăn ai" — gửi thưa hơn. */
      flows: Float64Array | null;
      intake: Float64Array | null;
      /** Histogram kiểu hình [loài][gen][ô] — gửi thưa hơn. */
      histograms: number[][][] | null;
    }
  | { type: 'inspect'; info: InspectInfo | null }
  | { type: 'hash'; tick: number; hash: string; ms: number };
