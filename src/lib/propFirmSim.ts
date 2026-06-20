/**
 * propFirmSim — full prop-firm FLIP lifecycle simulator (single account "slot").
 *
 * Models the real economics a prop flipper lives in, resampling a move's daily $:
 *   buy eval (cost) → trade to target under a trailing/locking Max-Loss-Limit and
 *   (optional) daily limit + consistency rule → PASS → funded → take payouts
 *   (after min days, between payout min/max, × profit split, up to max payouts) →
 *   on a bust, pay the reset fee and start a new eval → repeat over the horizon.
 *
 * Net = Σ payouts (after split) − Σ eval/reset costs. Run many sims (Monte Carlo)
 * for the distribution of net profit, payouts collected, and accounts blown.
 *
 * The MLL is the killer: it trails the peak by `maxLossLimit`, then LOCKS once the
 * threshold would rise above `mllLockAt` (Apex-style start+$100). Static = a fixed
 * floor at −maxLossLimit. Equity is tracked relative to the starting balance ($0).
 */
export interface PropFirmRules {
  accountSize: number;
  evalCost: number;
  resetFee: number;          // $ to restart after a bust (0 → rebuy at evalCost)
  evalTarget: number;        // $ profit to pass the eval
  maxLossLimit: number;      // $ MLL (trailing or static)
  ddMode: 'trailing' | 'static';
  mllLockAt: number;         // relative-$ profit where a trailing MLL locks (e.g. +100); ≤0 = never locks
  dailyLossLimit: number;    // $ single-day loss that busts (0 = off)
  evalConsistencyPct: number; // max % of cumulative profit from one day during the eval (0 = off)
  minDaysToPayout: number;   // funded days before a payout is allowed
  payoutMin: number;         // $ minimum profit to take a payout (0 = any)
  payoutMax: number;         // $ cap per payout (0 = uncapped)
  profitSplitPct: number;    // % of profit the trader keeps on payout
  maxPayouts: number;        // stop the account after this many payouts (0 = unlimited)
  maxDays: number;           // horizon (total trading days simulated)
}

export interface PropFirmResult {
  sims: number;
  netMedian: number; netMean: number; netP5: number; netP95: number; // $ net profit
  avgPayouts: number;        // payouts collected per career
  avgBlown: number;          // accounts blown per career
  avgSpend: number;          // $ spent on evals + resets per career
  roiMedian: number;         // net ÷ spend (median across sims)
  avgDaysToFirstPayout: number | null; // days to the first payout (over sims that paid out)
  payoutShare: number;       // share of sims that collected ≥ 1 payout
  evalPassRate: number;      // share of sims that passed the FIRST eval
  profitableShare: number;   // share of sims ending net-positive
}

const EMPTY: PropFirmResult = { sims: 0, netMedian: 0, netMean: 0, netP5: 0, netP95: 0, avgPayouts: 0, avgBlown: 0, avgSpend: 0, roiMedian: 0, avgDaysToFirstPayout: null, payoutShare: 0, evalPassRate: 0, profitableShare: 0 };

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p, lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** The trailing/locking MLL floor (relative $) given the running peak. */
function mllFloor(peak: number, r: PropFirmRules): number {
  if (r.ddMode === 'static') return -r.maxLossLimit;
  const trailing = peak - r.maxLossLimit;
  return r.mllLockAt > 0 ? Math.min(trailing, r.mllLockAt) : trailing;
}

