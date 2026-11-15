/**
 * Các hàm vẽ biểu đồ trên canvas (không dùng thư viện biểu đồ nào).
 */

export interface Series {
  label: string;
  color: string;
  values: ArrayLike<number>;
  dashed?: boolean;
  width?: number;
}

export interface LineChartOptions {
  /** Giá trị trục x của từng mẫu (ví dụ: tick). */
  x: ArrayLike<number>;
  series: Series[];
  logScale?: boolean;
  /** Định dạng nhãn trục x. */
  formatX?: (value: number) => string;
  /** Vị trí con trỏ theo px CSS trong canvas (để hiện giá trị), hoặc null. */
  hoverX?: number | null;
  yLabel?: string;
  /** Dải nền tô theo mùa: hàm trả về màu cho một giá trị x, hoặc null. */
  minY?: number;
}

/** Chuẩn bị canvas cho màn hình mật độ điểm ảnh cao; trả về kích thước theo px CSS. */
export function prepareCanvas(canvas: HTMLCanvasElement): {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
} {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function niceNumber(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)}M`;
  if (value >= 1e4) return `${(value / 1e3).toFixed(0)}k`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  if (value >= 10 || Number.isInteger(value)) return value.toFixed(0);
  return value.toFixed(2);
}

const AXIS = 'rgba(255,255,255,0.14)';
const TEXT = 'rgba(255,255,255,0.62)';
const FONT = '11px system-ui, sans-serif';

/** Vẽ biểu đồ đường nhiều chuỗi. Trả về giá trị tại vị trí con trỏ (nếu có) để hiển thị chú giải. */
export function drawLineChart(
  canvas: HTMLCanvasElement,
  options: LineChartOptions,
): { index: number; x: number } | null {
  const { ctx, width, height } = prepareCanvas(canvas);
  const pad = { left: 40, right: 8, top: 8, bottom: 20 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = options.x.length;
  ctx.font = FONT;
  if (n < 2) {
    ctx.fillStyle = TEXT;
    ctx.fillText('Đang chờ dữ liệu…', pad.left, pad.top + 14);
    return null;
  }
  const x0 = options.x[0];
  const x1 = options.x[n - 1];
  let max = 0;
  let min = Infinity;
  for (const series of options.series) {
    for (let k = 0; k < n; k++) {
      const v = series.values[k];
      if (Number.isNaN(v)) continue;
      if (v > max) max = v;
      if (v > 0 && v < min) min = v;
    }
  }
  if (max <= 0) max = 1;
  if (!Number.isFinite(min)) min = 1;
  const log = options.logScale === true;
  const lo = log ? Math.log10(Math.max(0.5, Math.min(min, max / 10))) : (options.minY ?? 0);
  const hi = log ? Math.log10(max * 1.15) : max * 1.08;
  const toX = (value: number): number => pad.left + ((value - x0) / (x1 - x0 || 1)) * plotW;
  const toY = (value: number): number => {
    const v = log ? Math.log10(Math.max(value, 0.5)) : value;
    return pad.top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  };

  // Lưới và nhãn trục y.
  ctx.strokeStyle = AXIS;
  ctx.fillStyle = TEXT;
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ticks = 4;
  for (let k = 0; k <= ticks; k++) {
    const fraction = k / ticks;
    const raw = log ? 10 ** (lo + (hi - lo) * fraction) : lo + (hi - lo) * fraction;
    const y = pad.top + plotH - fraction * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y + 0.5);
    ctx.lineTo(width - pad.right, y + 0.5);
    ctx.stroke();
    ctx.fillText(niceNumber(raw), pad.left - 5, y);
  }
  // Nhãn trục x.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const format = options.formatX ?? ((value: number) => value.toFixed(0));
  for (let k = 0; k <= 4; k++) {
    const value = x0 + ((x1 - x0) * k) / 4;
    ctx.fillText(
      format(value),
      Math.min(width - 18, Math.max(pad.left + 12, toX(value))),
      height - pad.bottom + 5,
    );
  }

  // Các chuỗi. Khi số mẫu nhiều hơn số cột điểm ảnh thì bỏ bớt mẫu.
  const step = Math.max(1, Math.floor(n / (plotW * 1.5)));
  for (const series of options.series) {
    ctx.strokeStyle = series.color;
    ctx.lineWidth = series.width ?? 1.6;
    ctx.setLineDash(series.dashed ? [4, 3] : []);
    ctx.beginPath();
    let drawing = false;
    for (let k = 0; k < n; k += step) {
      const v = series.values[k];
      if (Number.isNaN(v)) {
        drawing = false;
        continue;
      }
      const px = toX(options.x[k]);
      const py = toY(v);
      if (drawing) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
      drawing = true;
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (
    options.hoverX !== null &&
    options.hoverX !== undefined &&
    options.hoverX >= pad.left &&
    options.hoverX <= width - pad.right
  ) {
    const target = x0 + ((options.hoverX - pad.left) / plotW) * (x1 - x0);
    // Tìm nhị phân mẫu gần con trỏ nhất.
    let low = 0;
    let high = n - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (options.x[mid] < target) low = mid;
      else high = mid;
    }
    const index = target - options.x[low] < options.x[high] - target ? low : high;
    const px = toX(options.x[index]);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(px + 0.5, pad.top);
    ctx.lineTo(px + 0.5, pad.top + plotH);
    ctx.stroke();
    for (const series of options.series) {
      const v = series.values[index];
      if (Number.isNaN(v)) continue;
      ctx.fillStyle = series.color;
      ctx.beginPath();
      ctx.arc(px, toY(v), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    return { index, x: options.x[index] };
  }
  return null;
}

/** Vẽ histogram dạng cột. `mark` (tuỳ chọn) là một vạch dọc tại giá trị trung bình. */
export function drawHistogram(
  canvas: HTMLCanvasElement,
  bins: ArrayLike<number>,
  min: number,
  max: number,
  color: string,
  mark?: number,
): void {
  const { ctx, width, height } = prepareCanvas(canvas);
  const pad = { left: 8, right: 8, top: 6, bottom: 18 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  let peak = 1;
  for (let k = 0; k < bins.length; k++) if (bins[k] > peak) peak = bins[k];
  const barW = plotW / bins.length;
  ctx.fillStyle = color;
  for (let k = 0; k < bins.length; k++) {
    const h = (bins[k] / peak) * plotH;
    ctx.fillRect(pad.left + k * barW + 0.5, pad.top + plotH - h, Math.max(1, barW - 1), h);
  }
  ctx.strokeStyle = AXIS;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + plotH + 0.5);
  ctx.lineTo(width - pad.right, pad.top + plotH + 0.5);
  ctx.stroke();
  ctx.font = FONT;
  ctx.fillStyle = TEXT;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(min.toFixed(2), pad.left, pad.top + plotH + 4);
  ctx.textAlign = 'right';
  ctx.fillText(max.toFixed(2), width - pad.right, pad.top + plotH + 4);
  if (mark !== undefined) {
    const px = pad.left + ((mark - min) / (max - min)) * plotW;
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, pad.top);
    ctx.lineTo(px, pad.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText(`TB ${mark.toFixed(3)}`, Math.min(width - 30, Math.max(30, px)), pad.top + plotH + 4);
  }
}

/**
 * Vẽ bản đồ nhiệt "phân bố gen theo thời gian": mỗi cột là một thời điểm, mỗi hàng là một khoảng giá trị gen,
 * độ đậm là tỉ lệ cá thể. Cho thấy cả quần thể trôi dạt/tách đôi thế nào theo thời gian.
 */
export function drawHeatmap(
  canvas: HTMLCanvasElement,
  columns: { tick: number; bins: ArrayLike<number> }[],
  rgb: [number, number, number],
  formatX: (tick: number) => string,
): void {
  const { ctx, width, height } = prepareCanvas(canvas);
  const pad = { left: 8, right: 8, top: 4, bottom: 18 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  ctx.font = FONT;
  if (columns.length === 0) {
    ctx.fillStyle = TEXT;
    ctx.fillText('Đang chờ dữ liệu…', pad.left, pad.top + 14);
    return;
  }
  const rows = columns[0].bins.length;
  const colW = plotW / columns.length;
  const rowH = plotH / rows;
  for (let c = 0; c < columns.length; c++) {
    const bins = columns[c].bins;
    let total = 0;
    let peak = 0;
    for (let r = 0; r < rows; r++) {
      total += bins[r];
      if (bins[r] > peak) peak = bins[r];
    }
    if (total === 0) continue;
    for (let r = 0; r < rows; r++) {
      if (bins[r] === 0) continue;
      const intensity = Math.sqrt(bins[r] / peak);
      ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${intensity.toFixed(3)})`;
      // Giá trị gen lớn ở phía trên.
      ctx.fillRect(pad.left + c * colW, pad.top + (rows - 1 - r) * rowH, Math.ceil(colW), Math.ceil(rowH));
    }
  }
  ctx.fillStyle = TEXT;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(formatX(columns[0].tick), pad.left, pad.top + plotH + 4);
  ctx.textAlign = 'right';
  ctx.fillText(formatX(columns[columns.length - 1].tick), width - pad.right, pad.top + plotH + 4);
}
