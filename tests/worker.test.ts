import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { loadData } from '../src/core/data/loader';
import { hashWorld } from '../src/core/world';
import { BufferPool } from '../src/worker/bufferPool';
import { SimulationController } from '../src/worker/controller';
import type { FromWorker, ToWorker } from '../src/worker/protocol';

const { data } = loadData();
const { snapshot, worker: workerCfg, playback, hash } = data.runtime;

function setup(autoIncrement = 0) {
  let t = 0;
  const sent: FromWorker[] = [];
  const buffers: ArrayBuffer[] = [];
  const c = new SimulationController(
    data,
    (msg, transfer) => {
      sent.push(msg);
      buffers.push(...transfer);
    },
    () => (t += autoIncrement),
  );
  return {
    c,
    sent,
    buffers,
    advance: (ms: number) => {
      t += ms;
    },
    snapshots: () => sent.filter((m) => m.type === 'snapshot'),
    send: (m: ToWorker) => c.handle(m),
  };
}

describe('BufferPool', () => {
  it('capacity 本だけ貸し出せ、空なら undefined（バックプレッシャー）', () => {
    const pool = new BufferPool(16, 2);
    const a = pool.acquire();
    const b = pool.acquire();
    expect(a && b).toBeTruthy();
    expect(pool.acquire()).toBeUndefined();
    expect(pool.release(a!)).toBe(true);
    expect(pool.acquire()).toBeDefined();
  });

  it('サイズ違いと余剰の返却は受け取らない', () => {
    const pool = new BufferPool(16, 1);
    expect(pool.release(new ArrayBuffer(8))).toBe(false);
    expect(pool.release(new ArrayBuffer(16))).toBe(false); // すでに満杯
  });

  it('性質: 任意の貸出・返却の列で available + inFlight = capacity', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 200 }), (steps) => {
        const pool = new BufferPool(8, 3);
        const held: ArrayBuffer[] = [];
        for (const acquire of steps) {
          if (acquire) {
            const b = pool.acquire();
            if (b) held.push(b);
          } else {
            const b = held.pop();
            if (b) pool.release(b);
          }
          expect(pool.available + pool.inFlight).toBe(pool.capacity);
          expect(held.length).toBe(pool.inFlight);
        }
      }),
    );
  });
});

describe('SimulationController（Workerプロトコル）', () => {
  it('init で ready と初期スナップショットを返す', () => {
    const s = setup();
    s.send({ type: 'init', seed: 42, size: 128 });
    expect(s.sent[0]).toEqual({ type: 'ready', size: 128 });
    const snap = s.snapshots()[0];
    expect(snap?.type === 'snapshot' && snap.tick).toBe(0);
  });

  it('バックプレッシャー: 返却しない限り poolSize 本以上は送らない', () => {
    const s = setup();
    s.send({ type: 'init', seed: 1, size: 128 });
    for (let i = 0; i < 20; i++) s.send({ type: 'step', n: 1 });
    expect(s.snapshots().length).toBe(snapshot.poolSize);
    s.send({ type: 'release', buffers: [s.buffers[0]] });
    s.send({ type: 'step', n: 1 });
    expect(s.snapshots().length).toBe(snapshot.poolSize + 1);
  });

  it('再生: 1x は ticksPerSecondAt1x、スナップショットは maxHz 以下', () => {
    const s = setup();
    s.send({ type: 'init', seed: 1, size: 128 });
    s.send({ type: 'play', speed: 1 });
    const before = s.snapshots().length;
    for (let i = 0; i < 100; i++) {
      s.advance(10);
      s.c.runBatch();
      // メイン側が描画し終えたつもりで返却する
      for (const b of s.buffers.splice(0)) s.send({ type: 'release', buffers: [b] });
    }
    // 10ms × 100 = 1秒
    expect(s.c.tick).toBe(playback.ticksPerSecondAt1x);
    expect(s.snapshots().length - before).toBeLessThanOrEqual(snapshot.maxHz + 1);
  });

  it('pause で tick が止まる', () => {
    const s = setup();
    s.send({ type: 'init', seed: 1, size: 128 });
    s.send({ type: 'play', speed: 16 });
    s.advance(1000);
    s.c.runBatch();
    const t = s.c.tick;
    expect(t).toBeGreaterThan(0);
    s.send({ type: 'pause' });
    s.advance(1000);
    expect(s.c.runBatch()).toBe('stopped');
    expect(s.c.tick).toBe(t);
  });

  it('時間切れ: 遅れが大きくても1バッチは sliceMs 付近で手を止める', () => {
    const s = setup(1); // now() が呼ばれるたびに1ms進む
    s.send({ type: 'init', seed: 1, size: 128 });
    s.send({ type: 'play', speed: 16 });
    s.advance(100000); // 800000 tick 分の遅れ
    expect(s.c.runBatch()).toBe('busy');
    expect(s.c.tick).toBeGreaterThan(0);
    expect(s.c.tick).toBeLessThanOrEqual(workerCfg.sliceMs);
  });

  it('init 前の操作は error を返して一時停止する', () => {
    const s = setup();
    s.send({ type: 'step', n: 1 });
    expect(s.sent[0]?.type).toBe('error');
    expect(s.c.isRunning).toBe(false);
  });

  it('決定論: 同じ seed・同じ操作列なら一次状態のハッシュが一致する', () => {
    const run = () => {
      const s = setup();
      s.send({ type: 'init', seed: 42, size: 128 });
      s.send({ type: 'step', n: 100 });
      return hashWorld(s.c.worldRef!, hash.quantizeScale);
    };
    expect(run()).toBe(run());
  });
});
