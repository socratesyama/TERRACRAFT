import { biomeKeys } from '../climate/climate';
import type { DataBundle } from '../data/schema';
import { emit } from '../events';
import { Dirty, type Relation, type War, type World } from '../world';
import { landQuantile, nat } from './economy';
import { relationOf } from './territory';

/**
 * 戦争（§22.1・22.7）。戦闘は国境セルの押し引き。損耗は Lanchester の 2 乗則（防御側の殺傷率が defenderKillAdvantage 倍）、
 * 防御側の地形補正は data/war.json terrain。補給は首都からの距離で減る。国は滅ぼさない。
 */

const E = (data: DataBundle) => data.war.engine;

export type Terrain = 'plain' | 'hills' | 'forest' | 'mountain' | 'marsh' | 'urban';

/** セルの防御側の地形倍率と、その地形名 */
export function defenseAt(w: World, data: DataBundle, i: number, keys: readonly string[], mountainH: number): { mult: number; terrain: Terrain } {
  const t = data.war.terrain;
  const e = E(data);
  const n = w.size;
  const s = w.settlements.find((c) => c.y * n + c.x === i && c.tier >= 1);
  if (s) return { mult: t.urbanFortress.value, terrain: 'urban' };
  const slope = w.derived.slope[i]! / (w.maxElevation / w.cellSize);
  if (slope >= e.mountainSlope || w.primary.height[i]! >= mountainH) return { mult: t.mountain, terrain: 'mountain' };
  const bio = keys[w.derived.biome[i]!]!;
  if (bio === 'wetland') return { mult: t.marsh, terrain: 'marsh' };
  if (/orest$|^boreal$/.test(bio)) return { mult: t.forest, terrain: 'forest' };
  if (slope >= e.rollingHillsSlope) return { mult: t.rollingHills, terrain: 'hills' };
  return { mult: t.openPlain, terrain: 'plain' };
}

const TERRAIN_JA: Record<Terrain, string> = { plain: '平野', hills: '丘陵', forest: '森', mountain: '山地', marsh: '湿原', urban: '市街' };

/** 全セルの防御倍率（描画用）。市街は土地利用（町以上）で判定する */
export function defenseGrid(w: World, data: DataBundle, out: Float32Array, stride: number, offset: number): void {
  const t = data.war.terrain;
  const e = E(data);
  const keys = biomeKeys(data);
  const mh = landQuantile(w, e.mountainHeightQuantile);
  const norm = w.maxElevation / w.cellSize;
  const tiers = new Set(w.settlements.filter((s) => s.tier >= 1).map((s) => s.y * w.size + s.x));
  for (let i = 0; i < w.primary.height.length; i++) {
    let m = 0;
    if (w.primary.height[i]! >= w.params.seaLevel) {
      const slope = w.derived.slope[i]! / norm;
      const bio = keys[w.derived.biome[i]!]!;
      if (tiers.has(i)) m = t.urbanFortress.value;
      else if (slope >= e.mountainSlope || w.primary.height[i]! >= mh) m = t.mountain;
      else if (bio === 'wetland') m = t.marsh;
      else if (/orest$|^boreal$/.test(bio)) m = t.forest;
      else if (slope >= e.rollingHillsSlope) m = t.rollingHills;
      else m = t.openPlain;
    }
    out[offset + i * stride] = m;
  }
}

/** AI の宣戦の見積もり: 利得（食料不足・水の不満・兵力差）− コスト。casus belli（戦争理由）つき */
/** 国境のうち相手側のセルの防御倍率の平均（AI が地形を見て戦争を決めるため） */
export function frontMult(w: World, data: DataBundle, me: number, other: number): number {
  const n = w.size;
  const own = w.primary.owner;
  const keys = biomeKeys(data);
  const mh = landQuantile(w, E(data).mountainHeightQuantile);
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < n * n; i++) {
    if (own[i] !== other) continue;
    const x = i % n;
    const y = (i / n) | 0;
    if ((x > 0 && own[i - 1] === me) || (x < n - 1 && own[i + 1] === me) || (y > 0 && own[i - n] === me) || (y < n - 1 && own[i + n] === me)) {
      sum += defenseAt(w, data, i, keys, mh).mult;
      cnt++;
    }
  }
  return cnt > 0 ? sum / cnt : 1;
}

