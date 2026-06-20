import { combineByDate, streamStats, deriveSource, combinedStats, countUnpriced } from '../maeMfeCombine';
import { computeDatasetDashboard, type DatasetConfig, type DerivedRow, type RawRow } from '../maeMfeStats';
import { ASSETS } from '../assets';

// Minimal DerivedRow for stream tests (only tradeDate + netCashflow are read).
function dr(tradeDate: string, netCashflow: number | null): DerivedRow {
  return {
    rowIndex: 0, tradeDate, maePct: 0, mfePct: 0, contracts: 0, refPrice: null,
    isWin: (netCashflow ?? 0) > 0, dollarPerBpPerContract: null,
    dollarMAE: null, dollarMFE: null, netCashflow, winStreak: null,
  };
}

function raw(tradeDate: string, maePct: number, mfePct: number, refPrice: number, contracts = 5): RawRow {
  return { rowIndex: 1, tradeDate, maePct, mfePct, contracts, refPrice };
}

describe('combineByDate', () => {
  it('sums same-day P&L across multiple sources (dollar-space)', () => {
    const a = [dr('2026-01-01', 100), dr('2026-01-02', -50)];
    const b = [dr('2026-01-01', 30)];
    const days = combineByDate([a, b]);
    expect(days).toEqual([
      { tradeDate: '2026-01-01', pnl: 130, trades: 2 },
      { tradeDate: '2026-01-02', pnl: -50, trades: 1 },
    ]);
  });

  it('skips rows with no resolvable price (null netCashflow)', () => {
    const a = [dr('2026-01-01', 100), dr('2026-01-03', null)];
    expect(combineByDate([a])).toEqual([{ tradeDate: '2026-01-01', pnl: 100, trades: 1 }]);
    expect(countUnpriced([a])).toBe(1);
  });

  it('returns days sorted by date', () => {
    const a = [dr('2026-03-01', 1), dr('2026-01-01', 1), dr('2026-02-01', 1)];
    expect(combineByDate([a]).map((d) => d.tradeDate)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('skips rows with no trade date', () => {
    const a = [dr('', 100), dr('2026-01-01', 50)];
    expect(combineByDate([a])).toEqual([{ tradeDate: '2026-01-01', pnl: 50, trades: 1 }]);
  });
});

describe('streamStats', () => {
  it('computes total, win days, drawdown, and final equity', () => {
    const days = [
      { tradeDate: '2026-01-01', pnl: 130, trades: 2 },
      { tradeDate: '2026-01-02', pnl: -50, trades: 1 },
      { tradeDate: '2026-01-03', pnl: 20, trades: 1 },
    ];
    const s = streamStats(days);
    expect(s.totalPnl).toBe(100);
    expect(s.days).toBe(3);
    expect(s.trades).toBe(4);
    expect(s.winDays).toBe(2);
    expect(s.winRateByDay).toBeCloseTo(2 / 3);
    expect(s.bestDay).toBe(130);
    expect(s.worstDay).toBe(-50);
    expect(s.maxDrawdown).toBe(-50); // peak 130 → dipped to 80
    expect(s.finalEquity).toBe(100);
    expect(s.equityCurve.map((e) => e.equity)).toEqual([130, 80, 100]);
  });

  it('empty stream is all zeros / nulls', () => {
    const s = streamStats([]);
    expect(s.totalPnl).toBe(0);
    expect(s.winRateByDay).toBeNull();
    expect(s.maxDrawdown).toBe(0);
  });
});

describe('deriveSource (dollar valuation)', () => {
  it('values wins at the min-cashflow target and losses at -MAE', () => {
    // MNQ pv=$2. winCashflow = (0.1/100)*20000*2*5 = 200; loss MAE = (0.2/100)*20000*2*5 = 400.
    const derived = deriveSource({
      ticker: 'MNQ', move: '1800', minCashflowPct: 0.1, defaultContracts: 5,
      rows: [raw('2026-01-01', 0.05, 0.3, 20000), raw('2026-01-02', 0.2, 0.0, 20000)],
    });
    expect(derived[0].netCashflow).toBeCloseTo(200);  // win
    expect(derived[1].netCashflow).toBeCloseTo(-400); // loss
  });

  it('applies the Max-MAE stop so Compare/Cycle cap losses like the other labs', () => {
    // MNQ pv=$2, 5ct, ref 20000. Loss with MAE 0.6% but a 0.3% stop → capped at -0.3%.
    // capped: (0.3/100)*20000*2*5 = 600; uncapped would be (0.6/100)*…*5 = 1200.
    const stopped = deriveSource({ ticker: 'MNQ', move: '1800', minCashflowPct: 0.1, maxMaePct: 0.3, defaultContracts: 5, rows: [raw('2026-01-02', 0.6, 0.0, 20000)] });
    expect(stopped[0].netCashflow).toBeCloseTo(-600); // capped at the stop, not -1200
    const noStop = deriveSource({ ticker: 'MNQ', move: '1800', minCashflowPct: 0.1, maxMaePct: 0, defaultContracts: 5, rows: [raw('2026-01-02', 0.6, 0.0, 20000)] });
    expect(noStop[0].netCashflow).toBeCloseTo(-1200); // no stop → full MAE loss
  });

  it('cross-asset combine equals the sum of each asset\'s own $ valuation', () => {
    const mnq = deriveSource({ ticker: 'MNQ', move: '1800', minCashflowPct: 0.1, defaultContracts: 5, rows: [raw('2026-01-01', 0.05, 0.3, 20000)] });
    const mes = deriveSource({ ticker: 'MES', move: '0300', minCashflowPct: 0.1, defaultContracts: 5, rows: [raw('2026-01-01', 0.05, 0.3, 6000)] });
    const days = combineByDate([mnq, mes]);
    expect(days).toHaveLength(1);
    expect(days[0].trades).toBe(2);
    expect(days[0].pnl).toBeCloseTo((mnq[0].netCashflow ?? 0) + (mes[0].netCashflow ?? 0));
  });
});

describe('combinedStats', () => {
  it('derives, combines, and computes in one call', () => {
    const { stats, days, unpriced } = combinedStats([
      { ticker: 'MNQ', move: '1800', minCashflowPct: 0.1, defaultContracts: 5, rows: [raw('2026-01-01', 0.05, 0.3, 20000)] },
    ]);
    expect(unpriced).toBe(0);
    expect(days).toHaveLength(1);
    expect(stats.totalPnl).toBeCloseTo(200);
  });

  // CROSS-VALIDATION: the new combine engine's total must equal the proven
  // dashboard engine's totalPnl for the same single-source rows (same netCashflow
  // basis). This ties the new math to the audited XLSX-replicating engine.
  it('single-source combine total === computeDatasetDashboard totalPnl (all priced)', () => {
    const rows = [
      raw('2026-01-01', 0.05, 0.3, 20000),  // win
      raw('2026-01-02', 0.2, 0.0, 20000),   // loss
      raw('2026-01-05', 0.12, 0.5, 21000),  // win
      raw('2026-01-06', 0.3, 0.04, 19500),  // loss
    ];
    const pv = ASSETS.MNQ.pointValueUsd;
    const cfg: DatasetConfig = { id: 'x', gunshipMove: '1800', sampleType: 'IN_SAMPLE', minCashflowPct: 0.1, defaultContracts: 5, pointValueUsd: pv, label: null };
    const dashTotal = computeDatasetDashboard(rows, cfg).snapshot.totalPnl;
    const combineTotal = combinedStats([{ ticker: 'MNQ', move: '1800', minCashflowPct: 0.1, defaultContracts: 5, rows }]).stats.totalPnl;
    expect(combineTotal).toBeCloseTo(dashTotal);
  });
});
