/**
 * Di truyền: bộ gen lưỡng bội, cộng gộp.
 *
 * Mỗi gen có hai alen (một từ mẹ, một từ bố). Kiểu hình của gen = trung bình hai alen.
 * Khi sinh sản, mỗi bố mẹ truyền ngẫu nhiên một trong hai alen của mình (phân li Mendel), sau đó
 * mỗi alen có xác suất đột biến: cộng nhiễu Gauss tỉ lệ với biên độ của gen.
 *
 * Vì sao lưỡng bội thay vì "lấy trung bình bố mẹ": di truyền hoà trộn làm phương sai giảm một nửa mỗi
 * thế hệ, chọn lọc sẽ hết nguyên liệu; phân li Mendel giữ được biến dị.
 */
import { DISTANCE_SD_FLOOR, MAX_GENES } from './constants';
import type { Rng } from './rng';

/** Số ô nhớ của một bộ gen (2 alen × MAX_GENES). */
export const GENOME_STRIDE = MAX_GENES * 2;

/** Chỉ số các gen chung mà mọi loài động vật đều có. */
export const GENE_SPEED = 0;
export const GENE_VISION = 1;
export const GENE_SIZE = 2;
export const GENE_REPRO = 3;
export const GENE_HUE = 4;
export const GENE_LIGHT = 5;
export const GENE_COLD = 6;
/** Tên bắt buộc và thứ tự của các gen chung trong file dữ liệu loài. */
export const COMMON_GENES = [
  'speed',
  'vision',
  'size',
  'reproThreshold',
  'hue',
  'lightness',
  'coldTolerance',
] as const;

/** Định nghĩa một gen trong dữ liệu loài. */
export interface GeneSpec {
  name: string;
  /** Nhãn hiển thị. */
  label: string;
  /** Biên của giá trị alen. */
  min: number;
  max: number;
  /** Trung bình và độ lệch chuẩn của alen trong quần thể khởi tạo. */
  mean: number;
  sd: number;
  /** Gen sắc độ là đại lượng vòng (0 ≡ 1): đột biến quấn vòng thay vì kẹp biên. */
  circular?: boolean;
}

function boundAllele(value: number, spec: GeneSpec): number {
  if (spec.circular) {
    const span = spec.max - spec.min;
    let v = (value - spec.min) % span;
    if (v < 0) v += span;
    return spec.min + v;
  }
  return value < spec.min ? spec.min : value > spec.max ? spec.max : value;
}

/** Tạo bộ gen ngẫu nhiên cho một cá thể của quần thể khởi tạo. */
export function randomGenome(
  alleles: Float32Array,
  offset: number,
  specs: readonly GeneSpec[],
  rng: Rng,
  variation: number,
): void {
  for (let g = 0; g < MAX_GENES; g++) {
    const spec = specs[g];
    if (!spec) {
      alleles[offset + g * 2] = 0;
      alleles[offset + g * 2 + 1] = 0;
      continue;
    }
    alleles[offset + g * 2] = boundAllele(spec.mean + rng.gauss() * spec.sd * variation, spec);
    alleles[offset + g * 2 + 1] = boundAllele(spec.mean + rng.gauss() * spec.sd * variation, spec);
  }
}

/** Tính kiểu hình (trung bình hai alen của mỗi gen). */
export function expressGenome(
  alleles: Float32Array,
  alleleOffset: number,
  phenotype: Float32Array,
  phenotypeOffset: number,
): void {
  for (let g = 0; g < MAX_GENES; g++) {
    phenotype[phenotypeOffset + g] =
      (alleles[alleleOffset + g * 2] + alleles[alleleOffset + g * 2 + 1]) * 0.5;
  }
}

/**
 * Tạo bộ gen con từ mẹ và bố: mỗi bên cho một alen ngẫu nhiên của từng gen, rồi đột biến.
 * @param mutationRate xác suất đột biến của mỗi alen
 * @param mutationScale độ lệch chuẩn của đột biến, tính theo tỉ lệ biên độ gen
 */
export function recombine(
  motherAlleles: Float32Array,
  motherOffset: number,
  fatherAlleles: Float32Array,
  fatherOffset: number,
  childAlleles: Float32Array,
  childOffset: number,
  specs: readonly GeneSpec[],
  rng: Rng,
  mutationRate: number,
  mutationScale: number,
): void {
  for (let g = 0; g < MAX_GENES; g++) {
    const spec = specs[g];
    if (!spec) {
      childAlleles[childOffset + g * 2] = 0;
      childAlleles[childOffset + g * 2 + 1] = 0;
      continue;
    }
    let fromMother = motherAlleles[motherOffset + g * 2 + (rng.nextU32() & 1)];
    let fromFather = fatherAlleles[fatherOffset + g * 2 + (rng.nextU32() & 1)];
    if (mutationRate > 0) {
      const span = spec.max - spec.min;
      if (rng.next() < mutationRate)
        fromMother = boundAllele(fromMother + rng.gauss() * mutationScale * span, spec);
      if (rng.next() < mutationRate)
        fromFather = boundAllele(fromFather + rng.gauss() * mutationScale * span, spec);
    }
    childAlleles[childOffset + g * 2] = fromMother;
    childAlleles[childOffset + g * 2 + 1] = fromFather;
  }
}

/**
 * Khoảng cách gen giữa hai quần thể: RMS qua các gen của |Δ trung bình| / độ lệch chuẩn gộp.
 * Đơn vị là "số độ lệch chuẩn" nên so sánh được giữa các gen có thang đo khác nhau.
 */
export function populationDistance(
  meanA: ArrayLike<number>,
  varA: ArrayLike<number>,
  meanB: ArrayLike<number>,
  varB: ArrayLike<number>,
  specs: readonly GeneSpec[],
): number {
  let sum = 0;
  let genes = 0;
  for (let g = 0; g < MAX_GENES; g++) {
    const spec = specs[g];
    if (!spec) continue;
    const span = spec.max - spec.min;
    let delta = Math.abs(meanA[g] - meanB[g]);
    if (spec.circular && delta > span / 2) delta = span - delta;
    const floor = DISTANCE_SD_FLOOR * span;
    const pooled = Math.max(Math.sqrt((varA[g] + varB[g]) * 0.5), floor);
    const d = delta / pooled;
    sum += d * d;
    genes++;
  }
  return genes === 0 ? 0 : Math.sqrt(sum / genes);
}
