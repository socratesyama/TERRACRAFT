export interface Contour {
  /** 正規化座標 [[x, y], ...]（y は北向きに増える: 緯度勾配 §7.2 と同じ向き） */
  points: ReadonlyArray<readonly [number, number]>;
  /** 正規化標高 0〜1 */
  elevation: number;
  /** ブラシの太さ（セル） */
  width: number;
}

/**
 * 等高線をラスタライズする（計画書 §4.3 の手順1）。
 * 線分を Bresenham で走査し、半径 width/2 の円板で標高を書き込む。
 * 書き込んだセルは fixed=1。異なる等高線が重なったセルは平均（同じ線の重複は数えない）。
 */
export function rasterizeContours(
  size: number,
  contours: readonly Contour[],
  height: Float32Array,
  fixed: Uint8Array,
): void {
  const n = size * size;
  const sum = new Float64Array(n);
  const count = new Int32Array(n);
  const lastStroke = new Int32Array(n).fill(-1);

  const stamp = (cx: number, cy: number, r: number, elevation: number, stroke: number): void => {
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const i = y * size + x;
        if (lastStroke[i] === stroke) continue;
        lastStroke[i] = stroke;
        sum[i] += elevation;
        count[i]++;
      }
    }
  };

  contours.forEach((c, stroke) => {
    const r = Math.max(0.5, c.width / 2);
    const pts = c.points.map(([px, py]) => [Math.round(px * (size - 1)), Math.round(py * (size - 1))]);
    if (pts.length === 1) stamp(pts[0][0], pts[0][1], r, c.elevation, stroke);
    for (let k = 0; k + 1 < pts.length; k++) {
      let [x0, y0] = pts[k];
      const [x1, y1] = pts[k + 1];
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        stamp(x0, y0, r, c.elevation, stroke);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    }
  });

  for (let i = 0; i < n; i++) {
    if (count[i] > 0) {
      height[i] = sum[i] / count[i];
      fixed[i] = 1;
    }
  }
}
