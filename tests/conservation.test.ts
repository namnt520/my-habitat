import { describe, expect, it } from 'vitest';
import { NUTRIENT_PER_ENERGY } from '../src/sim/constants';
import { POOL_CORPSE, POOL_EXTERNAL, POOL_HEAT, POOL_SUN } from '../src/sim/ledger';
import { Simulation } from '../src/sim/simulation';

/** Sai số tương đối cho phép: chỉ là sai số làm tròn của số thực 64‑bit. */
const TOLERANCE = 1e-9;

describe('bảo toàn năng lượng và dinh dưỡng', () => {
  it('hệ sinh thái đầy đủ: mọi kho khớp sổ cái, tổng N không đổi', () => {
    const sim = new Simulation({ seed: 21 });
    const nutrientAtStart = sim.measureNutrient();
    for (let chunk = 0; chunk < 6; chunk++) {
      sim.run(150);
      const audit = sim.audit();
      for (const pool of audit.pools) {
        expect(pool.relativeError, `kho ${pool.name} ở tick ${sim.tick}`).toBeLessThan(TOLERANCE);
      }
      expect(audit.nutrientError).toBeLessThan(TOLERANCE);
    }
    expect(Math.abs(sim.measureNutrient() - nutrientAtStart) / nutrientAtStart).toBeLessThan(TOLERANCE);
    // Mô phỏng thật sự có diễn ra: có quang hợp, có hô hấp, có xác chết.
    const flow = (from: number, to: number) => sim.ledger.flows[from * sim.ledger.poolCount + to];
    expect(sim.ledger.outflow(POOL_SUN)).toBeGreaterThan(1e5);
    expect(sim.ledger.inflow(POOL_HEAT)).toBeGreaterThan(1e4);
    expect(sim.ledger.inflow(POOL_CORPSE)).toBeGreaterThan(100);
    expect(flow(POOL_HEAT, POOL_SUN)).toBe(0);
  });

  it('không có năng lượng từ hư không: tổng tồn kho = nguồn − bể chứa', () => {
    const sim = new Simulation({ seed: 8 });
    sim.run(600);
    const stocks = sim.measureStocks();
    let total = 0;
    for (let pool = POOL_CORPSE; pool < stocks.length; pool++) total += stocks[pool];
    const sources = sim.ledger.outflow(POOL_SUN) + sim.ledger.outflow(POOL_EXTERNAL);
    const sinks = sim.ledger.inflow(POOL_HEAT);
    expect(Math.abs(total - (sources - sinks)) / sources).toBeLessThan(TOLERANCE);
    // Nguồn và bể chứa không bao giờ nhận/nhả ngược chiều.
    expect(sim.ledger.inflow(POOL_SUN)).toBe(0);
    expect(sim.ledger.inflow(POOL_EXTERNAL)).toBe(0);
    expect(sim.ledger.outflow(POOL_HEAT)).toBe(0);
  });

  it('vẫn bảo toàn khi có thảm hoạ: hạn, lũ, cháy, dịch bệnh, loài xâm lấn', () => {
    const sim = new Simulation({ seed: 13 });
    const before = sim.measureNutrient();
    sim.run(120);
    sim.applyEvent({ type: 'drought', duration: 300 });
    for (let k = 0; k < 6; k++) sim.applyEvent({ type: 'fire', x: 300 + k * 250, y: 400 + k * 200 });
    sim.applyEvent({ type: 'disease', species: 'deer', fraction: 0.5 });
    sim.run(200);
    sim.applyEvent({ type: 'flood', duration: 300 });
    sim.applyEvent({ type: 'invasive', species: 'boar', count: 20, x: 900, y: 700 });
    sim.run(300);
    const audit = sim.audit();
    expect(audit.maxEnergyError).toBeLessThan(TOLERANCE);
    expect(audit.nutrientError).toBeLessThan(TOLERANCE);
    // Loài xâm lấn mang N từ ngoài vào: tổng N tăng đúng bằng lượng đó.
    const boar = sim.registry.animalByKey.get('boar')!;
    const imported = sim.ledger.flows[POOL_EXTERNAL * sim.ledger.poolCount + boar.pool];
    expect(imported).toBeGreaterThan(0);
    expect(Math.abs(sim.measureNutrient() - before - NUTRIENT_PER_ENERGY * imported) / before).toBeLessThan(
      TOLERANCE,
    );
  });

  it('kịch bản thí nghiệm Lotka–Volterra cũng bảo toàn', () => {
    const sim = new Simulation({ seed: 4, scenario: 'lotka-volterra' });
    sim.run(600);
    const audit = sim.audit();
    expect(audit.maxEnergyError).toBeLessThan(TOLERANCE);
    expect(audit.nutrientError).toBeLessThan(TOLERANCE);
  });
});
