/**
 * Lớp bọc Worker cho luồng giao diện: gửi lệnh có kiểu, nhận dữ liệu qua callback.
 */
import type { SimEvent } from '../sim/disasters';
import type { SimParams } from '../sim/params';
import type { InspectInfo, Scenario } from '../sim/simulation';
import type { FromWorker, ToWorker, WorldMeta } from './protocol';

type FrameMessage = Extract<FromWorker, { type: 'frame' }>;
type StatsMessage = Extract<FromWorker, { type: 'stats' }>;

export interface SimClientHandlers {
  onReady(meta: WorldMeta): void;
  onFrame(message: FrameMessage): void;
  onStats(message: StatsMessage): void;
  onInspect(info: InspectInfo | null): void;
}

export class SimClient {
  private readonly worker: Worker;
  private framePending = false;
  private hashWaiters: ((result: { tick: number; hash: string; ms: number }) => void)[] = [];

  constructor(handlers: SimClientHandlers) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      switch (message.type) {
        case 'ready':
          handlers.onReady(message.meta);
          break;
        case 'frame':
          this.framePending = false;
          handlers.onFrame(message);
          break;
        case 'stats':
          handlers.onStats(message);
          break;
        case 'inspect':
          handlers.onInspect(message.info);
          break;
        case 'hash':
          this.hashWaiters.shift()?.(message);
          break;
      }
    };
  }

  private send(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  /** Khởi tạo (hoặc khởi tạo lại) mô phỏng. */
  init(seed: number, scenario: Scenario, params?: Partial<SimParams>): void {
    this.framePending = false;
    this.send({ type: 'init', seed, scenario, params });
  }

  /** Đặt tốc độ: số tick/giây (0 = dừng, Infinity = nhanh nhất có thể). */
  setSpeed(ticksPerSecond: number): void {
    this.send({ type: 'speed', ticksPerSecond });
  }

  /** Xin một ảnh chụp để vẽ; bỏ qua nếu yêu cầu trước chưa được trả lời (tự điều tiết). */
  requestFrame(fields: boolean): void {
    if (this.framePending) return;
    this.framePending = true;
    this.send({ type: 'frame', fields });
  }

  sendEvent(event: SimEvent): void {
    this.send({ type: 'event', event });
  }

  setParam(key: keyof SimParams, value: number | boolean): void {
    this.send({ type: 'param', key, value });
  }

  inspect(id: number): void {
    this.send({ type: 'inspect', id });
  }

  /** Băm trạng thái hiện tại. */
  hash(): Promise<{ tick: number; hash: string; ms: number }> {
    return new Promise((resolve) => {
      this.hashWaiters.push(resolve);
      this.send({ type: 'hash' });
    });
  }

  /** Chạy đúng N tick ngay rồi trả về băm và thời gian chạy (để kiểm chứng tất định, đo hiệu năng). */
  run(ticks: number): Promise<{ tick: number; hash: string; ms: number }> {
    return new Promise((resolve) => {
      this.hashWaiters.push(resolve);
      this.send({ type: 'run', ticks });
    });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
