import { seriesMetrics, combinedDailyReturns, computePortfolio } from '../portfolio';
import type { Series } from '../correlation';

const s = (key: string, m: Array<[string, number]>): Series => ({ key, label: key, daily: new Map(m) });

describe('seriesMetrics', () => {
  it('computes total, drawdown, win rate', () => {
    const m = seriesMetrics([0.1, -0.2, 0.1, 0.1]);
    expect(m.total).toBeCloseTo(0.1, 6);
    expect(m.maxDD).toBeLessThan(0);
    expect(m.winRateDays).toBeCloseTo(0.75, 6);
    expect(m.days).toBe(4);
  });
  it('flat series → zero vol and sharpe', () => {
    const m = seriesMetrics([0.1, 0.1, 0.1]);
    expect(m.annVol).toBe(0);
    expect(m.sharpe).toBe(0);
  });
});

describe('combinedDailyReturns', () => {
  it('weights and aligns on the union of dates (absent → 0)', () => {
    const a = new Map([['d1', 0.2], ['d2', 0.4]]);
    const b = new Map([['d2', 0.1], ['d3', 0.3]]);
    const { dates, returns } = combinedDailyReturns([{ daily: a, weight: 0.5 }, { daily: b, weight: 0.5 }]);
    expect(dates).toEqual(['d1', 'd2', 'd3']);
    expect(returns[0]).toBeCloseTo(0.1, 6);  // 0.5*0.2
    expect(returns[1]).toBeCloseTo(0.25, 6); // 0.5*0.4 + 0.5*0.1
    expect(returns[2]).toBeCloseTo(0.15, 6); // 0.5*0.3
  });
});

describe('computePortfolio', () => {
  const A = s('A', [['d1', 0.2], ['d2', -0.2], ['d3', 0.2], ['d4', -0.2]]);
  const B = s('B', [['d1', -0.2], ['d2', 0.2], ['d3', -0.2], ['d4', 0.2]]); // perfect inverse of A

  it('normalizes weights and sums contributions to the total', () => {
    const r = computePortfolio([A, B], [1, 1]);
    expect(r.perMove[0].weight).toBeCloseTo(0.5, 6);
    const contribSum = r.perMove.reduce((sx, p) => sx + p.contribReturn, 0);
    expect(contribSum).toBeCloseTo(r.metrics.total, 6);
  });

  it('inverse series cancel → near-zero vol and big diversification benefit', () => {
    const r = computePortfolio([A, B], [1, 1]);
    expect(r.metrics.annVol).toBeCloseTo(0, 6);     // they cancel each day
    expect(r.diversification).toBeGreaterThan(0.9);  // almost all vol removed
  });

  it('all-zero weights fall back to equal weighting', () => {
    const r = computePortfolio([A, B], [0, 0]);
    expect(r.perMove[0].weight).toBeCloseTo(0.5, 6);
  });

  it('equity path is cumulative', () => {
    const r = computePortfolio([s('C', [['d1', 0.1], ['d2', 0.1]])], [1]);
    expect(r.equity).toEqual([0.1, expect.closeTo(0.2, 6)]);
  });

  it('empty → zeroed', () => {
    const r = computePortfolio([], []);
    expect(r.metrics.total).toBe(0);
    expect(r.perMove.length).toBe(0);
  });
});
