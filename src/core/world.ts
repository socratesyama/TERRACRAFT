import type { DataBundle } from './data/schema';
import { combineHashes, hashFloat32, hashInt32, hashUint8 } from './hash';

/** 派生状態を再計算するための dirty フラグ（計画書 §4.2） */
export const Dirty = {
  Height: 1 << 0, // 流向・湖・勾配・日照を再計算
  Climate: 1 << 1, // 気温・水分・バイオームを再計算
  Water: 1 << 2, // 距離変換を再計算
} as const;

export interface PrimaryFields {
  height: Float32Array; // 地表標高 0〜1（水面は含まない）
  fixed: Uint8Array; // 等高線で拘束されたセル
  sediment: Float32Array; // 輸送中の土砂
  vegetation: Float32Array; // 植生密度 0〜1
  population: Float32Array;
  landUse: Uint8Array; // 0:なし 1:農地 2:村 3:町 4:都市 5:港
  road: Float32Array;
  owner: Uint8Array; // 領有する国の ID（0 = 無主地）。国家モードのみ
}

export interface DerivedFields {
  filled: Float32Array; // Priority-Flood の充填後標高
  order: Int32Array; // Priority-Flood の展開順（出口から上流へ）
  flowDir: Uint8Array; // D8方向 0〜7、255は出口
  flowAcc: Float32Array; // 流量累積
  runoff: Float32Array; // 降水 → 流出
  precip: Float32Array;
  lakeDepth: Float32Array;
  slope: Float32Array;
  temperature: Float32Array;
  moisture: Float32Array;
  sunlight: Float32Array;
  biome: Uint8Array;
  distWater: Float32Array;
  distSea: Float32Array; // 海からの距離（セル）
  hand: Float32Array; // 最寄りの川までの比高（§8.1）
  drainAcc: Float32Array; // そのセルが流れ込む川の流量
  floodRisk: Float32Array; // 洪水リスク 0〜1
  scratch: Float32Array; // 植生など、二重バッファが要る計算の作業用
}

/** UI から変えられる世界のパラメータ。初期値は data/ から取る（恒等値だけが直書き） */
export interface WorldParams {
  seaLevel: number; // scale.json seaLevel.value
  edgeMode: 'sea' | 'wall'; // scale.json edgeMode.default
  rainfallScale: number; // 降水倍率（恒等 = 1）
  temperatureBias: number; // 気温の加算（恒等 = 0）
  windDir: number; // 0〜7（M1で scenarios の windDirection から決める）
  peaceMode: number; // 1 のとき戦争が起きない（既定 0）
}

/** 集落（オブジェクトのリスト。配列 population / landUse は描画のためにここからラスタライズする §8.3） */
export interface Settlement {
  id: number;
  x: number;
  y: number;
  pop: number;
  tier: 0 | 1 | 2 | 3; // 村 / 町 / 都市 / 港町
  foundedTick: number;
  foodBalance: number; // Kc − pop（負なら食料不足）
  overCapTicks: number; // P > Kc が続いた tick 数
  droughtTicks: number; // 干ばつが続いた tick 数（0 = 平常）
  nationId: number; // 所属する国（0 = 国家モードでない）
  kc: number; // 直近の支えられる人口（食料の産出）
}

/** 文明まわりの状態（集落・道路・検出器の基準値）。undo で丸ごと戻せるよう純データにする */
export interface CivState {
  nextId: number;
  /** 道路で結ぶ集落のペア [idA, idB]（まだ結んでいないもの） */
  roadQueue: [number, number][];
  /** 結んだ集落のペア（"a-b"） */
  roadDone: string[];
  /** 検出器が最後に報告した値（§9.4） */
  baseline: { riverCells: number; lakes: number; forestShare: number; desertShare: number } | null;
  /** 種類ごとの最後にログへ出した tick（間引き） */
  lastEmit: Record<string, number>;
  /** イベントログの通し番号 */
  eventSeq: number;
  /** 直近の Op（因果の紐づけ用 §9.4）。id は Op ログの番号 */
  recentOps: { id: number; tick: number; x?: number; y?: number }[];
  /** 直近の豪雨の tick（戦争の天候補正に使う）。無ければ -1 */
  stormTick: number;
  /** 築いたダム（破壊工作・決壊の対象）。orig は築く前の標高 */
  dams: { id: number; x: number; y: number; cells: number[]; orig: number[]; tick: number }[];
  /** 次の tick に起こす決壊の洪水 */
  breach: { surge: number; why: string } | null;
}

