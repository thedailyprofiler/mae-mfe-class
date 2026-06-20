/**
 * flipRoiRecommend — "which move gives the best ROI / fastest payout / cheapest
 * path to profit" for prop flipping, using the full lifecycle simulator.
 *
 * For every move (sized at its own config) it runs the flip lifecycle under your
 * firm rules and ranks by:
 *   💸 Best ROI / $ spent — most net profit per dollar of eval/reset spend
 *   ⚡ Fastest Payout      — soonest first payout (speed vs the account price)
 *   🪙 Cheapest to Profit  — least total spend to turn net-positive
 */
import type { MaeMfeDocument } from '../components/assignments/mae-mfe/maeMfeDocument';
import { resolveStudy, DEFAULT_STUDY } from '../components/assignments/mae-mfe/maeMfeDocument';
import { applyAttemptFilter } from './maeMfeStats';
import { dailyDollarsFromRows } from './setupRecommender';
import { runPropFirmSim, type PropFirmRules } from './propFirmSim';
import { mulberry32 } from './monteCarlo';
import { buildOwnSizeDollarSeries, type DollarSeries } from './propSim';
import { familyKey } from './correlation';
import { ASSET_ORDER, type AssetTicker } from './assets';

export type RoiStyle = 'roi' | 'payout' | 'cheapest';
export const ROI_STYLES: { key: RoiStyle; title: string; info: string; note: string }[] = [
  { key: 'roi', title: '💸 Best ROI / $ spent', info: 'fr-roi', note: 'Most net profit per dollar of eval + reset spend.' },
  { key: 'payout', title: '⚡ Fastest Payout', info: 'fr-payout', note: 'Soonest first payout — speed against the account price.' },
  { key: 'cheapest', title: '🪙 Cheapest to Profit', info: 'fr-cheapest', note: 'Least total spend to turn net-positive.' },
];

export interface RoiRec {
  key: string; label: string; contracts: number;
  minCf: number; maxMae: number; // the move's tuned target / stop (for display)
  net: number;        // mean net $ per career
  spend: number;      // mean $ spent on evals + resets
  roi: number;        // net ÷ spend (median)
  daysToPayout: number | null;
  payouts: number;    // avg payouts collected
  blown: number;      // avg accounts blown
  profitableShare: number;
}

const CONTRACTS_GRID = [1, 2, 3, 5, 8, 13, 20];

export interface RoiOpts { sims: number; rng?: () => number }

/** Best move + RECOMMENDED size per ROI style, across every populated move. */
export function recommendFlipRoi(doc: MaeMfeDocument, firm: PropFirmRules, label: (m: string) => string, opts: RoiOpts): Record<RoiStyle, RoiRec | null> {
  const rng = opts.rng ?? mulberry32(1);
  const best = { roi: null, payout: null, cheapest: null } as Record<RoiStyle, RoiRec | null>;

  for (const a of ASSET_ORDER) {
    const state = doc[a as AssetTicker];
    if (!state) continue;
    for (const move of Object.keys(state)) {
      const ms = state[move];
      const rows = applyAttemptFilter(
        (() => { const s = resolveStudy(ms, DEFAULT_STUDY); return [...s.inSample.rows, ...s.oos1.rows, ...s.oos2.rows, ...s.oos3.rows]; })(),
        ms.attemptMode ?? { kind: 'all' },
      );
      if (rows.length < 5) continue;

      // Sweep position size — the recommended size is the one that best serves each style.
      for (const contracts of CONTRACTS_GRID) {
        const daily = dailyDollarsFromRows(rows, a as AssetTicker, contracts, ms.minCashflowPct, ms.maxMaePct ?? 0);
        if (daily.length === 0) continue;
        const res = runPropFirmSim(daily, firm, { sims: opts.sims, rng });
        const cand: RoiRec = {
          key: `${a}::${move}`, label: `${a} ${label(move)}`, contracts,
          minCf: ms.minCashflowPct, maxMae: ms.maxMaePct ?? 0,
          net: res.netMean, spend: res.avgSpend, roi: res.roiMedian, daysToPayout: res.avgDaysToFirstPayout,
          payouts: res.avgPayouts, blown: res.avgBlown, profitableShare: res.profitableShare,
        };

        // Best ROI — highest net ÷ spend, among net-positive setups.
        if (cand.net > 0 && (!best.roi || cand.roi > best.roi.roi)) best.roi = cand;
        // Fastest Payout — soonest first payout, among setups that pay out net-positive.
        if (cand.daysToPayout != null && cand.net > 0 && (!best.payout || cand.daysToPayout < (best.payout.daysToPayout ?? Infinity))) best.payout = cand;
        // Cheapest to Profit — lowest spend, among net-positive setups.
        if (cand.net > 0 && (!best.cheapest || cand.spend < best.cheapest.spend)) best.cheapest = cand;
      }
    }
  }
  return best;
}

