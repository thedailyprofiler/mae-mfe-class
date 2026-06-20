/**
 * SetupRecommenderPanel — for the picked move, recommend the full setup
 * (entry + attempts + Min Cashflow / MFE target + Max MAE stop + contract size)
 * per risk appetite, cross-referencing every entry × attempt slice in the data.
 * Reads the global Account Profile (Prop/Live + rules). Button-triggered (heavy sweep).
 */
import { useEffect, useMemo, useState } from 'react';
import type { MaeMfeDocument } from './maeMfeDocument';
import { resolveStudy, DEFAULT_STUDY } from './maeMfeDocument';
import { applyAttemptFilter, type AttemptMode, type RawRow } from '../../../lib/maeMfeStats';
import { recommendSetup, type SetupRec, type VariantInput, type AccountMode } from '../../../lib/setupRecommender';
import type { AssetTicker } from '../../../lib/assets';
import { mulberry32, type PropRules } from '../../../lib/propSim';
import { InfoTip } from './InfoTip';

export interface SetupRecommenderPanelProps {
  doc: MaeMfeDocument;
  asset: AssetTicker;
  moveBase: string;        // e.g. '1800' / 'MO'
  rules: PropRules;
  mode: AccountMode;
  onApply: (r: SetupRec) => void;
  /** The config currently applied to the selected entry — used to show which path is active. */
  current?: { variantKey: string; minCf: number; maxMae: number; contracts: number };
}

const SLICES: { mode: AttemptMode; label: string }[] = [
  { mode: { kind: 'all' }, label: 'all attempts' },
  { mode: { kind: 'first', n: 1 }, label: '1 attempt' },
  { mode: { kind: 'first', n: 2 }, label: '2 attempts' },
  { mode: { kind: 'first', n: 3 }, label: '3 attempts' },
  { mode: { kind: 'only', n: 2 }, label: '2nd attempt only' },
  { mode: { kind: 'only', n: 3 }, label: '3rd attempt only' },
];
const rowsOf = (doc: MaeMfeDocument, asset: AssetTicker, key: string): RawRow[] => {
  const ms = doc[asset]?.[key];
  if (!ms) return [];
  const s = resolveStudy(ms, DEFAULT_STUDY);
  return [...s.inSample.rows, ...s.oos1.rows, ...s.oos2.rows, ...s.oos3.rows];
};
const hasMulti = (rows: RawRow[]) => { const seen = new Set<string>(); return rows.some((r) => r.tradeDate && (seen.has(r.tradeDate) || (seen.add(r.tradeDate), false))); };

const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;
const cardCls = 'flex-1 min-w-[210px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[6px] px-3 py-2.5';

const APPETITES: { key: keyof Omit<ReturnType<typeof recommendSetup>, 'mode'>; title: string; info: string }[] = [
  { key: 'fastest', title: '⚡ Fastest Growth', info: 'sr-fastest' },
  { key: 'safest', title: '🛡 Safest', info: 'sr-safest' },
  { key: 'bestOverall', title: '🏆 Best Overall', info: 'sr-bestoverall' },
  { key: 'professional', title: '🏛 Professionally', info: 'sr-professional' },
];

