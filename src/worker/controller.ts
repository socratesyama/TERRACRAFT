import type { DataBundle } from '../core/data/schema';
import { biomeKeys } from '../core/climate/climate';
import { flood } from '../core/civ/disasters';
import { emit } from '../core/events';
import { restoreWorld, snapshotWorld, type WorldSnapshot } from '../core/history';
import { applyOp, type Op } from '../core/ops';
import { buildWorld, refreshDirty, stepWorld } from '../core/pipeline';
import { findOutlets, priorityFlood } from '../core/hydrology';
import { buildRenderPack, packByteLength } from '../core/renderPack';
import type { World } from '../core/world';
import { BufferPool } from './bufferPool';
import type { Post, ToWorker } from './protocol';

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
  /** Op を適用する直前のスナップショット（Undo 用リング §9.3） */
  private ring: { opIndex: number; snap: WorldSnapshot }[] = [];
  private redoStack: Op[] = [];
  private lastSentSeq = 0;
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
        this.ring = [];
        this.redoStack = [];
        this.lastSentSeq = 0;
        for (const op of msg.ops ?? []) this.commitOp(this.world, op, false);
        refreshDirty(this.world, this.data);
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
        this.redoStack = [];
        this.commitOp(w, msg.op, true);
        return;
      }
      case 'undo':
        this.undo();
        return;
      case 'redo':
        this.redo();
        return;
      case 'dryRunDam':
        this.dryRunDam(msg.a, msg.b, msg.crest);
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

  /**
   * Op を 1 つ適用する。適用の直前にスナップショットを取り（Undo 用）、ログへ積み、
   * 因果の紐づけ用に直近の Op として記録する。停止中なら再計算してすぐ画面に出す（時間は進めない）。
   */
  private commitOp(w: World, input: Op, refresh: boolean): void {
    const op: Op = { ...input, tick: w.tick };
    const opIndex = this.opLog.length;
    this.ring.push({ opIndex, snap: snapshotWorld(w) });
    if (this.ring.length > this.data.runtime.history.snapshotRing) this.ring.shift();
    this.opLog.push(op);
    const res = applyOp(w, this.data, op);
    w.dirty |= res.dirty;
    emit(w, this.data, 'op', res.message, res.x, res.y);
    w.civ.recentOps.push({ id: opIndex, tick: w.tick, x: res.x, y: res.y });
    if (w.civ.recentOps.length > 8) w.civ.recentOps.shift();
    if (res.surge !== undefined) flood(w, this.data, res.surge, `豪雨 ×${res.surge.toFixed(1)}`);
    if (refresh && !this.running) {
      refreshDirty(w, this.data);
      this.maybeSnapshot(true);
    }
  }

  private undo(): void {
    const w = this.requireWorld();
    const last = this.ring.pop();
    if (!last) return;
    this.redoStack.push(this.opLog[last.opIndex]!);
    this.opLog.length = last.opIndex;
    restoreWorld(w, last.snap);
    this.lastSentSeq = Math.min(this.lastSentSeq, w.civ.eventSeq);
    this.afterHistoryChange();
  }

  private redo(): void {
    const w = this.requireWorld();
    const op = this.redoStack.pop();
    if (!op) return;
    const keep = this.redoStack.slice();
    this.commitOp(w, op, true);
    this.redoStack = keep; // commitOp は redo を消さない（消すのは新しい Op のとき）
    if (this.running) this.maybeSnapshot(true);
  }

  private afterHistoryChange(): void {
    this.running = false;
    this.maybeSnapshot(true);
  }

  /** ダムの予測（§9.2 ドライラン）: 適用したと仮定して窪地充填だけ走らせ、新しくできる湖のマスクを返す。世界は変えない。 */
  private dryRunDam(a: readonly [number, number], b: readonly [number, number], crest: number): void {
    const w = this.requireWorld();
    const n = w.size;
    const height = w.primary.height.slice();
    const tmp = { ...w, primary: { ...w.primary, height } } as World;
    applyOp(tmp, this.data, { t: 'dam', tick: w.tick, a, b, crest });
    const lakeDepth = new Float32Array(n * n);
    const outlet = findOutlets(n, height, w.params.seaLevel, w.params.edgeMode);
    priorityFlood(n, height, outlet, this.data.hydrology.priorityFlood.eps, {
      filled: new Float32Array(n * n),
      flowDir: new Uint8Array(n * n),
      order: new Int32Array(n * n),
      lakeDepth,
    });
    const min = this.data.hydrology.priorityFlood.lakeDepthMin;
    const mask = new Uint8Array(n * n);
    for (let i = 0; i < mask.length; i++) {
      if (lakeDepth[i]! > min && w.derived.lakeDepth[i]! <= min && height[i]! >= w.params.seaLevel) mask[i] = 1;
    }
    this.post({ type: 'dryRunResult', lakeMask: mask }, [mask.buffer]);
  }

  private runTick(): void {
    const w = this.requireWorld();
    const t0 = this.now();
    w.tick++;
    stepWorld(w, this.data, this.avgTickMs() > this.data.runtime.tick.budgetMs);
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
    const from = this.lastSentSeq;
    this.lastSentSeq = w.civ.eventSeq;
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
        eventsFrom: from,
        events: w.events.filter((e) => (e.seq ?? 0) >= from),
        settlements: w.settlements.map((c) => ({ ...c })),
      },
      [buf],
    );
  }

  private worldStats(w: World): { vegetation: number; biomeShare: number[]; undoDepth: number; redoDepth: number } {
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
    return {
      vegetation: land > 0 ? veg / land : 0,
      biomeShare: share.map((c) => c / n),
      undoDepth: this.ring.length,
      redoDepth: this.redoStack.length,
    };
  }

  private requireWorld(): World {
    if (!this.world) throw new Error('world が未初期化です（先に init を送ってください）');
    return this.world;
  }
}
