import { recommendSetup, recommendSafestConfig, dailyDollarsFromRows, type VariantInput } from '../setupRecommender';
import { mulberry32, priceForDate, type PropRules } from '../propSim';
import type { RawRow } from '../maeMfeStats';

// RTY auto-prices from its bundled M2K daily-close table (CME_MINI:M2K1!).
const row = (i: number, mae: number, mfe: number): RawRow => ({ rowIndex: i + 1, tradeDate: `2026-02-${String((i % 27) + 1).padStart(2, '0')}`, maePct: mae, mfePct: mfe, contracts: 5, refPrice: null });
const winnerRows = Array.from({ length: 40 }, (_, i) => row(i, i % 6 === 0 ? 0.4 : 0.05, i % 6 === 0 ? 0.02 : 0.4)); // mostly big MFE, small MAE
const loserRows = Array.from({ length: 40 }, (_, i) => row(i, 0.5, 0.03)); // mostly losses

const rules: PropRules = { accountSize: 50000, profitTarget: 2000, maxDrawdown: 1500, ddMode: 'trailing', dailyLossLimit: 0, minTradingDays: 0, maxDays: 60 };
const variants: VariantInput[] = [
  { key: 'RTY::MO', label: 'Breakout', entry: 'Breakout', attempts: 'all attempts', rows: winnerRows },
  { key: 'RTY::MOPB', label: 'Pullback', entry: 'Pullback', attempts: '—', rows: loserRows },
];

describe('dailyDollarsFromRows', () => {
  it('converts a winning row at custom MFE target × contracts (RTY $5/pt × bundled M2K close)', () => {
    // 1 win row on 2026-02-01, MFE target 0.1 (hit), 2 contracts → 2 × 5 × close × 0.1%
    const p = priceForDate('RTY', '2026-02-01')!;
    const d = dailyDollarsFromRows([row(0, 0.05, 0.5)], 'RTY', 2, 0.1, 0);
    expect(d[0]).toBeCloseTo(2 * 5 * p * 0.001, 6);
  });
});

describe('recommendSetup', () => {
  it('prop mode returns a setup for each appetite, picking the winning entry', () => {
    const r = recommendSetup(variants, 'RTY', rules, { mode: 'prop', sims: 80, rng: mulberry32(1) });
    expect(r.mode).toBe('prop');
    for (const k of ['fastest', 'safest', 'bestOverall', 'professional'] as const) {
      expect(r[k]).not.toBeNull();
      expect(r[k]!.entry).toBe('Breakout'); // the positive-edge variant
      expect(r[k]!.contracts).toBeGreaterThan(0);
      expect([0.05, 0.1, 0.15, 0.2, 0.3, 0.5]).toContain(r[k]!.minCf);
    }
  });

  it('live mode flips to growth/ruin framing and still recommends', () => {
    const r = recommendSetup(variants, 'RTY', rules, { mode: 'live', sims: 80, rng: mulberry32(2) });
    expect(r.mode).toBe('live');
    expect(r.fastest).not.toBeNull();
    expect(r.fastest!.sharpe).toBeGreaterThan(0); // positive risk-adjusted return
    expect(r.safest!.ruin).toBeLessThanOrEqual(r.fastest!.ruin + 1e-9); // safest no riskier than fastest
  });

  it('empty input → all null', () => {
    const r = recommendSetup([], 'RTY', rules, { mode: 'prop', sims: 50 });
    expect(r.fastest).toBeNull();
  });
});

describe('recommendSafestConfig (per-dataset safe default)', () => {
  it('returns a low-bust, positive-edge config from a winning dataset', () => {
    const cfg = recommendSafestConfig(winnerRows, 'RTY', rules, { mode: 'prop', sims: 80, rng: mulberry32(1) });
    expect(cfg).not.toBeNull();
    expect([0.05, 0.1, 0.15, 0.2, 0.3, 0.5]).toContain(cfg!.minCf);
    expect(cfg!.contracts).toBeGreaterThan(0);
    expect(cfg!.bust).toBeLessThanOrEqual(0.5);
  });
  it('empty rows → null', () => {
    expect(recommendSafestConfig([], 'RTY', rules, { mode: 'prop', sims: 50 })).toBeNull();
  });
});
