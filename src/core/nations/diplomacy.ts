import type { DataBundle } from '../data/schema';
import { emit } from '../events';
import type { Proposal, Relation, World } from '../world';
import { foodDependency, isAtWar, nat } from './economy';
import { relationOf } from './territory';
import { declareWar, endWar, sabotageDam, warScore } from './war';

/**
 * 外交（§22.2）。信頼値・関係の状態・協定・提案、そして AI（Utility AI、1 tick に 1 国）。
 * 信頼値は 貿易の継続（＋）、国境の摩擦（−）、上流の取水（−）、贈り物（＋）で動く。
 */

const isStatus = (r: Relation, st: Relation['status']): boolean => r.status === st;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 国境の長さ（4 近傍で国が変わるセル対の数）と、川が国境を越えて下流へ運ぶ水（流量）の行列 */
function scanBorders(w: World, data: DataBundle): { border: number[]; inflow: number[] } {
  const K = w.nations.length;
  const n = w.size;
  const border = new Array<number>(K * K).fill(0);
  const inflow = new Array<number>(K * K).fill(0);
  const own = w.primary.owner;
  const rv = data.hydrology.river.flowThreshold;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const a = own[i]!;
      if (a === 0) continue;
      if (x + 1 < n && own[i + 1]! !== 0 && own[i + 1] !== a) {
        border[(a - 1) * K + own[i + 1]! - 1]!++;
        border[(own[i + 1]! - 1) * K + a - 1]!++;
      }
      if (y + 1 < n && own[i + n]! !== 0 && own[i + n] !== a) {
        border[(a - 1) * K + own[i + n]! - 1]!++;
        border[(own[i + n]! - 1) * K + a - 1]!++;
      }
    }
  }
  // 川の流出先が別の国なら、その流量は上流国 → 下流国への流入
  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, 1, 1, 1, 0, -1, -1, -1];
  for (let i = 0; i < n * n; i++) {
    const a = own[i]!;
    const d = w.derived.flowDir[i]!;
    if (a === 0 || d === 255 || w.derived.flowAcc[i]! < rv) continue;
    const x = (i % n) + DX[d]!;
    const y = ((i / n) | 0) + DY[d]!;
    if (x < 0 || y < 0 || x >= n || y >= n) continue;
    const b = own[y * n + x]!;
    if (b !== 0 && b !== a) inflow[(a - 1) * K + b - 1]! += w.derived.flowAcc[i]!;
  }
  return { border, inflow };
}

/** 毎 tick の外交の更新: 信頼値・状態の遷移・協定と提案の期限 */
export function diploStep(w: World, data: DataBundle): void {
  const K = w.nations.length;
  if (K < 2) return;
  const d = data.nations.diplomacy;
  const sch = data.economy.trade.market.tradeInterval;
  const scan = w.tick % sch === 0;
  const sc = scan ? scanBorders(w, data) : null;
  for (const r of w.diplo.relations) {
    if (sc) r.border = sc.border[(r.a - 1) * K + r.b - 1]!;
    // 水: 上流国の取水（下流への流入が長期平均を下回った）
    if (sc) {
      for (const [up, down] of [[r.a, r.b], [r.b, r.a]] as const) {
        const idx = (up - 1) * K + down - 1;
        const cur = sc.inflow[idx]!;
        const ema = w.diplo.inflowEma[idx]!;
        if (ema > 1 && cur < ema * d.water.shortfallRatio) {
          r.trust = clamp(r.trust - d.trust.waterShortfallPerYear * sch, d.trust.min, d.trust.max);
          r.grievance = 'water';
          emit(w, data, 'diplomacy', `${nat(w, up).name}の取水で ${nat(w, down).name} への川の水が減った（${((cur / ema) * 100).toFixed(0)}%）。${nat(w, down).name}の信頼が下がった`, undefined, undefined, { dedupe: true });
        }
        w.diplo.inflowEma[idx] = ema === 0 ? cur : ema + (cur - ema) * d.water.emaRate;
      }
    }
    if (r.status === 'war') continue;
    // 信頼値の連続的な変化
    if (w.tick - r.lastTradeTick <= sch && r.lastTradeTick >= 0) r.trust += d.trust.tradeGainPerYear;
    if (r.border >= d.borderMinCells) r.trust -= d.trust.borderFrictionPerYear;
    r.trust -= r.trust * d.trust.decayToNeutral;
    r.trust = clamp(r.trust, d.trust.min, d.trust.max);
    if (r.status === 'truce' && w.tick >= r.truceUntil) r.status = 'peace';
    if (r.status === 'peace' && r.trust < d.ai.tensionTrust) {
      r.status = 'tension';
      r.tensionTicks = 0;
      emit(w, data, 'diplomacy', `${nat(w, r.a).name}と${nat(w, r.b).name}の関係が緊張した（信頼 ${r.trust.toFixed(0)}）`);
    } else if (r.status === 'tension') {
      r.tensionTicks++;
      if (r.trust >= d.ai.tensionRecoverTrust) {
        r.status = 'peace';
        r.grievance = '';
        emit(w, data, 'diplomacy', `${nat(w, r.a).name}と${nat(w, r.b).name}の緊張が和らいだ`);
      }
    }
    if (r.tradePactUntil > 0 && w.tick >= r.tradePactUntil) {
      r.tradePactUntil = 0;
      emit(w, data, 'diplomacy', `${nat(w, r.a).name}と${nat(w, r.b).name}の貿易協定が期限切れになった`);
    }
    if (r.nonAggUntil > 0 && w.tick >= r.nonAggUntil) r.nonAggUntil = 0;
  }
  w.diplo.proposals = w.diplo.proposals.filter((p) => w.tick - p.tick <= d.pacts.proposalTtl);
}

