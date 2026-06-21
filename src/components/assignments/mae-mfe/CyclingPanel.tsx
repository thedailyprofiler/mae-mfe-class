/**
 * CyclingPanel — account portfolio cycling, in-app.
 *
 * Pick the moves/assets whose trades form the stream, choose how many prop
 * accounts to cycle across and how many fire per trade (1× / 2× / 3× size), and
 * the gap-rotation engine distributes the ordered per-trade P&L across accounts,
 * tracking each account's running peak + trailing drawdown. Mirrors the owner's
 * cycling spreadsheet (verified: N=5/1× = "4-gap", N=5/2× = "1.5-gap").
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ASSETS, ASSET_ORDER } from '../../../lib/assets';
import { deriveSource, sequenceTrades, distributeByGapRotation } from '../../../lib/maeMfeCombine';
import type { AttemptMode } from '../../../lib/maeMfeStats';
import { mulberry32, type PropRules } from '../../../lib/propSim';
import type { MaeMfeDocument } from './maeMfeDocument';
import { buildLabSources, keyOf, SEP, maxStudyCount, ATTEMPT_OPTIONS, parseAttempt, attemptValue } from './labSources';
import { recommendCycle, type Appetite, type CombineRec, type CycleRec } from './labRecommend';
import { LabRecommendCards } from './LabRecommendCards';
import { fmtDollars, dollarTone } from './format';
import { InfoTip } from './InfoTip';

interface MoveOpt { id: string; label: string }

export interface CyclingPanelProps {
  doc: MaeMfeDocument;
  moves: MoveOpt[];
  onClose: () => void;
  /** Account profile rules — DD budget drives the "Professionally" N/k pick. */
  acctRules: PropRules;
  /** Selection + sizing lifted to the parent so Monte Carlo can resample the stream. */
  selected: Set<string>;
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  numAccounts: number;
  setNumAccounts: Dispatch<SetStateAction<number>>;
  k: number;
  setK: Dispatch<SetStateAction<number>>;
  /** Cross-lab Send→ on the recommendation cards. */
  onApplyBasketTo?: (keys: string[], lab: 'compare' | 'cycle' | 'montecarlo' | 'propsim' | 'portfolio', source?: string) => void;
}

const SIZES = [
  { k: 1, label: '1×' },
  { k: 2, label: '2×' },
  { k: 3, label: '3×' },
];

const selectCls =
  'bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2 py-1 text-[11px] font-[var(--font-mono)] text-[var(--color-text-primary)] focus:outline-none';

