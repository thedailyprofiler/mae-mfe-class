/**
 * Cross-move correlation engine.
 *
 * SYNC CONTRACT: each move's daily return is derived with the SAME win/stop
 * logic as deriveRow (maeMfeStats) — win (MFE ≥ Min Cashflow) banks +minCashflow,
 * else a loss of −(MAE, capped at Max MAE). It's expressed in PERCENT (scale-free,
 * needs no ref price → works for every asset incl. RTY), and correlation is
 * scale-invariant, so the coefficients match what the dashboard's win/EV reflect.
 *
 * Lenses mirror QuantDash Pro's Correlation tab:
 *   pearson    — linear corr of daily returns
 *   spearman   — rank corr (robust to outliers)
 *   downside   — corr on losing days only
 *   drawdown   — corr of underwater (drawdown) curves
 *   codrawdown — fraction of days BOTH are in drawdown (a %, not a coefficient)
 *   tail       — overlap of each series' worst-10% drawdown days
 */
import type { MaeMfeDocument } from '../components/assignments/mae-mfe/maeMfeDocument';
import type { MoveState } from '../components/assignments/mae-mfe/MoveDashboard';
import { resolveStudy, DEFAULT_STUDY } from '../components/assignments/mae-mfe/maeMfeDocument';
import { applyAttemptFilter } from './maeMfeStats';
import { ASSET_ORDER, type AssetTicker } from './assets';

export type Lens = 'pearson' | 'spearman' | 'downside' | 'drawdown' | 'codrawdown' | 'tail';

export interface Series {
  key: string;        // asset::move
  label: string;      // display
  daily: Map<string, number>; // tradeDate -> daily return % (settings-synced)
}

/** One move's daily return %, summed per trade date (multi-attempt days add up). */
export function moveDailyReturns(ms: MoveState): Map<string, number> {
  const minCf = ms.minCashflowPct;
  const maxMae = ms.maxMaePct ?? 0;
  const study = resolveStudy(ms, DEFAULT_STUDY);
  const rows = applyAttemptFilter([...study.inSample.rows, ...study.oos1.rows, ...study.oos2.rows, ...study.oos3.rows], ms.attemptMode ?? { kind: 'all' });
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.tradeDate) continue;
    const isWin = r.mfePct >= minCf;
    const stopped = !isWin && maxMae > 0 && r.maePct > maxMae;
    const ret = isWin ? minCf : -(stopped ? maxMae : r.maePct);
    out.set(r.tradeDate, (out.get(r.tradeDate) ?? 0) + ret);
  }
  return out;
}

/** Collect every populated (asset, move) as a labelled daily series. */
export function buildSeries(
  doc: MaeMfeDocument,
  moveLabel: (move: string) => string,
): Series[] {
  const out: Series[] = [];
  for (const a of ASSET_ORDER) {
    const state = doc[a as AssetTicker];
    if (!state) continue;
    for (const move of Object.keys(state)) {
      const daily = moveDailyReturns(state[move]);
      if (daily.size === 0) continue;
      out.push({ key: `${a}::${move}`, label: `${a} ${moveLabel(move)}`, daily });
    }
  }
  return out;
}

// ---- math helpers ----
function mean(xs: number[]): number { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0; }
function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}
function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]);
  const r = new Array(xs.length).fill(0);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++;
    const avg = (i + j - 1) / 2 + 1; // average rank for ties (1-based)
    for (let k = i; k < j; k++) r[idx[k][1]] = avg;
    i = j;
  }
  return r;
}
/** Aligned values on shared dates of two series. */
function align(a: Series, b: Series): { da: number[]; db: number[]; dates: string[] } {
  const da: number[] = [], db: number[] = [], dates: string[] = [];
  for (const [d, va] of a.daily) {
    if (b.daily.has(d)) { da.push(va); db.push(b.daily.get(d)!); dates.push(d); }
  }
  return { da, db, dates };
}
/** Underwater drawdown series from a daily-return array (equity = cumulative, dd = equity − runningMax). */
function drawdownSeries(rets: number[]): number[] {
  let eq = 0, peak = 0; const dd: number[] = [];
  for (const r of rets) { eq += r; if (eq > peak) peak = eq; dd.push(eq - peak); }
  return dd;
}

