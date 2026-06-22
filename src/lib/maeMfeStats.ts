/**
 * MAE/MFE Analysis — pure stats engine.
 *
 * Replicates every formula in `MAE _ MFE Analysis.xlsx` (Sample/1800/0300/OOS).
 * No React, no API. Inputs in, computed dashboard out.
 *
 * MNQ contract math (CME-fixed):
 *   tick size: 0.25 points | tick value: $0.50 → $2.00 per point per contract
 *   $ per 0.01% move per contract  =  refPrice × 0.0001 × $2  =  refPrice × $0.0002
 *
 * MAE/MFE are stored as PERCENT (matching the XLSX). `0.05` = 0.05% = 5 basis points.
 */

// =============================================================================
// Types
// =============================================================================

import type { BuiltinMove } from './moveRegistry';

// Built-in moves keep autocomplete; `(string & {})` widens the union to accept
// custom user-defined move ids (Phase 2) without collapsing it to plain `string`.
export type GunshipMove = BuiltinMove | (string & {});
export type SampleType = 'IN_SAMPLE' | 'OUT_OF_SAMPLE';

/** What the student enters per trade. */
export interface RawRow {
  rowIndex: number;
  tradeDate: string | null;   // YYYY-MM-DD
  maePct: number;             // 0.05 = 0.05% = 5 bps
  mfePct: number;
  contracts: number;
  refPrice: number | null;    // pulled from Yahoo NQ=F daily close server-side later
  notes?: string | null;
}

export interface DatasetConfig {
  id: string;
  gunshipMove: GunshipMove;
  sampleType: SampleType;
  minCashflowPct: number;     // 0.05 = 0.05% target
  defaultContracts: number;
  maxMaePct?: number;         // stop: 0.30 = 0.30%. 0/undefined = no stop.
  label?: string | null;
  /** USD per 1.0 price point per contract. Defaults to MNQ ($2) when omitted. */
  pointValueUsd?: number;
}

export interface DatasetInput extends DatasetConfig {
  rows: RawRow[];
}

/** Derived per-row, returned to the UI for the row table. */
export interface DerivedRow {
  rowIndex: number;
  tradeDate: string | null;
  maePct: number;
  mfePct: number;
  contracts: number;
  refPrice: number | null;
  // Derived
  isWin: boolean;
  isStopped?: boolean;                      // true when Max-MAE stop capped this trade
  dollarPerBpPerContract: number | null;   // refPrice × $0.0002
  dollarMAE: number | null;                // negative number
  dollarMFE: number | null;                // positive
  netCashflow: number | null;              // +winCashflow or -dollarMAE
  winStreak: number | null;                // running streak counter; null on losses
}

// =============================================================================
// Constants — CME MNQ contract spec
// =============================================================================

export const MNQ_POINT_VALUE_USD = 2.0;            // $ per index point per contract
export const MNQ_TICK_SIZE_POINTS = 0.25;
export const MNQ_TICK_VALUE_USD = 0.5;

/** Thresholds the XLSX dashboard reports on. */
export const MFE_THRESHOLDS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75] as const;
export const MAE_THRESHOLDS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75] as const;

// =============================================================================
// Helpers — basic stats (used by the dashboard)
// =============================================================================

