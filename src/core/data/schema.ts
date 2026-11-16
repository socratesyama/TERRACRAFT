/**
 * data/*.json の型。JSON ファイルそのものから型を導くので、型定義の二重管理がない。
 * （JSON を書き換えて構造を変えたら、型検査が壊れる箇所を教えてくれる）
 */
export type ScaleData = typeof import('../../../data/scale.json');
export type TerrainData = typeof import('../../../data/terrain.json');
export type HydrologyData = typeof import('../../../data/hydrology.json');
export type ClimateData = typeof import('../../../data/climate.json');
export type EcologyData = typeof import('../../../data/ecology-biomes.json');
export type GeologyData = typeof import('../../../data/geology-soils.json');
export type SettlementsData = typeof import('../../../data/settlements.json');
export type DisastersData = typeof import('../../../data/disasters.json');
export type EconomyData = typeof import('../../../data/economy.json');
export type WarData = typeof import('../../../data/war.json');
export type NationsData = typeof import('../../../data/nations.json');
export type ScenariosData = typeof import('../../../data/scenarios.json');
export type RuntimeData = typeof import('../../../data/runtime.json');
export type ValidationData = typeof import('../../../data/validation.json');

/** 型を詳細に導かない層（該当マイルストーンで必要になったら個別の型へ昇格させる） */
export type JsonObject = Record<string, unknown>;

export interface DataBundle {
  scale: ScaleData;
  terrain: TerrainData;
  hydrology: HydrologyData;
  climate: ClimateData;
  ecology: EcologyData;
  geology: GeologyData;
  settlements: SettlementsData;
  disasters: DisastersData;
  economy: EconomyData;
  war: WarData;
  nations: NationsData;
  scenarios: ScenariosData;
  runtime: RuntimeData;
  validation: ValidationData;
  biologyMovement: JsonObject;
  feedback: JsonObject;
  events: JsonObject;
  policy: JsonObject;
  observables: JsonObject;
  demography: JsonObject;
  technology: JsonObject;
  energy: JsonObject;
  ocean: JsonObject;
  culture: JsonObject;
  resources: JsonObject;
  lawGovernance: JsonObject;
  naming: JsonObject;
  sensitivity: JsonObject;
}

/** ファイル名（拡張子なし）→ DataBundle のキー */
export const FILE_TO_KEY: Readonly<Record<string, keyof DataBundle>> = {
  scale: 'scale',
  terrain: 'terrain',
  hydrology: 'hydrology',
  climate: 'climate',
  'ecology-biomes': 'ecology',
  'geology-soils': 'geology',
  settlements: 'settlements',
  disasters: 'disasters',
  economy: 'economy',
  war: 'war',
  nations: 'nations',
  scenarios: 'scenarios',
  runtime: 'runtime',
  validation: 'validation',
  'biology-movement': 'biologyMovement',
  feedback: 'feedback',
  events: 'events',
  policy: 'policy',
  observables: 'observables',
  demography: 'demography',
  technology: 'technology',
  energy: 'energy',
  ocean: 'ocean',
  culture: 'culture',
  resources: 'resources',
  'law-governance': 'lawGovernance',
  naming: 'naming',
  sensitivity: 'sensitivity',
};
