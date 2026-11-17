import type { DataBundle } from './data/schema';
import type { World } from './world';

/**
 * 描画に渡す RGBA32F テクスチャ（1セル = 4 float）を PACK_TEXTURES 枚、続けて並べる。
 * 1枚目: R 標高 / G 水面 / B 川 / A 降水(mm/年)
 * 2枚目: R 気温(°C) / G 水分 / B 植生 / A バイオーム番号
 */
export const PACK_CHANNELS = 4;
export const PACK_TEXTURES = 2;
/** 水面が無いセルの G の値 */
export const NO_WATER = -1;

export function packByteLength(size: number): number {
  return size * size * PACK_CHANNELS * PACK_TEXTURES * Float32Array.BYTES_PER_ELEMENT;
}

/**
 * 水面の高さ（§5.4）: 海は海面、湖は充填後標高。川は水面ではなく B チャンネルの濃さで描く。
 * 川の濃さ = log(1 + acc/threshold) × widthFactor（hydrology.json river）。
 */
export function buildRenderPack(w: World, data: DataBundle, out: Float32Array): void {
  const { height } = w.primary;
  const { filled, lakeDepth, flowAcc, precip } = w.derived;
  const n = height.length;
  const second = n * PACK_CHANNELS; // 2枚目の先頭
  const { temperature, moisture, biome } = w.derived;
  const lakeMin = data.hydrology.priorityFlood.lakeDepthMin;
  const { flowThreshold, widthFactor } = data.hydrology.river;

  for (let i = 0; i < height.length; i++) {
    const o = i * PACK_CHANNELS;
    const sea = height[i] < w.params.seaLevel;
    const lake = !sea && lakeDepth[i] > lakeMin;
    out[o] = height[i];
    out[o + 1] = sea ? w.params.seaLevel : lake ? filled[i] : NO_WATER;
    const river =
      !sea && !lake && flowAcc[i] >= flowThreshold
        ? Math.min(1, Math.log(1 + flowAcc[i] / flowThreshold) * widthFactor)
        : 0;
    out[o + 2] = river;
    out[o + 3] = precip[i];
    out[second + o] = temperature[i];
    out[second + o + 1] = moisture[i];
    out[second + o + 2] = w.primary.vegetation[i];
    out[second + o + 3] = biome[i];
  }
}
