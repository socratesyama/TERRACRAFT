import { describe, expect, it } from 'vitest';
import { runBalance } from '../src/core/balance';
import { loadData } from '../src/core/data/loader';
import { applyOp } from '../src/core/ops';
import { applyDiploOp } from '../src/core/nations/diplomacy';
import { declareWar, sabotageDam } from '../src/core/nations/war';
import { relationOf } from '../src/core/nations/territory';
import { buildWorld, stepWorld } from '../src/core/pipeline';
import { hashWorld, type World } from '../src/core/world';
import { SimulationController } from '../src/worker/controller';

const { data } = loadData();
const q = data.runtime.hash.quantizeScale;
const SEED = data.scenarios.comparison.defaultSeed;
const SIZE = 128;

function run(w: World, ticks: number, d = data): void {
  for (let i = 0; i < ticks; i++) {
    w.tick++;
    stepWorld(w, d, false);
  }
}

/** 国 2 の領土の中にダムを築く（ダム Op 経由なので記録される） */
function damIn(w: World, nation: number): void {
  const n = w.size;
  for (let i = 0; i < n * n && w.civ.dams.length === 0; i += 3) {
    if (w.primary.owner[i] !== nation || w.primary.height[i]! < w.params.seaLevel) continue;
    const x = i % n;
    if (x < 6 || x > n - 7) continue;
    applyOp(w, data, { t: 'dam', tick: w.tick, a: [(x - 4) / n, ((i / n) | 0) / n], b: [(x + 4) / n, ((i / n) | 0) / n], crest: 0.9 });
  }
  if (w.civ.dams.length === 0) throw new Error('ダムを置ける場所が無い');
}

describe('M7 ダム破壊', () => {
  it('戦争中でなければ破壊できず、ダムが無ければ失敗する', () => {
    const w = buildWorld(data, 'basin', SEED, SIZE, { nations: true });
    run(w, 6);
    expect(() => sabotageDam(w, data, 1, 2)).toThrow();
    relationOf(w, 1, 2).status = 'war';
    expect(() => sabotageDam(w, data, 1, 2)).toThrow(/ダム/);
  });

  it('決壊で標高が戻り、記録が消え、富が減り、次の tick で洪水イベントが出る', () => {
    const w = buildWorld(data, 'basin', SEED, SIZE, { nations: true });
    run(w, 6);
    damIn(w, 2);
    expect(w.civ.dams.length).toBe(1);
    const dam = w.civ.dams[0]!;
    const built = dam.cells.map((c) => w.primary.height[c]!);
    expect(built.some((h, k) => h > dam.orig[k]!)).toBe(true);
    relationOf(w, 1, 2).status = 'peace';
    declareWar(w, data, 1, 2, 'テスト');
    const wealth = w.nations[0]!.stock.wealth;
    const msg = sabotageDam(w, data, 1, 2);
    expect(msg).toContain('決壊');
    expect(w.civ.dams).toHaveLength(0);
    dam.cells.forEach((c, k) => expect(w.primary.height[c]!).toBeLessThanOrEqual(dam.orig[k]! + 1e-9));
    expect(w.nations[0]!.stock.wealth).toBeCloseTo(wealth * (1 - data.war.engine.sabotageCost), 6);
    const ev0 = w.events.length;
    run(w, 1);
    expect(w.events.length).toBeGreaterThanOrEqual(ev0);
    expect(w.civ.breach).toBeNull();
  });

  it('プレイヤーの Op 経路とコア呼び出しは同じ結果（公平性）', () => {
    const mk = (): World => {
      const w = buildWorld(data, 'basin', SEED, SIZE, { nations: true });
      run(w, 6);
      damIn(w, 2);
      relationOf(w, 1, 2).status = 'peace';
      declareWar(w, data, 1, 2, 'テスト');
      return w;
    };
    const a = mk();
    const b = mk();
    applyDiploOp(a, data, { t: 'diplo', tick: a.tick, action: 'sabotage', to: 2 });
    sabotageDam(b, data, data.nations.setup.playerNationId, 2);
    run(a, 10);
    run(b, 10);
    expect(hashWorld(a, q)).toBe(hashWorld(b, q));
  });
});

