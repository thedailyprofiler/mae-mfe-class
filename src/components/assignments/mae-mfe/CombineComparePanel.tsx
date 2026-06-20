/**
 * CombineComparePanel — build two sets of (asset, move) sources, combine each in
 * DOLLAR space (sum same-day trades across assets/moves), and compare A vs B.
 *
 * Covers three asks at once:
 *   - move ↔ move   (Set A = {1800}, Set B = {0300})
 *   - asset ↔ asset (Set A = {MNQ·1800}, Set B = {MES·1800})
 *   - combined ↔ combined ("what if I took both moves that day" — pick several
 *     sources into one set; they're netted per trade date).
 *
 * Each source contributes its default-study rows (In Sample + OOS 1/2/3). Cross-
 * asset summing is valid because we combine each row's $ netCashflow, never %.
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ASSETS, ASSET_ORDER } from '../../../lib/assets';
import { combinedStats, type StreamStats } from '../../../lib/maeMfeCombine';
import type { AttemptMode } from '../../../lib/maeMfeStats';
import { mulberry32, type PropRules } from '../../../lib/propSim';
import type { MaeMfeDocument } from './maeMfeDocument';
import { buildLabSources, keyOf, SEP, maxStudyCount, ATTEMPT_OPTIONS, parseAttempt, attemptValue } from './labSources';
import { recommendCombine, type Appetite, type CombineRec, type CycleRec } from './labRecommend';
import { LabRecommendCards } from './LabRecommendCards';
import { fmtDollars, fmtNumber, fmtRatio, dollarTone } from './format';
import { InfoTip } from './InfoTip';

interface MoveOpt { id: string; label: string }

export interface CombineComparePanelProps {
  doc: MaeMfeDocument;
  moves: MoveOpt[];
  onClose: () => void;
  /** Account profile rules — used to rank moves for the recommendation cards. */
  acctRules: PropRules;
  /** Set A is lifted to the parent so Monte Carlo / other labs can resample it. */
  setA: Set<string>;
  setSetA: Dispatch<SetStateAction<Set<string>>>;
}

const selectCls =
  'bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2 py-1 text-[10px] font-[var(--font-mono)] text-[var(--color-text-primary)] focus:outline-none';

