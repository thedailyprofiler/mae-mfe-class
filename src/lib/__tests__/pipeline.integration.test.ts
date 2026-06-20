/**
 * End-to-end pipeline stress test.
 *
 * Builds a realistic multi-asset document — including the 0300 / Market Open (MO)
 * / Lunch Break (LB) built-in moves *with data* — and drives EVERY analysis lab
 * (correlation, monte carlo, prop sim, recommendations, portfolio) through it,
 * asserting cross-engine invariants and the settings-sync contract.
 *
 * Purpose: guarantee that the moment 0300/MO/LB MAE/MFE is collected and loaded
 * the SAME way as 1800, the whole dashboard picks it up correctly — and that all
 * five labs agree on the underlying numbers.
 */
import type { MaeMfeDocument } from '../../components/assignments/mae-mfe/maeMfeDocument';
import type { MoveState } from '../../components/assignments/mae-mfe/MoveDashboard';
import { buildSeries, computeMatrix, moveDailyReturns } from '../correlation';
import { moveTradeReturns, runMonteCarlo, mulberry32 as mcRng } from '../monteCarlo';
import { buildDollarSeries, moveDailyDollars, runPropSim, mulberry32, type PropRules } from '../propSim';
import { recommend } from '../recommendations';
import { computePortfolio } from '../portfolio';

// Build a MoveState from [date, maePct, mfePct] rows.
function mk(rows: Array<[string, number, number]>, minCf = 0.1, maxMae = 0, contracts = 5): MoveState {
  return {
    minCashflowPct: minCf, defaultContracts: contracts, maxMaePct: maxMae,
    inSample: { startDate: null, rows: rows.map(([d, mae, mfe], i) => ({ rowIndex: i + 1, tradeDate: d, maePct: mae, mfePct: mfe, contracts, refPrice: null })) },
    oos1: { startDate: null, rows: [] }, oos2: { startDate: null, rows: [] }, oos3: { startDate: null, rows: [] },
  };
}
// 20 trading days of varied outcomes (dates inside the bundled price-table range).
const days = Array.from({ length: 20 }, (_, i) => `2026-02-${String(i + 2).padStart(2, '0')}`);
const winnerRows = days.map((d, i) => [d, i % 5 === 0 ? 0.4 : 0.05, i % 5 === 0 ? 0.03 : 0.5] as [string, number, number]); // mostly wins
const mixedRows = days.map((d, i) => [d, i % 2 ? 0.5 : 0.06, i % 2 ? 0.04 : 0.4] as [string, number, number]);
const loserRows = days.map((d) => [d, 0.6, 0.02] as [string, number, number]); // mostly losses

const doc: MaeMfeDocument = {
  MNQ: { '1800': mk(mixedRows, 0.1, 0.3), '0300': mk(winnerRows), MO: mk(loserRows), LB: mk(mixedRows) },
  MGC: { '1800': mk(winnerRows) },
  RTY: { '1800': mk(mixedRows) }, // priced via reference price only
} as unknown as MaeMfeDocument;

const moveLabel = (m: string) => ({ '1800': '1800', '0300': '0300', MO: 'Market Open', LB: 'Lunch Break' }[m] ?? m);
const rules: PropRules = { accountSize: 50000, profitTarget: 3000, maxDrawdown: 2000, ddMode: 'trailing', dailyLossLimit: 0, minTradingDays: 0, maxDays: 60 };