function propose(w: World, from: number, to: number, kind: Proposal['kind']): boolean {
  if (w.diplo.proposals.some((p) => p.from === from && p.to === to && p.kind === kind)) return false;
  w.diplo.proposals.push({ id: w.diplo.nextId++, from, to, kind, tick: w.tick });
  return true;
}

const W = (n: ReturnType<typeof nat>, data: DataBundle, key: 'expansion' | 'conservation' | 'commerce' | 'caution'): number => {
  const a = (data.nations.personality.archetypes as Record<string, Record<string, number>>)[n.personality];
  return a ? a[key]! : 1;
};

/** 提案を受けたときの AI の判断（信頼値 + bias × (性格の重み − 1) ≥ acceptTrust） */
function accepts(w: World, data: DataBundle, p: Proposal): boolean {
  const me = nat(w, p.to);
  const r = relationOf(w, p.from, p.to);
  const ai = data.nations.diplomacy.ai;
  if (p.kind === 'trade') return r.trust + ai.nonAggressionAcceptBias * (W(me, data, 'commerce') - 1) >= ai.acceptTrust;
  if (p.kind === 'nonAggression') return r.trust + ai.nonAggressionAcceptBias * (W(me, data, 'caution') - 1) >= ai.acceptTrust;
  // 講和: 疲弊が相手と同程度以上、または疲弊が半分を超えていれば受ける
  const war = w.diplo.wars.find((x) => (x.a === p.from && x.b === p.to) || (x.a === p.to && x.b === p.from));
  if (!war) return false;
  const mine = war.a === me.id ? war.wearA : war.wearB;
  const theirs = war.a === me.id ? war.wearB : war.wearA;
  return mine >= theirs * 0.8 || mine >= data.war.engine.weariToPeace * 0.5;
}

export function resolveProposal(w: World, data: DataBundle, p: Proposal, accept: boolean): string {
  w.diplo.proposals = w.diplo.proposals.filter((x) => x.id !== p.id);
  const from = nat(w, p.from).name;
  const to = nat(w, p.to).name;
  const kindName = { trade: '貿易協定', nonAggression: '不可侵条約', peace: '講和' }[p.kind];
  if (!accept) {
    relationOf(w, p.from, p.to).proposeCooldown = w.tick + data.nations.diplomacy.pacts.refuseCooldownTicks;
    emit(w, data, 'diplomacy', `${to}は${from}の${kindName}の提案を断った`);
    return `${to}は断った`;
  }
  const r = relationOf(w, p.from, p.to);
  const pa = data.nations.diplomacy.pacts;
  if (p.kind === 'trade') r.tradePactUntil = w.tick + pa.tradeYears;
  else if (p.kind === 'nonAggression') r.nonAggUntil = w.tick + pa.nonaggressionYears;
  else {
    const war = w.diplo.wars.find((x) => (x.a === p.from && x.b === p.to) || (x.a === p.to && x.b === p.from));
    if (war) endWar(w, data, war, '講和');
  }
  emit(w, data, 'diplomacy', `${from}と${to}が${kindName}を結んだ`);
  return `${kindName}が成立した`;
}

