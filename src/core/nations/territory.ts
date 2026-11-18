import { biomeKeys } from '../climate/climate';
import { computeSuitability, found } from '../civ/settlements';
import type { DataBundle } from '../data/schema';
import { emit } from '../events';
import { DX, DY } from '../hydrology';
import { createRng, deriveSeed } from '../prng';
import { emptyDiplo, type Nation, type Relation, type World } from '../world';

/**
 * 国家モードの初期化（§21.3〜21.4）。首都を選び、地形コストの Dijkstra で領土を引き、
 * 初期ポテンシャル（領土内の居住適性の合計）が tolerance 以内になるまで首都を選び直す。
 */

function isLand(w: World, data: DataBundle, i: number): boolean {
  return w.primary.height[i]! >= w.params.seaLevel && w.derived.lakeDepth[i]! <= data.hydrology.priorityFlood.lakeDepthMin;
}

/** 1 セルに入るコスト = 1 + 傾斜² + 川 + 植生（nations.territory）。進入不可は Infinity */
export function territoryCost(w: World, data: DataBundle): Float32Array {
  const t = data.nations.territory;
  const n = w.size;
  const out = new Float32Array(n * n);
  const norm = w.maxElevation / w.cellSize;
  const rv = data.hydrology.river.flowThreshold;
  for (let i = 0; i < n * n; i++) {
    if (!isLand(w, data, i)) {
      out[i] = Infinity;
      continue;
    }
    const g = w.derived.slope[i]! / norm;
    out[i] = 1 + t.costSlope * g * g + (w.derived.flowAcc[i]! >= rv ? t.costRiverCrossing : 0) + t.costVegetation * w.primary.vegetation[i]!;
  }
  return out;
}

/** 多始点 Dijkstra（二分ヒープ）。同じコストなら小さい国 ID が勝つ（決定論） */
export function assignTerritory(n: number, cost: Float32Array, sources: number[], out: Uint8Array): void {
  const dist = new Float64Array(n * n).fill(Infinity);
  out.fill(0);
  const heapD: number[] = [];
  const heapI: number[] = [];
  const push = (d: number, i: number): void => {
    let k = heapD.length;
    heapD.push(d);
    heapI.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p]! < d || (heapD[p] === d && heapI[p]! <= i)) break;
      heapD[k] = heapD[p]!;
      heapI[k] = heapI[p]!;
      k = p;
    }
    heapD[k] = d;
    heapI[k] = i;
  };
  const pop = (): [number, number] => {
    const rd = heapD[0]!;
    const ri = heapI[0]!;
    const ld = heapD.pop()!;
    const li = heapI.pop()!;
    const len = heapD.length;
    if (len > 0) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= len) break;
        if (c + 1 < len && (heapD[c + 1]! < heapD[c]! || (heapD[c + 1] === heapD[c] && heapI[c + 1]! < heapI[c]!))) c++;
        if (heapD[c]! > ld || (heapD[c] === ld && heapI[c]! >= li)) break;
        heapD[k] = heapD[c]!;
        heapI[k] = heapI[c]!;
        k = c;
      }
      heapD[k] = ld;
      heapI[k] = li;
    }
    return [rd, ri];
  };
  sources.forEach((c, k) => {
    dist[c] = 0;
    out[c] = k + 1;
    push(0, c);
  });
  while (heapD.length > 0) {
    const [d, i] = pop();
    if (d > dist[i]!) continue;
    const x = i % n;
    const y = (i / n) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      const c = cost[j]!;
      if (c === Infinity) continue;
      const nd = d + c * (k % 2 === 1 ? Math.SQRT2 : 1); // DX/DY の奇数番は斜め
      if (nd < dist[j]! || (nd === dist[j] && out[i]! < out[j]!)) {
        if (nd < dist[j]!) {
          dist[j] = nd;
          push(nd, j);
        }
        out[j] = out[i]!;
      }
    }
  }
}

/** ポテンシャル = 領土内の居住適性の合計。農地にできるセルは重く数える（nations.potentialBalance.farmWeight） */
function potentialOf(owner: Uint8Array, weight: Float32Array, k: number): number[] {
  const p = new Array<number>(k).fill(0);
  for (let i = 0; i < owner.length; i++) if (owner[i]! > 0) p[owner[i]! - 1]! += weight[i]!;
  return p;
}

function potentialWeights(w: World, data: DataBundle, suit: Float32Array): Float32Array {
  const g = data.settlements.growth;
  const fw = data.nations.potentialBalance.farmWeight.value;
  const keys = biomeKeys(data);
  const farm = new Set((g.farmBiomes.value as readonly string[]).map((k) => keys.indexOf(k)));
  const out = new Float32Array(suit.length);
  for (let i = 0; i < suit.length; i++) {
    const f = farm.has(w.derived.biome[i]!) ? Math.min(1, w.derived.moisture[i]! / g.moistureFullAt.value) : 0;
    out[i] = Math.max(0, suit[i]!) * (1 - fw + fw * f);
  }
  return out;
}

const spread = (p: number[]): number => {
  const max = Math.max(...p);
  return max > 0 ? (max - Math.min(...p)) / max : 1;
};

export function relationOf(w: World, a: number, b: number): Relation {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return w.diplo.relations.find((r) => r.a === lo && r.b === hi)!;
}

