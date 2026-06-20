/**
 * Setup recommender — for ONE move, find the best full setup per risk appetite,
 * cross-referencing every entry × attempt slice in the data.
 *
 * A "variant" is one entry × attempt-slice (e.g. Breakout · only-2nd, Front Run,
 * Pullback) — the caller builds these by applying the dashboard's attempt filter
 * to each entry's rows. The engine sweeps variant × MFE target (Min Cashflow) ×
 * Max-MAE stop × contract size, converts to settings-synced daily $ (same win/
 * stop math, real dollars per asset), runs the prop sim, and picks per objective.
 *
 * Two account modes:
 *   prop — pass the profit target before the trailing/static drawdown busts you.
 *          Metrics: pass% / days-to-pass / bust%.
 *   live — no eval target; the drawdown limit is a RUIN level. The sim runs the
 *          full horizon. Metrics: expected return $ / Sharpe / max DD / risk-of-ruin.
 *
 * Appetites: fastest (growth), safest, bestOverall, professional (institutional —
 * best risk-adjusted return under a strict drawdown cap; size is vol-targeted via
 * the bust/ruin cap + contract grid).
 */
import { ASSETS, type AssetTicker } from './assets';
import { priceForDate, runPropSim, type PropRules } from './propSim';
import type { RawRow } from './maeMfeStats';

export type AccountMode = 'prop' | 'live';
export interface VariantInput { key: string; label: string; entry: string; attempts: string; rows: RawRow[] }

const MFE_GRID = [0.05, 0.1, 0.15, 0.2, 0.3, 0.5];
const MM_GRID = [0, 0.3, 0.5]; // 0 = no stop
const CONTRACTS_GRID = [1, 2, 3, 5, 8, 13, 20];

/** Daily $ for a set of trade rows at a contract size + custom MFE target / Max MAE. */
export function dailyDollarsFromRows(rows: RawRow[], asset: AssetTicker, contracts: number, minCf: number, maxMae: number): number[] {
  const pv = ASSETS[asset].pointValueUsd;
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (!r.tradeDate) continue;
    const price = priceForDate(asset, r.tradeDate);
    if (price == null) continue;
    const isWin = r.mfePct >= minCf;
    const stopped = !isWin && maxMae > 0 && r.maePct > maxMae;
    const outPct = isWin ? minCf : -(stopped ? maxMae : r.maePct);
    byDate.set(r.tradeDate, (byDate.get(r.tradeDate) ?? 0) + contracts * pv * price * (outPct / 100));
  }
  return [...byDate.keys()].sort().map((k) => byDate.get(k)!);
}

function stats(xs: number[]): { mean: number; std: number; total: number; sharpe: number; maxDD: number } {
  const n = xs.length;
  if (!n) return { mean: 0, std: 0, total: 0, sharpe: 0, maxDD: 0 };
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const variance = n > 1 ? xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  let eq = 0, peak = 0, maxDD = 0;
  for (const x of xs) { eq += x; if (eq > peak) peak = eq; if (eq - peak < maxDD) maxDD = eq - peak; }
  return { mean, std, total: xs.reduce((s, x) => s + x, 0), sharpe: std > 0 ? (mean / std) * Math.sqrt(252) : 0, maxDD };
}

export interface SetupRec {
  objective: string;
  variantKey: string; entry: string; attempts: string;
  minCf: number; maxMae: number; contracts: number;
  // prop framing
  pass: number; bust: number; medianDays: number | null;
  // shared / live framing
  expEnd: number; sharpe: number; annVol: number; maxDD: number; ruin: number;
}
export interface SetupRecs { mode: AccountMode; fastest: SetupRec | null; safest: SetupRec | null; bestOverall: SetupRec | null; professional: SetupRec | null }

const pick = <T,>(arr: T[], cmp: (a: T, b: T) => number): T | null => (arr.length ? [...arr].sort(cmp)[0] : null);

/**
 * Safest config for ONE dataset (no entry/attempt comparison) — the MFE target /
 * Max MAE / contracts that minimize bust (prop) or risk-of-ruin (live) among
 * positive-edge settings. Used to default every (asset, move) to its safest setup.
 */
