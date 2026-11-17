import { create } from 'zustand';

export type LayerId = 'terrain' | 'precip' | 'temperature' | 'moisture' | 'biome' | 'vegetation' | 'erosion';

/** UI 状態のみ。World の配列は入れない（計画書 §3, §13.1）。 */
interface UiState {
  scenarioId: string;
  setScenarioId: (id: string) => void;
  rainfallScale: number;
  setRainfallScale: (v: number) => void;
  layer: LayerId;
  setLayer: (layer: LayerId) => void;
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
  setScenarioId: (scenarioId) => set({ scenarioId, playing: false, rainfallScale: 1 }),
  rainfallScale: 1,
  setRainfallScale: (rainfallScale) => set({ rainfallScale }),
  layer: 'biome',
  setLayer: (layer) => set({ layer }),
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
  update: (m: Pick<WorldMirrorState, 'tick' | 'avgTickMs' | 'degraded' | 'vegetation' | 'biomeShare'>) => void;
}

export const useWorldMirror = create<WorldMirrorState>()((set) => ({
  tick: 0,
  avgTickMs: 0,
  degraded: false,
  vegetation: 0,
  biomeShare: [],
  update: (m) => set(m),
}));