describe('pipeline: built-in 0300 / MO / LB moves flow through every lab', () => {
  it('correlation series include the built-in moves once populated', () => {
    const series = buildSeries(doc, moveLabel);
    const keys = series.map((s) => s.key);
    expect(keys).toContain('MNQ::0300');
    expect(keys).toContain('MNQ::MO');
    expect(keys).toContain('MNQ::LB');
    expect(keys).toContain('RTY::1800');
  });

  it('correlation matrix is square, symmetric, unit-diagonal, values in [-1,1]', () => {
    const m = computeMatrix(buildSeries(doc, moveLabel), 'pearson');
    const n = m.series.length;
    for (let i = 0; i < n; i++) {
      expect(m.m[i][i]).toBe(1);
      for (let j = 0; j < n; j++) {
        expect(m.m[i][j]).toBeCloseTo(m.m[j][i], 10);
        expect(m.m[i][j]).toBeGreaterThanOrEqual(-1.000001);
        expect(m.m[i][j]).toBeLessThanOrEqual(1.000001);
      }
    }
  });

  it('monte carlo on a built-in move is finite and ordered', () => {
    const r = runMonteCarlo(moveTradeReturns(doc.MNQ['0300']), { mode: 'bootstrap', sims: 300, rng: mcRng(1) });
    expect(Number.isFinite(r.finalP50)).toBe(true);
    expect(r.finalP5).toBeLessThanOrEqual(r.finalP95);
    expect(r.bands.length).toBeGreaterThan(0);
  });

  it('prop sim rates sum to 1 for every dollar series (incl. RTY via ref price)', () => {
    const ds = buildDollarSeries(doc, moveLabel, 5, 2300);
    expect(ds.some((s) => s.asset === 'RTY')).toBe(true);
    for (const s of ds) {
      const r = runPropSim(s.dollars, rules, { mode: 'bootstrap', sims: 200, rng: mulberry32(2) });
      expect(r.passRate + r.bustRate + r.activeRate).toBeCloseTo(1, 6);
    }
  });

  it('recommendations rank across all moves, normalized, losers excluded from edge objectives', () => {
    const ds = buildDollarSeries(doc, moveLabel, 5, 2300);
    const r = recommend(ds, rules, { sims: 400, rng: mulberry32(3) });
    expect(r.bestOverall).not.toBeNull();
    for (const key of ['fastest', 'safest', 'bestOverall', 'diversifier'] as const) {
      const sum = r.weights[key].reduce((s, a) => s + a.weight, 0);
      expect(sum).toBeCloseTo(1, 6);
    }
    expect(r.weights.safest.some((a) => a.key === 'MNQ::MO')).toBe(false); // MO is the loser
  });

  it('portfolio contributions sum to the blended total', () => {
    const series = buildSeries(doc, moveLabel);
    const p = computePortfolio(series, series.map(() => 1));
    const contribSum = p.perMove.reduce((s, m) => s + m.contribReturn, 0);
    expect(contribSum).toBeCloseTo(p.metrics.total, 6);
    expect(Number.isFinite(p.metrics.sharpe)).toBe(true);
    expect(p.metrics.maxDD).toBeLessThanOrEqual(0);
  });
});

describe('pipeline: settings-sync contract holds across engines', () => {
  it('Max MAE capping reduces losses identically wherever a move is consumed', () => {
    const noCap = mk(mixedRows, 0.1, 0);
    const capped = mk(mixedRows, 0.1, 0.3);
    // daily-return engine (correlation/portfolio)
    const totNo = [...moveDailyReturns(noCap).values()].reduce((s, x) => s + x, 0);
    const totCap = [...moveDailyReturns(capped).values()].reduce((s, x) => s + x, 0);
    expect(totCap).toBeGreaterThanOrEqual(totNo); // capping losses can only help
    // dollar engine (prop sim) sees the same effect
    const dNo = moveDailyDollars(noCap, 'MNQ', 5, 2300).dollars.reduce((s, x) => s + x, 0);
    const dCap = moveDailyDollars(capped, 'MNQ', 5, 2300).dollars.reduce((s, x) => s + x, 0);
    expect(dCap).toBeGreaterThanOrEqual(dNo);
  });

  it('position size scales prop-sim dollars linearly (2× contracts → 2× daily $)', () => {
    const one = moveDailyDollars(doc.MGC['1800'], 'MGC', 1, 2300).dollars;
    const two = moveDailyDollars(doc.MGC['1800'], 'MGC', 2, 2300).dollars;
    for (let i = 0; i < one.length; i++) expect(two[i]).toBeCloseTo(one[i] * 2, 6);
  });

  it('a win banks +Min Cashflow and a stopped loss caps at −Max MAE (same rule in % and $)', () => {
    const ms = mk([['2026-02-03', 0.05, 0.5], ['2026-02-04', 0.6, 0.02]], 0.1, 0.3);
    const daily = moveDailyReturns(ms);
    expect(daily.get('2026-02-03')).toBeCloseTo(0.1, 6);   // win
    expect(daily.get('2026-02-04')).toBeCloseTo(-0.3, 6);  // stopped loss capped
  });
});
