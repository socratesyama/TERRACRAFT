import type { CompareResult, CompareSpec } from '../core/compare';
import type { DiploState, Nation, ObsState, Settlement, WorldEvent, WorldParams } from '../core/world';

export type { CompareResult, CompareSpec };

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
      /** 国家モード（国・外交・貿易・戦争）。省略時は runtime.json ui.nationModeDefault */
      nations?: boolean;
      params?: Partial<WorldParams>;
      /** ops の中の contour（tick 0）は、プリセットの代わりに地形を決める等高線として使う */
      ops?: Op[];
      /** 等高線を 1 本も描いていない「白紙の海」から始める（描いて始めるモード） */
      blank?: boolean;
      fastForwardTo?: number;
    }
  | { type: 'op'; op: Op }
  | { type: 'play'; speed: number }
  | { type: 'pause' }
  | { type: 'step'; n: number }
  /** 共有用に、いまの入力（シナリオ・seed・Op ログ・tick）を返してもらう */
  | { type: 'exportState' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'rewind'; toOpIndex: number }
  | { type: 'release'; buffers: ArrayBuffer[] }
  | { type: 'compare'; a: CompareSpec; b: CompareSpec; ticks: number }
  /** 変化マップの基準を「今」に取り直す */
  | { type: 'markBaseline' }
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
      nations: Nation[];
      diplo: Pick<DiploState, 'relations' | 'proposals' | 'wars' | 'lastTrade'>;
      /** 観測量の時系列。点が増えたときだけ付く（毎回は送らない） */
      obs?: ObsState;
    }
  | { type: 'state'; scenarioId: string; seed: number; size: number; nations: boolean; ops: Op[]; tick: number; exact: boolean }
  | { type: 'notice'; message: string }
  | { type: 'compareResult'; result: CompareResult }
  | { type: 'progress'; done: number; total: number; what?: 'compare' | 'replay' }
  | { type: 'dryRunResult'; lakeMask: Uint8Array }
  | { type: 'error'; message: string };

/** Worker への送信口（テストでは差し替える） */
export type Post = (msg: FromWorker, transfer: ArrayBuffer[]) => void;
