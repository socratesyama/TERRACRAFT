import { useEffect, useRef, useState } from 'react';
import { biomeKeys } from '../core/climate/climate';
import type { DataBundle } from '../core/data/schema';
import { PACK_CHANNELS, PACK_TEXTURES } from '../core/renderPack';
import { TerrainViewport, type ViewportOptions } from '../render/Viewport';
import type { SimulationClient, Snapshot } from '../worker/client';
import { t } from './i18n';
import { useUiStore, type LayerId } from './store';

export interface ViewportHandle {
  focusOn: (x: number, y: number) => void;
  setPreview: (mask: Uint8Array | null) => void;
  screenshot: () => Promise<Blob | null>;
}

interface Props
  extends Omit<
    ViewportOptions,
    'biomeColors' | 'bareColor' | 'temperatureMinC' | 'temperatureMaxC' | 'civColors' | 'settlementHeights' | 'nationColors'
  > {
  data: DataBundle;
  /** スナップショットの受け口を登録する（描画後に必ず release するのは App 側） */
  register: (apply: ((s: Snapshot) => void) | null) => void;
  client: () => SimulationClient | null;
  handleRef: { current: ViewportHandle | null };
}

const LAYER_INDEX = {
  terrain: 0,
  precip: 1,
  temperature: 2,
  moisture: 3,
  biome: 4,
  vegetation: 5,
  flood: 6,
  erosion: 0,
  nation: 7,
  defense: 8,
  diff: 9,
} as const satisfies Record<LayerId, number>;

export function Viewport({ register, data, client, handleRef, ...opts }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<TerrainViewport | null>(null);
  const [failed, setFailed] = useState(false);
  const layer = useUiStore((s) => s.layer);
  const { gridSize, seaLevel, heightScale, precipMaxMm, devicePixelRatioMax, devicePixelRatioMaxMobile } = opts;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let viewport: TerrainViewport | null = null;
    const cleanups: (() => void)[] = [];
    try {
      const r = data.runtime.render;
      viewport = new TerrainViewport(host, {
        gridSize,
        seaLevel,
        heightScale,
        precipMaxMm,
        temperatureMinC: r.temperatureLayerRange.minC,
        temperatureMaxC: r.temperatureLayerRange.maxC,
        biomeColors: biomeKeys(data).map((k) => (r.biomeColors as Record<string, string>)[k] ?? r.biomeColors.bare),
        bareColor: r.biomeColors.bare,
        civColors: r.civColors as Record<string, string>,
        nationColors: ['#555555', ...data.nations.setup.colors],
        settlementHeights: r.settlementHeights.value,
        devicePixelRatioMax,
        devicePixelRatioMaxMobile,
      });
      vpRef.current = viewport;
      const vp = viewport;
      handleRef.current = { focusOn: (x, y) => vp.focusOn(x, y), setPreview: (m) => vp.setPreview(m), screenshot: () => vp.screenshot() };
      register((s) => {
        if (s.pack.size * s.pack.size * PACK_CHANNELS * PACK_TEXTURES * 4 === s.pack.data.byteLength) {
          vp.setData(new Float32Array(s.pack.data));
        }
        vp.setSettlements(s.settlements);
        vp.setWars(s.diplo.wars);
      });
      cleanups.push(attachTools(vp, data, client, gridSize));
    } catch {
      setFailed(true);
    }
    return () => {
      for (const c of cleanups) c();
      register(null);
      handleRef.current = null;
      vpRef.current = null;
      viewport?.dispose();
    };
  }, [gridSize, seaLevel, heightScale, precipMaxMm, devicePixelRatioMax, devicePixelRatioMaxMobile, register, data, client, handleRef]);

  useEffect(() => {
    vpRef.current?.setLayer(LAYER_INDEX[layer]);
  }, [layer]);

  return (
    <div ref={hostRef} className="viewport">
      {failed && <p className="viewport-error">{t('error.webgl')}</p>}
    </div>
  );
}

