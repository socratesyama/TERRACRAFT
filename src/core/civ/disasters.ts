import type { DataBundle } from '../data/schema';
import { DX, DY } from '../hydrology';
import { emit } from '../events';
import type { Rng } from '../prng';
import { Dirty, type World } from '../world';

/**
 * 災害（§8.5）。洪水・土砂災害（干ばつは集落の成長側 settlements.growthStep で扱う）。
 * すべて原因つきでイベントログに残る。
 */

/** tan(角度[度])。三角関数に依存せず、級数で計算する（決定論） */
export function tanDeg(deg: number): number {
  const x = (deg * 3.141592653589793) / 180;
  let sin = 0;
  let cos = 0;
  let term = 1;
  for (let k = 0; k < 12; k++) {
    // cos: x^(2k)/(2k)!
    cos += (k % 2 === 0 ? 1 : -1) * term;
    term = (term * x) / (2 * k + 1);
    sin += (k % 2 === 0 ? 1 : -1) * term;
    term = (term * x) / (2 * k + 2);
  }
  return sin / cos;
}

/** 洪水: stage = k × sqrt(drainAcc) × surge（メートル）、浸水深 = max(0, stage − hand[m])。人口 −= pop × floodRisk × lossRate */
export function flood(w: World, data: DataBundle, surge: number, why: string): void {
  const f = data.disasters.flood;
  const n = w.size;
  for (const s of w.settlements) {
    const i = s.y * n + s.x;
    const stage = f.k * Math.sqrt(w.derived.drainAcc[i]!) * surge;
    const handM = w.derived.hand[i]! * w.maxElevation;
    const depth = Math.max(0, stage - handM);
    if (depth <= 0) continue;
    const loss = s.pop * w.derived.floodRisk[i]! * f.populationLossRate;
    s.pop = Math.max(0, s.pop - loss);
    emit(w, data, 'flood', `洪水（${why}）: 浸水深 ${depth.toFixed(1)} m、人口 −${Math.round(loss)}`, s.x, s.y);
  }
}

/** 自然の豪雨（確率 stormTickProb）。倍率は 1〜surgeMax */
export function stormStep(w: World, data: DataBundle, rng: Rng): void {
  const f = data.disasters.flood;
  if (rng.next() >= f.stormTickProb.value) return;
  const surge = 1 + rng.next() * (f.surgeMax - 1);
  flood(w, data, surge, `豪雨 ×${surge.toFixed(1)}`);
}

/**
 * 土砂災害: 勾配が限界角（飽和安息角 + 植生の保持力）を超えた斜面が、確率 probPerCellPerTick で崩れる。
 * 崩れた体積の volumeFactor は下流へ流れ（隣の最も低いセルに積もる）、残りも斜面下部に堆積する。
 */
export function landslideStep(w: World, data: DataBundle, rng: Rng): void {
  const L = data.disasters.landslide;
  if (w.tick % 4 !== 0) return;
  const n = w.size;
  const h = w.primary.height;
  const sat = tanDeg(L.angleOfReposeSaturated);
  const shield = tanDeg(L.angleOfReposeSaturated + L.vegetationShield) - sat;
  let count = 0;
  for (let i = 0; i < n * n && count < L.maxPerTick.value; i++) {
    if (h[i]! < w.params.seaLevel) continue;
    const limit = sat + shield * w.primary.vegetation[i]!;
    if (w.derived.slope[i]! <= limit) continue;
    if (rng.next() >= L.probPerCellPerTick.value) continue;
    // 最も低い隣接セル
    let low = -1;
    let lh = h[i]!;
    for (let k = 0; k < 8; k++) {
      const x = (i % n) + DX[k]!;
      const y = ((i / n) | 0) + DY[k]!;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      if (h[y * n + x]! < lh) {
        lh = h[y * n + x]!;
        low = y * n + x;
      }
    }
    if (low < 0) continue;
    const d = Math.min(L.slumpDepth.value, (h[i]! - lh) / 2);
    h[i] = h[i]! - d;
    h[low] = Math.min(1, h[low]! + d); // 質量は保存される（流出した土砂 volumeFactor は下流の川へ運ばれるが、M3 では隣に堆積させる）
    count++;
    w.dirty |= Dirty.Height;
    emit(w, data, 'landslide', `土砂崩れ（斜面 ${(Math.atan(w.derived.slope[i]!) * 180 / Math.PI).toFixed(0)}°、植生 ${w.primary.vegetation[i]!.toFixed(2)}）`, i % n, (i / n) | 0, { dedupe: true });
  }
}
