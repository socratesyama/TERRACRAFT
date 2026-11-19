import { PACK_CHANNELS } from './renderPack';

/** Worker に返却する転送バッファから独立した、セル検査用のコピーを作る。 */
export function copyRenderPackData(buffer: ArrayBuffer): Float32Array {
  return new Float32Array(buffer.slice(0));
}

/** セルを指したときに見せる値（計画書 §13.7 InspectTooltip の「数値でも見える」）。描画パック（スナップショット）から読む */
export interface CellInfo {
  x: number;
  y: number;
  /** 正規化標高 */
  height: number;
  water: number;
  river: number;
  precip: number;
  temperature: number;
  moisture: number;
  vegetation: number;
  biome: number;
  floodRisk: number;
  population: number;
  owner: number;
  /** 侵食・堆積による標高の正味の変化（正規化） */
  erosion: number;
}

/** パックの cell (x, y) を読む。範囲外は null */
export function readCell(pack: Float32Array, size: number, x: number, y: number): CellInfo | null {
  if (x < 0 || y < 0 || x >= size || y >= size || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  const per = size * size * PACK_CHANNELS;
  const o = (y * size + x) * PACK_CHANNELS;
  const v = (tex: number, ch: number): number => pack[per * tex + o + ch]!;
  return {
    x,
    y,
    height: v(0, 0),
    water: v(0, 1),
    river: v(0, 2),
    precip: v(0, 3),
    temperature: v(1, 0),
    moisture: v(1, 1),
    vegetation: v(1, 2),
    biome: v(1, 3),
    floodRisk: v(2, 3),
    population: v(2, 1),
    owner: v(3, 0),
    erosion: v(4, 0),
  };
}
