/**
 * grandRecommend — the capstone "here's your whole plan" recommendation for Step 4.
 *
 * Ties together EVERYTHING the dashboard computes, per risk appetite:
 *   • each move valued at its OWN Step-2 / default-safest risk (MAE / MFE / size)
 *   • a correlation-aware multi-move basket (from recommend(), family-collapsed)
 *   • the COMBINED portfolio run through the prop-sim (pass / bust / expected $)
 *     and equity stats (Sharpe, max drawdown, diversification, risk of ruin)
 *
 * So one card answers: "for my account, at this appetite, which moves do I run,
 * how do I split them, and what happens when the whole basket is tested together."
 *
 * Research → standard portfolio mapping (owner-approved, same as the Combine lab):
 *   ⚡ Fastest Growth — max growth (Kelly): pass-speed × edge, lightly de-correlated
 *   🛡 Safest         — min-variance / low crash-together (downside+tail) basket
 *   🏆 Best Overall   — max risk-adjusted (pass × Sharpe), correlation-aware
 *   🏛 Professionally — institutional risk-parity: the diversified independent
 *                        basket, inverse-volatility weighted (vol-targeted)
 */
import type { MaeMfeDocument } from '../components/assignments/mae-mfe/maeMfeDocument';
import { buildOwnSizeDollarSeries, runPropSim, type PropRules, type DollarSeries } from './propSim';
import { recommend, type Alloc, type MoveEval } from './recommendations';
import { buildSeries, computePortfolio, seriesMetrics } from './portfolio';

export type Appetite = 'fastest' | 'safest' | 'bestOverall' | 'professional';
export const GRAND_APPETITES: { key: Appetite; title: string; info: string }[] = [
  { key: 'fastest', title: '⚡ Fastest Growth', info: 'gr-fastest' },
  { key: 'safest', title: '🛡 Safest', info: 'gr-safest' },
  { key: 'bestOverall', title: '🏆 Best Overall', info: 'gr-bestoverall' },
  { key: 'professional', title: '🏛 Professionally', info: 'gr-professional' },
];

export interface GrandRec {
  appetite: Appetite;
  title: string;
  alloc: Alloc[];          // recommended weighted basket (each move at its own risk)
  pass: number;            // combined prop-sim pass rate 0..1
  bust: number;            // combined bust rate 0..1 (= risk of ruin)
  active: number;          // still-trading rate 0..1
  expEnd: number;          // mean ending $ of the combined basket
  medianDays: number | null;
  sharpe: number;
  maxDD: number;           // $ (≤ 0)
  diversification: number; // 0..1 — vol removed by blending
  rationale: string;
  dates: string[];         // combined trading dates (for the $ equity chart)
  dollars: number[];       // combined per-date $ P&L (same length as dates)
  activeFrom: number;      // index where every allocated move has data (trim flat lead-in)
}

/** Inverse-volatility (risk-parity) weights over a set of moves — institutional sizing. */
function riskParityAlloc(evals: MoveEval[]): Alloc[] {
  const inv = evals.map((e) => ({ e, w: 1 / Math.max(0.01, e.solo.annVol) }));
  const sum = inv.reduce((s, x) => s + x.w, 0) || 1;
  return inv.map((x) => ({ key: x.e.key, label: x.e.label, weight: x.w / sum }));
}

/**
 * Weighted-sum the per-move daily $ into one combined portfolio $ stream (by date).
 * `activeFrom` = index of the first date on which EVERY allocated move has data
 * (= max of each move's earliest date). Before it the basket is only partially
 * live, so the equity curve is artificially flat — charts trim to it.
 */
function combinedDollars(dollarSeries: DollarSeries[], alloc: Alloc[]): { dates: string[]; dollars: number[]; activeFrom: number } {
  const wOf = new Map(alloc.map((a) => [a.key, a.weight]));
  const byDate = new Map<string, number>();
  let latestFirst = ''; // the max over moves of each move's earliest date
  for (const ds of dollarSeries) {
    const w = wOf.get(ds.key);
    if (!w || !ds.dates.length) continue;
    const firstOfMove = ds.dates.reduce((a, b) => (a < b ? a : b));
    if (firstOfMove > latestFirst) latestFirst = firstOfMove;
    ds.dates.forEach((d, i) => byDate.set(d, (byDate.get(d) ?? 0) + ds.dollars[i] * w));
  }
  const dates = [...byDate.keys()].sort();
  const idx = latestFirst ? dates.findIndex((d) => d >= latestFirst) : 0;
  return { dates, dollars: dates.map((d) => byDate.get(d)!), activeFrom: Math.max(0, idx) };
}

const RATIONALE: Record<Appetite, string> = {
  fastest: 'Highest-edge moves, lightly de-correlated — grows fastest, accepts bigger swings (≈full-Kelly).',
  safest: 'Moves that don’t lose together (downside/tail-aware) — lowest bust risk and shallowest drawdown (≈¼-Kelly).',
  bestOverall: 'Best risk-adjusted blend — strong expected outcome with a real chance of passing/surviving (≈½-Kelly).',
  professional: 'Diversified across independent setups, inverse-volatility (risk-parity) weighted — how a desk would run it.',
};

export interface GrandOpts { sims: number; rng?: () => number }

/** One grand recommendation per appetite — the full basket + its combined test results. */
export function grandRecommend(doc: MaeMfeDocument, rules: PropRules, label: (m: string) => string, opts: GrandOpts): Record<Appetite, GrandRec | null> {
  const dollarSeries = buildOwnSizeDollarSeries(doc, label);
  const pctSeries = buildSeries(doc, label);
  const empty = { fastest: null, safest: null, bestOverall: null, professional: null } as Record<Appetite, GrandRec | null>;
  if (dollarSeries.length === 0) return empty;

  const recs = recommend(dollarSeries, rules, { sims: opts.sims, rng: opts.rng });
  const allocFor = (a: Appetite): Alloc[] => {
    if (a === 'fastest') return recs.weights.fastest;
    if (a === 'safest') return recs.weights.safest;
    if (a === 'bestOverall') return recs.weights.bestOverall;
    return recs.suggested.length ? riskParityAlloc(recs.suggested) : recs.weights.diversifier; // professional
  };

  const out = {} as Record<Appetite, GrandRec | null>;
  for (const { key, title } of GRAND_APPETITES) {
    const alloc = allocFor(key);
    if (!alloc.length) { out[key] = null; continue; }
    const { dates, dollars: combined, activeFrom } = combinedDollars(dollarSeries, alloc);
    if (!combined.length) { out[key] = null; continue; }
    const prop = runPropSim(combined, rules, { mode: 'bootstrap', sims: opts.sims, rng: opts.rng });
    const m = seriesMetrics(combined);
    const wOf = new Map(alloc.map((a) => [a.key, a.weight]));
    const chosen = pctSeries.filter((s) => wOf.has(s.key));
    const port = chosen.length ? computePortfolio(chosen, chosen.map((s) => wOf.get(s.key)!)) : null;
    out[key] = {
      appetite: key, title, alloc,
      pass: prop.passRate, bust: prop.bustRate, active: Math.max(0, 1 - prop.passRate - prop.bustRate),
      expEnd: prop.meanFinal, medianDays: prop.medianDaysToPass,
      sharpe: m.sharpe, maxDD: m.maxDD, diversification: port?.diversification ?? 0,
      rationale: RATIONALE[key],
      dates, dollars: combined, activeFrom,
    };
  }
  return out;
}
