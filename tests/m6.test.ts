import { describe, expect, it } from 'vitest';
import { loadData } from '../src/core/data/loader';
import { setEmbargo } from '../src/core/nations/diplomacy';
import { computeDI, isEmbargoed, tradeStep } from '../src/core/nations/economy';
import { relationOf } from '../src/core/nations/territory';
import { buildWorld, stepWorld } from '../src/core/pipeline';
import type { World } from '../src/core/world';

const { data } = loadData();
const SEED = data.scenarios.comparison.defaultSeed;
const SIZE = 128;

function run(w: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    w.tick++;
    stepWorld(w, data, false);
  }
}

/** 国 1 が食料を余らせ、国 2 が足りない状況を作って貿易を 1 回だけ回す */
function setup(): World {
  const w = buildWorld(data, 'basin', SEED, SIZE, { nations: true });
  run(w, 8);
  const r = relationOf(w, 1, 2);
  r.status = 'peace';
  r.tradePactUntil = w.tick + 1000;
  w.nations[0]!.stock.food = w.nations[0]!.cons.food * 50 + 1000;
  w.nations[1]!.stock.food = 0;
  while (w.tick % data.economy.trade.market.tradeInterval !== 0) w.tick++;
  return w;
}

describe('M6 禁輸', () => {
  it('禁輸すると相手の信頼が下がり、禁輸フラグが立ち、解除しても信頼は戻らない', () => {
    const w = setup();
    const r = relationOf(w, 1, 2);
    const t0 = r.trust;
    setEmbargo(w, data, 1, 2, true);
    expect(isEmbargoed(w, 1, 2)).toBe(true);
    expect(r.trust).toBeCloseTo(t0 + data.nations.diplomacy.trust.embargoDrop, 6);
    setEmbargo(w, data, 1, 2, false);
    expect(isEmbargoed(w, 1, 2)).toBe(false);
    expect(r.trust).toBeCloseTo(t0 + data.nations.diplomacy.trust.embargoDrop, 6);
    expect(() => setEmbargo(w, data, 1, 2, false)).toThrow();
  });

  it('禁輸中は貿易が止まり、解けば食料が流れる。Σ送出 = Σ受取 + 損失', () => {
    const w = setup();
    setEmbargo(w, data, 1, 2, true);
    tradeStep(w, data);
    expect(w.diplo.lastTrade.flows.filter((f) => f.res === 'food' && f.from === 1 && f.to === 2)).toHaveLength(0);
    setEmbargo(w, data, 1, 2, false);
    tradeStep(w, data);
    const fl = w.diplo.lastTrade.flows.filter((f) => f.res === 'food' && f.from === 1 && f.to === 2);
    expect(fl.length).toBeGreaterThan(0);
    const sent = w.diplo.lastTrade.flows.reduce((a, f) => a + f.sent, 0);
    const got = w.diplo.lastTrade.flows.reduce((a, f) => a + f.received, 0);
    expect(sent).toBeCloseTo(got + w.diplo.lastTrade.loss, 6);
  });

  it('輸入に頼る国は禁輸で食料不足が悪化する（禁輸あり/なしの同条件比較）', () => {
    const go = (embargo: boolean): number => {
      const w = setup();
      if (embargo) setEmbargo(w, data, 1, 2, true);
      const n2 = w.nations[1]!;
      let cum = 0;
      for (let i = 0; i < 24; i++) {
        w.tick++;
        stepWorld(w, data, false);
        relationOf(w, 1, 2).tradePactUntil = w.tick + 1000;
        relationOf(w, 1, 2).status = 'peace';
        n2.stock.food = Math.min(n2.stock.food, n2.cons.food);
        w.nations[0]!.stock.food = w.nations[0]!.cons.food * 50 + 1000;
        cum += n2.stock.food;
      }
      return cum;
    };
    expect(go(true)).toBeLessThanOrEqual(go(false));
  });
});

describe('M6 食料輸入依存と DI', () => {
  it('輸入依存が高いほど災害耐性の項が小さくなり、係数は economy.json から来る', () => {
    const w = buildWorld(data, 'island', SEED, SIZE, { nations: true });
    run(w, 20);
    const n = w.nations[0]!;
    n.lossEma = 0;
    n.foodImport = 0;
    computeDI(w, data);
    const low = n.diParts[5]!;
    n.foodImport = n.cons.food;
    computeDI(w, data);
    const high = n.diParts[5]!;
    expect(high).toBeLessThan(low);
    const d = structuredClone(data);
    d.economy.developmentIndex.baselines.importDependencyPenalty = 0;
    computeDI(w, d);
    expect(n.diParts[5]!).toBeCloseTo(low, 9);
  });
});

describe('M6 上流の取水と信頼（水の関係）', () => {
  it('下流への流入が長期平均を割ると、下流の信頼が下がり不満が water になる', () => {
    const w = buildWorld(data, 'riverCivilization', SEED, SIZE, { nations: true });
    run(w, 12);
    const K = w.nations.length;
    for (let i = 0; i < w.diplo.inflowEma.length; i++) w.diplo.inflowEma[i] = 1e9; // 以前は十分流れていた
    const before = w.diplo.relations.map((r) => r.trust);
    while (w.tick % data.economy.trade.market.tradeInterval !== 0) w.tick++;
    w.tick += data.economy.trade.market.tradeInterval;
    stepWorld(w, data, false);
    expect(K).toBeGreaterThan(1);
    const water = w.diplo.relations.filter((r) => r.grievance === 'water');
    expect(water.length).toBeGreaterThan(0);
    const after = w.diplo.relations.map((r) => r.trust);
    expect(after.some((t, i) => t < before[i]!)).toBe(true);
  });
});
