import { describe, expect, it } from 'vitest';
import {
  SPECIAL_BIOMES,
  biomeKeys,
  classifyWhittaker,
  distanceTransform,
  maritimeLut,
} from '../src/core/climate/climate';
import { loadData } from '../src/core/data/loader';
import { DX, DY } from '../src/core/hydrology';
import { SHOWCASE_SCENARIOS, buildWorld, stepClimate } from '../src/core/pipeline';
import { Dirty, hashDerived, hashWorld, type World } from '../src/core/world';

const { data } = loadData();
const q = data.runtime.hash.quantizeScale;
const SEED = data.scenarios.comparison.defaultSeed;
const SIZE = 128;

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    w.tick++;
    stepClimate(w, data, false);
  }
}

function landMean(w: World, a: Float32Array): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (w.primary.height[i]! >= w.params.seaLevel) {
      s += a[i]!;
      n++;
    }
  }
  return s / n;
}

describe('M2 部品', () => {
  it('距離変換: 直線距離に近く、ソースは 0', () => {
    const n = 9;
    const src = new Uint8Array(n * n);
    src[4 * n + 4] = 1;
    const out = new Float32Array(n * n);
    distanceTransform(n, src, out);
    expect(out[4 * n + 4]).toBe(0);
    expect(out[4 * n + 7]).toBeCloseTo(3, 5);
    expect(out[7 * n + 7]).toBeCloseTo(4, 5); // 斜め 3 歩 = 4/3 × 3
  });

  it('海の緩和 LUT は 1 から単調に減る（exp を使わない）', () => {
    const lut = maritimeLut(data.climate.temperature.maritimeModeration.decayPerCell, 64);
    expect(lut[0]).toBe(1);
    for (let i = 1; i < lut.length; i++) expect(lut[i]!).toBeLessThan(lut[i - 1]!);
  });

  it('バイオーム番号は特別区分 4 つのあとに whittaker のキー順', () => {
    const keys = biomeKeys(data);
    expect(keys.slice(0, 4)).toEqual([...SPECIAL_BIOMES]);
    expect(keys.slice(4)).toEqual(Object.keys(data.ecology.biomes.whittaker));
  });

  it('Whittaker: 高温多雨は熱帯雨林、少雨は砂漠、冷涼は草原／林', () => {
    const keys = biomeKeys(data);
    expect(keys[classifyWhittaker(data, 25, 3000, 0)]).toBe('tropicalRainforest');
    expect(keys[classifyWhittaker(data, 20, 100, 0)]).toBe('desert');
    expect(keys[classifyWhittaker(data, 10, 1000, 0)]).toBe('temperateForest');
    expect(keys[classifyWhittaker(data, 10, 500, 0)]).toBe('temperateGrassland');
  });

  it('ヒステリシス: しきい値のすぐ内側では前回の区分を保つ', () => {
    const keys = biomeKeys(data);
    const forest = keys.indexOf('temperateForest');
    const grass = keys.indexOf('temperateGrassland');
    const justBelow = data.ecology.biomes.whittaker.temperateForest.mapMin - 20; // 20mm 下（±120mm 以内）
    expect(classifyWhittaker(data, 10, justBelow, forest)).toBe(forest);
    expect(classifyWhittaker(data, 10, justBelow, grass)).toBe(grass);
  });
});

describe.each(SHOWCASE_SCENARIOS)('M2 気候と植生: %s', (id) => {
  it('同じ seed・同じ tick 数で配列のハッシュが一致する', () => {
    const a = buildWorld(data, id, SEED, SIZE);
    const b = buildWorld(data, id, SEED, SIZE);
    run(a, 30);
    run(b, 30);
    expect(hashWorld(a, q)).toBe(hashWorld(b, q));
    expect(hashDerived(a, q)).toBe(hashDerived(b, q));
  });

  it('植生は [0,1]、水の上は 0', () => {
    const w = buildWorld(data, id, SEED, SIZE);
    run(w, 20);
    for (let i = 0; i < w.primary.vegetation.length; i++) {
      const v = w.primary.vegetation[i]!;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (w.primary.height[i]! < w.params.seaLevel) expect(v).toBe(0);
    }
  });

  it('降水を減らすと植生が減り、増やすと増える（乾燥化テスト）', () => {
    const base = buildWorld(data, id, SEED, SIZE);
    const dry = buildWorld(data, id, SEED, SIZE);
    const wet = buildWorld(data, id, SEED, SIZE);
    dry.params.rainfallScale = 0.2;
    dry.dirty |= Dirty.Climate;
    wet.params.rainfallScale = 2;
    wet.dirty |= Dirty.Climate;
    for (const w of [base, dry, wet]) run(w, 200);
    const vb = landMean(base, base.primary.vegetation);
    expect(landMean(dry, dry.primary.vegetation)).toBeLessThan(vb);
    expect(landMean(wet, wet.primary.vegetation)).toBeGreaterThan(vb);
  });

  it('温度補正を上げると平均気温が上がる', () => {
    const a = buildWorld(data, id, SEED, SIZE);
    const b = buildWorld(data, id, SEED, SIZE);
    b.params.temperatureBias = 3;
    b.dirty |= Dirty.Climate;
    run(a, 2);
    run(b, 2);
    expect(landMean(b, b.derived.temperature) - landMean(a, a.derived.temperature)).toBeGreaterThan(2.5);
  });
});

describe('M2 雨陰の砂漠', () => {
  it('盆地では風下斜面のほうが風上斜面より砂漠の割合が高い', () => {
    const w = buildWorld(data, 'basin', SEED, 192);
    run(w, 10);
    const desert = biomeKeys(data).indexOf('desert');
    const n = w.size;
    const dx = DX[w.params.windDir]!;
    const dy = DY[w.params.windDir]!;
    const cls = { up: [0, 0], lee: [0, 0] };
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        const h = w.primary.height;
        if (h[i]! < 0.3) continue; // 山地側の斜面だけを比べる
        const g = h[(y + dy) * n + x + dx]! - h[(y - dy) * n + x - dx]!;
        const k = g > 0.01 ? cls.up : g < -0.01 ? cls.lee : null;
        if (!k) continue;
        k[0]!++;
        if (w.derived.biome[i] === desert) k[1]!++;
      }
    }
    expect(cls.up[0]).toBeGreaterThan(0);
    expect(cls.lee[0]).toBeGreaterThan(0);
    expect(cls.lee[1]! / cls.lee[0]!).toBeGreaterThan(cls.up[1]! / cls.up[0]!);
  });
});
