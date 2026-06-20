/**
 * Recommendation engine — ranks every loaded move and proposes the best combos.
 *
 * For each move it runs the prop-firm sim (pass/bust/days-to-pass under the
 * user's rules) AND its solo + correlation profile, then surfaces:
 *   fastest        — passes soonest (gated on a real pass rate)
 *   safest         — lowest bust rate / shallowest drawdown (positive edge only)
 *   bestOverall    — highest pass rate, tie-broken by speed
 *   bestDiversifier— lowest average correlation to the others (positive edge)
 *   suggested      — a small basket of the most independent positive-edge moves
 *
 * Everything is settings-synced: same daily returns and win/stop logic as the
 * rest of the dashboard, so a change to Min Cashflow / Max MAE re-ranks here too.
 */
import { runPropSim, type PropRules, type DollarSeries } from './propSim';
import { computeMatrix, familyKey, type Series } from './correlation';
import { seriesMetrics, type SeriesMetrics } from './portfolio';

export interface MoveEval {
  key: string;
  label: string;
  pass: number;          // pass rate 0..1
  bust: number;          // bust rate 0..1
  medianDays: number | null;
  expEnd: number;        // mean ending $ across attempts
  solo: SeriesMetrics;   // total / vol / maxDD / sharpe / winRate (%, solo)
  avgCorr: number;       // mean |Pearson| to other families — overall co-movement (diversification)
  avgFail: number;       // mean downside/tail co-movement — "do they lose/crash together" (risk)
}

export interface Alloc { key: string; label: string; weight: number } // weight 0..1, sums to 1

export interface Recommendations {
  evals: MoveEval[];
  fastest: MoveEval | null;
  safest: MoveEval | null;
  bestOverall: MoveEval | null;
  bestDiversifier: MoveEval | null;
  suggested: MoveEval[];
  passGate: number; // pass-rate threshold used for "fastest"
  /** Recommended weight per move for each objective (only weight > 0 listed, desc). */
  weights: { fastest: Alloc[]; safest: Alloc[]; bestOverall: Alloc[]; diversifier: Alloc[] };
}

/**
 * Turn a per-move objective score into a normalized allocation. Scores ≤ 0 are
 * dropped; if nothing scores, fall back to equal weight across all moves.
 */
function allocate(evals: MoveEval[], score: (e: MoveEval) => number): Alloc[] {
  // Collapse to one representative per strategy family (best-scoring member), so
  // an asset's own variants (1800 / 1800MA / 1800FR / 1800PB) don't stack and
  // dominate the basket — diversification is across genuinely different setups.
  const best = new Map<string, { e: MoveEval; s: number }>();
  for (const e of evals) {
    const s = Math.max(0, score(e));
    const fam = familyKey(e.key);
    const cur = best.get(fam);
    if (!cur || s > cur.s) best.set(fam, { e, s });
  }
  const kept = [...best.values()];
  const sum = kept.reduce((acc, x) => acc + x.s, 0);
  const w = sum > 0 ? kept.map((x) => x.s / sum) : kept.map(() => 1 / Math.max(1, kept.length));
  return kept
    .map((x, i) => ({ key: x.e.key, label: x.e.label, weight: w[i] }))
    .filter((a) => a.weight > 0.0005)
    .sort((a, b) => b.weight - a.weight);
}

export interface RecommendOpts { sims: number; rng?: () => number; passGate?: number; basketSize?: number }

