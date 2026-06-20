/**
 * MAE/MFE combination + comparison engine — pure, React-free, unit-testable.
 *
 * Cross-asset combination MUST happen in DOLLAR space: each row's `netCashflow`
 * already folds in its asset's pointValueUsd (via deriveRow), so you can sum
 * netCashflow across different assets/moves. You can NOT sum percentages or
 * contracts across assets — that's the #1 correctness trap (see discovery report).
 *
 * Two combination shapes:
 *   - combineByDate(): sum same-day trades across sources → daily P&L stream.
 *     Answers "what if I took all these moves each day, netted together."
 *   - sequenceTrades(): the ordered list of individual trades across sources →
 *     the per-trade stream the portfolio-cycling engine rotates across accounts.
 */
import { ASSETS, assetCloseForDate, type AssetTicker } from './assets';
import { deriveRows, type DatasetConfig, type DerivedRow, type GunshipMove, type RawRow } from './maeMfeStats';

/** A raw source (one asset+move's bucket rows) plus the config to value it. */
export interface SourceInput {
  ticker: AssetTicker;
  move: GunshipMove;
  minCashflowPct: number;
  /** Max-MAE stop (percent). 0/undefined = no stop. Must match the move's config
   *  so Compare/Cycle value losses identically to the other labs + the dashboard. */
  maxMaePct?: number;
  defaultContracts: number;
  rows: RawRow[];
}

/** Auto-price (refPrice from daily close) + derive one source's rows to $-valued DerivedRows. */
export function deriveSource(src: SourceInput): DerivedRow[] {
  const spec = ASSETS[src.ticker];
  const priced = src.rows.map((r) => ({
    ...r,
    refPrice: r.refPrice ?? assetCloseForDate(src.ticker, r.tradeDate),
    contracts: r.contracts || src.defaultContracts,
  }));
  const cfg: DatasetConfig = {
    id: `${src.ticker}:${src.move}`,
    gunshipMove: src.move,
    sampleType: 'IN_SAMPLE',
    minCashflowPct: src.minCashflowPct,
    maxMaePct: src.maxMaePct ?? 0,
    defaultContracts: src.defaultContracts,
    pointValueUsd: spec?.pointValueUsd,
    label: null,
  };
  return deriveRows(priced, cfg);
}

export interface CombinedDay {
  tradeDate: string;
  pnl: number; // summed netCashflow ($) of all trades that day
  trades: number;
}

/**
 * Sum per-row netCashflow by trade date across all sources (dollar-space).
 * Rows without a resolvable price (null netCashflow) are skipped — they can't
 * be valued in dollars; callers should surface the skipped count.
 */
export function combineByDate(streams: DerivedRow[][]): CombinedDay[] {
  const byDate = new Map<string, { pnl: number; trades: number }>();
  for (const stream of streams) {
    for (const r of stream) {
      if (!r.tradeDate || r.netCashflow == null) continue;
      const cur = byDate.get(r.tradeDate) ?? { pnl: 0, trades: 0 };
      cur.pnl += r.netCashflow;
      cur.trades += 1;
      byDate.set(r.tradeDate, cur);
    }
  }
  return [...byDate.entries()]
    .map(([tradeDate, v]) => ({ tradeDate, pnl: v.pnl, trades: v.trades }))
    .sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0));
}

/** Count rows that couldn't be priced (so the UI can warn about excluded trades). */
export function countUnpriced(streams: DerivedRow[][]): number {
  let n = 0;
  for (const stream of streams) for (const r of stream) if (r.netCashflow == null) n++;
  return n;
}

export interface StreamStats {
  totalPnl: number;
  days: number;
  trades: number;
  winDays: number;
  winRateByDay: number | null; // fraction of days with combined P&L > 0
  avgDay: number | null;
  bestDay: number | null;
  worstDay: number | null;
  maxDrawdown: number; // ≤ 0: deepest equity dip below its running peak
  finalEquity: number;
  equityCurve: { tradeDate: string; equity: number }[];
}

