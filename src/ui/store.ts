import { create } from 'zustand';
import type { CompareResult } from '../core/compare';
import type { ShareState } from '../core/share';
import type { DiploState, Nation, ObsState, WorldEvent } from '../core/world';

export type ToolId = 'view' | 'mountain' | 'dig' | 'afforest' | 'deforest' | 'dam' | 'fill';

export type LayerId = 'terrain' | 'precip' | 'temperature' | 'moisture' | 'biome' | 'vegetation' | 'flood' | 'erosion' | 'nation' | 'defense' | 'diff';

/** UI 状態のみ。World の配列は入れない（計画書 §3, §13.1）。 */
interface UiState {
  scenarioId: string;
  setScenarioId: (id: string) => void;
  rainfallScale: number;
  setRainfallScale: (v: number) => void;
  layer: LayerId;
  setLayer: (layer: LayerId) => void;
  tool: ToolId;
  setTool: (tool: ToolId) => void;
  brushRadius: number;
  setBrushRadius: (v: number) => void;
  damCrest: number;
  setDamCrest: (v: number) => void;
  /** イベントログ（Worker のログの写し。seq 順）。undo で巻き戻るので eventsFrom 以降を差し替える */
  events: WorldEvent[];
  mergeEvents: (from: number, add: WorldEvent[]) => void;
  clearEvents: () => void;
  /** 国家モード（国・外交・貿易・戦争）。変えると世界を作り直す */
  /** シナリオ比較の結果と進行 */
  compare: CompareResult | null;
  compareProgress: number | null;
  setCompare: (r: CompareResult | null) => void;
  setCompareProgress: (p: number | null) => void;
  /** 因果トレーサで選んだ操作（op イベントの通し番号 seq） */
  traceSeq: number | null;
  setTraceSeq: (s: number | null) => void;
  nationMode: boolean;
  setNationMode: (v: boolean) => void;
  /** 平和モード（戦争が起きない） */
  peaceMode: boolean;
  setPeaceMode: (v: boolean) => void;
  /** Worker からの通知（外交の操作が今はできない、など） */
  notice: string | null;
  setNotice: (m: string | null) => void;
  /** 共有 URL で開いたとき、「設計図のみ / 現在の時点」を選ばせるための提案 */
  shareOffer: ShareState | null;
  setShareOffer: (s: ShareState | null) => void;
  shareMessage: string | null;
  setShareMessage: (m: string | null) => void;
  /** 共有 URL の再生（早送り）の進み 0〜1 */
  replayProgress: number | null;
  setReplayProgress: (p: number | null) => void;
  /** Worker を作り直す合図（同じシナリオのまま読み込み直すとき） */
  initNonce: number;
  bumpInit: () => void;
  /** デモのキャプション（null で非表示）と、デモ再生中か */
  caption: string | null;
  setCaption: (c: string | null) => void;
  demoRunning: boolean;
  setDemoRunning: (v: boolean) => void;
  /** 初回の入口（デモ／サンプル／白紙） */
  welcomeOpen: boolean;
  setWelcomeOpen: (v: boolean) => void;
  /** 狭い画面の下部シート（パネル一覧）の開閉 */
  sheetOpen: boolean;
  setSheetOpen: (v: boolean) => void;
  playing: boolean;
  speed: number;
  workerStatus: 'connecting' | 'ready' | 'error';
  errorMessage: string | null;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setWorkerStatus: (status: UiState['workerStatus'], message?: string) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  scenarioId: 'island',
  setScenarioId: (scenarioId) => set({ scenarioId, playing: false, rainfallScale: 1, peaceMode: false }),
  rainfallScale: 1,
  setRainfallScale: (rainfallScale) => set({ rainfallScale }),
  layer: 'biome',
  setLayer: (layer) => set({ layer }),
  tool: 'view',
  setTool: (tool) => set({ tool }),
  brushRadius: 0.05,
  setBrushRadius: (brushRadius) => set({ brushRadius }),
  damCrest: 0.08,
  setDamCrest: (damCrest) => set({ damCrest }),
  compare: null,
  compareProgress: null,
  setCompare: (compare) => set({ compare, compareProgress: null }),
  setCompareProgress: (compareProgress) => set({ compareProgress }),
  traceSeq: null,
  setTraceSeq: (traceSeq) => set({ traceSeq }),
  nationMode: true,
  setNationMode: (nationMode) => set({ nationMode, playing: false }),
  peaceMode: false,
  setPeaceMode: (peaceMode) => set({ peaceMode }),
  notice: null,
  setNotice: (notice) => set({ notice }),
  events: [],
  mergeEvents: (from, add) =>
    set((st) => {
      const kept = st.events.filter((e) => (e.seq ?? 0) < from);
      return { events: [...kept, ...add].slice(-400) };
    }),
  clearEvents: () => set({ events: [] }),
  shareOffer: null,
  setShareOffer: (shareOffer) => set({ shareOffer }),
  shareMessage: null,
  setShareMessage: (shareMessage) => set({ shareMessage }),
  replayProgress: null,
  setReplayProgress: (replayProgress) => set({ replayProgress }),
  initNonce: 0,
  bumpInit: () => set((st) => ({ initNonce: st.initNonce + 1, playing: false })),
  caption: null,
  setCaption: (caption) => set({ caption }),
  demoRunning: false,
  setDemoRunning: (demoRunning) => set({ demoRunning }),
  welcomeOpen: false,
  setWelcomeOpen: (welcomeOpen) => set({ welcomeOpen }),
  sheetOpen: false,
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  playing: false,
  speed: 1,
  workerStatus: 'connecting',
  errorMessage: null,
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
  setWorkerStatus: (workerStatus, message) =>
    set({ workerStatus, errorMessage: message ?? null }),
}));

/** Worker の統計のミラー。約 statsHz で間引いて更新する（スナップショットごとではない） */
interface WorldMirrorState {
  tick: number;
  avgTickMs: number;
  degraded: boolean;
  vegetation: number;
  biomeShare: number[];
  undoDepth: number;
  redoDepth: number;
  towns: number[]; // 村・町・都市・港町の数
  population: number;
  nations: Nation[];
  obs: ObsState;
  diplo: Pick<DiploState, 'relations' | 'proposals' | 'wars' | 'lastTrade'>;
  update: (
    m: Pick<
      WorldMirrorState,
      'tick' | 'avgTickMs' | 'degraded' | 'vegetation' | 'biomeShare' | 'undoDepth' | 'redoDepth' | 'towns' | 'population' | 'nations' | 'diplo'
    > & { obs?: ObsState },
  ) => void;
}

export const useWorldMirror = create<WorldMirrorState>()((set) => ({
  tick: 0,
  avgTickMs: 0,
  degraded: false,
  vegetation: 0,
  biomeShare: [],
  undoDepth: 0,
  redoDepth: 0,
  towns: [0, 0, 0, 0],
  population: 0,
  nations: [],
  obs: { ticks: [], values: {} },
  diplo: { relations: [], proposals: [], wars: [], lastTrade: { tick: 0, flows: [], loss: 0 } },
  // obs は点が増えたときだけ届く。届かない間は前のものを残す
  update: ({ obs, ...m }) => set(obs ? { ...m, obs } : m),
}));
