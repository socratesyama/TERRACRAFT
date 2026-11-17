import { biomeKeys } from '../climate/climate';
import type { DataBundle } from '../data/schema';
import { emit } from '../events';
import type { World } from '../world';

/**
 * 道路（§8.4）。コスト = 1 + 8×傾斜² + 川(橋)6 + 森林1.5、既存道路は 0.3。湖・海は通行不可。
 * 1 tick に 1 本ぶんの経路を A* で求める（予算 budgetNodesPerTick は A* の展開数の目安。
 * 資源の途中再開はしない代わりに、ヒューリスティックで展開数を抑える）。
 */

class Heap {
  private keys: number[] = [];
  private items: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, item: number): void {
    const k = this.keys;
    const it = this.items;
    let i = k.length;
    k.push(key);
    it.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! < k[i]! || (k[p]! === k[i]! && it[p]! <= it[i]!)) break;
      [k[p], k[i]] = [k[i]!, k[p]!];
      [it[p], it[i]] = [it[i]!, it[p]!];
      i = p;
    }
  }
  pop(): number {
    const k = this.keys;
    const it = this.items;
    const top = it[0]!;
    const lk = k.pop()!;
    const li = it.pop()!;
    if (k.length > 0) {
      k[0] = lk;
      it[0] = li;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        const less = (a: number, b: number): boolean => k[a]! < k[b]! || (k[a]! === k[b]! && it[a]! < it[b]!);
        if (l < k.length && less(l, m)) m = l;
        if (r < k.length && less(r, m)) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i]!, k[m]!];
        [it[m], it[i]] = [it[i]!, it[m]!];
        i = m;
      }
    }
    return top;
  }
}

const N8: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** 経路のセル列（a → b）。通れなければ null。 */
export function findRoad(w: World, data: DataBundle, a: number, b: number): number[] | null {
  const n = w.size;
  const r = data.settlements.roads;
  const keys = biomeKeys(data);
  const forest = new Set(keys.map((k, i) => (/orest$|^boreal$/.test(k) ? i : -1)).filter((i) => i >= 0));
  const lakeMin = data.hydrology.priorityFlood.lakeDepthMin;
  const thr = data.hydrology.river.flowThreshold;
  const cost = (c: number): number => {
    if (w.primary.road[c]! > 0) return r.costExistingRoad;
    const s = w.derived.slope[c]!;
    let v = 1 + r.costSlope * s * s;
    if (w.derived.flowAcc[c]! >= thr) v += r.costRiver;
    if (forest.has(w.derived.biome[c]!)) v += r.costForest;
    return v;
  };
  const blocked = (c: number): boolean =>
    w.primary.height[c]! < w.params.seaLevel || w.derived.lakeDepth[c]! > lakeMin;
  if (blocked(a) || blocked(b)) return null;
  const bx = b % n;
  const by = (b / n) | 0;
  const h = (c: number): number => {
    const dx = Math.abs((c % n) - bx);
    const dy = Math.abs(((c / n) | 0) - by);
    return r.costExistingRoad * (Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy)); // 道路の最安コストで見積もる（許容的）
  };
  const g = new Float64Array(n * n).fill(Infinity);
  const prev = new Int32Array(n * n).fill(-1);
  const heap = new Heap();
  g[a] = 0;
  heap.push(h(a), a);
  while (heap.size > 0) {
    const c = heap.pop();
    if (c === b) break;
    const cx = c % n;
    const cy = (c / n) | 0;
    for (const [dx, dy] of N8) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const m = y * n + x;
      if (blocked(m)) continue;
      const ng = g[c]! + cost(m) * (dx !== 0 && dy !== 0 ? 1.41421356 : 1);
      if (ng < g[m]!) {
        g[m] = ng;
        prev[m] = c;
        heap.push(ng + h(m), m);
      }
    }
  }
  if (prev[b] === -1 && a !== b) return null;
  const path: number[] = [];
  for (let c = b; c !== -1; c = prev[c]!) path.push(c);
  return path.reverse();
}

/** 1 tick に 1 本、待ち行列の先頭の道路を引く。 */
export function roadStep(w: World, data: DataBundle): void {
  const q = w.civ.roadQueue;
  while (q.length > 0) {
    const [ia, ib] = q.shift()!;
    const a = w.settlements.find((s) => s.id === ia);
    const b = w.settlements.find((s) => s.id === ib);
    if (!a || !b) continue; // 片方が消えた
    const path = findRoad(w, data, a.y * w.size + a.x, b.y * w.size + b.x);
    if (!path) continue; // 海・湖に阻まれて結べない（島どうしなど）
    for (const c of path) w.primary.road[c] = 1;
    w.civ.roadDone.push(`${ia}-${ib}`);
    emit(w, data, 'road', `道路がつながった（${path.length} セル）`, b.x, b.y);
    return;
  }
}

/** 標高が変わったら、引いた道路をすべて引き直す（§8.4 の再計算の条件） */
export function resetRoads(w: World): void {
  w.primary.road.fill(0);
  const done = w.civ.roadDone.map((k) => k.split('-').map(Number) as [number, number]);
  w.civ.roadQueue = [...done, ...w.civ.roadQueue];
  w.civ.roadDone = [];
}
