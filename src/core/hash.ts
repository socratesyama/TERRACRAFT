/**
 * 配列ハッシュ（FNV-1a, 32bit）。決定論テスト（同じ seed → 同じハッシュ）の基盤。
 * 浮動小数は quantizeScale 倍して丸めてから混ぜる。倍率は data/runtime.json の hash.quantizeScale。
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function mixInt32(h: number, v: number): number {
  for (let s = 0; s < 32; s += 8) {
    h ^= (v >>> s) & 0xff;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h;
}

export function hashUint8(arr: Uint8Array): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < arr.length; i++) {
    h ^= arr[i];
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

export function hashInt32(arr: Int32Array | Uint32Array): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < arr.length; i++) h = mixInt32(h, arr[i] | 0);
  return h >>> 0;
}

export function hashFloat32(arr: Float32Array, quantizeScale: number): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!Number.isFinite(v)) return 0xffffffff; // NaN/Inf は専用値にして必ず検出する
    h = mixInt32(h, Math.round(v * quantizeScale) | 0);
  }
  return h >>> 0;
}

/** 複数ハッシュを順序つきで1つにまとめる（World 全体のハッシュ用） */
export function combineHashes(hashes: readonly number[]): number {
  let h = FNV_OFFSET;
  for (const x of hashes) h = mixInt32(h, x | 0);
  return h >>> 0;
}

export function hex32(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
