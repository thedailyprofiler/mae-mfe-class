/**
 * Prop-firm evaluation simulator for a single move — in REAL DOLLARS.
 *
 * SYNC CONTRACT: each DAY's P&L uses the same win/stop logic as the rest of the
 * dashboard (win = MFE ≥ Min Cashflow banks +minCashflow; loss = −MAE capped at
 * Max MAE), then converts that price-% to dollars PER ASSET at your position size:
 *     $ = contracts × pointValue × price(date) × (outcome% / 100)
 * price(date) is the asset's bundled daily close (MNQ/MES/MYM/MCL/MGC) or a
 * supplied reference price (RTY, which has no bundled table). This makes pass /
 * bust / days-to-pass fair across instruments and tied to your real size.
 *
 * A run walks day-by-day (bootstrap = resample days with replacement; shuffle =
 * reorder the real days) and ends as soon as a rule fires:
 *   pass       — equity ≥ profit target AND ≥ min trading days
 *   bust-dd    — equity hits the drawdown floor (trailing from peak, or static from start)
 *   bust-daily — a single day's loss exceeds the daily loss limit
 *   active     — horizon (max days) reached with none of the above
 */
import { mulberry32, percentile } from './monteCarlo';
import type { McMode } from './monteCarlo';
import type { MaeMfeDocument } from '../components/assignments/mae-mfe/maeMfeDocument';
import type { MoveState } from '../components/assignments/mae-mfe/MoveDashboard';
import { resolveStudy, DEFAULT_STUDY } from '../components/assignments/mae-mfe/maeMfeDocument';
import { applyAttemptFilter } from './maeMfeStats';
import { ASSETS, ASSET_ORDER, assetCloseForDate, type AssetTicker } from './assets';

export { mulberry32 } from './monteCarlo';
export type { McMode } from './monteCarlo';

/**
 * Representative price level for instruments that have no bundled daily-close
 * table. Empty today — every asset (incl. RTY, from CME_MINI:M2K1!) now has a
 * real daily-close table in assetPrices.ts, so the dashboard and the labs price
 * identically. Kept as the hook for any future asset added without a table;
 * override per-call via the optional refPrice arg.
 */
export const FALLBACK_PRICE: Partial<Record<AssetTicker, number>> = {};

/** Price level for an asset on a date: bundled close (latest ≤ date), else an
 *  explicit override, else a built-in representative level. */
export function priceForDate(asset: AssetTicker, date: string, refPrice?: number): number | null {
  const c = assetCloseForDate(asset, date);
  if (c != null && c > 0) return c;
  if (refPrice && refPrice > 0) return refPrice;
  return FALLBACK_PRICE[asset] ?? null;
}

export interface DollarSeries { key: string; label: string; asset: AssetTicker; dollars: number[]; dates: string[] }

/** One move's daily P&L in $ at a given size, settings-synced, date-sorted (multi-attempt days add up). */
export function moveDailyDollars(ms: MoveState, asset: AssetTicker, contracts: number, refPrice?: number): { dates: string[]; dollars: number[] } {
  const minCf = ms.minCashflowPct;
  const maxMae = ms.maxMaePct ?? 0;
  const pv = ASSETS[asset].pointValueUsd;
  const study = resolveStudy(ms, DEFAULT_STUDY);
  const rows = applyAttemptFilter([...study.inSample.rows, ...study.oos1.rows, ...study.oos2.rows, ...study.oos3.rows], ms.attemptMode ?? { kind: 'all' });
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (!r.tradeDate) continue;
    const price = priceForDate(asset, r.tradeDate, refPrice);
    if (price == null) continue; // can't convert without a price level
    const isWin = r.mfePct >= minCf;
    const stopped = !isWin && maxMae > 0 && r.maePct > maxMae;
    const outPct = isWin ? minCf : -(stopped ? maxMae : r.maePct);
    const d = contracts * pv * price * (outPct / 100);
    byDate.set(r.tradeDate, (byDate.get(r.tradeDate) ?? 0) + d);
  }
  const dates = [...byDate.keys()].sort();
  return { dates, dollars: dates.map((dt) => byDate.get(dt)!) };
}

/** Every populated (asset, move) as a $-denominated daily series at the given size. */
export function buildDollarSeries(doc: MaeMfeDocument, moveLabel: (m: string) => string, contracts: number, refPrice?: number): DollarSeries[] {
  const out: DollarSeries[] = [];
  for (const a of ASSET_ORDER) {
    const state = doc[a as AssetTicker];
    if (!state) continue;
    for (const move of Object.keys(state)) {
      const { dates, dollars } = moveDailyDollars(state[move], a as AssetTicker, contracts, refPrice);
      if (dollars.length === 0) continue;
      out.push({ key: `${a}::${move}`, label: `${a} ${moveLabel(move)}`, asset: a as AssetTicker, dollars, dates });
    }
  }
  return out;
}

/** Like buildDollarSeries, but each move is sized at its OWN config contracts
 *  (its manual / default-safest position size) instead of one global size — so
 *  Portfolio / the grand recommendation value every move at the risk it's set to. */
