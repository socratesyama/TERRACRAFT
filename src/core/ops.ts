import type { DataBundle } from './data/schema';
import { applyDiploOp, type DiploOp } from './nations/diplomacy';
import { Dirty, type World, type WorldParams } from './world';

/**
 * 計画書 §9.1 の Op（純データ）。座標は [0,1] の正規化座標（解像度に依存しない）、
 * 半径 r は世界の一辺に対する割合、標高の量 amount は正規化標高。
 */
export type Vec2 = readonly [number, number];

export interface ContourStroke {
  points: number[]; // [x0,y0,x1,y1,...]
  elevation: number;
  width: number;
}

export type ParamKey = keyof WorldParams;

export type Op =
  | { t: 'contour'; tick: number; stroke: ContourStroke }
  | { t: 'raise'; tick: number; pts: number[]; r: number; amount: number }
  | { t: 'forest'; tick: number; pts: number[]; r: number; amount: number }
  | { t: 'dam'; tick: number; a: Vec2; b: Vec2; crest: number }
  | { t: 'fill'; tick: number; pts: number[]; r: number }
  | { t: 'param'; tick: number; key: ParamKey; value: number }
  | { t: 'rain'; tick: number; amount: number }
  | DiploOp;

export interface OpResult {
  /** 立てる dirty フラグ */
  dirty: number;
  /** イベントログの文（日本語） */
  message: string;
  /** カメラの移動先（セル座標） */
  x?: number;
  y?: number;
  /** 豪雨の倍率（rain Op）。洪水の判定は呼び出し側が行う */
  surge?: number;
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** 折れ線からの距離 dist に対する重み 1 − smoothstep(dist / r)。r はセル単位。範囲外は 0 */
export function strokeWeights(size: number, pts: number[], rNorm: number): Float32Array {
  const out = new Float32Array(size * size);
  const rc = Math.max(0.5, rNorm * (size - 1));
  const P: number[] = pts.map((v) => v * (size - 1));
  const segs = Math.max(1, P.length / 2 - 1);
  for (let s = 0; s < segs; s++) {
    const ax = P[s * 2]!;
    const ay = P[s * 2 + 1]!;
    const bx = P[s * 2 + 2] ?? ax;
    const by = P[s * 2 + 3] ?? ay;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rc));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + rc));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rc));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by) + rc));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
        const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
        const wgt = 1 - smooth(d / rc);
        const i = y * size + x;
        if (wgt > out[i]!) out[i] = wgt;
      }
    }
  }
  return out;
}

function firstCell(size: number, pts: number[]): { x: number; y: number } {
  return { x: Math.round(pts[0]! * (size - 1)), y: Math.round(pts[1]! * (size - 1)) };
}

function applyDam(w: World, op: Extract<Op, { t: 'dam' }>): { x: number; y: number; cells: number } {
  const n = w.size;
  const h = w.primary.height;
  const ax = op.a[0] * (n - 1);
  const ay = op.a[1] * (n - 1);
  const bx = op.b[0] * (n - 1);
  const by = op.b[1] * (n - 1);
  const len = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay)));
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const cellAt = (k: number): number => {
    const x = Math.round(ax + ux * k);
    const y = Math.round(ay + uy * k);
    return x < 0 || y < 0 || x >= n || y >= n ? -1 : y * n + x;
  };
  // 川床 = 線上の最も低い標高。壁の高さ = 川床 + crest
  let bed = Infinity;
  for (let k = 0; k <= len; k++) {
    const c = cellAt(k);
    if (c >= 0) bed = Math.min(bed, h[c]!);
  }
  const wall = bed + op.crest;
  // 両端を谷壁へスナップ: 壁より高い地形に当たるまで線を延ばす（最大 12 セル）
  let from = 0;
  let to = len;
  for (let e = 0; e < 12; e++) {
    const c = cellAt(from - 1);
    if (c < 0 || h[c]! >= wall) break;
    from--;
  }
  for (let e = 0; e < 12; e++) {
    const c = cellAt(to + 1);
    if (c < 0 || h[c]! >= wall) break;
    to++;
  }
  let cells = 0;
  for (let k = from; k <= to; k++) {
    const c = cellAt(k);
    if (c >= 0 && h[c]! < wall) {
      h[c] = Math.min(1, wall);
      cells++;
    }
  }
  return { x: Math.round((ax + bx) / 2), y: Math.round((ay + by) / 2), cells };
}

