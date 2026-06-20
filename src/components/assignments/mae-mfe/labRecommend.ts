/**
 * labRecommend — appetite-based "which moves to combine / cycle" recommendations
 * for the Compare and Cycle labs. Reuses each move's Step-2 / default risk config
 * (MAE / MFE / size) — it only chooses WHICH moves go together, never re-picks risk.
 *
 * Research → standard methodology (confirmed with the owner):
 *   COMBINE (daily-netted basket = portfolio construction)
 *     ⚡ Fastest Growth  — max geometric growth (Kelly): tilt to highest-edge moves.
 *     🛡 Safest          — min-variance / max-diversification: low downside/tail
 *                          co-movement positive-edge moves → smoothest equity.
 *     🏆 Best Overall    — max risk-adjusted return (highest combined Sharpe).
 *     🏛 Professionally  — institutional: a diversified, vol-aware basket across
 *                          DISTINCT families (no variant stacking), drawdown-aware.
 *   CYCLE (distribute the stream across N prop accounts via gap rotation)
 *     ⚡ Fastest  — deploy most size: higher k (accts/trade), concentrated stream.
 *     🛡 Safest   — k=1 + more accounts (max gap) → minimize worst-account max-DD.
 *     🏆 Best Overall — best total-$ per unit of worst-account drawdown (Calmar).
 *     🏛 Professionally — size N/k so worst-account max-DD stays within the account
 *                          DD budget (rules.maxDrawdown); diversified stream.
 *
 * The move SET per appetite comes from the proven `recommend()` engine (family-
 * collapsed, correlation-aware), so Compare/Cycle stay consistent with Portfolio.
 */
import type { PropRules, DollarSeries } from '../../../lib/propSim';
import { recommend } from '../../../lib/recommendations';
import { seriesMetrics } from '../../../lib/portfolio';
import {
  combinedStats, deriveSource, sequenceTrades, distributeByGapRotation, type StreamStats,
} from '../../../lib/maeMfeCombine';
import type { AttemptMode } from '../../../lib/maeMfeStats';
import { ASSET_ORDER, type AssetTicker } from '../../../lib/assets';
import { buildLabSources, keyOf, SEP } from './labSources';
import type { MaeMfeDocument } from './maeMfeDocument';

export type Appetite = 'fastest' | 'safest' | 'bestOverall' | 'professional';
export const APPETITES: { key: Appetite; title: string; info: string; note: string }[] = [
  { key: 'fastest', title: '⚡ Fastest Growth', info: 'lr-fastest', note: 'Highest-edge moves — max growth, accepts bigger swings.' },
  { key: 'safest', title: '🛡 Safest', info: 'lr-safest', note: 'Low crash-together moves — smoothest equity, least drawdown.' },
  { key: 'bestOverall', title: '🏆 Best Overall', info: 'lr-bestoverall', note: 'Best risk-adjusted return — highest combined Sharpe.' },
  { key: 'professional', title: '🏛 Professionally', info: 'lr-professional', note: 'Diversified across distinct setups — institutional, drawdown-aware.' },
];

export interface CombineRec { keys: string[]; stats: StreamStats; sharpe: number }
export interface CycleRec extends CombineRec { numAccounts: number; k: number; worstDD: number; totalPnl: number }

const MAX_SET = 5; // cap a basket so cards stay legible and a single set can't sprawl

/** All (asset, move) keys with enough data to value. */
function eligibleKeys(doc: MaeMfeDocument, study: number, attempt: AttemptMode): string[] {
  const keys: string[] = [];
  for (const a of ASSET_ORDER) {
    const state = doc[a as AssetTicker];
    if (!state) continue;
    for (const move of Object.keys(state)) {
      const src = buildLabSources(doc, new Set([keyOf(a, move)]), study, attempt);
      if (src.length && src[0].rows.length >= 5) keys.push(keyOf(a, move));
    }
  }
  return keys;
}

/** One move's $-valued daily series at its own config (study + attempt applied). */
function moveSeries(doc: MaeMfeDocument, key: string, study: number, attempt: AttemptMode, label: (k: string) => string): DollarSeries | null {
  const [asset] = key.split(SEP) as [AssetTicker, string];
  const src = buildLabSources(doc, new Set([key]), study, attempt);
  if (!src.length) return null;
  const byDate = new Map<string, number>();
  for (const r of deriveSource(src[0])) {
    if (!r.tradeDate || r.netCashflow == null) continue;
    byDate.set(r.tradeDate, (byDate.get(r.tradeDate) ?? 0) + r.netCashflow);
  }
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return null;
  return { key, label: label(key), asset, dates, dollars: dates.map((d) => byDate.get(d)!) };
}