/** One trading "career" over the horizon: returns net $ + payouts + accounts blown. */
function simulateCareer(draw: () => number, r: PropFirmRules): { net: number; payouts: number; blown: number; spend: number; firstPayoutDay: number | null; passedFirst: boolean } {
  let day = 0, net = 0, payouts = 0, blown = 0, spend = 0;
  let firstEval = true, passedFirst = false;
  let firstPayoutDay: number | null = null;
  const minDays = Math.max(0, r.minDaysToPayout);

  while (day < r.maxDays) {
    const cost = firstEval ? r.evalCost : (r.resetFee > 0 ? r.resetFee : r.evalCost);
    net -= cost; spend += cost;
    firstEval = false;

    // ── EVAL phase ──────────────────────────────────────────────
    let eq = 0, peak = 0, biggestDay = 0, passed = false, busted = false;
    while (day < r.maxDays) {
      const d = draw(); day++;
      if (r.dailyLossLimit > 0 && d <= -r.dailyLossLimit) { busted = true; break; }
      eq += d; if (eq > peak) peak = eq;
      if (d > biggestDay) biggestDay = d;
      if (eq <= mllFloor(peak, r)) { busted = true; break; }
      const consistencyOk = r.evalConsistencyPct <= 0 || eq <= 0 || biggestDay <= (r.evalConsistencyPct / 100) * eq;
      if (eq >= r.evalTarget && consistencyOk) { passed = true; break; }
    }
    if (busted) { blown++; continue; }
    if (!passed) break; // horizon ended mid-eval
    if (!passedFirst && payouts === 0) passedFirst = true;

    // ── FUNDED phase ────────────────────────────────────────────
    let feq = 0, fpeak = 0, daysSince = 0, acctPayouts = 0;
    while (day < r.maxDays) {
      const d = draw(); day++; daysSince++;
      if (r.dailyLossLimit > 0 && d <= -r.dailyLossLimit) { blown++; break; }
      feq += d; if (feq > fpeak) fpeak = feq;
      if (feq <= mllFloor(fpeak, r)) { blown++; break; }
      const canPayout = daysSince >= minDays && feq >= Math.max(r.payoutMin, 1);
      if (canPayout) {
        const gross = r.payoutMax > 0 ? Math.min(feq, r.payoutMax) : feq;
        net += gross * (r.profitSplitPct / 100);
        feq -= gross; fpeak = feq > 0 ? feq : 0; daysSince = 0; payouts++; acctPayouts++;
        if (firstPayoutDay === null) firstPayoutDay = day;
        if (r.maxPayouts > 0 && acctPayouts >= r.maxPayouts) break; // account retired
      }
    }
  }
  return { net, payouts, blown, spend, firstPayoutDay, passedFirst };
}

export interface PropFirmOpts { sims: number; rng?: () => number }

/** Monte-Carlo the flip lifecycle over `dailyDollars` (one move's daily $ at size). */
export function runPropFirmSim(dailyDollars: number[], rules: PropFirmRules, opts: PropFirmOpts): PropFirmResult {
  if (dailyDollars.length === 0) return EMPTY;
  const rng = opts.rng ?? Math.random;
  const sims = Math.max(1, opts.sims);
  const draw = () => dailyDollars[Math.floor(rng() * dailyDollars.length)];

  const nets: number[] = [];
  const rois: number[] = [];
  const firstPayoutDays: number[] = [];
  let sumPayouts = 0, sumBlown = 0, sumSpend = 0, passed = 0, profitable = 0, paidOut = 0;
  for (let s = 0; s < sims; s++) {
    const c = simulateCareer(draw, rules);
    nets.push(c.net);
    rois.push(c.spend > 0 ? c.net / c.spend : 0);
    sumPayouts += c.payouts; sumBlown += c.blown; sumSpend += c.spend;
    if (c.firstPayoutDay !== null) { firstPayoutDays.push(c.firstPayoutDay); paidOut++; }
    if (c.passedFirst) passed++;
    if (c.net > 0) profitable++;
  }
  nets.sort((a, b) => a - b);
  rois.sort((a, b) => a - b);
  return {
    sims,
    netMedian: percentile(nets, 0.5),
    netMean: nets.reduce((a, b) => a + b, 0) / sims,
    netP5: percentile(nets, 0.05),
    netP95: percentile(nets, 0.95),
    avgPayouts: sumPayouts / sims,
    avgBlown: sumBlown / sims,
    avgSpend: sumSpend / sims,
    roiMedian: percentile(rois, 0.5),
    avgDaysToFirstPayout: firstPayoutDays.length ? firstPayoutDays.reduce((a, b) => a + b, 0) / firstPayoutDays.length : null,
    payoutShare: paidOut / sims,
    evalPassRate: passed / sims,
    profitableShare: profitable / sims,
  };
}
