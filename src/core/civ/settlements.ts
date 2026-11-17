import { biomeKeys, distanceTransform } from '../climate/climate';
import type { DataBundle } from '../data/schema';
import { emit } from '../events';
import type { Rng } from '../prng';
import type { Settlement, World } from '../world';

/**
 * 集落・文明エンジン（§8.2〜8.3）。集落はオブジェクトのリスト。人口・土地利用の配列は描画用にラスタライズする。
 * 数値はすべて data/settlements.json から読む。
 */

export const LAND_USE = { none: 0, farm: 1, village: 2, town: 3, city: 4, port: 5 } as const;

const TIER_USE = [LAND_USE.village, LAND_USE.town, LAND_USE.city, LAND_USE.port] as const;
const TIER_NAME = ['村', '町', '都市', '港町'] as const;

function isWater(w: World, data: DataBundle, i: number): boolean {
  return (
    w.primary.height[i]! < w.params.seaLevel || w.derived.lakeDepth[i]! > data.hydrology.priorityFlood.lakeDepthMin
  );
}

/** 勾配（実勾配）を、計画書の「正規化勾配」（1 セルあたりの標高差）へ直す */
function normSlope(w: World, i: number): number {
  return w.derived.slope[i]! / (w.maxElevation / w.cellSize);
}

function waterScore(d: number, min: number, max: number): number {
  if (d < min) return 0; // 水面そのものは除外
  if (d <= max) return 1;
  return Math.max(0, 1 - (d - max) / max);
}

/** 居住適性（§8.2）。水域・雪・高山の上は 0。 */
export function computeSuitability(w: World, data: DataBundle, out: Float32Array): void {
  const s = data.settlements.suitability;
  const n = w.size;
  const near = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) near[i] = w.primary.road[i]! > 0 ? 1 : 0;
  for (const c of w.settlements) near[c.y * n + c.x] = 1;
  const dTransport = new Float32Array(n * n);
  distanceTransform(n, near, dTransport);
  const keys = biomeKeys(data);
  const snow = keys.indexOf('snow');
  for (let i = 0; i < n * n; i++) {
    if (isWater(w, data, i) || w.derived.biome[i] === snow) {
      out[i] = 0;
      continue;
    }
    const water = waterScore(w.derived.distWater[i]!, s.waterLUT.optimalMinCells, s.waterLUT.optimalMaxCells);
    const g = normSlope(w, i);
    const f = s.flatness.slopeOptimalMax;
    const flat = Math.min(1, Math.max(0, 1 - (g - f) / (4 * f)));
    const transport = Math.max(0, 1 - dTransport[i]! / s.transport.radiusCells);
    out[i] =
      water * s.weights.waterProximity +
      flat * s.weights.flatness +
      w.primary.vegetation[i]! * s.weights.vegetation +
      transport * s.weights.transport -
      w.derived.floodRisk[i]! * s.floodRiskPenalty;
  }
}

export interface Catchment {
  /** 農地にできるセル（集落に近い順） */
  cells: number[];
  /** 支えられる人口 Kc */
  kc: number;
}

/**
 * 全集落の集水域（半径内の農地バイオーム）。各セルは最寄りの集落（同距離なら id が小さいほう）にだけ属する。
 * O(集落数 × 半径²)。
 */
export function computeCatchments(w: World, data: DataBundle): Map<number, Catchment> {
  const g = data.settlements.growth;
  const keys = biomeKeys(data);
  const farm = new Set<number>(
    (g.farmBiomes.value as readonly string[]).map((k) => keys.indexOf(k)).filter((i) => i >= 0),
  );
  const n = w.size;
  const R = g.catchmentRadiusCells.value;
  const bestD = new Map<number, number>();
  const bestId = new Map<number, number>();
  for (const s of w.settlements) {
    for (let y = Math.max(0, s.y - R); y <= Math.min(n - 1, s.y + R); y++) {
      for (let x = Math.max(0, s.x - R); x <= Math.min(n - 1, s.x + R); x++) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d > R) continue;
        const i = y * n + x;
        const cur = bestD.get(i);
        if (cur === undefined || d < cur || (d === cur && s.id < bestId.get(i)!)) {
          bestD.set(i, d);
          bestId.set(i, s.id);
        }
      }
    }
  }
  const byId = new Map<number, { i: number; d: number }[]>();
  for (const s of w.settlements) byId.set(s.id, []);
  for (const [i, id] of bestId) {
    const own = w.settlements.find((s) => s.id === id)!;
    if (isWater(w, data, i)) continue;
    const isHome = i === own.y * n + own.x;
    if (!isHome && !farm.has(w.derived.biome[i]!)) continue;
    byId.get(id)!.push({ i, d: bestD.get(i)! });
  }
  const out = new Map<number, Catchment>();
  for (const [id, list] of byId) {
    list.sort((a, b) => a.d - b.d || a.i - b.i);
    let kc = 0;
    for (const f of list) kc += g.carryCapFoodPerCell * Math.min(1, w.derived.moisture[f.i]! / g.moistureFullAt.value);
    out.set(id, { cells: list.map((f) => f.i), kc });
  }
  return out;
}

