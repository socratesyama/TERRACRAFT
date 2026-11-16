import type { FromWorker, RenderPack, Stats, ToWorker } from './protocol';
import type { WorldEvent } from '../core/world';

export interface Snapshot {
  tick: number;
  pack: RenderPack;
  stats: Stats;
  events: WorldEvent[];
}

/**
 * メインスレッド側の Worker ラッパ。
 * 描画を終えたら必ず release(snapshot) を呼ぶ（バッファプールへ返却、バックプレッシャー解除）。
 */
export class SimulationClient {
  private readonly worker: Worker;
  onReady: (size: number) => void = () => {};
  onSnapshot: (s: Snapshot) => void = () => {};
  onError: (message: string) => void = () => {};

  constructor() {
    this.worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      switch (m.type) {
        case 'ready':
          this.onReady(m.size);
          break;
        case 'snapshot':
          this.onSnapshot({ tick: m.tick, pack: m.pack, stats: m.stats, events: m.events });
          break;
        case 'error':
          this.onError(m.message);
          break;
        default:
          break; // progress / dryRunResult は後続マイルストーンで使う
      }
    };
    this.worker.onerror = (e) => this.onError(e.message);
  }

  send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  release(s: Snapshot): void {
    this.worker.postMessage({ type: 'release', buffers: [s.pack.height] } satisfies ToWorker, [
      s.pack.height,
    ]);
  }

  terminate(): void {
    this.worker.terminate();
  }
}
