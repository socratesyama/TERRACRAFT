import { describe, expect, it } from 'vitest';
import { tanDeg } from '../src/core/civ/disasters';
import { loadData } from '../src/core/data/loader';
import { SHOWCASE_SCENARIOS, buildWorld, stepWorld } from '../src/core/pipeline';
import { hashDerived, hashWorld, type World } from '../src/core/world';
import { SimulationController } from '../src/worker/controller';
import type { FromWorker, Op } from '../src/worker/protocol';

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

function controller(): { c: SimulationController; msgs: FromWorker[] } {
  const msgs: FromWorker[] = [];
  let t = 0;
  const c = new SimulationController(data, (m) => msgs.push(m), () => (t += 1));
  c.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: SIZE });
  return { c, msgs };
}

const fp = (c: SimulationController): string => {
  const w = c.worldRef!;
  return `${hashWorld(w, q)}/${hashDerived(w, q)}`;
};

const RAISE: Op = { t: 'raise', tick: 0, pts: [0.5, 0.5, 0.6, 0.55], r: 0.08, amount: -0.2 };

describe('M3 集落・道路・災害', () => {
  it('tanDeg は Math.tan に近い（級数）', () => {
    for (const d of [10, 22, 27, 35, 45]) expect(tanDeg(d)).toBeCloseTo(Math.tan((d * Math.PI) / 180), 9);
  });

  it.each(SHOWCASE_SCENARIOS)('%s: 同じ seed・tick 数で集落・道路を含めてハッシュが一致する', (id) => {
    const a = buildWorld(data, id, SEED, SIZE);
    const b = buildWorld(data, id, SEED, SIZE);
    run(a, 150);
    run(b, 150);
    expect(hashWorld(a, q)).toBe(hashWorld(b, q));
    expect(hashDerived(a, q)).toBe(hashDerived(b, q));
    expect(a.settlements.length).toBeGreaterThan(0);
  });

  it.each(SHOWCASE_SCENARIOS)('%s: 受け入れ基準（§8.6）発生地点は水に近く、水域の上にはなく、人口は発散しない', (id) => {
    const w = buildWorld(data, id, SEED, SIZE);
    run(w, 500);
    const n = w.size;
    let landSum = 0;
    let land = 0;
    for (let i = 0; i < n * n; i++) {
      if (w.primary.height[i]! >= w.params.seaLevel) {
        landSum += w.derived.distWater[i]!;
        land++;
      }
    }
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = w.settlements.map((s) => w.derived.distWater[s.y * n + s.x]!);
    expect(w.settlements.length).toBeGreaterThan(3);
    // 水に近い場所に建つ: 陸の平均より水に近い。ただし陸全体が水に近い盆地では、最適距離（1〜6セル）以内であればよい
    expect(mean(sd)).toBeLessThanOrEqual(Math.max(landSum / land, data.settlements.suitability.waterLUT.optimalMaxCells));
    for (const s of w.settlements) {
      const i = s.y * n + s.x;
      expect(w.primary.height[i]!).toBeGreaterThanOrEqual(w.params.seaLevel);
      expect(w.derived.lakeDepth[i]!).toBeLessThanOrEqual(data.hydrology.priorityFlood.lakeDepthMin);
      expect(Number.isFinite(s.pop)).toBe(true);
      expect(s.pop).toBeLessThan(200000);
    }
    expect(w.settlements.length).toBeLessThanOrEqual(data.settlements.spawn.maxSettlements.value + 5);
  });

  it('集落どうしは minDistance 以上離れて建つ（移動・流出を除く最初の 100 tick）', () => {
    const w = buildWorld(data, 'island', SEED, SIZE);
    run(w, 100);
    const min = data.settlements.spawn.minDistanceCells;
    for (const a of w.settlements) {
      for (const b of w.settlements) {
        if (a.id < b.id) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(min - 1e-9);
      }
    }
  });
});