export function warScore(w: World, data: DataBundle, me: number, other: number, r: Relation): { score: number; casus: string } {
  const a = nat(w, me);
  const b = nat(w, other);
  const ai = data.nations.diplomacy.ai;
  const arch = (data.nations.personality.archetypes as Record<string, Record<string, number>>)[a.personality] ?? { expansion: 1, caution: 1 };
  const foodNeed = a.famine > 0 || a.stock.food < a.cons.food ? 1 : 0;
  const waterGrudge = r.grievance === 'water' ? 1 : 0;
  const ratio = (b.army > 0 ? a.army / b.army : 3) / frontMult(w, data, me, other);
  const gain = arch.expansion! * (ai.gainFood * foodNeed + ai.gainWater * waterGrudge + 0.5 * Math.max(0, ratio - data.war.engine.captureRatio));
  const cost = ai.warCost * arch.caution! * Math.max(0.3, 1 / Math.max(0.3, ratio));
  const casus = waterGrudge ? '水資源をめぐる対立' : foodNeed ? '食料不足と隣国の穀倉' : '国境の摩擦';
  return { score: gain - cost + 1, casus };
}

export function declareWar(w: World, data: DataBundle, a: number, b: number, casus: string): string {
  if (w.params.peaceMode) throw new RangeError('平和モードのため戦争は起きません');
  const r = relationOf(w, a, b);
  if (r.status === 'war') throw new RangeError('すでに戦争中です');
  if (r.status === 'truce') throw new RangeError('休戦のクールダウン中です');
  const A = nat(w, a);
  const B = nat(w, b);
  if (r.nonAggUntil > w.tick) {
    r.nonAggUntil = 0;
    r.trust = Math.max(data.nations.diplomacy.trust.min, r.trust + 2 * data.nations.diplomacy.trust.warDrop);
    emit(w, data, 'diplomacy', `${A.name}が不可侵条約を破った`);
  }
  r.status = 'war';
  r.tradePactUntil = 0;
  r.trust = Math.max(data.nations.diplomacy.trust.min, r.trust + data.nations.diplomacy.trust.warDrop);
  const cells = (id: number): number => nat(w, id).cells;
  const war: War = {
    id: w.diplo.nextId++, a, b, startTick: w.tick, casus, wearA: 0, wearB: 0, lossA: 0, lossB: 0,
    startCellsA: cells(a), startCellsB: cells(b), capturedByA: 0, capturedByB: 0, frontX: 0, frontY: 0, dirX: 0, dirY: 0, note: '',
  };
  w.diplo.wars.push(war);
  w.diplo.battle.wars++;
  w.diplo.proposals = w.diplo.proposals.filter((p) => !(p.kind !== 'peace' && ((p.from === a && p.to === b) || (p.from === b && p.to === a))));
  A.mobTarget = 1;
  B.mobTarget = 1;
  const msg = `${A.name}が${B.name}に宣戦した（${casus}）`;
  emit(w, data, 'war', msg);
  return msg;
}

