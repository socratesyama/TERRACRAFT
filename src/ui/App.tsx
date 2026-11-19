import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShareState } from '../core/share';
import type { DataBundle } from '../core/data/schema';
import { SimulationClient, type Snapshot } from '../worker/client';
import type { Op } from '../worker/protocol';
import { t } from './i18n';
import { PauseIcon, PlayIcon } from './Icon';
import { BiomePanel, CivPanel, DevPanel, EventLog, LayerPanel, ScenarioPanel, StatsPanel, TOOLS, ToolPanel } from './panels';
import { ComparePanel, ObservablesPanel, TracerPanel } from './insightPanels';
import { DiplomacyPanel, NationPanel, TradePanel, WarPanel } from './nationPanels';
import { runDemo } from './demo';
import { Chips, ContourBar, QuickBar } from './mobile';
import { mapKey } from './shortcuts';
import { DemoCaption, InspectTooltip, Welcome } from './welcome';
import type { LayerId, ToolId } from './store';
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
  const [gridSize, setGridSize] = useState<number>(() => {
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    return coarse ? data.runtime.ui.mobile.gridSize : data.scale.grid.defaultSize;
  });
  const initNonce = useUiStore((s) => s.initNonce);
  useShareBoot(data);
  useAutosave(data, getClient);
  const loadShared = useCallback(
    (st: ShareState, fastForward: boolean) => {
      const ui = useUiStore.getState();
      ui.setPendingInit({ ops: fastForward ? st.ops : st.ops.filter((o) => o.tick === 0), fastForwardTo: fastForward ? st.tick : 0 });
      useUiStore.setState({ contourMode: false, contours: [] });
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
    const pending = useUiStore.getState().pendingInit;
    useUiStore.getState().setPendingInit(null);
    client.send({ type: 'init', scenarioId, seed, size: gridSize, nations: nationMode, ops: pending?.ops, blank: pending?.blank, fastForwardTo: pending?.fastForwardTo });
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

  // キーボード（§13.5）: Space = 再生/停止、1〜9 = ツール、Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y
  const togglePlayRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      const ui = useUiStore.getState();
      const order = TOOLS.filter((x) => x.id !== 'contour' || ui.contourMode).map((x) => x.id);
      const act = mapKey(e, order, typing);
      if (!act) return;
      if (act.kind === 'togglePlay' && target?.tagName === 'BUTTON') return; // ボタンにフォーカスがあるときの Space は、そのボタンの押下
      e.preventDefault();
      if (act.kind === 'undo') undo();
      else if (act.kind === 'redo') redo();
      else if (act.kind === 'tool') ui.setTool(act.tool);
      else togglePlayRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const stopDemoRef = useRef<(() => void) | null>(null);
  const startDemo = useCallback(() => {
    const ui = useUiStore.getState();
    ui.setWelcomeOpen(false);
    ui.setSheetOpen(false);
    stopDemoRef.current?.();
    ui.setDemoRunning(true);
    const send = (m: Parameters<SimulationClient['send']>[0]): void => clientRef.current?.send(m);
    stopDemoRef.current = runDemo(data, {
      scenario: (id) => {
        useUiStore.getState().setScenarioId(id);
        useUiStore.getState().bumpInit();
      },
      layer: (id) => useUiStore.getState().setLayer(id as LayerId),
      tool: (id) => useUiStore.getState().setTool(id as ToolId),
      caption: (text) => useUiStore.getState().setCaption(text),
      op: (op) => send({ type: 'op', op }),
      play: () => {
        const u = useUiStore.getState();
        u.setPlaying(true);
        send({ type: 'play', speed: u.speed });
      },
      pause: () => {
        useUiStore.getState().setPlaying(false);
        send({ type: 'pause' });
      },
      speed: (v) => {
        const u = useUiStore.getState();
        u.setSpeed(v);
        if (u.playing) send({ type: 'play', speed: v });
      },
      tour: (on) => handleRef.current?.setTour(on),
      end: () => useUiStore.getState().setDemoRunning(false),
    });
  }, [data]);
  const startDrawing = useCallback(() => {
    const ui = useUiStore.getState();
    ui.setWelcomeOpen(false);
    ui.setSheetOpen(false);
    stopDemoRef.current?.();
    ui.setDemoRunning(false);
    ui.startContour((data.runtime.ui as unknown as { contour: { defaultLevel: string } }).contour.defaultLevel);
    try {
      localStorage.setItem(data.runtime.ui.mobile.welcomeStorageKey, '1');
    } catch {
      // 保存できなくても、次回また出るだけ
    }
  }, [data]);
  const stopDemo = useCallback(() => {
    stopDemoRef.current?.();
    stopDemoRef.current = null;
  }, []);
  useEffect(() => () => stopDemoRef.current?.(), []);
  const closeWelcome = useCallback(() => {
    useUiStore.getState().setWelcomeOpen(false);
    try {
      localStorage.setItem(data.runtime.ui.mobile.welcomeStorageKey, '1');
    } catch {
      // 保存できなくても、次回また出るだけ
    }
  }, [data]);
  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(data.runtime.ui.mobile.welcomeStorageKey) === '1';
    } catch {
      // 読めない環境では毎回出す
    }
    if (!seen && !window.location.hash.startsWith('#w=')) useUiStore.getState().setWelcomeOpen(true);
  }, [data]);

  const sheetOpen = useUiStore((s) => s.sheetOpen);
  const setSheetOpen = useUiStore((s) => s.setSheetOpen);
  const sendRain = () =>
    clientRef.current?.send({ type: 'op', op: { t: 'rain', tick: 0, amount: data.runtime.ui.tools.rainAmount.value } });

  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    clientRef.current?.send(next ? { type: 'play', speed } : { type: 'pause' });
  };

  togglePlayRef.current = togglePlay;

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
        <button type="button" className="choice demo-btn" onClick={startDemo} disabled={workerStatus !== 'ready'}>
          {t('demo.start')}
        </button>
      </header>

      <main className="stage">
        <ContourBar data={data} />
        <QuickBar data={data} onUndo={undo} onRain={sendRain} />
        <Chips />
        <DemoCaption onStop={stopDemo} />
        <InspectTooltip data={data} />
        <Welcome onDemo={startDemo} onClose={closeWelcome} onDraw={startDrawing} />
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
        <aside className="side" data-open={sheetOpen}>
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
            onErosion={(v) => clientRef.current?.send({ type: 'op', op: { t: 'param', tick: 0, key: 'erosionRate', value: v } })}
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

        <button
          type="button"
          className="sheet-toggle"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(!sheetOpen)}
        >
          {sheetOpen ? t('sheet.close') : t('sheet.open')}
        </button>

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
