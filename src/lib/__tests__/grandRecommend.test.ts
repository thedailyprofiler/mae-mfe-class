import type { MaeMfeDocument } from '../../components/assignments/mae-mfe/maeMfeDocument';
import type { MoveState } from '../../components/assignments/mae-mfe/MoveDashboard';
import { grandRecommend, GRAND_APPETITES, type Appetite } from '../grandRecommend';
import { mulberry32, type PropRules } from '../propSim';

function mk(rows: Array<[string, number, number]>, minCf = 0.1, maxMae = 0, contracts = 5): MoveState {
  return {
    minCashflowPct: minCf, defaultContracts: contracts, maxMaePct: maxMae,
    inSample: { startDate: null, rows: rows.map(([d, mae, mfe], i) => ({ rowIndex: i + 1, tradeDate: d, maePct: mae, mfePct: mfe, contracts, refPrice: null })) },
    oos1: { startDate: null, rows: [] }, oos2: { startDate: null, rows: [] }, oos3: { startDate: null, rows: [] },
  };
}
const days = Array.from({ length: 20 }, (_, i) => `2026-02-${String(i + 2).padStart(2, '0')}`);
const winner = days.map((d, i) => [d, i % 5 === 0 ? 0.4 : 0.05, i % 5 === 0 ? 0.03 : 0.5] as [string, number, number]);
const mixed = days.map((d, i) => [d, i % 2 ? 0.5 : 0.06, i % 2 ? 0.04 : 0.4] as [string, number, number]);

const doc: MaeMfeDocument = {
  MNQ: { '1800': mk(mixed, 0.1, 0.3), '0300': mk(winner), MO: mk(mixed) },
  MES: { '1800': mk(winner), '0300': mk(mixed, 0.1, 0.3, 8) }, // different size
  MGC: { '1800': mk(winner) },
} as unknown as MaeMfeDocument;

const label = (m: string) => m;
const rules: PropRules = { accountSize: 50000, profitTarget: 3000, maxDrawdown: 2000, ddMode: 'trailing', dailyLossLimit: 0, minTradingDays: 0, maxDays: 60 };
const APPS: Appetite[] = ['fastest', 'safest', 'bestOverall', 'professional'];

describe('grandRecommend', () => {
  const g = grandRecommend(doc, rules, label, { sims: 100, rng: mulberry32(1) });
  it('returns a full plan (basket + combined survival) for every appetite', () => {
    for (const a of APPS) {
      expect(g[a]).not.toBeNull();
      expect(g[a]!.alloc.length).toBeGreaterThan(0);
      expect(Math.abs(g[a]!.alloc.reduce((s, x) => s + x.weight, 0) - 1)).toBeLessThan(1e-6); // weights sum to 1
      expect(g[a]!.pass + g[a]!.bust + g[a]!.active).toBeCloseTo(1, 6);                          // rates sum to 1
      expect(Number.isFinite(g[a]!.sharpe)).toBe(true);
      expect(g[a]!.maxDD).toBeLessThanOrEqual(0);
      expect(g[a]!.diversification).toBeGreaterThanOrEqual(0);
    }
  });
  it('every appetite title is present and matches the registry', () => {
    for (const { key, title } of GRAND_APPETITES) expect(g[key]!.title).toBe(title);
  });
  it('Professionally returns a risk-parity basket (weights normalized)', () => {
    expect(g.professional!.alloc.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(g.professional!.alloc.reduce((s, x) => s + x.weight, 0) - 1)).toBeLessThan(1e-6);
  });
});
