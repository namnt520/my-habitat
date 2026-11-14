/**
 * Sổ cái kiểm toán năng lượng và dinh dưỡng.
 *
 * Mọi thay đổi của một kho năng lượng trong mô phỏng phải đi kèm đúng một lệnh `flow(from, to, amount)`.
 * Nhờ đó với mỗi kho: tồn kho đo được = tổng vào − tổng ra. Nếu ở đâu đó năng lượng "sinh ra từ hư không"
 * thì đẳng thức này vỡ và test bảo toàn sẽ bắt được.
 */

/** Nguồn: ánh sáng mặt trời (quang hợp). */
export const POOL_SUN = 0;
/** Bể chứa: nhiệt thải (hô hấp, phân huỷ, cháy). */
export const POOL_HEAT = 1;
/** Nguồn: bên ngoài hệ (quần thể khởi tạo, loài xâm lấn do người dùng thả). */
export const POOL_EXTERNAL = 2;
/** Kho: xác động vật. */
export const POOL_CORPSE = 3;
/** Kho: mùn bã (phân, lá rụng, xác đã rữa). */
export const POOL_DETRITUS = 4;
/** Chỉ số kho đầu tiên dành cho loài. */
export const POOL_FIRST_SPECIES = 5;

export interface PoolAudit {
  pool: number;
  name: string;
  /** Tồn kho suy ra từ sổ cái (vào − ra). */
  expected: number;
  /** Tồn kho đo trực tiếp từ trạng thái mô phỏng. */
  measured: number;
  /** |expected − measured| / max(1, |expected|, tổng dòng vào). */
  relativeError: number;
}

export class Ledger {
  readonly poolCount: number;
  readonly names: string[];
  /** Ma trận dòng tích luỹ: flows[from * poolCount + to] (E). */
  readonly flows: Float64Array;
  /** N khoáng thực vật đã hút khỏi đất, và N được trả về đất (tích luỹ). */
  nutrientUptake = 0;
  nutrientReturn = 0;

  constructor(speciesNames: readonly string[]) {
    this.names = ['sun', 'heat', 'external', 'corpse', 'detritus', ...speciesNames];
    this.poolCount = this.names.length;
    this.flows = new Float64Array(this.poolCount * this.poolCount);
  }

  /** Ghi nhận `amount` E chuyển từ kho `from` sang kho `to`. */
  flow(from: number, to: number, amount: number): void {
    this.flows[from * this.poolCount + to] += amount;
  }

  /** Tổng năng lượng đã chảy vào kho. */
  inflow(pool: number): number {
    let sum = 0;
    for (let from = 0; from < this.poolCount; from++) sum += this.flows[from * this.poolCount + pool];
    return sum;
  }

  /** Tổng năng lượng đã chảy ra khỏi kho. */
  outflow(pool: number): number {
    let sum = 0;
    const base = pool * this.poolCount;
    for (let to = 0; to < this.poolCount; to++) sum += this.flows[base + to];
    return sum;
  }

  /** Tồn kho kỳ vọng theo sổ cái. */
  balance(pool: number): number {
    return this.inflow(pool) - this.outflow(pool);
  }

  /** Đối chiếu tồn kho đo được với sổ cái cho mọi kho thực (không tính nguồn và bể chứa). */
  audit(measuredStocks: Float64Array): PoolAudit[] {
    const result: PoolAudit[] = [];
    for (let pool = POOL_CORPSE; pool < this.poolCount; pool++) {
      const inflow = this.inflow(pool);
      const expected = inflow - this.outflow(pool);
      const measured = measuredStocks[pool];
      const scale = Math.max(1, Math.abs(expected), inflow);
      result.push({
        pool,
        name: this.names[pool],
        expected,
        measured,
        relativeError: Math.abs(expected - measured) / scale,
      });
    }
    return result;
  }
}