function nonNull<T>(xs: Array<T | null | undefined>): T[] {
  return xs.filter((x): x is T => x !== null && x !== undefined);
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function avg(xs: number[]): number | null {
  return xs.length === 0 ? null : sum(xs) / xs.length;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Excel-style MODE: most-frequent value. Ties go to the first encountered.
 * Excel returns #N/A if all values are unique; we mirror by returning null.
 */
function mode(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best = null as number | null;
  let bestCount = 1;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

/**
 * Excel PERCENTILE.INC — linear interpolation, inclusive endpoints.
 * Used for the 70th/30th-percentile cells in the XLSX (I7, K7).
 */
function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const s = [...xs].sort((a, b) => a - b);
  const rank = p * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return s[lo];
  return s[lo] + (rank - lo) * (s[hi] - s[lo]);
}

/**
 * Mirrors Excel COUNTIF(range, ">x"). The XLSX uses thresholds like ">0.049"
 * and ">0.0499" to approximate "≥ 0.05" — we just do strict >.
 */
function countGreaterThan(xs: number[], threshold: number): number {
  let n = 0;
  for (const x of xs) if (x > threshold) n++;
  return n;
}

// =============================================================================
// Per-row computation — mirrors columns D/E/F of every data sheet
// =============================================================================

/**
 * $ value of a percent move on MNQ for a given ref price and contract count.
 *
 *   dollars = pct% × refPrice × $0.0002 × contracts
 *           = (pct / 100) × refPrice × $2 × contracts
 *
 * NOTE: `pct` is the spreadsheet convention (0.05 = 0.05%, not 5%).
 *       Divide by 100 to convert to a true decimal multiplier.
 */
/**
 * $ value of a percent move for a given ref price, contract count, and the
 * asset's point value (USD per 1.0 price point per contract).
 *
 *   dollars = (pct / 100) × refPrice × pointValue × contracts
 */
export function pctToDollars(
  pct: number,
  refPrice: number | null,
  contracts: number,
  pointValueUsd: number,
): number | null {
  if (refPrice === null || !Number.isFinite(refPrice)) return null;
  return (pct / 100) * refPrice * pointValueUsd * contracts;
}

/** MNQ-specialized helper (kept for back-compat / tests). */
export function pctToDollarsMNQ(
  pct: number,
  refPrice: number | null,
  contracts: number,
): number | null {
  return pctToDollars(pct, refPrice, contracts, MNQ_POINT_VALUE_USD);
}

export function deriveRow(row: RawRow, ds: DatasetConfig): DerivedRow {
  const { mfePct, contracts, refPrice } = row;
  const pv = ds.pointValueUsd ?? MNQ_POINT_VALUE_USD;

  // Max-MAE stop (the MAE mirror of minCashflow). It does NOT cancel wins: a
  // trade that reached the cashflow target IS a win — the target was hit before
  // invalidation, so you'd already be out. The stop only protects LOSERS: a
  // losing trade whose MAE exceeded the stop has its loss (and MAE) capped there
  // — you can't lose more than Max MAE.
  const maxMae = ds.maxMaePct ?? 0;
  const isWin = mfePct >= ds.minCashflowPct;
  const stopped = !isWin && maxMae > 0 && row.maePct > maxMae;
  const maePct = stopped ? maxMae : row.maePct;          // cap MAE only for stopped losers

  const dollarPerBp = refPrice !== null ? refPrice * 0.0001 * pv : null;

  const dollarMAE = pctToDollars(maePct, refPrice, contracts, pv);     // ≥ 0
  const dollarMFE = pctToDollars(mfePct, refPrice, contracts, pv);     // ≥ 0
  const winCashflow = pctToDollars(ds.minCashflowPct, refPrice, contracts, pv);

  let netCashflow: number | null = null;
  if (refPrice !== null) {
    netCashflow = isWin
      ? (winCashflow ?? 0)
      : -(dollarMAE ?? 0);
  }

  return {
    rowIndex: row.rowIndex,
    tradeDate: row.tradeDate,
    maePct,
    mfePct,
    contracts,
    refPrice,
    isWin,
    isStopped: stopped,
    dollarPerBpPerContract: dollarPerBp,
    dollarMAE: dollarMAE === null ? null : -Math.abs(dollarMAE),
    dollarMFE,
    netCashflow,
    winStreak: null, // filled in by deriveRows() — needs run-context
  };
}

/**
 * Compute win-streak counter column. XLSX puts the streak LENGTH on the LAST
 * bar of each winning run (F9 = 8 for the run from rows 2-9), null otherwise.
 * We replicate that exactly.
 */
export function deriveRows(rows: RawRow[], ds: DatasetConfig): DerivedRow[] {
  const out = rows.map((r) => deriveRow(r, ds));

  let runStart = -1;
  for (let i = 0; i < out.length; i++) {
    if (out[i].isWin) {
      if (runStart < 0) runStart = i;
      const isLast = i === out.length - 1 || !out[i + 1].isWin;
      if (isLast) {
        out[i].winStreak = i - runStart + 1;
        runStart = -1;
      }
    } else {
      runStart = -1;
    }
  }
  return out;
}

// =============================================================================
// Multi-attempt-per-day filter — group rows by trade date, count N attempts
// =============================================================================

/**
 * Which same-day attempts to count.
 *   all        → every trade
 *   first n    → the first n attempts each day (1 = take one entry, 2 = both, …)
 *   only n     → ONLY the nth attempt each day (e.g. just the 2nd re-entry)
 */
export type AttemptMode =
  | { kind: 'all' }
  | { kind: 'first'; n: number }
  | { kind: 'only'; n: number };

/**
 * Filter rows to the chosen same-day attempts. Attempts are ordered within a day
 * by rowIndex (insertion order), so the 1st row of a date is attempt 1, etc.
 * Preserves overall chronological order; never mutates the input.
 */
export function applyAttemptFilter(rows: RawRow[], mode: AttemptMode): RawRow[] {
  if (mode.kind === 'all') return rows;
  const byDay = new Map<string, RawRow[]>();
  const order: string[] = [];
  for (const r of rows) {
    const key = r.tradeDate ?? '';
    if (!byDay.has(key)) {
      byDay.set(key, []);
      order.push(key);
    }
    byDay.get(key)!.push(r);
  }
  const out: RawRow[] = [];
  for (const key of order) {
    const day = [...byDay.get(key)!].sort((a, b) => a.rowIndex - b.rowIndex);
    if (mode.kind === 'first') {
      out.push(...day.slice(0, Math.max(0, mode.n)));
    } else {
      const r = day[mode.n - 1];
      if (r) out.push(r);
    }
  }
  return out;
}

// =============================================================================
// Dashboard (right-hand panel of every XLSX sheet)
// =============================================================================

export interface RiskMovementStats {
  average: number | null;     // I5: AVERAGE(B:B)
  median: number | null;      // I6: MEDIAN(B:B)
  percentile70: number | null;// I7: PERCENTILE(B:B, 0.7)
}

export interface ProfitMovementStats {
  average: number | null;     // K5: AVERAGE(C:C)
  median: number | null;      // K6: MEDIAN(C:C)
  percentile30: number | null;// K7: PERCENTILE(C:C, 0.3)
}

export interface ThresholdBucket {
  thresholdPct: number;       // e.g. 0.05
  count: number;              // COUNTIF
}

export interface ContractSizeRow {
  thresholdPct: number;
  dollarValue: number | null; // negative for loss table, positive for wins
}

export interface MfeStrikeRateRow {
  thresholdPct: number;
  count: number;              // K10..K15
  strikeRate: number | null;  // N4..N9 = K[i]/N3
  lossRate: number | null;    // O4..O9 = 1 - strikeRate
  winCashflow: number | null; // P4..P9 = contract size win at that threshold
}

export interface MaeLossRateRow {
  thresholdPct: number;
  count: number;              // I10..I15
  lossRate: number | null;    // N10..N15 = I[i]/N3
}

export interface DistStats {
  median: number | null;
  mode: number | null;
  average: number | null;
  key: number | null;         // MEDIAN(median, mode, average)
}

/** 6×6 EV matrix — XLSX I27:N31 (5 rows actually; 6th implied) */
export interface EvMatrix {
  mfeThresholds: number[];    // rows
  maeThresholds: number[];    // cols
  values: (number | null)[][]; // [mfeIdx][maeIdx]
}

export interface DatasetDashboard {
  totalSamples: number;               // N3
  risk: RiskMovementStats;
  profit: ProfitMovementStats;
  riskVariances: ThresholdBucket[];   // I10..I15 (MAE > threshold counts)
  profitMeasurements: ThresholdBucket[]; // K10..K15
  potentialPnl: (number | null)[];    // L10..L15 = profit count × win cashflow
  contractSizeLoss: ContractSizeRow[];// H17..I22
  contractSizeWins: ContractSizeRow[];// J17..K22
  mfeStrikeRates: MfeStrikeRateRow[]; // M4..P9 + the loss column
  maeLossRates: MaeLossRateRow[];     // M10..N15
  snapshot: {
    totalPnl: number;                 // N17
    winStreakAvg: number | null;      // N18
    lossSeries: { thresholdPct: number; lossDollars: number | null }[]; // N19..N24
  };
  cashflowEv: {
    highProb: number | null;          // P11 = MIN of EV matrix
    mediumProb: number | null;        // P12 = MEDIAN
    highEv: number | null;            // P13 = MAX
  };
  mfeAnalysis: DistStats;             // P15..P18
  maeAnalysis: DistStats;             // P20..P23
  evMatrix: EvMatrix;                 // I27:N31
  timeAnchor: {
    firstDate: string | null;
    lastDate: string | null;
    days: number | null;
    months: number | null;
  };
  netCashflow: number;                // I78 = SUM(E:E)
  dayOfWeek: DowStat[];               // per-weekday breakdown at this move's win/stop rule
}

/** How a move + its Min Cashflow / Max MAE rule plays out on each weekday. */
export interface DowStat {
  dow: number;             // 0=Sun … 6=Sat
  label: string;           // 'Mon' …
  n: number;               // trades on this weekday
  wins: number;
  winRate: number;         // 0..1
  avgPct: number;          // mean per-trade result % under the sync contract (+minCf win / −MAE loss)
  totalPnl: number | null; // sum of netCashflow $ (null when no priced rows)
}

// =============================================================================
// Dashboard computation
// =============================================================================

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Weekday (0=Sun..6=Sat) for an ISO date, read at noon UTC (matches tradingCalendar). */
function dowOf(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

/**
 * Group derived trades by weekday and summarize how the move + its Min Cashflow /
 * Max MAE rule played out each day. Multi-attempt rows count individually (each is
 * a trade). Weekdays with no trades are omitted.
 */
export function dayOfWeekBreakdown(derived: DerivedRow[], minCashflowPct: number): DowStat[] {
  const byDow = new Map<number, DerivedRow[]>();
  for (const r of derived) {
    const w = dowOf(r.tradeDate);
    if (w === null) continue;
    const arr = byDow.get(w);
    if (arr) arr.push(r); else byDow.set(w, [r]);
  }
  const out: DowStat[] = [];
  for (let w = 0; w <= 6; w++) {
    const rows = byDow.get(w);
    if (!rows || rows.length === 0) continue;
    const n = rows.length;
    const wins = rows.filter((r) => r.isWin).length;
    const avgPct = rows.reduce((s, r) => s + (r.isWin ? minCashflowPct : -r.maePct), 0) / n;
    const priced = rows.some((r) => r.netCashflow !== null);
    const totalPnl = priced ? rows.reduce((s, r) => s + (r.netCashflow ?? 0), 0) : null;
    out.push({ dow: w, label: DOW_LABELS[w], n, wins, winRate: wins / n, avgPct, totalPnl });
  }
  return out;
}

export function computeDatasetDashboard(
  rows: RawRow[],
  ds: DatasetConfig,
): DatasetDashboard {
  const derived = deriveRows(rows, ds);
  const maes = derived.map((d) => d.maePct);
  const mfes = derived.map((d) => d.mfePct);
  const totalSamples = derived.length;

  // ── Risk Movements (B-column stats) ────────────────────────────────────────
  const risk: RiskMovementStats = {
    average: avg(maes),
    median: median(maes),
    percentile70: percentile(maes, 0.7),
  };

  // ── Profit Measurements (C-column stats) ───────────────────────────────────
  const profit: ProfitMovementStats = {
    average: avg(mfes),
    median: median(mfes),
    percentile30: percentile(mfes, 0.3),
  };

  // ── Risk Variances I10:I15 — COUNTIF(B:B, ">0.29" … ">0.05") ──────────────
  // XLSX uses ">0.29" to approximate ">=0.30"; we just go strict `>`.
  // Spreadsheet order is descending (0.30 → 0.05); we keep the same ordering
  // in the array so cell index maps cleanly.
  const riskVariances: ThresholdBucket[] = [...MAE_THRESHOLDS]
    .reverse()
    .map((t) => ({
      thresholdPct: t,
      count: countGreaterThan(maes, t - 0.01),
    }));

  // ── Profit Measurements K10:K15 — COUNTIF(C:C, ">0.049" … ">0.299") ───────
  const profitMeasurements: ThresholdBucket[] = [...MFE_THRESHOLDS].map((t) => ({
    thresholdPct: t,
    count: countGreaterThan(mfes, t - 0.001),
  }));

  // ── Contract Size Loss/Wins tables (XLSX H17:I22 / J17:K22) ───────────────
  // The XLSX hardcoded illustrative dollar values; we derive them properly
  // from the asset's contract math using the dataset's representative ref price
  // (median of non-null refPrices, or the most recent).
  const pv = ds.pointValueUsd ?? MNQ_POINT_VALUE_USD;
  const refPrices = nonNull(derived.map((d) => d.refPrice));
  const representativeRef = median(refPrices) ?? refPrices[refPrices.length - 1] ?? null;
  const contractSizeLoss: ContractSizeRow[] = [...MAE_THRESHOLDS]
    .reverse()
    .map((t) => ({
      thresholdPct: t,
      dollarValue:
        representativeRef === null
          ? null
          : -Math.abs(pctToDollars(t, representativeRef, ds.defaultContracts, pv) ?? 0),
    }));
  const contractSizeWins: ContractSizeRow[] = [...MFE_THRESHOLDS].map((t) => ({
    thresholdPct: t,
    dollarValue:
      representativeRef === null
        ? null
        : pctToDollars(t, representativeRef, ds.defaultContracts, pv),
  }));

  // ── L10:L15 Potential PNL — count × win-cashflow at threshold ─────────────
  const potentialPnl: (number | null)[] = profitMeasurements.map((p, i) => {
    const winDollars = contractSizeWins[i]?.dollarValue ?? null;
    return winDollars === null ? null : p.count * winDollars;
  });

  // ── MFE Strike Rates (M4:P9) + MAE Loss Rates (M10:N15) ───────────────────
  const mfeStrikeRates: MfeStrikeRateRow[] = profitMeasurements.map((p, i) => {
    const strikeRate = totalSamples ? p.count / totalSamples : null;
    return {
      thresholdPct: p.thresholdPct,
      count: p.count,
      strikeRate,
      lossRate: strikeRate === null ? null : 1 - strikeRate,
      winCashflow: contractSizeWins[i]?.dollarValue ?? null,
    };
  });
  const maeLossRates: MaeLossRateRow[] = riskVariances.map((r) => ({
    thresholdPct: r.thresholdPct,
    count: r.count,
    lossRate: totalSamples ? r.count / totalSamples : null,
  }));

  // ── Snapshot ──────────────────────────────────────────────────────────────
  const netCashflows = nonNull(derived.map((d) => d.netCashflow));
  const totalPnl = sum(netCashflows);
  const streaks = nonNull(derived.map((d) => d.winStreak));
  const winStreakAvg = streaks.length ? avg(streaks) : null;

  // N19..N24 — Loss series: count(MAE > t) × loss-$ at t
  // XLSX uses I10*I17 → riskVariances[0].count × contractSizeLoss[0].$
  const lossSeries = riskVariances.map((r, i) => ({
    thresholdPct: r.thresholdPct,
    lossDollars:
      contractSizeLoss[i]?.dollarValue === null
        ? null
        : r.count * (contractSizeLoss[i].dollarValue ?? 0),
  }));

  // ── EV Risk Matrix (6×6) ──────────────────────────────────────────────────
  // For each (MFE threshold, MAE threshold):
  //   ev = (strikeRate × win$) − (lossRate × loss$|)
  // The XLSX shows a 5×6 grid (rows for MFE 0.05–0.25) — we extend to 6×6.
  const evValues: (number | null)[][] = mfeStrikeRates.map((mfe) =>
    maeLossRates.map((mae) => {
      if (mfe.strikeRate === null || mae.lossRate === null) return null;
      const winDollars = mfe.winCashflow ?? 0;
      const loss = contractSizeLoss.find((c) => c.thresholdPct === mae.thresholdPct);
      const lossDollars = Math.abs(loss?.dollarValue ?? 0);
      return mfe.strikeRate * winDollars - mae.lossRate * lossDollars;
    }),
  );
  const evMatrix: EvMatrix = {
    mfeThresholds: [...MFE_THRESHOLDS],
    maeThresholds: [...MAE_THRESHOLDS].reverse(),
    values: evValues,
  };

  // ── Cashflow EVs (P11..P13) ───────────────────────────────────────────────
  const flatEv = evValues.flat().filter((v): v is number => v !== null);
  const cashflowEv = {
    highProb: flatEv.length ? Math.min(...flatEv) : null,
    mediumProb: median(flatEv),
    highEv: flatEv.length ? Math.max(...flatEv) : null,
  };

  // ── MFE / MAE Analysis (P15..P23) ─────────────────────────────────────────
  const mfeMedian = median(mfes);
  const mfeMode = mode(mfes);
  const mfeAvg = avg(mfes);
  const mfeKey = median(
    nonNull([mfeMedian, mfeMode, mfeAvg]) as number[],
  );
  const maeMedian = median(maes);
  const maeMode = mode(maes);
  const maeAvg = avg(maes);
  const maeKey = median(
    nonNull([maeMedian, maeMode, maeAvg]) as number[],
  );
  const mfeAnalysis: DistStats = {
    median: mfeMedian, mode: mfeMode, average: mfeAvg, key: mfeKey,
  };
  const maeAnalysis: DistStats = {
    median: maeMedian, mode: maeMode, average: maeAvg, key: maeKey,
  };

  // ── Time Anchor (G78 / H78) ───────────────────────────────────────────────
  const dates = nonNull(derived.map((d) => d.tradeDate))
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  const firstDate = dates[0]?.toISOString().slice(0, 10) ?? null;
  const lastDate = dates[dates.length - 1]?.toISOString().slice(0, 10) ?? null;
  const days = dates.length >= 2
    ? Math.round((dates[dates.length - 1].getTime() - dates[0].getTime()) / 86400000)
    : null;
  const months = days === null ? null : Math.round((days / 30.4375) * 10) / 10;

  return {
    totalSamples,
    risk,
    profit,
    riskVariances,
    profitMeasurements,
    potentialPnl,
    contractSizeLoss,
    contractSizeWins,
    mfeStrikeRates,
    maeLossRates,
    snapshot: { totalPnl, winStreakAvg, lossSeries },
    cashflowEv,
    mfeAnalysis,
    maeAnalysis,
    evMatrix,
    timeAnchor: { firstDate, lastDate, days, months },
    netCashflow: totalPnl,
    dayOfWeek: dayOfWeekBreakdown(derived, ds.minCashflowPct),
  };
}

// =============================================================================
// Assignment-level cross-comparison (unlocked at ≥1 IS + ≥3 OOS)
// =============================================================================

export interface CrossComparisonGate {
  inSampleCount: number;
  outOfSampleCount: number;
  unlocked: boolean;
}

export interface MoveComparison {
  gunshipMove: GunshipMove;
  inSample: DatasetDashboard | null;
  outOfSamples: DatasetDashboard[];
  strikeRateDeltaPct: number | null; // OOS_avg − IS at the dataset's minCashflow
  evDeltaDollars: number | null;     // OOS_avg medium-prob EV − IS
  divergent: boolean;                // |delta| > 0.1 (10pp)
}

export interface CrossComparison {
  gate: CrossComparisonGate;
  moveComparisons: MoveComparison[];
  rankedByEv: { gunshipMove: GunshipMove; mediumProbEv: number | null }[];
}

export function computeCrossComparison(
  datasets: DatasetInput[],
): CrossComparison {
  const dashboards = datasets.map((d) => ({
    config: d,
    dashboard: computeDatasetDashboard(d.rows, d),
  }));

  const inSampleCount = datasets.filter((d) => d.sampleType === 'IN_SAMPLE').length;
  const outOfSampleCount = datasets.filter((d) => d.sampleType === 'OUT_OF_SAMPLE').length;
  const unlocked = inSampleCount >= 1 && outOfSampleCount >= 3;
  const gate: CrossComparisonGate = { inSampleCount, outOfSampleCount, unlocked };

  // Group by gunship move and compute IS-vs-OOS deltas.
  const byMove = new Map<GunshipMove, typeof dashboards>();
  for (const x of dashboards) {
    const arr = byMove.get(x.config.gunshipMove) ?? [];
    arr.push(x);
    byMove.set(x.config.gunshipMove, arr);
  }

  const moveComparisons: MoveComparison[] = [];
  for (const [move, group] of byMove) {
    const inSampleDash = group.find((g) => g.config.sampleType === 'IN_SAMPLE');
    const oosDashes = group.filter((g) => g.config.sampleType === 'OUT_OF_SAMPLE');

    // Use the IS dataset's minCashflow threshold for a like-for-like compare.
    const threshold = inSampleDash?.config.minCashflowPct ?? oosDashes[0]?.config.minCashflowPct;
    const isStrike = inSampleDash
      ? (inSampleDash.dashboard.mfeStrikeRates.find((r) =>
          near(r.thresholdPct, threshold!),
        )?.strikeRate ?? null)
      : null;
    const oosStrikes = nonNull(
      oosDashes.map(
        (g) =>
          g.dashboard.mfeStrikeRates.find((r) => near(r.thresholdPct, threshold!))
            ?.strikeRate ?? null,
      ),
    );
    const oosStrikeAvg = oosStrikes.length ? avg(oosStrikes) : null;
    const strikeRateDeltaPct =
      isStrike !== null && oosStrikeAvg !== null ? oosStrikeAvg - isStrike : null;

    const isEv = inSampleDash?.dashboard.cashflowEv.mediumProb ?? null;
    const oosEv = avg(nonNull(oosDashes.map((g) => g.dashboard.cashflowEv.mediumProb)));
    const evDeltaDollars = isEv !== null && oosEv !== null ? oosEv - isEv : null;

    const divergent =
      strikeRateDeltaPct !== null && Math.abs(strikeRateDeltaPct) > 0.1;

    moveComparisons.push({
      gunshipMove: move,
      inSample: inSampleDash?.dashboard ?? null,
      outOfSamples: oosDashes.map((g) => g.dashboard),
      strikeRateDeltaPct,
      evDeltaDollars,
      divergent,
    });
  }

  const rankedByEv = moveComparisons
    .map((m) => {
      const evs = nonNull([
        m.inSample?.cashflowEv.mediumProb ?? null,
        ...m.outOfSamples.map((d) => d.cashflowEv.mediumProb),
      ]);
      return { gunshipMove: m.gunshipMove, mediumProbEv: avg(evs) };
    })
    .sort((a, b) => (b.mediumProbEv ?? -Infinity) - (a.mediumProbEv ?? -Infinity));

  return { gate, moveComparisons, rankedByEv };
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}
