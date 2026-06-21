import type { MoveState } from '../../components/assignments/mae-mfe/MoveDashboard';
import { computeDoomsday, computeDoomsdayFromDollars } from '../doomsdayBudget';
import { runMonteCarlo, mulberry32 } from '../monteCarlo';

function mk(rows: Array<[string, number, number]>, minCf = 0.1, maxMae = 0.3, contracts = 5): MoveState {
  return {
    minCashflowPct: minCf, defaultContracts: contracts, maxMaePct: maxMae,
    inSample: { startDate: null, rows: rows.map(([d, mae, mfe], i) => ({ rowIndex: i + 1, tradeDate: d, maePct: mae, mfePct: mfe, contracts, refPrice: 2000 })) },
    oos1: { startDate: null, rows: [] }, oos2: { startDate: null, rows: [] }, oos3: { startDate: null, rows: [] },
  };
}
// Mostly losers so there's a real streak; refPrice fixed at 2000 → deterministic $.
const days = Array.from({ length: 30 }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`);
const rows = days.map((d, i) => [d, 0.5, i % 4 === 0 ? 0.4 : 0.02] as [string, number, number]); // ~25% win

describe('computeDoomsday', () => {
  const r = computeDoomsday(mk(rows), 'RTY', 5, 2000, { sims: 200 })!;
  it('computes a worst streak, risk/trade, and doomsday drawdown', () => {
    expect(r).not.toBeNull();
    expect(r.doomsdayStreak).toBeGreaterThanOrEqual(r.histLossStreak);
    expect(r.doomsdayStreak).toBeGreaterThanOrEqual(r.mcLossStreak);
    expect(r.riskPerTrade).toBeGreaterThan(0);
    expect(r.doomsdayDrawdown).toBeCloseTo(r.doomsdayStreak * r.riskPerTrade, 6);
  });
  it('survival flips with the account cap', () => {
    const tiny = computeDoomsday(mk(rows), 'RTY', 5, 100, { sims: 200 })!;   // tiny cap
    const huge = computeDoomsday(mk(rows), 'RTY', 5, 1_000_000, { sims: 200 })!; // huge cap
    expect(tiny.survivesOnOne).toBe(false);
    expect(tiny.accountsToSurvive).toBeGreaterThan(1);
    expect(huge.survivesOnOne).toBe(true);
    expect(huge.accountsToSurvive).toBe(1);
  });
  it('scaling ladder reserves 2× the per-account doomsday per prop', () => {
    expect(r.bankPerProp).toBeCloseTo(2 * r.doomsdayPerAccount, 6);
    if (r.ladder.length >= 2) expect(r.ladder[1].bank).toBeCloseTo(2 * r.bankPerProp, 6);
  });
  it('returns null below the 5-trade minimum', () => {
    expect(computeDoomsday(mk(rows.slice(0, 3)), 'RTY', 5, 2000, { sims: 50 })).toBeNull();
  });
});

describe('computeDoomsdayFromDollars (combined basket)', () => {
  // A combined-basket daily P&L series: mostly small wins with periodic losing runs.
  const dollars = Array.from({ length: 40 }, (_, i) => (i % 5 === 0 || i % 5 === 1 ? -120 : 60));
  it('builds a doomsday budget from a precomputed $ series', () => {
    const r = computeDoomsdayFromDollars(dollars, 2000, { sims: 200 })!;
    expect(r).not.toBeNull();
    expect(r.trades).toBe(40);
    expect(r.histLossStreak).toBeGreaterThanOrEqual(2); // two losers in a row each cycle
    expect(r.riskPerTrade).toBeGreaterThan(0);
    expect(r.doomsdayDrawdown).toBeCloseTo(r.doomsdayStreak * r.riskPerTrade, 6);
  });
  it('survival scales with the account cap', () => {
    const tiny = computeDoomsdayFromDollars(dollars, 100, { sims: 200 })!;
    expect(tiny.survivesOnOne).toBe(false);
    expect(tiny.accountsToSurvive).toBeGreaterThan(1);
  });
  it('returns null below the 5-period minimum', () => {
    expect(computeDoomsdayFromDollars([-1, 2, -3], 2000, { sims: 50 })).toBeNull();
  });
});

describe('runMonteCarlo loss-streak stats', () => {
  it('reports a P95 loss streak ≥ P50 for a losing-heavy deck', () => {
    const rets = Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? 0.1 : -0.3)); // mostly losers
    const mc = runMonteCarlo(rets, { mode: 'bootstrap', sims: 500, rng: mulberry32(1) });
    expect(mc.lossStreakP95).toBeGreaterThanOrEqual(mc.lossStreakP50);
    expect(mc.lossStreakP95).toBeGreaterThan(1);
  });
});
