import { biomeKeys } from '../climate/climate';
import type { KcMod } from '../civ/settlements';
import type { DataBundle } from '../data/schema';
import { emit } from '../events';
import { DX, DY } from '../hydrology';
import { RESOURCES, type Nation, type Res, type TradeFlow, type World } from '../world';
import { relationOf } from './territory';

/**
 * 国の経済（§22.2〜22.6）。食料は『人・年』（1 = 1 人を 1 年養う量）。
 * 生産 → 消費 → 備蓄（貯蔵損失）→ 飢饉 → 技術 → 発展度 DI。貿易は tradeInterval ごと（重力モデル）。
 * 数値はすべて data/economy.json（production / trade / developmentIndex）と data/nations.json から読む。
 */

export const nat = (w: World, id: number): Nation => w.nations[id - 1]!;

/** 陸の標高の分位（256 ビンのヒストグラムで O(n)）。標高の絶対値に頼らず「山」を決めるため */
export function landQuantile(w: World, q: number): number {
  const bins = new Uint32Array(256);
  let tot = 0;
  for (let i = 0; i < w.primary.height.length; i++) {
    const h = w.primary.height[i]!;
    if (h < w.params.seaLevel) continue;
    bins[Math.min(255, (h * 256) | 0)]!++;
    tot++;
  }
  let acc = 0;
  for (let b = 0; b < 256; b++) {
    acc += bins[b]!;
    if (acc >= tot * q) return (b + 1) / 256;
  }
  return 1;
}

/** 国ごとの森林・山岳セル数、道路セル数、平均植生（国の生産と DI の元） */
export function landSummary(w: World, data: DataBundle): { forest: number[]; ore: number[]; road: number[]; veg: number[]; cells: number[] } {
  const K = w.nations.length;
  const p = data.economy.production;
  const re = new RegExp(p.forestBiomePattern);
  const keys = biomeKeys(data);
  const isForest = new Set(keys.map((k, i) => (re.test(k) ? i : -1)).filter((i) => i >= 0));
  const out = { forest: new Array<number>(K).fill(0), ore: new Array<number>(K).fill(0), road: new Array<number>(K).fill(0), veg: new Array<number>(K).fill(0), cells: new Array<number>(K).fill(0) };
  const n = w.size;
  const oreH = landQuantile(w, p.oreHeightQuantile);
  for (let i = 0; i < n * n; i++) {
    const o = w.primary.owner[i]!;
    if (o === 0) continue;
    const k = o - 1;
    out.cells[k]!++;
    out.veg[k]! += w.primary.vegetation[i]!;
    if (isForest.has(w.derived.biome[i]!)) out.forest[k]!++;
    if (w.primary.height[i]! >= oreH) out.ore[k]!++;
    if (w.primary.road[i]! > 0) out.road[k]!++;
  }
  return out;
}

/** 食料の備蓄を成長の上限に反映する（備蓄 / reserveYears を人口比で配る）。技術は産出を増やす */
export function nationsKcMod(w: World, data: DataBundle): KcMod | undefined {
  if (w.nations.length === 0) return undefined;
  const p = data.economy.production;
  return (s, kc) => {
    const n = nat(w, s.nationId);
    if (!n) return kc;
    const boosted = kc * (1 + p.techYieldBonus * n.tech);
    s.kc = boosted;
    return boosted;
  };
}

const reserveOf = (data: DataBundle, cons: number): number => data.economy.production.reserveYears * cons;

/** 国の初期備蓄（需要の reserveYears 年分）と、最初の人口・領土の集計 */
export function initEconomy(w: World, data: DataBundle): void {
  const land = landSummary(w, data);
  const p = data.economy.production;
  for (const n of w.nations) {
    n.pop = w.settlements.filter((s) => s.nationId === n.id).reduce((a, s) => a + s.pop, 0);
    n.cells = land.cells[n.id - 1]!;
    n.baseCells = n.cells;
    n.cons = { food: n.pop, wood: p.woodPerPop * n.pop, ore: p.orePerPop * n.pop };
    n.stock = { food: reserveOf(data, n.cons.food), wood: reserveOf(data, n.cons.wood), ore: reserveOf(data, n.cons.ore), wealth: 0 };
    n.mobTarget = data.war.engine.troopFraction * 0 + 0.3;
    n.army = n.pop * data.war.engine.troopFraction * n.mobTarget;
  }
}

