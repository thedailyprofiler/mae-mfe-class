/**
 * Monte Carlo engine for a single move.
 *
 * SYNC CONTRACT: each trade's outcome is the SAME win/stop result the rest of
 * the dashboard uses — win (MFE ≥ Min Cashflow) banks +minCashflow, else a loss
 * of −(MAE, capped at Max MAE). Outcomes are in PERCENT (scale-free → every asset,
 * incl. RTY) and equity is the running SUM of trade %s (fixed sizing), matching
 * the Combine/Correlation panels.
 *
 * Two modes:
 *   bootstrap — draw trades WITH replacement (resample the edge): "what could
 *               happen if I keep trading this setup."
 *   shuffle   — reuse the EXACT same trades, reordered (Fisher–Yates): "same
 *               results, different luck of the draw" — isolates ordering risk.
 */
import type { MaeMfeDocument } from '../components/assignments/mae-mfe/maeMfeDocument';
import type { MoveState } from '../components/assignments/mae-mfe/MoveDashboard';
import { resolveStudy, DEFAULT_STUDY } from '../components/assignments/mae-mfe/maeMfeDocument';
import { applyAttemptFilter } from './maeMfeStats';
import { ASSET_ORDER, type AssetTicker } from './assets';

export type McMode = 'bootstrap' | 'shuffle';

export interface TradeSeries { key: string; label: string; returns: number[] }

/** One move's per-trade return %, settings-synced (one entry per row). */
export function moveTradeReturns(ms: MoveState): number[] {
  const minCf = ms.minCashflowPct;
  const maxMae = ms.maxMaePct ?? 0;
  const study = resolveStudy(ms, DEFAULT_STUDY);
  const rows = applyAttemptFilter([...study.inSample.rows, ...study.oos1.rows, ...study.oos2.rows, ...study.oos3.rows], ms.attemptMode ?? { kind: 'all' });
  const out: number[] = [];
  for (const r of rows) {
    const isWin = r.mfePct >= minCf;
    const stopped = !isWin && maxMae > 0 && r.maePct > maxMae;
    out.push(isWin ? minCf : -(stopped ? maxMae : r.maePct));
  }
  return out;
}

/** Every populated (asset, move) as a labelled per-trade series. */
export function buildTradeSeries(doc: MaeMfeDocument, moveLabel: (move: string) => string): TradeSeries[] {
  const out: TradeSeries[] = [];
  for (const a of ASSET_ORDER) {
    const state = doc[a as AssetTicker];
    if (!state) continue;
    for (const move of Object.keys(state)) {
      const returns = moveTradeReturns(state[move]);
      if (returns.length === 0) continue;
      out.push({ key: `${a}::${move}`, label: `${a} ${moveLabel(move)}`, returns });
    }
  }
  return out;
}

/** Deterministic PRNG so a given (seed, inputs) always renders the same fan. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolated percentile of a pre-sorted ascending array. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface McResult {
  mode: McMode;
  sims: number;
  tradesPerSim: number;
  finalP5: number; finalP25: number; finalP50: number; finalP75: number; finalP95: number;
  finalMean: number;
  probProfit: number;            // fraction of sims ending > 0
  maxDDMedian: number;           // typical worst drawdown (≤ 0)
  maxDDWorst5: number;           // 5%-worst drawdown (≤ 0) — the scary tail
  ddLimit: number;               // user threshold (%, >0 to enable)
  probHitDDLimit: number;        // fraction whose worst DD reached −ddLimit
  lossStreakP50: number;         // typical longest run of consecutive losers
  lossStreakP95: number;         // 95th-pct longest losing run — the "doomsday" streak
  bands: { step: number; p5: number; p50: number; p95: number }[];
  base: { final: number; maxDD: number }; // the actual historical sequence, as-is
}

const EMPTY: McResult = {
  mode: 'bootstrap', sims: 0, tradesPerSim: 0,
  finalP5: 0, finalP25: 0, finalP50: 0, finalP75: 0, finalP95: 0, finalMean: 0,
  probProfit: 0, maxDDMedian: 0, maxDDWorst5: 0, ddLimit: 0, probHitDDLimit: 0,
  lossStreakP50: 0, lossStreakP95: 0,
  bands: [], base: { final: 0, maxDD: 0 },
};

function pathStats(returns: number[]): { final: number; maxDD: number } {
  let eq = 0, peak = 0, maxDD = 0;
  for (const r of returns) { eq += r; if (eq > peak) peak = eq; if (eq - peak < maxDD) maxDD = eq - peak; }
  return { final: eq, maxDD };
}

export interface McOpts { mode: McMode; sims: number; tradesPerSim?: number; ddLimit?: number; rng?: () => number }

export function runMonteCarlo(returns: number[], opts: McOpts): McResult {
  if (returns.length === 0) return { ...EMPTY, mode: opts.mode };
  const rng = opts.rng ?? Math.random;
  const sims = Math.max(1, opts.sims);
  // shuffle reuses the full deck; bootstrap can draw any horizon (default = deck size).
  const n = opts.mode === 'shuffle' ? returns.length : Math.max(1, opts.tradesPerSim ?? returns.length);
  const ddLimit = opts.ddLimit && opts.ddLimit > 0 ? opts.ddLimit : 0;

  const finals: number[] = [];
  const dds: number[] = [];
  const lossStreaks: number[] = [];
  const stepVals: number[][] = Array.from({ length: n }, () => [] as number[]);

  for (let s = 0; s < sims; s++) {
    let deck: number[] | null = null;
    if (opts.mode === 'shuffle') {
      deck = returns.slice();
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    }
    let eq = 0, peak = 0, maxDD = 0, run = 0, maxRun = 0;
    for (let k = 0; k < n; k++) {
      const r = deck ? deck[k] : returns[Math.floor(rng() * returns.length)];
      eq += r;
      if (eq > peak) peak = eq;
      if (eq - peak < maxDD) maxDD = eq - peak;
      if (r < 0) { run += 1; if (run > maxRun) maxRun = run; } else run = 0; // consecutive losers
      stepVals[k].push(eq);
    }
    finals.push(eq);
    dds.push(maxDD);
    lossStreaks.push(maxRun);
  }

  finals.sort((a, b) => a - b);
  dds.sort((a, b) => a - b); // ascending: index 0 = most negative (worst)
  lossStreaks.sort((a, b) => a - b); // ascending: P95 = the long (doomsday) streak
  const bands = stepVals.map((vals, i) => {
    vals.sort((a, b) => a - b);
    return { step: i + 1, p5: percentile(vals, 0.05), p50: percentile(vals, 0.5), p95: percentile(vals, 0.95) };
  });

  return {
    mode: opts.mode, sims, tradesPerSim: n,
    finalP5: percentile(finals, 0.05),
    finalP25: percentile(finals, 0.25),
    finalP50: percentile(finals, 0.5),
    finalP75: percentile(finals, 0.75),
    finalP95: percentile(finals, 0.95),
    finalMean: finals.reduce((s, x) => s + x, 0) / finals.length,
    probProfit: finals.filter((f) => f > 0).length / finals.length,
    maxDDMedian: percentile(dds, 0.5),
    maxDDWorst5: percentile(dds, 0.05), // 5th pct of ascending = deep tail
    ddLimit,
    probHitDDLimit: ddLimit > 0 ? dds.filter((d) => d <= -ddLimit).length / dds.length : 0,
    lossStreakP50: Math.round(percentile(lossStreaks, 0.5)),
    lossStreakP95: Math.round(percentile(lossStreaks, 0.95)),
    bands,
    base: pathStats(returns),
  };
}