/** One pairwise value for a lens (0..1 for codrawdown/tail; −1..1 for the corrs). */
export function pairValue(a: Series, b: Series, lens: Lens): number {
  const { da, db } = align(a, b);
  if (da.length < 2) return 0;
  switch (lens) {
    case 'pearson': return pearson(da, db);
    case 'spearman': return pearson(ranks(da), ranks(db));
    case 'downside': {
      const xa: number[] = [], xb: number[] = [];
      for (let i = 0; i < da.length; i++) if (da[i] < 0 || db[i] < 0) { xa.push(da[i]); xb.push(db[i]); }
      return pearson(xa, xb);
    }
    case 'drawdown': return pearson(drawdownSeries(da), drawdownSeries(db));
    case 'codrawdown': {
      const ddA = drawdownSeries(da), ddB = drawdownSeries(db);
      let both = 0; for (let i = 0; i < ddA.length; i++) if (ddA[i] < 0 && ddB[i] < 0) both++;
      return ddA.length ? both / ddA.length : 0;
    }
    case 'tail': {
      const ddA = drawdownSeries(da), ddB = drawdownSeries(db);
      const k = Math.max(1, Math.round(da.length * 0.1));
      const worst = (dd: number[]) => new Set(dd.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0]).slice(0, k).map(p => p[1]));
      const wa = worst(ddA), wb = worst(ddB);
      let inter = 0; for (const i of wa) if (wb.has(i)) inter++;
      const union = wa.size + wb.size - inter;
      return union ? inter / union : 0; // Jaccard overlap of worst-10% days
    }
  }
}

/**
 * Strategy-family key for a series key (`ASSET::MOVE`): same asset + same base
 * move, with the entry/attempt suffix (MA/FR/PB) stripped. Used to drop
 * trivially-redundant within-setup pairs (e.g. "MES 1800" vs "MES 1800 Multiple
 * Attempt") from rankings and to stop one asset's variants from stacking.
 */
export function familyKey(seriesKey: string): string {
  const [asset, move = ''] = seriesKey.split('::');
  return `${asset}::${move.replace(/(MA|FR|PB)$/, '')}`;
}

export interface Matrix {
  series: Series[];
  lens: Lens;
  m: number[][];          // pairwise values
  o: number[][];          // pairwise shared-day overlap counts (for significance)
  tradingDays: number;    // union of all dates
  avgOffDiag: number;     // mean of off-diagonal pairs
  diversifiedPairs: [number, number]; // [diversified, total] (|corr|<0.3, or codrawdown/tail<0.3)
  overlapEvents: number;  // total shared (date,date) overlaps across pairs
  pairs: { a: string; b: string; v: number }[]; // sorted desc by v
}

/** Session key for a series (`ASSET::MOVE`): the base move (1800/0300/MO/LB) with
 *  the entry/attempt suffix stripped — used to flag same-session co-movement. */
export function sessionKey(seriesKey: string): string {
  const [, move = ''] = seriesKey.split('::');
  return move.replace(/(MA|FR|PB)$/, '');
}

const MIN_OVERLAP = 20; // need this many shared days before a correlation is trustworthy

/** Is a pairwise value statistically meaningful, or small-sample noise? */
export function isSignificant(v: number, overlap: number, lens: Lens): boolean {
  if (overlap < MIN_OVERLAP) return false;
  const isCorr = lens === 'pearson' || lens === 'spearman' || lens === 'downside' || lens === 'drawdown';
  if (isCorr) return Math.abs(v) >= 2 / Math.sqrt(overlap); // ≈95% noise band: SE ≈ 1/√n
  return true; // codrawdown / tail are proportions — enough overlap is the bar
}

export function computeMatrix(series: Series[], lens: Lens): Matrix {
  const n = series.length;
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const o: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const allDates = new Set<string>();
  for (const s of series) for (const d of s.daily.keys()) allDates.add(d);
  const pairs: { a: string; b: string; v: number }[] = [];
  let offSum = 0, offCount = 0, diversified = 0, overlap = 0;
  const isCorr = lens === 'pearson' || lens === 'spearman' || lens === 'downside' || lens === 'drawdown';
  for (let i = 0; i < n; i++) {
    m[i][i] = isCorr ? 1 : (lens === 'codrawdown' || lens === 'tail' ? 0 : 1);
    for (let j = i + 1; j < n; j++) {
      const v = pairValue(series[i], series[j], lens);
      m[i][j] = v; m[j][i] = v; // full matrix for the heatmap
      const ov = align(series[i], series[j]).dates.length;
      o[i][j] = ov; o[j][i] = ov;
      // Same-family pairs (a move vs its own attempt/entry variants) are
      // trivially redundant — keep them out of the ranked lists and stats.
      if (familyKey(series[i].key) === familyKey(series[j].key)) continue;
      pairs.push({ a: series[i].label, b: series[j].label, v });
      offSum += v; offCount++;
      if (Math.abs(v) < 0.3) diversified++;
      overlap += ov;
    }
  }
  pairs.sort((x, y) => y.v - x.v);
  return {
    series, lens, m, o,
    tradingDays: allDates.size,
    avgOffDiag: offCount ? offSum / offCount : 0,
    diversifiedPairs: [diversified, offCount],
    overlapEvents: overlap,
    pairs,
  };
}