/** 1 tick の生産・消費・備蓄・飢饉・技術・DI（成長のあと、ラスタライズの前に呼ぶ） */
export function econStep(w: World, data: DataBundle): void {
  if (w.nations.length === 0) return;
  const p = data.economy.production;
  const land = landSummary(w, data);
  const loss = data.economy.food.storageLoss;
  for (const n of w.nations) {
    const mine = w.settlements.filter((s) => s.nationId === n.id);
    n.pop = mine.reduce((a, s) => a + s.pop, 0);
    n.cells = land.cells[n.id - 1]!;
    // 耕すのは必要な分だけ: 収穫 = min(農地の産出, 人口 × (1 + 余剰率))
    n.prod.food = mine.reduce((a, s) => a + Math.min(s.kc, s.pop * (1 + p.harvestSurplusMargin)), 0);
    n.prod.wood = land.forest[n.id - 1]! * p.woodPerForestCell;
    n.prod.ore = land.ore[n.id - 1]! * p.orePerMountainCell;
    n.prod.wealth = mine.reduce((a, s) => a + s.pop * p.wealthPerPop * (1 + (p.wealthTierBonus[s.tier] ?? 0)), 0);
    n.cons = { food: n.pop, wood: p.woodPerPop * n.pop, ore: p.orePerPop * n.pop };
    // 軍の維持費（動員した兵力 × 年間維持費）
    const sup = data.war.supply.maintenanceCost;
    const warCost = n.army * (isAtWar(w, n.id) ? 1 : 0.2);
    // 備蓄の更新
    n.stock.food += n.prod.food - n.cons.food - n.stock.food * loss - warCost * sup.food;
    n.stock.wood = Math.max(0, n.stock.wood + n.prod.wood - n.cons.wood - n.stock.wood * loss);
    n.stock.ore = Math.max(0, n.stock.ore + n.prod.ore - n.cons.ore);
    n.stock.wealth = Math.max(0, n.stock.wealth + n.prod.wealth - warCost * sup.wealth * p.wealthPerPop * 10);
    // 飢饉: 不足 × famineMortality が死ぬ（不足は 0 に戻す）
    n.famine = 0;
    if (n.stock.food < 0) {
      const deficit = -n.stock.food;
      n.stock.food = 0;
      n.famine = n.pop > 0 ? Math.min(1, deficit / n.pop) : 0;
      const deaths = Math.min(n.pop * 0.9, deficit * data.economy.population.famineMortality);
      for (const s of mine) s.pop = Math.max(0, s.pop - deaths * (s.pop / Math.max(1e-9, n.pop)));
      n.lossAcc += deaths;
      emit(w, data, 'famine', `${n.name}で飢饉（不足 ${(n.famine * 100).toFixed(0)}%、人口 −${Math.round(deaths)}）`, undefined, undefined, { dedupe: true });
    }
    // 技術: 町・都市があるほど進む
    const meanTier = mine.length > 0 ? mine.reduce((a, s) => a + s.tier, 0) / mine.length : 0;
    n.tech = Math.min(1, n.tech + p.techPerTierPerYear * meanTier);
    // 災害損失の指数平均
    const hl = data.economy.developmentIndex.baselines.disasterLossHalfLife;
    n.lossEma = n.lossEma * Math.pow(0.5, 1 / hl) + n.lossAcc;
    n.lossAcc = 0;
    n.tradeValue *= 0.8;
  }
  computeDI(w, data, land);
}

/** 食料の輸入依存度（輸入量 / 消費量）。高いと禁輸が致命傷になる（§22.4） */
export const foodDependency = (n: Nation): number => n.foodImport / Math.max(1, n.cons.food);

export function isAtWar(w: World, id: number): boolean {
  return w.diplo.wars.some((x) => x.a === id || x.b === id);
}

