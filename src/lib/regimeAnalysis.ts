/**
 * Vol-regime conditioning for MAE/MFE moves — the descriptive layer.
 *
 * Joins each derived trade to the vol regime in force (NO LOOKAHEAD: the
 * prior-session value), then summarizes how the move + its Min Cashflow / Max
 * MAE rule played out per regime. Because per-bucket trade counts are small,
 * every win rate carries a Wilson 95% interval AND a shrunk estimate
 * (Beta-Binomial toward the move's all-regime rate). Thin buckets are flagged,
 * not hidden — this is a lens for judgment, not an auto parameter-fitter.
 *
 * Axes (the user can compare which separates outcomes best):
 *   'vol2' — Expanding vs Contracting   (VVIX momentum above/below trailing median; ~50/50, robust)
 *   'vol3' — Expanding / Stable / Contracting   (p60 / p40-p60 / p40; Stable band is thin on short data)
 *   'ts'   — Contango vs Backwardation   (exact term-structure; Backwardation is the rare side)
 */
import type { DerivedRow } from './maeMfeStats';
import { VOL_REGIME } from './volRegime';

export type RegimeAxis = 'vol2' | 'vol3' | 'ts';

// Display order per axis (calm/contracting → stressed/expanding).
export const REGIME_ORDER: Record<RegimeAxis, string[]> = {
  vol2: ['CONTRACTING', 'EXPANDING'],
  vol3: ['CONTRACTING', 'STABLE', 'EXPANDING'],
  ts: ['CONTANGO', 'BACKWARDATION'],
};

export const AXIS_LABEL: Record<RegimeAxis, string> = {
  vol2: 'Vol: Expanding / Contracting',
  vol3: 'Vol: Expanding / Stable / Contracting',
  ts: 'Term structure: Contango / Backwardation',
};

export const REGIME_META: Record<string, { label: string; tone: string }> = {
  CONTRACTING: { label: 'Contracting', tone: '#5fae7f' }, // vol calming
  STABLE: { label: 'Stable', tone: 'var(--color-text-secondary)' },
  EXPANDING: { label: 'Expanding', tone: '#d06666' },     // vol building
  CONTANGO: { label: 'Contango', tone: '#5fae7f' },
  BACKWARDATION: { label: 'Backwardation', tone: '#d06666' },
  UNKNOWN: { label: 'Unknown', tone: 'var(--color-text-muted)' },
};

// Sorted regime dates for the prior-session lookup (built once).
const SORTED_DATES = Object.keys(VOL_REGIME).sort();

/** Plain-language, beginner-friendly definition of each vol state (also feeds video scripts). */
// Each definition ends with what it's built from + the exact calculation, for the videos.
const MCS_CALC =
  ' • Built from: VVIX (the “vol of vol” — implied volatility of the VIX). Calc: a Momentum-Change Score = 0.7×slope(3-day) + 0.3×ROC(21-day), then EMA(3)-smoothed, then ranked against its own trailing-252-day percentiles — so the bands are relative, not fixed levels. Uses the prior session’s value (no lookahead).';
const TS_CALC =
  ' • Built from: the VIX term structure — VIX9D (9-day) vs VIX (30-day). Calc: spread = VIX9D − VIX; spread < 0 → Contango (up-sloping/calm), spread > 0 → Backwardation (inverted/stress). Uses the prior session’s value (no lookahead).';
export const REGIME_DEF: Record<string, string> = {
  CONTRACTING:
    'Volatility is calming down. The market is getting quieter — daily swings shrink and price tends to chop in tighter ranges. Breakouts run less far and fake out more often, so big winners are rarer. The calmest conditions to trade.'
    + ' Here it means the VVIX momentum score is below its trailing-year median.' + MCS_CALC,
  EXPANDING:
    'Volatility is building up. Fear and uncertainty are rising and daily swings get bigger. Breakouts can run much farther (bigger wins) but also whip harder against you first (bigger drawdowns) — and losing streaks tend to bunch up here. Trade smaller and give winners room.'
    + ' Here it means the VVIX momentum score is at or above its trailing-year median.' + MCS_CALC,
  STABLE:
    'Volatility is steady — neither clearly rising nor falling. A quiet, in-between state. It is a narrow window with few days, so treat its numbers as a rough hint and lean on the Expanding/Contracting view for decisions.'
    + ' Here it means the VVIX momentum score sits in the middle 40th–60th percentile band.' + MCS_CALC,
  CONTANGO:
    'The "normal" calm setup: traders expect the next few days to be calmer than the next month, so the volatility curve slopes up. This is the market\'s usual state — about 80% of the time.'
    + TS_CALC,
  BACKWARDATION:
    'A stress signal: traders fear the next few days MORE than the next month, so the volatility curve flips (inverts). It happens about 20% of the time and is where sharp drops and crashes cluster. Handle with care — size down or stand aside.'
    + TS_CALC,
};