// =============================================================================
// Correlation insights — actionable recommendations from the matrix
// =============================================================================

export interface CorrInsights {
  redundant: { a: string; b: string; v: number; structural: boolean } | null; // drop one of these
  diversifier: { key: string; label: string; avgAbs: number } | null;         // add this — most independent
  tailPair: { a: string; b: string; v: number } | null;                       // these crash together
  structuralCount: number;  // cross-asset same-session pairs (won't diversify)
}

/** Actionable picks from the correlation matrix at a given lens (+ tail for cluster). */
export function correlationInsights(series: Series[], lens: Lens): CorrInsights {
  const n = series.length;
  if (n < 2) return { redundant: null, diversifier: null, tailPair: null, structuralCount: 0 };
  const mtx = computeMatrix(series, lens);
  const tail = computeMatrix(series, 'tail');
  const cross = (i: number, j: number) => familyKey(series[i].key) !== familyKey(series[j].key);
  const struct = (i: number, j: number) => sessionKey(series[i].key) === sessionKey(series[j].key) && series[i].key.split('::')[0] !== series[j].key.split('::')[0];

  // Most redundant — highest significant cross-family value at the active lens.
  let redundant: CorrInsights['redundant'] = null;
  let tailPair: CorrInsights['tailPair'] = null;
  let structuralCount = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (!cross(i, j)) continue;
    if (struct(i, j)) structuralCount++;
    if (isSignificant(mtx.m[i][j], mtx.o[i][j], lens) && (!redundant || mtx.m[i][j] > redundant.v)) {
      redundant = { a: series[i].label, b: series[j].label, v: mtx.m[i][j], structural: struct(i, j) };
    }
    if (isSignificant(tail.m[i][j], tail.o[i][j], 'tail') && (!tailPair || tail.m[i][j] > tailPair.v)) {
      tailPair = { a: series[i].label, b: series[j].label, v: tail.m[i][j] };
    }
  }

  // Best diversifier — series with the lowest average |value| to the others.
  let diversifier: CorrInsights['diversifier'] = null;
  for (let i = 0; i < n; i++) {
    let sum = 0, c = 0;
    for (let j = 0; j < n; j++) { if (i === j || !cross(i, j)) continue; sum += Math.abs(mtx.m[i][j]); c++; }
    if (!c) continue;
    const avgAbs = sum / c;
    if (!diversifier || avgAbs < diversifier.avgAbs) diversifier = { key: series[i].key, label: series[i].label, avgAbs };
  }
  return { redundant, diversifier, tailPair, structuralCount };
}

/** Equal-weight portfolio stats on the combined daily-return series (%, normalized). */
export function portfolioStats(series: Series[]): { totalReturn: number; annVol: number; maxDD: number; sharpe: number } {
  const dates = new Set<string>();
  for (const s of series) for (const d of s.daily.keys()) dates.add(d);
  const sorted = [...dates].sort();
  const daily = sorted.map(d => {
    let sum = 0, cnt = 0;
    for (const s of series) { const v = s.daily.get(d); if (v != null) { sum += v; cnt++; } }
    return cnt ? sum / cnt : 0; // equal-weight average return that day
  });
  const totalReturn = daily.reduce((s, x) => s + x, 0);
  const mu = mean(daily);
  const variance = daily.length > 1 ? daily.reduce((s, x) => s + (x - mu) ** 2, 0) / (daily.length - 1) : 0;
  const sd = Math.sqrt(variance);
  const annVol = sd * Math.sqrt(252);
  const dd = drawdownSeries(daily);
  const maxDD = dd.length ? Math.min(...dd) : 0;
  const sharpe = sd === 0 ? 0 : (mu / sd) * Math.sqrt(252);
  return { totalReturn, annVol, maxDD, sharpe };
}
