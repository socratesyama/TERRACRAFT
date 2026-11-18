import type { DataBundle } from './data/schema';
import { foodDependency, landSummary } from './nations/economy';
import type { World } from './world';

/**
 * 観測量の記録（M5）。指標の ID・単位は data/observables.json に定義済みのものだけを使う。
 * 世界の指標はキー `id`、国の指標は `id:国ID`。記録は決定論的（ハッシュには入れない派生情報）。
 */
export interface MetricDef {
  id: string; // observables.json の metrics のキー
  scope: 'world' | 'nation';
  /** 国の指標を世界の指標にまとめるとき: 合計か平均か */
  total: 'sum' | 'mean';
  value: (w: World, data: DataBundle, nationId: number, land: ReturnType<typeof landSummary>) => number;
}

const popOf = (w: World, nationId: number): number => w.settlements.filter((s) => s.nationId === nationId).reduce((a, s) => a + s.pop, 0);

export const METRICS: readonly MetricDef[] = [
  { id: 'population', scope: 'world', total: 'sum', value: (w) => w.settlements.reduce((a, s) => a + s.pop, 0) },
  { id: 'annualPrecipitation', scope: 'world', total: 'mean', value: (w) => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < w.primary.height.length; i++) {
        if (w.primary.height[i]! >= w.params.seaLevel) {
          sum += w.derived.precip[i]!;
          n++;
        }
      }
      return n > 0 ? sum / n : 0;
    } },
  { id: 'farmlandArea', scope: 'world', total: 'sum', value: (w) => {
      let n = 0;
      for (let i = 0; i < w.primary.landUse.length; i++) if (w.primary.landUse[i] === 1) n++;
      return n;
    } },
  { id: 'population', scope: 'nation', total: 'sum', value: (w, _d, id) => popOf(w, id) },
  { id: 'developmentIndex', scope: 'nation', total: 'mean', value: (w, _d, id) => w.nations[id - 1]!.di },
  { id: 'foodSecurity', scope: 'nation', total: 'mean', value: (w, _d, id) => w.nations[id - 1]!.diParts[1] ?? 0 },
  { id: 'famine', scope: 'nation', total: 'mean', value: (w, _d, id) => w.nations[id - 1]!.famine },
  { id: 'tradeVolume', scope: 'nation', total: 'sum', value: (w, _d, id) => w.nations[id - 1]!.tradeValue },
  { id: 'militaryCapacity', scope: 'nation', total: 'sum', value: (w, _d, id) => w.nations[id - 1]!.army },
  { id: 'foodImportDependency', scope: 'nation', total: 'mean', value: (w, _d, id) => foodDependency(w.nations[id - 1]!) },
  { id: 'treasury', scope: 'nation', total: 'sum', value: (w, _d, id) => w.nations[id - 1]!.stock.wealth },
  { id: 'technologyLevel', scope: 'nation', total: 'mean', value: (w, _d, id) => w.nations[id - 1]!.tech },
  { id: 'forestCover', scope: 'nation', total: 'mean', value: (_w, _d, id, land) => land.forest[id - 1]! / Math.max(1, land.cells[id - 1]!) },
];

export const key = (id: string, nationId?: number): string => (nationId === undefined ? id : `${id}:${nationId}`);

/** 1 点を記録する（国家モードでなければ世界の指標だけ） */
export function recordObs(w: World, data: DataBundle): void {
  const o = w.obs;
  const max = data.runtime.observe.maxSamples.value;
  const land = w.nations.length > 0 ? landSummary(w, data) : null;
  o.ticks.push(w.tick);
  for (const m of METRICS) {
    if (m.scope === 'world') {
      (o.values[key(m.id)] ??= []).push(m.value(w, data, 0, land as never));
    } else if (land) {
      for (const n of w.nations) (o.values[key(m.id, n.id)] ??= []).push(m.value(w, data, n.id, land));
    }
  }
  if (o.ticks.length > max) {
    o.ticks.shift();
    for (const k of Object.keys(o.values)) o.values[k]!.shift();
  }
}

export function stepObs(w: World, data: DataBundle): void {
  if (w.tick % data.runtime.observe.everyTicks.value === 0) recordObs(w, data);
}
