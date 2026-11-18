import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShareState } from '../core/share';
import type { DataBundle } from '../core/data/schema';
import { SimulationClient, type Snapshot } from '../worker/client';
import type { Op } from '../worker/protocol';
import { t } from './i18n';
import { PauseIcon, PlayIcon } from './Icon';
import { BiomePanel, CivPanel, DevPanel, EventLog, LayerPanel, ScenarioPanel, StatsPanel, ToolPanel } from './panels';
import { ComparePanel, ObservablesPanel, TracerPanel } from './insightPanels';
import { DiplomacyPanel, NationPanel, TradePanel, WarPanel } from './nationPanels';
import { SharePanel, useAutosave, useShareBoot } from './sharePanel';
import { useUiStore, useWorldMirror } from './store';
import { Viewport, type ViewportHandle } from './Viewport';

export function App({ data }: { data: DataBundle }) {
  const clientRef = useRef<SimulationClient | null>(null);
  const applyRef = useRef<((s: Snapshot) => void) | null>(null);
  const register = useCallback((fn: ((s: Snapshot) => void) | null) => {
    applyRef.current = fn;
  }, []);
  const scenarioId = useUiStore((s) => s.scenarioId);
  const nationMode = useUiStore((s) => s.nationMode);
  const handleRef = useRef<ViewportHandle | null>(null);
  const getClient = useCallback(() => clientRef.current, []);
  const { playing, speed, workerStatus, errorMessage, setPlaying, setSpeed, setWorkerStatus } =
    useUiStore();
  const degraded = useWorldMirror((s) => s.degraded);

  // seed は scenarios.json の比較用 seed、グリッドは scale.json の既定（数値は data/ から）。
  const [seed, setSeed] = useState(data.scenarios.comparison.defaultSeed);
  const [gridSize, setGridSize] = useState<number>(data.scale.grid.defaultSize);
  const initNonce = useUiStore((s) => s.initNonce);
  /** 共有 URL・保存からの読み込み。次の init で一度だけ使う */
  const pendingRef = useRef<{ ops: Op[]; fastForwardTo: number } | null>(null);
  useShareBoot(data);
  useAutosave(data, getClient);
  const loadShared = useCallback(
    (st: ShareState, fastForward: boolean) => {
      const ui = useUiStore.getState();
      pendingRef.current = { ops: fastForward ? st.ops : st.ops.filter((o) => o.tick === 0), fastForwardTo: fastForward ? st.tick : 0 };
      const peace = [...st.ops].reverse().find((o) => o.t === 'param' && o.key === 'peaceMode');
      ui.setScenarioId(st.scenarioId);
      ui.setNationMode(st.nations);
      ui.setPeaceMode(peace && peace.t === 'param' ? peace.value >= 0.5 : false);
      setSeed(st.seed);
      setGridSize(st.size);
      ui.bumpInit();
    },
    [],
  );
  const screenshot = useCallback(() => {
    void handleRef.current?.screenshot().then((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'terracraft.png';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }, []);

  // Worker の起動と接続。
  useEffect(() => {
    const client = new SimulationClient();
    clientRef.current = client;
    const statsIntervalMs = 1000 / data.runtime.ui.statsHz;
    let lastMirrorAt = 0;

    client.onReady = () => setWorkerStatus('ready');
    client.onCompare = (r) => useUiStore.getState().setCompare(r);
    client.onProgress = (done, total, what) => {
      if (what === 'replay') useUiStore.getState().setReplayProgress(done >= total ? null : done / total);
      else useUiStore.getState().setCompareProgress(done / total);
    };
    client.onNotice = (m) => useUiStore.getState().setNotice(m);
    client.onDryRun = (mask) => handleRef.current?.setPreview(mask);
    client.onError = (message) => setWorkerStatus('error', message);
    client.onSnapshot = (s) => {
      // 統計は約 statsHz に間引く。描画に使い終えたバッファは必ず返却する。
      const now = performance.now();
      if (now - lastMirrorAt >= statsIntervalMs) {
        lastMirrorAt = now;
        const towns = [0, 0, 0, 0];
        let population = 0;
        for (const c of s.settlements) {
          towns[c.tier]!++;
          population += c.pop;
        }
        useWorldMirror.getState().update({ ...s.stats, towns, population, nations: s.nations, diplo: s.diplo, obs: s.obs });
      }
      useUiStore.getState().mergeEvents(s.eventsFrom, s.events);
      applyRef.current?.(s); // GPU へコピーしてから返却する
      client.release(s);
    };
    setWorkerStatus('connecting');
    useUiStore.getState().clearEvents();
    const pending = pendingRef.current;
    pendingRef.current = null;
    client.send({ type: 'init', scenarioId, seed, size: gridSize, nations: nationMode, ops: pending?.ops, fastForwardTo: pending?.fastForwardTo });
    useUiStore.getState().setReplayProgress(null);

    return () => {
      client.terminate();
      clientRef.current = null;
    };
  }, [data, seed, gridSize, scenarioId, nationMode, initNonce, setWorkerStatus]);

  const sendOp = useCallback((op: Op) => {
    useUiStore.getState().setNotice(null);
    clientRef.current?.send({ type: 'op', op });
  }, []);
  const undo = useCallback(() => clientRef.current?.send({ type: 'undo' }), []);
  const redo = useCallback(() => clientRef.current?.send({ type: 'redo' }), []);

  // キーボード: Ctrl/Cmd+Z で元に戻す、Ctrl/Cmd+Shift+Z / Ctrl+Y でやり直す
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    clientRef.current?.send(next ? { type: 'play', speed } : { type: 'pause' });
  };

  const changeSpeed = (s: number) => {
    setSpeed(s);
    if (playing) clientRef.current?.send({ type: 'play', speed: s });
  };

  const tick = useWorldMirror((s) => s.tick);
  const statusKey = `status.worker.${workerStatus}` as const;

  return (
    <div className="app">
      <header className="topbar">
        <h1>{t('app.title')}</h1>
        <p className="tagline">{t('app.tagline')}</p>
      </header>

      <main className="stage">
        <Viewport
          gridSize={gridSize}
          data={data}
          seaLevel={data.scale.seaLevel.value}
          heightScale={data.runtime.render.heightScale}
          precipMaxMm={data.runtime.render.precipLayerMaxMm}
          register={register}
          client={getClient}
          handleRef={handleRef}
          devicePixelRatioMax={data.runtime.render.devicePixelRatioMax}
          devicePixelRatioMaxMobile={data.runtime.render.devicePixelRatioMaxMobile}
        />
        <aside className="side">
          <ScenarioPanel data={data} />
          <SharePanel data={data} client={getClient} onLoad={loadShared} onScreenshot={screenshot} />
          <ToolPanel
            data={data}
            onUndo={undo}
            onRedo={redo}
            onRain={() =>
              clientRef.current?.send({ type: 'op', op: { t: 'rain', tick: 0, amount: data.runtime.ui.tools.rainAmount.value } })
            }
          />
          <EventLog onFocus={(x, y) => handleRef.current?.focusOn(x, y)} />
          <TracerPanel onFocus={(x, y) => handleRef.current?.focusOn(x, y)} onMark={() => clientRef.current?.send({ type: 'markBaseline' })} />
          <CivPanel />
          <NationPanel data={data} />
          <DiplomacyPanel data={data} send={sendOp} />
          <WarPanel data={data} send={sendOp} />
          <TradePanel />
          <ObservablesPanel data={data} />
          <ComparePanel data={data} onRun={(a, b, ticks) => clientRef.current?.send({ type: 'compare', a, b, ticks })} />
          <StatsPanel data={data} seed={seed} size={gridSize} />
          <LayerPanel data={data} />
          <BiomePanel data={data} />
          <DevPanel
            data={data}
            onPeace={(v) => clientRef.current?.send({ type: 'op', op: { t: 'param', tick: 0, key: 'peaceMode', value: v ? 1 : 0 } })}
            onRainfall={(v) =>
              clientRef.current?.send({ type: 'op', op: { t: 'param', tick: 0, key: 'rainfallScale', value: v } })
            }
          />
        </aside>
      </main>

      <footer className="timeline">
        <button
          type="button"
          className="primary"
          onClick={togglePlay}
          disabled={workerStatus !== 'ready'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
          <span>{playing ? t('play.pause') : t('play.play')}</span>
        </button>

        <div className="choices" role="radiogroup" aria-label={t('play.speed')}>
          {data.runtime.playback.speeds.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === speed}
              className={s === speed ? 'choice active' : 'choice'}
              onClick={() => changeSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>

        <p className="year">
          {t('status.tick')} <strong>{tick}</strong>
        </p>

        <p className="status" role="status" data-status={workerStatus}>
          {t(statusKey)}
          {errorMessage ? `：${errorMessage}` : ''}
        </p>
        {degraded && <p className="badge">{t('status.degraded')}</p>}
      </footer>
    </div>
  );
}