/**
 * 干渉ツールの操作（ポインタ）。ドラッグ 1 回 = 1 つの Op（§9.1）。
 * ツールが「見る」以外のとき、左ボタン／1 本指のドラッグは描画に使い、カメラは回さない。
 */
function attachTools(vp: TerrainViewport, data: DataBundle, client: () => SimulationClient | null, size: number): () => void {
  const canvas = vp.canvas;
  const tools = data.runtime.ui.tools;
  const throttle = data.runtime.render.previewThrottleMs;
  let stroke: { tool: string; pts: number[]; last: { x: number; y: number } } | null = null;
  let lastPreviewAt = 0;
  const norm = (c: { x: number; y: number }): [number, number] => [c.x / (size - 1), c.y / (size - 1)];
  const rCells = (): number => useUiStore.getState().brushRadius * (size - 1);

  const preview = (a: [number, number], b: [number, number]): void => {
    const now = performance.now();
    if (now - lastPreviewAt < throttle) return;
    lastPreviewAt = now;
    client()?.send({ type: 'dryRunDam', a, b, crest: useUiStore.getState().damCrest });
  };

  const down = (e: PointerEvent): void => {
    const st = useUiStore.getState();
    if (st.tool === 'view' || e.button !== 0) return;
    const c = vp.pick(e.clientX, e.clientY);
    if (!c) return;
    e.stopImmediatePropagation(); // カメラの回転に渡さない
    canvas.setPointerCapture(e.pointerId);
    stroke = { tool: st.tool, pts: [...norm(c)], last: c };
  };

  const move = (e: PointerEvent): void => {
    const st = useUiStore.getState();
    if (st.tool === 'view') {
      vp.setBrush(null, 0);
      return;
    }
    const c = vp.pick(e.clientX, e.clientY);
    vp.setBrush(c, st.tool === 'dam' ? 1 : rCells());
    if (!stroke || !c) return;
    if (stroke.tool === 'dam') {
      const a = [stroke.pts[0]!, stroke.pts[1]!] as [number, number];
      stroke.pts = [...a, ...norm(c)];
      preview(a, norm(c));
      return;
    }
    if (Math.hypot(c.x - stroke.last.x, c.y - stroke.last.y) >= tools.strokeSpacingCells.value) {
      stroke.pts.push(...norm(c));
      stroke.last = c;
    }
  };

  const up = (): void => {
    if (!stroke) return;
    const { tool, pts } = stroke;
    stroke = null;
    vp.setPreview(null);
    const st = useUiStore.getState();
    const send = (op: Parameters<SimulationClient['send']>[0]): void => client()?.send(op);
    const r = st.brushRadius;
    switch (tool) {
      case 'mountain':
        send({ type: 'op', op: { t: 'raise', tick: 0, pts, r, amount: tools.raiseAmount.value } });
        break;
      case 'dig':
        send({ type: 'op', op: { t: 'raise', tick: 0, pts, r, amount: -tools.raiseAmount.value } });
        break;
      case 'afforest':
        send({ type: 'op', op: { t: 'forest', tick: 0, pts, r, amount: tools.forestAmount.value } });
        break;
      case 'deforest':
        send({ type: 'op', op: { t: 'forest', tick: 0, pts, r, amount: -tools.forestAmount.value } });
        break;
      case 'fill':
        send({ type: 'op', op: { t: 'fill', tick: 0, pts, r } });
        break;
      case 'dam':
        if (pts.length >= 4) {
          send({ type: 'op', op: { t: 'dam', tick: 0, a: [pts[0]!, pts[1]!], b: [pts[2]!, pts[3]!], crest: st.damCrest } });
        }
        break;
    }
  };

  const leave = (): void => vp.setBrush(null, 0);

  canvas.addEventListener('pointerdown', down, { capture: true });
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', leave);
  return () => {
    canvas.removeEventListener('pointerdown', down, { capture: true });
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
    canvas.removeEventListener('pointerleave', leave);
  };
}
