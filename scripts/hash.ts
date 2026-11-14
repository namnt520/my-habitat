/**
 * In chuỗi băm trạng thái sau N tick. Bản thân mô phỏng chạy trong một worker thread (không phải luồng chính)
 * để kiểm tra rằng môi trường Worker cho cùng kết quả.
 *
 *   node scripts/run.mjs scripts/hash.ts --seed 42 --ticks 1000
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Simulation } from '../src/sim/simulation';
import { parseArgs } from './lib/report';

interface Job {
  hashSeed: number;
  hashTicks: number;
}

if (!isMainThread && workerData && typeof (workerData as Job).hashSeed === 'number') {
  const job = workerData as Job;
  const sim = new Simulation({ seed: job.hashSeed });
  sim.run(job.hashTicks);
  parentPort!.postMessage(sim.stateHash());
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const job: Job = { hashSeed: Number(args.get('seed') ?? 1), hashTicks: Number(args.get('ticks') ?? 1000) };
  const hash = await new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: job });
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  console.log(hash);
  return 0;
}
