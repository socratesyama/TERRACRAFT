import { DX, DY } from '../hydrology';
import type { DataBundle } from '../data/schema';
import type { World } from '../world';

/**
 * 侵食エンジン（計画書 §6）。
 *  6.1 河川侵食 E = K·A^m·S^n（n = 1 の陰的解法。刻みに依存せず安定）
 *  6.2 土砂の輸送と堆積（運搬能力を超えた分を堆積。河口に三角州ができる）
 *  6.3 斜面崩壊（安息角を超えた分の半分を低い側へ）
 * 係数はすべて data/hydrology.json（streamPower / sediment / slopeStability）から読む。
 * 保存則: 削った総量 ＝ 堆積した総量 ＋ 海へ出た総量（熱的侵食は移すだけなので総量を変えない）。
 */
export interface ErosionReport {
  removed: number;
  deposited: number;
  exported: number;
}

const SQRT2 = Math.SQRT2;

/** 河川侵食。order の正順（出口側から上流へ）に、受け手の新しい標高を使って陰的に解く */
function streamPower(w: World, data: DataBundle, dt: number, rate: number): number {
  const n = w.size;
  const sp = data.hydrology.streamPower;
  const { height, vegetation, sediment, fixed, erosion } = w.primary;
  const { flowDir, flowAcc, lakeDepth, order } = w.derived;
  const lakeMin = data.hydrology.priorityFlood.lakeDepthMin;
  let removed = 0;
  for (let j = 0; j < w.floodReached; j++) {
    const c = order[j]!;
    const d = flowDir[c]!;
    if (d === 255 || fixed[c] || height[c]! <= w.params.seaLevel || lakeDepth[c]! > lakeMin) continue; // 海・湖・拘束セルは削らない
    const r = (((c / n) | 0) + DY[d]!) * n + (c % n) + DX[d]!;
    const kEff = sp.K * rate * (1 - sp.vegetationShield * vegetation[c]!);
    const f = (kEff * dt * Math.pow(flowAcc[c]!, sp.m)) / (d & 1 ? SQRT2 : 1);
    const base = Math.max(height[r]!, w.params.seaLevel); // 侵食の基準面は海面（陸が海面より下まで削れて、領土に水域ができることはない）
    const next = (height[c]! + f * base) / (1 + f);
    const cut = Math.max(0, height[c]! - next);
    height[c] = next;
    erosion[c] = erosion[c]! - cut;
    sediment[c] = sediment[c]! + cut;
    removed += cut;
  }
  return removed;
}

/** 土砂の輸送と堆積。order の逆順（上流から下流）。戻り値は [堆積, 海へ出た量] */
function transport(w: World, data: DataBundle): [number, number] {
  const n = w.size;
  const sd = data.hydrology.sediment;
  const { height, sediment, fixed, erosion } = w.primary;
  const { flowDir, flowAcc, slope, order } = w.derived;
  let deposited = 0;
  let exported = 0;
  for (let j = w.floodReached - 1; j >= 0; j--) {
    const c = order[j]!;
    let load = sediment[c]!;
    sediment[c] = 0;
    const d = flowDir[c]!;
    const sea = height[c]! <= w.params.seaLevel;
    if (!sea && !fixed[c]) {
      const cap = sd.capacityK * Math.pow(flowAcc[c]!, sd.m) * slope[c]!;
      if (load > cap) {
        const dep = Math.min((load - cap) * sd.depositRate, 1 - height[c]!); // 標高は 1 を超えない（残りは下流へ運ぶので、保存則は保たれる）
        height[c] = height[c]! + dep;
        erosion[c] = erosion[c]! + dep;
        deposited += dep;
        load -= dep;
      }
    }
    if (d === 255) {
      exported += load;
      continue;
    }
    if (sea) {
      // 海に入った土砂は、そこで沈む（陸の収支としては「海へ出た」）
      exported += load;
      continue;
    }
    const r = (((c / n) | 0) + DY[d]!) * n + (c % n) + DX[d]!;
    sediment[r] = sediment[r]! + load;
  }
  return [deposited, exported];
}

/** 斜面崩壊（熱的侵食）。差分配列に書いてから一括で適用する（順序依存を避ける）。総量は変わらない */
function relax(w: World, data: DataBundle, delta: Float32Array): void {
  const n = w.size;
  const ss = data.hydrology.slopeStability;
  const cell = data.scale.cellSize.value;
  const maxE = data.scale.maxElevation.value;
  const tanRepose = Math.tan((ss.angleOfReposeDry.value * Math.PI) / 180);
  const { height, fixed, erosion } = w.primary;
  for (let pass = 0; pass < ss.relaxPasses; pass++) {
    delta.fill(0);
    for (let c = 0; c < n * n; c++) {
      if (height[c]! <= w.params.seaLevel) continue;
      const x = c % n;
      const y = (c / n) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k]!;
        const ny = y + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const m = ny * n + nx;
        const dist = (k & 1 ? SQRT2 : 1) * cell;
        const diff = height[c]! - height[m]!;
        const lim = (tanRepose * dist) / maxE;
        if (diff <= lim || fixed[c] || fixed[m]) continue;
        const mv = (diff - lim) / 2 / 8; // 超過分の半分を、八方に分けて低い側へ
        delta[c] = delta[c]! - mv;
        delta[m] = delta[m]! + mv;
      }
    }
    for (let c = 0; c < n * n; c++) {
      if (delta[c] !== 0) {
        height[c] = height[c]! + delta[c]!;
        erosion[c] = erosion[c]! + delta[c]!;
      }
    }
  }
}

let scratch: Float32Array | null = null;

/**
 * 1 回の侵食ステップ（dt tick ぶんをまとめて適用）。標高が変わるので流向・勾配を引き直す（道路は引き直さない）。
 * 実行頻度は runtime.json schedule.erosionIntervalTicks（高速モードは Degraded 側）。
 */
export function erosionStep(w: World, data: DataBundle, dt: number): ErosionReport {
  const rate = w.params.erosionRate;
  if (rate <= 0) return { removed: 0, deposited: 0, exported: 0 };
  const removed = streamPower(w, data, dt, rate);
  const [deposited, exported] = transport(w, data);
  if (!scratch || scratch.length !== w.size * w.size) scratch = new Float32Array(w.size * w.size);
  relax(w, data, scratch);
  return { removed, deposited, exported };
}
