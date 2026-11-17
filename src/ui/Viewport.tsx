import { useEffect, useRef, useState } from 'react';
import { biomeKeys } from '../core/climate/climate';
import type { DataBundle } from '../core/data/schema';
import { PACK_CHANNELS, PACK_TEXTURES } from '../core/renderPack';
import { TerrainViewport, type ViewportOptions } from '../render/Viewport';
import type { Snapshot } from '../worker/client';
import { t } from './i18n';
import { useUiStore } from './store';

interface Props extends Omit<ViewportOptions, 'biomeColors' | 'bareColor' | 'temperatureMinC' | 'temperatureMaxC'> {
  data: DataBundle;
  /** スナップショットの受け口を登録する（描画後に必ず release するのは App 側） */
  register: (apply: ((s: Snapshot) => void) | null) => void;
}

const LAYER_INDEX = { terrain: 0, precip: 1, temperature: 2, moisture: 3, biome: 4, vegetation: 5, erosion: 0 } as const;

export function Viewport({ register, data, ...opts }: Props) {
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
        temperatureMinC: data.runtime.render.temperatureLayerRange.minC,
        temperatureMaxC: data.runtime.render.temperatureLayerRange.maxC,
        biomeColors: biomeKeys(data).map((k) => (data.runtime.render.biomeColors as Record<string, string>)[k] ?? data.runtime.render.biomeColors.bare),
        bareColor: data.runtime.render.biomeColors.bare,
        devicePixelRatioMax,
        devicePixelRatioMaxMobile,
      });
      vpRef.current = viewport;
      const vp = viewport;
      register((s) => {
        if (s.pack.size * s.pack.size * PACK_CHANNELS * PACK_TEXTURES * 4 === s.pack.data.byteLength) {
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
  }, [gridSize, seaLevel, heightScale, precipMaxMm, devicePixelRatioMax, devicePixelRatioMaxMobile, register, data]);

  useEffect(() => {
    vpRef.current?.setLayer(LAYER_INDEX[layer]);
  }, [layer]);

  return (
    <div ref={hostRef} className="viewport">
      {failed && <p className="viewport-error">{t('error.webgl')}</p>}
    </div>
  );
}
