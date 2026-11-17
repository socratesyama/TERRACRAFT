import { ridgedFbm, type FbmParams } from './noise';
import { rasterizeContours, type Contour } from './rasterize';

export interface TerrainParams {
  /** terrain.json relaxation.iterations（キーはグリッドサイズ） */
  iterations: Readonly<Record<string, number>>;
  noise: FbmParams & {
    amplitude: number; // A
    R: number; // 変調距離（セル）
  };
  smoothPasses: number;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * 地形生成（計画書 §4.3）。入力は等高線と seed、出力は height / fixed（呼び出し側が確保した配列）。
 * 1) ラスタライズ 2) 初期推定（最寄り固定セルから伝播）3) 制約付きラプラス緩和
 * 4) 距離で変調した ridged fBm 5) 制約の再適用＋平滑 6) 0〜1 にクランプ。
 */
export function generateHeight(
  size: number,
  contours: readonly Contour[],
  seed: number,
  p: TerrainParams,
  height: Float32Array,
  fixed: Uint8Array,
): void {
  const n = size * size;
  height.fill(0);
  fixed.fill(0);
  rasterizeContours(size, contours, height, fixed);
  const target = Float32Array.from(height); // 固定セルの元の標高

  // --- 2) 初期推定: 固定セルからの多始点幅優先走査（8近傍）。距離も同時に得る。
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  for (let i = 0; i < n; i++) {
    if (fixed[i]) {
      dist[i] = 0;
      queue[qt++] = i;
    }
  }
  if (qt === 0) return; // 等高線がなければ平坦（height = 0）
  while (qh < qt) {
    const c = queue[qh++];
    const cx = c % size;
    const cy = (c / size) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const j = y * size + x;
        if (dist[j] >= 0) continue;
        dist[j] = dist[c] + 1;
        height[j] = height[c];
        queue[qt++] = j;
      }
    }
  }

  // --- 3) 制約付きラプラス緩和（Gauss-Seidel、境界は外へ向かって勾配ゼロ）
  const iters = p.iterations[String(size)];
  if (iters === undefined) throw new RangeError(`relaxation.iterations に ${size} がありません`);
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < size; y++) {
      const ym = (y > 0 ? y - 1 : y) * size;
      const yp = (y < size - 1 ? y + 1 : y) * size;
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const i = row + x;
        if (fixed[i]) continue;
        const xm = x > 0 ? x - 1 : x;
        const xp = x < size - 1 ? x + 1 : x;
        height[i] = (height[row + xm] + height[row + xp] + height[ym + x] + height[yp + x]) * 0.25;
      }
    }
  }

  // --- 4) ノイズ: 固定セルに近いほど振幅を抑える
  const { amplitude, R, ...fbm } = p.noise;
  const inv = 1 / (size - 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (fixed[i]) continue;
      const amp = amplitude * smoothstep(0, R, dist[i]);
      if (amp === 0) continue;
      height[i] += amp * (ridgedFbm(x * inv, y * inv, seed, fbm) - 0.5);
    }
  }

  // --- 5) 制約の再適用 → 非固定セルだけ 3×3 平滑（固定セルの誤差を増やさない）
  for (let i = 0; i < n; i++) if (fixed[i]) height[i] = target[i];
  const tmp = new Float32Array(n);
  for (let pass = 0; pass < p.smoothPasses; pass++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (fixed[i]) {
          tmp[i] = height[i];
          continue;
        }
        let s = 0;
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            s += height[ny * size + nx];
            k++;
          }
        }
        tmp[i] = s / k;
      }
    }
    height.set(tmp);
  }

  // --- 6) 範囲正規化
  for (let i = 0; i < n; i++) height[i] = height[i] < 0 ? 0 : height[i] > 1 ? 1 : height[i];
}
