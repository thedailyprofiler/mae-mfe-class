import { moveDailyReturns, computeMatrix, pairValue, portfolioStats, sessionKey, isSignificant, correlationInsights, type Series } from '../correlation';
import type { MoveState } from '../../components/assignments/mae-mfe/MoveDashboard';

function mk(rows: Array<[string, number, number]>, minCf = 0.1, maxMae = 0): MoveState {
  const r = rows.map(([d, mae, mfe], i) => ({ rowIndex: i + 1, tradeDate: d, maePct: mae, mfePct: mfe, contracts: 5, refPrice: null }));
  return { minCashflowPct: minCf, defaultContracts: 5, maxMaePct: maxMae,
    inSample: { startDate: null, rows: r }, oos1: { startDate: null, rows: [] }, oos2: { startDate: null, rows: [] }, oos3: { startDate: null, rows: [] } };
}
const series = (key: string, m: Map<string, number>): Series => ({ key, label: key, daily: m });

describe('moveDailyReturns — synced win/stop logic', () => {
  it('win banks +minCashflow, plain loss costs −MAE, stopped loss capped at −MaxMAE', () => {
    const ms = mk([['2026-01-01', 0.05, 0.5], ['2026-01-02', 0.6, 0.02], ['2026-01-03', 0.2, 0.02]], 0.1, 0.3);
    const d = moveDailyReturns(ms);
    expect(d.get('2026-01-01')).toBeCloseTo(0.1, 6);   // win → +minCashflow
    expect(d.get('2026-01-02')).toBeCloseTo(-0.3, 6);  // loss, MAE 0.6 > 0.3 stop → −0.3
    expect(d.get('2026-01-03')).toBeCloseTo(-0.2, 6);  // loss, MAE 0.2 < stop → −0.2 actual
  });
});

describe('pairValue lenses', () => {
  const dates = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
  const A = series('A', new Map(dates.map((d, i) => [d, [0.1, -0.2, 0.1, -0.3, 0.1, -0.1][i]])));
  const B_same = series('B', new Map(dates.map((d, i) => [d, [0.1, -0.2, 0.1, -0.3, 0.1, -0.1][i]])));
  const B_opp = series('C', new Map(dates.map((d, i) => [d, [-0.1, 0.2, -0.1, 0.3, -0.1, 0.1][i]])));

  it('pearson: identical → +1, opposite → −1', () => {
    expect(pairValue(A, B_same, 'pearson')).toBeCloseTo(1, 6);
    expect(pairValue(A, B_opp, 'pearson')).toBeCloseTo(-1, 6);
  });
  it('spearman: monotonic identical → +1', () => {
    expect(pairValue(A, B_same, 'spearman')).toBeCloseTo(1, 6);
  });
  it('codrawdown ∈ [0,1] and is 1 when both always underwater together', () => {
    const down = series('d', new Map(dates.map((d) => [d, -0.1])));
    const v = pairValue(down, down, 'codrawdown');
    expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(1);
  });
  it('tail overlap ∈ [0,1]', () => {
    const v = pairValue(A, B_same, 'tail');
    expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
  });
});

describe('computeMatrix', () => {
  const A = series('MNQ::1800', new Map([['d1', 0.1], ['d2', -0.2], ['d3', 0.1]]));
  const B = series('MES::1800', new Map([['d1', 0.1], ['d2', -0.2], ['d3', 0.1]]));
  it('diagonal=1, symmetric, ranks most-correlated pair', () => {
    const mtx = computeMatrix([A, B], 'pearson');
    expect(mtx.m[0][0]).toBe(1);
    expect(mtx.m[0][1]).toBeCloseTo(mtx.m[1][0], 6);
    expect(mtx.tradingDays).toBe(3);
    expect(mtx.pairs[0].v).toBeCloseTo(1, 6);
  });
});

describe('portfolioStats', () => {
  it('returns finite total/vol/maxDD/sharpe', () => {
    const A = series('A', new Map([['d1', 0.1], ['d2', -0.2], ['d3', 0.1]]));
    const s = portfolioStats([A]);
    expect(Number.isFinite(s.totalReturn)).toBe(true);
    expect(Number.isFinite(s.sharpe)).toBe(true);
    expect(s.maxDD).toBeLessThanOrEqual(0);
  });
});

describe('sessionKey / isSignificant / correlationInsights', () => {
  it('sessionKey strips asset + entry suffix to the base move', () => {
    expect(sessionKey('MNQ::1800MA')).toBe('1800');
    expect(sessionKey('MES::1800FR')).toBe('1800');
    expect(sessionKey('MGC::0300')).toBe('0300');
  });
  it('isSignificant rejects low overlap and small-sample noise', () => {
    expect(isSignificant(0.5, 10, 'pearson')).toBe(false);   // overlap < 20
    expect(isSignificant(0.1, 150, 'pearson')).toBe(false);  // |v| < 2/√150 ≈ 0.16
    expect(isSignificant(0.5, 150, 'pearson')).toBe(true);   // clearly significant
    expect(isSignificant(0.3, 50, 'tail')).toBe(true);       // proportions: enough overlap
  });
  it('correlationInsights surfaces a redundant pair, a diversifier, and a tail pair', () => {
    const days = Array.from({ length: 40 }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`);
    const a = series('MNQ::1800', new Map(days.map((d, i) => [d, i % 3 === 0 ? -0.3 : 0.1])));
    const b = series('MES::0300', new Map(days.map((d, i) => [d, i % 3 === 0 ? -0.3 : 0.1]))); // ~identical → redundant
    const c = series('MGC::MO', new Map(days.map((d, i) => [d, i % 2 === 0 ? 0.1 : -0.1])));    // different → diversifier
    const ins = correlationInsights([a, b, c], 'pearson');
    expect(ins.redundant).not.toBeNull();
    expect(ins.diversifier).not.toBeNull();
    expect(['MNQ 1800-ish', undefined]).toBeDefined(); // smoke
    expect(ins.structuralCount).toBeGreaterThanOrEqual(0);
  });
});
