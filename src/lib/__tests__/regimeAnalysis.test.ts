import { deriveRows, type DatasetConfig, type RawRow } from '../maeMfeStats';
import { VOL_REGIME } from '../volRegime';
import { regimeFor, wilson95, regimeBreakdown, regimeDates, REGIME_ORDER } from '../regimeAnalysis';

const CFG: DatasetConfig = { id: 'x', gunshipMove: '1800', sampleType: 'IN_SAMPLE', minCashflowPct: 0.1, defaultContracts: 5, label: null };
const DATES = Object.keys(VOL_REGIME).sort();

describe('wilson95', () => {
  it('brackets the point estimate and is symmetric at p=0.5', () => {
    const w = wilson95(50, 100);
    expect(w.lo).toBeLessThan(0.5);
    expect(w.hi).toBeGreaterThan(0.5);
    expect((w.lo + w.hi) / 2).toBeCloseTo(0.5, 6);
  });
  it('stays in [0,1] for extreme/small samples', () => {
    const w = wilson95(0, 8);
    expect(w.lo).toBe(0);
    expect(w.hi).toBeGreaterThan(0);
    expect(w.hi).toBeLessThan(1);
  });
  it('narrows as n grows', () => {
    const small = wilson95(6, 10), big = wilson95(600, 1000);
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
  });
});

describe('regimeFor — no lookahead (prior-session value)', () => {
  it('returns the PRIOR session regime, never the same-day value', () => {
    const d = DATES[10];
    expect(regimeFor(d, 'vol2')).toBe(VOL_REGIME[DATES[9]].vol2);
    expect(regimeFor(d, 'ts')).toBe(VOL_REGIME[DATES[9]].ts);
  });
  it('returns UNKNOWN before the first regime date and for null', () => {
    expect(regimeFor('1990-01-01', 'vol2')).toBe('UNKNOWN');
    expect(regimeFor(null, 'vol2')).toBe('UNKNOWN');
  });
});

describe('regimeDates', () => {
  it('lists exactly the dates carrying that regime label, sorted, no overlap between regimes', () => {
    const exp = regimeDates('vol2', 'EXPANDING');
    const con = regimeDates('vol2', 'CONTRACTING');
    expect(exp.length).toBeGreaterThan(0);
    expect([...exp]).toEqual([...exp].sort()); // sorted
    expect(exp.every((d) => VOL_REGIME[d].vol2 === 'EXPANDING')).toBe(true);
    expect(exp.some((d) => con.includes(d))).toBe(false); // disjoint
  });
});

describe('regimeBreakdown', () => {
  // 80 real consecutive regime dates, alternating win/loss (every 3rd is a win).
  const rows: RawRow[] = DATES.slice(40, 120).map((d, i) => ({
    rowIndex: i + 1, tradeDate: d, maePct: 0.2, mfePct: i % 3 === 0 ? 0.5 : 0.02, contracts: 5, refPrice: 22500,
  }));
  const derived = deriveRows(rows, CFG); // win = mfe >= 0.1
  const breakdown = regimeBreakdown(derived, 'vol2', 0.1);

  it('buckets only into the axis regimes, in order, no UNKNOWN', () => {
    expect(breakdown.length).toBeGreaterThan(0);
    for (const s of breakdown) expect(REGIME_ORDER.vol2).toContain(s.regime);
    const order = breakdown.map((s) => REGIME_ORDER.vol2.indexOf(s.regime));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it('bucket counts sum to the rows with a known prior regime', () => {
    const known = derived.filter((r) => regimeFor(r.tradeDate, 'vol2') !== 'UNKNOWN').length;
    expect(breakdown.reduce((s, b) => s + b.n, 0)).toBe(known);
  });
  it('per-bucket stats obey their invariants', () => {
    const globalRate = derived.filter((r) => r.isWin).length / derived.length;
    for (const s of breakdown) {
      expect(s.winRate).toBeCloseTo(s.wins / s.n, 9);
      expect(s.wilsonLo).toBeLessThanOrEqual(s.winRate + 1e-9);
      expect(s.wilsonHi).toBeGreaterThanOrEqual(s.winRate - 1e-9);
      // shrunk estimate lies between the raw rate and the global rate
      const lo = Math.min(s.winRate, globalRate), hi = Math.max(s.winRate, globalRate);
      expect(s.shrunkWinRate).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(s.shrunkWinRate).toBeLessThanOrEqual(hi + 1e-9);
      expect(s.thin).toBe(s.n < 30);
    }
  });
});
