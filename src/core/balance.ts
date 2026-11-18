import type { DataBundle } from './data/schema';
import { buildWorld, stepWorld } from './pipeline';

/**
 * AI だけの統計（§22.11）。画面なしで、国家モードの世界を何本も走らせ、戦争の頻度・期間・勝敗・地形の効果を集計する。
 * プレイヤーの操作は入れない（AI の外交・軍事は状態の関数なので、同じ seed なら同じ結果）。
 */
export interface BalanceStats {
  runs: number;
  ticks: number;
  warsPer100Years: number;
  peaceShare: number;
  meanWarDuration: number;
  maxWarDuration: number;
  capitalFallShare: number;
  aggressorWinShare: number;
  /** 地形ごとの占領率 = 占領セル / 前線セル */
  captureRate: Record<string, { front: number; taken: number; rate: number }>;
  riverCaptureRate: number;
  dryCaptureRate: number;
  scenarios: string[];
}

export function runBalance(
  data: DataBundle,
  opts: { runs: number; ticks: number; size: number; scenarios: string[]; seed0?: number },
  onRun?: (i: number) => void,
): BalanceStats {
  const front: Record<string, number> = {};
  const taken: Record<string, number> = {};
  let riverFront = 0;
  let riverTaken = 0;
  let wars = 0;
  let ended = 0;
  let durSum = 0;
  let durMax = 0;
  let falls = 0;
  let wins = 0;
  let decided = 0;
  let warTicks = 0;
  for (let i = 0; i < opts.runs; i++) {
    const sc = opts.scenarios[i % opts.scenarios.length]!;
    const w = buildWorld(data, sc, (opts.seed0 ?? 1) + i, opts.size, { nations: true });
    for (let t = 0; t < opts.ticks; t++) {
      w.tick++;
      stepWorld(w, data, false);
    }
    const b = w.diplo.battle;
    for (const k of Object.keys(b.front)) front[k] = (front[k] ?? 0) + b.front[k]!;
    for (const k of Object.keys(b.taken)) taken[k] = (taken[k] ?? 0) + b.taken[k]!;
    riverFront += b.riverFront;
    riverTaken += b.riverTaken;
    wars += b.wars;
    ended += b.ended;
    durSum += b.durationSum;
    durMax = Math.max(durMax, b.durationMax);
    falls += b.capitalFalls;
    wins += b.aggressorWins;
    decided += b.decided;
    warTicks += b.warTicks;
    onRun?.(i);
  }
  const captureRate: BalanceStats['captureRate'] = {};
  for (const k of Object.keys(front)) captureRate[k] = { front: front[k]!, taken: taken[k] ?? 0, rate: (taken[k] ?? 0) / front[k]! };
  const totalFront = Object.values(front).reduce((a, b) => a + b, 0);
  const totalTaken = Object.values(taken).reduce((a, b) => a + b, 0);
  const total = opts.runs * opts.ticks;
  return {
    runs: opts.runs,
    ticks: opts.ticks,
    warsPer100Years: (wars / total) * 100,
    peaceShare: 1 - warTicks / total,
    meanWarDuration: ended > 0 ? durSum / ended : 0,
    maxWarDuration: durMax,
    capitalFallShare: wars > 0 ? falls / wars : 0,
    aggressorWinShare: decided > 0 ? wins / decided : 0.5,
    captureRate,
    riverCaptureRate: riverFront > 0 ? riverTaken / riverFront : 0,
    dryCaptureRate: totalFront - riverFront > 0 ? (totalTaken - riverTaken) / (totalFront - riverFront) : 0,
    scenarios: opts.scenarios,
  };
}