/** 人口・土地利用のラスタライズと、農地の植生の上限（耕作） */
export function rasterizeCiv(w: World, data: DataBundle, cat: Map<number, Catchment>): void {
  const g = data.settlements.growth;
  const { population, landUse } = w.primary;
  population.fill(0);
  landUse.fill(0);
  const farmVeg = g.farmland.vegetation.value;
  for (const s of w.settlements) {
    const cells = cat.get(s.id)?.cells ?? [];
    const need = Math.min(cells.length, Math.ceil(s.pop / g.carryCapFoodPerCell));
    for (let k = 0; k < need; k++) {
      const i = cells[k]!;
      landUse[i] = LAND_USE.farm;
      if (w.primary.vegetation[i]! > farmVeg) w.primary.vegetation[i] = farmVeg;
    }
  }
  for (const s of w.settlements) {
    const i = s.y * w.size + s.x;
    landUse[i] = TIER_USE[s.tier];
    population[i] = s.pop;
  }
}

function tierFor(w: World, data: DataBundle, s: Settlement): 0 | 1 | 2 | 3 {
  const t = data.settlements.growth.tierThresholds;
  const coastal = w.derived.distSea[s.y * w.size + s.x]! <= data.ecology.special.coastDistanceCells;
  if (s.pop >= t.town && coastal) return 3;
  if (s.pop >= t.city) return 2;
  if (s.pop >= t.town) return 1;
  return 0;
}

