import { biomeKeys } from './climate/climate';
import type { DataBundle } from './data/schema';
import type { World, WorldEvent } from './world';

/**
 * イベントログ（§9.4）。リング（runtime.events.ringMax）に積み、直近の Op があれば causeId を付ける。
 * 同じ種類の検出イベントは dedupeTicks に1回まで。
 */
export function emit(
  w: World,
  data: DataBundle,
  kind: WorldEvent['kind'],
  message: string,
  x?: number,
  y?: number,
  opts: { dedupe?: boolean } = {},
): boolean {
  const ev = data.runtime.events;
  if (opts.dedupe) {
    const last = w.civ.lastEmit[kind];
    if (last !== undefined && w.tick - last < ev.dedupeTicks) return false;
  }
  w.civ.lastEmit[kind] = w.tick;
  const cause = [...w.civ.recentOps].reverse().find((o) => w.tick - o.tick <= ev.causeWindowTicks);
  const e: WorldEvent = { tick: w.tick, kind, message, seq: w.civ.eventSeq++ };
  if (x !== undefined && y !== undefined) {
    e.x = x;
    e.y = y;
  } else if (cause && cause.x !== undefined && cause.y !== undefined && kind !== 'op') {
    e.x = cause.x;
    e.y = cause.y;
  }
  if (cause && kind !== 'op') e.causeId = cause.id;
  w.events.push(e);
  if (w.events.length > ev.ringMax) w.events.splice(0, w.events.length - ev.ringMax);
  return true;
}

/** 川の総延長（川のセル数）、湖の数（4近傍の連結成分）、森林率・砂漠率（陸に対する割合） */
export function measure(w: World, data: DataBundle): { riverCells: number; lakes: number; forestShare: number; desertShare: number } {
  const n = w.size;
  const { flowThreshold } = data.hydrology.river;
  const lakeMin = data.hydrology.priorityFlood.lakeDepthMin;
  const keys = biomeKeys(data);
  const forest = new Set(keys.map((k, i) => (/orest$|^boreal$/.test(k) ? i : -1)).filter((i) => i >= 0));
  const desert = keys.indexOf('desert');
  let river = 0;
  let land = 0;
  let forestN = 0;
  let desertN = 0;
  const lakeMask = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (w.primary.height[i]! < w.params.seaLevel) continue;
    land++;
    if (w.derived.lakeDepth[i]! > lakeMin) lakeMask[i] = 1;
    else if (w.derived.flowAcc[i]! >= flowThreshold) river++;
    if (forest.has(w.derived.biome[i]!)) forestN++;
    if (w.derived.biome[i] === desert) desertN++;
  }
  // 湖の数: 連結成分
  let lakes = 0;
  const stack: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (lakeMask[i] !== 1) continue;
    lakes++;
    stack.push(i);
    lakeMask[i] = 2;
    while (stack.length > 0) {
      const c = stack.pop()!;
      const cx = c % n;
      const cy = (c / n) | 0;
      const nb = [cx > 0 ? c - 1 : -1, cx < n - 1 ? c + 1 : -1, cy > 0 ? c - n : -1, cy < n - 1 ? c + n : -1];
      for (const m of nb) {
        if (m >= 0 && lakeMask[m] === 1) {
          lakeMask[m] = 2;
          stack.push(m);
        }
      }
    }
  }
  return { riverCells: river, lakes, forestShare: land ? forestN / land : 0, desertShare: land ? desertN / land : 0 };
}

const pct = (v: number): string => `${(v * 100).toFixed(0)}%`;

/** 検出器（§9.4）。基準値からの変化がしきい値を超えたらログへ出し、基準値を更新する。 */
export function detect(w: World, data: DataBundle): void {
  const m = measure(w, data);
  const b = w.civ.baseline;
  if (!b) {
    w.civ.baseline = m;
    return;
  }
  if (b.riverCells > 0 && Math.abs(m.riverCells - b.riverCells) / b.riverCells > 0.1) {
    if (emit(w, data, 'river', `川の総延長が ${b.riverCells} → ${m.riverCells} セルに変わった`, undefined, undefined, { dedupe: true })) {
      b.riverCells = m.riverCells;
    }
  }
  if (m.lakes !== b.lakes) {
    const msg = m.lakes > b.lakes ? `湖ができた（${b.lakes} → ${m.lakes} 個）` : `湖が消えた（${b.lakes} → ${m.lakes} 個）`;
    if (emit(w, data, 'lake', msg, undefined, undefined, { dedupe: true })) b.lakes = m.lakes;
  }
  if (Math.abs(m.forestShare - b.forestShare) >= 0.03) {
    const msg = `森林率が ${pct(b.forestShare)} → ${pct(m.forestShare)} に${m.forestShare > b.forestShare ? '増えた' : '減った'}`;
    if (emit(w, data, 'forest', msg, undefined, undefined, { dedupe: true })) b.forestShare = m.forestShare;
  }
  if (Math.abs(m.desertShare - b.desertShare) >= 0.03) {
    const msg = `砂漠が ${pct(b.desertShare)} → ${pct(m.desertShare)} に${m.desertShare > b.desertShare ? '広がった' : '狭まった'}`;
    if (emit(w, data, 'desert', msg, undefined, undefined, { dedupe: true })) b.desertShare = m.desertShare;
  }
}
