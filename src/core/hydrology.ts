/**
 * 定常水文（計画書 §5.2）: Priority-Flood + D8 + 流量累積。
 * 降水に依存しない部分（充填・流向・順序・湖）と、降水を受ける部分（流出・累積）に分けてある。
 * 湖（lakeDepth）は降水計算（§7.3）の入力になるため、降水より前に求める必要がある。
 */

/** D8 の8方向。奇数番号が斜め。y は北向きに増える（terrain/rasterize と同じ向き）。 */
export const DX = [1, 1, 0, -1, -1, -1, 0, 1] as const;
export const DY = [0, 1, 1, 1, 0, -1, -1, -1] as const;
export const NO_FLOW = 255;

/**
 * 最小ヒープ。同じキーなら挿入順（seq）の小さい方を先に出す（決定論）。
 */
class MinHeap {
  private readonly keys: Float64Array;
  private readonly seqs: Int32Array;
  private readonly items: Int32Array;
  private n = 0;
  private seq = 0;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
    this.seqs = new Int32Array(capacity);
    this.items = new Int32Array(capacity);
  }

  get size(): number {
    return this.n;
  }

  private less(a: number, b: number): boolean {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.seqs[a] < this.seqs[b]);
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a];
    const s = this.seqs[a];
    const it = this.items[a];
    this.keys[a] = this.keys[b];
    this.seqs[a] = this.seqs[b];
    this.items[a] = this.items[b];
    this.keys[b] = k;
    this.seqs[b] = s;
    this.items[b] = it;
  }

  push(item: number, key: number): void {
    let i = this.n++;
    this.keys[i] = key;
    this.seqs[i] = this.seq++;
    this.items[i] = item;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    this.n--;
    if (this.n > 0) {
      this.keys[0] = this.keys[this.n];
      this.seqs[0] = this.seqs[this.n];
      this.items[0] = this.items[this.n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.n && this.less(l, m)) m = l;
        if (r < this.n && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

export interface FloodParams {
  eps: number; // priorityFlood.eps
  lakeDepthMin: number; // priorityFlood.lakeDepthMin（湖と見なす深さ。ここでは湖の判定には使わず、呼び出し側が使う）
}

export interface FloodOutput {
  filled: Float32Array;
  flowDir: Uint8Array;
  order: Int32Array;
  lakeDepth: Float32Array;
}

export type EdgeMode = 'sea' | 'wall';

/** 出口 = 海（height < seaLevel）と、edgeMode='sea' のときの外周。1つも無ければ最も低い外周セルを出口にする。 */
export function findOutlets(
  size: number,
  height: Float32Array,
  seaLevel: number,
  edgeMode: EdgeMode,
): Uint8Array {
  const n = size * size;
  const outlet = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const x = i % size;
    const y = (i / size) | 0;
    const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
    if (height[i] < seaLevel || (edgeMode === 'sea' && border)) {
      outlet[i] = 1;
      any = true;
    }
  }
  if (!any) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      const x = i % size;
      const y = (i / size) | 0;
      if (x !== 0 && y !== 0 && x !== size - 1 && y !== size - 1) continue;
      if (best < 0 || height[i] < height[best]) best = i;
    }
    outlet[best] = 1;
  }
  return outlet;
}

/**
 * Priority-Flood（Barnes 2014, epsilon 版）。窪地を充填した標高 filled、流向 flowDir、
 * 出口から上流への展開順 order、湖の深さ lakeDepth を求める。到達できたセル数を返す。
 */
export function priorityFlood(
  size: number,
  height: Float32Array,
  outlet: Uint8Array,
  eps: number,
  out: FloodOutput,
): number {
  const n = size * size;
  const { filled, flowDir, order, lakeDepth } = out;
  const heap = new MinHeap(n);
  const seen = new Uint8Array(n);
  let k = 0;

  filled.fill(0);
  flowDir.fill(NO_FLOW);

  for (let i = 0; i < n; i++) {
    if (outlet[i]) {
      filled[i] = height[i];
      seen[i] = 1;
      heap.push(i, filled[i]);
    }
  }
  while (heap.size > 0) {
    const c = heap.pop();
    order[k++] = c;
    const cx = c % size;
    const cy = (c / size) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const nb = ny * size + nx;
      if (seen[nb]) continue;
      seen[nb] = 1;
      filled[nb] = Math.max(height[nb], filled[c] + eps);
      flowDir[nb] = (d + 4) & 7; // nb から c へ向かう方向
      heap.push(nb, filled[nb]);
    }
  }
  for (let i = 0; i < n; i++) lakeDepth[i] = Math.max(0, filled[i] - height[i]);
  return k;
}

/** 流出 = 降水(mm/年)/1000 × (1 − 浸透率)。浸透率 = base + perVegetation × 植生（§5.2 手順4、hydrology.json） */
export function computeRunoff(
  precipMm: Float32Array,
  vegetation: Float32Array,
  infiltrationBase: number,
  infiltrationPerVegetation: number,
  runoff: Float32Array,
): void {
  for (let i = 0; i < runoff.length; i++) {
    runoff[i] = (precipMm[i] / 1000) * (1 - (infiltrationBase + infiltrationPerVegetation * vegetation[i]));
  }
}

/** 流量累積。order の逆順（上流 → 下流）に、受け手へ加算する。ソート不要。 */
export function accumulateFlow(
  size: number,
  order: Int32Array,
  reached: number,
  flowDir: Uint8Array,
  runoff: Float32Array,
  flowAcc: Float32Array,
): void {
  flowAcc.set(runoff);
  for (let j = reached - 1; j >= 0; j--) {
    const c = order[j];
    const d = flowDir[c];
    if (d === NO_FLOW) continue;
    const r = (((c / size) | 0) + DY[d]) * size + (c % size) + DX[d];
    flowAcc[r] += flowAcc[c];
  }
}
