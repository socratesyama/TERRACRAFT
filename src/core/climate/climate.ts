import type { DataBundle } from '../data/schema';
import { DX, DY } from '../hydrology';
import type { World } from '../world';

/**
 * 気温・水分・日照・バイオーム・植生（計画書 §7.2, §7.4〜7.6）。
 * 数値はすべて data/（climate.json, ecology-biomes.json, hydrology.json）から読む。
 * 指数関数は使わず、事前計算 LUT（乗算の反復）で決定論を保つ。
 */

/** バイオームの番号。0〜3 は計画書 §7.5 の特別な区分、4 以降は whittaker のキー順。 */
export const SPECIAL_BIOMES = ['water', 'snow', 'coast', 'wetland'] as const;

const keyCache = new WeakMap<DataBundle, readonly string[]>();
export function biomeKeys(data: DataBundle): readonly string[] {
  let k = keyCache.get(data);
  if (!k) {
    k = [...SPECIAL_BIOMES, ...Object.keys(data.ecology.biomes.whittaker)];
    keyCache.set(data, k);
  }
  return k;
}

/** 距離変換（chamfer 3-4 を 3 で割る）。source のセルから各セルまでの距離（セル単位）。 */
export function distanceTransform(size: number, source: Uint8Array, out: Float32Array): void {
  const INF = 1e9;
  const n = size * size;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = source[i] ? 0 : INF;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let v = d[i]!;
      if (x > 0) v = Math.min(v, d[i - 1]! + 3);
      if (y > 0) {
        v = Math.min(v, d[i - size]! + 3);
        if (x > 0) v = Math.min(v, d[i - size - 1]! + 4);
        if (x < size - 1) v = Math.min(v, d[i - size + 1]! + 4);
      }
      d[i] = v;
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      let v = d[i]!;
      if (x < size - 1) v = Math.min(v, d[i + 1]! + 3);
      if (y < size - 1) {
        v = Math.min(v, d[i + size]! + 3);
        if (x < size - 1) v = Math.min(v, d[i + size + 1]! + 4);
        if (x > 0) v = Math.min(v, d[i + size - 1]! + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < n; i++) out[i] = d[i]! >= INF ? INF / 3 : d[i]! / 3;
}

/** 勾配（実勾配 rise/run）と日照（§7.4）。標高が変わったときだけ再計算する。 */
export function computeSlopeAndSunlight(w: World, data: DataBundle): void {
  const { size } = w;
  const h = w.primary.height;
  const s = w.maxElevation / w.cellSize; // 正規化標高の差 → 実勾配
  const [sx, sy, sz] = data.climate.sunlight.sunDir.value as readonly number[] as [number, number, number];
  const sl = Math.hypot(sx, sy, sz);
  const { ambient, direct } = data.climate.sunlight;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xe = Math.min(size - 1, x + 1);
      const xw = Math.max(0, x - 1);
      const yn = Math.min(size - 1, y + 1);
      const ys = Math.max(0, y - 1);
      const dhdx = ((h[y * size + xe]! - h[y * size + xw]!) / (xe - xw)) * s;
      const dhdy = ((h[yn * size + x]! - h[ys * size + x]!) / (yn - ys)) * s;
      w.derived.slope[i] = Math.hypot(dhdx, dhdy);
      // 法線 (-dhdx, -dhdy, 1)。y は北向き
      const nl = Math.hypot(dhdx, dhdy, 1);
      const dot = (-dhdx * sx - dhdy * sy + sz) / (nl * sl);
      w.derived.sunlight[i] = ambient + direct * Math.max(0, dot);
    }
  }
}

/** 海のセルを 1 にしたマスク（height < seaLevel） */
function seaMask(w: World): Uint8Array {
  const m = new Uint8Array(w.size * w.size);
  for (let i = 0; i < m.length; i++) m[i] = w.primary.height[i]! < w.params.seaLevel ? 1 : 0;
  return m;
}

/** 海からの距離（気温の緩和・海岸の判定）。標高か海面が変わったときだけ再計算する。 */
export function computeDistSea(w: World): void {
  distanceTransform(w.size, seaMask(w), w.derived.distSea);
}

/** 海の緩和の LUT。乗算の反復で作る（exp を使わない）: lut[d] = (1 − decayPerCell)^d */
export function maritimeLut(decayPerCell: number, lutMax: number): Float64Array {
  const lut = new Float64Array(lutMax + 1);
  lut[0] = 1;
  for (let i = 1; i <= lutMax; i++) lut[i] = lut[i - 1]! * (1 - decayPerCell);
  return lut;
}