/** 国家モードを立ち上げる。首都を置けた国の数だけ国を作る。成功したら true */
export function setupNations(w: World, data: DataBundle): boolean {
  const setup = data.nations.setup;
  const n = w.size;
  const K = setup.nationCount;
  const suit = new Float32Array(n * n);
  computeSuitability(w, data, suit);
  const thr = data.settlements.spawn.threshold;
  const cost = territoryCost(w, data);
  const pw = potentialWeights(w, data, suit);
  const cand: number[] = [];
  for (let i = 0; i < n * n; i++) if (suit[i]! >= thr && cost[i]! !== Infinity) cand.push(i);
  if (cand.length === 0) return false;

  let best: { caps: number[]; owner: Uint8Array; pot: number[]; spread: number } | null = null;
  const owner = new Uint8Array(n * n);
  for (let t = 0; t < setup.capitalSelection.tries; t++) {
    const rng = createRng(deriveSeed(w.seed, 9000 + t));
    const caps: number[] = [];
    for (let k = 0; k < K; k++) {
      const ok = cand.filter((c) => caps.every((o) => Math.hypot((c % n) - (o % n), ((c / n) | 0) - ((o / n) | 0)) >= data.nations.capital.minDistance));
      if (ok.length === 0) break;
      let total = 0;
      for (const c of ok) total += suit[c]!;
      let r = rng.next() * total;
      let pick = ok[ok.length - 1]!;
      for (const c of ok) {
        r -= suit[c]!;
        if (r <= 0) {
          pick = c;
          break;
        }
      }
      caps.push(pick);
    }
    if (caps.length < 2) continue;
    // 国の数が少ない試行より、K 国そろった試行を優先する
    assignTerritory(n, cost, caps, owner);
    const pot = potentialOf(owner, pw, caps.length);
    const sp = spread(pot);
    const better = !best || caps.length > best.caps.length || (caps.length === best.caps.length && sp < best.spread);
    if (better) best = { caps, owner: owner.slice(), pot, spread: sp };
    if (caps.length === K && sp <= data.nations.potentialBalance.tolerance) break;
  }
  // 山登り: 許容に届かなかったら、ポテンシャルが最小の国の首都を動かして差を縮める（最良を保つ）
  if (best && best.caps.length === K && best.spread > data.nations.potentialBalance.tolerance) {
    const rng = createRng(deriveSeed(w.seed, 9500));
    for (let t = 0; t < setup.capitalSelection.tries && best.spread > data.nations.potentialBalance.tolerance; t++) {
      const lo = best.pot.indexOf(Math.min(...best.pot));
      const others = best.caps.filter((_, k) => k !== lo);
      const ok = cand.filter((c) => others.every((o) => Math.hypot((c % n) - (o % n), ((c / n) | 0) - ((o / n) | 0)) >= data.nations.capital.minDistance));
      if (ok.length === 0) break;
      const caps = best.caps.slice();
      caps[lo] = ok[Math.floor(rng.next() * ok.length)]!;
      assignTerritory(n, cost, caps, owner);
      const pot = potentialOf(owner, pw, K);
      const sp = spread(pot);
      if (sp < best.spread) best = { caps, owner: owner.slice(), pot, spread: sp };
    }
  }
  if (!best) return false;

  w.primary.owner.set(best.owner);
  const rng = createRng(deriveSeed(w.seed, 777));
  const offset = Math.floor(rng.next() * 1000);
  const pers = data.nations.ai.personalityByRank;
  w.nations = [];
  w.diplo = emptyDiplo();
  best.caps.forEach((cell, k) => {
    const id = k + 1;
    const s = found(w, data, cell, setup.capitalPop, `${setup.names[k] ?? `国${id}`} の首都ができた（${cell % n}, ${(cell / n) | 0}）`);
    const nat: Nation = {
      id,
      name: setup.names[k] ?? `国${id}`,
      color: setup.colors[k] ?? '#999999',
      personality: id === data.nations.setup.playerNationId ? 'player' : pers[(id - 2 + offset) % pers.length]!,
      capitalId: s.id,
      stock: { food: 0, wood: 0, ore: 0, wealth: 0 },
      prod: { food: 0, wood: 0, ore: 0, wealth: 0 },
      cons: { food: 0, wood: 0, ore: 0 },
      tech: 0,
      army: 0,
      mobTarget: 0,
      pop: setup.capitalPop,
      cells: 0,
      baseCells: 0,
      potential: best!.pot[k]!,
      famine: 0,
      lossAcc: 0,
      lossEma: 0,
      tradeValue: 0,
      foodImport: 0,
      di: 0,
      diParts: [],
      diHistory: [],
      lastDecision: '',
    };
    w.nations.push(nat);
  });
  for (let a = 1; a <= w.nations.length; a++) {
    for (let b = a + 1; b <= w.nations.length; b++) {
      w.diplo.relations.push({
        a, b, trust: data.nations.diplomacy.trust.initial, status: 'peace', tensionTicks: 0, truceUntil: 0,
        tradePactUntil: 0, nonAggUntil: 0, border: 0, grievance: '', lastTradeTick: -1, proposeCooldown: 0, embargoAB: false, embargoBA: false,
      });
    }
  }
  const K2 = w.nations.length;
  w.diplo.inflowEma = new Array<number>(K2 * K2).fill(0);
  w.diplo.basePotential = best.pot.reduce((x, y) => x + y, 0) / best.pot.length;
  const pct = Math.round(best.spread * 100);
  emit(w, data, 'nation', `${w.nations.length} か国で始まった（初期ポテンシャルの差 ${pct}%${best.spread > data.nations.potentialBalance.tolerance ? '。許容を超えた' : ''}）`);
  return true;
}