/** AI の 1 手（1 tick に 1 国）。候補の行動をスコアで比べて最大のものを実行する */
export function aiStep(w: World, data: DataBundle): void {
  const K = w.nations.length;
  if (K < 2) return;
  const me = w.nations[w.tick % K]!;
  if (me.id === data.nations.setup.playerNationId) return;
  const ai = data.nations.diplomacy.ai;
  // 1. 自分宛ての提案に答える
  for (const p of w.diplo.proposals.filter((x) => x.to === me.id)) {
    resolveProposal(w, data, p, accepts(w, data, p));
  }
  const others = w.nations.filter((o) => o !== me);
  type Act = { u: number; text: string; run: () => void };
  // 貿易協定の提案は他の行動と両立する（商いは毎回探す）。ほかは 1 tick に 1 手
  const acts: Act[] = [];
  for (const o of others) {
    const r = relationOf(w, me.id, o.id);
    if (r.status === 'war') {
      const war = w.diplo.wars.find((x) => (x.a === me.id && x.b === o.id) || (x.a === o.id && x.b === me.id))!;
      const mine = war.a === me.id ? war.wearA : war.wearB;
      const u = (mine / Math.max(0.01, data.war.engine.weariToPeace)) * (1 + (1 - W(me, data, 'expansion')) * 0.5);
      acts.push({ u, text: `${o.name}との講和を提案`, run: () => void propose(w, me.id, o.id, 'peace') });
      continue;
    }
    if (r.status !== 'truce' && w.tick >= r.proposeCooldown && r.tradePactUntil === 0 && r.trust >= ai.acceptTrust - 10) {
      if (propose(w, me.id, o.id, 'trade')) me.lastDecision = `${o.name}に貿易協定を提案`;
    }
    if (r.status !== 'truce' && w.tick >= r.proposeCooldown && r.nonAggUntil === 0 && r.trust >= ai.acceptTrust - 10 && r.border >= data.nations.diplomacy.borderMinCells) {
      acts.push({ u: 0.5 * W(me, data, 'caution'), text: `${o.name}に不可侵条約を提案`, run: () => void propose(w, me.id, o.id, 'nonAggression') });
    }
    if (r.status === 'tension' && r.trust < 0 && w.nations.length > 0) {
      acts.push({ u: 0.4 * W(me, data, 'conservation'), text: `${o.name}へ贈り物（関係の修復）`, run: () => { r.trust = clamp(r.trust + data.nations.diplomacy.trust.giftGain, -100, 100); me.stock.wealth *= 0.9; } });
    }
    // 禁輸: 緊張している相手が食料を輸入に頼っているほど効く。関係が戻れば解く
    const flagMe = me.id === r.a ? 'embargoAB' : 'embargoBA';
    if (r[flagMe]) {
      if (r.status === 'peace' && r.trust >= ai.tensionRecoverTrust) acts.push({ u: 1, text: `${o.name}への禁輸を解除`, run: () => void setEmbargo(w, data, me.id, o.id, false) });
    } else if (r.status === 'tension') {
      const u = (foodDependency(o) * 10 + 0.5) * W(me, data, 'expansion');
      acts.push({ u: u / ai.embargoThreshold, text: `${o.name}に禁輸（食料の輸入依存度 ${(foodDependency(o) * 100).toFixed(0)}%）`, run: () => void setEmbargo(w, data, me.id, o.id, true) });
    }
    // 戦争中: 敵の領土にダムがあれば決壊させる（人間と同じ規則・同じ費用）
    if (isStatus(r, 'war') && w.civ.dams.some((d) => w.primary.owner[d.y * w.size + d.x] === o.id)) {
      acts.push({ u: 1.2, text: `${o.name}のダムを決壊`, run: () => void sabotageDam(w, data, me.id, o.id) });
    }
    // 戦争: 緊張が前触れとして warWarningTicks 続き、期待利得が閾値を超えたとき（突然の宣戦はしない §22.5）
    if (r.status === 'tension' && r.tensionTicks >= ai.warWarningTicks && w.tick >= r.truceUntil + ai.warCooldownTicks && !w.params.peaceMode && !(ai.oneWarAtATime.value && (isAtWar(w, o.id) || isAtWar(w, me.id)))) {
      const sc = warScore(w, data, me.id, o.id, r);
      acts.push({ u: sc.score / ai.warScoreThreshold, text: `${o.name}に宣戦（${sc.casus}）`, run: () => void declareWar(w, data, me.id, o.id, sc.casus) });
    }
  }
  // 動員: 緊張している相手がいる間は高める
  const tense = others.some((o) => relationOf(w, me.id, o.id).status === 'tension');
  if (!isAtWar(w, me.id)) me.mobTarget = tense ? 0.6 : 0.3;
  const best = acts.filter((a) => a.u >= 1 || a.text.includes('提案') || a.text.includes('贈り物') || a.text.includes('禁輸')).sort((a, b) => b.u - a.u)[0];
  if (!best) {
    me.lastDecision = '';
    return;
  }
  me.lastDecision = best.text;
  best.run();
}