/** 年平均気温 °C（§7.2）。季節変化は含めない（M3 以降）。 */
export function computeTemperature(w: World, data: DataBundle): void {
  const { size } = w;
  const t = data.climate.temperature;
  const lut = maritimeLut(t.maritimeModeration.decayPerCell, t.maritimeModeration.lutMax);
  const { height, vegetation } = w.primary;
  const { temperature, distSea } = w.derived;
  for (let y = 0; y < size; y++) {
    const tSea = t.seaLevelBaseTemp.value - t.latitudeGradient.value * (y / (size - 1));
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const elevKm = (Math.max(0, height[i]! - w.params.seaLevel) * w.maxElevation) / 1000;
      let T = tSea - t.environmentalLapseRate.value * elevKm;
      const di = Math.min(t.maritimeModeration.lutMax, Math.floor(distSea[i]!));
      T += (tSea - T) * t.maritimeModeration.strength * lut[di]!;
      T -= t.vegetationCooling.value * vegetation[i]!;
      temperature[i] = T + w.params.temperatureBias;
    }
  }
}

function isSea(w: World, i: number): boolean {
  return w.primary.height[i]! < w.params.seaLevel;
}

function isLake(w: World, data: DataBundle, i: number): boolean {
  return !isSea(w, i) && w.derived.lakeDepth[i]! > data.hydrology.priorityFlood.lakeDepthMin;
}

function isRiver(w: World, data: DataBundle, i: number): boolean {
  return !isSea(w, i) && w.derived.flowAcc[i]! >= data.hydrology.river.flowThreshold;
}

/** 水分（§7.4）: 降水と水域の近さ → 3×3 平滑化を smoothPasses 回。 */
export function computeMoisture(w: World, data: DataBundle): void {
  const { size } = w;
  const n = size * size;
  const m = data.climate.moisture;
  const water = new Uint8Array(n);
  for (let i = 0; i < n; i++) water[i] = isSea(w, i) || isLake(w, data, i) || isRiver(w, data, i) ? 1 : 0;
  distanceTransform(size, water, w.derived.distWater);

  let a = new Float32Array(n);
  let b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const prox = Math.max(0, 1 - w.derived.distWater[i]! / m.waterProximityRadius.value);
    const v = (w.derived.precip[i]! / m.precipFullMm.value) * m.precipWeight + prox * m.waterProximityWeight;
    a[i] = Math.min(1, Math.max(0, v));
  }
  for (let pass = 0; pass < m.smoothPasses; pass++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            sum += a[ny * size + nx]!;
            cnt++;
          }
        }
        b[y * size + x] = sum / cnt;
      }
    }
    [a, b] = [b, a];
  }
  w.derived.moisture.set(a);
}

interface WhittakerRule {
  id: number;
  matMin: number;
  matMax: number;
  mapMin: number;
  mapMax: number;
}

const ruleCache = new WeakMap<DataBundle, WhittakerRule[]>();
function whittakerRules(data: DataBundle): WhittakerRule[] {
  let r = ruleCache.get(data);
  if (!r) {
    const keys = biomeKeys(data);
    const wh = data.ecology.biomes.whittaker as unknown as Record<string, Partial<Record<string, number>>>;
    r = keys
      .map((k, id) => ({ k, id }))
      .filter(({ id }) => id >= SPECIAL_BIOMES.length)
      .map(({ k, id }) => {
        const b = wh[k]!;
        return {
          id,
          matMin: b.matMin ?? -Infinity,
          matMax: b.matMax ?? Infinity,
          mapMin: b.mapMin ?? -Infinity,
          mapMax: b.mapMax ?? Infinity,
        };
      });
    ruleCache.set(data, r);
  }
  return r;
}

/** 箱までの正規化距離（箱の中なら 0） */
function boxDistance(r: WhittakerRule, mat: number, map: number, matScale: number, mapScale: number): number {
  const dm = Math.max(r.matMin - mat, 0, mat - r.matMax) / matScale;
  const dp = Math.max(r.mapMin - map, 0, map - r.mapMax) / mapScale;
  return dm + dp;
}

/**
 * Whittaker の気候空間（MAT × MAP）での分類。表の順に最初に当たるものを採る。
 * 表に隙間があるときは最も近い箱。前回の区分から ±hysteresis だけは前回を保つ（ちらつき防止）。
 */
