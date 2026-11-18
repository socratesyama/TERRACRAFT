import { erosionStep } from './terrain/erosion';
import { stepObs } from './observe';
import { aiStep, diploStep } from './nations/diplomacy';
import { econStep, initEconomy, nationsKcMod, tradeStep } from './nations/economy';
import { setupNations } from './nations/territory';
import { armyStep, warStep } from './nations/war';
import { computeHand } from './civ/hand';
import { flood, landslideStep, stormStep } from './civ/disasters';
import { resetRoads, roadStep } from './civ/roads';
import { computeCatchments, growthStep, rasterizeCiv, spawnStep } from './civ/settlements';
import { detect } from './events';
import { createRng, deriveSeed } from './prng';
import {
  computeBiome,
  computeDistSea,
  computeMoisture,
  computeSlopeAndSunlight,
  computeTemperature,
  growVegetation,
  seedVegetation,
} from './climate/climate';
import { computePrecip, windTravelIndex } from './climate/precip';
import type { DataBundle } from './data/schema';
import { accumulateFlow, computeRunoff, findOutlets, priorityFlood } from './hydrology';
import { generateHeight, type TerrainParams } from './terrain/generate';
import type { Contour } from './terrain/rasterize';
import { Dirty, allocWorld, type World } from './world';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface Scenario {
  id: string;
  title: string;
  preset: string;
  windName: string;
  climateOverrides: DeepPartial<DataBundle['climate']>;
}

export const SHOWCASE_SCENARIOS = ['island', 'mountainRange', 'basin'] as const;

export function resolveScenario(data: DataBundle, id: string): Scenario {
  const all = data.scenarios.scenarios as unknown as Record<
    string,
    { title: string; terrainPreset: string; windDirection: string; climateOverrides?: object }
  >;
  const s = all[id];
  if (!s) throw new RangeError(`未知のシナリオ: ${id}`);
  return {
    id,
    title: s.title,
    preset: s.terrainPreset,
    windName: s.windDirection,
    climateOverrides: (s.climateOverrides ?? {}) as Scenario['climateOverrides'],
  };
}

function mergeClimatePrecip(
  base: DataBundle['climate']['precip'],
  overrides: Scenario['climateOverrides'],
): DataBundle['climate']['precip'] {
  return { ...base, ...(overrides.precip ?? {}) } as DataBundle['climate']['precip'];
}

export function terrainParams(data: DataBundle): TerrainParams {
  const t = data.terrain;
  return {
    iterations: t.relaxation.iterations,
    noise: {
      octaves: t.noise.octaves,
      gain: t.noise.gain,
      lacunarity: t.noise.lacunarity,
      baseFrequency: t.noise.baseFrequency,
      amplitude: t.noise.amplitude,
      R: t.noise.R,
    },
    smoothPasses: t.postProcess.smoothPasses,
  };
}

/** 等高線（プリセット）から地形を作る（Dirty.Height を立てる） */
export function buildTerrain(w: World, data: DataBundle, scenario: Scenario): void {
  const preset = (data.terrain.presets as unknown as Record<string, { contours: Contour[] }>)[
    scenario.preset
  ];
  if (!preset) throw new RangeError(`未知の地形プリセット: ${scenario.preset}`);
  generateHeight(
    w.size,
    preset.contours,
    w.seed,
    terrainParams(data),
    w.primary.height,
    w.primary.fixed,
  );
  w.params.windDir = windTravelIndex(scenario.windName);
  w.dirty |= Dirty.Height;
}

/** 窪地充填・湖・流向（標高が変わったとき）と、標高だけで決まる勾配・日照・海からの距離。 */
export function recomputeTerrainDerived(w: World, data: DataBundle): void {
  const d = w.derived;
  const outlet = findOutlets(w.size, w.primary.height, w.params.seaLevel, w.params.edgeMode);
  w.floodReached = priorityFlood(w.size, w.primary.height, outlet, data.hydrology.priorityFlood.eps, {
    filled: d.filled,
    flowDir: d.flowDir,
    order: d.order,
    lakeDepth: d.lakeDepth,
  });
  computeSlopeAndSunlight(w, data);
  computeDistSea(w);
  w.dirty &= ~Dirty.Height;
}

/** 降水（§7.3）。湖は水蒸気の供給源なので窪地充填のあとで計算する。 */
export function recomputePrecip(w: World, data: DataBundle): void {
  const scenario = resolveScenario(data, w.scenarioId);
  const precip = mergeClimatePrecip(data.climate.precip, scenario.climateOverrides);
  computePrecip(
    w.size,
    w.primary.height,
    w.derived.lakeDepth,
    w.params.seaLevel,
    w.params.windDir,
    { ...precip, lakeDepthMin: data.hydrology.priorityFlood.lakeDepthMin },
    w.params.rainfallScale,
    w.derived.precip,
  );
}

/** 流出と流量累積。浸透が植生に依存するので、植生が変わったら再計算する。 */
export function recomputeFlow(w: World, data: DataBundle): void {
  const d = w.derived;
  const inf = data.hydrology.infiltration;
  computeRunoff(d.precip, w.primary.vegetation, inf.base, inf.perVegetation, d.runoff);
  accumulateFlow(w.size, d.order, w.floodReached, d.flowDir, d.runoff, d.flowAcc);
  computeHand(w, data); // 洪水リスク（§8.1）は流量に依存するので一緒に更新する
}

