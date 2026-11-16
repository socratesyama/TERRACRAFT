import { describe, expect, it } from 'vitest';
import { combineHashes, hashFloat32, hashUint8, hex32 } from '../src/core/hash';

describe('hash (FNV-1a)', () => {
  it('既知のFNV-1a値と一致する（"a" = e40c292c）', () => {
    expect(hex32(hashUint8(new Uint8Array([97])))).toBe('e40c292c');
    expect(hex32(hashUint8(new Uint8Array([1, 2, 3, 4])))).toBe('5734a87d');
  });

  it('量子化の範囲内の差は同じハッシュ、範囲を超えると変わる', () => {
    const q = 100000;
    const a = hashFloat32(new Float32Array([0, 0.5, 1]), q);
    expect(hex32(a)).toBe('b20e31e7');
    expect(hashFloat32(new Float32Array([0, 0.5 + 1e-7, 1]), q)).toBe(a);
    expect(hashFloat32(new Float32Array([0, 0.5 + 1e-3, 1]), q)).not.toBe(a);
  });

  it('NaN / Infinity は専用値になる', () => {
    expect(hashFloat32(new Float32Array([NaN]), 1000)).toBe(0xffffffff);
    expect(hashFloat32(new Float32Array([Infinity]), 1000)).toBe(0xffffffff);
  });

  it('combineHashes は順序に依存する', () => {
    expect(hex32(combineHashes([1, 2, 3]))).toBe('794671b5');
    expect(combineHashes([1, 2, 3])).not.toBe(combineHashes([3, 2, 1]));
  });
});