export type Res = 'food' | 'wood' | 'ore';
export const RESOURCES: readonly Res[] = ['food', 'wood', 'ore'];
export const DI_KEYS = ['population', 'foodSecurity', 'economy', 'infrastructure', 'environment', 'disasterResilience', 'technology', 'diplomacy'] as const;

/** 国（§21）。純データ（undo で丸ごと戻せる） */
export interface Nation {
  id: number;
  name: string;
  color: string;
  personality: string; // 'player' または archetypes のキー
  capitalId: number; // 首都の集落 ID
  stock: { food: number; wood: number; ore: number; wealth: number };
  prod: { food: number; wood: number; ore: number; wealth: number };
  cons: { food: number; wood: number; ore: number };
  tech: number;
  army: number;
  mobTarget: number;
  pop: number;
  cells: number;
  baseCells: number; // 国が始まったときの領土（領土の下限の基準）
  potential: number;
  famine: number; // 直近の食料不足率（不足 / 人口）
  lossAcc: number; // この tick の災害による人口損失（洪水・飢饉）
  lossEma: number;
  tradeValue: number; // 直近の貿易額の指数平均
  foodImport: number; // 食料の輸入量（1 tick あたり、指数平均）
  di: number;
  diParts: number[]; // DI_KEYS の順、0〜1
  diHistory: number[];
  lastDecision: string;
}

export interface Relation {
  a: number;
  b: number; // a < b
  trust: number;
  status: 'peace' | 'tension' | 'war' | 'truce';
  tensionTicks: number;
  truceUntil: number;
  tradePactUntil: number; // 0 = 協定なし
  nonAggUntil: number;
  border: number; // 国境の長さ（接するセル対の数）
  grievance: '' | 'water' | 'food' | 'border';
  lastTradeTick: number;
  /** AI がこの tick まで、この相手へ貿易・不可侵の提案をしない（断られた直後の連投を防ぐ） */
  proposeCooldown: number;
  /** a が b に禁輸している / b が a に禁輸している */
  embargoAB: boolean;
  embargoBA: boolean;
}

export interface Proposal {
  id: number;
  from: number;
  to: number;
  kind: 'trade' | 'nonAggression' | 'peace';
  tick: number;
}

export interface War {
  id: number;
  a: number; // 攻撃側（宣戦した国）
  b: number;
  startTick: number;
  casus: string;
  wearA: number;
  wearB: number;
  lossA: number;
  lossB: number;
  startCellsB: number;
  capturedByA: number;
  capturedByB: number;
  startCellsA: number;
  /** 前線の重心（矢印の表示用） */
  frontX: number;
  frontY: number;
  dirX: number;
  dirY: number;
  /** 直近の tick の前線の説明（地形による内訳） */
  note: string;
}

export interface TradeFlow {
  from: number;
  to: number;
  res: Res;
  sent: number;
  received: number;
  price: number;
  mode: 'road' | 'riverDown' | 'riverUp' | 'sea';
}

/** 観測量の時系列。キーは `指標` （世界）または `指標:国ID`（国）。値は ticks と同じ長さ */
export interface ObsState {
  ticks: number[];
  values: Record<string, number[]>;
}