/** Every date the regime occurred on the chosen axis (the sessions to collect for it). */
export function regimeDates(axis: RegimeAxis, regime: string): string[] {
  return SORTED_DATES.filter((d) => VOL_REGIME[d][axis] === regime);
}

/** Regime in force for a trade on `iso`, using the PRIOR session's value (no lookahead). */
export function regimeFor(iso: string | null, axis: RegimeAxis): string {
  if (!iso) return 'UNKNOWN';
  let lo = 0, hi = SORTED_DATES.length; // first index with date >= iso
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (SORTED_DATES[mid] < iso) lo = mid + 1; else hi = mid;
  }
  if (lo === 0) return 'UNKNOWN';
  return VOL_REGIME[SORTED_DATES[lo - 1]][axis];
}

/**
 * Contiguous date windows for a regime (vol clusters, so these are multi-day runs)
 * — the "dates to collect" for building that regime's out-of-sample set. Sorted
 * longest-first. Covers the bundled regime history (2024-01-01+ by default).
 */
export function regimeWindows(axis: RegimeAxis, regime: string): { start: string; end: string; days: number }[] {
  const runs: { start: string; end: string; days: number }[] = [];
  let cur: { start: string; end: string; days: number } | null = null;
  for (const d of SORTED_DATES) {
    if (VOL_REGIME[d][axis] === regime) {
      if (cur) { cur.end = d; cur.days += 1; } else cur = { start: d, end: d, days: 1 };
    } else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.sort((a, b) => b.days - a.days);
}

/** Wilson score 95% interval for a binomial proportion (good for small n / extreme p). */
export function wilson95(wins: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 0 };
  const z = 1.959963985, p = wins / n, z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return { lo: Math.max(0, (center - margin) / denom), hi: Math.min(1, (center + margin) / denom) };
}

export interface RegimeStat {
  regime: string;
  n: number;
  wins: number;
  winRate: number;       // raw
  wilsonLo: number;
  wilsonHi: number;
  shrunkWinRate: number; // Beta-Binomial shrink toward the move's all-regime rate
  avgPct: number;        // mean per-trade result % under the sync contract
  avgMae: number;        // mean MAE % (capped)
  avgMfe: number;        // mean MFE %
  totalPnl: number | null;
  thin: boolean;         // n < MIN_TRUST → directional only
}

/** Below this, a bucket is "directional only", never a basis for parameters. */
export const MIN_TRUST = 30;
/** Beta-Binomial prior strength (pseudo-trades) pulling thin buckets to the global rate. */
export const SHRINK_K = 40;

/**
 * Per-regime breakdown of a move's derived trades on the chosen axis.
 * Regimes are returned in calm→stressed order; UNKNOWN (no regime data) is dropped.
 */
export function regimeBreakdown(derived: DerivedRow[], axis: RegimeAxis, minCashflowPct: number): RegimeStat[] {
  const globalWins = derived.filter((r) => r.isWin).length;
  const globalRate = derived.length ? globalWins / derived.length : 0;

  const byReg = new Map<string, DerivedRow[]>();
  for (const r of derived) {
    const reg = regimeFor(r.tradeDate, axis);
    if (reg === 'UNKNOWN') continue;
    const arr = byReg.get(reg);
    if (arr) arr.push(r); else byReg.set(reg, [r]);
  }

  const out: RegimeStat[] = [];
  for (const regime of REGIME_ORDER[axis]) {
    const rows = byReg.get(regime);
    if (!rows || rows.length === 0) continue;
    const n = rows.length;
    const wins = rows.filter((r) => r.isWin).length;
    const w = wilson95(wins, n);
    const priced = rows.some((r) => r.netCashflow !== null);
    out.push({
      regime,
      n,
      wins,
      winRate: wins / n,
      wilsonLo: w.lo,
      wilsonHi: w.hi,
      shrunkWinRate: (wins + SHRINK_K * globalRate) / (n + SHRINK_K),
      avgPct: rows.reduce((s, r) => s + (r.isWin ? minCashflowPct : -r.maePct), 0) / n,
      avgMae: rows.reduce((s, r) => s + r.maePct, 0) / n,
      avgMfe: rows.reduce((s, r) => s + r.mfePct, 0) / n,
      totalPnl: priced ? rows.reduce((s, r) => s + (r.netCashflow ?? 0), 0) : null,
      thin: n < MIN_TRUST,
    });
  }
  return out;
}
