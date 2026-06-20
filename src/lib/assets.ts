/**
 * Tradable-asset registry for the MAE/MFE Analysis assignment.
 *
 * Each asset carries its CME contract spec (point value drives the bps→$ math)
 * and routes to the right daily-close table for auto-pricing. MNQ keeps its
 * rich 2019→2026 history (mnqPrices.ts); the others use the CLI-pulled tables
 * in assetPrices.ts (MGC uses the identical full-size COMEX gold series).
 */
import { mnqCloseForDate, MNQ_PRICE_RANGE } from './mnqPrices';
import { assetTableCloseForDate, ASSET_PRICE_RANGE } from './assetPrices';

export type AssetTicker = 'MNQ' | 'MES' | 'MYM' | 'MCL' | 'MGC' | 'RTY';

export interface AssetSpec {
  ticker: AssetTicker;
  label: string;
  name: string;
  /** USD per 1.0 of price movement, per contract. Drives pct→$ conversion. */
  pointValueUsd: number;
  tickSize: number;
  tickValueUsd: number;
}

// Standard CME micro-futures specs.
export const ASSETS: Record<AssetTicker, AssetSpec> = {
  MNQ: { ticker: 'MNQ', label: 'MNQ', name: 'Micro E-mini Nasdaq-100', pointValueUsd: 2, tickSize: 0.25, tickValueUsd: 0.5 },
  MES: { ticker: 'MES', label: 'MES', name: 'Micro E-mini S&P 500', pointValueUsd: 5, tickSize: 0.25, tickValueUsd: 1.25 },
  MYM: { ticker: 'MYM', label: 'MYM', name: 'Micro E-mini Dow', pointValueUsd: 0.5, tickSize: 1, tickValueUsd: 0.5 },
  MCL: { ticker: 'MCL', label: 'MCL', name: 'Micro WTI Crude Oil', pointValueUsd: 100, tickSize: 0.01, tickValueUsd: 1.0 },
  MGC: { ticker: 'MGC', label: 'MGC', name: 'Micro Gold', pointValueUsd: 10, tickSize: 0.1, tickValueUsd: 1.0 },
  RTY: { ticker: 'RTY', label: 'RTY', name: 'Micro Russell 2000 (M2K)', pointValueUsd: 5, tickSize: 0.1, tickValueUsd: 0.5 },
};

export const ASSET_ORDER: AssetTicker[] = ['MNQ', 'MES', 'MYM', 'MCL', 'MGC', 'RTY'];

export function isAssetTicker(s: string): s is AssetTicker {
  return Object.prototype.hasOwnProperty.call(ASSETS, s);
}

/** Latest daily close on or before isoDate for the asset (null before history). */
export function assetCloseForDate(ticker: AssetTicker, isoDate: string | null): number | null {
  return ticker === 'MNQ' ? mnqCloseForDate(isoDate) : assetTableCloseForDate(ticker, isoDate);
}

/** First/last session dates available for the asset (UI hints). */
export function assetPriceRange(ticker: AssetTicker): { first: string; last: string } {
  if (ticker === 'MNQ') return MNQ_PRICE_RANGE;
  // RTY (and any asset without a bundled price table) has no auto-$ closes —
  // MAE/MFE % still works; fall back to a generic range so the UI never crashes.
  return ASSET_PRICE_RANGE[ticker] ?? { first: '2024-01-01', last: '2026-12-31' };
}
