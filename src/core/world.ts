import type { DataBundle } from './data/schema';
import { combineHashes, hashFloat32, hashUint8 } from './hash';

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
  scratch: Float32Array; // 植生など、二重バッファが要る計算の作業用
}

/** UI から変えられる世界のパラメータ。初期値は data/ から取る（恒等値だけが直書き） */
export interface WorldParams {
  seaLevel: number; // scale.json seaLevel.value
  edgeMode: 'sea' | 'wall'; // scale.json edgeMode.default
  rainfallScale: number; // 降水倍率（恒等 = 1）
  temperatureBias: number; // 気温の加算（恒等 = 0）
  windDir: number; // 0〜7（M1で scenarios の windDirection から決める）
}

export interface WorldEvent {
  tick: number;
  kind: 'op' | 'river' | 'lake' | 'forest' | 'desert' | 'settle' | 'flood' | 'erosion' | 'deposit';
  causeId?: number;
  message: string;
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
}

export const WORLD_VERSION = 1;

export interface AllocOptions {
  seed: number;
  /** 省略時は scale.json grid.defaultSize */
  size?: number;
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
    },
    primary: {
      height: new Float32Array(n),
      fixed: new Uint8Array(n),
      sediment: new Float32Array(n),
      vegetation: new Float32Array(n),
      population: new Float32Array(n),
      landUse: new Uint8Array(n),
      road: new Float32Array(n),
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
      scratch: new Float32Array(n),
    },
    dirty: Dirty.Height | Dirty.Climate | Dirty.Water,
    events: [],
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
  ]);
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