function SourceMatrix({
  side,
  moves,
  selected,
  onToggle,
}: {
  side: 'A' | 'B';
  moves: MoveOpt[];
  selected: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <table className="w-full border-collapse text-[10px] font-[var(--font-mono)]">
      <thead>
        <tr>
          <th className="text-left px-1.5 py-1 text-[9px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Move</th>
          {ASSET_ORDER.map((a) => (
            <th key={a} className="px-1 py-1 text-[9px] uppercase tracking-[0.1em] text-[var(--color-text-muted)]">{ASSETS[a].label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {moves.map((m) => (
          <tr key={m.id} className="border-t border-[var(--color-border)]/60">
            <td className="px-1.5 py-1 text-[var(--color-text-secondary)] whitespace-nowrap max-w-[120px] truncate" title={m.label}>{m.label}</td>
            {ASSET_ORDER.map((a) => {
              const key = keyOf(a, m.id);
              const on = selected.has(key);
              return (
                <td key={a} className="px-1 py-1 text-center">
                  <button
                    type="button"
                    onClick={() => onToggle(key)}
                    aria-pressed={on}
                    data-testid={`cc-${side}-${a}-${m.id}`}
                    className={[
                      'w-5 h-5 rounded-[4px] border text-[10px] leading-none transition-colors',
                      on
                        ? 'border-[var(--color-accent-dim)] bg-[var(--color-accent)]/20 text-[var(--color-accent)]'
                        : 'border-[var(--color-border)] text-transparent hover:border-[var(--color-text-muted)]',
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
  );
}

const METRICS: { label: string; get: (s: StreamStats) => number | null; money?: boolean; ratio?: boolean; tone?: boolean }[] = [
  { label: 'Total P&L', get: (s) => s.totalPnl, money: true, tone: true },
  { label: 'Trades', get: (s) => s.trades },
  { label: 'Days', get: (s) => s.days },
  { label: 'Win Rate (days)', get: (s) => s.winRateByDay, ratio: true },
  { label: 'Avg / Day', get: (s) => s.avgDay, money: true, tone: true },
  { label: 'Best Day', get: (s) => s.bestDay, money: true, tone: true },
  { label: 'Worst Day', get: (s) => s.worstDay, money: true, tone: true },
  { label: 'Max Drawdown', get: (s) => s.maxDrawdown, money: true, tone: true },
];

function fmtMetric(v: number | null, m: { money?: boolean; ratio?: boolean }): string {
  if (m.money) return fmtDollars(v);
  if (m.ratio) return fmtRatio(v);
  return fmtNumber(v);
}

export function CombineComparePanel({ doc, moves, onClose, acctRules, setA, setSetA }: CombineComparePanelProps) {
  const [setB, setSetB] = useState<Set<string>>(new Set());
  // Per-set study (ordinal) + attempt subset.
  const [studyA, setStudyA] = useState(1);
  const [studyB, setStudyB] = useState(1);
  const [attemptA, setAttemptA] = useState<AttemptMode>({ kind: 'all' });
  const [attemptB, setAttemptB] = useState<AttemptMode>({ kind: 'all' });

  const maxStudies = useMemo(() => maxStudyCount(doc), [doc]);

  // Move-basket recommendations (which moves to combine, per risk appetite).
  const labelOf = useMemo(() => {
    const m = new Map(moves.map((o) => [o.id, o.label]));
    return (key: string) => { const [a, mv] = key.split(SEP); return `${a} ${m.get(mv) ?? mv}`; };
  }, [moves]);
  const [recs, setRecs] = useState<Record<Appetite, CombineRec | CycleRec | null> | null>(null);
  const [busy, setBusy] = useState(false);
  const runRecs = () => {
    setBusy(true);
    setTimeout(() => {
      setRecs(recommendCombine(doc, acctRules, 1, { kind: 'all' }, labelOf, { sims: 200, rng: mulberry32(1) }));
      setBusy(false);
    }, 20);
  };
  const applyRec = (r: CombineRec | CycleRec, target?: string) => {
    if (target === 'B') { setSetB(new Set(r.keys)); setStudyB(1); setAttemptB({ kind: 'all' }); }
    else { setSetA(new Set(r.keys)); setStudyA(1); setAttemptA({ kind: 'all' }); }
  };
  const clearAll = () => {
    setSetA(new Set()); setSetB(new Set());
    setStudyA(1); setStudyB(1); setAttemptA({ kind: 'all' }); setAttemptB({ kind: 'all' });
  };
  // Auto-run the recommendations when the lab opens (cards stay open by default).
  useEffect(() => { runRecs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (set: 'A' | 'B', key: string) => {
    const setter = set === 'A' ? setSetA : setSetB;
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const a = useMemo(() => combinedStats(buildLabSources(doc, setA, studyA, attemptA)), [doc, setA, studyA, attemptA]);
  const b = useMemo(() => combinedStats(buildLabSources(doc, setB, studyB, attemptB)), [doc, setB, studyB, attemptB]);

  return (
    <section
      data-testid="mae-mfe-compare-lab"
      className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface-1)] overflow-hidden"
    >
      <header className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
        <div>
          <h2 className="flex items-center gap-2 font-[var(--font-serif)] text-xl font-semibold text-[var(--color-text-primary)] leading-none">
            Compare &amp; Combine
            <InfoTip id="compareLab" />
          </h2>
          <p className="mt-1 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
            Net multiple moves/assets per day · compare set A vs set B in dollars
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearAll}
            disabled={setA.size === 0 && setB.size === 0}
            data-testid="mae-mfe-compare-clear"
            className="px-3 py-1.5 rounded-[6px] border border-[var(--color-border)] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:border-[var(--color-error)]/50 disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="mae-mfe-compare-lab-close"
            className="px-3 py-1.5 rounded-[6px] border border-[var(--color-border)] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          >
            ← Back
          </button>
        </div>
      </header>

      {/* Move-basket recommendations → Apply into Set A or Set B */}
      <LabRecommendCards variant="combine" recs={recs} busy={busy} hasRun={recs !== null} onRun={runRecs} onApply={applyRec} label={labelOf} targets={[{ id: 'A', label: '→ A' }, { id: 'B', label: '→ B' }]} />

      {/* Source pickers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)]">
        {(['A', 'B'] as const).map((side) => {
          const sel = side === 'A' ? setA : setB;
          const res = side === 'A' ? a : b;
          const study = side === 'A' ? studyA : studyB;
          const setStudy = side === 'A' ? setStudyA : setStudyB;
          const attempt = side === 'A' ? attemptA : attemptB;
          const setAttempt = side === 'A' ? setAttemptA : setAttemptB;
          return (
            <div key={side} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="inline-flex items-center justify-center w-5 h-5 rounded-[4px] text-[10px] font-bold font-[var(--font-mono)]"
                  style={{ background: side === 'A' ? 'rgba(125,211,252,0.18)' : 'rgba(247,208,0,0.18)', color: side === 'A' ? '#7dd3fc' : 'var(--color-accent)' }}
                >
                  {side}
                </span>
                <span className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                  {sel.size === 0 ? 'pick sources' : `${sel.size} source${sel.size > 1 ? 's' : ''} combined`}
                </span>
                {res.unpriced > 0 && (
                  <span className="ml-auto text-[9px] font-[var(--font-mono)] text-[var(--color-error)]" title="Rows with no daily close available are excluded">
                    {res.unpriced} unpriced excluded
                  </span>
                )}
              </div>
              {/* Per-set study + attempt selectors */}
              <div className="flex items-center gap-2 mb-2.5">
                {maxStudies > 1 && (
                  <select
                    value={study}
                    onChange={(e) => setStudy(Number(e.target.value))}
                    className={selectCls}
                    data-testid={`cc-${side}-study`}
                    aria-label={`Set ${side} study`}
                  >
                    {Array.from({ length: maxStudies }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n === 1 ? 'Default study' : `Study ${n}`}</option>
                    ))}
                  </select>
                )}
                <select
                  value={attemptValue(attempt)}
                  onChange={(e) => setAttempt(parseAttempt(e.target.value))}
                  className={selectCls}
                  data-testid={`cc-${side}-attempts`}
                  aria-label={`Set ${side} attempts`}
                >
                  {ATTEMPT_OPTIONS.map((o) => (
                    <option key={o.v} value={o.v}>{o.label}</option>
                  ))}
                </select>
              </div>
              <SourceMatrix side={side} moves={moves} selected={sel} onToggle={(k) => toggle(side, k)} />
            </div>
          );
        })}
      </div>

      {/* Comparison table */}
      <div className="border-t border-[var(--color-border)]">
        <table className="w-full border-collapse font-[var(--font-mono)]">
          <thead>
            <tr className="bg-[var(--color-bg-inset)]/40">
              <th className="text-left px-5 py-2 text-[9px] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">Metric</th>
              <th className="px-4 py-2 text-right text-[10px] uppercase tracking-[0.12em]" style={{ color: '#7dd3fc' }}>Set A</th>
              <th className="px-4 py-2 text-right text-[9px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Δ (A−B)</th>
              <th className="px-4 py-2 text-right text-[10px] uppercase tracking-[0.12em] text-[var(--color-accent)]">Set B</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const av = m.get(a.stats);
              const bv = m.get(b.stats);
              const delta = av !== null && bv !== null ? av - bv : null;
              return (
                <tr key={m.label} className="border-t border-[var(--color-border)]/60" data-testid={`cc-metric-${m.label.replace(/[^a-z]/gi, '').toLowerCase()}`}>
                  <td className="px-5 py-2 text-[11px] text-[var(--color-text-secondary)]">{m.label}</td>
                  <td className={`px-4 py-2 text-right text-[12px] tabular-nums ${m.tone ? dollarTone(av) : 'text-[var(--color-text-primary)]'}`}>{fmtMetric(av, m)}</td>
                  <td className={`px-4 py-2 text-right text-[11px] tabular-nums ${m.tone && delta !== null ? dollarTone(delta) : 'text-[var(--color-text-muted)]'}`}>
                    {delta === null ? '—' : (m.money ? `${delta >= 0 ? '+' : ''}${fmtMetric(delta, m)}` : m.ratio ? fmtMetric(delta, m) : fmtNumber(delta))}
                  </td>
                  <td className={`px-4 py-2 text-right text-[12px] tabular-nums ${m.tone ? dollarTone(bv) : 'text-[var(--color-text-primary)]'}`}>{fmtMetric(bv, m)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