/** 発展度 DI（§22.6）= Σ 重み × clamp01(実績 / 固定の基準値)。森林が少なすぎると上限がかかる */
export function computeDI(w: World, data: DataBundle, land = landSummary(w, data)): void {
  const wt = data.economy.developmentIndex;
  const b = wt.baselines;
  const weights = [wt.population, wt.foodSecurity, wt.economy, wt.infrastructure, wt.environment, wt.disasterResilience, wt.technology, wt.diplomacy];
  const c01 = (v: number): number => Math.min(1, Math.max(0, v));
  for (const n of w.nations) {
    const k = n.id - 1;
    const cells = Math.max(1, land.cells[k]!);
    const rels = w.diplo.relations.filter((r) => r.a === n.id || r.b === n.id);
    const trust = rels.length > 0 ? rels.reduce((a, r) => a + (r.trust + 100) / 200, 0) / rels.length : 0.5;
    const forest = land.forest[k]! / cells;
    const parts = [
      c01(n.pop / (w.diplo.basePotential * b.popPerPotential)),
      c01(n.stock.food / Math.max(1, reserveOf(data, n.cons.food))) * (1 - n.famine),
      c01(n.stock.wealth / Math.max(1, n.pop * b.wealthPerPop)),
      c01(land.road[k]! / cells / b.roadShare),
      (c01(forest / b.forestShare) + c01(land.veg[k]! / cells / b.vegetation)) / 2,
      c01(1 - n.lossEma / Math.max(1, 0.1 * n.pop)) * (1 - Math.min(1, foodDependency(n)) * b.importDependencyPenalty),
      c01(n.tech),
      c01(0.5 * trust + 0.5 * c01(n.tradeValue / Math.max(1, n.pop * b.tradeShare))),
    ];
    n.diParts = parts;
    let di = 0;
    parts.forEach((v, i) => (di += weights[i]! * v));
    const cp = data.nations.developmentIndex.capPenalty;
    if (forest < cp.forestFloor) di = Math.min(di, cp.cap.value);
    n.di = di;
    if (w.tick % wt.historyEveryTicks === 0) {
      n.diHistory.push(Math.round(di * 10) / 10);
      if (n.diHistory.length > wt.historyMax) n.diHistory.shift();
    }
  }
}

// ---- 貿易（重力モデル）----

export const priceOf = (data: DataBundle, n: Nation, r: Res): number => {
  const t = data.economy.trade;
  const reserve = Math.max(1e-6, reserveOf(data, n.cons[r]));
  const ratio = (reserve + 1e-6) / (n.stock[r] + 1e-6);
  return t.basePrice[r] * Math.min(t.priceClamp.max, Math.max(t.priceClamp.min, Math.sqrt(ratio)));
};

/** どちらかが相手に禁輸していれば、取引は止まる */
export function isEmbargoed(w: World, a: number, b: number): boolean {
  const r = relationOf(w, a, b);
  return r.embargoAB || r.embargoBA;
}

export type Mode = TradeFlow['mode'];

/** 首都から川を下る（flowDir）。着いた先の近く（3 セル以内）に相手の首都があれば true */
function riverReaches(w: World, from: number, to: number): boolean {
  const n = w.size;
  let c = from;
  for (let k = 0; k < 400; k++) {
    if (Math.hypot((c % n) - (to % n), ((c / n) | 0) - ((to / n) | 0)) <= 3) return true;
    const d = w.derived.flowDir[c]!;
    if (d === 255) return false;
    const x = (c % n) + DX[d]!;
    const y = ((c / n) | 0) + DY[d]!;
    if (x < 0 || y < 0 || x >= n || y >= n) return false;
    c = y * n + x;
  }
  return false;
}

export function transportMode(w: World, a: Nation, b: Nation): { mode: Mode; dist: number } {
  const sa = w.settlements.find((s) => s.id === a.capitalId);
  const sb = w.settlements.find((s) => s.id === b.capitalId);
  const n = w.size;
  if (!sa || !sb) return { mode: 'road', dist: 1e9 };
  const dist = Math.hypot(sa.x - sb.x, sa.y - sb.y);
  const port = (id: number): boolean => w.settlements.some((s) => s.nationId === id && s.tier === 3);
  if (port(a.id) && port(b.id)) return { mode: 'sea', dist };
  const ca = sa.y * n + sa.x;
  const cb = sb.y * n + sb.x;
  if (riverReaches(w, ca, cb)) return { mode: 'riverDown', dist };
  if (riverReaches(w, cb, ca)) return { mode: 'riverUp', dist };
  return { mode: 'road', dist };
}

/**
 * 重力モデルの貿易。協定のある国どうしで、備蓄が需要を超える国（輸出）から不足する国（輸入）へ。
 * 配分は E_i·E_j / d^θ に比例。輸送で量が目減りし、Σ輸出 = Σ輸入 + 損失 が保たれる。
 */
