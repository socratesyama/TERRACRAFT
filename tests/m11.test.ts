import { describe, expect, it } from 'vitest';
import { chaikin, closeIfNear, shapeStroke, simplifyDP } from '../src/core/geometry';
import { loadData } from '../src/core/data/loader';
import { decodeState, encodeState } from '../src/core/share';
import type { Op } from '../src/core/ops';
import { hashWorld } from '../src/core/world';
import { SimulationController } from '../src/worker/controller';
import type { FromWorker } from '../src/worker/protocol';

const { data } = loadData();
const q = data.runtime.hash.quantizeScale;
const SEED = data.scenarios.comparison.defaultSeed;
const ui = (data.runtime.ui as unknown as { contour: { widthCells: number; simplifyToleranceCells: number; chaikinPasses: number; closeDistanceCells: number; minStrokeCells: number; levels: { id: string; elevation: number }[]; defaultLevel: string } }).contour;

function circle(cx: number, cy: number, r: number, n: number): number[] {
  const p: number[] = [];
  for (let i = 0; i <= n; i++) p.push(cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n));
  return p;
}

describe('M11 等高線の整形（§13.3）', () => {
  it('Douglas–Peucker: 一直線上の点は端点だけになり、許容誤差内で形が保たれる', () => {
    const line = [0, 0, 1, 0.1, 2, -0.1, 3, 0.05, 4, 0];
    expect(simplifyDP(line, 1.5)).toEqual([0, 0, 4, 0]);
    const bent = [0, 0, 5, 0, 5, 5];
    expect(simplifyDP(bent, 1.5)).toEqual(bent);
  });

  it('Chaikin: 端点を保ち、点が増え、閉じた線は閉じたまま', () => {
    const open = [0, 0, 4, 0, 4, 4];
    const c = chaikin(open, 1);
    expect(c.slice(0, 2)).toEqual([0, 0]);
    expect(c.slice(-2)).toEqual([4, 4]);
    expect(c.length).toBeGreaterThan(open.length);
    const closed = [0, 0, 4, 0, 4, 4, 0, 0];
    const cc = chaikin(closed, 1);
    expect(cc.slice(0, 2)).toEqual(cc.slice(-2));
  });

  it('始点の近くで終えたら閉じる。遠ければ閉じない', () => {
    const near = [0, 0, 10, 0, 10, 10, 0, 3];
    const out = closeIfNear(near, ui.closeDistanceCells);
    expect(out.slice(-2)).toEqual([0, 0]);
    const far = [0, 0, 10, 0, 10, 10, 0, 9];
    expect(closeIfNear(far, ui.closeDistanceCells).slice(-2)).toEqual([0, 9]);
  });

  it('shapeStroke: 短すぎる線は捨て、円は閉じた滑らかな線になる', () => {
    const o = { simplifyTolerance: ui.simplifyToleranceCells, chaikinPasses: ui.chaikinPasses, closeDistance: ui.closeDistanceCells };
    expect(shapeStroke([0, 0, 1, 1], o, ui.minStrokeCells)).toEqual([]);
    const c = shapeStroke(circle(50, 50, 20, 60).slice(0, -2), o, ui.minStrokeCells); // 最後の点は始点の手前
    expect(c.length).toBeGreaterThan(8);
    expect(c.slice(0, 2)).toEqual(c.slice(-2));
  });
});

function drive(ops: Op[], blank = false): { c: SimulationController; msgs: FromWorker[] } {
  const msgs: FromWorker[] = [];
  let t = 0;
  const c = new SimulationController(data, (m) => msgs.push(m), () => (t += 0.01));
  c.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: 128, nations: false, ops, blank });
  return { c, msgs };
}

function contourOp(points: number[], level: string): Op {
  const lv = ui.levels.find((l) => l.id === level)!;
  return { t: 'contour', tick: 0, stroke: { points, elevation: lv.elevation, width: ui.widthCells } };
}

describe('M11 描いた等高線から世界をつくる', () => {
  const ring = circle(0.5, 0.5, 0.25, 48).map((v) => v);
  const ops = [contourOp(ring, 'coast'), contourOp(circle(0.5, 0.5, 0.1, 32), 'mountain')];

  it('白紙の海: 等高線が無ければ全部海', () => {
    const { c } = drive([], true);
    const w = c.worldRef!;
    expect(w.primary.height.every((h) => h < w.params.seaLevel)).toBe(true);
  });

  it('描いた線の上は、その標高に固定され、内側は外側より高い（山 > 海岸 > 海）', () => {
    const { c } = drive(ops);
    const w = c.worldRef!;
    const n = w.size;
    const at = (x: number, y: number): number => w.primary.height[Math.round(y * (n - 1)) * n + Math.round(x * (n - 1))]!;
    expect(at(0.5, 0.5)).toBeGreaterThan(at(0.5, 0.5 + 0.17)); // 山頂 > 山と海岸の間
    expect(at(0.5, 0.5 + 0.25)).toBeGreaterThan(w.params.seaLevel); // 海岸線は陸
    expect(at(0.02, 0.02)).toBeLessThan(w.params.seaLevel); // 外は海
    expect(w.primary.fixed.some((f) => f === 1)).toBe(true);
    // プリセットの島とは別の世界
    expect(hashWorld(w, q)).not.toBe(hashWorld(drive([]).c.worldRef!, q));
  });

  it('描いた世界は共有 URL の符号化を経由しても同じ世界（hash 一致）', () => {
    const a = drive(ops);
    a.c.handle({ type: 'step', n: 10 });
    a.c.handle({ type: 'exportState' });
    const st = a.msgs.find((m): m is Extract<FromWorker, { type: 'state' }> => m.type === 'state')!;
    expect(st.ops.filter((o) => o.t === 'contour')).toHaveLength(2);
    const shared = decodeState(data, encodeState(data, st));
    const b = drive([]);
    b.c.handle({ type: 'init', scenarioId: shared.scenarioId, seed: shared.seed, size: shared.size, nations: shared.nations, ops: shared.ops, fastForwardTo: shared.tick });
    expect(hashWorld(b.c.worldRef!, q)).toBe(hashWorld(a.c.worldRef!, q));
  });

  it('同じ線を同じ順に描けば同じ世界（決定論）', () => {
    expect(hashWorld(drive(ops).c.worldRef!, q)).toBe(hashWorld(drive(ops).c.worldRef!, q));
  });
});
