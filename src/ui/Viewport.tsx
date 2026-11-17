import { useEffect, useRef, useState } from 'react';
import { PACK_CHANNELS } from '../core/renderPack';
import { TerrainViewport, type ViewportOptions } from '../render/Viewport';
import type { Snapshot } from '../worker/client';
import { t } from './i18n';
import { useUiStore } from './store';

interface Props extends ViewportOptions {
  /** スナップショットの受け口を登録する（描画後に必ず release するのは App 側） */
  register: (apply: ((s: Snapshot) => void) | null) => void;
}

export function Viewport({ register, ...opts }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<TerrainViewport | null>(null);
  const [failed, setFailed] = useState(false);
  const layer = useUiStore((s) => s.layer);
  const { gridSize, seaLevel, heightScale, precipMaxMm, devicePixelRatioMax, devicePixelRatioMaxMobile } = opts;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let viewport: TerrainViewport | null = null;
    try {
      viewport = new TerrainViewport(host, {
        gridSize,
        seaLevel,
        heightScale,
        precipMaxMm,
        devicePixelRatioMax,
        devicePixelRatioMaxMobile,
      });
      vpRef.current = viewport;
      const vp = viewport;
      register((s) => {
        if (s.pack.size * s.pack.size * PACK_CHANNELS * 4 === s.pack.data.byteLength) {
          vp.setData(new Float32Array(s.pack.data));
        }
      });
    } catch {
      setFailed(true);
    }
    return () => {
      register(null);
      vpRef.current = null;
      viewport?.dispose();
    };
  }, [gridSize, seaLevel, heightScale, precipMaxMm, devicePixelRatioMax, devicePixelRatioMaxMobile, register]);

  useEffect(() => {
    vpRef.current?.setLayer(layer === 'precip' ? 1 : 0);
  }, [layer]);

  return (
    <div ref={hostRef} className="viewport">
      {failed && <p className="viewport-error">{t('error.webgl')}</p>}
    </div>
  );
}