/** 禁輸（交易路を止める）。受けた側の信頼値が下がる。解除は信頼を戻さない */
export function setEmbargo(w: World, data: DataBundle, by: number, target: number, on: boolean): string {
  const r = relationOf(w, by, target);
  const flag = by === r.a ? 'embargoAB' : 'embargoBA';
  if (r[flag] === on) throw new RangeError(on ? 'すでに禁輸しています' : '禁輸していません');
  r[flag] = on;
  const msg = on ? `${nat(w, by).name}が${nat(w, target).name}に禁輸した` : `${nat(w, by).name}が${nat(w, target).name}への禁輸を解いた`;
  if (on) r.trust = clamp(r.trust + data.nations.diplomacy.trust.embargoDrop, data.nations.diplomacy.trust.min, data.nations.diplomacy.trust.max);
  emit(w, data, 'diplomacy', msg);
  return msg;
}

export type DiploOp =
  | { t: 'diplo'; tick: number; action: 'proposeTrade' | 'proposeNonAggression' | 'gift' | 'declareWar' | 'proposePeace' | 'cancelPact' | 'embargo' | 'liftEmbargo' | 'sabotage'; to: number }
  | { t: 'diplo'; tick: number; action: 'respond'; proposalId: number; accept: boolean }
  | { t: 'military'; tick: number; mobilization: number };

/** プレイヤー（国 playerNationId）の外交 Op */
export function applyDiploOp(w: World, data: DataBundle, op: DiploOp): string {
  if (w.nations.length === 0) throw new RangeError('国家モードがオフです');
  const me = data.nations.setup.playerNationId;
  if (op.t === 'military') {
    nat(w, me).mobTarget = Math.min(1, Math.max(0, op.mobilization));
    return `動員の目標を ${(nat(w, me).mobTarget * 100).toFixed(0)}% にした`;
  }
  if (op.action === 'respond') {
    const p = w.diplo.proposals.find((x) => x.id === op.proposalId && x.to === me);
    if (!p) throw new RangeError('その提案は期限切れです');
    return resolveProposal(w, data, p, op.accept);
  }
  const to = op.to;
  if (to === me || !w.nations[to - 1]) throw new RangeError('相手の国が正しくありません');
  const r = relationOf(w, me, to);
  const name = nat(w, to).name;
  switch (op.action) {
    case 'proposeTrade':
      propose(w, me, to, 'trade');
      return `${name}に貿易協定を提案した`;
    case 'proposeNonAggression':
      propose(w, me, to, 'nonAggression');
      return `${name}に不可侵条約を提案した`;
    case 'gift': {
      const give = nat(w, me).stock.wealth * 0.1;
      nat(w, me).stock.wealth -= give;
      r.trust = clamp(r.trust + data.nations.diplomacy.trust.giftGain, -100, 100);
      return `${name}へ贈り物をした（富 −${give.toFixed(1)}、信頼 +${data.nations.diplomacy.trust.giftGain}）`;
    }
    case 'cancelPact':
      r.tradePactUntil = 0;
      r.nonAggUntil = 0;
      r.trust = clamp(r.trust - 10, -100, 100);
      return `${name}との協定を破棄した（信頼 −10）`;
    case 'declareWar': {
      const why = declareWar(w, data, me, to, 'プレイヤーの宣戦');
      return why;
    }
    case 'embargo':
      return setEmbargo(w, data, me, to, true);
    case 'liftEmbargo':
      return setEmbargo(w, data, me, to, false);
    case 'sabotage':
      return sabotageDam(w, data, me, to);
    case 'proposePeace':
      if (r.status !== 'war') throw new RangeError('戦争中ではありません');
      propose(w, me, to, 'peace');
      return `${name}に講和を提案した`;
  }
}

export function relStatus(r: Relation): string {
  return r.status;
}
