/**
 * CorrelationPanel — cross-move correlation across every populated (asset, move),
 * driven by each move's settings-synced daily return (see lib/correlation.ts).
 * Mirrors QuantDash Pro's Correlation tab: 6 lenses, N×N heatmap, stat cards,
 * portfolio stats, and most/least-correlated pairs. BLUF tooltip on every lens.
 */
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MaeMfeDocument } from './maeMfeDocument';
import { buildSeries, computeMatrix, portfolioStats, correlationInsights, isSignificant, type Lens } from '../../../lib/correlation';
import { InfoTip } from './InfoTip';

interface MoveOpt { id: string; label: string }
export interface CorrelationPanelProps {
  doc: MaeMfeDocument;
  moves: MoveOpt[];
  onClose: () => void;
}

const LENSES: { id: Lens; label: string; info: string }[] = [
  { id: 'pearson', label: 'Returns (Pearson)', info: 'corr-pearson' },
  { id: 'spearman', label: 'Returns (Spearman)', info: 'corr-spearman' },
  { id: 'downside', label: 'Downside', info: 'corr-downside' },
  { id: 'drawdown', label: 'Drawdown', info: 'corr-drawdown' },
  { id: 'codrawdown', label: 'Co-Drawdown %', info: 'corr-codrawdown' },
  { id: 'tail', label: 'Tail Risk', info: 'corr-tail' },
];

// 0 (good / diversifies) -> green, 1 (bad / redundant) -> red
function cellColor(v: number, lens: Lens): string {
  const isCorr = lens === 'pearson' || lens === 'spearman' || lens === 'downside' || lens === 'drawdown';
  const risk = isCorr ? Math.max(0, v) : v; // negative corr = hedge = good (risk 0)
  const r = Math.round(40 + risk * 150);
  const g = Math.round(140 - risk * 90);
  return `rgba(${r},${g},90,0.45)`;
}
const fmt = (v: number, lens: Lens) =>
  lens === 'codrawdown' || lens === 'tail' ? `${(v * 100).toFixed(0)}%` : v.toFixed(2);

type Tone = 'bad' | 'mid' | 'good' | 'hedge';
const TONE: Record<Tone, string> = { bad: '#d06666', mid: '#d6a85f', good: '#5fae7f', hedge: '#6aa3d6' };

/** Read a cell value through its lens → an actionable "trade together / against" verdict. */
function verdict(v: number, lens: Lens): { tag: string; advice: string; tone: Tone } {
  if (lens === 'codrawdown' || lens === 'tail') {
    const pct = (v * 100).toFixed(0);
    const where = lens === 'tail' ? 'their worst days' : 'their drawdown days';
    if (v >= 0.6) return { tone: 'bad', tag: 'Crash together — don’t stack', advice: `${pct}% of ${where} land on the same dates. Running both gives no cover when it hurts most — pick one or cut size.` };
    if (v >= 0.3) return { tone: 'mid', tag: 'Shared pain — caution', advice: `${pct}% of ${where} overlap. Some diversification, but they still sink together on bad stretches.` };
    return { tone: 'good', tag: 'Independent drawdowns — combine', advice: `Only ${pct}% of ${where} overlap. When one dips the other tends to hold — safe to trade together.` };
  }
  const w = lens === 'downside' ? ' on losing days' : lens === 'drawdown' ? ' through their slumps' : '';
  if (v >= 0.6) return { tone: 'bad', tag: 'Redundant — trade one', advice: `They win and lose together${w}. Running both ≈ doubling one bet (2× risk, no smoothing). Trade the stronger one, or size them as a single position.` };
  if (v >= 0.3) return { tone: 'mid', tag: 'Partly redundant', advice: `Noticeable overlap${w}. Combining adds size more than diversification — fine, but don’t count it as two independent edges.` };
  if (v > -0.3) return { tone: 'good', tag: 'Independent — trade together', advice: `Little relationship${w}. Different days drive each, so running both smooths the combined curve. The best kind of pair to stack.` };
  return { tone: 'hedge', tag: 'Opposite — natural hedge', advice: `They move opposite${w}: one tends to win when the other loses. Running both flattens P&L (a hedge, low risk / low reward) rather than growing it.` };
}

const cardCls = 'flex-1 min-w-[120px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[6px] px-3 py-2';
const lblCls = 'text-[9px] uppercase tracking-wide text-[var(--color-text-secondary)]';
const valCls = 'text-[15px] font-[var(--font-mono)] text-[var(--color-text-primary)]';