export function endWar(w: World, data: DataBundle, war: War, reason: string): void {
  const A = nat(w, war.a);
  const B = nat(w, war.b);
  const r = relationOf(w, war.a, war.b);
  r.status = 'truce';
  r.truceUntil = w.tick + data.war.termination.truceCooldown;
  r.tensionTicks = 0;
  r.trust = Math.max(r.trust, data.nations.diplomacy.trust.min / 2);
  // 賠償: 領土を多く失った側（首都陥落なら必ず）が富の indemnityShare を払う
  const loserIsB = war.capturedByA > war.capturedByB;
  const net = Math.abs(war.capturedByA - war.capturedByB);
  let line = '';
  if (net > 0) {
    const L = loserIsB ? B : A;
    const Wn = loserIsB ? A : B;
    const pay = L.stock.wealth * E(data).indemnityShare;
    L.stock.wealth -= pay;
    Wn.stock.wealth += pay;
    line = `、${L.name}が賠償 ${pay.toFixed(1)} を払う`;
  }
  const dur = w.tick - war.startTick;
  w.diplo.battle.ended++;
  w.diplo.battle.durationSum += dur;
  w.diplo.battle.durationMax = Math.max(w.diplo.battle.durationMax, dur);
  // 統計: 領土の動きで勝敗が決まった戦争のうち、攻撃側が勝った割合
  if (net > 0) {
    w.diplo.battle.decided++;
    if (loserIsB) w.diplo.battle.aggressorWins++;
  }
  w.diplo.wars = w.diplo.wars.filter((x) => x.id !== war.id);
  for (const n of [A, B]) if (!w.diplo.wars.some((x) => x.a === n.id || x.b === n.id)) n.mobTarget = 0.3;
  w.diplo.proposals = w.diplo.proposals.filter((p) => p.kind !== 'peace' || !((p.from === war.a && p.to === war.b) || (p.from === war.b && p.to === war.a)));
  emit(w, data, 'war', `${A.name}と${B.name}の戦争が終わった（${reason}。${war.capturedByA} / ${war.capturedByB} セルが動いた${line}）`);
}

function relocateCapital(w: World, data: DataBundle, id: number): void {
  const n = nat(w, id);
  const mine = w.settlements.filter((s) => s.nationId === id).sort((a, b) => b.pop - a.pop || a.id - b.id);
  if (mine.length === 0) return;
  if (mine.some((s) => s.id === n.capitalId)) return;
  n.capitalId = mine[0]!.id;
  emit(w, data, 'nation', `${n.name}は首都を移した（${mine[0]!.x}, ${mine[0]!.y}）`, mine[0]!.x, mine[0]!.y);
}

/** 軍の補充・維持（毎 tick）。戦時は目標へ急ぎ、平時はゆっくり */
export function armyStep(w: World, data: DataBundle): void {
  const e = E(data);
  for (const n of w.nations) {
    const target = n.pop * e.troopFraction * n.mobTarget;
    n.army += (target - n.army) * e.mobilizationPerYear;
    if (n.army < 0) n.army = 0;
  }
}

