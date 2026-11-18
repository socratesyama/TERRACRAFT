import { describe, expect, it } from 'vitest';
import { loadData } from '../src/core/data/loader';
import { applyOp } from '../src/core/ops';
import { restoreWorld, snapshotWorld } from '../src/core/history';
import { buildWorld, stepWorld } from '../src/core/pipeline';
import { computeDI, priceOf, transportMode } from '../src/core/nations/economy';
import { relationOf } from '../src/core/nations/territory';
import { declareWar, warStep } from '../src/core/nations/war';
import { hashWorld, type World } from '../src/core/world';
import { SimulationController } from '../src/worker/controller';
import type { FromWorker } from '../src/worker/protocol';

const { data } = loadData();
const q = data.runtime.hash.quantizeScale;
const SEED = data.scenarios.comparison.defaultSeed;
const SIZE = 128;

const world = (scenario = 'island', d = data): World => buildWorld(d, scenario, SEED, SIZE, { nations: true });
function run(w: World, ticks: number, d = data): void {
  for (let i = 0; i < ticks; i++) {
    w.tick++;
    stepWorld(w, d, false);
  }
}

describe('M4 国家・領土', () => {
  it('国は nations.setup.nationCount 個、首都は minDistance 以上離れ、自分の領土の中にある', () => {
    const w = world();
    expect(w.nations).toHaveLength(data.nations.setup.nationCount);
    const caps = w.nations.map((n) => w.settlements.find((s) => s.id === n.capitalId)!);
    for (let a = 0; a < caps.length; a++) {
      expect(w.primary.owner[caps[a]!.y * w.size + caps[a]!.x]).toBe(a + 1);
      expect(caps[a]!.nationId).toBe(a + 1);
      for (let b = a + 1; b < caps.length; b++) {
        expect(Math.hypot(caps[a]!.x - caps[b]!.x, caps[a]!.y - caps[b]!.y)).toBeGreaterThanOrEqual(data.nations.capital.minDistance);
      }
    }
  });

  it('初期ポテンシャルの差は許容に近い（tolerance を超えた場合はログに残る）', () => {
    const w = world('basin');
    const p = w.nations.map((n) => n.potential);
    const spread = (Math.max(...p) - Math.min(...p)) / Math.max(...p);
    expect(spread).toBeLessThan(data.nations.potentialBalance.tolerance * 2);
    expect(w.events.some((e) => e.kind === 'nation' && e.message.includes('初期ポテンシャルの差'))).toBe(true);
  });

  it('領土は水域を含まず、集落は自分の国の領土にだけ建つ', () => {
    const w = world();
    run(w, 80);
    for (let i = 0; i < w.size * w.size; i++) {
      if (w.primary.height[i]! < w.params.seaLevel) expect(w.primary.owner[i]).toBe(0);
    }
    for (const s of w.settlements) expect(w.primary.owner[s.y * w.size + s.x]).toBe(s.nationId);
  });

  it('同じ seed・同じ tick 数でハッシュ（領土・国・外交・戦争を含む）が一致し、数値は有限', () => {
    const a = world('mountainRange');
    const b = world('mountainRange');
    run(a, 120);
    run(b, 120);
    expect(hashWorld(a, q)).toBe(hashWorld(b, q));
    for (const n of a.nations) {
      for (const v of [n.pop, n.army, n.di, n.stock.food, n.stock.wood, n.stock.ore, n.stock.wealth]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('M4 経済・貿易', () => {
  it('価格は不足すると上がり、余ると下がる（上下限つき）', () => {
    const w = world();
    const n = w.nations[0]!;
    n.cons.food = 100;
    n.stock.food = 1;
    const scarce = priceOf(data, n, 'food');
    n.stock.food = 100000;
    const plenty = priceOf(data, n, 'food');
    expect(scarce).toBeGreaterThan(plenty);
    expect(scarce).toBeLessThanOrEqual(data.economy.trade.basePrice.food * data.economy.trade.priceClamp.max + 1e-9);
    expect(plenty).toBeGreaterThanOrEqual(data.economy.trade.basePrice.food * data.economy.trade.priceClamp.min - 1e-9);
  });

  it('貿易は保存則を守る（Σ輸出 = Σ輸入 + 輸送損失）。取引は協定のある国どうしだけ', () => {
    const w = world('riverCivilization');
    let rounds = 0;
    for (let i = 0; i < 200; i++) {
      w.tick++;
      stepWorld(w, data, false);
      const lt = w.diplo.lastTrade;
      if (lt.tick === w.tick && lt.flows.length > 0) {
        rounds++;
        const sent = lt.flows.reduce((a, f) => a + f.sent, 0);
        const got = lt.flows.reduce((a, f) => a + f.received, 0);
        expect(Math.abs(sent - got - lt.loss)).toBeLessThan(1e-6);
        for (const f of lt.flows) expect(f.received).toBeLessThanOrEqual(f.sent);
      }
    }
    expect(rounds).toBeGreaterThan(0);
  });

  it('JSON を変えるだけで挙動が変わる: tradeInterval を極端に大きくすると貿易が起きない', () => {
    const d = structuredClone(data);
    d.economy.trade.market.tradeInterval = 100000;
    const w = world('riverCivilization', d);
    let rounds = 0;
    for (let i = 0; i < 120; i++) {
      w.tick++;
      stepWorld(w, d, false);
      if (w.diplo.lastTrade.flows.length > 0) rounds++;
    }
    expect(rounds).toBe(0);
  });

  it('輸送は、港どうしなら海路、そうでなければ陸路（川の条件があれば川）', () => {
    const w = world();
    expect(['road', 'riverDown', 'riverUp']).toContain(transportMode(w, w.nations[0]!, w.nations[1]!).mode);
    for (const id of [1, 2]) {
      const s = w.settlements.find((c) => c.id === w.nations[id - 1]!.capitalId)!;
      s.tier = 3;
    }
    expect(transportMode(w, w.nations[0]!, w.nations[1]!).mode).toBe('sea');
  });

  it('発展度 DI は 0〜100 で、森林が少なすぎると上限がかかる', () => {
    const w = world();
    run(w, 40);
    for (const n of w.nations) {
      expect(n.di).toBeGreaterThanOrEqual(0);
      expect(n.di).toBeLessThanOrEqual(100);
      expect(n.diParts).toHaveLength(8);
    }
    w.primary.vegetation.fill(0);
    w.derived.biome.fill(0); // 森林なし
    computeDI(w, data);
    for (const n of w.nations) expect(n.di).toBeLessThanOrEqual(data.nations.developmentIndex.capPenalty.cap.value);
  });
});

/** 国境が接する 2 国を探す（接していなければ null） */
function neighbors(w: World): [number, number] | null {
  for (const r of w.diplo.relations) {
    let b = 0;
    for (let y = 0; y < w.size; y++) for (let x = 0; x + 1 < w.size; x++) {
      const i = y * w.size + x;
      const o1 = w.primary.owner[i]!;
      const o2 = w.primary.owner[i + 1]!;
      if ((o1 === r.a && o2 === r.b) || (o1 === r.b && o2 === r.a)) b++;
    }
    if (b > 3) return [r.a, r.b];
  }
  return null;
}

describe('M4 外交・戦争', () => {
  it('Lanchester: 同じ兵力なら防御側の損耗は攻撃側の約 1/defenderKillAdvantage（地形倍率を含め以上）', () => {
    const w = world('basin');
    run(w, 8);
    const pair = neighbors(w);
    expect(pair).not.toBeNull();
    const [a, b] = pair!;
    declareWar(w, data, a, b, 'テスト');
    const A = w.nations[a - 1]!;
    const B = w.nations[b - 1]!;
    A.army = B.army = 100;
    A.stock.ore = B.stock.ore = 0;
    warStep(w, data);
    const lossA = 100 - A.army;
    const lossB = 100 - B.army;
    expect(lossB).toBeGreaterThan(0);
    expect(lossA / lossB).toBeGreaterThanOrEqual(data.war.lanchester.defenderKillAdvantage.value * 0.99);
  });

  it('防御側の地形倍率が大きいほど攻撃側の最良の兵力比が下がる（JSON の forest を変えると結果が変わる）', () => {
    const w = world('basin');
    run(w, 8);
    const [a, b] = neighbors(w)!;
    declareWar(w, data, a, b, 'テスト');
    w.nations[a - 1]!.army = 300;
    w.nations[b - 1]!.army = 100;
    const w2 = structuredClone(w);
    warStep(w, data);
    const d2 = structuredClone(data);
    d2.war.terrain.forest = 9;
    d2.war.terrain.rollingHills = 9;
    d2.war.terrain.mountain = 9;
    d2.war.terrain.openPlain = 9;
    d2.war.terrain.marsh = 9;
    d2.war.terrain.urbanFortress.value = 9;
    warStep(w2, d2);
    expect(w2.diplo.wars[0]!.capturedByA).toBeLessThanOrEqual(w.diplo.wars[0]!.capturedByA);
    expect(w2.diplo.wars[0]!.note).not.toBe(w.diplo.wars[0]!.note);
  });

  it('平和モードでは戦争が起きない', () => {
    const w = world('basin');
    applyOp(w, data, { t: 'param', tick: 0, key: 'peaceMode', value: 1 });
    run(w, 250);
    expect(w.events.some((e) => e.kind === 'war')).toBe(false);
    expect(() => declareWar(w, data, 1, 2, 'テスト')).toThrow();
  });

  it('国は滅びない: 何度戦っても領土は初期の minSurvivingTerritoryShare 以上、全員に集落が残る', () => {
    const w = world('riverCivilization');
    run(w, 400);
    for (const n of w.nations) {
      expect(n.cells).toBeGreaterThanOrEqual(Math.floor(n.baseCells * data.war.engine.minSurvivingTerritoryShare) - 1);
      expect(w.settlements.some((s) => s.nationId === n.id)).toBe(true);
    }
  });

  it('戦争は必ず終わる（maxDuration）。終わると休戦のクールダウンに入る', () => {
    const w = world('basin');
    run(w, 8);
    const [a, b] = neighbors(w)!;
    declareWar(w, data, a, b, 'テスト');
    w.nations[a - 1]!.mobTarget = 1;
    for (let i = 0; i < data.war.termination.maxDuration.value + 2; i++) {
      w.tick++;
      stepWorld(w, data, false);
      if (w.diplo.wars.length === 0) break;
    }
    expect(w.diplo.wars).toHaveLength(0);
    expect(relationOf(w, a, b).status).toBe('truce');
    expect(() => declareWar(w, data, a, b, 'テスト')).toThrow();
  });

  it('外交 Op: 贈り物で信頼が上がる。Undo の代わりのスナップショット復元でハッシュが完全に戻る', () => {
    const w = world();
    run(w, 30);
    const snap = snapshotWorld(w);
    const h = hashWorld(w, q);
    const before = relationOf(w, 1, 2).trust;
    applyOp(w, data, { t: 'diplo', tick: w.tick, action: 'gift', to: 2 });
    expect(relationOf(w, 1, 2).trust).toBeGreaterThan(before);
    applyOp(w, data, { t: 'military', tick: w.tick, mobilization: 1 });
    run(w, 20);
    restoreWorld(w, snap);
    expect(hashWorld(w, q)).toBe(h);
  });

  it('AI は突然宣戦しない: 宣戦の前に必ず緊張の期間がある（warWarningTicks）', () => {
    const w = world('riverCivilization');
    const tension = new Map<string, number>();
    for (let i = 0; i < 300; i++) {
      w.tick++;
      const before = new Set(w.diplo.wars.map((x) => x.id));
      stepWorld(w, data, false);
      for (const r of w.diplo.relations) if (r.status === 'tension') tension.set(`${r.a}-${r.b}`, Math.max(tension.get(`${r.a}-${r.b}`) ?? 0, r.tensionTicks));
      for (const war of w.diplo.wars) {
        if (before.has(war.id) || war.casus === 'プレイヤーの宣戦') continue;
        const key = `${Math.min(war.a, war.b)}-${Math.max(war.a, war.b)}`;
        expect(tension.get(key) ?? 0).toBeGreaterThanOrEqual(data.nations.diplomacy.ai.warWarningTicks - 1);
      }
    }
  });
});

describe('M4 Worker・描画データ', () => {
  function ctl() {
    const msgs: FromWorker[] = [];
    let clock = 0;
    const c = new SimulationController(data, (m) => msgs.push(m), () => (clock += 1));
    c.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: SIZE, nations: true });
    return { c, msgs };
  }

  it('スナップショットに国・外交・戦争が載り、4 枚目のテクスチャに領有国が入る', () => {
    const { msgs } = ctl();
    const snap = msgs.find((m) => m.type === 'snapshot');
    expect(snap).toBeDefined();
    if (snap?.type !== 'snapshot') return;
    expect(snap.nations).toHaveLength(data.nations.setup.nationCount);
    expect(snap.diplo.relations.length).toBeGreaterThan(0);
    const f = new Float32Array(snap.pack.data);
    const n = SIZE * SIZE;
    const fourth = n * 4 * 3;
    const owners = new Set<number>();
    for (let i = 0; i < n; i++) owners.add(f[fourth + i * 4]!);
    expect(owners.has(1)).toBe(true);
  });

  it('外交 Op が今はできないときは notice を返し、シミュレーションは止まらない', () => {
    const { c, msgs } = ctl();
    c.handle({ type: 'op', op: { t: 'diplo', tick: 0, action: 'declareWar', to: 99 } });
    expect(msgs.some((m) => m.type === 'notice')).toBe(true);
    expect(msgs.some((m) => m.type === 'error')).toBe(false);
    c.handle({ type: 'op', op: { t: 'diplo', tick: 0, action: 'gift', to: 2 } });
    expect(c.worldRef!.diplo.relations[0]!.trust).toBeGreaterThan(data.nations.diplomacy.trust.initial - 1);
  });

  it('国家モードをオフにすると従来どおり（国なし）で動く', () => {
    const msgs: FromWorker[] = [];
    const c = new SimulationController(data, (m) => msgs.push(m), () => 0);
    c.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: SIZE, nations: false });
    expect(c.worldRef!.nations).toHaveLength(0);
    expect(c.worldRef!.primary.owner.every((v) => v === 0)).toBe(true);
  });
});
