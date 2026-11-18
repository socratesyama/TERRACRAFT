import { create } from 'zustand';
import type { DiploState, Nation, WorldEvent } from '../core/world';

export type ToolId = 'view' | 'mountain' | 'dig' | 'afforest' | 'deforest' | 'dam' | 'fill';

export type LayerId = 'terrain' | 'precip' | 'temperature' | 'moisture' | 'biome' | 'vegetation' | 'flood' | 'erosion' | 'nation' | 'defense';

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
  nationMode: boolean;
  setNationMode: (v: boolean) => void;
  /** 平和モード（戦争が起きない） */
  peaceMode: boolean;
  setPeaceMode: (v: boolean) => void;
  /** Worker からの通知（外交の操作が今はできない、など） */
  notice: string | null;
  setNotice: (m: string | null) => void;
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
  diplo: Pick<DiploState, 'relations' | 'proposals' | 'wars' | 'lastTrade'>;
  update: (
    m: Pick<
      WorldMirrorState,
      'tick' | 'avgTickMs' | 'degraded' | 'vegetation' | 'biomeShare' | 'undoDepth' | 'redoDepth' | 'towns' | 'population' | 'nations' | 'diplo'
    >,
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
  diplo: { relations: [], proposals: [], wars: [], lastTrade: { tick: 0, flows: [], loss: 0 } },
  update: (m) => set(m),
}));
