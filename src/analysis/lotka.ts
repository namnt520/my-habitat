/**
 * Mô hình Lotka–Volterra để đối chiếu với mô phỏng trong chế độ thí nghiệm:
 *
 *     dN/dt = αN − βNP        (con mồi)
 *     dP/dt = δNP − γP        (kẻ săn)
 *
 * File này là công cụ PHÂN TÍCH (không thuộc lõi mô phỏng) nên được phép dùng Math.log.
 */

export interface LotkaVolterraFit {
  /** Tốc độ tăng nội tại của con mồi (1/tick). */
  alpha: number;
  /** Hệ số bị săn (1/(kẻ săn·tick)). */
  beta: number;
  /** Hệ số chuyển con mồi thành kẻ săn (1/(con mồi·tick)). */
  delta: number;
  /** Tốc độ chết của kẻ săn (1/tick). */
  gamma: number;
  /** Hệ số xác định R² của hai phép hồi quy (con mồi, kẻ săn). */
  r2Prey: number;
  r2Predator: number;
  /** Điểm cân bằng lý thuyết N* = γ/δ, P* = α/β và chu kỳ dao động nhỏ 2π/√(αγ). */
  preyEquilibrium: number;
  predatorEquilibrium: number;
  period: number;
}

function linearRegression(x: number[], y: number[]): { intercept: number; slope: number; r2: number } {
  const n = x.length;
  let sumX = 0;
  let sumY = 0;
  for (let k = 0; k < n; k++) {
    sumX += x[k];
    sumY += y[k];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let k = 0; k < n; k++) {
    sxx += (x[k] - meanX) * (x[k] - meanX);
    sxy += (x[k] - meanX) * (y[k] - meanY);
    syy += (y[k] - meanY) * (y[k] - meanY);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { intercept: meanY - slope * meanX, slope, r2: sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0 };
}

/**
 * Khớp tham số Lotka–Volterra từ chuỗi thời gian bằng hồi quy tuyến tính trên tốc độ tăng theo đầu cá thể:
 *     d(ln N)/dt = α − βP          d(ln P)/dt = δN − γ
 * @param window số mẫu dùng để làm mượt đạo hàm (sai phân trung tâm trên ±window mẫu)
 * @returns null nếu dữ liệu quá ít hoặc quần thể đã về 0
 */
export function fitLotkaVolterra(
  time: number[],
  prey: number[],
  predator: number[],
  window = 3,
): LotkaVolterraFit | null {
  const preyRate: number[] = [];
  const predatorRate: number[] = [];
  const preyLevel: number[] = [];
  const predatorLevel: number[] = [];
  for (let k = window; k < time.length - window; k++) {
    const a = k - window;
    const b = k + window;
    if (prey[a] <= 0 || prey[b] <= 0 || predator[a] <= 0 || predator[b] <= 0) continue;
    const dt = time[b] - time[a];
    preyRate.push(Math.log(prey[b] / prey[a]) / dt);
    predatorRate.push(Math.log(predator[b] / predator[a]) / dt);
    preyLevel.push(prey[k]);
    predatorLevel.push(predator[k]);
  }
  if (preyRate.length < 8) return null;
  const preyFit = linearRegression(predatorLevel, preyRate);
  const predatorFit = linearRegression(preyLevel, predatorRate);
  const alpha = preyFit.intercept;
  const beta = -preyFit.slope;
  const delta = predatorFit.slope;
  const gamma = -predatorFit.intercept;
  return {
    alpha,
    beta,
    delta,
    gamma,
    r2Prey: preyFit.r2,
    r2Predator: predatorFit.r2,
    preyEquilibrium: delta !== 0 ? gamma / delta : NaN,
    predatorEquilibrium: beta !== 0 ? alpha / beta : NaN,
    period: alpha > 0 && gamma > 0 ? (2 * Math.PI) / Math.sqrt(alpha * gamma) : NaN,
  };
}

/** Giải hệ Lotka–Volterra bằng Runge–Kutta bậc 4, trả về nghiệm tại các thời điểm `time`. */
export function integrateLotkaVolterra(
  fit: Pick<LotkaVolterraFit, 'alpha' | 'beta' | 'delta' | 'gamma'>,
  prey0: number,
  predator0: number,
  time: number[],
): { prey: number[]; predator: number[] } {
  const { alpha, beta, delta, gamma } = fit;
  const dN = (n: number, p: number): number => alpha * n - beta * n * p;
  const dP = (n: number, p: number): number => delta * n * p - gamma * p;
  const prey = [prey0];
  const predator = [predator0];
  let n = prey0;
  let p = predator0;
  for (let k = 1; k < time.length; k++) {
    const span = time[k] - time[k - 1];
    const steps = Math.max(1, Math.ceil(span / 2));
    const h = span / steps;
    for (let s = 0; s < steps; s++) {
      const k1n = dN(n, p);
      const k1p = dP(n, p);
      const k2n = dN(n + (h / 2) * k1n, p + (h / 2) * k1p);
      const k2p = dP(n + (h / 2) * k1n, p + (h / 2) * k1p);
      const k3n = dN(n + (h / 2) * k2n, p + (h / 2) * k2p);
      const k3p = dP(n + (h / 2) * k2n, p + (h / 2) * k2p);
      const k4n = dN(n + h * k3n, p + h * k3p);
      const k4p = dP(n + h * k3n, p + h * k3p);
      n += (h / 6) * (k1n + 2 * k2n + 2 * k3n + k4n);
      p += (h / 6) * (k1p + 2 * k2p + 2 * k3p + k4p);
      // Nghiệm số có thể vọt tới vô cực nếu tham số khớp được không hợp lý; chặn lại để biểu đồ còn đọc được.
      if (!Number.isFinite(n) || n > 1e9) n = 1e9;
      if (!Number.isFinite(p) || p > 1e9) p = 1e9;
      if (n < 0) n = 0;
      if (p < 0) p = 0;
    }
    prey.push(n);
    predator.push(p);
  }
  return { prey, predator };
}
