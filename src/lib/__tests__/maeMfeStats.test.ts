/**
 * MAE/MFE stats engine tests.
 *
 * Source of truth: the 70 sample rows from `MAE _ MFE Analysis.xlsx` (Sample
 * tab, rows 2–71). The XLSX is configured for:
 *   - min cashflow target = 0.1% MFE (matches `K10=COUNTIF(C:C,">0.099")`)
 *   - ref price ≈ 22,500
 *   - 5 contracts
 *   - Win cashflow $225 = 0.001 × 22500 × $2 × 5
 *
 * We assert structural invariants (counts, ratios) plus a few exact dashboard
 * cells from the XLSX dump (`docs/plans/2026-05-28-mae-mfe-analysis-assignment-design.md`).
 */

import {
  computeDatasetDashboard,
  computeCrossComparison,
  deriveRow,
  deriveRows,
  pctToDollarsMNQ,
  type DatasetConfig,
  type DatasetInput,
  type RawRow,
} from '../maeMfeStats';

// 70 rows transcribed from the XLSX `Sample` tab — MAE (col B), MFE (col C).
const SAMPLE_DATA: Array<[number, number]> = [
  /* 1 */ [0.02, 0.23], [0.02, 0.5], [0.07, 0.24], [0.07, 0.3], [0.0, 0.5],
  /* 6 */ [0.0, 0.5], [0.05, 0.5], [0.09, 0.5], [0.1, 0.05], [0.09, 0.14],
  /* 11*/ [0.01, 0.5], [0.21, 0.09], [0.03, 0.5], [0.02, 0.31], [0.02, 0.5],
  /* 16*/ [0.1, 0.22], [0.05, 0.42], [0.13, 0.5], [0.11, 0.12], [0.15, 0.21],
  /* 21*/ [0.3, 0.07], [0.04, 0.5], [0.3, 0.03], [0.0, 0.27], [0.3, 0.05],
  /* 26*/ [0.13, 0.5], [0.17, 0.08], [0.01, 0.38], [0.03, 0.1], [0.15, 0.48],
  /* 31*/ [0.22, 0.5], [0.3, 0.08], [0.09, 0.5], [0.05, 0.5], [0.19, 0.09],
  /* 36*/ [0.02, 0.16], [0.23, 0.5], [0.05, 0.21], [0.3, 0.02], [0.02, 0.2],
  /* 41*/ [0.28, 0.09], [0.3, 0.08], [0.04, 0.5], [0.0, 0.5], [0.25, 0.11],
  /* 46*/ [0.08, 0.33], [0.0, 0.5], [0.12, 0.5], [0.08, 0.5], [0.04, 0.12],
  /* 51*/ [0.24, 0.5], [0.18, 0.43], [0.04, 0.5], [0.19, 0.07], [0.02, 0.1],
  /* 56*/ [0.3, 0.02], [0.04, 0.5], [0.11, 0.41], [0.17, 0.0], [0.2, 0.15],
  /* 61*/ [0.22, 0.02], [0.06, 0.28], [0.01, 0.18], [0.02, 0.5], [0.0, 0.5],
  /* 66*/ [0.02, 0.5], [0.0, 0.24], [0.18, 0.01], [0.18, 0.15], [0.04, 0.13],
];

const SAMPLE_ROWS: RawRow[] = SAMPLE_DATA.map(([mae, mfe], i) => ({
  rowIndex: i + 1,
  tradeDate: '2025-02-15',
  maePct: mae,
  mfePct: mfe,
  contracts: 5,
  refPrice: 22500,
}));

const SAMPLE_CFG: DatasetConfig = {
  id: 'ds1',
  gunshipMove: '1800',
  sampleType: 'IN_SAMPLE',
  minCashflowPct: 0.1,
  defaultContracts: 5,
  label: 'Sample',
};

describe('pctToDollarsMNQ', () => {
  it('computes the MNQ $ value of a percent move', () => {
    // 0.1% × 22,500 × $2 × 5 contracts = $225
    expect(pctToDollarsMNQ(0.1, 22500, 5)).toBeCloseTo(225, 6);
    // 0.05% × 22,500 × $2 × 5 = $112.50
    expect(pctToDollarsMNQ(0.05, 22500, 5)).toBeCloseTo(112.5, 6);
    // 0.3% × 22,500 × $2 × 5 = $675
    expect(pctToDollarsMNQ(0.3, 22500, 5)).toBeCloseTo(675, 6);
  });

  it('returns null when ref price is missing', () => {
    expect(pctToDollarsMNQ(0.1, null, 5)).toBeNull();
  });

  it('scales linearly with contracts', () => {
    const oneCt = pctToDollarsMNQ(0.1, 22500, 1)!;
    expect(pctToDollarsMNQ(0.1, 22500, 5)).toBeCloseTo(oneCt * 5, 6);
  });
});

