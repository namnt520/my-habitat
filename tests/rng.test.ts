import { describe, expect, it } from 'vitest';
import { dcos, dsin, pow34 } from '../src/sim/detmath';
import { Rng, seedFromString } from '../src/sim/rng';

describe('Rng', () => {
  it('cùng seed cho cùng dãy số', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('seed khác nhau cho dãy khác nhau', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.nextU32() === b.nextU32()) same++;
    expect(same).toBe(0);
  });

  it('dãy số cố định theo seed (chống hồi quy thuật toán)', () => {
    const r = new Rng(12345);
    expect([r.nextU32(), r.nextU32(), r.nextU32()]).toEqual([1977310364, 4106765030, 1538400628]);
  });

  it('next() đều trong [0, 1)', () => {
    const r = new Rng(7);
    const buckets = new Array<number>(10).fill(0);
    const n = 100_000;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      buckets[Math.floor(v * 10)]++;
      sum += v;
    }
    expect(sum / n).toBeCloseTo(0.5, 2);
    for (const count of buckets) expect(Math.abs(count - n / 10)).toBeLessThan(n * 0.01);
  });

  it('gauss() có trung bình 0 và phương sai 1', () => {
    const r = new Rng(99);
    const n = 200_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = r.gauss();
      sum += v;
      sumSq += v * v;
    }
    expect(sum / n).toBeCloseTo(0, 2);
    expect(sumSq / n).toBeCloseTo(1, 1);
  });

  it('khôi phục trạng thái thì tiếp tục đúng dãy', () => {
    const r = new Rng(5);
    r.next();
    const state = r.getState();
    const expected = [r.nextU32(), r.nextU32()];
    r.setState(state);
    expect([r.nextU32(), r.nextU32()]).toEqual(expected);
  });

  it('seedFromString: số giữ nguyên, chữ được băm ổn định', () => {
    expect(seedFromString('42')).toBe(42);
    expect(seedFromString('rừng')).toBe(seedFromString('rừng'));
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
  });
});

describe('detmath', () => {
  it('dsin/dcos khớp Math.sin/cos tới 1e-6', () => {
    for (let x = -20; x <= 20; x += 0.137) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-6);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-6);
    }
  });

  it('pow34 khớp x^0.75', () => {
    for (const x of [0.01, 1, 20, 500, 1200]) expect(pow34(x)).toBeCloseTo(x ** 0.75, 9);
  });
});