export interface DiploState {
  nextId: number;
  relations: Relation[];
  proposals: Proposal[];
  wars: War[];
  /** 下流国への流入量の長期平均（[上流-1][下流-1] の平坦化） */
  inflowEma: number[];
  basePotential: number;
  lastTrade: { tick: number; flows: TradeFlow[]; loss: number };
  /** 戦闘の統計（地形ごとの前線セル数と占領セル数。AI の統計検証用） */
  battle: { front: Record<string, number>; taken: Record<string, number>; riverFront: number; riverTaken: number; wars: number; capitalFalls: number; aggressorWins: number; decided: number; ended: number; durationSum: number; durationMax: number; warTicks: number };
}

export interface WorldEvent {
  tick: number;
  kind:
    | 'op'
    | 'river'
    | 'lake'
    | 'forest'
    | 'desert'
    | 'settle'
    | 'flood'
    | 'erosion'
    | 'deposit'
    | 'drought'
    | 'landslide'
    | 'road'
    | 'abandon'
    | 'trade'
    | 'diplomacy'
    | 'war'
    | 'famine'
    | 'nation';
  causeId?: number;
  /** op イベントだけ: この操作の通し番号（結果のイベントの causeId と対応する） */
  opId?: number;
  message: string;
  /** 通し番号（ログの順序・差分取得用） */
  seq?: number;
  x?: number;
  y?: number;
}

export interface World {
  version: number;
  size: number;
  cellSize: number;
  maxElevation: number;
  seed: number;
  scenarioId: string;
  /** Priority-Flood が到達したセル数（order の有効な長さ） */
  floodReached: number;
  tick: number;
  params: WorldParams;
  primary: PrimaryFields;
  derived: DerivedFields;
  dirty: number;
  events: WorldEvent[];
  settlements: Settlement[];
  civ: CivState;
  nations: Nation[];
  diplo: DiploState;
  obs: ObsState;
}

export const WORLD_VERSION = 1;

export interface AllocOptions {
  seed: number;
  /** 省略時は scale.json grid.defaultSize */
  size?: number;
}

export function emptyDiplo(): DiploState {
  return { nextId: 1, relations: [], proposals: [], wars: [], inflowEma: [], basePotential: 0, lastTrade: { tick: 0, flows: [], loss: 0 }, battle: { front: {}, taken: {}, riverFront: 0, riverTaken: 0, wars: 0, capitalFalls: 0, aggressorWins: 0, decided: 0, ended: 0, durationSum: 0, durationMax: 0, warTicks: 0 } };
}

export function allocWorld(data: DataBundle, opts: AllocOptions): World {
  const size = opts.size ?? data.scale.grid.defaultSize;
  if (!(data.scale.grid.sizes as readonly number[]).includes(size)) {
    throw new RangeError(`未対応のグリッドサイズ: ${size}（scale.json grid.sizes に無い）`);
  }
  const n = size * size;
  return {
    version: WORLD_VERSION,
    size,
    cellSize: data.scale.cellSize.value,
    maxElevation: data.scale.maxElevation.value,
    seed: opts.seed >>> 0,
    scenarioId: '',
    floodReached: 0,
    tick: 0,
    params: {
      seaLevel: data.scale.seaLevel.value,
      edgeMode: data.scale.edgeMode.default as 'sea' | 'wall',
      rainfallScale: 1,
      temperatureBias: 0,
      windDir: 0,
      peaceMode: 0,
    },
    primary: {
      height: new Float32Array(n),
      fixed: new Uint8Array(n),
      sediment: new Float32Array(n),
      vegetation: new Float32Array(n),
      population: new Float32Array(n),
      landUse: new Uint8Array(n),
      road: new Float32Array(n),
      owner: new Uint8Array(n),
    },
    derived: {
      filled: new Float32Array(n),
      order: new Int32Array(n),
      flowDir: new Uint8Array(n).fill(255),
      flowAcc: new Float32Array(n),
      runoff: new Float32Array(n),
      precip: new Float32Array(n),
      lakeDepth: new Float32Array(n),
      slope: new Float32Array(n),
      temperature: new Float32Array(n),
      moisture: new Float32Array(n),
      sunlight: new Float32Array(n),
      biome: new Uint8Array(n),
      distWater: new Float32Array(n),
      distSea: new Float32Array(n),
      hand: new Float32Array(n),
      drainAcc: new Float32Array(n),
      floodRisk: new Float32Array(n),
      scratch: new Float32Array(n),
    },
    dirty: Dirty.Height | Dirty.Climate | Dirty.Water,
    events: [],
    settlements: [],
    civ: { nextId: 1, roadQueue: [], roadDone: [], baseline: null, lastEmit: {}, eventSeq: 0, recentOps: [], stormTick: -1, dams: [], breach: null },
    nations: [],
    diplo: emptyDiplo(),
    obs: { ticks: [], values: {} },
  };
}

