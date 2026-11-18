import type { DataBundle } from './data/schema';
import { METRICS, key } from './observe';
import { applyOp, type Op } from './ops';
import { buildWorld, refreshDirty, stepWorld } from './pipeline';
import type { ObsState } from './world';

/**
 * シナリオ比較（M5）。同じ seed で 2 つの世界（地形プリセットや初期の操作が違う）を同じ tick 数だけ進め、
 * 指標の時系列の差（Δ）と比率を出す。計算は別の World で行い、動いている世界には触れない。
 */
export interface CompareSpec {
  scenarioId: string;
  ops?: Op[];
  nations?: boolean;
}

export interface CompareRow {
  id: string;
  scope: 'world' | 'nation';
  title: string;
  unit: string;
  a: number;
  b: number;
  delta: number;
  ratio: number;
}

export interface CompareResult {
  ticks: number[];
  a: ObsState;
  b: ObsState;
  rows: CompareRow[];
  /** 最も差が大きい指標を 1 行で */
  insight: string;
  specs: [CompareSpec, CompareSpec];
}

const finalOf = (o: ObsState, k: string): number => {
  const v = o.values[k];
  return v && v.length > 0 ? v[v.length - 1]! : 0;
};

export function runComparison(
  data: DataBundle,
  specs: [CompareSpec, CompareSpec],
  seed: number,
  size: number,
  ticks: number,
  onProgress?: (done: number, total: number) => void,
): CompareResult {
  const worlds = specs.map((s) => {
    const w = buildWorld(data, s.scenarioId, seed, size, { nations: s.nations ?? true });
    for (const op of s.ops ?? []) {
      const res = applyOp(w, data, { ...op, tick: 0 });
      w.dirty |= res.dirty;
    }
    refreshDirty(w, data);
    return w;
  });
  for (let t = 0; t < ticks; t++) {
    for (const w of worlds) {
      w.tick++;
      stepWorld(w, data, false);
    }
    if (onProgress && t % 10 === 9) onProgress(t + 1, ticks);
  }
  const [a, b] = [worlds[0]!.obs, worlds[1]!.obs];
  const defs = data.observables.metrics as Record<string, { title: string; unit: string }>;
  const rows: CompareRow[] = [];
  const nA = worlds[0]!.nations.length;
  const nB = worlds[1]!.nations.length;
  for (const m of METRICS) {
    const def = defs[m.id]!;
    let va: number;
    let vb: number;
    if (m.scope === 'world') {
      va = finalOf(a, key(m.id));
      vb = finalOf(b, key(m.id));
    } else {
      if (nA === 0 || nB === 0) continue;
      const agg = (o: ObsState, n: number): number => {
        let s = 0;
        for (let i = 1; i <= n; i++) s += finalOf(o, key(m.id, i));
        return m.total === 'mean' ? s / n : s;
      };
      va = agg(a, nA);
      vb = agg(b, nB);
    }
    // 国の指標は、世界の指標と同名（人口）のとき「国の合計」として別の行にしない（重複を避ける）
    if (m.scope === 'nation' && rows.some((r) => r.id === m.id)) continue;
    rows.push({
      id: m.id, scope: m.scope, title: def.title, unit: def.unit, a: va, b: vb, delta: vb - va,
      ratio: va !== 0 ? vb / va : vb === 0 ? 1 : Infinity,
    });
  }
  // 示唆: 比が 1 から最も離れている指標（両方が極小なら除く）
  const scored = rows
    .filter((r) => Number.isFinite(r.ratio) && Math.max(Math.abs(r.a), Math.abs(r.b)) > 1e-9)
    .map((r) => ({ r, s: Math.abs(Math.log(Math.max(1e-6, r.ratio))) }))
    .sort((x, y) => y.s - x.s);
  const top = scored[0]?.r;
  const insight = top
    ? `いちばん差が大きいのは「${top.title}」（B は A の ${top.ratio.toFixed(2)} 倍）`
    : '大きな差は見つかりませんでした';
  return { ticks: a.ticks.slice(), a, b, rows, insight, specs };
}