export function recommend(dollarSeries: DollarSeries[], rules: PropRules, opts: RecommendOpts): Recommendations {
  const passGate = opts.passGate ?? 0.4;
  const basketSize = opts.basketSize ?? 4;

  if (dollarSeries.length === 0) {
    return { evals: [], fastest: null, safest: null, bestOverall: null, bestDiversifier: null, suggested: [], passGate, weights: { fastest: [], safest: [], bestOverall: [], diversifier: [] } };
  }

  // Correlation profile across moves (Pearson is scale-invariant, so $ or % is identical).
  const corrSeries: Series[] = dollarSeries.map((d) => ({ key: d.key, label: d.label, daily: new Map(d.dates.map((dt, i) => [dt, d.dollars[i]])) }));
  const n = dollarSeries.length;
  // Per-lens correlation matrices. Pearson = overall co-movement (the textbook
  // diversification measure). Downside + Tail = "do they LOSE / CRASH together" —
  // the dependence that matters for risk, which Pearson misses (it understates
  // joint-crash/tail dependence; see research note in the commit/recs).
  // Spearman (rank) for the diversification co-movement — robust to the fat-tailed
  // trade P&L (Pearson is skewed by a few outlier days). Downside/Tail for risk.
  const mDiversify = computeMatrix(corrSeries, 'spearman');
  const mDown = computeMatrix(corrSeries, 'downside');
  const mTail = computeMatrix(corrSeries, 'tail');
  // Mean dependence to OTHER families only (a move's own variants are trivially
  // correlated). `abs` for signed correlations; tail overlap is already 0..1.
  const avgOf = (i: number, m: number[][], abs: boolean) => {
    let s = 0, c = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (familyKey(dollarSeries[i].key) === familyKey(dollarSeries[j].key)) continue;
      s += abs ? Math.abs(m[i][j]) : m[i][j]; c++;
    }
    return c ? s / c : 0;
  };

  const evals: MoveEval[] = dollarSeries.map((d, i) => {
    const prop = runPropSim(d.dollars, rules, { mode: 'bootstrap', sims: opts.sims, rng: opts.rng });
    return {
      key: d.key, label: d.label,
      pass: prop.passRate, bust: prop.bustRate, medianDays: prop.medianDaysToPass, expEnd: prop.meanFinal,
      solo: seriesMetrics(d.dollars),
      avgCorr: avgOf(i, mDiversify.m, true),                                   // overall — diversification
      avgFail: Math.max(avgOf(i, mDown.m, true), avgOf(i, mTail.m, false)),  // downside/tail — crash-together risk
    };
  });

  const positive = evals.filter((e) => e.solo.total > 0);
  const passers = evals.filter((e) => e.pass >= passGate && e.medianDays != null);

  const fastest = (passers.length ? passers : evals.filter((e) => e.medianDays != null))
    .slice().sort((a, b) => (a.medianDays! - b.medianDays!) || (b.pass - a.pass))[0] ?? null;

  const safest = (positive.length ? positive : evals)
    .slice().sort((a, b) => (a.bust - b.bust) || (b.solo.maxDD - a.solo.maxDD) || (b.pass - a.pass))[0] ?? null;

  const bestOverall = evals.slice().sort((a, b) => (b.pass - a.pass) || ((a.medianDays ?? Infinity) - (b.medianDays ?? Infinity)))[0] ?? null;

  const bestDiversifier = n < 2 ? null : (positive.length ? positive : evals).slice().sort((a, b) => a.avgCorr - b.avgCorr)[0] ?? null;

  // Suggested basket: greedily add the positive-edge move least correlated to those already chosen.
  const pool = positive.slice().sort((a, b) => b.solo.sharpe - a.solo.sharpe);
  const suggested: MoveEval[] = [];
  if (pool.length) {
    suggested.push(bestOverall && pool.includes(bestOverall) ? bestOverall : pool[0]);
    while (suggested.length < Math.min(basketSize, pool.length)) {
      const chosenIdx = suggested.map((e) => dollarSeries.findIndex((d) => d.key === e.key));
      let next: MoveEval | null = null, bestScore = Infinity;
      for (const cand of pool) {
        if (suggested.includes(cand)) continue;
        const ci = dollarSeries.findIndex((d) => d.key === cand.key);
        const maxCorr = Math.max(...chosenIdx.map((j) => Math.abs(mDiversify.m[ci][j])));
        if (maxCorr < bestScore) { bestScore = maxCorr; next = cand; }
      }
      if (!next) break;
      suggested.push(next);
    }
  }

  // Correlation-aware weightings — each objective tilts toward complementary moves
  // using the correlation lens that matches its GOAL:
  //   fastest / bestOverall → Pearson (overall co-movement)
  //   safest                → downside/tail (avoid moves that CRASH together)
  //   diversifier           → Pearson (overall independence)
  const decorr = (e: MoveEval) => Math.max(0.05, 1 - e.avgCorr);          // overall (Pearson)
  const decorrFail = (e: MoveEval) => Math.max(0.05, 1 - e.avgFail);       // crash-together (downside/tail)
  const edge = (e: MoveEval) => e.solo.total > 0;
  const weights = {
    fastest: allocate(evals, (e) => (e.pass >= passGate && e.medianDays ? (e.pass / e.medianDays) * decorr(e) : 0)),
    safest: allocate(evals, (e) => (edge(e) ? (Math.max(0, 1 - e.bust) / Math.max(e.solo.annVol, 0.01)) * decorrFail(e) : 0)),
    bestOverall: allocate(evals, (e) => (edge(e) ? Math.max(0.001, e.pass) * (1 + Math.max(0, e.solo.sharpe)) * decorr(e) : 0)),
    diversifier: allocate(evals, (e) => (edge(e) ? Math.max(0.01, 1 - e.avgCorr) : 0)),
  };

  return { evals, fastest, safest, bestOverall, bestDiversifier, suggested, passGate, weights };
}
