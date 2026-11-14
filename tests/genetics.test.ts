import { describe, expect, it } from 'vitest';
import { MAX_GENES } from '../src/sim/constants';
import {
  GENOME_STRIDE,
  type GeneSpec,
  expressGenome,
  populationDistance,
  randomGenome,
  recombine,
} from '../src/sim/genetics';
import { Rng } from '../src/sim/rng';

const specs: GeneSpec[] = [
  { name: 'speed', label: 'Tốc độ', min: 0.5, max: 1.5, mean: 1, sd: 0.05 },
  { name: 'hue', label: 'Sắc độ', min: 0, max: 1, mean: 0.1, sd: 0.02, circular: true },
];

describe('genetics', () => {
  it('kiểu hình là trung bình hai alen', () => {
    const alleles = new Float32Array(GENOME_STRIDE);
    alleles[0] = 0.8;
    alleles[1] = 1.2;
    const phenotype = new Float32Array(MAX_GENES);
    expressGenome(alleles, 0, phenotype, 0);
    expect(phenotype[0]).toBeCloseTo(1.0, 6);
  });

  it('không đột biến: mỗi alen của con đến từ đúng một bên bố mẹ (phân li Mendel)', () => {
    const rng = new Rng(1);
    const mother = new Float32Array(GENOME_STRIDE);
    const father = new Float32Array(GENOME_STRIDE);
    mother.set([0.6, 0.7], 0);
    father.set([1.3, 1.4], 0);
    const child = new Float32Array(GENOME_STRIDE);
    const seenMother = new Set<number>();
    const seenFather = new Set<number>();
    for (let i = 0; i < 200; i++) {
      recombine(mother, 0, father, 0, child, 0, specs, rng, 0, 0);
      expect([mother[0], mother[1]]).toContain(child[0]);
      expect([father[0], father[1]]).toContain(child[1]);
      seenMother.add(child[0]);
      seenFather.add(child[1]);
    }
    expect(seenMother.size).toBe(2);
    expect(seenFather.size).toBe(2);
  });

  it('đột biến giữ alen trong biên; gen vòng thì quấn vòng', () => {
    const rng = new Rng(2);
    const parent = new Float32Array(GENOME_STRIDE);
    parent.set([1.49, 1.5, 0.01, 0.99], 0);
    const child = new Float32Array(GENOME_STRIDE);
    for (let i = 0; i < 2000; i++) {
      recombine(parent, 0, parent, 0, child, 0, specs, rng, 1, 0.2);
      expect(child[0]).toBeGreaterThanOrEqual(0.5);
      expect(child[0]).toBeLessThanOrEqual(1.5);
      expect(child[2]).toBeGreaterThanOrEqual(0);
      expect(child[2]).toBeLessThan(1);
    }
  });

  it('không có chọn lọc thì trung bình gen không trôi có hướng và phương sai được giữ', () => {
    const rng = new Rng(3);
    const n = 2000;
    let pop = new Float32Array(n * GENOME_STRIDE);
    for (let i = 0; i < n; i++) randomGenome(pop, i * GENOME_STRIDE, specs, rng, 1);
    const stats = (p: Float32Array) => {
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < n; i++) {
        const v = (p[i * GENOME_STRIDE] + p[i * GENOME_STRIDE + 1]) / 2;
        sum += v;
        sumSq += v * v;
      }
      const mean = sum / n;
      return { mean, variance: sumSq / n - mean * mean };
    };
    const before = stats(pop);
    for (let gen = 0; gen < 30; gen++) {
      const next = new Float32Array(n * GENOME_STRIDE);
      for (let i = 0; i < n; i++) {
        recombine(
          pop,
          rng.int(n) * GENOME_STRIDE,
          pop,
          rng.int(n) * GENOME_STRIDE,
          next,
          i * GENOME_STRIDE,
          specs,
          rng,
          0,
          0,
        );
      }
      pop = next;
    }
    const after = stats(pop);
    expect(Math.abs(after.mean - before.mean)).toBeLessThan(0.01);
    // Di truyền hoà trộn sẽ làm phương sai còn ~0 sau 30 thế hệ; Mendel giữ lại phần lớn.
    expect(after.variance).toBeGreaterThan(before.variance * 0.6);
  });

  it('khoảng cách quần thể: 0 khi giống nhau, tăng theo độ lệch trung bình, xử lý gen vòng', () => {
    const mean = [1, 0.05];
    const variance = [0.0025, 0.0004];
    expect(populationDistance(mean, variance, mean, variance, specs)).toBe(0);
    const near = populationDistance(mean, variance, [1.05, 0.05], variance, specs);
    const far = populationDistance(mean, variance, [1.2, 0.05], variance, specs);
    expect(far).toBeGreaterThan(near);
    // Sắc độ 0,05 và 0,95 cách nhau 0,1 trên vòng tròn chứ không phải 0,9.
    const wrap = populationDistance([1, 0.05], variance, [1, 0.95], variance, specs);
    const direct = populationDistance([1, 0.05], variance, [1, 0.15], variance, specs);
    expect(wrap).toBeCloseTo(direct, 5);
  });
});
