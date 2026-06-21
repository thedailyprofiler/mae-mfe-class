/**
 * LabRecommendCards — the 4-appetite recommendation strip shared by the Compare
 * and Cycle labs. Each card proposes WHICH moves to combine / cycle (valued at
 * each move's Step-2 / default risk) and Applies them into the panel's selection.
 */
import { useState } from 'react';
import { fmtDollars } from './format';
import { InfoTip } from './InfoTip';
import { APPETITES, type Appetite, type CombineRec, type CycleRec } from './labRecommend';

type Recs = Record<Appetite, CombineRec | CycleRec | null>;

const cardCls = 'flex-1 min-w-[220px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[6px] px-3 py-2.5';

const LAB_TARGETS: { lab: 'compare' | 'cycle' | 'montecarlo' | 'propsim' | 'portfolio'; label: string }[] = [
  { lab: 'compare', label: 'Compare' },
  { lab: 'cycle', label: 'Cycle' },
  { lab: 'montecarlo', label: 'MC' },
  { lab: 'propsim', label: 'Prop Sim' },
  { lab: 'portfolio', label: 'Portfolio' },
];

export function LabRecommendCards({
  variant, recs, busy, hasRun, onRun, onApply, label, targets, onApplyBasketTo,
}: {
  variant: 'combine' | 'cycle';
  recs: Recs | null;
  busy: boolean;
  hasRun: boolean;
  onRun: () => void;
  onApply: (rec: CombineRec | CycleRec, targetId?: string) => void;
  label: (key: string) => string;
  /** When set, render one Apply button per target (e.g. Set A / Set B). */
  targets?: { id: string; label: string }[];
  /** Cross-lab Send→ : load this basket into any other lab. */
  onApplyBasketTo?: (keys: string[], lab: 'compare' | 'cycle' | 'montecarlo' | 'propsim' | 'portfolio', source?: string) => void;
}) {
  // Open by default (cards auto-compute); the user can collapse the strip.
  const [open, setOpen] = useState(true);
  return (
    <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-inset)]/30">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button onClick={() => setOpen((o) => !o)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-[12px]" title={open ? 'Collapse' : 'Expand'}>{open ? '▾' : '▸'}</button>
        <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">🎯 Recommended {variant === 'combine' ? 'baskets to combine' : 'cycling setups'}</span>
        <span className="text-[10px] text-[var(--color-text-secondary)]">— picks WHICH moves; each valued at its Step-2 / default risk</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onRun} disabled={busy}
            className="text-[11px] px-3 py-1.5 rounded-[6px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-40">
            {busy ? 'Computing…' : hasRun ? 'Re-run' : 'Recommend'}
          </button>
          {open && <button onClick={() => setOpen(false)} className="text-[10px] px-2 py-1 rounded-[5px] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]" title="Hide these cards">Close ✕</button>}
        </div>
      </div>

      {open && busy && <div className="text-[11px] text-[var(--color-text-secondary)]">Ranking every move at your account profile…</div>}

      {open && hasRun && recs && (
        <div className="flex flex-wrap gap-2">
          {APPETITES.map(({ key, title, info, note }) => {
            const r = recs[key];
            return (
              <div key={key} className={cardCls}>
                <div className="flex items-center justify-between">
                  <div className="text-[9px] uppercase tracking-wide text-[var(--color-text-secondary)] flex items-center gap-1">{title}<InfoTip id={info} /></div>
                  {r && (
                    <div className="flex items-center gap-1">
                      {targets
                        ? targets.map((t) => (
                            <button key={t.id} onClick={() => onApply(r, t.id)} className="text-[9px] px-1.5 py-0.5 rounded-[4px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10">{t.label}</button>
                          ))
                        : <button onClick={() => onApply(r)} className="text-[9px] px-1.5 py-0.5 rounded-[4px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10">Apply</button>}
                    </div>
                  )}
                </div>
                {!r ? <div className="text-[10px] text-[var(--color-text-secondary)] mt-1">no qualifying basket</div> : (
                  <>
                    <div className="text-[9px] text-[var(--color-text-muted)] mt-1 leading-snug">{note}</div>
                    <div className="text-[10px] text-[var(--color-text-primary)] mt-1 leading-snug">
                      {r.keys.length} move{r.keys.length > 1 ? 's' : ''}: <span className="text-[var(--color-text-secondary)]">{r.keys.map(label).join(', ')}</span>
                    </div>
                    {variant === 'cycle' && 'numAccounts' in r ? (
                      <div className="text-[10px] font-[var(--font-mono)] mt-1.5">
                        <div className="text-[var(--color-accent)]">{r.numAccounts} accts · {r.k}× · {gapLabel(r.numAccounts, r.k)}</div>
                        <div className="text-[var(--color-text-secondary)]">total {fmtDollars(r.totalPnl)} · worst acct DD {fmtDollars(r.worstDD)}</div>
                      </div>
                    ) : (
                      <div className="text-[10px] font-[var(--font-mono)] mt-1.5 text-[var(--color-text-secondary)]">
                        total {fmtDollars(r.stats.totalPnl)} · maxDD {fmtDollars(r.stats.maxDrawdown)} · Sharpe {r.sharpe.toFixed(2)}
                      </div>
                    )}
                    {onApplyBasketTo && (
                      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                        <span className="text-[8px] uppercase tracking-wide text-[var(--color-text-muted)]">Send→</span>
                        {LAB_TARGETS.map((t) => (
                          <button key={t.lab} onClick={() => onApplyBasketTo([...r.keys], t.lab, `${variant === 'combine' ? 'Compare' : 'Cycle'} · ${title}`)}
                            className="text-[8px] px-1 py-0.5 rounded-[4px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/60">{t.label}</button>
                        ))}
                      </div>
                    )}
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

function gapLabel(N: number, k: number): string {
  const gap = N / k - 1;
  return `${Number.isInteger(gap) ? gap : gap.toFixed(1)}-gap`;
}
