import { recommend } from '../recommendations';
import { mulberry32, type PropRules, type DollarSeries } from '../propSim';

const rules: PropRules = {
  accountSize: 50000, profitTarget: 300, maxDrawdown: 300,
  ddMode: 'trailing', dailyLossLimit: 0, minTradingDays: 0, maxDays: 50,
};
// dollars are already sized per day ($).
const ds = (key: string, dollars: number[]): DollarSeries => ({ key, label: key, asset: 'MNQ', dollars, dates: dollars.map((_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`) });

describe('recommend', () => {
  const winner = ds('A::win', [100, 100, 100, 100, 100, 100]);
  const loser = ds('B::lose', [-100, -100, -100, -100, -100, -100]);
  const choppy = ds('C::chop', [100, -100, 100, -100, 100, -100]);

  it('picks the winner as safest, best-overall, and fastest; never the loser', () => {
    const r = recommend([winner, loser, choppy], rules, { sims: 300, rng: mulberry32(1) });
    expect(r.bestOverall?.key).toBe('A::win');
    expect(r.safest?.key).toBe('A::win');
    expect(r.fastest?.key).toBe('A::win');
    expect(r.safest?.key).not.toBe('B::lose');
  });

  it('excludes negative-edge moves from the suggested basket', () => {
    const r = recommend([winner, loser, choppy], rules, { sims: 300, rng: mulberry32(2) });
    expect(r.suggested.some((e) => e.key === 'B::lose')).toBe(false);
    expect(r.suggested.length).toBeGreaterThanOrEqual(1);
  });

  it('produces a per-move eval for every series with bounded rates', () => {
    const r = recommend([winner, loser, choppy], rules, { sims: 200, rng: mulberry32(3) });
    expect(r.evals.length).toBe(3);
    for (const e of r.evals) {
      expect(e.pass).toBeGreaterThanOrEqual(0); expect(e.pass).toBeLessThanOrEqual(1);
      expect(e.avgCorr).toBeGreaterThanOrEqual(0);
    }
  });

  it('empty input → all null picks', () => {
    const r = recommend([], rules, { sims: 100 });
    expect(r.bestOverall).toBeNull();
    expect(r.suggested.length).toBe(0);
  });

  it('each objective returns a normalized allocation; losers excluded from edge objectives', () => {
    const r = recommend([winner, loser, choppy], rules, { sims: 300, rng: mulberry32(4) });
    for (const key of ['fastest', 'safest', 'bestOverall', 'diversifier'] as const) {
      const alloc = r.weights[key];
      const sum = alloc.reduce((s, a) => s + a.weight, 0);
      expect(sum).toBeCloseTo(1, 6);
      for (const a of alloc) { expect(a.weight).toBeGreaterThan(0); expect(a.weight).toBeLessThanOrEqual(1); }
    }
    expect(r.weights.safest.some((a) => a.key === 'B::lose')).toBe(false);
    expect(r.weights.bestOverall.some((a) => a.key === 'B::lose')).toBe(false);
  });
});
