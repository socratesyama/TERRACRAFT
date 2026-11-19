/**
 * 等高線の手描き線の整形（計画書 §13.3）: Douglas–Peucker で間引き → Chaikin で滑らかに → 始点の近くで終えたら閉じる。
 * 点は [x0, y0, x1, y1, ...]（単位は呼び出し側が決める。セル座標で使うと許容誤差がセル単位で渡せる）。
 */
export function simplifyDP(pts: readonly number[], tolerance: number): number[] {
  const n = pts.length / 2;
  if (n <= 2) return [...pts];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 2]!;
    const ay = pts[a * 2 + 1]!;
    const dx = pts[b * 2]! - ax;
    const dy = pts[b * 2 + 1]! - ay;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let fd = tolerance;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2]! - ax;
      const py = pts[i * 2 + 1]! - ay;
      const d = len === 0 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / len;
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2]!, pts[i * 2 + 1]!);
  return out;
}

/** Chaikin の角切り（端点は保つ。閉じた線は、つなぎ目も丸める） */
export function chaikin(pts: readonly number[], passes: number): number[] {
  let cur = [...pts];
  for (let p = 0; p < passes; p++) {
    const n = cur.length / 2;
    if (n < 3) return cur;
    const closed = cur[0] === cur[(n - 1) * 2] && cur[1] === cur[(n - 1) * 2 + 1];
    const out: number[] = [];
    if (!closed) out.push(cur[0]!, cur[1]!);
    for (let i = 0; i + 1 < n; i++) {
      const x0 = cur[i * 2]!;
      const y0 = cur[i * 2 + 1]!;
      const x1 = cur[i * 2 + 2]!;
      const y1 = cur[i * 2 + 3]!;
      out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
    }
    if (closed) out.push(out[0]!, out[1]!);
    else out.push(cur[(n - 1) * 2]!, cur[(n - 1) * 2 + 1]!);
    cur = out;
  }
  return cur;
}

/** 終点が始点の closeDistance 以内なら、始点に戻して閉じる（3 点以上のときだけ） */
export function closeIfNear(pts: readonly number[], closeDistance: number): number[] {
  const n = pts.length / 2;
  if (n < 3) return [...pts];
  const d = Math.hypot(pts[(n - 1) * 2]! - pts[0]!, pts[(n - 1) * 2 + 1]! - pts[1]!);
  if (d > closeDistance) return [...pts];
  const out = [...pts];
  out[(n - 1) * 2] = pts[0]!;
  out[(n - 1) * 2 + 1] = pts[1]!;
  return out;
}

export interface ShapeOptions {
  simplifyTolerance: number;
  chaikinPasses: number;
  closeDistance: number;
}

/** 手描きの点列 → 等高線の点列。短すぎる線（長さ minLength 未満）は空配列 */
export function shapeStroke(pts: readonly number[], o: ShapeOptions, minLength: number): number[] {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  if (pts.length < 4 || len < minLength) return [];
  const closed = closeIfNear(pts, o.closeDistance);
  return chaikin(simplifyDP(closed, o.simplifyTolerance), o.chaikinPasses);
}
