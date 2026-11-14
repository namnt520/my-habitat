/**
 * Bộ sinh số ngẫu nhiên có seed (sfc32).
 *
 * Toàn bộ mô phỏng chỉ dùng MỘT thể hiện của lớp này. Mọi phép toán là số nguyên 32‑bit nên kết quả
 * giống hệt nhau trên mọi engine JavaScript — đây là nền tảng của tính tất định.
 */
export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 1;

  constructor(seed: number) {
    this.reseed(seed);
  }

  /** Khởi tạo lại trạng thái từ một seed nguyên (trộn bằng splitmix32 để seed gần nhau vẫn cho dãy khác xa). */
  reseed(seed: number): void {
    let s = seed >>> 0;
    const mix = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = mix();
    this.b = mix();
    this.c = mix();
    this.d = 1;
    // Vài vòng làm nóng để các bit của seed lan khắp trạng thái.
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** Số nguyên không dấu 32‑bit kế tiếp. */
  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Số thực đều trong [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Số thực đều trong [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Số nguyên đều trong [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Trả về true với xác suất p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /**
   * Xấp xỉ phân phối chuẩn N(0, 1) bằng tổng 4 số đều (Irwin–Hall).
   * Vì sao không dùng Box–Muller: nó cần log/cos, vốn không tất định giữa các engine.
   * Đuôi phân phối bị cắt ở ±3,46σ — chấp nhận được cho đột biến.
   */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508075688772;
  }

  /** Trạng thái nội bộ (để băm hoặc lưu lại). */
  getState(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  /** Khôi phục trạng thái nội bộ. */
  setState(state: readonly [number, number, number, number]): void {
    [this.a, this.b, this.c, this.d] = state;
  }
}

/** Băm một chuỗi seed tuỳ ý thành số nguyên 32‑bit (FNV‑1a). Chuỗi toàn chữ số được hiểu là số. */
export function seedFromString(text: string): number {
  const trimmed = text.trim();
  if (/^\d{1,10}$/.test(trimmed)) return Number(trimmed) >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