/** 一次状態だけのハッシュ（派生状態は一次状態から再計算できるので含めない） */
export function hashWorld(w: World, quantizeScale: number): number {
  const p = w.primary;
  return combineHashes([
    w.seed,
    w.tick,
    hashFloat32(p.height, quantizeScale),
    hashUint8(p.fixed),
    hashFloat32(p.sediment, quantizeScale),
    hashFloat32(p.vegetation, quantizeScale),
    hashFloat32(p.population, quantizeScale),
    hashUint8(p.landUse),
    hashFloat32(p.road, quantizeScale),
    hashSettlements(w),
    hashUint8(p.owner),
    hashNations(w, quantizeScale),
  ]);
}

function hashNations(w: World, q: number): number {
  const flat: number[] = [];
  for (const n of w.nations) {
    flat.push(n.id, n.capitalId, Math.round(n.stock.food * q) | 0, Math.round(n.stock.wood * q) | 0, Math.round(n.stock.ore * q) | 0, Math.round(n.stock.wealth * q) | 0, Math.round(n.army * q) | 0, Math.round(n.tech * q) | 0, Math.round(n.foodImport * q) | 0);
  }
  for (const r of w.diplo.relations) {
    flat.push(r.a, r.b, Math.round(r.trust * q) | 0, ['peace', 'tension', 'war', 'truce'].indexOf(r.status), r.tradePactUntil, r.nonAggUntil, (r.embargoAB ? 1 : 0) + (r.embargoBA ? 2 : 0));
  }
  for (const x of w.diplo.wars) flat.push(x.id, x.a, x.b, x.capturedByA, x.capturedByB);
  return hashInt32(Int32Array.from(flat));
}

function hashSettlements(w: World): number {
  const flat = new Int32Array(w.settlements.length * 5);
  w.settlements.forEach((c, i) => {
    flat[i * 5] = c.id;
    flat[i * 5 + 1] = c.x;
    flat[i * 5 + 2] = c.y;
    flat[i * 5 + 3] = Math.round(c.pop * 100);
    flat[i * 5 + 4] = c.tier + c.nationId * 8;
  });
  return hashInt32(flat);
}

/** 派生状態のハッシュ（水文・降水・気温・水分・日照・バイオーム）。同じ seed・同じ入力から同じ値になることの確認用。 */
export function hashDerived(w: World, quantizeScale: number): number {
  const d = w.derived;
  return combineHashes([
    hashFloat32(d.filled, quantizeScale),
    hashUint8(d.flowDir),
    hashFloat32(d.flowAcc, quantizeScale),
    hashFloat32(d.runoff, quantizeScale),
    hashFloat32(d.precip, quantizeScale),
    hashFloat32(d.lakeDepth, quantizeScale),
    hashFloat32(d.temperature, quantizeScale),
    hashFloat32(d.moisture, quantizeScale),
    hashFloat32(d.sunlight, quantizeScale),
    hashUint8(d.biome),
  ]);
}
