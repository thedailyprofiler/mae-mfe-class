import { runPropFirmSim, type PropFirmRules } from '../propFirmSim';
import { mulberry32 } from '../monteCarlo';

const rules: PropFirmRules = {
  accountSize: 50000, evalCost: 150, resetFee: 100, evalTarget: 3000, maxLossLimit: 2500,
  ddMode: 'trailing', mllLockAt: 100, dailyLossLimit: 0, evalConsistencyPct: 0,
  minDaysToPayout: 5, payoutMin: 500, payoutMax: 3000, profitSplitPct: 90, maxPayouts: 0, maxDays: 120,
};

// A winning deck (steady +$200, occasional −$300) vs a losing deck.
const winner = Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? -300 : 200));
const loser = Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? 250 : -300));

describe('runPropFirmSim (flip lifecycle)', () => {
  it('returns a coherent result with rates in range', () => {
    const r = runPropFirmSim(winner, rules, { sims: 300, rng: mulberry32(1) });
    expect(r.sims).toBe(300);
    expect(r.evalPassRate).toBeGreaterThanOrEqual(0);
    expect(r.evalPassRate).toBeLessThanOrEqual(1);
    expect(r.profitableShare).toBeGreaterThanOrEqual(0);
    expect(r.avgBlown).toBeGreaterThanOrEqual(0);
    expect(r.netP5).toBeLessThanOrEqual(r.netP95);
  });
  it('a winning deck passes and collects payouts; a losing deck blows accounts and loses money', () => {
    const win = runPropFirmSim(winner, rules, { sims: 400, rng: mulberry32(2) });
    const lose = runPropFirmSim(loser, rules, { sims: 400, rng: mulberry32(2) });
    expect(win.evalPassRate).toBeGreaterThan(lose.evalPassRate);
    expect(win.avgPayouts).toBeGreaterThan(lose.avgPayouts);
    expect(win.netMean).toBeGreaterThan(lose.netMean);
    expect(lose.netMean).toBeLessThan(0); // bleeds eval/reset fees
  });
  it('empty deck → empty result', () => {
    expect(runPropFirmSim([], rules, { sims: 100 }).sims).toBe(0);
  });
});
