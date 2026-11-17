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

/**
 * 派生状態の再計算（M1: 水文と降水）。順序は §5.2 / §7.3:
 * 窪地充填 → 湖 → 降水（湖は水蒸気の供給源）→ 流出 → 流量累積。
 */
export function recomputeDerived(w: World, data: DataBundle, scenario: Scenario): void {
  const hyd = data.hydrology;
  const d = w.derived;
  const outlet = findOutlets(w.size, w.primary.height, w.params.seaLevel, w.params.edgeMode);
  const reached = priorityFlood(w.size, w.primary.height, outlet, hyd.priorityFlood.eps, {
    filled: d.filled,
    flowDir: d.flowDir,
    order: d.order,
    lakeDepth: d.lakeDepth,
  });
  const precip = mergeClimatePrecip(data.climate.precip, scenario.climateOverrides);
  computePrecip(
    w.size,
    w.primary.height,
    d.lakeDepth,
    w.params.seaLevel,
    w.params.windDir,
    { ...precip, lakeDepthMin: hyd.priorityFlood.lakeDepthMin },
    w.params.rainfallScale,
    d.precip,
  );
  computeRunoff(
    d.precip,
    w.primary.vegetation,
    hyd.infiltration.base,
    hyd.infiltration.perVegetation,
    d.runoff,
  );
  accumulateFlow(w.size, d.order, reached, d.flowDir, d.runoff, d.flowAcc);
  w.dirty &= ~Dirty.Height;
}

/** シナリオから世界を作る（地形 → 水文・降水）。同じ (scenarioId, seed, size) なら同じ結果。 */
export function buildWorld(
  data: DataBundle,
  scenarioId: string,
  seed: number,
  size?: number,
): World {
  const scenario = resolveScenario(data, scenarioId);
  const w = allocWorld(data, { seed, size });
  buildTerrain(w, data, scenario);
  recomputeDerived(w, data, scenario);
  return w;
}
