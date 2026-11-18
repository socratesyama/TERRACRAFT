import { describe, expect, it } from 'vitest';
import { runComparison } from '../src/core/compare';
import { loadData } from '../src/core/data/loader';
import { METRICS, key } from '../src/core/observe';
import { applyOp } from '../src/core/ops';
import { restoreWorld, snapshotWorld } from '../src/core/history';
import { buildWorld, stepWorld } from '../src/core/pipeline';
import { buildRenderPack, packByteLength, takeBaseline } from '../src/core/renderPack';
import { hashWorld, type World } from '../src/core/world';
import { SimulationController } from '../src/worker/controller';
import type { FromWorker } from '../src/worker/protocol';

const { data } = loadData();
const q = data.runtime.hash.quantizeScale;
const SEED = data.scenarios.comparison.defaultSeed;
const SIZE = 128;

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    w.tick++;
    stepWorld(w, data, false);
  }
}

describe('M5 観測量', () => {
  it('記録する指標はすべて observables.json に定義がある（先に定義する規則）', () => {
    const defs = data.observables.metrics as Record<string, unknown>;
    for (const m of METRICS) expect(defs[m.id]).toBeDefined();
  });

  it('everyTicks ごとに記録され、全系列の長さが ticks と同じで、maxSamples を超えない', () => {
    const w = buildWorld(data, 'island', SEED, SIZE, { nations: true });
    run(w, 100);
    const every = data.runtime.observe.everyTicks.value;
    expect(w.obs.ticks).toHaveLength(Math.floor(100 / every));
    for (const v of Object.values(w.obs.values)) expect(v).toHaveLength(w.obs.ticks.length);
    expect(w.obs.values[key('population', 1)]!.every(Number.isFinite)).toBe(true);
    const d = structuredClone(data);
    d.runtime.observe.maxSamples.value = 5;
    const w2 = buildWorld(d, 'island', SEED, SIZE, { nations: true });
    for (let i = 0; i < 60; i++) {
      w2.tick++;
      stepWorld(w2, d, false);
    }
    expect(w2.obs.ticks).toHaveLength(5);
  });

  it('時系列は決定論的で、Undo（スナップショット復元）で巻き戻る', () => {
    const a = buildWorld(data, 'basin', SEED, SIZE, { nations: true });
    const b = buildWorld(data, 'basin', SEED, SIZE, { nations: true });
    run(a, 60);
    run(b, 60);
    expect(JSON.stringify(a.obs)).toBe(JSON.stringify(b.obs));
    const snap = snapshotWorld(a);
    const n = a.obs.ticks.length;
    run(a, 40);
    expect(a.obs.ticks.length).toBeGreaterThan(n);
    restoreWorld(a, snap);
    expect(a.obs.ticks).toHaveLength(n);
    expect(hashWorld(a, q)).toBe(hashWorld(b, q));
  });
});

describe('M5 シナリオ比較', () => {
  it('同じ seed・同じ設定の比較は差がゼロ、地形が違えば差が出て、示唆が 1 行返る', () => {
    const same = runComparison(data, [{ scenarioId: 'island' }, { scenarioId: 'island' }], SEED, SIZE, 40);
    for (const r of same.rows) expect(r.delta).toBe(0);
    const diff = runComparison(data, [{ scenarioId: 'island' }, { scenarioId: 'mountainRange' }], SEED, SIZE, 40);
    expect(diff.rows.some((r) => r.delta !== 0)).toBe(true);
    expect(diff.insight).toContain('いちばん差が大きいのは');
    expect(diff.ticks.length).toBeGreaterThan(0);
  });

  it('「同じ世界で 1 つだけ変える」: 降水倍率を変えると降水の指標が変わる', () => {
    const r = runComparison(
      data,
      [{ scenarioId: 'basin' }, { scenarioId: 'basin', ops: [{ t: 'param', tick: 0, key: 'rainfallScale', value: 1.5 }] }],
      SEED,
      SIZE,
      20,
    );
    const p = r.rows.find((x) => x.id === 'annualPrecipitation')!;
    expect(p.ratio).toBeGreaterThan(1.2);
  });

  it('比較は動いている世界を変えない（Worker）', () => {
    const msgs: FromWorker[] = [];
    let t = 0;
    const c = new SimulationController(data, (m) => msgs.push(m), () => (t += 1));
    c.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: SIZE });
    const h = hashWorld(c.worldRef!, q);
    c.handle({ type: 'compare', a: { scenarioId: 'island' }, b: { scenarioId: 'basin' }, ticks: 20 });
    expect(msgs.some((m) => m.type === 'compareResult')).toBe(true);
    expect(hashWorld(c.worldRef!, q)).toBe(h);
  });
});

describe('M5 変化マップ（因果トレーサ）', () => {
  it('基準と同じなら 0、標高を変えた所だけ値が立つ', () => {
    const w = buildWorld(data, 'island', SEED, SIZE, { nations: true });
    const base = takeBaseline(w);
    const out = new Float32Array(packByteLength(SIZE) / 4);
    buildRenderPack(w, data, out, base);
    const alpha = (i: number) => out[SIZE * SIZE * 4 * 3 + i * 4 + 3]!;
    for (let i = 0; i < SIZE * SIZE; i++) expect(alpha(i)).toBe(0);
    applyOp(w, data, { t: 'raise', tick: 0, pts: [0.5, 0.5, 0.52, 0.5], r: 0.05, amount: 0.2 });
    buildRenderPack(w, data, out, base);
    let changed = 0;
    for (let i = 0; i < SIZE * SIZE; i++) if (alpha(i) > 0) changed++;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(SIZE * SIZE * 0.3);
  });

  it('操作のあと、スナップショットの変化マップは操作した場所に出る（Worker は直前を基準にする）', () => {
    const msgs: FromWorker[] = [];
    let t = 0;
    const c = new SimulationController(data, (m) => msgs.push(m), () => (t += 1000));
    c.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: SIZE });
    c.handle({ type: 'op', op: { t: 'raise', tick: 0, pts: [0.5, 0.5, 0.52, 0.5], r: 0.05, amount: 0.2 } });
    const snaps = msgs.filter((m): m is Extract<FromWorker, { type: 'snapshot' }> => m.type === 'snapshot');
    const last = snaps[snaps.length - 1]!;
    const f = new Float32Array(last.pack.data);
    let changed = 0;
    for (let i = 0; i < SIZE * SIZE; i++) if (f[SIZE * SIZE * 4 * 3 + i * 4 + 3]! > 0) changed++;
    expect(changed).toBeGreaterThan(0);
  });
});

describe('M5 因果トレーサ', () => {
  it('op イベントは通し番号 opId を持ち、結果のイベントの causeId と対応する', () => {
    const msgs: FromWorker[] = [];
    let t = 0;
    const c = new SimulationController(data, (m) => msgs.push(m), () => (t += 1000));
    c.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: SIZE });
    c.handle({ type: 'op', op: { t: 'raise', tick: 0, pts: [0.5, 0.5, 0.55, 0.5], r: 0.06, amount: 0.3 } });
    c.handle({ type: 'op', op: { t: 'rain', tick: 0, amount: 3 } });
    const ev = c.worldRef!.events;
    const ops = ev.filter((e) => e.kind === 'op');
    expect(ops.map((e) => e.opId)).toEqual([0, 1]);
    const effects = ev.filter((e) => e.causeId !== undefined);
    expect(effects.length).toBeGreaterThan(0);
    for (const e of effects) expect([0, 1]).toContain(e.causeId);
  });
});