/** 集落を 1 つ建てる。候補は居住適性で重み付けしたPRNGで選ぶ。建てたら返す。 */
export function pickSite(w: World, data: DataBundle, rng: Rng, suit: Float32Array, exclude?: Settlement, nation?: number): number {
  const nationMode = w.nations.length > 0;
  const sp = data.settlements.spawn;
  const n = w.size;
  const cand: number[] = [];
  const weight: number[] = [];
  let total = 0;
  for (let i = 0; i < n * n; i++) {
    if (suit[i]! < sp.threshold) continue;
    if (nationMode) {
      const ow = w.primary.owner[i]!;
      if (ow === 0 || (nation !== undefined && ow !== nation)) continue;
    }
    const x = i % n;
    const y = (i / n) | 0;
    let ok = true;
    for (const o of w.settlements) {
      if (o !== exclude && Math.hypot(x - o.x, y - o.y) < sp.minDistanceCells) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    cand.push(i);
    weight.push(suit[i]!);
    total += suit[i]!;
  }
  if (cand.length === 0) return -1;
  let r = rng.next() * total;
  for (let k = 0; k < cand.length; k++) {
    r -= weight[k]!;
    if (r <= 0) return cand[k]!;
  }
  return cand[cand.length - 1]!;
}

export function found(w: World, data: DataBundle, cell: number, pop: number, note?: string): Settlement {
  const n = w.size;
  const s: Settlement = {
    id: w.civ.nextId++,
    x: cell % n,
    y: (cell / n) | 0,
    pop,
    tier: 0,
    foundedTick: w.tick,
    foodBalance: 0,
    overCapTicks: 0,
    droughtTicks: 0,
    nationId: w.primary.owner[cell]!,
    kc: 0,
  };
  w.settlements.push(s);
  // 道路で結ぶ相手: 最も近い既存の集落（最近傍グラフの辺。全体では最小全域木に近い木になる）
  let best: Settlement | null = null;
  let bd = Infinity;
  for (const o of w.settlements) {
    if (o === s) continue;
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  if (best) w.civ.roadQueue.push([best.id, s.id]);
  emit(w, data, 'settle', note ?? `新しい村ができた（${s.x}, ${s.y}、人口 ${pop}）`, s.x, s.y);
  return s;
}

/** 4 tick ごとの発生（§8.3）。上限・候補の支える人口（Kc）を確かめる。 */
export function spawnStep(w: World, data: DataBundle, rng: Rng): void {
  const sp = data.settlements.spawn;
  if (w.tick % sp.intervalTicks !== 0) return;
  if (w.settlements.length >= sp.maxSettlements.value) return;
  const suit = new Float32Array(w.size * w.size);
  computeSuitability(w, data, suit);
  // 国家モード: 発生の機会を国ごとに順番に与える（運で国の成長が決まらないように）
  const turn = w.nations.length > 0 ? ((w.tick / sp.intervalTicks) | 0) % w.nations.length + 1 : undefined;
  for (let t = 0; t < sp.maxTries.value; t++) {
    const cell = pickSite(w, data, rng, suit, undefined, turn);
    if (cell < 0) return;
    const probe: Settlement = {
      id: Number.MAX_SAFE_INTEGER,
      x: cell % w.size,
      y: (cell / w.size) | 0,
      pop: sp.initialPop,
      tier: 0,
      foundedTick: w.tick,
      foodBalance: 0,
      overCapTicks: 0,
      droughtTicks: 0,
      nationId: 0,
      kc: 0,
    };
    w.settlements.push(probe);
    const kc = computeCatchments(w, data).get(probe.id)?.kc ?? 0;
    w.settlements.pop();
    if (kc >= sp.initialPop) {
      found(w, data, cell, sp.initialPop);
      return;
    }
  }
}

/** 成長・階層・移動（§8.3）。 */
export type KcMod = (s: Settlement, kc: number) => number;

export function growthStep(w: World, data: DataBundle, rng: Rng, cat: Map<number, Catchment>, kcMod?: KcMod): void {
  const g = data.settlements.growth;
  const dis = data.disasters.drought;
  const n = w.size;
  const keep: Settlement[] = [];
  const relocate: Settlement[] = [];
  for (const s of w.settlements) {
    const i = s.y * n + s.x;
    if (isWater(w, data, i)) {
      emit(w, data, 'abandon', `${TIER_NAME[s.tier]}が水没して放棄された（人口 ${Math.round(s.pop)}）`, s.x, s.y);
      continue;
    }
    // 干ばつ（ヒステリシス）: 水分 < threshold で入り、recoveryMoisture まで続く
    const m = w.derived.moisture[i]!;
    if (s.droughtTicks === 0 && m < dis.moistureThreshold) {
      s.droughtTicks = 1;
      emit(w, data, 'drought', `干ばつが始まった（水分 ${m.toFixed(2)}）`, s.x, s.y);
    } else if (s.droughtTicks > 0) {
      if (m >= dis.recoveryMoisture) {
        s.droughtTicks = 0;
        emit(w, data, 'drought', '干ばつが明けた', s.x, s.y);
      } else s.droughtTicks++;
    }
    const kcRaw = cat.get(s.id)?.kc ?? 0;
    const penalty = Math.min(0.9, dis.foodPenaltyPerTick * s.droughtTicks);
    let kc = Math.max(1, kcRaw * (1 - penalty));
    s.kc = kc; // 農地の産出（国の食料生産の元）
    if (kcMod) kc = Math.max(1, kcMod(s, kc));
    s.foodBalance = kc - s.pop;
    s.pop = Math.max(0, s.pop + g.logisticR * s.pop * (1 - s.pop / kc));
    s.overCapTicks = s.pop > kc ? s.overCapTicks + 1 : 0;
    const tier = tierFor(w, data, s);
    if (tier > s.tier) {
      emit(w, data, 'settle', `${TIER_NAME[tier]}に昇格した（人口 ${Math.round(s.pop)}）`, s.x, s.y);
    }
    s.tier = tier;
    if (s.pop < 1) {
      emit(w, data, 'abandon', '集落が消えた（人口が尽きた）', s.x, s.y);
      continue;
    }
    // 移動: 洪水リスクが高い、または P > Kc が続く
    if (w.derived.floodRisk[i]! > g.migration.floodRiskTrigger) relocate.push(s);
    else if (s.overCapTicks >= g.migration.overCapacityTicks) {
      s.overCapTicks = 0;
      relocate.push(s);
    }
    keep.push(s);
  }
  w.settlements = keep;
  if (relocate.length === 0) return;
  const suit = new Float32Array(n * n);
  computeSuitability(w, data, suit);
  for (const s of relocate) {
    if (!w.settlements.includes(s)) continue;
    const flood = w.derived.floodRisk[s.y * n + s.x]! > g.migration.floodRiskTrigger;
    const cell = pickSite(w, data, rng, suit, s, s.nationId || undefined);
    if (cell < 0) continue;
    if (flood) {
      // 集落ごと移る
      emit(w, data, 'settle', `洪水リスクを避けて集落が移った（${s.x}, ${s.y} → ${cell % n}, ${(cell / n) | 0}）`, cell % n, (cell / n) | 0);
      s.x = cell % n;
      s.y = (cell / n) | 0;
      w.civ.roadDone = w.civ.roadDone.filter((k) => !k.split('-').includes(String(s.id)));
      w.civ.roadQueue = w.civ.roadQueue.filter((p) => p[0] !== s.id && p[1] !== s.id);
      const other = w.settlements.find((o) => o !== s);
      if (other) w.civ.roadQueue.push([other.id, s.id]);
    } else {
      const out = s.pop * g.migration.emigrantFraction.value;
      s.pop -= out;
      if (w.settlements.length >= data.settlements.spawn.maxSettlements.value) continue;
      found(w, data, cell, Math.max(out, data.settlements.spawn.initialPop), `人口があふれて新しい村ができた（${cell % n}, ${(cell / n) | 0}）`);
    }
  }
}