export function warStep(w: World, data: DataBundle): void {
  if (w.diplo.wars.length === 0) return;
  const e = E(data);
  const n = w.size;
  const keys = biomeKeys(data);
  const rv = data.hydrology.river.flowThreshold;
  const own = w.primary.owner;
  const mountainH = landQuantile(w, e.mountainHeightQuantile);
  const bt = w.diplo.battle;
  if (w.diplo.wars.length > 0) bt.warTicks++;
  for (const war of w.diplo.wars.slice()) {
    if (w.params.peaceMode) {
      endWar(w, data, war, '平和モードで停戦');
      continue;
    }
    const A = nat(w, war.a);
    const B = nat(w, war.b);
    const capA = w.settlements.find((s) => s.id === A.capitalId);
    const stormy = w.tick - w.civ.stormTick <= 1;
    // 前線: B の領土のうち A の領土と 4 近傍で接するセル（A の攻撃元つき）
    const front: { c: number; from: number }[] = [];
    for (let i = 0; i < n * n; i++) {
      if (own[i] !== war.b) continue;
      const x = i % n;
      const y = (i / n) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1];
      const f = nb.find((m) => m >= 0 && own[m] === war.a);
      if (f !== undefined) front.push({ c: i, from: f });
    }
    const eq = (x: typeof A): number => 1 + e.equipBonus * Math.min(1, x.stock.ore / Math.max(1e-9, x.army * e.oreForFullEquip));
    const reach = data.war.supply.operationalReach.value;
    const decay = data.war.supply.supplyDecay.value;
    let defSum = 0;
    let attSum = 0;
    let sx = 0;
    let sy = 0;
    const terr: Record<string, number> = {};
    const cand: { c: number; ratio: number; terr: Terrain; river: boolean }[] = [];
    const F = Math.max(1, front.length);
    for (const f of front) {
      const d = defenseAt(w, data, f.c, keys, mountainH);
      const dist = capA ? Math.hypot((f.c % n) - capA.x, ((f.c / n) | 0) - capA.y) : 0;
      const supply = dist > reach ? 0 : Math.max(e.supplyMin, 1 - decay * dist);
      const river = w.derived.flowAcc[f.c]! >= rv || w.derived.flowAcc[f.from]! >= rv;
      const att = (river ? data.war.terrain.riverCrossing.attackerPenalty : 1) * (stormy ? data.war.terrain.weather.rainAttackerPenalty : 1) * supply;
      const pA = ((A.army * eq(A)) / F) * att;
      const pD = ((B.army * eq(B)) / F) * d.mult;
      cand.push({ c: f.c, ratio: pD > 0 ? pA / pD : 99, terr: d.terrain, river });
      bt.front[d.terrain] = (bt.front[d.terrain] ?? 0) + 1;
      if (river) bt.riverFront++;
      defSum += d.mult;
      attSum += att;
      terr[d.terrain] = (terr[d.terrain] ?? 0) + 1;
      sx += f.c % n;
      sy += (f.c / n) | 0;
    }
    if (front.length === 0) {
      endWar(w, data, war, '国境が接していない');
      continue;
    }
    // Lanchester 2 乗則: 攻撃側の損耗 = k × 防御側の殺傷優位 × D × 地形、防御側の損耗 = k × A × 攻撃側の補正
    const kd = data.war.lanchester.defenderKillAdvantage.value;
    const meanDef = defSum / F;
    const meanAtt = attSum / F;
    const dA = Math.min(A.army, e.killRate * kd * B.army * eq(B) * meanDef);
    const dB = Math.min(B.army, e.killRate * A.army * eq(A) * meanAtt);
    A.army -= dA;
    B.army -= dB;
    war.lossA += dA;
    war.lossB += dB;
    for (const [nn, loss] of [[A, dA], [B, dB]] as const) {
      const mine = w.settlements.filter((s) => s.nationId === nn.id);
      const tot = mine.reduce((x, s) => x + s.pop, 0);
      for (const s of mine) s.pop = Math.max(0, s.pop - loss * (s.pop / Math.max(1e-9, tot)));
    }
    // 補給の維持費（食料）と装備（鉱石）
    A.stock.ore = Math.max(0, A.stock.ore - A.army * e.oreUsePerArmyPerTick);
    B.stock.ore = Math.max(0, B.stock.ore - B.army * e.oreUsePerArmyPerTick);
    // 前線の植生被害
    for (const f of front) w.primary.vegetation[f.c] = Math.max(0, w.primary.vegetation[f.c]! - e.frontVegetationLoss);
    // 占領: 比が captureRatio 以上のセルを、強い順に、1 tick の上限まで
    cand.sort((x, y) => y.ratio - x.ratio || x.c - y.c);
    const cellsB = B.cells;
    const floor = Math.ceil(B.baseCells * e.minSurvivingTerritoryShare);
    let cap = Math.max(1, Math.ceil(cellsB * e.maxCapturePerTickFraction));
    let taken = 0;
    let capitalFell = false;
    for (const c of cand) {
      if (cap <= 0 || c.ratio < e.captureRatio) break;
      if (cellsB - taken <= floor) break;
      const here = w.settlements.filter((s) => s.y * n + s.x === c.c);
      const keep = w.settlements.filter((s) => s.nationId === war.b && !here.includes(s));
      if (here.length > 0 && keep.length === 0) continue; // 最後の集落は奪わない
      own[c.c] = war.a;
      bt.taken[c.terr] = (bt.taken[c.terr] ?? 0) + 1;
      if (c.river) bt.riverTaken++;
      for (const s of here) {
        s.nationId = war.a;
        s.pop *= 1 - e.surrenderPopLoss;
        if (s.id === B.capitalId) capitalFell = true;
      }
      taken++;
      cap--;
    }
    war.capturedByA += taken;
    B.cells -= taken;
    A.cells += taken;
    // 反攻: B も、A の領土のうち B と接するセルへ押し返す（同じ規則。立場が逆で、地形は A の側のもの）
    let counter = 0;
    if (!capitalFell) {
      const capB = w.settlements.find((c) => c.id === B.capitalId);
      const cands: { c: number; ratio: number; terr: Terrain; river: boolean }[] = [];
      for (let i = 0; i < n * n; i++) {
        if (own[i] !== war.a) continue;
        const x = i % n;
        const y = (i / n) | 0;
        const nb = [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1];
        const from = nb.find((m) => m >= 0 && own[m] === war.b);
        if (from === undefined) continue;
        const d = defenseAt(w, data, i, keys, mountainH);
        const dist = capB ? Math.hypot((i % n) - capB.x, ((i / n) | 0) - capB.y) : 0;
        const supply = dist > reach ? 0 : Math.max(e.supplyMin, 1 - decay * dist);
        const river = w.derived.flowAcc[i]! >= rv || w.derived.flowAcc[from]! >= rv;
        const att = (river ? data.war.terrain.riverCrossing.attackerPenalty : 1) * (stormy ? data.war.terrain.weather.rainAttackerPenalty : 1) * supply;
        const pB = ((B.army * eq(B)) / F) * att;
        const pA = ((A.army * eq(A)) / F) * d.mult;
        cands.push({ c: i, ratio: pA > 0 ? pB / pA : 99, terr: d.terrain, river });
      }
      cands.sort((x, y) => y.ratio - x.ratio || x.c - y.c);
      let ccap = Math.max(1, Math.ceil(A.cells * e.maxCapturePerTickFraction));
      const floorA = Math.ceil(A.baseCells * e.minSurvivingTerritoryShare);
      for (const c of cands) {
        if (ccap <= 0 || c.ratio < e.captureRatio) break;
        if (A.cells - counter <= floorA) break;
        const here = w.settlements.filter((s) => s.y * n + s.x === c.c);
        const keep = w.settlements.filter((s) => s.nationId === war.a && !here.includes(s));
        if (here.length > 0 && keep.length === 0) continue;
        own[c.c] = war.b;
        bt.taken[c.terr] = (bt.taken[c.terr] ?? 0) + 1;
        if (c.river) bt.riverTaken++;
        for (const s of here) {
          s.nationId = war.b;
          s.pop *= 1 - e.surrenderPopLoss;
        }
        counter++;
        ccap--;
      }
      war.capturedByB += counter;
      A.cells -= counter;
      B.cells += counter;
      if (counter > 0) emit(w, data, 'war', `${B.name}が反攻し、${A.name}の ${counter} セルを取り返した`, Math.round(war.frontX), Math.round(war.frontY), { dedupe: true });
    }
    war.frontX = sx / F;
    war.frontY = sy / F;
    const cs = capA ? capA : { x: war.frontX, y: war.frontY };
    const vx = war.frontX - cs.x;
    const vy = war.frontY - cs.y;
    const vl = Math.hypot(vx, vy) || 1;
    war.dirX = vx / vl;
    war.dirY = vy / vl;
    const parts = Object.entries(terr).sort((x, y) => y[1] - x[1]).map(([t, k]) => `${TERRAIN_JA[t as Terrain]} ${k}`).join('・');
    const bestRatio = cand.length > 0 ? cand[0]!.ratio : 0;
    war.note = `前線 ${front.length} セル（${parts}）。防御の地形倍率 ×${meanDef.toFixed(2)}、攻撃側の実効 ×${meanAtt.toFixed(2)}、最良の兵力比 ${bestRatio.toFixed(2)}（占領には ${e.captureRatio} 以上）`;
    if (taken > 0) emit(w, data, 'war', `${A.name}が${B.name}の ${taken} セルを占領した（${parts}）`, Math.round(war.frontX), Math.round(war.frontY), { dedupe: true });
    // 疲弊
    const dur = w.tick - war.startTick;
    war.wearA = data.war.morale.warWeariness.perYear * dur + data.war.morale.casualtyShock * (war.lossA / Math.max(1, A.pop + war.lossA));
    war.wearB = data.war.morale.warWeariness.perYear * dur + data.war.morale.casualtyShock * (war.lossB / Math.max(1, B.pop + war.lossB));
    if (capitalFell) {
      w.diplo.battle.capitalFalls++;
      emit(w, data, 'war', `${B.name}の首都が陥落した`, Math.round(war.frontX), Math.round(war.frontY));
      relocateCapital(w, data, war.b);
      endWar(w, data, war, '首都陥落');
    } else if (dur >= data.war.termination.maxDuration.value) endWar(w, data, war, '期間満了で休戦');
    else if (A.army < 0.1 * A.pop * e.troopFraction || B.army < 0.1 * B.pop * e.troopFraction) endWar(w, data, war, '兵力が尽きて休戦');
    else if (Math.max(war.wearA, war.wearB) >= e.weariToPeace) {
      // AI 同士は講和する。プレイヤーが絡むときは提案が出る（応じなければ maxDuration で終わる）
      const player = data.nations.setup.playerNationId;
      if (war.a !== player && war.b !== player) endWar(w, data, war, '戦争疲れで講和');
      else {
        const ai = war.a === player ? war.b : war.a;
        if (!w.diplo.proposals.some((p) => p.kind === 'peace' && p.from === ai)) {
          w.diplo.proposals.push({ id: w.diplo.nextId++, from: ai, to: player, kind: 'peace', tick: w.tick });
        }
      }
    }
  }
  for (const nn of w.nations) relocateCapital(w, data, nn.id);
}

