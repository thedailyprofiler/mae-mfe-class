/**
 * propFirms — editable preset eval rules for the common futures prop firms.
 *
 * ⚠️ APPROXIMATE. Prop-firm rules + prices change constantly and vary by promo —
 * these are reasonable starting points keyed off the $50k tier, scaled to other
 * sizes. ALWAYS confirm against the firm's live rules and edit the fields.
 *
 * Fields map to the sim as: evalTarget → profit target, maxLossLimit → max
 * drawdown (trailing), minDaysToPayout → min trading days, evalCost → flip cost,
 * payout (= min(target, payoutMax) × split) → what a pass nets before cost.
 */
export interface FirmPreset {
  id: string;
  firm: string;
  ddMode: 'trailing' | 'static';
  // $50k-tier base values (scaled by accountSize / 50000 for other tiers).
  evalCost: number;       // $ to buy the eval
  resetFee: number;       // $ to reset after a bust (0 = rebuy at evalCost)
  evalTarget: number;     // $ profit to pass
  maxLossLimit: number;   // $ trailing/static max loss (MLL)
  dailyLossLimit: number; // $ (0 = none)
  minDaysToPayout: number;
  consistencyPct: number; // max % of total profit from one day (0 = none)
  payoutMax: number;      // $ cap per payout (0 = none)
  profitSplitPct: number; // % of profit the trader keeps
}

/** Base presets at the $50k tier (approximate — edit to the firm's live rules). */
export const FIRM_PRESETS: FirmPreset[] = [
  { id: 'apex',     firm: 'Apex',          ddMode: 'trailing', evalCost: 147, resetFee: 80,  evalTarget: 3000, maxLossLimit: 2500, dailyLossLimit: 0,    minDaysToPayout: 1, consistencyPct: 30, payoutMax: 0,    profitSplitPct: 100 },
  { id: 'topstep',  firm: 'Topstep',       ddMode: 'trailing', evalCost: 49,  resetFee: 49,  evalTarget: 3000, maxLossLimit: 2000, dailyLossLimit: 1000, minDaysToPayout: 2, consistencyPct: 50, payoutMax: 0,    profitSplitPct: 90  },
  { id: 'tpt',      firm: 'Take Profit',   ddMode: 'trailing', evalCost: 150, resetFee: 0,   evalTarget: 3000, maxLossLimit: 2000, dailyLossLimit: 0,    minDaysToPayout: 0, consistencyPct: 0,  payoutMax: 0,    profitSplitPct: 90  },
  { id: 'lucid',    firm: 'Lucid',         ddMode: 'trailing', evalCost: 87,  resetFee: 87,  evalTarget: 3000, maxLossLimit: 2000, dailyLossLimit: 0,    minDaysToPayout: 5, consistencyPct: 20, payoutMax: 3000, profitSplitPct: 90  },
  { id: 'alpha',    firm: 'Alpha Futures', ddMode: 'trailing', evalCost: 99,  resetFee: 99,  evalTarget: 3000, maxLossLimit: 2500, dailyLossLimit: 0,    minDaysToPayout: 5, consistencyPct: 0,  payoutMax: 0,    profitSplitPct: 90  },
  { id: 'tradeify', firm: 'Tradeify',      ddMode: 'trailing', evalCost: 99,  resetFee: 99,  evalTarget: 3000, maxLossLimit: 2000, dailyLossLimit: 0,    minDaysToPayout: 5, consistencyPct: 20, payoutMax: 3000, profitSplitPct: 90  },
];

export const FIRM_SIZES = [50000, 100000, 150000, 250000];

/** Scale a $50k-base preset to the chosen account size (target/MLL/cost/payout scale linearly). */
export function scalePreset(p: FirmPreset, accountSize: number) {
  const k = accountSize / 50000;
  const r2 = (n: number) => Math.round(n);
  return {
    accountSize,
    evalCost: r2(p.evalCost * (0.6 + 0.4 * k)),   // cost rises sub-linearly with size
    resetFee: r2(p.resetFee * (0.6 + 0.4 * k)),
    profitTarget: r2(p.evalTarget * k),
    maxDrawdown: r2(p.maxLossLimit * k),
    dailyLossLimit: r2(p.dailyLossLimit * k),
    minTradingDays: p.minDaysToPayout,
    ddMode: p.ddMode,
    consistencyPct: p.consistencyPct,
    payoutMax: r2(p.payoutMax * k),
    profitSplitPct: p.profitSplitPct,
  };
}

/** The $ a single pass nets before the eval cost: min(target, payoutMax) × split. */
export function passPayout(profitTarget: number, payoutMax: number, profitSplitPct: number): number {
  const gross = payoutMax > 0 ? Math.min(profitTarget, payoutMax) : profitTarget;
  return gross * (profitSplitPct / 100);
}
