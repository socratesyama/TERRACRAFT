import type { DataBundle } from './data/schema';
import { defenseGrid } from './nations/war';
import type { World } from './world';

/**
 * 描画に渡す RGBA32F テクスチャ（1セル = 4 float）を PACK_TEXTURES 枚、続けて並べる。
 * 1枚目: R 標高 / G 水面 / B 川 / A 降水(mm/年)
 * 2枚目: R 気温(°C) / G 水分 / B 植生 / A バイオーム番号
 * 3枚目: R 土地利用(civ/settlements.ts LAND_USE) / G 人口 / B 道路 / A 洪水リスク
 * 4枚目: R 領有する国の ID（0 = 無主地） / G 戦争の前線なら 1 / B 防御の地形倍率（水域は 0） / A 基準からの変化 0〜1（因果トレーサの変化マップ）
 */
export const PACK_CHANNELS = 4;
export const PACK_TEXTURES = 4;
/** 水面が無いセルの G の値 */
export const NO_WATER = -1;

export function packByteLength(size: number): number {
  return size * size * PACK_CHANNELS * PACK_TEXTURES * Float32Array.BYTES_PER_ELEMENT;
}

/**
 * 水面の高さ（§5.4）: 海は海面、湖は充填後標高。川は水面ではなく B チャンネルの濃さで描く。
 * 川の濃さ = log(1 + acc/threshold) × widthFactor（hydrology.json river）。
 */
/** 変化マップの基準（操作の直前や「今を基準にする」時点の標高・植生・領有） */
export interface DiffBaseline {
  height: Float32Array;
  vegetation: Float32Array;
  owner: Uint8Array;
}

export function takeBaseline(w: World): DiffBaseline {
  return { height: w.primary.height.slice(), vegetation: w.primary.vegetation.slice(), owner: w.primary.owner.slice() };
}

export function buildRenderPack(w: World, data: DataBundle, out: Float32Array, base?: DiffBaseline): void {
  const ds = data.runtime.observe.diffScale;
  const { height } = w.primary;
  const { filled, lakeDepth, flowAcc, precip } = w.derived;
  const n = height.length;
  const second = n * PACK_CHANNELS; // 2枚目の先頭
  const third = second * 2; // 3枚目の先頭
  const fourth = second * 3; // 4枚目の先頭
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
    out[third + o] = w.primary.landUse[i];
    out[third + o + 1] = w.primary.population[i];
    out[third + o + 2] = w.primary.road[i];
    out[third + o + 3] = w.derived.floodRisk[i];
    out[fourth + o] = w.primary.owner[i]!;
    out[fourth + o + 1] = 0;
    out[fourth + o + 3] = base
      ? Math.min(
          1,
          Math.abs(height[i]! - base.height[i]!) * ds.height +
            Math.abs(w.primary.vegetation[i]! - base.vegetation[i]!) * ds.vegetation +
            (w.primary.owner[i] !== base.owner[i] ? 1 : 0),
        )
      : 0;
  }
  if (w.nations.length > 0) {
    defenseGrid(w, data, out, PACK_CHANNELS, fourth + 2);
    // 戦争の前線: 交戦中の 2 国の国境（4 近傍）のセル
    const sz = w.size;
    const own = w.primary.owner;
    for (const war of w.diplo.wars) {
      for (let i = 0; i < n; i++) {
        const o = own[i]!;
        if (o !== war.a && o !== war.b) continue;
        const other = o === war.a ? war.b : war.a;
        const x = i % sz;
        const y = (i / sz) | 0;
        if ((x > 0 && own[i - 1] === other) || (x < sz - 1 && own[i + 1] === other) || (y > 0 && own[i - sz] === other) || (y < sz - 1 && own[i + sz] === other)) {
          out[fourth + i * PACK_CHANNELS + 1] = 1;
        }
      }
    }
  }
}
