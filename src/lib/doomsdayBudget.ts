/**
 * doomsdayBudget — "prepare for the worst case, and the rest is gravy."
 *
 * Implements the Doomsday Budget calculation from the bootcamp lesson (binary
 * systems with a fixed TP/SL): from a move's MAE/MFE data + your account rules,
 * find the worst losing streak, the capital needed to survive it, and how account
 * rotation + scaling extends that survival.
 *
 *   worst streak  = max(historical longest losing run, Monte-Carlo P95 streak)
 *   risk / trade  = the $ lost on a stop-out at your size
 *   doomsday DD   = worst streak × risk/trade   ← the capital one account must absorb
 *   survives?     = doomsday DD ≤ Account Profile Max DD
 *   rotation      = N accounts share the load → combined budget = N × Max DD
 *   scaling       = bank in units of Max DD → how many props you can run
 *
 * All settings-synced: uses the same win/stop rule as every other lab.
 */
import type { MoveState } from '../components/assignments/mae-mfe/MoveDashboard';
import { resolveStudy, DEFAULT_STUDY } from '../components/assignments/mae-mfe/maeMfeDocument';
import { applyAttemptFilter } from './maeMfeStats';
import { ASSETS, assetCloseForDate, type AssetTicker } from './assets';
import { runMonteCarlo, mulberry32, percentile } from './monteCarlo';

export interface DoomsdayResult {
  trades: number;
  histLossStreak: number;     // historical longest run of consecutive losers
  mcLossStreak: number;       // Monte-Carlo P95 worst streak (forward-looking doomsday)
  doomsdayStreak: number;     // max(hist, mc) — what you budget for
  riskPerTrade: number;       // $ lost on a stop-out at this size
  doomsdayDrawdown: number;   // $ — worst streak × risk/trade
  perAccountCap: number;      // $ — Account Profile Max DD
  survivesOnOne: boolean;     // doomsday DD fits inside one account's cap
  accountsToSurvive: number;  // rotation needed to absorb the doomsday streak
  combinedBudget: number;     // accountsToSurvive × perAccountCap
  doomsdayPerAccount: number; // $ — max cost one account bears (≤ its cap)
  bankPerProp: number;        // $ — reserve to run one prop = 2× doomsday/account (lesson rule)
  ladder: { props: number; bank: number; survivesStreak: number }[]; // scaling template
}

export interface DoomsdayOpts { sims: number }

/** Compute the Doomsday Budget for one move at the given size + account drawdown cap. */
export function computeDoomsday(ms: MoveState, asset: AssetTicker, contracts: number, maxDrawdown: number, opts: DoomsdayOpts): DoomsdayResult | null {
  const study = resolveStudy(ms, DEFAULT_STUDY);
  const rows = applyAttemptFilter(
    [...study.inSample.rows, ...study.oos1.rows, ...study.oos2.rows, ...study.oos3.rows],
    ms.attemptMode ?? { kind: 'all' },
  );
  if (rows.length < 5) return null;

  const minCf = ms.minCashflowPct;
  const maxMae = ms.maxMaePct ?? 0;
  const pv = ASSETS[asset].pointValueUsd;

  // Per-trade % outcomes (sync contract) + the $ size of each losing trade.
  const rets: number[] = [];
  const lossDollars: number[] = [];
  for (const r of rows) {
    const isWin = r.mfePct >= minCf;
    const stopped = !isWin && maxMae > 0 && r.maePct > maxMae;
    const pct = isWin ? minCf : -(stopped ? maxMae : r.maePct);
    rets.push(pct);
    if (pct < 0) {
      const price = r.refPrice ?? assetCloseForDate(asset, r.tradeDate);
      if (price && price > 0) lossDollars.push((Math.abs(pct) / 100) * price * contracts * pv);
    }
  }

  // Historical longest losing run.
  let run = 0, hist = 0;
  for (const r of rets) { if (r < 0) { run += 1; if (run > hist) hist = run; } else run = 0; }

  // Monte-Carlo P95 worst streak — the forward-looking doomsday streak.
  const mc = runMonteCarlo(rets, { mode: 'bootstrap', sims: opts.sims, rng: mulberry32(1) });
  const mcStreak = mc.lossStreakP95;
  const doomsdayStreak = Math.max(hist, mcStreak, 1);

  // Risk per trade: a fixed stop ⇒ the median loss (≈ the stop $); no stop ⇒ a bad (P90) loss.
  let riskPerTrade = 0;
  if (lossDollars.length) {
    const sorted = lossDollars.slice().sort((a, b) => a - b);
    riskPerTrade = percentile(sorted, maxMae > 0 ? 0.5 : 0.9);
  }

  const doomsdayDrawdown = doomsdayStreak * riskPerTrade;
  const cap = maxDrawdown > 0 ? maxDrawdown : 0;
  const survivesOnOne = cap > 0 ? doomsdayDrawdown <= cap : false;
  const accountsToSurvive = cap > 0 ? Math.max(1, Math.ceil(doomsdayDrawdown / cap)) : 0;
  const combinedBudget = accountsToSurvive * cap;

  // The lesson's scaling rule: doomsday cost one account bears, and keep 2× that
  // as bank per prop (add a prop at 2×, drop below).
  const doomsdayPerAccount = cap > 0 ? Math.min(doomsdayDrawdown, cap) : doomsdayDrawdown;
  const bankPerProp = 2 * doomsdayPerAccount;
  const maxRow = Math.max(accountsToSurvive, 3);
  const ladder = bankPerProp > 0 && riskPerTrade > 0 && cap > 0
    ? Array.from({ length: Math.min(maxRow, 8) }, (_, i) => {
        const props = i + 1;
        return { props, bank: props * bankPerProp, survivesStreak: Math.floor((props * cap) / riskPerTrade) };
      })
    : [];

  return {
    trades: rows.length,
    histLossStreak: hist, mcLossStreak: mcStreak, doomsdayStreak,
    riskPerTrade, doomsdayDrawdown, perAccountCap: cap,
    survivesOnOne, accountsToSurvive, combinedBudget, doomsdayPerAccount, bankPerProp, ladder,
  };
}
