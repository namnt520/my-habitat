/**
 * Toán học tất định.
 *
 * ECMAScript chỉ bảo đảm kết quả chính xác tới từng bit cho + − × ÷ và Math.sqrt. Các hàm siêu việt
 * (sin, exp, pow…) được phép sai khác giữa các engine, nên lõi mô phỏng dùng các xấp xỉ đa thức dưới đây.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** Kẹp x vào [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Kẹp x vào [0, 1]. */
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Nội suy tuyến tính. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hàm bậc thang mượt Hermite: 0 khi x ≤ e0, 1 khi x ≥ e1. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** sin(x) bằng chuỗi Taylor bậc 11 sau khi gập về [−π/2, π/2]; sai số < 6e‑8. */
export function dsin(x: number): number {
  let r = x - Math.round(x / TWO_PI) * TWO_PI; // r ∈ [−π, π]
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  return (
    r * (1 + r2 * (-1 / 6 + r2 * (1 / 120 + r2 * (-1 / 5040 + r2 * (1 / 362880 + r2 * (-1 / 39916800))))))
  );
}

/** cos(x) = sin(x + π/2). */
export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

/** x^(3/4) chỉ bằng căn bậc hai — dùng cho định luật Kleiber (chuyển hoá ∝ khối lượng^0,75). */
export function pow34(x: number): number {
  const s = Math.sqrt(x);
  return s * Math.sqrt(s);
}

/** x^(1/4). */
export function pow14(x: number): number {
  return Math.sqrt(Math.sqrt(x));
}

/** Hàm bão hoà Michaelis–Menten: x / (x + half), an toàn khi x ≤ 0. */
export function saturate(x: number, half: number): number {
  return x <= 0 ? 0 : x / (x + half);
}

/** Khoảng cách vòng giữa hai sắc độ trong [0, 1) — kết quả trong [0, 0,5]. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}