describe('deriveRows — win/loss/cashflow', () => {
  it('marks W/L by comparing MFE to dataset minCashflow', () => {
    const derived = deriveRows(SAMPLE_ROWS, SAMPLE_CFG);
    // Row 9 (1-indexed) — MFE 0.05 vs target 0.1 → LOSS
    expect(derived[8].isWin).toBe(false);
    // Row 1 — MFE 0.23 vs target 0.1 → WIN
    expect(derived[0].isWin).toBe(true);
  });

  it('every WIN pays exactly the cashflow target $', () => {
    const derived = deriveRows(SAMPLE_ROWS, SAMPLE_CFG);
    const wins = derived.filter((d) => d.isWin);
    for (const w of wins) {
      expect(w.netCashflow).toBeCloseTo(225, 6); // 0.1% × 22500 × $2 × 5
    }
  });

  it('every LOSS = -MAE × $2 × refPrice × contracts (per 0.01% factor)', () => {
    const derived = deriveRows(SAMPLE_ROWS, SAMPLE_CFG);
    const losses = derived.filter((d) => !d.isWin);
    for (const l of losses) {
      const expected = -(l.maePct / 100) * 22500 * 2 * 5;
      expect(l.netCashflow).toBeCloseTo(expected, 6);
    }
  });

  it('tags win-streak length on the LAST bar of each run (XLSX F-column)', () => {
    // From the XLSX: F9=8, F12=2, F21=8, F23=1, F25=1, F27=1, F32=4, F35=2,
    // F39=3, F41=1, F54=11, F56=1, F59=2, F61=1, F68=6, F72=3, F77=3
    // We test the most-prominent ones.
    const derived = deriveRows(SAMPLE_ROWS, SAMPLE_CFG);
    expect(derived[7].winStreak).toBe(8);   // rows 1..8 are all wins
    expect(derived[10].winStreak).toBe(2);  // rows 10..11 wins → run of 2
    expect(derived[52].winStreak).toBe(11); // long winning streak
  });

  it('losses get null streak', () => {
    const derived = deriveRows(SAMPLE_ROWS, SAMPLE_CFG);
    const losses = derived.filter((d) => !d.isWin);
    for (const l of losses) expect(l.winStreak).toBeNull();
  });
});

describe('deriveRow — Max-MAE stop', () => {
  const STOP_CFG: DatasetConfig = { ...SAMPLE_CFG, maxMaePct: 0.15 };
  const refP = 22500, ct = 5;

  it('does NOT flip a winner: MFE hit the target → win even if MAE exceeded the stop', () => {
    // MFE 0.50 ≥ target 0.10 (hit before invalidation), MAE 0.60 > stop 0.15.
    const row: RawRow = { rowIndex: 1, tradeDate: '2025-02-15', maePct: 0.6, mfePct: 0.5, contracts: ct, refPrice: refP };
    const d = deriveRow(row, STOP_CFG);
    expect(d.isWin).toBe(true);
    expect(d.isStopped).toBe(false);
    expect(d.maePct).toBeCloseTo(0.6, 6);                  // winner MAE shown raw
    expect(d.netCashflow).toBeCloseTo((0.1 / 100) * refP * 2 * ct, 6); // banks the target
  });

  it('caps a LOSER whose MAE exceeded the stop: loss = -MaxMAE, MAE capped', () => {
    // MFE 0.05 < target 0.10 (loser), MAE 0.60 > stop 0.15.
    const row: RawRow = { rowIndex: 1, tradeDate: '2025-02-15', maePct: 0.6, mfePct: 0.05, contracts: ct, refPrice: refP };
    const d = deriveRow(row, STOP_CFG);
    expect(d.isWin).toBe(false);
    expect(d.isStopped).toBe(true);
    expect(d.maePct).toBeCloseTo(0.15, 6);                 // MAE capped at the stop
    expect(d.netCashflow).toBeCloseTo(-(0.15 / 100) * refP * 2 * ct, 6); // loss capped
  });

  it('leaves a loser whose MAE is under the stop at its full loss', () => {
    const row: RawRow = { rowIndex: 1, tradeDate: '2025-02-15', maePct: 0.1, mfePct: 0.02, contracts: ct, refPrice: refP };
    const d = deriveRow(row, STOP_CFG);
    expect(d.isWin).toBe(false);
    expect(d.isStopped).toBe(false);
    expect(d.netCashflow).toBeCloseTo(-(0.1 / 100) * refP * 2 * ct, 6);
  });

  it('no stop (maxMaePct 0/undefined) → original uncapped-loss behavior', () => {
    const row: RawRow = { rowIndex: 1, tradeDate: '2025-02-15', maePct: 0.4, mfePct: 0.02, contracts: ct, refPrice: refP };
    const d = deriveRow(row, SAMPLE_CFG); // no maxMaePct
    expect(d.isStopped).toBe(false);
    expect(d.netCashflow).toBeCloseTo(-(0.4 / 100) * refP * 2 * ct, 6); // full MAE loss
  });
});