/** Equity-curve stats over a daily P&L stream (already sorted by date). */
export function streamStats(days: CombinedDay[]): StreamStats {
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  let winDays = 0;
  let trades = 0;
  let best: number | null = null;
  let worst: number | null = null;
  const equityCurve: { tradeDate: string; equity: number }[] = [];
  for (const d of days) {
    equity += d.pnl;
    trades += d.trades;
    if (d.pnl > 0) winDays++;
    best = best === null ? d.pnl : Math.max(best, d.pnl);
    worst = worst === null ? d.pnl : Math.min(worst, d.pnl);
    peak = Math.max(peak, equity);
    maxDD = Math.min(maxDD, equity - peak);
    equityCurve.push({ tradeDate: d.tradeDate, equity });
  }
  const n = days.length;
  return {
    totalPnl: equity,
    days: n,
    trades,
    winDays,
    winRateByDay: n ? winDays / n : null,
    avgDay: n ? equity / n : null,
    bestDay: best,
    worstDay: worst,
    maxDrawdown: maxDD,
    finalEquity: equity,
    equityCurve,
  };
}

/** Convenience: derive all sources, combine by date, and compute stats. */
export function combinedStats(sources: SourceInput[]): { stats: StreamStats; days: CombinedDay[]; unpriced: number } {
  const streams = sources.map(deriveSource);
  const days = combineByDate(streams);
  return { stats: streamStats(days), days, unpriced: countUnpriced(streams) };
}

// =============================================================================
// Portfolio cycling — distribute a per-trade P&L stream across N accounts
// =============================================================================

export interface TradeInStream {
  tradeDate: string;
  pnl: number;
}

/**
 * Flatten sources into the ORDERED per-trade P&L sequence the cycling engine
 * rotates across accounts: sorted by trade date, then by the order sources were
 * given (so e.g. 0300 before 1800 within a day if listed that way), then rowIndex.
 * Unlike combineByDate this keeps each trade SEPARATE (no same-day netting).
 */
export function sequenceTrades(streams: DerivedRow[][]): TradeInStream[] {
  const out: { tradeDate: string; pnl: number; src: number; rowIndex: number }[] = [];
  streams.forEach((stream, src) => {
    for (const r of stream) {
      if (!r.tradeDate || r.netCashflow == null) continue;
      out.push({ tradeDate: r.tradeDate, pnl: r.netCashflow, src, rowIndex: r.rowIndex });
    }
  });
  out.sort((a, b) =>
    a.tradeDate < b.tradeDate ? -1
      : a.tradeDate > b.tradeDate ? 1
        : a.src !== b.src ? a.src - b.src
          : a.rowIndex - b.rowIndex,
  );
  return out.map(({ tradeDate, pnl }) => ({ tradeDate, pnl }));
}

export interface CycleAccount {
  account: number; // 1-based
  net: number;
  peak: number;
  maxDrawdown: number; // ≤ 0
}

export interface CycleResult {
  accounts: CycleAccount[];
  totalPnl: number; // = firePerTrade × stream total
  best: CycleAccount | null;
  worst: CycleAccount | null;
  numAccounts: number;
  firePerTrade: number;
}

/**
 * Distribute an ordered P&L stream across N accounts by GAP ROTATION: trade `i`
 * fires `k` consecutive accounts starting at (k·i) mod N, each taking the FULL
 * trade P&L (running k accounts at once = k× position size). Tracks per-account
 * running peak + trailing max drawdown.
 *
 * Reproduces the owner's cycling spreadsheet exactly (verified against its
 * summary nets): (N=5, k=1) = "4-gap, 1×"; (N=5, k=2) = "1.5-gap, 2×".
 * gap = N/k − 1.
 */
export function distributeByGapRotation(pnls: number[], numAccounts: number, firePerTrade: number): CycleResult {
  const N = Math.max(1, Math.floor(numAccounts));
  const k = Math.max(1, Math.min(N, Math.floor(firePerTrade)));
  const bal = new Array<number>(N).fill(0);
  const peak = new Array<number>(N).fill(0);
  const dd = new Array<number>(N).fill(0);
  for (let i = 0; i < pnls.length; i++) {
    for (let j = 0; j < k; j++) {
      const idx = (k * i + j) % N;
      bal[idx] += pnls[i];
      if (bal[idx] > peak[idx]) peak[idx] = bal[idx];
      const drop = bal[idx] - peak[idx];
      if (drop < dd[idx]) dd[idx] = drop;
    }
  }
  const accounts: CycleAccount[] = bal.map((net, i) => ({ account: i + 1, net, peak: peak[i], maxDrawdown: dd[i] }));
  let best: CycleAccount | null = null;
  let worst: CycleAccount | null = null;
  for (const acct of accounts) {
    if (best === null || acct.net > best.net) best = acct;
    if (worst === null || acct.net < worst.net) worst = acct;
  }
  return { accounts, totalPnl: bal.reduce((s, x) => s + x, 0), best, worst, numAccounts: N, firePerTrade: k };
}
