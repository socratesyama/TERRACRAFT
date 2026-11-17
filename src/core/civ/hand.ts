import type { DataBundle } from '../data/schema';
import { NO_FLOW } from '../hydrology';
import { DX, DY } from '../hydrology';
import type { World } from '../world';

/**
 * 洪水リスクの事前計算（§8.1）。hand = 最寄りの川までの比高、drainAcc = そのセルが流れ込む川の流量。
 * 窪地充填の展開順（出口 → 上流）で、下流から順に伝える。
 */
export function computeHand(w: World, data: DataBundle): void {
  const n = w.size;
  const { order, flowDir, flowAcc, hand, drainAcc, floodRisk, lakeDepth } = w.derived;
  const h = w.primary.height;
  const thr = data.hydrology.river.flowThreshold;
  const lakeMin = data.hydrology.priorityFlood.lakeDepthMin;
  let accMax = 0;
  for (let k = 0; k < w.floodReached; k++) {
    const c = order[k]!;
    const sea = h[c]! < w.params.seaLevel;
    const lake = lakeDepth[c]! > lakeMin;
    const river = flowAcc[c]! >= thr;
    if (sea) {
      hand[c] = 0;
      drainAcc[c] = 0;
      continue;
    }
    if (lake || river) {
      hand[c] = 0;
      drainAcc[c] = flowAcc[c]!;
      accMax = Math.max(accMax, drainAcc[c]!);
      continue;
    }
    const d = flowDir[c]!;
    if (d === NO_FLOW) {
      hand[c] = 0;
      drainAcc[c] = 0;
      continue;
    }
    const r = (((c / n) | 0) + DY[d]!) * n + (c % n) + DX[d]!;
    hand[c] = Math.max(0, h[c]! - h[r]! + hand[r]!);
    drainAcc[c] = drainAcc[r]!;
  }
  const safe = data.settlements.suitability.floodRisk.handSafe;
  const denom = Math.log(1 + Math.max(accMax, 1));
  for (let i = 0; i < n * n; i++) {
    const near = 1 - Math.min(1, hand[i]! / safe);
    floodRisk[i] = near * Math.min(1, Math.log(1 + drainAcc[i]!) / denom);
  }
}