export function CyclingPanel({ doc, moves, onClose, acctRules, selected, setSelected, numAccounts, setNumAccounts, k, setK, onApplyBasketTo }: CyclingPanelProps) {
  const [studyOrdinal, setStudyOrdinal] = useState(1);
  const [attemptMode, setAttemptMode] = useState<AttemptMode>({ kind: 'all' });

  const maxStudies = useMemo(() => maxStudyCount(doc), [doc]);

  // Cycling-setup recommendations (which moves + accounts + size, per appetite).
  const labelOf = useMemo(() => {
    const m = new Map(moves.map((o) => [o.id, o.label]));
    return (key: string) => { const [a, mv] = key.split(SEP); return `${a} ${m.get(mv) ?? mv}`; };
  }, [moves]);
  const [recs, setRecs] = useState<Record<Appetite, CombineRec | CycleRec | null> | null>(null);
  const [busy, setBusy] = useState(false);
  const runRecs = () => {
    setBusy(true);
    setTimeout(() => {
      setRecs(recommendCycle(doc, acctRules, 1, { kind: 'all' }, labelOf, { sims: 200, rng: mulberry32(1) }));
      setBusy(false);
    }, 20);
  };
  const applyRec = (r: CombineRec | CycleRec) => {
    setSelected(new Set(r.keys));
    setStudyOrdinal(1);
    setAttemptMode({ kind: 'all' });
    if ('numAccounts' in r) { setNumAccounts(r.numAccounts); setK(r.k); }
  };
  const clearAll = () => { setSelected(new Set()); setNumAccounts(5); setK(1); setStudyOrdinal(1); setAttemptMode({ kind: 'all' }); };
  // Auto-run the recommendations when the lab opens (cards stay open by default).
  useEffect(() => { runRecs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { result, tradeCount, gapLabel } = useMemo(() => {
    const streams = buildLabSources(doc, selected, studyOrdinal, attemptMode).map(deriveSource);
    const seq = sequenceTrades(streams);
    const kk = Math.min(k, numAccounts);
    const res = distributeByGapRotation(seq.map((t) => t.pnl), numAccounts, kk);
    const gap = numAccounts / kk - 1;
    return { result: res, tradeCount: seq.length, gapLabel: `${Number.isInteger(gap) ? gap : gap.toFixed(1)}-gap · ${kk}×` };
  }, [doc, selected, numAccounts, k, studyOrdinal, attemptMode]);

  // The "sick account" — the one rotation dumps the deepest drawdown onto.
  const sickAcct = result.accounts.length ? result.accounts.reduce((w, a) => (a.maxDrawdown < w.maxDrawdown ? a : w)) : null;

  return (
    <section
      data-testid="mae-mfe-cycling"
      className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-1)] overflow-hidden"
    >
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
        <div>
          <h2 className="flex items-center gap-2 font-[var(--font-serif)] text-xl font-semibold text-[var(--color-text-primary)] leading-none">
            Account Portfolio Cycling
            <InfoTip id="cycleLab" />
          </h2>
          <p className="mt-1 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Distribute the trade stream across prop accounts · {tradeCount} trades · {gapLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearAll}
            disabled={selected.size === 0}
            data-testid="mae-mfe-cycling-clear"
            className="px-3 py-1.5 rounded-[6px] border border-[var(--color-border)] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:border-[var(--color-error)]/50 disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="mae-mfe-cycling-close"
            className="px-3 py-1.5 rounded-[6px] border border-[var(--color-border)] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          >
            ← Back
          </button>
        </div>
      </header>

      {/* Cycling-setup recommendations → Apply fills sources + accounts + size */}
      <LabRecommendCards variant="cycle" recs={recs} busy={busy} hasRun={recs !== null} onRun={runRecs} onApply={applyRec} label={labelOf} onApplyBasketTo={onApplyBasketTo} />

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-5 px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-inset)]/40">
        <div>
          <div className="text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-text-muted)] mb-1">Accounts</div>
          <div className="inline-flex items-center rounded-[6px] border border-[var(--color-border)] bg-[var(--color-bg-inset)]">
            <button type="button" data-testid="cy-acct-dec" onClick={() => setNumAccounts((n) => Math.max(1, n - 1))} className="px-2.5 py-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">−</button>
            <span data-testid="cy-acct-count" className="px-3 text-[13px] font-[var(--font-mono)] tabular-nums text-[var(--color-text-primary)]">{numAccounts}</span>
            <button type="button" data-testid="cy-acct-inc" onClick={() => setNumAccounts((n) => Math.min(20, n + 1))} className="px-2.5 py-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">+</button>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-text-muted)] mb-1">Size (accts / trade)<InfoTip id="size" /></div>
          <div className="inline-flex items-center rounded-[6px] border border-[var(--color-border)] bg-[var(--color-bg-inset)] p-[3px]">
            {SIZES.map((s) => (
              <button
                key={s.k}
                type="button"
                onClick={() => setK(s.k)}
                data-testid={`cy-size-${s.k}`}
                className={[
                  'px-3 py-[5px] rounded-[4px] text-[10px] font-[var(--font-mono)] font-semibold uppercase tracking-[0.12em] transition-colors',
                  k === s.k ? 'bg-[rgba(247,208,0,0.14)] text-[var(--color-accent)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                ].join(' ')}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {maxStudies > 1 && (
          <div>
            <div className="text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-text-muted)] mb-1">Study</div>
            <select value={studyOrdinal} onChange={(e) => setStudyOrdinal(Number(e.target.value))} className={selectCls} data-testid="cy-study">
              {Array.from({ length: maxStudies }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n === 1 ? 'Default study' : `Study ${n}`}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <div className="text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-text-muted)] mb-1">Attempts</div>
          <select value={attemptValue(attemptMode)} onChange={(e) => setAttemptMode(parseAttempt(e.target.value))} className={selectCls} data-testid="cy-attempts">
            {ATTEMPT_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-end gap-5">
          <Metric label="Total P&L" value={fmtDollars(result.totalPnl)} tone={dollarTone(result.totalPnl)} testid="cy-total" />
          <Metric label="Combined DD budget" value={acctRules.maxDrawdown > 0 ? fmtDollars(numAccounts * acctRules.maxDrawdown) : '—'} />
          <Metric label="Best Acct" value={result.best ? fmtDollars(result.best.net) : '—'} tone={dollarTone(result.best?.net)} />
          <Metric label="Worst Acct" value={result.worst ? fmtDollars(result.worst.net) : '—'} tone={dollarTone(result.worst?.net)} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)]">
        {/* Source picker */}
        <div className="p-4">
          <div className="text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-text-muted)] mb-2">Trade sources</div>
          <table className="w-full border-collapse text-[10px] font-[var(--font-mono)]">
            <thead>
              <tr>
                <th className="text-left px-1 py-1 text-[9px] uppercase tracking-[0.1em] text-[var(--color-text-muted)]">Move</th>
                {ASSET_ORDER.map((a) => (
                  <th key={a} className="px-0.5 py-1 text-[8px] uppercase text-[var(--color-text-muted)]">{ASSETS[a].label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id} className="border-t border-[var(--color-border)]/60">
                  <td className="px-1 py-1 text-[var(--color-text-secondary)] max-w-[90px] truncate" title={m.label}>{m.label}</td>
                  {ASSET_ORDER.map((a) => {
                    const key = keyOf(a, m.id);
                    const on = selected.has(key);
                    return (
                      <td key={a} className="px-0.5 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => toggle(key)}
                          aria-pressed={on}
                          data-testid={`cy-src-${a}-${m.id}`}
                          className={[
                            'w-5 h-5 rounded-[4px] border text-[10px] leading-none transition-colors',
                            on ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent)]/20 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-transparent hover:border-[var(--color-text-muted)]',
                          ].join(' ')}
                        >
                          ✓
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Per-account breakdown */}
        <div className="p-0">
          <table className="w-full border-collapse font-[var(--font-mono)]">
            <thead>
              <tr className="bg-[var(--color-bg-inset)]/40">
                <th className="text-left px-5 py-2 text-[9px] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">Account</th>
                <th className="px-4 py-2 text-right text-[9px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Net</th>
                <th className="px-4 py-2 text-right text-[9px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]"><span className="inline-flex items-center gap-1">Peak<InfoTip id="accountPeak" /></span></th>
                <th className="px-4 py-2 text-right text-[9px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]"><span className="inline-flex items-center gap-1">Max Drawdown<InfoTip id="accountDrawdown" /></span></th>
              </tr>
            </thead>
            <tbody>
              {result.accounts.map((acct) => {
                const isSick = sickAcct != null && acct.account === sickAcct.account && acct.maxDrawdown < 0;
                return (
                <tr key={acct.account} className={`border-t border-[var(--color-border)]/60 ${isSick ? 'bg-[var(--color-error)]/5' : ''}`} data-testid={`cy-row-${acct.account}`}>
                  <td className="px-5 py-2 text-[11px] text-[var(--color-text-secondary)]">Account {acct.account}{isSick ? <span className="ml-1.5 text-[9px] text-[var(--color-error)]" title="Takes the deepest drawdown — the account rotation dumps the losing streaks onto">🤒 sick</span> : ''}</td>
                  <td className={`px-4 py-2 text-right text-[12px] tabular-nums ${dollarTone(acct.net)}`} data-testid={`cy-net-${acct.account}`}>{fmtDollars(acct.net)}</td>
                  <td className="px-4 py-2 text-right text-[12px] tabular-nums text-[var(--color-text-muted)]">{fmtDollars(acct.peak)}</td>
                  <td className={`px-4 py-2 text-right text-[12px] tabular-nums ${dollarTone(acct.maxDrawdown)}`}>{fmtDollars(acct.maxDrawdown)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {tradeCount === 0 && (
            <p className="px-5 py-8 text-center text-[11px] font-[var(--font-mono)] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              Pick one or more trade sources to build the stream
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, tone, testid }: { label: string; value: string; tone?: string; testid?: string }) {
  return (
    <div data-testid={testid}>
      <div className={`font-[var(--font-mono)] text-base font-semibold leading-none tabular-nums ${tone ?? 'text-[var(--color-text-primary)]'}`}>{value}</div>
      <div className="mt-1 text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-text-muted)]">{label}</div>
    </div>
  );
}