/** 気温 → 水分（川・湖の近さを含む）→ バイオーム。 */
export function recomputeClimate(w: World, data: DataBundle): void {
  computeTemperature(w, data);
  computeMoisture(w, data);
  computeBiome(w, data);
}

/** 世界の全派生状態を、一次状態から作り直す（初期化・標高の変更・シーク用）。 */
export function recomputeDerived(w: World, data: DataBundle): void {
  recomputeTerrainDerived(w, data);
  recomputePrecip(w, data);
  recomputeFlow(w, data); // 初期の植生は 0（川の位置を決めるため）
  recomputeClimate(w, data);
  w.dirty &= ~Dirty.Climate;
}

/**
 * 1 tick ぶんの気候・生態系の更新（§10.1 の 2・3・5・6 段）。
 * Climate が dirty なら降水から、そうでなければ moistureBiomeIntervalTicks ごとに水分・バイオームを更新する。
 * 植生は毎 tick（高速モードでは vegetationIntervalDegradedTicks ごと、dt をその分だけ進める）。
 */
export function stepClimate(w: World, data: DataBundle, degraded: boolean): void {
  const sch = data.runtime.schedule;
  if (w.dirty & Dirty.Climate) {
    recomputePrecip(w, data);
    recomputeFlow(w, data);
    recomputeClimate(w, data);
    w.dirty &= ~Dirty.Climate;
  } else if (w.tick % sch.moistureBiomeIntervalTicks === 0) {
    recomputeFlow(w, data);
    recomputeClimate(w, data);
  }
  const vegInterval = degraded ? sch.vegetationIntervalDegradedTicks : 1;
  if (w.tick % vegInterval === 0) growVegetation(w, data, vegInterval);
}

/**
 * 侵食（§6.4）: 4 tick に 1 回（高速モードは 8 tick）、その間隔ぶんの dt をまとめて適用する（陰的解法なので安定）。
 * 標高が変わるので流向・勾配を引き直すが、道路は引き直さない（道路は侵食のたびに消えてはいけない）。
 */
export function stepErosion(w: World, data: DataBundle, degraded: boolean): void {
  const sch = data.runtime.schedule;
  const every = degraded ? sch.erosionIntervalDegradedTicks : sch.erosionIntervalTicks;
  if (w.tick === 0 || w.tick % every !== 0 || w.params.erosionRate <= 0) return;
  const rep = erosionStep(w, data, every);
  if (rep.removed > 0 || rep.deposited > 0) recomputeTerrainDerived(w, data);
}

/** dirty フラグに応じた再計算（Op の適用後、または tick の頭）。標高が変わったら道路も引き直す。 */
export function refreshDirty(w: World, data: DataBundle): void {
  if (w.dirty & Dirty.Height) {
    recomputeDerived(w, data);
    resetRoads(w);
  } else if (w.dirty & Dirty.Climate) {
    recomputePrecip(w, data);
    recomputeFlow(w, data);
    recomputeClimate(w, data);
    w.dirty &= ~Dirty.Climate;
  }
}

/**
 * 1 tick の世界の更新（§10.1）。呼び出し側が tick を進めたあとに呼ぶ。
 * 気候・生態系 → 災害 → 集落の発生・成長 → 道路 → 描画用のラスタライズ → 検出器。
 * 乱数は (seed, tick, 用途) から毎回作り直す: undo で戻しても同じ列が出る。
 */
export function stepWorld(w: World, data: DataBundle, degraded: boolean): void {
  refreshDirty(w, data);
  stepClimate(w, data, degraded);
  if (w.civ.breach) {
    // ダムの決壊（破壊工作）: 標高の変更を反映した水文で、下流に洪水が届く
    flood(w, data, w.civ.breach.surge, w.civ.breach.why);
    w.civ.breach = null;
  }
  stepErosion(w, data, degraded);
  const rng = (salt: number) => createRng(deriveSeed(w.seed, w.tick * 16 + salt));
  stormStep(w, data, rng(1));
  landslideStep(w, data, rng(2));
  spawnStep(w, data, rng(3));
  growthStep(w, data, rng(4), computeCatchments(w, data), nationsKcMod(w, data));
  roadStep(w, data);
  // 国家モード: 経済 → 貿易 → 外交 → AI → 軍 → 戦争（§10.1）
  econStep(w, data);
  tradeStep(w, data);
  diploStep(w, data);
  aiStep(w, data);
  armyStep(w, data);
  warStep(w, data);
  rasterizeCiv(w, data, computeCatchments(w, data));
  stepObs(w, data);
  if (w.tick % 4 === 0) detect(w, data);
}

/** シナリオから世界を作る（地形 → 水文・降水 → 気候 → 初期植生）。同じ (scenarioId, seed, size) なら同じ結果。 */
export function buildWorld(
  data: DataBundle,
  scenarioId: string,
  seed: number,
  size?: number,
  opts: { nations?: boolean } = {},
): World {
  const scenario = resolveScenario(data, scenarioId);
  const w = allocWorld(data, { seed, size });
  w.scenarioId = scenarioId;
  buildTerrain(w, data, scenario);
  recomputeDerived(w, data);
  seedVegetation(w, data);
  recomputeFlow(w, data); // 植生ぶんの浸透を反映
  recomputeClimate(w, data);
  detect(w, data); // 基準値を取る
  if (opts.nations && setupNations(w, data)) initEconomy(w, data);
  return w;
}
