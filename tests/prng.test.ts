import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng, deriveSeed } from '../src/core/prng';

describe('prng (mulberry32)', () => {
  it('seed=42 のゴールデン列', () => {
    const r = createRng(42);
    expect([r.next(), r.next(), r.next()]).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
    ]);
  });

  it('同じ seed なら同じ列、違う seed なら違う列', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const a = createRng(seed);
        const b = createRng(seed);
        for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
      }),
    );
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('値は [0,1)、nextInt は [0,n)', () => {
    const r = createRng(7);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const k = r.nextInt(10);
      expect(Number.isInteger(k) && k >= 0 && k < 10).toBe(true);
    }
  });

  it('状態の保存・復元で列が続く', () => {
    const r = createRng(99);
    r.next();
    const s = r.getState();
    const x = r.next();
    r.setState(s);
    expect(r.next()).toBe(x);
  });

  it('deriveSeed は決定的で、salt が違えば別の seed になる', () => {
    expect(deriveSeed(42, 1)).toBe(2168322008);
    expect(deriveSeed(42, 2)).toBe(4255841668);
    expect(deriveSeed(42, 1)).toBe(deriveSeed(42, 1));
  });
});