export function SetupRecommenderPanel({ doc, asset, moveBase, rules, mode, onApply, current }: SetupRecommenderPanelProps) {
  const variants = useMemo<VariantInput[]>(() => {
    const out: VariantInput[] = [];
    const breakoutKey = doc[asset]?.[`${moveBase}MA`] ? `${moveBase}MA` : doc[asset]?.[moveBase] ? moveBase : null;
    if (breakoutKey) {
      const rows = rowsOf(doc, asset, breakoutKey);
      const slices = hasMulti(rows) ? SLICES : [SLICES[0]];
      for (const s of slices) out.push({ key: breakoutKey, label: `Breakout · ${s.label}`, entry: 'Breakout', attempts: s.label, rows: applyAttemptFilter(rows, s.mode) });
    }
    if (doc[asset]?.[`${moveBase}FR`]) out.push({ key: `${moveBase}FR`, label: 'Front Run', entry: 'Front Run', attempts: '—', rows: rowsOf(doc, asset, `${moveBase}FR`) });
    if (doc[asset]?.[`${moveBase}PB`]) out.push({ key: `${moveBase}PB`, label: 'Pullback', entry: 'Pullback', attempts: '—', rows: rowsOf(doc, asset, `${moveBase}PB`) });
    return out.filter((v) => v.rows.length >= 5);
  }, [doc, asset, moveBase]);

  const [recs, setRecs] = useState<ReturnType<typeof recommendSetup> | null>(null);
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    setTimeout(() => {
      const r = recommendSetup(variants, asset, rules, { mode, sims: 250, rng: mulberry32(1) });
      setRecs(r);
      setBusy(false);
    }, 20);
  };

  // Auto-run: the cards stay always-open. Recompute (deferred, debounced by the
  // cleanup) whenever the move / asset / mode / account rules change, so the user
  // never has to press a button to see recommendations. "Re-run" forces a refresh.
  useEffect(() => {
    if (variants.length === 0) { setRecs(null); return; }
    setBusy(true);
    const id = setTimeout(() => {
      setRecs(recommendSetup(variants, asset, rules, { mode, sims: 250, rng: mulberry32(1) }));
      setBusy(false);
    }, 30);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants, asset, mode, rules.profitTarget, rules.maxDrawdown, rules.maxDays, rules.ddMode, rules.dailyLossLimit, rules.minTradingDays]);

  // Which recommendation (if any) matches the currently-applied config — so the
  // chip can tell the user whether they're on a recommendation or a manual setup.
  const activeTitle = useMemo(() => {
    if (!recs || !current) return null;
    for (const { key, title } of APPETITES) {
      const r = recs[key];
      if (r && r.variantKey === current.variantKey && r.minCf === current.minCf && (r.maxMae ?? 0) === current.maxMae && r.contracts === current.contracts) return title;
    }
    return null;
  }, [recs, current]);

  const seg = (w: number, bg: string) => (w > 0 ? <div style={{ width: `${w * 100}%`, background: bg }} className="overflow-hidden text-center text-[var(--color-text-primary)]">{w >= 0.16 ? `${(w * 100).toFixed(0)}%` : ''}</div> : null);
  const renderMetrics = (r: SetupRec) => {
    if (mode === 'prop') {
      const active = Math.max(0, 1 - r.pass - r.bust);
      return (
        <div className="mt-1.5">
          <div className="flex h-[13px] w-full rounded-[3px] overflow-hidden border border-[var(--color-border)] text-[8px] leading-[13px] font-[var(--font-mono)]">
            {seg(r.pass, 'rgba(95,174,127,0.55)')}{seg(active, 'rgba(150,150,150,0.35)')}{seg(r.bust, 'rgba(208,102,102,0.55)')}
          </div>
          <div className="text-[8px] text-[var(--color-text-secondary)] mt-1">🟩 hit target {(r.pass * 100).toFixed(0)}% · ⬜ still trading {(active * 100).toFixed(0)}% · 🟥 busted {(r.bust * 100).toFixed(0)}%</div>
          <div className="text-[10px] text-[var(--color-text-primary)] mt-0.5">{r.medianDays != null ? `~${Math.round(r.medianDays)}d to target · ` : ''}avg result {usd(r.expEnd)}</div>
        </div>
      );
    }
    return (
      <div className="text-[10px] mt-1.5 text-[var(--color-text-secondary)]">
        <div><span className="text-[var(--color-text-primary)]">{usd(r.expEnd)}</span> expected return · Sharpe {r.sharpe.toFixed(2)}</div>
        <div>{usd(r.maxDD)} max DD · {(r.ruin * 100).toFixed(0)}% risk of ruin</div>
      </div>
    );
  };

  return (
    <div className="mt-3 p-3 border border-[var(--color-border)] rounded-[8px] bg-[var(--color-bg-inset)]/30">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">🎯 Recommended setup for this move</span>
        <InfoTip id="sr-feature" />
        <span className="text-[10px] text-[var(--color-text-secondary)]">— {variants.length} entry×attempt slices · {mode === 'prop' ? 'Prop eval' : 'Live capital'}</span>
        {current && (
          <span className={['text-[9px] px-2 py-0.5 rounded-full border whitespace-nowrap', activeTitle ? 'border-[var(--color-accent)]/60 text-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'].join(' ')}
            title={activeTitle ? 'Your applied config matches this recommendation' : 'Your applied config is a manual / custom setup'}>
            {activeTitle ? `Active: ${activeTitle}` : '✎ Active: Manual / custom'}
          </span>
        )}
        <button onClick={run} disabled={busy || variants.length === 0}
          className="ml-auto text-[11px] px-3 py-1.5 rounded-[6px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-40">
          {busy ? 'Computing…' : 'Re-run'}
        </button>
      </div>

      {variants.length === 0 && <div className="text-[11px] text-[var(--color-text-secondary)]">No data for this move yet — collect it first.</div>}

      {busy && !recs && variants.length > 0 && <div className="text-[11px] text-[var(--color-text-secondary)]">Computing recommendations…</div>}

      {recs && mode === 'prop' && [recs.fastest, recs.safest, recs.bestOverall, recs.professional].every((r) => !r || r.pass === 0) && (
        <div className="text-[10px] text-[#d6a85f] mb-2">⚠ No setup reaches your <b>Target ${rules.profitTarget.toLocaleString()}</b> within <b>{rules.maxDays} days</b> — most runs are still trading toward it. Lower the Target or raise Max days in the Account Profile above.</div>
      )}

      {recs && (
        <div className="flex flex-wrap gap-2">
          {APPETITES.map(({ key, title, info }) => {
            const r = recs[key];
            return (
              <div key={key} className={cardCls}>
                <div className="flex items-center justify-between">
                  <div className="text-[9px] uppercase tracking-wide text-[var(--color-text-secondary)] flex items-center gap-1">{title}<InfoTip id={info} /></div>
                  {r && <button onClick={() => onApply(r)} className="text-[9px] px-1.5 py-0.5 rounded-[4px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10">Apply</button>}
                </div>
                {!r ? <div className="text-[10px] text-[var(--color-text-secondary)] mt-1">no qualifying setup</div> : (
                  <>
                    <div className="text-[12px] font-semibold text-[var(--color-text-primary)] mt-1">{r.entry}{r.attempts !== '—' ? ` · ${r.attempts}` : ''}</div>
                    <div className="text-[10px] font-[var(--font-mono)] text-[var(--color-text-secondary)] mt-0.5">
                      <span className="text-[var(--color-accent)]">{r.contracts} contracts</span> · MFE {r.minCf}% · Max MAE {r.maxMae > 0 ? `${r.maxMae}%` : 'off'}
                    </div>
                    {renderMetrics(r)}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
