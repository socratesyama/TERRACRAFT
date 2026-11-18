import { describe, expect, it } from 'vitest';
import { loadData } from '../src/core/data/loader';
import { applyOp } from '../src/core/ops';
import { buildWorld, recomputeTerrainDerived, stepWorld } from '../src/core/pipeline';
import { erosionStep } from '../src/core/terrain/erosion';
import { hashWorld, type World } from '../src/core/world';

const { data } = loadData();
const q = data.runtime.hash.quantizeScale;
const SEED = data.scenarios.comparison.defaultSeed;

function world(scn = 'mountainRange', warm = 12): World {
  const w = buildWorld(data, scn, SEED, 128, { nations: false });
  for (let i = 0; i < warm; i++) {
    w.tick++;
    stepWorld(w, data, false);
  }
  return w;
}
const sum = (a: Float32Array): number => a.reduce((s, v) => s + v, 0);

describe('M10 侵食エンジン（§6）', () => {
  it('保存則: 標高の総和の変化 ＝ −(海へ出た量)。削った量 ＝ 堆積 ＋ 海へ出た量', () => {
    const w = world();
    const before = sum(w.primary.height);
    const r = erosionStep(w, data, 4);
    expect(r.removed).toBeGreaterThan(0);
    expect(r.removed).toBeCloseTo(r.deposited + r.exported, 6);
    expect(sum(w.primary.height) - before).toBeCloseTo(-r.exported, 3);
    // 輸送中の土砂は残らない
    expect(sum(w.primary.sediment)).toBe(0);
  });

  it('倍率 0 なら何も変わらない（hash が同じ）', () => {
    const w = world();
    w.params.erosionRate = 0;
    const h = hashWorld(w, q);
    const r = erosionStep(w, data, 4);
    expect(r).toEqual({ removed: 0, deposited: 0, exported: 0 });
    expect(hashWorld(w, q)).toBe(h);
  });

  it('植生が守る: 全面が森のときは、裸地のときより削れる量が少ない（伐採 → 侵食増加）', () => {
    const go = (veg: number): number => {
      const w = world();
      w.primary.vegetation.fill(veg);
      return erosionStep(w, data, 4).removed;
    };
    const bare = go(0);
    const forest = go(1);
    expect(forest).toBeLessThan(bare);
    expect(forest / bare).toBeGreaterThan(1 - data.hydrology.streamPower.vegetationShield - 0.05); // 守りの上限は vegetationShield
  });

  it('倍率に比例して削れる量が増える（陰的解法でも、小さい f では近似的に線形）', () => {
    const go = (rate: number): number => {
      const w = world();
      w.params.erosionRate = rate;
      return erosionStep(w, data, 4).removed;
    };
    const a = go(1);
    const b = go(2);
    expect(b).toBeGreaterThan(a * 1.5);
    expect(b).toBeLessThan(a * 2.05);
  });

  it('刻みに依存せず安定: 大きな dt でも標高が発散せず、範囲 0〜1 を保つ', () => {
    const w = world();
    w.params.erosionRate = data.hydrology.streamPower.rate.max;
    for (let i = 0; i < 5; i++) {
      erosionStep(w, data, 400);
      recomputeTerrainDerived(w, data);
    }
    const h = w.primary.height;
    expect(h.every((v) => Number.isFinite(v) && v >= -1e-6 && v <= 1 + 1e-6)).toBe(true);
  });

  it('拘束された（fixed）セルは削れも積もりもしない', () => {
    const w = world();
    const fixedIdx: number[] = [];
    for (let i = 0; i < w.primary.fixed.length; i += 7) {
      w.primary.fixed[i] = 1;
      fixedIdx.push(i);
    }
    const before = fixedIdx.map((i) => w.primary.height[i]!);
    erosionStep(w, data, 4);
    fixedIdx.forEach((i, k) => expect(w.primary.height[i]).toBe(before[k]));
  });

  it('河口で堆積する（三角州）: 海に近い低地では、積もった量が正のセルがある', () => {
    const w = world('riverCivilization', 20);
    for (let i = 0; i < 6; i++) {
      erosionStep(w, data, 4);
      recomputeTerrainDerived(w, data);
    }
    let dep = 0;
    for (let i = 0; i < w.primary.erosion.length; i++) if (w.primary.erosion[i]! > 1e-5) dep++;
    expect(dep).toBeGreaterThan(0);
  });

  it('斜面崩壊: 安息角を超える急な段差は、総量を変えずに緩む', () => {
    const w = world('island', 0);
    const n = w.size;
    const c = (n >> 1) * n + (n >> 1);
    w.primary.fixed.fill(0);
    w.primary.vegetation.fill(0);
    w.params.erosionRate = 1e-9; // 河川侵食を無視して、斜面崩壊だけを見る（rate > 0 でないと動かない）
    w.primary.height[c] = Math.min(1, w.primary.height[c]! + 0.5);
    recomputeTerrainDerived(w, data);
    const peak0 = w.primary.height[c]!;
    const total0 = sum(w.primary.height);
    erosionStep(w, data, 4);
    expect(w.primary.height[c]!).toBeLessThan(peak0);
    expect(Math.abs(sum(w.primary.height) - total0)).toBeLessThan(0.05 + 1e-6); // 移すだけ（河川分は微小）
  });

  it('決定論: 同じ世界に同じだけ適用すると同じ hash。Op の param で倍率を変えられる', () => {
    const a = world();
    const b = world();
    erosionStep(a, data, 4);
    erosionStep(b, data, 4);
    expect(hashWorld(a, q)).toBe(hashWorld(b, q));
    applyOp(a, data, { t: 'param', tick: 0, key: 'erosionRate', value: 999 });
    expect(a.params.erosionRate).toBe(data.hydrology.streamPower.rate.max);
    applyOp(a, data, { t: 'param', tick: 0, key: 'erosionRate', value: 0 });
    expect(a.params.erosionRate).toBe(0);
  });

  it('時間とともに進む: 200 tick 進めると、侵食の記録（erosion）に削れと堆積の両方が残る', () => {
    const w = buildWorld(data, 'mountainRange', SEED, 128, { nations: false });
    for (let i = 0; i < 120; i++) {
      w.tick++;
      stepWorld(w, data, false);
    }
    let cut = 0;
    let dep = 0;
    for (const e of w.primary.erosion) {
      if (e < -1e-5) cut++;
      if (e > 1e-5) dep++;
    }
    expect(cut).toBeGreaterThan(0);
    expect(dep).toBeGreaterThan(0);
  });
});