export function CorrelationPanel({ doc, moves, onClose }: CorrelationPanelProps) {
  const [lens, setLens] = useState<Lens>('pearson');
  const [hover, setHover] = useState<{ x: number; y: number; i: number; j: number } | null>(null);
  const moveLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mv of moves) m[mv.id] = mv.label;
    return (id: string) => m[id] ?? id;
  }, [moves]);

  const series = useMemo(() => buildSeries(doc, moveLabel), [doc, moveLabel]);
  const mtx = useMemo(() => computeMatrix(series, lens), [series, lens]);
  const port = useMemo(() => portfolioStats(series), [series]);
  const insights = useMemo(() => correlationInsights(series, lens), [series, lens]);
  const isCorr = lens === 'pearson' || lens === 'spearman' || lens === 'downside' || lens === 'drawdown';

  if (series.length < 2) {
    return (
      <div className="mt-3 p-4 border border-[var(--color-border)] rounded-[6px] bg-[var(--color-bg-inset)]/40 text-[11px] text-[var(--color-text-secondary)]">
        Correlation needs at least 2 populated moves. Load more moves/instruments, then reopen.
        <button onClick={onClose} className="ml-3 text-[var(--color-accent)]">close</button>
      </div>
    );
  }

  const mostLeast = mtx.pairs;
  const top = mostLeast.slice(0, 5);
  const bottom = [...mostLeast].reverse().slice(0, 5);

  return (
    <div className="mt-3 p-4 border border-[var(--color-border)] rounded-[6px] bg-[var(--color-bg-inset)]/40">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">Portfolio Correlation</span>
          <InfoTip id="corr-feature" />
        </div>
        <button onClick={onClose} className="text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">close ✕</button>
      </div>

      {/* lens tabs, each with BLUF tooltip */}
      <div className="flex flex-wrap gap-1 mb-3" role="tablist">
        {LENSES.map((l) => (
          <button key={l.id} onClick={() => setLens(l.id)} aria-pressed={lens === l.id}
            className={`px-2 py-1 text-[10px] rounded-[4px] border flex items-center gap-1 ${lens === l.id ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-text-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}>
            {l.label}<InfoTip id={l.info} />
          </button>
        ))}
      </div>

      {/* stat cards */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className={cardCls}><div className={lblCls}>Strategies</div><div className={valCls}>{series.length}</div></div>
        <div className={cardCls}><div className={lblCls}>Trading Days</div><div className={valCls}>{mtx.tradingDays}</div></div>
        <div className={cardCls}><div className={lblCls}>Avg {isCorr ? 'Correlation' : 'Overlap'}</div><div className={valCls}>{fmt(mtx.avgOffDiag, lens)}</div></div>
        <div className={cardCls}><div className="flex items-center gap-1"><span className={lblCls}>Diversified Pairs</span><InfoTip id="corr-diversified" /></div><div className={valCls}>{mtx.diversifiedPairs[0]} / {mtx.diversifiedPairs[1]}</div></div>
        <div className={cardCls}><div className={lblCls}>Overlap Events</div><div className={valCls}>{mtx.overlapEvents}</div></div>
      </div>

      {/* ── Correlation insights (recommendations) — above the heatmap ── */}
      <div className="mb-3 p-2.5 rounded-[6px] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/[0.04]">
        <div className="flex items-center gap-1.5 mb-1.5"><span className="text-[11px] font-semibold text-[var(--color-accent)]">📌 Correlation insights</span><InfoTip id="corr-insights" /></div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[10px]">
          <div><span className="text-[#d06666] uppercase tracking-wide">Most redundant</span> — {insights.redundant ? <>{insights.redundant.a} / {insights.redundant.b} <b className="text-[var(--color-text-primary)] font-[var(--font-mono)]">{fmt(insights.redundant.v, lens)}</b> <span className="text-[var(--color-text-secondary)]">→ keep the higher-edge one{insights.redundant.structural ? ' (structural: same session)' : ''}</span></> : <span className="text-[var(--color-text-secondary)]">none significant</span>}</div>
          <div><span className="text-[#5fae7f] uppercase tracking-wide">Best diversifier</span> — {insights.diversifier ? <>{insights.diversifier.label} <span className="text-[var(--color-text-secondary)]">(avg |corr| {insights.diversifier.avgAbs.toFixed(2)}) → adds the most independence</span></> : <span className="text-[var(--color-text-secondary)]">—</span>}</div>
          <div><span className="text-[#d6a85f] uppercase tracking-wide">Tail-risk pair</span> — {insights.tailPair ? <>{insights.tailPair.a} / {insights.tailPair.b} <b className="text-[var(--color-text-primary)] font-[var(--font-mono)]">{(insights.tailPair.v * 100).toFixed(0)}%</b> <span className="text-[var(--color-text-secondary)]">worst-day overlap → don’t stack</span></> : <span className="text-[var(--color-text-secondary)]">—</span>}</div>
          {insights.structuralCount > 0 && <div className="text-[var(--color-text-muted)]">{insights.structuralCount} same-session cross-asset pair{insights.structuralCount === 1 ? '' : 's'} (structural co-movement — won’t diversify away)</div>}
        </div>
        {/* most / least correlated, on top of the heatmap */}
        <div className="flex flex-wrap gap-4 mt-2 pt-2 border-t border-[var(--color-border)]">
          <div className="flex-1 min-w-[260px]">
            <div className="text-[9px] uppercase tracking-wide text-[#d06666] mb-1">Most correlated (redundant)</div>
            {top.map((p, i) => <div key={i} className="flex justify-between text-[10px] py-0.5"><span className="text-[var(--color-text-secondary)] truncate">{p.a} / {p.b}</span><span className="font-[var(--font-mono)] text-[var(--color-text-primary)]">{fmt(p.v, lens)}</span></div>)}
          </div>
          <div className="flex-1 min-w-[260px]">
            <div className="text-[9px] uppercase tracking-wide text-[#5fae7f] mb-1">Least correlated (diversifiers)</div>
            {bottom.map((p, i) => <div key={i} className="flex justify-between text-[10px] py-0.5"><span className="text-[var(--color-text-secondary)] truncate">{p.a} / {p.b}</span><span className="font-[var(--font-mono)] text-[var(--color-text-primary)]">{fmt(p.v, lens)}</span></div>)}
          </div>
        </div>
      </div>

      {/* heatmap */}
      <div className="overflow-x-auto mb-2">
        <table className="text-[10px] font-[var(--font-mono)] border-collapse">
          <thead><tr><th className="p-1"></th>{series.map((s) => <th key={s.key} className="p-1 text-[var(--color-text-secondary)] font-normal whitespace-nowrap" title={s.label}>{s.label.length > 14 ? s.label.slice(0, 13) + '…' : s.label}</th>)}</tr></thead>
          <tbody>
            {series.map((row, i) => (
              <tr key={row.key}>
                <td className="p-1 text-right text-[var(--color-text-secondary)] whitespace-nowrap" title={row.label}>{row.label.length > 16 ? row.label.slice(0, 15) + '…' : row.label}</td>
                {series.map((_, j) => {
                  const ns = i !== j && !isSignificant(mtx.m[i][j], mtx.o[i][j], lens); // small-sample noise
                  return (
                  <td key={j}
                    title={ns ? 'Not statistically significant (small sample / low overlap)' : undefined}
                    className={`p-1 text-center border border-[var(--color-border)] ${i === j ? '' : 'cursor-help'} ${ns ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'}`}
                    style={{ background: i === j ? 'transparent' : cellColor(mtx.m[i][j], lens), opacity: ns ? 0.4 : 1 }}
                    onMouseEnter={i === j ? undefined : (e) => setHover({ x: e.clientX, y: e.clientY, i, j })}
                    onMouseLeave={i === j ? undefined : () => setHover(null)}>
                    {i === j ? (isCorr ? '1.00' : '—') : fmt(mtx.m[i][j], lens)}
                  </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[9px] text-[var(--color-text-secondary)] mb-3">🟩 diversifies (low/negative) · 🟥 redundant / move together (high). <b>Dimmed</b> cells are not statistically significant (too few shared days — likely noise, don’t trust them). Hover any cell for a trade-together-or-hedge call.</div>

      {/* per-cell trade verdict */}
      {hover && (() => {
        const v = mtx.m[hover.i][hover.j];
        const vd = verdict(v, lens);
        const left = Math.min(hover.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 296);
        return createPortal(
          <div style={{ position: 'fixed', left, top: hover.y + 16, width: 280, zIndex: 9999 }}
            className="pointer-events-none rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-xl px-3 py-2">
            <div className="text-[10px] text-[var(--color-text-secondary)] truncate">{series[hover.i].label} ↔ {series[hover.j].label}</div>
            <div className="text-[11px] font-[var(--font-mono)] font-semibold mb-1" style={{ color: TONE[vd.tone] }}>{fmt(v, lens)} · {vd.tag}</div>
            <div className="text-[11px] leading-snug text-[var(--color-text-secondary)]">{vd.advice}</div>
          </div>,
          document.body,
        );
      })()}

      {/* portfolio analysis */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span className="text-[11px] font-semibold text-[var(--color-text-primary)] self-center">Equal-weight portfolio</span>
        <InfoTip id="corr-portfolio" />
        <div className={cardCls}><div className={lblCls}>Total Return</div><div className={valCls}>{mtx ? port.totalReturn.toFixed(2) + '%' : ''}</div></div>
        <div className={cardCls}><div className={lblCls}>Ann. Vol</div><div className={valCls}>{port.annVol.toFixed(1)}%</div></div>
        <div className={cardCls}><div className={lblCls}>Max Drawdown</div><div className={valCls}>{port.maxDD.toFixed(2)}%</div></div>
        <div className={cardCls}><div className={lblCls}>Sharpe</div><div className={valCls}>{port.sharpe.toFixed(2)}</div></div>
      </div>
    </div>
  );
}