describe('M3 干渉 Op・Undo/Redo・イベントログ', () => {
  it('Op を適用すると標高が変わり、イベントログに op と因果つきの結果が残る', () => {
    const { c } = controller();
    c.handle({ type: 'step', n: 60 });
    const w = c.worldRef!;
    const i = Math.round(0.5 * (w.size - 1)) * w.size + Math.round(0.5 * (w.size - 1));
    const h0 = w.primary.height[i]!;
    c.handle({ type: 'op', op: RAISE });
    expect(w.primary.height[i]!).toBeLessThan(h0);
    c.handle({ type: 'step', n: 20 });
    const opEvent = w.events.find((e) => e.kind === 'op');
    expect(opEvent?.message).toContain('山を削った');
    expect(w.events.some((e) => e.kind !== 'op' && e.causeId === 0)).toBe(true);
  });

  it('Undo で Op の直前に完全に戻り、Redo + 再実行で元の結果と一致する', () => {
    const { c } = controller();
    c.handle({ type: 'step', n: 60 });
    const before = fp(c);
    c.handle({ type: 'op', op: RAISE });
    c.handle({ type: 'step', n: 30 });
    const after = fp(c);
    c.handle({ type: 'undo' });
    expect(fp(c)).toBe(before);
    expect(c.tick).toBe(60);
    c.handle({ type: 'redo' });
    c.handle({ type: 'step', n: 30 });
    expect(fp(c)).toBe(after);
  });

  it('別のコントローラで同じ操作列を再生すると同じ結果になる（決定論）', () => {
    const seqs = [controller(), controller()];
    for (const { c } of seqs) {
      c.handle({ type: 'step', n: 40 });
      c.handle({ type: 'op', op: RAISE });
      c.handle({ type: 'op', op: { t: 'forest', tick: 0, pts: [0.3, 0.3, 0.4, 0.4], r: 0.05, amount: 0.5 } });
      c.handle({ type: 'step', n: 40 });
    }
    expect(fp(seqs[0]!.c)).toBe(fp(seqs[1]!.c));
  });

  it('植林は植生を増やし、伐採は減らす', () => {
    const { c } = controller();
    const w = c.worldRef!;
    const i = Math.round(0.4 * (w.size - 1)) * w.size + Math.round(0.4 * (w.size - 1));
    if (w.primary.height[i]! < w.params.seaLevel) return; // 海ならこの検証は意味がない
    const v0 = w.primary.vegetation[i]!;
    c.handle({ type: 'op', op: { t: 'forest', tick: 0, pts: [0.4, 0.4], r: 0.03, amount: 0.5 } });
    expect(w.primary.vegetation[i]!).toBeGreaterThan(v0);
    c.handle({ type: 'op', op: { t: 'forest', tick: 0, pts: [0.4, 0.4], r: 0.03, amount: -1 } });
    expect(w.primary.vegetation[i]!).toBe(0);
  });

  it('ダムの壁は元の標高以上で、ドライランは世界を変えない', () => {
    const { c, msgs } = controller();
    const w = c.worldRef!;
    const h = w.primary.height.slice();
    c.handle({ type: 'dryRunDam', a: [0.4, 0.5], b: [0.6, 0.5], crest: 0.1 });
    expect(msgs.some((m) => m.type === 'dryRunResult')).toBe(true);
    expect(w.primary.height).toEqual(h);
    c.handle({ type: 'op', op: { t: 'dam', tick: 0, a: [0.4, 0.5], b: [0.6, 0.5], crest: 0.1 } });
    for (let i = 0; i < h.length; i++) expect(w.primary.height[i]!).toBeGreaterThanOrEqual(h[i]!);
  });

  it('未対応の Op は error を返して世界を壊さない', () => {
    const { c, msgs } = controller();
    c.handle({ type: 'op', op: { t: 'param', tick: 0, key: 'edgeMode', value: 1 } });
    expect(msgs.some((m) => m.type === 'error')).toBe(true);
  });
});
