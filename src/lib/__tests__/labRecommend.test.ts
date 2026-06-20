import type { MaeMfeDocument } from '../../components/assignments/mae-mfe/maeMfeDocument';
import type { MoveState } from '../../components/assignments/mae-mfe/MoveDashboard';
import { recommendCombine, recommendCycle, type Appetite } from '../../components/assignments/mae-mfe/labRecommend';
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
const loser = days.map((d) => [d, 0.6, 0.02] as [string, number, number]);

const doc: MaeMfeDocument = {
  MNQ: { '1800': mk(mixed, 0.1, 0.3), '0300': mk(winner), MO: mk(loser), LB: mk(mixed) },
  MES: { '1800': mk(winner), '0300': mk(mixed) },
  MGC: { '1800': mk(winner) },
} as unknown as MaeMfeDocument;

const label = (k: string) => k;
const rules: PropRules = { accountSize: 50000, profitTarget: 3000, maxDrawdown: 2000, ddMode: 'trailing', dailyLossLimit: 0, minTradingDays: 0, maxDays: 60 };
const APPS: Appetite[] = ['fastest', 'safest', 'bestOverall', 'professional'];

describe('recommendCombine (which moves to net together)', () => {
  const recs = recommendCombine(doc, rules, 1, { kind: 'all' }, label, { sims: 60, rng: mulberry32(1) });
  it('returns a non-empty basket with combined stats for every appetite', () => {
    for (const a of APPS) {
      expect(recs[a]).not.toBeNull();
      expect(recs[a]!.keys.length).toBeGreaterThan(0);
      expect(Number.isFinite(recs[a]!.stats.totalPnl)).toBe(true);
      expect(Number.isFinite(recs[a]!.sharpe)).toBe(true);
    }
  });
  it('never recommends a move with no data', () => {
    const valid = new Set(['MNQ::1800', 'MNQ::0300', 'MNQ::MO', 'MNQ::LB', 'MES::1800', 'MES::0300', 'MGC::1800']);
    for (const a of APPS) for (const k of recs[a]!.keys) expect(valid.has(k)).toBe(true);
  });
});

describe('recommendCycle (moves + accounts + size)', () => {
  const recs = recommendCycle(doc, rules, 1, { kind: 'all' }, label, { sims: 60, rng: mulberry32(1) });
  it('returns a valid N/k cycling setup for every appetite', () => {
    for (const a of APPS) {
      const r = recs[a]!;
      expect(r).not.toBeNull();
      expect(r.numAccounts).toBeGreaterThanOrEqual(2);
      expect(r.k).toBeGreaterThanOrEqual(1);
      expect(r.k).toBeLessThanOrEqual(r.numAccounts);
      expect(r.worstDD).toBeLessThanOrEqual(0);
    }
  });
  it('Safest cycles wider (≥ accounts) and never sizes up more than Fastest', () => {
    expect(recs.safest!.k).toBeLessThanOrEqual(recs.fastest!.k);
    expect(recs.safest!.numAccounts).toBeGreaterThanOrEqual(recs.fastest!.numAccounts);
  });
});
