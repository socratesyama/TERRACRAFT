import type { CompareResult, FromWorker, RenderPack, Stats, ToWorker } from './protocol';
import type { DiploState, Nation, ObsState, Settlement, WorldEvent } from '../core/world';

export interface Snapshot {
  tick: number;
  pack: RenderPack;
  stats: Stats;
  eventsFrom: number;
  events: WorldEvent[];
  settlements: Settlement[];
  nations: Nation[];
  diplo: Pick<DiploState, 'relations' | 'proposals' | 'wars' | 'lastTrade'>;
  obs?: ObsState;
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
  onDryRun: (lakeMask: Uint8Array) => void = () => {};
  /** 失敗しても続けられる通知（外交の操作が今はできない、など） */
  onCompare: (r: CompareResult) => void = () => {};
  onProgress: (done: number, total: number) => void = () => {};
  onNotice: (message: string) => void = () => {};

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
          this.onSnapshot({
            tick: m.tick,
            pack: m.pack,
            stats: m.stats,
            eventsFrom: m.eventsFrom,
            events: m.events,
            settlements: m.settlements,
            nations: m.nations,
            diplo: m.diplo,
            obs: m.obs,
          });
          break;
        case 'error':
          this.onError(m.message);
          break;
        case 'compareResult':
          this.onCompare(m.result);
          break;
        case 'progress':
          this.onProgress(m.done, m.total);
          break;
        case 'notice':
          this.onNotice(m.message);
          break;
        case 'dryRunResult':
          this.onDryRun(m.lakeMask);
          break;
        default:
          break; // progress は後続マイルストーンで使う
      }
    };
    this.worker.onerror = (e) => this.onError(e.message);
  }

  send(msg: ToWorker): void {
    this.worker.postMessage(msg);
  }

  release(s: Snapshot): void {
    this.worker.postMessage({ type: 'release', buffers: [s.pack.data] } satisfies ToWorker, [
      s.pack.data,
    ]);
  }

  terminate(): void {
    this.worker.terminate();
  }
}
