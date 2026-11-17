import type { WorldEvent, WorldParams } from '../core/world';

/** 計画書 §9.1 の Op（純データ）。M0 では型だけ定義し、適用は M1 以降で実装する。 */
export type Vec2 = readonly [number, number];

export interface ContourStroke {
  points: number[]; // 正規化座標 [x0,y0,x1,y1,...]
  elevation: number;
  width: number;
}

export type ParamKey = keyof WorldParams;

export type Op =
  | { t: 'contour'; tick: number; stroke: ContourStroke }
  | { t: 'raise'; tick: number; pts: number[]; r: number; amount: number }
  | { t: 'forest'; tick: number; pts: number[]; r: number; amount: number }
  | { t: 'dam'; tick: number; a: Vec2; b: Vec2; crest: number }
  | { t: 'fill'; tick: number; pts: number[]; r: number }
  | { t: 'param'; tick: number; key: ParamKey; value: number }
  | { t: 'rain'; tick: number; amount: number };

/** 計画書 §11 */
export type ToWorker =
  | {
      type: 'init';
      /** data/scenarios.json のシナリオ ID（地形プリセット・風向・気候の上書きが決まる） */
      scenarioId: string;
      seed: number;
      size?: number;
      params?: Partial<WorldParams>;
      ops?: Op[];
      fastForwardTo?: number;
    }
  | { type: 'op'; op: Op }
  | { type: 'play'; speed: number }
  | { type: 'pause' }
  | { type: 'step'; n: number }
  | { type: 'rewind'; toOpIndex: number }
  | { type: 'release'; buffers: ArrayBuffer[] }
  | { type: 'dryRunDam'; a: Vec2; b: Vec2; crest: number };

/** 描画に渡すデータ（core/renderPack.ts のレイアウト: RGBA32F × size²）。転送されるので受け側が release で返す。 */
export interface RenderPack {
  size: number;
  data: ArrayBuffer;
}

export interface Stats {
  tick: number;
  /** 直近の tick の平均所要時間（ms） */
  avgTickMs: number;
  /** 速度を自動的に落としているか（§10.3 の高速モード） */
  degraded: boolean;
  /** 陸セルの平均植生密度 0〜1 */
  vegetation: number;
  /** バイオームごとのセル数の割合（番号は climate.biomeKeys の順、全セル中） */
  biomeShare: number[];
}

export type FromWorker =
  | { type: 'ready'; size: number }
  | { type: 'snapshot'; tick: number; pack: RenderPack; stats: Stats; events: WorldEvent[] }
  | { type: 'progress'; done: number; total: number }
  | { type: 'dryRunResult'; lakeMask: Uint8Array }
  | { type: 'error'; message: string };

/** Worker への送信口（テストでは差し替える） */
export type Post = (msg: FromWorker, transfer: ArrayBuffer[]) => void;
