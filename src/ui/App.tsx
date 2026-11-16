import { useEffect, useRef } from 'react';
import type { DataBundle } from '../core/data/schema';
import { SimulationClient } from '../worker/client';
import { t } from './i18n';
import { PauseIcon, PlayIcon } from './Icon';
import { LayerPanel, StatsPanel } from './panels';
import { useUiStore, useWorldMirror } from './store';
import { Viewport } from './Viewport';

export function App({ data }: { data: DataBundle }) {
  const clientRef = useRef<SimulationClient | null>(null);
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
    client.onError = (message) => setWorkerStatus('error', message);
    client.onSnapshot = (s) => {
      // 統計は約 statsHz に間引く。描画に使い終えたバッファは必ず返却する。
      const now = performance.now();
      if (now - lastMirrorAt >= statsIntervalMs) {
        lastMirrorAt = now;
        useWorldMirror.getState().update(s.stats);
      }
      client.release(s);
    };
    client.send({ type: 'init', seed, size: gridSize });

    return () => {
      client.terminate();
      clientRef.current = null;
    };
  }, [data, seed, gridSize, setWorkerStatus]);

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
          devicePixelRatioMax={data.runtime.render.devicePixelRatioMax}
          devicePixelRatioMaxMobile={data.runtime.render.devicePixelRatioMaxMobile}
        />
        <aside className="side">
          <StatsPanel data={data} seed={seed} size={gridSize} />
          <LayerPanel />
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