export function buildOwnSizeDollarSeries(doc: MaeMfeDocument, moveLabel: (m: string) => string): DollarSeries[] {
  const out: DollarSeries[] = [];
  for (const a of ASSET_ORDER) {
    const state = doc[a as AssetTicker];
    if (!state) continue;
    for (const move of Object.keys(state)) {
      const ms = state[move];
      const { dates, dollars } = moveDailyDollars(ms, a as AssetTicker, ms.defaultContracts);
      if (dollars.length === 0) continue;
      out.push({ key: `${a}::${move}`, label: `${a} ${moveLabel(move)}`, asset: a as AssetTicker, dollars, dates });
    }
  }
  return out;
}

export interface PropRules {
  accountSize: number;     // $ — display + context
  profitTarget: number;    // $ profit to pass
  maxDrawdown: number;     // $ drawdown that busts (0 = off)
  ddMode: 'trailing' | 'static';
  dailyLossLimit: number;  // $ single-day loss that busts (0 = off)
  minTradingDays: number;  // pass only counts after this many days (0 = off)
  maxDays: number;         // horizon
}

export type Outcome = 'pass' | 'bust-dd' | 'bust-daily' | 'active';

/** One evaluation run. equity is profit relative to start, in $. */
function simulateOne(draw: (k: number) => number, n: number, r: PropRules): { outcome: Outcome; day: number; equity: number } {
  let equity = 0, peak = 0, days = 0;
  for (let k = 0; k < n; k++) {
    const dayD = draw(k); // already in $
    days++;
    const bustDaily = r.dailyLossLimit > 0 && dayD <= -r.dailyLossLimit;
    equity += dayD;
    if (equity > peak) peak = equity;
    if (bustDaily) return { outcome: 'bust-daily', day: days, equity };
    const floor = r.ddMode === 'trailing' ? peak - r.maxDrawdown : -r.maxDrawdown;
    if (r.maxDrawdown > 0 && equity <= floor) return { outcome: 'bust-dd', day: days, equity };
    if (equity >= r.profitTarget && days >= r.minTradingDays) return { outcome: 'pass', day: days, equity };
  }
  return { outcome: 'active', day: days, equity };
}

export interface PropResult {
  sims: number;
  passRate: number; bustRate: number; activeRate: number;
  bustByDD: number; bustByDaily: number;
  medianDaysToPass: number | null;
  p10DaysToPass: number | null;
  p90DaysToPass: number | null;
  finalP5: number; finalP50: number; finalP95: number; meanFinal: number; // $
  base: { outcome: Outcome; day: number; equity: number } | null;
}

const EMPTY: PropResult = {
  sims: 0, passRate: 0, bustRate: 0, activeRate: 0, bustByDD: 0, bustByDaily: 0,
  medianDaysToPass: null, p10DaysToPass: null, p90DaysToPass: null,
  finalP5: 0, finalP50: 0, finalP95: 0, meanFinal: 0, base: null,
};

export interface PropOpts { mode: McMode; sims: number; rng?: () => number }

/** dailyDollars: each entry is one trading day's net P&L in $ (already sized). */
export function runPropSim(dailyDollars: number[], rules: PropRules, opts: PropOpts): PropResult {
  if (dailyDollars.length === 0) return EMPTY;
  const rng = opts.rng ?? Math.random;
  const sims = Math.max(1, opts.sims);
  const maxDays = opts.mode === 'shuffle' ? Math.min(rules.maxDays, dailyDollars.length) : Math.max(1, rules.maxDays);

  let pass = 0, bustDD = 0, bustDaily = 0, active = 0;
  const daysToPass: number[] = [];
  const finals: number[] = [];

  for (let s = 0; s < sims; s++) {
    let deck: number[] | null = null;
    if (opts.mode === 'shuffle') {
      deck = dailyDollars.slice();
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    }
    const draw = deck ? (k: number) => deck![k] : () => dailyDollars[Math.floor(rng() * dailyDollars.length)];
    const o = simulateOne(draw, maxDays, rules);
    finals.push(o.equity);
    if (o.outcome === 'pass') { pass++; daysToPass.push(o.day); }
    else if (o.outcome === 'bust-dd') bustDD++;
    else if (o.outcome === 'bust-daily') bustDaily++;
    else active++;
  }

  finals.sort((a, b) => a - b);
  daysToPass.sort((a, b) => a - b);
  const baseRun = simulateOne((k) => dailyDollars[k], Math.min(dailyDollars.length, Math.max(1, rules.maxDays)), rules);

  return {
    sims,
    passRate: pass / sims,
    bustRate: (bustDD + bustDaily) / sims,
    activeRate: active / sims,
    bustByDD: bustDD / sims,
    bustByDaily: bustDaily / sims,
    medianDaysToPass: daysToPass.length ? percentile(daysToPass, 0.5) : null,
    p10DaysToPass: daysToPass.length ? percentile(daysToPass, 0.1) : null,
    p90DaysToPass: daysToPass.length ? percentile(daysToPass, 0.9) : null,
    finalP5: percentile(finals, 0.05),
    finalP50: percentile(finals, 0.5),
    finalP95: percentile(finals, 0.95),
    meanFinal: finals.reduce((s, x) => s + x, 0) / finals.length,
    base: baseRun,
  };
}