export function tradeStep(w: World, data: DataBundle): void {
  const t = data.economy.trade;
  if (w.nations.length < 2 || w.tick % t.market.tradeInterval !== 0) return;
  const flows: TradeFlow[] = [];
  let lossTotal = 0;
  const foodIn = new Array<number>(w.nations.length).fill(0);
  const tc = t.transportCost;
  for (const r of RESOURCES) {
    for (const ex of w.nations) {
      const rel0 = (o: Nation) => relationOf(w, ex.id, o.id);
      const reserveEx = reserveOf(data, ex.cons[r]);
      let supply = ex.stock[r] - reserveEx;
      if (supply <= t.minFlow.value) continue;
      const partners = w.nations.filter((o) => o !== ex && rel0(o).tradePactUntil > w.tick && rel0(o).status !== 'war' && !isEmbargoed(w, ex.id, o.id) && o.stock[r] < reserveOf(data, o.cons[r]));
      if (partners.length === 0) continue;
      const pe = priceOf(data, ex, r);
      const cand = partners
        .map((o) => {
          const tm = transportMode(w, ex, o);
          const unit = t.unitTransportPerCell.value;
          const costMult = tm.mode === 'sea' ? tc.sea : tm.mode === 'riverDown' ? tc.riverDownstream : tm.mode === 'riverUp' ? tc.riverUpstream : tc.road;
          const fixed = tm.mode === 'sea' ? tc.portFixed * unit : 0;
          const lossFrac = Math.min(t.lossFractionMax.value, (unit * tm.dist * costMult + fixed) / Math.max(1e-6, t.basePrice[r]));
          const po = priceOf(data, o, r);
          const gw = (ex.pop * o.pop) / Math.pow(Math.max(1, tm.dist), t.gravityExponent);
          return { o, tm, lossFrac, po, gw };
        })
        .filter((c) => c.po * (1 - c.lossFrac) > pe) // 儲かるときだけ
        .sort((a, b) => a.o.id - b.o.id);
      const totalW = cand.reduce((a, c) => a + c.gw, 0);
      if (totalW <= 0) continue;
      const pool = supply;
      for (const c of cand) {
        const need = reserveOf(data, c.o.cons[r]) - c.o.stock[r];
        let q = Math.min(pool * (c.gw / totalW), need / (1 - c.lossFrac), supply);
        const price = (pe + c.po) / 2;
        q = Math.min(q, c.o.stock.wealth / Math.max(1e-6, price));
        if (q < t.minFlow.value) continue;
        const got = q * (1 - c.lossFrac);
        ex.stock[r] -= q;
        c.o.stock[r] += got;
        const pay = got * price;
        c.o.stock.wealth -= pay;
        ex.stock.wealth += pay;
        ex.tradeValue += pay;
        c.o.tradeValue += pay;
        supply -= q;
        lossTotal += q - got;
        relationOf(w, ex.id, c.o.id).lastTradeTick = w.tick;
        if (r === 'food') foodIn[c.o.id - 1]! += got;
        flows.push({ from: ex.id, to: c.o.id, res: r, sent: q, received: got, price, mode: c.tm.mode });
      }
    }
  }
  // 輸入依存度の元: 食料の輸入量（1 tick あたり）の指数平均。輸入が無い国も 0 を混ぜる
  for (const n of w.nations) n.foodImport += (foodIn[n.id - 1]! / t.market.tradeInterval - n.foodImport) * 0.5;
  w.diplo.lastTrade = { tick: w.tick, flows, loss: lossTotal };
  if (flows.length > 0) {
    const f = flows.reduce((a, x) => (x.sent * x.price > a.sent * a.price ? x : a));
    const rn = { food: '食料', wood: '木材', ore: '鉱石' } as const;
    const mn = { road: '陸路', riverDown: '川下り', riverUp: '川上り', sea: '海路' } as const;
    emit(w, data, 'trade', `貿易: ${nat(w, f.from).name} → ${nat(w, f.to).name} ${rn[f.res]} ${f.sent.toFixed(1)}（${mn[f.mode]}、価格 ${f.price.toFixed(2)}）`, undefined, undefined, { dedupe: true });
  }
}
