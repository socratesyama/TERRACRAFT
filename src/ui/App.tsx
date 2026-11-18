import { useCallback, useEffect, useRef } from 'react';
import type { DataBundle } from '../core/data/schema';
import { SimulationClient, type Snapshot } from '../worker/client';
import type { Op } from '../worker/protocol';
import { t } from './i18n';
import { PauseIcon, PlayIcon } from './Icon';
import { BiomePanel, CivPanel, DevPanel, EventLog, LayerPanel, ScenarioPanel, StatsPanel, ToolPanel } from './panels';
import { DiplomacyPanel, NationPanel, TradePanel, WarPanel } from './nationPanels';
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
  const seed = data.scenarios.comparison.defaultSeed;
  const gridSize = data.scale.grid.defaultSize;

  // Worker の起動と接続。
  useEffect(() => {
    const client = new SimulationClient();
    clientRef.current = client;
    const statsIntervalMs = 1000 / data.runtime.ui.statsHz;
    let lastMirrorAt = 0;

    client.onReady = () => setWorkerStatus('ready');
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
        useWorldMirror.getState().update({ ...s.stats, towns, population, nations: s.nations, diplo: s.diplo });
      }
      useUiStore.getState().mergeEvents(s.eventsFrom, s.events);
      applyRef.current?.(s); // GPU へコピーしてから返却する
      client.release(s);
    };
    setWorkerStatus('connecting');
    useUiStore.getState().clearEvents();
    client.send({ type: 'init', scenarioId, seed, size: gridSize, nations: nationMode });

    return () => {
      client.terminate();
      clientRef.current = null;
    };
  }, [data, seed, gridSize, scenarioId, nationMode, setWorkerStatus]);

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
          <ToolPanel
            data={data}
            onUndo={undo}
            onRedo={redo}
            onRain={() =>
              clientRef.current?.send({ type: 'op', op: { t: 'rain', tick: 0, amount: data.runtime.ui.tools.rainAmount.value } })
            }
          />
          <EventLog onFocus={(x, y) => handleRef.current?.focusOn(x, y)} />
          <CivPanel />
          <NationPanel data={data} />
          <DiplomacyPanel data={data} send={sendOp} />
          <WarPanel data={data} send={sendOp} />
          <TradePanel />
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
