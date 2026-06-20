import { runPropSim, moveDailyDollars, priceForDate, mulberry32, type PropRules } from '../propSim';
import { assetCloseForDate } from '../assets';
import type { MoveState } from '../../components/assignments/mae-mfe/MoveDashboard';

const base: PropRules = {
  accountSize: 50000, profitTarget: 300, maxDrawdown: 300,
  ddMode: 'trailing', dailyLossLimit: 0, minTradingDays: 0, maxDays: 50,
};

describe('runPropSim (dollars)', () => {
  it('a pure-winner edge passes ~always and never busts', () => {
    const wins = [100, 100, 100, 100]; // +$100/day
    const r = runPropSim(wins, base, { sims: 500, mode: 'bootstrap', rng: mulberry32(1) });
    expect(r.passRate).toBe(1);
    expect(r.bustRate).toBe(0);
    expect(r.medianDaysToPass).toBe(3); // 3 × $100 = $300 target
  });

  it('a pure-loser edge busts ~always, never passes', () => {
    const r = runPropSim([-100, -100, -100], base, { sims: 500, mode: 'bootstrap', rng: mulberry32(2) });
    expect(r.passRate).toBe(0);
    expect(r.bustRate).toBe(1);
    expect(r.bustByDD).toBeGreaterThan(0);
  });

  it('rates sum to 1 and are bounded', () => {
    const r = runPropSim([100, -300, 100, 100, -200, 100], base, { sims: 1000, mode: 'bootstrap', rng: mulberry32(3) });
    expect(r.passRate + r.bustRate + r.activeRate).toBeCloseTo(1, 6);
    for (const v of [r.passRate, r.bustRate, r.activeRate]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });

  it('daily loss limit produces daily busts that drawdown alone would not', () => {
    const mixed = [100, -250, 100, 100];
    const noDaily = runPropSim(mixed, { ...base, maxDrawdown: 100000 }, { sims: 800, mode: 'bootstrap', rng: mulberry32(4) });
    const withDaily = runPropSim(mixed, { ...base, maxDrawdown: 100000, dailyLossLimit: 200 }, { sims: 800, mode: 'bootstrap', rng: mulberry32(4) });
    expect(noDaily.bustByDaily).toBe(0);
    expect(withDaily.bustByDaily).toBeGreaterThan(0);
  });

  it('min trading days delays a pass that target alone would allow immediately', () => {
    const wins = [100, 100, 100, 100, 100];
    const quick = runPropSim(wins, { ...base, profitTarget: 100, minTradingDays: 0 }, { sims: 300, mode: 'bootstrap', rng: mulberry32(5) });
    const gated = runPropSim(wins, { ...base, profitTarget: 100, minTradingDays: 5 }, { sims: 300, mode: 'bootstrap', rng: mulberry32(5) });
    expect(quick.medianDaysToPass).toBe(1);
    expect(gated.medianDaysToPass).toBe(5);
  });

  it('static vs trailing drawdown: trailing is at least as strict', () => {
    const seq = [100, 100, 100, 100, -250, -250];
    const trailing = runPropSim(seq, { ...base, profitTarget: 999999, maxDrawdown: 300, ddMode: 'trailing' }, { sims: 1, mode: 'shuffle', rng: mulberry32(6) });
    const staticDD = runPropSim(seq, { ...base, profitTarget: 999999, maxDrawdown: 300, ddMode: 'static' }, { sims: 1, mode: 'shuffle', rng: mulberry32(6) });
    expect(trailing.bustRate).toBeGreaterThanOrEqual(staticDD.bustRate);
  });

  it('reports the actual historical sequence outcome', () => {
    const r = runPropSim([100, 100, 100], base, { sims: 50, mode: 'bootstrap', rng: mulberry32(7) });
    expect(r.base?.outcome).toBe('pass');
    expect(r.base?.day).toBe(3);
  });

  it('empty input → zeroed result', () => {
    const r = runPropSim([], base, { sims: 100, mode: 'bootstrap' });
    expect(r.passRate).toBe(0);
    expect(r.base).toBeNull();
  });
});

describe('priceForDate', () => {
  it('RTY prices from its bundled M2K table; an explicit override applies only outside coverage', () => {
    const bundled = assetCloseForDate('RTY', '2026-01-15');
    expect(bundled).not.toBeNull();
    expect(priceForDate('RTY', '2026-01-15')).toBe(bundled); // real M2K close, not a flat fallback
    // before the table starts (2025-04-10) there's no bundled close → explicit override wins
    expect(priceForDate('RTY', '2019-01-01', 2500)).toBe(2500);
  });
  it('uses the bundled close for priced assets (MES)', () => {
    const p = priceForDate('MES', '2026-03-02');
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(0);
  });
});

describe('moveDailyDollars — % → $ at position size', () => {
  const mk = (rows: Array<[string, number, number]>, minCf = 0.1, maxMae = 0): MoveState => ({
    minCashflowPct: minCf, defaultContracts: 5, maxMaePct: maxMae,
    inSample: { startDate: null, rows: rows.map(([d, mae, mfe], i) => ({ rowIndex: i + 1, tradeDate: d, maePct: mae, mfePct: mfe, contracts: 5, refPrice: null })) },
    oos1: { startDate: null, rows: [] }, oos2: { startDate: null, rows: [] }, oos3: { startDate: null, rows: [] },
  });

  it('converts a winning day to contracts × pointValue × price × pct/100 (explicit ref price)', () => {
    // Date before the RTY/M2K table (2025-04-10) → explicit ref price is honored.
    // RTY pointValue 5, ref price 2000, 2 contracts, win banks +0.1% → 2*5*2000*0.001 = $20
    const ms = mk([['2019-02-04', 0.05, 0.5]], 0.1, 0);
    const { dollars } = moveDailyDollars(ms, 'RTY', 2, 2000);
    expect(dollars[0]).toBeCloseTo(20, 6);
  });

  it('a stopped loss caps at −MaxMAE in $ terms', () => {
    // Date before the table → explicit ref price honored.
    // loss, MAE 0.6 > stop 0.3 → −0.3%; RTY 5 × 2000 × 1 × 0.003 = $30 loss
    const ms = mk([['2019-02-04', 0.6, 0.02]], 0.1, 0.3);
    const { dollars } = moveDailyDollars(ms, 'RTY', 1, 2000);
    expect(dollars[0]).toBeCloseTo(-30, 6);
  });
});