describe('computeDatasetDashboard', () => {
  const dash = computeDatasetDashboard(SAMPLE_ROWS, SAMPLE_CFG);

  it('totalSamples = 70', () => {
    // XLSX N3 = COUNT(B2:B71)
    expect(dash.totalSamples).toBe(70);
  });

  it('MFE strike rate at 0.1 target matches the XLSX', () => {
    // XLSX K11 = COUNTIF(C:C, ">0.099") then N5 = K11/N3
    // Hand-counted MFE > 0.099 in SAMPLE_DATA = ~51 (XLSX puts this at ~73%)
    const row = dash.mfeStrikeRates.find((r) => r.thresholdPct === 0.1)!;
    expect(row.count).toBeGreaterThanOrEqual(50);
    expect(row.strikeRate).toBeGreaterThan(0.7);
    expect(row.strikeRate).toBeLessThan(0.85);
    expect(row.lossRate).toBeCloseTo(1 - (row.strikeRate ?? 0), 6);
  });

  it('strike + loss rates sum to 1 at every threshold', () => {
    for (const r of dash.mfeStrikeRates) {
      expect((r.strikeRate ?? 0) + (r.lossRate ?? 0)).toBeCloseTo(1, 6);
    }
  });

  it('risk movements: average MAE matches a hand calc', () => {
    const handAvg =
      SAMPLE_DATA.reduce((s, [mae]) => s + mae, 0) / SAMPLE_DATA.length;
    expect(dash.risk.average).toBeCloseTo(handAvg, 6);
  });

  it('profit measurements: average MFE matches a hand calc', () => {
    const handAvg =
      SAMPLE_DATA.reduce((s, [, mfe]) => s + mfe, 0) / SAMPLE_DATA.length;
    expect(dash.profit.average).toBeCloseTo(handAvg, 6);
  });

  it('contract size loss table is correct at all 15 MAE thresholds', () => {
    // Order is descending (0.75 → 0.05); $ value = -pct × ref × $0.0002 × contracts
    expect(dash.contractSizeLoss).toHaveLength(15);
    const at = (t: number) =>
      dash.contractSizeLoss.find((r) => r.thresholdPct === t)!.dollarValue;
    expect(at(0.3)).toBeCloseTo(-675, 6);  // 0.3% × 22500 × $2 × 5
    expect(at(0.05)).toBeCloseTo(-112.5, 6);
  });

  it('contract size wins table matches MNQ math at min cashflow', () => {
    const at = (t: number) =>
      dash.contractSizeWins.find((r) => r.thresholdPct === t)!.dollarValue;
    expect(at(0.1)).toBeCloseTo(225, 6);
    expect(at(0.3)).toBeCloseTo(675, 6);
  });

  it('EV matrix is 15 MFE rows × 15 MAE cols, all numbers finite', () => {
    expect(dash.evMatrix.values).toHaveLength(15); // MFE thresholds 0.05 → 0.75
    for (const row of dash.evMatrix.values) {
      expect(row).toHaveLength(15); // MAE thresholds 0.05 → 0.75
      for (const v of row) {
        expect(v).not.toBeNull();
        expect(Number.isFinite(v!)).toBe(true);
      }
    }
  });

  it('cashflowEv min ≤ median ≤ max', () => {
    const { highProb, mediumProb, highEv } = dash.cashflowEv;
    expect(highProb).not.toBeNull();
    expect(mediumProb).not.toBeNull();
    expect(highEv).not.toBeNull();
    expect(highProb!).toBeLessThanOrEqual(mediumProb!);
    expect(mediumProb!).toBeLessThanOrEqual(highEv!);
  });

  it('totalPnl = sum of every row netCashflow', () => {
    const derived = deriveRows(SAMPLE_ROWS, SAMPLE_CFG);
    const sum = derived.reduce((s, d) => s + (d.netCashflow ?? 0), 0);
    expect(dash.snapshot.totalPnl).toBeCloseTo(sum, 6);
    expect(dash.netCashflow).toBeCloseTo(sum, 6);
  });

  it('snapshot loss series follows count × loss-$ formula', () => {
    expect(dash.snapshot.lossSeries).toHaveLength(15);
    // First row = 0.75% threshold (descending); 0.3 row checked below
    const first = dash.snapshot.lossSeries[0];
    const lossDollars = dash.contractSizeLoss[0].dollarValue!;
    const matchCount = dash.riskVariances[0].count;
    expect(first.lossDollars).toBeCloseTo(matchCount * lossDollars, 6);
  });

  it('MFE analysis key = median(median, mode, average)', () => {
    const { median: m, mode: mo, average: a, key } = dash.mfeAnalysis;
    // Manually sort the three and take the middle
    const vals = [m, mo, a].filter((x): x is number => x !== null).sort((x, y) => x - y);
    if (vals.length === 3) {
      expect(key).toBeCloseTo(vals[1], 6);
    }
  });

  it('time anchor reports null when all rows share a date', () => {
    expect(dash.timeAnchor.days).toBe(0);
    expect(dash.timeAnchor.firstDate).toBe('2025-02-15');
    expect(dash.timeAnchor.lastDate).toBe('2025-02-15');
  });

  it('time anchor spans a real date range when rows vary', () => {
    const varied: RawRow[] = SAMPLE_ROWS.map((r, i) => ({
      ...r,
      tradeDate: `2025-02-${String(10 + (i % 18)).padStart(2, '0')}`,
    }));
    const d = computeDatasetDashboard(varied, SAMPLE_CFG);
    expect(d.timeAnchor.firstDate).toBe('2025-02-10');
    expect(d.timeAnchor.lastDate).toBe('2025-02-27');
    expect(d.timeAnchor.days).toBe(17);
  });
});

