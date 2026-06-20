import { moveTradeReturns, mulberry32, percentile, runMonteCarlo } from '../monteCarlo';
import type { MoveState } from '../../components/assignments/mae-mfe/MoveDashboard';

function mk(rows: Array<[string, number, number]>, minCf = 0.1, maxMae = 0): MoveState {
  const r = rows.map(([d, mae, mfe], i) => ({ rowIndex: i + 1, tradeDate: d, maePct: mae, mfePct: mfe, contracts: 5, refPrice: null }));
  return { minCashflowPct: minCf, defaultContracts: 5, maxMaePct: maxMae,
    inSample: { startDate: null, rows: r }, oos1: { startDate: null, rows: [] }, oos2: { startDate: null, rows: [] }, oos3: { startDate: null, rows: [] } };
}

describe('moveTradeReturns — settings-synced per-trade outcomes', () => {
  it('win banks +minCashflow, plain loss = −MAE, stopped loss capped at −MaxMAE', () => {
    const ms = mk([['d1', 0.05, 0.5], ['d2', 0.6, 0.02], ['d3', 0.2, 0.02]], 0.1, 0.3);
    expect(moveTradeReturns(ms)).toEqual([0.1, -0.3, -0.2]);
  });
});

describe('percentile', () => {
  it('interpolates and handles edges', () => {
    const s = [0, 10, 20, 30, 40];
    expect(percentile(s, 0)).toBe(0);
    expect(percentile(s, 1)).toBe(40);
    expect(percentile(s, 0.5)).toBe(20);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a seed and in [0,1)', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 5; i++) { const x = a(); expect(x).toBe(b()); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
  });
});

describe('runMonteCarlo', () => {
  const wins = [0.1, 0.1, 0.1, 0.1]; // all winners

  it('all-winning edge → probProfit 1, no drawdown', () => {
    const r = runMonteCarlo(wins, { mode: 'bootstrap', sims: 200, rng: mulberry32(1) });
    expect(r.probProfit).toBe(1);
    expect(r.maxDDMedian).toBe(0);
    expect(r.finalP50).toBeGreaterThan(0);
  });

  it('percentiles are ordered p5 ≤ p50 ≤ p95', () => {
    const mixed = [0.1, -0.3, 0.1, 0.1, -0.3, 0.1, -0.2, 0.1];
    const r = runMonteCarlo(mixed, { mode: 'bootstrap', sims: 500, rng: mulberry32(7) });
    expect(r.finalP5).toBeLessThanOrEqual(r.finalP50);
    expect(r.finalP50).toBeLessThanOrEqual(r.finalP95);
    expect(r.maxDDWorst5).toBeLessThanOrEqual(r.maxDDMedian); // worst tail is deeper (more negative)
    expect(r.maxDDMedian).toBeLessThanOrEqual(0);
  });

  it('is reproducible: same seed → identical result', () => {
    const mixed = [0.1, -0.3, 0.1, -0.2];
    const a = runMonteCarlo(mixed, { mode: 'bootstrap', sims: 300, rng: mulberry32(99) });
    const b = runMonteCarlo(mixed, { mode: 'bootstrap', sims: 300, rng: mulberry32(99) });
    expect(a.finalP50).toBe(b.finalP50);
    expect(a.probProfit).toBe(b.probProfit);
  });

  it('shuffle mode preserves the deck → every sim ends at the same total', () => {
    const mixed = [0.1, -0.3, 0.1, -0.2];
    const r = runMonteCarlo(mixed, { mode: 'shuffle', sims: 100, rng: mulberry32(3) });
    const total = mixed.reduce((s, x) => s + x, 0);
    expect(r.finalP5).toBeCloseTo(total, 6);
    expect(r.finalP95).toBeCloseTo(total, 6); // order changes, sum doesn't
    expect(r.tradesPerSim).toBe(mixed.length);
  });

  it('ddLimit flags the share of sims breaching the threshold', () => {
    const mixed = [0.1, -0.3, -0.3, -0.3, 0.1];
    const r = runMonteCarlo(mixed, { mode: 'bootstrap', sims: 400, ddLimit: 0.2, rng: mulberry32(5) });
    expect(r.probHitDDLimit).toBeGreaterThan(0);
    expect(r.probHitDDLimit).toBeLessThanOrEqual(1);
  });

  it('bands have one entry per simulated trade', () => {
    const r = runMonteCarlo([0.1, -0.2, 0.1], { mode: 'bootstrap', sims: 50, tradesPerSim: 10, rng: mulberry32(2) });
    expect(r.bands.length).toBe(10);
    expect(r.bands[0].step).toBe(1);
  });

  it('empty input → zeroed result', () => {
    const r = runMonteCarlo([], { mode: 'bootstrap', sims: 100 });
    expect(r.probProfit).toBe(0);
    expect(r.bands.length).toBe(0);
  });
});
