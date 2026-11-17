/**
 * 勾配ノイズと ridged fBm。決定論のため、三角関数・指数関数を使わず
 * （加減乗算だけ、整数ハッシュで格子の勾配を選ぶ）、実行環境によらず同じ値になる。
 */

// 8方向の単位ベクトル（斜めは 1/√2 の定数）。sin/cos を使わない。
const R = 0.7071067811865476;
const GX = [1, -1, 0, 0, R, -R, R, -R];
const GY = [0, 0, 1, -1, R, R, -R, -R];

function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** 勾配ノイズ（おおよそ [-1, 1]） */
export function gradientNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const dot = (cx: number, cy: number, dx: number, dy: number): number => {
    const g = hash2(cx, cy, seed) & 7;
    return GX[g] * dx + GY[g] * dy;
  };
  const n00 = dot(x0, y0, fx, fy);
  const n10 = dot(x0 + 1, y0, fx - 1, fy);
  const n01 = dot(x0, y0 + 1, fx, fy - 1);
  const n11 = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
  const u = fade(fx);
  const v = fade(fy);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  const n = (a + v * (b - a)) * 1.4142135623730951; // 単位勾配の最大値 ≈ 0.707 を 1 に伸ばす
  return n < -1 ? -1 : n > 1 ? 1 : n;
}

export interface FbmParams {
  octaves: number;
  gain: number;
  lacunarity: number;
  /** 最も粗いオクターブの周波数（単位長あたりの周期数） */
  baseFrequency: number;
}

/**
 * ridged fBm（Musgrave 1989）。尾根が鋭く、谷が丸い。結果は [0, 1]。
 * (x, y) は 0〜1 に正規化した座標。
 */
export function ridgedFbm(x: number, y: number, seed: number, p: FbmParams): number {
  let freq = p.baseFrequency;
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < p.octaves; o++) {
    let r = 1 - Math.abs(gradientNoise(x * freq, y * freq, seed + o * 1013));
    r *= r;
    sum += r * amp;
    norm += amp;
    amp *= p.gain;
    freq *= p.lacunarity;
  }
  return sum / norm;
}
