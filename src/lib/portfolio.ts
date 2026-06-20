/**
 * Portfolio engine — combine several moves at chosen weights into one equity
 * curve and measure the blend.
 *
 * SYNC CONTRACT: reuses the correlation engine's settings-synced daily returns
 * (moveDailyReturns via buildSeries), so the portfolio reflects the same
 * win/stop logic and Min Cashflow / Max MAE as the rest of the dashboard.
 * All in % (scale-free → every asset incl. RTY). Returns are summed (additive,
 * fixed sizing), matching the Combine/Correlation panels.
 */
import { buildSeries, type Series } from './correlation';

export { buildSeries } from './correlation';
export type { Series } from './correlation';

const SQRT252 = Math.sqrt(252);

function drawdown(rets: number[]): number {
  let eq = 0, peak = 0, mdd = 0;
  for (const r of rets) { eq += r; if (eq > peak) peak = eq; if (eq - peak < mdd) mdd = eq - peak; }
  return mdd;
}
function mean(xs: number[]): number { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; }
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export interface SeriesMetrics {
  total: number;        // sum of daily % (cumulative return)
  annVol: number;       // annualized volatility %
  maxDD: number;        // deepest drawdown % (≤ 0)
  sharpe: number;       // (mean/sd)·√252
  winRateDays: number;  // share of days > 0
  days: number;
}

export function seriesMetrics(daily: number[]): SeriesMetrics {
  const sd = stdev(daily);
  const flat = sd < 1e-12; // guard fp dust so a constant series isn't a garbage Sharpe
  const m = mean(daily);
  return {
    total: daily.reduce((s, x) => s + x, 0),
    annVol: flat ? 0 : sd * SQRT252,
    maxDD: drawdown(daily),
    sharpe: flat ? 0 : (m / sd) * SQRT252,
    winRateDays: daily.length ? daily.filter((x) => x > 0).length / daily.length : 0,
    days: daily.length,
  };
}

/** Weighted daily returns over the union of all included dates (absent move → 0 that day). */
export function combinedDailyReturns(weighted: { daily: Map<string, number>; weight: number }[]): { dates: string[]; returns: number[] } {
  const all = new Set<string>();
  for (const w of weighted) for (const d of w.daily.keys()) all.add(d);
  const dates = [...all].sort();
  const returns = dates.map((d) => {
    let s = 0;
    for (const w of weighted) s += w.weight * (w.daily.get(d) ?? 0);
    return s;
  });
  return { dates, returns };
}

export interface PortfolioResult {
  dates: string[];
  equity: number[];      // cumulative % path
  metrics: SeriesMetrics;
  perMove: { key: string; label: string; weight: number; solo: SeriesMetrics; contribReturn: number }[];
  diversification: number; // fraction of weighted-avg vol removed by blending (0..1)
  weightedVolSum: number;  // Σ wᵢ·annVolᵢ (the "no-diversification" vol)
}

const EMPTY: PortfolioResult = {
  dates: [], equity: [], perMove: [], diversification: 0, weightedVolSum: 0,
  metrics: { total: 0, annVol: 0, maxDD: 0, sharpe: 0, winRateDays: 0, days: 0 },
};

/** Combine the given series at raw weights (normalized to sum 1; all-zero → equal). */
export function computePortfolio(series: Series[], rawWeights: number[]): PortfolioResult {
  if (series.length === 0) return EMPTY;
  const sum = rawWeights.reduce((s, w) => s + Math.max(0, w), 0);
  const weights = sum > 0 ? rawWeights.map((w) => Math.max(0, w) / sum) : series.map(() => 1 / series.length);

  const weighted = series.map((s, i) => ({ daily: s.daily, weight: weights[i] }));
  const { dates, returns } = combinedDailyReturns(weighted);

  let eq = 0;
  const equity = returns.map((r) => (eq += r));
  const metrics = seriesMetrics(returns);

  const perMove = series.map((s, i) => {
    const solo = seriesMetrics([...s.daily.values()]);
    return { key: s.key, label: s.label, weight: weights[i], solo, contribReturn: weights[i] * solo.total };
  });

  const weightedVolSum = perMove.reduce((s, p) => s + p.weight * p.solo.annVol, 0);
  const diversification = weightedVolSum > 0 ? Math.max(0, (weightedVolSum - metrics.annVol) / weightedVolSum) : 0;

  return { dates, equity, metrics, perMove, diversification, weightedVolSum };
}
