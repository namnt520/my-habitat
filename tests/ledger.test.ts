import { describe, expect, it } from 'vitest';
import {
  Ledger,
  POOL_CORPSE,
  POOL_DETRITUS,
  POOL_EXTERNAL,
  POOL_FIRST_SPECIES,
  POOL_HEAT,
  POOL_SUN,
} from '../src/sim/ledger';

describe('Ledger', () => {
  const grass = POOL_FIRST_SPECIES;
  const rabbit = POOL_FIRST_SPECIES + 1;

  it('tồn kho kỳ vọng = tổng vào − tổng ra', () => {
    const ledger = new Ledger(['grass', 'rabbit']);
    ledger.flow(POOL_SUN, grass, 100);
    ledger.flow(grass, rabbit, 30);
    ledger.flow(rabbit, POOL_HEAT, 12);
    ledger.flow(rabbit, POOL_DETRITUS, 15);
    expect(ledger.balance(grass)).toBe(70);
    expect(ledger.balance(rabbit)).toBe(3);
    expect(ledger.balance(POOL_DETRITUS)).toBe(15);
    expect(ledger.inflow(POOL_HEAT)).toBe(12);
  });

  it('kiểm toán khớp khi tồn kho đo được đúng bằng sổ cái', () => {
    const ledger = new Ledger(['grass', 'rabbit']);
    ledger.flow(POOL_EXTERNAL, grass, 50);
    ledger.flow(POOL_SUN, grass, 25);
    ledger.flow(grass, rabbit, 10);
    const measured = new Float64Array(ledger.poolCount);
    measured[grass] = 65;
    measured[rabbit] = 10;
    for (const pool of ledger.audit(measured)) expect(pool.relativeError).toBe(0);
  });

  it('kiểm toán phát hiện năng lượng sinh ra từ hư không', () => {
    const ledger = new Ledger(['grass', 'rabbit']);
    ledger.flow(POOL_SUN, grass, 100);
    const measured = new Float64Array(ledger.poolCount);
    measured[grass] = 100;
    measured[rabbit] = 5; // thỏ có 5 E mà sổ cái không ghi nguồn nào
    const audit = ledger.audit(measured);
    const rabbitAudit = audit.find((pool) => pool.name === 'rabbit')!;
    expect(rabbitAudit.expected).toBe(0);
    expect(rabbitAudit.relativeError).toBeGreaterThan(1);
    expect(audit.find((pool) => pool.name === 'grass')!.relativeError).toBe(0);
  });

  it('kiểm toán phát hiện năng lượng biến mất không ghi sổ', () => {
    const ledger = new Ledger(['grass']);
    ledger.flow(POOL_SUN, grass, 100);
    ledger.flow(grass, POOL_CORPSE, 40);
    const measured = new Float64Array(ledger.poolCount);
    measured[grass] = 60;
    measured[POOL_CORPSE] = 30; // mất 10 E
    const corpse = ledger.audit(measured).find((pool) => pool.name === 'corpse')!;
    expect(corpse.relativeError).toBeCloseTo(10 / 40, 10);
  });
});
