import { ASSETS, ASSET_ORDER, assetCloseForDate, assetPriceRange, isAssetTicker } from '../assets';
import { pctToDollars } from '../maeMfeStats';

describe('asset registry', () => {
  it('has the six expected futures with correct point values', () => {
    expect(ASSET_ORDER).toEqual(['MNQ', 'MES', 'MYM', 'MCL', 'MGC', 'RTY']);
    expect(ASSETS.MNQ.pointValueUsd).toBe(2);
    expect(ASSETS.MES.pointValueUsd).toBe(5);
    expect(ASSETS.MYM.pointValueUsd).toBe(0.5);
    expect(ASSETS.MCL.pointValueUsd).toBe(100);
    expect(ASSETS.MGC.pointValueUsd).toBe(10);
    expect(ASSETS.RTY.pointValueUsd).toBe(5);
  });

  it('isAssetTicker guards membership', () => {
    expect(isAssetTicker('MES')).toBe(true);
    expect(isAssetTicker('SPY')).toBe(false);
  });
});

describe('pctToDollars per asset', () => {
  // 0.1% move, 1 contract: (0.1/100) × refPrice × pointValue.
  it('MNQ: 0.1% at 22500 = $45/ct', () => {
    expect(pctToDollars(0.1, 22500, 1, ASSETS.MNQ.pointValueUsd)).toBeCloseTo(45, 6);
  });
  it('MES: 0.1% at 7600 = $38/ct', () => {
    expect(pctToDollars(0.1, 7600, 1, ASSETS.MES.pointValueUsd)).toBeCloseTo(38, 6);
  });
  it('MYM: 0.1% at 51600 = $25.8/ct', () => {
    expect(pctToDollars(0.1, 51600, 1, ASSETS.MYM.pointValueUsd)).toBeCloseTo(25.8, 6);
  });
  it('MCL: 1% at 93 = $93/ct (100-barrel multiplier)', () => {
    expect(pctToDollars(1, 93, 1, ASSETS.MCL.pointValueUsd)).toBeCloseTo(93, 6);
  });
  it('MGC: 1% at 4500 = $450/ct (10-oz multiplier)', () => {
    expect(pctToDollars(1, 4500, 1, ASSETS.MGC.pointValueUsd)).toBeCloseTo(450, 6);
  });
  it('scales linearly with contracts', () => {
    const one = pctToDollars(0.1, 7600, 1, ASSETS.MES.pointValueUsd)!;
    expect(pctToDollars(0.1, 7600, 4, ASSETS.MES.pointValueUsd)).toBeCloseTo(one * 4, 6);
  });
});

describe('assetCloseForDate', () => {
  it('returns a finite close within each asset history', () => {
    for (const t of ASSET_ORDER) {
      if (t === 'RTY') continue; // RTY has no bundled price table (MAE/MFE % only, no auto-$)
      const { last } = assetPriceRange(t);
      const close = assetCloseForDate(t, last);
      expect(typeof close).toBe('number');
      expect(Number.isFinite(close as number)).toBe(true);
      expect(close as number).toBeGreaterThan(0);
    }
  });

  it('returns null before an asset’s first session', () => {
    expect(assetCloseForDate('MES', '2000-01-01')).toBeNull();
  });

  it('MNQ delegates to its richer history (pre-2024 resolves)', () => {
    // MNQ table starts 2019; a 2021 date must still price.
    expect(assetCloseForDate('MNQ', '2021-06-15')).toBeGreaterThan(0);
  });
});
