import type { Settlement, WorldEvent, WorldParams } from '../core/world';

export type { ContourStroke, Op, ParamKey, Vec2 } from '../core/ops';
import type { Op, Vec2 } from '../core/ops';

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
  | { type: 'undo' }
  | { type: 'redo' }
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
  /** 取り消せる Op の数 / やり直せる Op の数 */
  undoDepth: number;
  redoDepth: number;
}

export type FromWorker =
  | { type: 'ready'; size: number }
  | {
      type: 'snapshot';
      tick: number;
      pack: RenderPack;
      stats: Stats;
      /** この通し番号（seq）以降のイベント。UI は自分のログのうち seq >= eventsFrom を捨てて、これを足す（undo でログが巻き戻るため） */
      eventsFrom: number;
      events: WorldEvent[];
      settlements: Settlement[];
    }
  | { type: 'progress'; done: number; total: number }
  | { type: 'dryRunResult'; lakeMask: Uint8Array }
  | { type: 'error'; message: string };

/** Worker への送信口（テストでは差し替える） */
export type Post = (msg: FromWorker, transfer: ArrayBuffer[]) => void;
