import { DX, DY } from '../hydrology';

export interface PrecipParams {
  humidity0: number;
  evapGain: number;
  baseRainFrac: number;
  liftK: number;
  qMax: number;
  qFloor: number;
  /** 生の湿度単位 → mm/年 */
  calibration: number;
  /** この深さを超える湖は水蒸気の供給源になる（hydrology.json priorityFlood.lakeDepthMin） */
  lakeDepthMin: number;
}

/**
 * 風向の名前（風が吹いてくる側）→ 進行方向の D8 番号（hydrology.ts の DX/DY の並び。y は北向き）。
 * 例: 西風は西から東へ吹くので、進行方向は東（0）。
 */
export const WIND_TRAVEL: Readonly<Record<string, number>> = {
  west: 0, // → 東 (+1, 0)
  southwest: 1, // → 北東 (+1, +1)
  south: 2, // → 北 (0, +1)
  southeast: 3, // → 北西 (-1, +1)
  east: 4, // → 西 (-1, 0)
  northeast: 5, // → 南西 (-1, -1)
  north: 6, // → 南 (0, -1)
  northwest: 7, // → 南東 (+1, -1)
};

export function windTravelIndex(name: string): number {
  const d = WIND_TRAVEL[name];
  if (d === undefined) throw new RangeError(`未知の風向: ${name}`);
  return d;
}

/**
 * 地形性降雨と雨陰（計画書 §7.3）。風上の縁から風下へ、列ごとに湿った空気を運ぶ。
 * 海と湖の上では水蒸気が増え、上り坂（lift）で凝結して降り、風下は乾く。
 * 結果は mm/年（calibration と rainfallScale を掛けた値）。
 * 各セルはちょうど1本の列に属するので、列の処理順は結果に影響しない。
 */
export function computePrecip(
  size: number,
  height: Float32Array,
  lakeDepth: Float32Array,
  seaLevel: number,
  windTravel: number,
  p: PrecipParams,
  rainfallScale: number,
  precip: Float32Array,
): void {
  const dx = DX[windTravel];
  const dy = DY[windTravel];
  precip.fill(0);

  for (let sy = 0; sy < size; sy++) {
    for (let sx = 0; sx < size; sx++) {
      // 風上の縁（ひとつ手前が範囲外）のセルだけが列の始点
      const px = sx - dx;
      const py = sy - dy;
      if (px >= 0 && py >= 0 && px < size && py < size) continue;

      let q = p.humidity0;
      let prev = -1;
      for (let x = sx, y = sy; x >= 0 && y >= 0 && x < size && y < size; x += dx, y += dy) {
        const c = y * size + x;
        if (height[c] < seaLevel || lakeDepth[c] > p.lakeDepthMin) q = Math.min(p.qMax, q + p.evapGain);
        const lift = prev < 0 ? 0 : Math.max(0, height[c] - height[prev]) * p.liftK;
        const rain = Math.min(q, q * (p.baseRainFrac + lift)); // 上昇で凝結
        precip[c] = rain * p.calibration * rainfallScale;
        q -= rain; // 風下側は乾く＝雨陰
        if (q < p.qFloor) q = p.qFloor; // 大陸内部にもわずかな降水
        prev = c;
      }
    }
  }
}
