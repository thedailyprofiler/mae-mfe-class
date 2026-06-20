import { distributeByGapRotation, sequenceTrades, type CycleResult } from '../maeMfeCombine';
import type { DerivedRow } from '../maeMfeStats';

// The owner's real cycling spreadsheet stream ("Combined - All Trades", 266
// trades) — used as the gold oracle. Source:
// cycling_combined_day_0300_1800oos 30oc-6june.xlsx.
const STREAM = [
  -892, 157, -305, -157, -157, 157, -157, 157, -157, 157, 305, 157, -305, 157, 305, 157, 305, -892, 305, 157,
  -157, 157, -463, 157, 305, 157, -305, 157, 305, 157, 305, -892, -305, -157, 305, -305, -157, 157, 305, 157,
  305, 157, 305, 157, -305, 157, -157, -305, -463, 157, -305, -305, -305, 157, 305, 157, -157, 157, -157, 157,
  -157, 157, 305, -305, 305, 157, 305, 157, -157, 157, -157, 157, 305, 157, -157, 157, 305, -350, 305, 157,
  -463, 157, 305, 15, 305, 157, -305, 157, 305, 157, -157, 157, 305, 157, -305, -157, 305, -157, -305, -157,
  -157, -305, 305, 157, -157, -305, -157, 157, -157, 157, -305, -305, -157, 157, -157, 157, -157, -305, -157,
  -305, 305, 157, 305, 157, 305, -305, -305, -305, 305, 157, 305, 157, 305, 157, -157, -350, -157, -350, -157,
  157, -157, 157, -157, 157, 305, -305, -463, 157, -157, 157, 305, 157, 305, 157, 305, 157, -157, -613, -157,
  -305, 305, -305, -157, -305, 305, -305, -305, 157, 305, 157, -157, -305, 305, 157, 305, 157, -305, 157, -305,
  157, -157, 157, 305, 157, 305, 157, 304, -305, 305, -305, -305, 157, 305, -305, -463, -305, -463, 157, 305,
  157, 157, -305, 157, 157, 157, -613, 157, 157, 157, 157, 157, -613, 157, 157, 157, 157, 157, 157, 157, 157,
  157, 157, 157, 157, 157, 157, -891, 157, 157, -305, 157, 157, 157, 157, 157, 157, 157, 157, 157, 157, 157,
  157, 157, -305, -305, 157, -478, 157, 157, 157, 157, 157, 157, 157, 157, 157, 157, 157, -478, 157, -478, 157,
  -305, 157, 157, 157,
];

const nets = (r: CycleResult) => r.accounts.map((a) => Math.round(a.net));

describe('distributeByGapRotation — XLSX oracle', () => {
  it('reproduces the spreadsheet 4-gap (N=5, 1×) per-account nets exactly', () => {
    const r = distributeByGapRotation(STREAM, 5, 1);
    expect(nets(r)).toEqual([-1051, -3276, 1230, 2344, 4359]);
    expect(Math.round(r.totalPnl)).toBe(3606);
    expect(r.best?.account).toBe(5);
    expect(r.worst?.account).toBe(2);
  });

  it('reproduces the spreadsheet 1.5-gap (N=5, 2×) per-account nets exactly', () => {
    const r = distributeByGapRotation(STREAM, 5, 2);
    expect(nets(r)).toEqual([179, 1293, -932, 1083, 5589]);
    expect(Math.round(r.totalPnl)).toBe(7212); // 2× the 1× total
  });
});

describe('distributeByGapRotation — mechanics', () => {
  it('1× rotation assigns one account per trade, round-robin', () => {
    const r = distributeByGapRotation([10, 20, 30, 40, 50, 60], 5, 1);
    // accounts: A1=10+60, A2=20, A3=30, A4=40, A5=50
    expect(r.accounts.map((a) => a.net)).toEqual([70, 20, 30, 40, 50]);
  });

  it('2× rotation fires two consecutive accounts, advancing by 2 (wraps)', () => {
    const r = distributeByGapRotation([10, 20, 30], 5, 2);
    // T0→{0,1}, T1→{2,3}, T2→{4,0}: A1=10+30, A2=10, A3=20, A4=20, A5=30
    expect(r.accounts.map((a) => a.net)).toEqual([40, 10, 20, 20, 30]);
  });

  it('tracks per-account running peak and trailing max drawdown', () => {
    // Single account: +100 (peak 100) then -30 (dd -30) then -50 (dd -80) then +10.
    const r = distributeByGapRotation([100, -30, -50, 10], 1, 1);
    expect(r.accounts[0].net).toBe(30);
    expect(r.accounts[0].peak).toBe(100);
    expect(r.accounts[0].maxDrawdown).toBe(-80);
  });

  it('total P&L = firePerTrade × stream sum', () => {
    const sum = STREAM.reduce((s, x) => s + x, 0);
    expect(Math.round(distributeByGapRotation(STREAM, 5, 1).totalPnl)).toBe(Math.round(sum));
    expect(Math.round(distributeByGapRotation(STREAM, 7, 3).totalPnl)).toBe(Math.round(3 * sum));
  });

  it('clamps firePerTrade ≤ numAccounts and numAccounts ≥ 1', () => {
    // k requested 5 but only 3 accounts → clamped to 3: every trade hits all 3.
    const r = distributeByGapRotation([10, 20], 3, 5);
    expect(r.firePerTrade).toBe(3);
    expect(r.accounts.map((a) => a.net)).toEqual([30, 30, 30]);
    // numAccounts 0 → clamped to 1.
    expect(distributeByGapRotation([10], 0, 1).numAccounts).toBe(1);
  });
});

describe('sequenceTrades', () => {
  function dr(tradeDate: string, netCashflow: number | null, rowIndex = 1): DerivedRow {
    return {
      rowIndex, tradeDate, maePct: 0, mfePct: 0, contracts: 0, refPrice: null,
      isWin: false, dollarPerBpPerContract: null, dollarMAE: null, dollarMFE: null, netCashflow, winStreak: null,
    };
  }
  it('orders by date, then source order, then rowIndex; skips unpriced', () => {
    const a = [dr('2026-01-02', 5, 1), dr('2026-01-01', 1, 2)];
    const b = [dr('2026-01-01', 2, 1), dr('2026-01-03', 9, 1), dr('2026-01-01', null, 2)];
    const seq = sequenceTrades([a, b]);
    // 01-01: a(src0) then b(src1) → 1, 2 ; 01-02 → 5 ; 01-03 → 9 ; null skipped
    expect(seq.map((t) => t.pnl)).toEqual([1, 2, 5, 9]);
  });
});