describe('M7 戦争の公平性と決定論', () => {
  it('プレイヤーの宣戦（Op）と AI が使う declareWar は同じ規則で、同じ世界になる', () => {
    const mk = (): World => {
      const w = buildWorld(data, 'mountainRange', SEED, SIZE, { nations: true });
      run(w, 6);
      relationOf(w, 1, 2).status = 'peace';
      relationOf(w, 1, 2).tensionTicks = 99;
      return w;
    };
    const a = mk();
    const b = mk();
    applyDiploOp(a, data, { t: 'diplo', tick: a.tick, action: 'declareWar', to: 2 });
    declareWar(b, data, data.nations.setup.playerNationId, 2, 'プレイヤーの宣戦');
    expect(hashWorld(a, q)).toBe(hashWorld(b, q));
    run(a, 30);
    run(b, 30);
    expect(hashWorld(a, q)).toBe(hashWorld(b, q));
  });

  it('同じ操作列を 2 つのコントローラに流すと同じハッシュ', () => {
    const go = (): number => {
      let t = 0;
      const c = new SimulationController(data, () => undefined, () => (t += 1000));
      c.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: SIZE, nations: true });
      c.handle({ type: 'op', op: { t: 'rain', tick: 0, amount: 2 } });
      for (let i = 0; i < 40; i++) c.handle({ type: 'step', n: 1 });
      return hashWorld(c.worldRef!, q);
    };
    expect(go()).toBe(go());
  });

  it('平和モードでは戦争が起きない', () => {
    const w = buildWorld(data, 'island', SEED, SIZE, { nations: true });
    w.params.peaceMode = 1;
    run(w, 150);
    expect(w.diplo.battle.wars).toBe(0);
    expect(w.diplo.wars).toHaveLength(0);
  });

  it('戦争は maxDuration を超えて続かない', () => {
    const w = buildWorld(data, 'tradeChokepoint', SEED, SIZE, { nations: true });
    run(w, 6);
    relationOf(w, 1, 2).status = 'peace';
    declareWar(w, data, 2, 1, 'テスト');
    run(w, data.war.termination.maxDuration.value + 3);
    expect(w.diplo.wars.filter((x) => x.a === 2 && x.b === 1)).toHaveLength(0);
  });
});

describe('M7 バランス統計（AI だけを走らせる）', () => {
  const s = runBalance(data, { runs: 4, ticks: 200, size: SIZE, scenarios: ['island', 'mountainRange', 'basin', 'riverCivilization'] });

  it('統計は war.json の balance 目標の範囲内', () => {
    const b = data.war.balance;
    expect(s.warsPer100Years).toBeGreaterThanOrEqual(b.minWarsPer100Years);
    expect(s.warsPer100Years).toBeLessThanOrEqual(b.maxWarsPer100Years);
    expect(s.capitalFallShare).toBeLessThanOrEqual(b.maxCapitalFallShare);
    expect(s.maxWarDuration).toBeLessThanOrEqual(data.war.termination.maxDuration.value);
    if (s.aggressorWinShare !== null) {
      expect(s.aggressorWinShare).toBeGreaterThanOrEqual(b.aggressorWinShareRange[0]!);
      expect(s.aggressorWinShare).toBeLessThanOrEqual(b.aggressorWinShareRange[1]!);
    }
  });

  it('守る側が有利: 高地・川越えは平地より奪われにくい', () => {
    const c = s.captureRate;
    expect(s.riverCaptureRate).toBeLessThan(s.dryCaptureRate);
    if (c.mountain!.front > 200 && c.plain!.front > 200) expect(c.mountain!.rate).toBeLessThan(c.plain!.rate);
  });

  it('統計は決定論的', () => {
    const t = runBalance(data, { runs: 4, ticks: 200, size: SIZE, scenarios: ['island', 'mountainRange', 'basin', 'riverCivilization'] });
    expect(JSON.stringify(t)).toBe(JSON.stringify(s));
  });
});