// =============================================================================
// Multi-move flip BASKET — run several moves together to flip faster / cheaper
// =============================================================================

export type BasketStyle = 'roi' | 'payout' | 'cheapest';
export const BASKET_STYLES: { key: BasketStyle; title: string; info: string; note: string }[] = [
  { key: 'roi', title: '💸 Best ROI basket', info: 'fb-roi', note: 'Moves combined for the most net profit per $ spent.' },
  { key: 'payout', title: '⚡ Fastest-payout basket', info: 'fb-payout', note: 'Moves combined to reach the first payout soonest.' },
  { key: 'cheapest', title: '🪙 Cheapest basket', info: 'fb-cheapest', note: 'Fewest accounts/resets to turn net-positive.' },
];

export interface FlipBasket {
  keys: string[]; labels: string[];
  net: number; spend: number; roi: number; daysToPayout: number | null; payouts: number; profitableShare: number;
}

/** Sum several moves' daily $ into one combined per-date stream. */
function combineDollars(members: DollarSeries[]): number[] {
  const byDate = new Map<string, number>();
  for (const s of members) s.dates.forEach((d, i) => byDate.set(d, (byDate.get(d) ?? 0) + s.dollars[i]));
  return [...byDate.keys()].sort().map((d) => byDate.get(d)!);
}

/**
 * Recommend WHICH moves to run together to flip, per style. Ranks each move by
 * its solo flip ROI (family-collapsed so one asset's variants don't stack), then
 * evaluates cumulative top-N baskets (combined stream) through the lifecycle and
 * picks the best basket for ROI / payout-speed / cheapest.
 */
export function recommendFlipBasket(doc: MaeMfeDocument, firm: PropFirmRules, label: (m: string) => string, opts: RoiOpts): Record<BasketStyle, FlipBasket | null> {
  const rng = opts.rng ?? mulberry32(1);
  const series = buildOwnSizeDollarSeries(doc, label);
  const empty = { roi: null, payout: null, cheapest: null } as Record<BasketStyle, FlipBasket | null>;
  if (series.length === 0) return empty;

  // Solo flip ROI per move, then keep the best member per strategy family.
  const scored = series.map((s) => ({ s, roi: runPropFirmSim(s.dollars, firm, { sims: opts.sims, rng }).roiMedian }));
  const bestPerFamily = new Map<string, { s: DollarSeries; roi: number }>();
  for (const x of scored) {
    const fam = familyKey(x.s.key);
    const cur = bestPerFamily.get(fam);
    if (!cur || x.roi > cur.roi) bestPerFamily.set(fam, x);
  }
  const ranked = [...bestPerFamily.values()].sort((a, b) => b.roi - a.roi).map((x) => x.s);
  if (ranked.length === 0) return empty;

  // Evaluate cumulative top-N baskets (1..6 moves) on the combined stream.
  const best = { roi: null, payout: null, cheapest: null } as Record<BasketStyle, FlipBasket | null>;
  const maxN = Math.min(6, ranked.length);
  for (let n = 1; n <= maxN; n++) {
    const members = ranked.slice(0, n);
    const res = runPropFirmSim(combineDollars(members), firm, { sims: opts.sims, rng });
    const b: FlipBasket = {
      keys: members.map((m) => m.key), labels: members.map((m) => m.label),
      net: res.netMean, spend: res.avgSpend, roi: res.roiMedian, daysToPayout: res.avgDaysToFirstPayout,
      payouts: res.avgPayouts, profitableShare: res.profitableShare,
    };
    if (b.net > 0 && (!best.roi || b.roi > best.roi.roi)) best.roi = b;
    if (b.daysToPayout != null && b.net > 0 && (!best.payout || b.daysToPayout < (best.payout.daysToPayout ?? Infinity))) best.payout = b;
    if (b.net > 0 && (!best.cheapest || b.spend < best.cheapest.spend)) best.cheapest = b;
  }
  return best;
}
