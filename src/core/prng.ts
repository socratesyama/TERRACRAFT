/**
 * seed 管理のPRNG（mulberry32）。決定論のため Math.random は使わない（ESLintで禁止）。
 * 同じ seed からは、実行環境によらず同じ列が出る（整数演算のみ）。
 */

export interface Rng {
  /** [0, 1) の一様乱数 */
  next(): number;
  /** [0, n) の整数 */
  nextInt(n: number): number;
  /** 現在の内部状態（保存・復元用） */
  getState(): number;
  setState(state: number): void;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt: (n) => Math.floor(next() * n),
    getState: () => a,
    setState: (s) => {
      a = s >>> 0;
    },
  };
}

/**
 * seed から独立したPRNGを派生させる（例: 国ごとに seed XOR nationId、戦争ごとに salt）。
 * 派生元の列を消費しないので、呼び出し順に依存しない。
 */
export function deriveSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