export function classifyWhittaker(data: DataBundle, mat: number, map: number, prev: number): number {
  const rules = whittakerRules(data);
  const hu = data.ecology.hysteresisUnits;
  const hy = data.ecology.hysteresis;
  const matScale = hu.matK;
  const mapScale = hu.mapMm;
  if (prev >= SPECIAL_BIOMES.length) {
    const pr = rules.find((r) => r.id === prev);
    if (pr && boxDistance(pr, mat, map, matScale, mapScale) <= hy) return prev;
  }
  let best = rules[0]!;
  let bestD = Infinity;
  for (const r of rules) {
    const d = boxDistance(r, mat, map, matScale, mapScale);
    if (d === 0) return r.id;
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best.id;
}

/** バイオーム（§7.5）。上から順に判定する。 */
export function computeBiome(w: World, data: DataBundle): void {
  const sp = data.ecology.special;
  const { size } = w;
  const d = w.derived;
  const flowAccMin = data.hydrology.river.flowThreshold * sp.wetland.flowAccFactor;
  for (let i = 0; i < size * size; i++) {
    const lake = isLake(w, data, i);
    if (isSea(w, i) || lake || isRiver(w, data, i)) {
      d.biome[i] = 0;
    } else if (d.temperature[i]! < sp.snowTempC) {
      d.biome[i] = 1;
    } else if (d.distSea[i]! <= sp.coastDistanceCells && w.primary.height[i]! < w.params.seaLevel + sp.coastHeightMargin) {
      d.biome[i] = 2;
    } else if (
      d.moisture[i]! > sp.wetland.moistureMin &&
      d.slope[i]! < sp.wetland.slopeMax &&
      d.flowAcc[i]! >= flowAccMin
    ) {
      d.biome[i] = 3;
    } else {
      d.biome[i] = classifyWhittaker(data, d.temperature[i]!, d.precip[i]!, d.biome[i]!);
    }
  }
}

/** 環境収容力 Kcap（§7.6） */
export function capacityAt(w: World, data: DataBundle, i: number): number {
  const c = data.ecology.capacity;
  const tf = c.temperatureFit;
  const T = w.derived.temperature[i]!;
  const fit =
    T <= tf.minC || T >= tf.maxC
      ? 0
      : T <= tf.optimumC
        ? (T - tf.minC) / (tf.optimumC - tf.minC)
        : (tf.maxC - T) / (tf.maxC - tf.optimumC);
  const base = Math.min(
    1,
    Math.max(
      0,
      w.derived.moisture[i]! * c.moistureWeight + w.derived.sunlight[i]! * c.sunlightWeight + fit * c.temperatureWeight,
    ),
  );
  const sp = c.slopePenalty;
  const pen = 1 - sp.max * Math.min(1, Math.max(0, (w.derived.slope[i]! - sp.threshold) / sp.threshold));
  return base * pen;
}

/** 植生の成長（§7.6）。隣接平均は旧い値から読む（走査順に依存させない）。 */
export function growVegetation(w: World, data: DataBundle, dt: number): void {
  const { size } = w;
  const V = w.primary.vegetation;
  const next = w.derived.scratch;
  const veg = data.ecology.vegetation;
  const r = veg.growthRate;
  const seed = veg.seedRate;
  const decay = veg.decayRate;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (isSea(w, i) || isLake(w, data, i)) {
        next[i] = 0;
        continue;
      }
      const kcap = capacityAt(w, data, i);
      let sum = 0;
      let cnt = 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k]!;
        const ny = y + DY[k]!;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        sum += V[ny * size + nx]!;
        cnt++;
      }
      let v = V[i]!;
      if (kcap > veg.minCapacity.value) v += dt * (r * v * (1 - v / kcap) + seed * (sum / cnt));
      if (v > kcap) v -= decay * (v - kcap);
      next[i] = Math.min(1, Math.max(0, v));
    }
  }
  V.set(next);
}

/** 初期植生: 水分がしきい値を超える陸セルに initial を置く（§7.6） */
export function seedVegetation(w: World, data: DataBundle): void {
  const veg = data.ecology.vegetation;
  for (let i = 0; i < w.primary.vegetation.length; i++) {
    const land = !isSea(w, i) && !isLake(w, data, i);
    w.primary.vegetation[i] = land && w.derived.moisture[i]! > veg.initialMoistureThreshold ? veg.initial : 0;
  }
}
