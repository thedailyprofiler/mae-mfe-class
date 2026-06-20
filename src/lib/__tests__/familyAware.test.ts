import { familyKey, computeMatrix, type Series } from '../correlation';
import { recommend } from '../recommendations';
import { mulberry32, type PropRules, type DollarSeries } from '../propSim';

describe('familyKey', () => {
  it('strips the entry/attempt suffix to the base move per asset', () => {
    expect(familyKey('MES::1800MA')).toBe('MES::1800');
    expect(familyKey('MES::1800FR')).toBe('MES::1800');
    expect(familyKey('MES::1800PB')).toBe('MES::1800');
    expect(familyKey('MES::1800')).toBe('MES::1800');
    expect(familyKey('MGC::0300FR')).toBe('MGC::0300');
    expect(familyKey('MNQ::MO')).toBe('MNQ::MO');     // built-in, no suffix
    expect(familyKey('MNQ::1800')).not.toBe(familyKey('MES::1800')); // different asset
  });
});

const s = (key: string, vals: number[]): Series => ({ key, label: key, daily: new Map(vals.map((v, i) => [`d${i}`, v])) });

describe('computeMatrix excludes same-family pairs from rankings', () => {
  it('a move vs its own multiple-attempt is not listed as most-correlated', () => {
    const base = [0.1, -0.2, 0.1, -0.3, 0.1, -0.1];
    const m = computeMatrix([
      s('MES::1800', base),
      s('MES::1800MA', base.map((x) => x + 0.001)), // near-identical → would be ~+1
      s('MNQ::1800', [0.1, 0.2, -0.1, 0.1, -0.2, 0.1]),
    ], 'pearson');
    // the MES 1800 / MES 1800MA pair (same family) must be absent from the ranked pairs
    const hasSelfPair = m.pairs.some((p) => /MES::1800\b/.test(p.a + p.b) && /MES::1800MA/.test(p.a + p.b));
    expect(hasSelfPair).toBe(false);
    // cross-family pairs remain
    expect(m.pairs.length).toBeGreaterThan(0);
    expect(m.pairs.every((p) => familyKey(keyFromLabel(p.a)) !== familyKey(keyFromLabel(p.b)))).toBe(true);
  });
});
// labels equal keys in these tests
function keyFromLabel(l: string): string { return l; }

describe('recommend collapses families so one asset cannot stack', () => {
  const rules: PropRules = { accountSize: 50000, profitTarget: 300, maxDrawdown: 300, ddMode: 'trailing', dailyLossLimit: 0, minTradingDays: 0, maxDays: 50 };
  const ds = (key: string, dollars: number[]): DollarSeries => ({ key, label: key, asset: key.split('::')[0] as any, dollars, dates: dollars.map((_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`) });
  const wins = [100, 100, 100, 100, 100, 100];

  it('MGC 1800 + MGC 1800MA + MGC 1800FR collapse to a single MGC::1800 family entry', () => {
    const r = recommend([
      ds('MGC::1800', wins), ds('MGC::1800MA', wins), ds('MGC::1800FR', wins),
      ds('MNQ::1800', wins), ds('MES::0300', wins),
    ], rules, { sims: 200, rng: mulberry32(1) });
    for (const key of ['fastest', 'safest', 'bestOverall', 'diversifier'] as const) {
      const fams = r.weights[key].map((a) => familyKey(a.key));
      expect(new Set(fams).size).toBe(fams.length);                   // no duplicate families
      expect(fams.filter((f) => f === 'MGC::1800').length).toBeLessThanOrEqual(1);
    }
  });
});