/** Op を世界へ適用する。副作用は一次状態の変更と dirty フラグだけ（再計算は呼び出し側）。 */
export function applyOp(w: World, data: DataBundle, op: Op): OpResult {
  const n = w.size;
  const meters = (a: number): number => Math.round(Math.abs(a) * w.maxElevation);
  switch (op.t) {
    case 'raise': {
      const wt = strokeWeights(n, op.pts, op.r);
      const h = w.primary.height;
      for (let i = 0; i < h.length; i++) {
        if (wt[i]! > 0) h[i] = Math.min(1, Math.max(0, h[i]! + op.amount * wt[i]!));
      }
      const c = firstCell(n, op.pts);
      return {
        dirty: Dirty.Height | Dirty.Climate,
        message: op.amount < 0 ? `山を削った（標高 −${meters(op.amount)} m）` : `土を盛った（標高 +${meters(op.amount)} m）`,
        ...c,
      };
    }
    case 'forest': {
      const wt = strokeWeights(n, op.pts, op.r);
      const v = w.primary.vegetation;
      for (let i = 0; i < v.length; i++) {
        if (wt[i]! > 0 && w.primary.height[i]! >= w.params.seaLevel) {
          v[i] = Math.min(1, Math.max(0, v[i]! + op.amount * wt[i]!));
        }
      }
      return {
        dirty: Dirty.Climate,
        message: op.amount < 0 ? '森を伐採した' : '植林した',
        ...firstCell(n, op.pts),
      };
    }
    case 'dam': {
      const r = applyDam(w, op);
      return {
        dirty: Dirty.Height | Dirty.Water,
        message: `ダムを築いた（高さ ${meters(op.crest)} m、${r.cells} セル）`,
        x: r.x,
        y: r.y,
      };
    }
    case 'fill': {
      const wt = strokeWeights(n, op.pts, op.r);
      const h = w.primary.height;
      const lakeMin = data.hydrology.priorityFlood.lakeDepthMin;
      let cells = 0;
      for (let i = 0; i < h.length; i++) {
        if (wt[i]! <= 0) continue;
        if (h[i]! < w.params.seaLevel) {
          h[i] = w.params.seaLevel + 0.02;
          cells++;
        } else if (w.derived.lakeDepth[i]! > lakeMin) {
          h[i] = w.derived.filled[i]!;
          cells++;
        }
      }
      return { dirty: Dirty.Height | Dirty.Water, message: `水域を埋め立てた（${cells} セル）`, ...firstCell(n, op.pts) };
    }
    case 'param': {
      switch (op.key) {
        case 'rainfallScale':
        case 'temperatureBias':
          w.params[op.key] = op.value;
          return { dirty: Dirty.Climate, message: `${op.key === 'rainfallScale' ? '降水倍率' : '気温補正'}を ${op.value} にした` };
        case 'windDir':
          w.params.windDir = ((Math.round(op.value) % 8) + 8) % 8;
          return { dirty: Dirty.Climate, message: '風向を変えた' };
        case 'peaceMode':
          w.params.peaceMode = op.value >= 0.5 ? 1 : 0;
          return { dirty: 0, message: w.params.peaceMode ? '平和モードにした（戦争は起きない）' : '平和モードをやめた' };
        case 'seaLevel':
          w.params.seaLevel = Math.min(0.5, Math.max(0, op.value));
          return { dirty: Dirty.Height | Dirty.Climate | Dirty.Water, message: `海面を ${w.params.seaLevel.toFixed(2)} にした` };
        default:
          throw new RangeError(`未対応のパラメータ: ${op.key}`);
      }
    }
    case 'rain':
      w.civ.stormTick = w.tick;
      return { dirty: 0, message: `豪雨（倍率 ${op.amount.toFixed(1)}）`, surge: op.amount };
    case 'diplo':
    case 'military':
      return { dirty: 0, message: applyDiploOp(w, data, op) };
    case 'contour':
      throw new RangeError('ゲーム中の等高線の追加は未対応です（地形はゲーム開始前に描く §21.1）');
  }
}