export interface SafeCfg { minCf: number; maxMae: number; contracts: number; bust: number; expEnd: number }
export function recommendSafestConfig(rows: RawRow[], asset: AssetTicker, rules: PropRules, opts: SetupOpts = {}): SafeCfg | null {
  const mode: AccountMode = opts.mode ?? 'prop';
  const sims = opts.sims ?? 200;
  const simRules: PropRules = mode === 'live' ? { ...rules, profitTarget: Number.MAX_SAFE_INTEGER, minTradingDays: 0 } : rules;
  const better = (a: SafeCfg, b: SafeCfg | null) => !b || a.bust < b.bust || (a.bust === b.bust && a.expEnd > b.expEnd);
  let best: SafeCfg | null = null;
  let bestAny: SafeCfg | null = null; // fallback if nothing is positive-edge
  for (const minCf of MFE_GRID) {
    for (const maxMae of MM_GRID) {
      const d1 = dailyDollarsFromRows(rows, asset, 1, minCf, maxMae);
      if (d1.length < 5) continue;
      const edge = d1.reduce((s, x) => s + x, 0);
      for (const c of CONTRACTS_GRID) {
        if (opts.maxContracts && c > opts.maxContracts) continue;
        const r = runPropSim(d1.map((x) => x * c), simRules, { mode: 'bootstrap', sims, rng: opts.rng });
        const cand: SafeCfg = { minCf, maxMae, contracts: c, bust: r.bustRate, expEnd: r.meanFinal };
        if (better(cand, bestAny)) bestAny = cand;
        if (edge > 0 && better(cand, best)) best = cand;
      }
    }
  }
  return best ?? bestAny;
}

export interface SetupOpts { mode?: AccountMode; sims?: number; rng?: () => number; maxContracts?: number }

export function recommendSetup(variants: VariantInput[], asset: AssetTicker, rules: PropRules, opts: SetupOpts = {}): SetupRecs {
  const mode: AccountMode = opts.mode ?? 'prop';
  const sims = opts.sims ?? 250;
  // Live: never "pass" early (run the full horizon); drawdown = ruin level.
  const simRules: PropRules = mode === 'live' ? { ...rules, profitTarget: Number.MAX_SAFE_INTEGER, minTradingDays: 0 } : rules;

  const cands: SetupRec[] = [];
  for (const v of variants) {
    for (const minCf of MFE_GRID) {
      for (const maxMae of MM_GRID) {
        const d1 = dailyDollarsFromRows(v.rows, asset, 1, minCf, maxMae);
        if (d1.length < 5) continue;
        for (const c of CONTRACTS_GRID) {
          if (opts.maxContracts && c > opts.maxContracts) continue;
          const daily = d1.map((x) => x * c);
          const st = stats(daily);
          const r = runPropSim(daily, simRules, { mode: 'bootstrap', sims, rng: opts.rng });
          cands.push({
            objective: '', variantKey: v.key, entry: v.entry, attempts: v.attempts, minCf, maxMae, contracts: c,
            pass: r.passRate, bust: r.bustRate, medianDays: r.medianDaysToPass,
            expEnd: r.meanFinal, sharpe: st.sharpe, annVol: st.std * Math.sqrt(252), maxDD: st.maxDD, ruin: r.bustRate,
          });
        }
      }
    }
  }
  if (!cands.length) return { mode, fastest: null, safest: null, bestOverall: null, professional: null };

  const positive = cands.filter((c) => c.expEnd > 0);
  const tag = (r: SetupRec | null, o: string) => (r ? { ...r, objective: o } : null);
  let fastest: SetupRec | null, safest: SetupRec | null, bestOverall: SetupRec | null, professional: SetupRec | null;

  if (mode === 'prop') {
    fastest = pick(cands.filter((c) => c.pass >= 0.4 && c.medianDays != null), (a, b) => (a.medianDays! - b.medianDays!) || (b.expEnd - a.expEnd)) ?? pick(cands, (a, b) => b.pass - a.pass);
    safest = pick(positive.length ? positive : cands, (a, b) => (a.bust - b.bust) || (a.annVol - b.annVol) || (b.pass - a.pass));
    bestOverall = pick(cands.filter((c) => c.pass >= 0.5), (a, b) => b.expEnd - a.expEnd) ?? pick(cands, (a, b) => b.expEnd - a.expEnd);
  } else {
    // live: growth & survival
    fastest = pick(positive.length ? positive : cands, (a, b) => b.expEnd - a.expEnd); // most expected growth $
    safest = pick(positive.length ? positive : cands, (a, b) => (a.ruin - b.ruin) || (b.maxDD - a.maxDD) || (b.expEnd - a.expEnd)); // lowest ruin / shallowest DD
    bestOverall = pick(positive.length ? positive : cands, (a, b) => (b.expEnd * (1 - b.ruin)) - (a.expEnd * (1 - a.ruin))); // ruin-discounted growth
  }
  // professional (both modes): best risk-adjusted (Sharpe) under a strict ruin/bust cap.
  const strict = positive.filter((c) => c.ruin <= 0.1);
  const relaxed = positive.filter((c) => c.ruin <= 0.25);
  const profPool = strict.length ? strict : relaxed.length ? relaxed : positive.length ? positive : cands;
  professional = pick(profPool, (a, b) => (b.sharpe - a.sharpe) || (a.ruin - b.ruin) || (b.expEnd - a.expEnd));

  return { mode, fastest: tag(fastest, 'fastest'), safest: tag(safest, 'safest'), bestOverall: tag(bestOverall, 'bestOverall'), professional: tag(professional, 'professional') };
}
