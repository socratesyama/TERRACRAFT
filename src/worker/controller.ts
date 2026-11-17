import type { DataBundle } from '../core/data/schema';
import { buildWorld } from '../core/pipeline';
import { PACK_CHANNELS, buildRenderPack, packByteLength } from '../core/renderPack';
import type { World } from '../core/world';
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
  private packCache: Float32Array | null = null;
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
        this.packCache = new Float32Array(this.world.size * this.world.size * PACK_CHANNELS);
        buildRenderPack(this.world, this.data, this.packCache);
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
      case 'op':
        this.requireWorld();
        this.opLog.push(msg.op); // 適用は M1 以降（Op は決して飛ばさない）
        return;
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

  private runTick(): void {
    const w = this.requireWorld();
    const t0 = this.now();
    // M0: 各システム（水文・気候・植生…）は M1 以降でここに接続する。
    w.tick++;
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
    if (!this.packCache) return;
    new Float32Array(buf).set(this.packCache);
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
        },
        events: [],
      },
      [buf],
    );
  }

  private requireWorld(): World {
    if (!this.world) throw new Error('world が未初期化です（先に init を送ってください）');
    return this.world;
  }
}
