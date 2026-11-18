import { describe, expect, it } from 'vitest';
import { loadData } from '../src/core/data/loader';
import type { Op } from '../src/core/ops';
import { decodeState, encodeState, fromBase64Url, quantizeOp, ShareError, toBase64Url, type ShareState } from '../src/core/share';
import { hashWorld } from '../src/core/world';
import { SimulationController } from '../src/worker/controller';
import type { FromWorker } from '../src/worker/protocol';

const { data } = loadData();
const q = data.runtime.hash.quantizeScale;
const SEED = data.scenarios.comparison.defaultSeed;
const SIZE = 128;

function curve(n: number, ox: number, oy: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < n; i++) pts.push(ox + 0.013 * i + 0.001 * ((i * 7) % 5), oy + 0.2 * Math.sin(i / 5) * 0.3);
  return pts;
}

function bigState(): ShareState {
  const ops: Op[] = [];
  for (let i = 0; i < 30; i++) ops.push({ t: 'contour', tick: 0, stroke: { points: curve(30, 0.05 + (i % 5) * 0.01, 0.2 + i * 0.02), elevation: 0.1 + (i % 7) * 0.1, width: 0.02 } });
  for (let i = 0; i < 50; i++) ops.push({ t: 'raise', tick: i, pts: curve(3, 0.3, 0.4 + i * 0.004), r: 0.05, amount: 0.04 });
  ops.push({ t: 'dam', tick: 60, a: [0.3, 0.4], b: [0.34, 0.41], crest: 0.2 });
  ops.push({ t: 'param', tick: 61, key: 'peaceMode', value: 1 });
  ops.push({ t: 'rain', tick: 62, amount: 3 });
  ops.push({ t: 'diplo', tick: 63, action: 'embargo', to: 2 });
  ops.push({ t: 'diplo', tick: 64, action: 'respond', proposalId: 3, accept: true });
  ops.push({ t: 'military', tick: 65, mobilization: 0.5 });
  ops.push({ t: 'fill', tick: 66, pts: curve(2, 0.5, 0.5), r: 0.04 });
  return { scenarioId: 'basin', seed: SEED, size: SIZE, nations: true, ops: ops.map((o) => quantizeOp(data, o)), tick: 70 };
}

describe('M8 共有の符号化', () => {
  it('復元すると入力と完全に一致し、再符号化しても同じバイト列（不動点）', () => {
    const st = bigState();
    const bytes = encodeState(data, st);
    const back = decodeState(data, bytes);
    expect(back).toEqual(st);
    expect(Array.from(encodeState(data, back))).toEqual(Array.from(bytes));
  });

  it('base64url の往復と、計画書の目標（8,000 文字）に余裕で収まる', () => {
    const bytes = encodeState(data, bigState());
    const s = toBase64Url(bytes);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Array.from(fromBase64Url(s))).toEqual(Array.from(bytes));
    expect(s.length + 3).toBeLessThan(data.runtime.share.maxChars.value);
  });

  it('壊れたデータは ShareError（検査値・切断・版・未知のシナリオ）', () => {
    const bytes = encodeState(data, bigState());
    const bad = bytes.slice();
    bad[10] = bad[10]! ^ 0x55;
    expect(() => decodeState(data, bad)).toThrow(ShareError);
    expect(() => decodeState(data, bytes.slice(0, 5))).toThrow(ShareError);
    expect(() => decodeState(data, bytes.slice(0, bytes.length - 7))).toThrow(ShareError);
    expect(() => fromBase64Url('abc$')).toThrow(ShareError);
    expect(() => encodeState(data, { ...bigState(), scenarioId: 'nope' })).toThrow(ShareError);
  });
});

describe('M8 共有からの再現（決定論）', () => {
  it('高速モードで進んだ世界は exact=false で共有される（再現が完全には一致しないことを正直に伝える）', () => {
    const msgs: FromWorker[] = [];
    let t = 0;
    const c = new SimulationController(data, (m) => msgs.push(m), () => (t += 1000));
    c.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: SIZE, nations: false });
    c.handle({ type: 'step', n: 15 });
    c.handle({ type: 'exportState' });
    const st = msgs.find((m): m is Extract<FromWorker, { type: 'state' }> => m.type === 'state')!;
    expect(st.exact).toBe(false);
  });

  function drive(): { c: SimulationController; msgs: FromWorker[] } {
    const msgs: FromWorker[] = [];
    let t = 0;
    const c = new SimulationController(data, (m) => msgs.push(m), () => (t += 0.01)); // 速い時計: 高速モードに入らない
    return { c, msgs };
  }

  it('操作しながら進めた世界と、URL の状態から「現在の時点」で開いた世界が一致する', () => {
    const a = drive();
    a.c.handle({ type: 'init', scenarioId: 'basin', seed: SEED, size: SIZE, nations: true });
    a.c.handle({ type: 'op', op: { t: 'raise', tick: 0, pts: [0.5, 0.5003, 0.52, 0.5], r: 0.0501, amount: 0.0401 } });
    a.c.handle({ type: 'step', n: 12 });
    a.c.handle({ type: 'op', op: { t: 'rain', tick: 0, amount: 2.00001 } });
    a.c.handle({ type: 'step', n: 8 });
    a.c.handle({ type: 'op', op: { t: 'forest', tick: 0, pts: [0.3, 0.3, 0.32, 0.31], r: 0.05, amount: -0.5 } });
    a.c.handle({ type: 'step', n: 10 });
    a.c.handle({ type: 'exportState' });
    const st = a.msgs.find((m): m is Extract<FromWorker, { type: 'state' }> => m.type === 'state')!;
    expect(st.tick).toBe(30);
    expect(st.exact).toBe(true);
    expect(st.ops.map((o) => o.tick)).toEqual([0, 12, 20]);

    // 符号化を経由しても同じ
    const shared = decodeState(data, encodeState(data, st));
    const b = drive();
    b.c.handle({ type: 'init', scenarioId: shared.scenarioId, seed: shared.seed, size: shared.size, nations: shared.nations, ops: shared.ops, fastForwardTo: shared.tick });
    expect(b.c.worldRef!.tick).toBe(30);
    expect(hashWorld(b.c.worldRef!, q)).toBe(hashWorld(a.c.worldRef!, q));
    expect(b.msgs.some((m) => m.type === 'progress')).toBe(true);
  });

  it('「設計図のみ」は tick 0 の Op だけで始まり、早送りには上限がある', () => {
    const b = drive();
    const ops: Op[] = [
      { t: 'raise', tick: 0, pts: [0.5, 0.5, 0.52, 0.5], r: 0.05, amount: 0.04 },
      { t: 'rain', tick: 5, amount: 2 },
    ];
    b.c.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: SIZE, nations: false, ops });
    expect(b.c.worldRef!.tick).toBe(0);
    expect(b.c.worldRef!.events.filter((e) => e.kind === 'op')).toHaveLength(1);
    const cap = data.runtime.share.maxFastForwardTicks.value;
    const d = structuredClone(data);
    d.runtime.share.maxFastForwardTicks.value = 12;
    const c2 = new SimulationController(d, () => undefined, () => 0);
    c2.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: SIZE, nations: false, ops, fastForwardTo: 9999 });
    expect(c2.worldRef!.tick).toBe(12);
    expect(cap).toBeGreaterThan(12);
  });
});