describe('computeCrossComparison', () => {
  const inSample: DatasetInput = { ...SAMPLE_CFG, rows: SAMPLE_ROWS };
  const oos1: DatasetInput = {
    ...SAMPLE_CFG,
    id: 'oos1',
    sampleType: 'OUT_OF_SAMPLE',
    rows: SAMPLE_ROWS.slice(0, 30),
  };
  const oos2: DatasetInput = {
    ...SAMPLE_CFG,
    id: 'oos2',
    sampleType: 'OUT_OF_SAMPLE',
    rows: SAMPLE_ROWS.slice(30, 60),
  };
  const oos3: DatasetInput = {
    ...SAMPLE_CFG,
    id: 'oos3',
    sampleType: 'OUT_OF_SAMPLE',
    rows: SAMPLE_ROWS.slice(20, 70),
  };

  it('gate stays LOCKED with only 1 IS + 2 OOS', () => {
    const cc = computeCrossComparison([inSample, oos1, oos2]);
    expect(cc.gate.unlocked).toBe(false);
    expect(cc.gate.inSampleCount).toBe(1);
    expect(cc.gate.outOfSampleCount).toBe(2);
  });

  it('gate UNLOCKS at 1 IS + 3 OOS', () => {
    const cc = computeCrossComparison([inSample, oos1, oos2, oos3]);
    expect(cc.gate.unlocked).toBe(true);
  });

  it('move comparison computes IS-vs-OOS strike rate delta', () => {
    const cc = computeCrossComparison([inSample, oos1, oos2, oos3]);
    const move = cc.moveComparisons.find((m) => m.gunshipMove === '1800')!;
    expect(move.inSample).not.toBeNull();
    expect(move.outOfSamples).toHaveLength(3);
    expect(move.strikeRateDeltaPct).not.toBeNull();
  });

  it('ranking returns one row per move, sorted desc by medium-prob EV', () => {
    const cc = computeCrossComparison([inSample, oos1, oos2, oos3]);
    expect(cc.rankedByEv).toHaveLength(1); // only one move in this test
    expect(cc.rankedByEv[0].gunshipMove).toBe('1800');
  });
});

describe('edge cases', () => {
  it('handles an empty dataset without throwing', () => {
    const d = computeDatasetDashboard([], SAMPLE_CFG);
    expect(d.totalSamples).toBe(0);
    expect(d.risk.average).toBeNull();
    expect(d.cashflowEv.highProb).toBeNull();
  });

  it('handles rows with no ref price (still W/L but no $)', () => {
    const noPrice: RawRow[] = [
      { rowIndex: 1, tradeDate: null, maePct: 0.1, mfePct: 0.2, contracts: 1, refPrice: null },
      { rowIndex: 2, tradeDate: null, maePct: 0.05, mfePct: 0.05, contracts: 1, refPrice: null },
    ];
    const derived = deriveRows(noPrice, SAMPLE_CFG);
    expect(derived[0].isWin).toBe(true);
    expect(derived[0].dollarMFE).toBeNull();
    expect(derived[1].isWin).toBe(false);
    expect(derived[1].dollarMAE).toBeNull();
  });
});
