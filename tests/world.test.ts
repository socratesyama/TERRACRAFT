import { describe, expect, it } from 'vitest';
import { loadData } from '../src/core/data/loader';
import { Dirty, allocWorld, hashWorld } from '../src/core/world';

const { data } = loadData();
const q = data.runtime.hash.quantizeScale;

describe('World', () => {
  it('scale.json の値で確保される（既定は 192²）', () => {
    const w = allocWorld(data, { seed: 42 });
    expect(w.size).toBe(data.scale.grid.defaultSize);
    expect(w.cellSize).toBe(data.scale.cellSize.value);
    expect(w.params.seaLevel).toBe(data.scale.seaLevel.value);
    expect(w.primary.height.length).toBe(w.size * w.size);
    expect(w.dirty).toBe(Dirty.Height | Dirty.Climate | Dirty.Water);
  });

  it('未対応のサイズは拒否する', () => {
    expect(() => allocWorld(data, { seed: 1, size: 100 })).toThrow(RangeError);
  });

  it('同じ入力から同じハッシュ、seed が違えば違うハッシュ', () => {
    const a = allocWorld(data, { seed: 42, size: 128 });
    const b = allocWorld(data, { seed: 42, size: 128 });
    expect(hashWorld(a, q)).toBe(hashWorld(b, q));
    expect(hashWorld(allocWorld(data, { seed: 43, size: 128 }), q)).not.toBe(hashWorld(a, q));
  });

  it('配列を変えるとハッシュが変わる', () => {
    const a = allocWorld(data, { seed: 42, size: 128 });
    const h0 = hashWorld(a, q);
    a.primary.height[100] = 0.5;
    expect(hashWorld(a, q)).not.toBe(h0);
  });
});
