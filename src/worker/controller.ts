import type { DataBundle } from '../core/data/schema';
import { biomeKeys } from '../core/climate/climate';
import { buildWorld, recomputeClimate, recomputeFlow, recomputePrecip, stepClimate } from '../core/pipeline';
import { buildRenderPack, packByteLength } from '../core/renderPack';
import { Dirty, type World } from '../core/world';
import { BufferPool } from './bufferPool';
import type { Op, Post, ToWorker } from './protocol';

export type BatchResult = 'busy' | 'idle' | 'stopped';

/**
 * シミュレーションの制御（Worker から切り離してテストできる形）。
 * 世界の所有者はここだけ。メインスレッドには snapshot（コピー）しか渡さない。
 * 時間の刻み・頻度・予算の数値はすべて data/runtime.json から読む。
 */
export class SimulationController {
  private world: World | null = null;
  private pool: BufferPool | null = null;
  private readonly opLog: Op[] = [];
  private running = false;
  private speed = 1;
  private lastTickAt = 0;
  private tickCarry = 0;
  private lastSnapshotAt = Number.NEGATIVE_INFINITY;
  private readonly recentTickMs: number[] = [];

  constructor(
    private readonly data: DataBundle,
    private readonly post: Post,
    private readonly now: () => number,
  ) {}

  get tick(): number {
    return this.world?.tick ?? 0;
  }
  get isRunning(): boolean {
    return this.running;
  }
  get worldRef(): World | null {
    return this.world;
  }

  handle(msg: ToWorker): void {
    try {
      this.dispatch(msg);
    } catch (e) {
      // 例外時は一時停止して error を送る（§11）
      this.running = false;
      this.post({ type: 'error', message: e instanceof Error ? e.message : String(e) }, []);
    }
  }

  private dispatch(msg: ToWorker): void {
    switch (msg.type) {
      case 'init': {
        this.world = buildWorld(this.data, msg.scenarioId, msg.seed, msg.size);
        Object.assign(this.world.params, msg.params);
        this.opLog.length = 0;
        for (const op of msg.ops ?? []) this.opLog.push(op);
        const bytes = packByteLength(this.world.size);
        this.pool = new BufferPool(bytes, this.data.runtime.snapshot.poolSize);
        this.running = false;
        this.tickCarry = 0;
        this.lastSnapshotAt = Number.NEGATIVE_INFINITY;
        this.recentTickMs.length = 0;
        this.post({ type: 'ready', size: this.world.size }, []);
        this.maybeSnapshot(true);
        return;
      }
      case 'op': {
        const w = this.requireWorld();
        this.opLog.push(msg.op); // Op は決して飛ばさない
        this.applyOp(w, msg.op);
        if (!this.running) {
          // 停止中でも、パラメータの変更はすぐ画面に出す（時間は進めない）
          if (w.dirty & Dirty.Climate) {
            recomputePrecip(w, this.data);
            recomputeFlow(w, this.data);
            recomputeClimate(w, this.data);
            w.dirty &= ~Dirty.Climate;
          }
          this.maybeSnapshot(true);
        }
        return;
      }
      case 'play':
        this.requireWorld();
        this.speed = msg.speed;
        this.running = true;
        this.lastTickAt = this.now();
        this.tickCarry = 0;
        return;
      case 'pause':
        this.running = false;
        return;
      case 'step': {
        this.requireWorld();
        for (let i = 0; i < msg.n; i++) this.runTick();
        this.maybeSnapshot(true);
        return;
      }
      case 'release':
        for (const b of msg.buffers) this.pool?.release(b);
        return;
      case 'rewind':
      case 'dryRunDam':
        this.post({ type: 'error', message: `${msg.type} は M3 で実装予定です` }, []);
        return;
    }
  }

  /**
   * 1バッチ分の計算。時間切れ（runtime.worker.sliceMs）で手を止めるので、
   * 重い計算の最中でも届いた Op や停止命令を先に処理できる（§10.4）。
   */
  runBatch(): BatchResult {
    if (!this.running || !this.world) return 'stopped';
    const { sliceMs } = this.data.runtime.worker;
    const { ticksPerSecondAt1x } = this.data.runtime.playback;
    const start = this.now();
    this.tickCarry += ((start - this.lastTickAt) / 1000) * ticksPerSecondAt1x * this.speed;
    this.lastTickAt = start;

    let ran = 0;
    while (this.tickCarry >= 1 && this.now() - start < sliceMs) {
      this.runTick();
      this.tickCarry -= 1;
      ran++;
    }
    // 追いつけない分は捨てる（速度を自動的に落として表示する §10.2）
    if (this.tickCarry >= 1) this.tickCarry = 0;

    this.maybeSnapshot(false);
    return ran > 0 ? 'busy' : 'idle';
  }

  /** Op の適用。M2 ではパラメータ（降水倍率・気温補正）だけ。ほかの Op は M3 で実装する。 */
  private applyOp(w: World, op: Op): void {
    if (op.t !== 'param') return;
    if (op.key === 'rainfallScale' || op.key === 'temperatureBias') {
      w.params[op.key] = op.value;
      w.dirty |= Dirty.Climate;
      return;
    }
    throw new Error(`パラメータ ${op.key} の変更は M3 で実装予定です`);
  }

  private runTick(): void {
    const w = this.requireWorld();
    const t0 = this.now();
    w.tick++;
    stepClimate(w, this.data, this.avgTickMs() > this.data.runtime.tick.budgetMs);
    const { degradeWindowTicks } = this.data.runtime.schedule;
    this.recentTickMs.push(this.now() - t0);
    if (this.recentTickMs.length > degradeWindowTicks) this.recentTickMs.shift();
  }

  private avgTickMs(): number {
    const n = this.recentTickMs.length;
    return n === 0 ? 0 : this.recentTickMs.reduce((a, b) => a + b, 0) / n;
  }

  /** スナップショットの発行。最大 maxHz、バッファが返却されるまで次は送らない（バックプレッシャー） */
  private maybeSnapshot(force: boolean): void {
    const w = this.world;
    const pool = this.pool;
    if (!w || !pool) return;
    const t = this.now();
    const minInterval = 1000 / this.data.runtime.snapshot.maxHz;
    if (!force && t - this.lastSnapshotAt < minInterval) return;
    const buf = pool.acquire();
    if (!buf) return; // 前のスナップショットが返却されていない
    buildRenderPack(w, this.data, new Float32Array(buf));
    this.lastSnapshotAt = t;
    const avg = this.avgTickMs();
    this.post(
      {
        type: 'snapshot',
        tick: w.tick,
        pack: { size: w.size, data: buf },
        stats: {
          tick: w.tick,
          avgTickMs: avg,
          degraded: avg > this.data.runtime.tick.budgetMs,
          ...this.worldStats(w),
        },
        events: [],
      },
      [buf],
    );
  }

  private worldStats(w: World): { vegetation: number; biomeShare: number[] } {
    const share = new Array<number>(biomeKeys(this.data).length).fill(0);
    let veg = 0;
    let land = 0;
    const n = w.size * w.size;
    for (let i = 0; i < n; i++) {
      share[w.derived.biome[i]!]!++;
      if (w.primary.height[i]! >= w.params.seaLevel) {
        veg += w.primary.vegetation[i]!;
        land++;
      }
    }
    return { vegetation: land > 0 ? veg / land : 0, biomeShare: share.map((c) => c / n) };
  }

  private requireWorld(): World {
    if (!this.world) throw new Error('world が未初期化です（先に init を送ってください）');
    return this.world;
  }
}
