/**
 * flipRecommend — "which move (and what size) to run to PASS / flip a prop eval."
 *
 * Prop flipping is an asymmetric game: a blown eval costs only the account fee,
 * but a pass unlocks payouts — so the goal is max expected passes per account,
 * NOT min drawdown. This scans every move, and for each sweeps position size
 * (at the move's own tuned MFE target / Max-MAE stop) through the prop-sim under
 * your eval rules, then names the best move + size for four flip styles:
 *
 *   🏴‍☠️ Fastest Flip   — passes in the fewest days (max throughput: pass → reset → repeat)
 *   🎯 Highest Pass %  — most reliable pass within Max Days (fewest wasted account fees)
 *   💰 Best EV/Account — highest expected $ end per account attempt (payout efficiency)
 *   📏 Consistency     — high pass rate with the lowest single-day concentration
 *                        (fits prop "no big day" consistency caps)
 *
 * Sizing is the flip lever; the MFE target / Max-MAE stop come from each move's
 * own config (already its manual/safest). Settings-synced via the prop-sim.
 */
import type { MaeMfeDocument } from '../components/assignments/mae-mfe/maeMfeDocument';
import { resolveStudy, DEFAULT_STUDY } from '../components/assignments/mae-mfe/maeMfeDocument';
import { applyAttemptFilter } from './maeMfeStats';
import { dailyDollarsFromRows } from './setupRecommender';
import { runPropSim, mulberry32, type PropRules } from './propSim';
import { ASSET_ORDER, type AssetTicker } from './assets';

export type FlipStyle = 'fastest' | 'pass' | 'ev' | 'consistency';
export const FLIP_STYLES: { key: FlipStyle; title: string; info: string; note: string }[] = [
  { key: 'fastest', title: '🏴‍☠️ Fastest Flip', info: 'fl-fastest', note: 'Passes in the fewest days — pass, withdraw, reset, repeat.' },
  { key: 'pass', title: '🎯 Highest Pass %', info: 'fl-pass', note: 'Most reliable pass within the window — fewest wasted account fees.' },
  { key: 'ev', title: '💰 Best EV / Account', info: 'fl-ev', note: 'Most expected $ per account attempt — best payout efficiency.' },
  { key: 'consistency', title: '📏 Consistency', info: 'fl-consistency', note: 'High pass rate with steady days — fits prop consistency caps.' },
];

export interface FlipRec {
  key: string;        // asset::move
  label: string;
  contracts: number;
  minCf: number;
  maxMae: number;
  pass: number;       // 0..1
  bust: number;       // 0..1
  medianDays: number | null;
  expEnd: number;     // mean ending $ per account attempt (eval equity)
  evPerAccount: number; // P(pass) × payout − eval cost — the real flip EV
  consistency: number; // 0..1 — biggest single day ÷ total positive $ (lower = steadier)
}

const CONTRACTS_GRID = [1, 2, 3, 5, 8, 13, 20];
const PASS_GATE = 0.3;

export interface FlipOpts { sims: number; rng?: () => number; cost: number; payout: number }

/** Biggest single positive day as a share of total positive P&L (0..1; lower = steadier). */
function dayConcentration(dollars: number[]): number {
  let pos = 0, max = 0;
  for (const d of dollars) { if (d > 0) { pos += d; if (d > max) max = d; } }
  return pos > 0 ? max / pos : 1;
}

/** Best move + size to pass/flip, per flip style, across every populated move. */
export function recommendFlip(doc: MaeMfeDocument, rules: PropRules, label: (m: string) => string, opts: FlipOpts): Record<FlipStyle, FlipRec | null> {
  const rng = opts.rng ?? mulberry32(1);
  const payout = opts.payout > 0 ? opts.payout : rules.profitTarget; // $ a pass pays out
  const best = { fastest: null, pass: null, ev: null, consistency: null } as Record<FlipStyle, FlipRec | null>;

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
      const minCf = ms.minCashflowPct;
      const maxMae = ms.maxMaePct ?? 0;

      for (const contracts of CONTRACTS_GRID) {
        const daily = dailyDollarsFromRows(rows, a as AssetTicker, contracts, minCf, maxMae);
        if (daily.length === 0) continue;
        const prop = runPropSim(daily, rules, { mode: 'bootstrap', sims: opts.sims, rng });
        const cand: FlipRec = {
          key: `${a}::${move}`, label: `${a} ${label(move)}`,
          contracts, minCf, maxMae,
          pass: prop.passRate, bust: prop.bustRate, medianDays: prop.medianDaysToPass,
          expEnd: prop.meanFinal, evPerAccount: prop.passRate * payout - opts.cost,
          consistency: dayConcentration(daily),
        };

        // Fastest Flip — fewest days to pass, among real passers; tiebreak higher pass.
        if (cand.pass >= PASS_GATE && cand.medianDays != null) {
          const cur = best.fastest;
          if (!cur || cand.medianDays! < cur.medianDays! || (cand.medianDays === cur.medianDays && cand.pass > cur.pass)) best.fastest = cand;
        }
        // Highest Pass % — max pass; tiebreak fewer days.
        {
          const cur = best.pass;
          if (!cur || cand.pass > cur.pass || (cand.pass === cur.pass && (cand.medianDays ?? Infinity) < (cur.medianDays ?? Infinity))) best.pass = cand;
        }
        // Best EV / Account — max real flip EV (P(pass) × payout − eval cost).
        {
          const cur = best.ev;
          if (!cur || cand.evPerAccount > cur.evPerAccount) best.ev = cand;
        }
        // Consistency — lowest single-day concentration, among real passers; tiebreak higher pass.
        if (cand.pass >= PASS_GATE) {
          const cur = best.consistency;
          if (!cur || cand.consistency < cur.consistency || (cand.consistency === cur.consistency && cand.pass > cur.pass)) best.consistency = cand;
        }
      }
    }
  }
  return best;
}