/** Map each appetite to a chosen SET of move keys, via the shared recommend() engine. */
function keySetsByAppetite(doc: MaeMfeDocument, rules: PropRules, study: number, attempt: AttemptMode, label: (k: string) => string, opts: { sims: number; rng?: () => number }): Record<Appetite, string[]> {
  const series = eligibleKeys(doc, study, attempt).map((k) => moveSeries(doc, k, study, attempt, label)).filter((s): s is DollarSeries => s != null);
  if (series.length === 0) return { fastest: [], safest: [], bestOverall: [], professional: [] };
  const recs = recommend(series, rules, { sims: opts.sims, rng: opts.rng, basketSize: MAX_SET });
  const top = (alloc: { key: string }[]) => alloc.slice(0, MAX_SET).map((a) => a.key);
  return {
    fastest: top(recs.weights.fastest),
    safest: top(recs.weights.safest),
    bestOverall: top(recs.weights.bestOverall),
    professional: recs.suggested.map((e) => e.key), // greedy max-diversification positive-edge basket
  };
}

/** Combined stats + Sharpe for one set of keys (valued at each move's own config). */
function combineSet(doc: MaeMfeDocument, keys: string[], study: number, attempt: AttemptMode): { stats: StreamStats; sharpe: number } {
  const { stats, days } = combinedStats(buildLabSources(doc, new Set(keys), study, attempt));
  const sharpe = seriesMetrics(days.map((d) => d.pnl)).sharpe;
  return { stats, sharpe };
}

/** COMBINE recommendations: which moves to net together per appetite. */
export function recommendCombine(doc: MaeMfeDocument, rules: PropRules, study: number, attempt: AttemptMode, label: (k: string) => string, opts: { sims: number; rng?: () => number }): Record<Appetite, CombineRec | null> {
  const sets = keySetsByAppetite(doc, rules, study, attempt, label, opts);
  const out = {} as Record<Appetite, CombineRec | null>;
  for (const { key } of APPETITES) {
    const keys = sets[key];
    out[key] = keys.length ? { keys, ...combineSet(doc, keys, study, attempt) } : null;
  }
  return out;
}

/** Pick the best (N, k) for one appetite over a small grid, given the trade stream. */
function bestNK(pnls: number[], appetite: Appetite, ddBudget: number): { numAccounts: number; k: number; worstDD: number; totalPnl: number } {
  let best: { numAccounts: number; k: number; worstDD: number; totalPnl: number; score: number } | null = null;
  for (let N = 2; N <= 12; N++) {
    for (let k = 1; k <= Math.min(3, N); k++) {
      const res = distributeByGapRotation(pnls, N, k);
      const worstDD = res.worst ? res.worst.maxDrawdown : 0; // ≤ 0
      const total = res.totalPnl;
      let score: number;
      switch (appetite) {
        case 'fastest': score = total + k * 1e-3 - N * 1e-6; break;                 // most size; prefer higher k, fewer accts
        case 'safest': score = worstDD - k * 1e-3; break;                            // shallowest worst-account DD (closest to 0)
        case 'bestOverall': score = total / Math.max(1, Math.abs(worstDD)); break;   // Calmar across accounts
        case 'professional': {                                                       // max total within the DD budget
          const ok = Math.abs(worstDD) <= ddBudget || ddBudget <= 0;
          score = ok ? total : -1e9 + worstDD;                                       // if none fit, fall to least-bad DD
          break;
        }
      }
      if (!best || score > best.score) best = { numAccounts: N, k, worstDD, totalPnl: total, score };
    }
  }
  return best ?? { numAccounts: 5, k: 1, worstDD: 0, totalPnl: 0 };
}

/** CYCLE recommendations: which moves + how many accounts + size (k) per appetite. */
export function recommendCycle(doc: MaeMfeDocument, rules: PropRules, study: number, attempt: AttemptMode, label: (k: string) => string, opts: { sims: number; rng?: () => number }): Record<Appetite, CycleRec | null> {
  const sets = keySetsByAppetite(doc, rules, study, attempt, label, opts);
  const ddBudget = rules.maxDrawdown > 0 ? rules.maxDrawdown : 0;
  const out = {} as Record<Appetite, CycleRec | null>;
  for (const { key } of APPETITES) {
    const keys = sets[key];
    if (!keys.length) { out[key] = null; continue; }
    const streams = buildLabSources(doc, new Set(keys), study, attempt).map(deriveSource);
    const pnls = sequenceTrades(streams).map((t) => t.pnl);
    if (!pnls.length) { out[key] = null; continue; }
    const nk = bestNK(pnls, key, ddBudget);
    const { stats, sharpe } = combineSet(doc, keys, study, attempt);
    out[key] = { keys, stats, sharpe, numAccounts: nk.numAccounts, k: nk.k, worstDD: nk.worstDD, totalPnl: nk.totalPnl };
  }
  return out;
}
