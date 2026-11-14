import { execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';

const TICKS = 480;

function hashAfter(seed: number, ticks: number, events?: (sim: Simulation) => void): string {
  const sim = new Simulation({ seed });
  events?.(sim);
  sim.run(ticks);
  return sim.stateHash();
}

describe('tính tất định', () => {
  it('chạy hai lần cùng seed cho trạng thái giống hệt nhau', () => {
    const a = new Simulation({ seed: 42 });
    const b = new Simulation({ seed: 42 });
    expect(a.stateHash()).toBe(b.stateHash());
    for (let chunk = 0; chunk < 4; chunk++) {
      a.run(TICKS / 4);
      b.run(TICKS / 4);
      expect(a.stateHash()).toBe(b.stateHash());
    }
    expect(a.populations()).toEqual(b.populations());
    expect(a.animals.count).toBeGreaterThan(1000);
  });

  it('seed khác nhau cho trạng thái khác nhau', () => {
    expect(hashAfter(1, 60)).not.toBe(hashAfter(2, 60));
  });

  it('chạy liền một mạch hay chia nhỏ từng tick đều cho cùng kết quả', () => {
    const whole = new Simulation({ seed: 9 });
    whole.run(200);
    const stepped = new Simulation({ seed: 9 });
    for (let k = 0; k < 200; k++) stepped.step();
    expect(stepped.stateHash()).toBe(whole.stateHash());
  });

  it('đọc trạng thái (thống kê, ảnh chụp, băm) không làm thay đổi diễn biến', () => {
    const observed = new Simulation({ seed: 5 });
    const blind = new Simulation({ seed: 5 });
    for (let k = 0; k < 10; k++) {
      observed.run(20);
      observed.collectStats();
      observed.snapshot(true);
      observed.stateHash();
      observed.audit();
      observed.stats.histogram(observed, 0);
      blind.run(20);
    }
    expect(observed.stateHash()).toBe(blind.stateHash());
  });

  it('cùng chuỗi sự kiện thảm hoạ ở cùng tick cho cùng kết quả; khác sự kiện cho kết quả khác', () => {
    const run = (withFire: boolean): string => {
      const sim = new Simulation({ seed: 3 });
      sim.run(100);
      sim.applyEvent({ type: 'drought', duration: 400 });
      if (withFire) sim.applyEvent({ type: 'fire', x: 700, y: 900 });
      sim.applyEvent({ type: 'disease', species: 'rabbit', fraction: 0.2 });
      sim.applyEvent({ type: 'invasive', species: 'boar', count: 12, x: 500, y: 500 });
      sim.run(200);
      return sim.stateHash();
    };
    expect(run(true)).toBe(run(true));
    expect(run(true)).not.toBe(run(false));
  });

  it('trong worker thread cho cùng kết quả với luồng chính', async () => {
    const expected = hashAfter(77, 240);
    // Worker nạp lại chính lõi mô phỏng qua một module nhỏ; Vitest biến đổi TypeScript cho cả worker.
    const worker = new Worker(new URL('./helpers/hash-worker.mjs', import.meta.url), {
      workerData: { seed: 77, ticks: 240 },
    });
    const actual = await new Promise<string>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    expect(actual).toBe(expected);
  });

  it('bản CLI đã đóng gói (như mã chạy trong trình duyệt) cho cùng kết quả với mã chạy qua Vitest', () => {
    const expected = hashAfter(11, 300);
    const output = execFileSync(
      'node',
      ['scripts/run.mjs', 'scripts/sim.ts', '--seed', '11', '--ticks', '300', '--progress', '0'],
      {
        encoding: 'utf8',
      },
    );
    const match = /hash ([0-9a-f]{16})/.exec(output);
    expect(match?.[1]).toBe(expected);
  });
});