/**
 * ダムの破壊工作（§22.5）。交戦中の相手の領土にあるダムを決壊させる。標高を築く前に戻し、次の tick に洪水が下流へ届く。
 * 戻り値はメッセージ。できないときは RangeError。
 */
export function sabotageDam(w: World, data: DataBundle, by: number, target: number): string {
  const r = relationOf(w, by, target);
  if (r.status !== 'war') throw new RangeError('交戦中の国のダムだけ決壊させられる');
  const n = w.size;
  const dam = w.civ.dams.find((d) => w.primary.owner[d.y * n + d.x] === target);
  if (!dam) throw new RangeError(`${nat(w, target).name}の領土にダムがありません`);
  const me = nat(w, by);
  me.stock.wealth *= 1 - E(data).sabotageCost;
  dam.cells.forEach((c, k) => {
    w.primary.height[c] = Math.min(w.primary.height[c]!, dam.orig[k]!);
  });
  w.civ.dams = w.civ.dams.filter((d) => d.id !== dam.id);
  w.dirty |= Dirty.Height | Dirty.Water; // refreshDirty が次の tick の頭で再計算する
  w.civ.breach = { surge: data.disasters.flood.surgeMax, why: `${nat(w, target).name}のダムが決壊` };
  const msg = `${me.name}が${nat(w, target).name}のダムを決壊させた`;
  emit(w, data, 'war', msg, dam.x, dam.y);
  return msg;
}
