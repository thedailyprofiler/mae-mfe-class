/**
 * MonteCarloPanel — resample a single move thousands of times to show the
 * realistic spread of outcomes (not one lucky backtest). Bootstrap = "resample
 * the edge"; Shuffle = "same trades, different order." % terms, settings-synced.
 */
import { useMemo, useState } from 'react';
import type { MaeMfeDocument } from './maeMfeDocument';
import { buildTradeSeries, runMonteCarlo, mulberry32, type McMode } from '../../../lib/monteCarlo';
import { combinedStats, deriveSource, sequenceTrades } from '../../../lib/maeMfeCombine';
import { buildLabSources } from './labSources';
import { InfoTip } from './InfoTip';
import { VideoButton } from './SectionVideo';

interface MoveOpt { id: string; label: string }
export interface MonteCarloPanelProps {
  doc: MaeMfeDocument;
  moves: MoveOpt[];
  onClose: () => void;
  /** Keys of the Combine basket (Set A) — offered as a $-based MC option if non-empty. */
  combineKeys?: string[];
  /** Keys of the Cycle stream — offered as a $-based MC option if non-empty. */
  cycleKeys?: string[];
}

type Unit = '%' | '$';
interface McSeries { key: string; label: string; returns: number[]; unit: Unit }

const cardCls = 'flex-1 min-w-[120px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[6px] px-3 py-2';
const lblCls = 'text-[9px] uppercase tracking-wide text-[var(--color-text-secondary)] flex items-center gap-1';
const valCls = 'text-[15px] font-[var(--font-mono)] text-[var(--color-text-primary)]';

export function MonteCarloPanel({ doc, moves, onClose, combineKeys, cycleKeys }: MonteCarloPanelProps) {
  const moveLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mv of moves) m[mv.id] = mv.label;
    return (id: string) => m[id] ?? id;
  }, [moves]);

  // Selectable series: the Combine basket + Cycle stream (in $, multi-asset) at
  // the TOP for easy selection, then every individual move (in %).
  const series = useMemo<McSeries[]>(() => {
    const extra: McSeries[] = [];
    if (combineKeys && combineKeys.length) {
      const { days } = combinedStats(buildLabSources(doc, new Set(combineKeys), 1, { kind: 'all' }));
      const r = days.map((d) => d.pnl);
      if (r.length) extra.push({ key: '__combine', label: `▣ Combined basket (${combineKeys.length} moves)`, returns: r, unit: '$' });
    }
    if (cycleKeys && cycleKeys.length) {
      const streams = buildLabSources(doc, new Set(cycleKeys), 1, { kind: 'all' }).map(deriveSource);
      const r = sequenceTrades(streams).map((t) => t.pnl);
      if (r.length) extra.push({ key: '__cycle', label: `↻ Cycle stream (${cycleKeys.length} moves)`, returns: r, unit: '$' });
    }
    const base = buildTradeSeries(doc, moveLabel).map((s) => ({ ...s, unit: '%' as Unit }));
    return [...extra, ...base];
  }, [doc, moveLabel, combineKeys, cycleKeys]);

  const [selKey, setSelKey] = useState<string | null>(null);
  const [mode, setMode] = useState<McMode>('bootstrap');
  const [sims, setSims] = useState(2000);
  const [horizon, setHorizon] = useState<number | null>(null); // bootstrap trade count; null = deck size
  const [ddLimit, setDdLimit] = useState(0);
  const [seed, setSeed] = useState(1);

  const active = series.find((s) => s.key === selKey) ?? series[0];
  const unit = active?.unit ?? '%';
  const fmtV = (v: number) => unit === '$' ? `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}` : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const deckSize = active?.returns.length ?? 0;

  const res = useMemo(() => {
    if (!active) return null;
    return runMonteCarlo(active.returns, {
      mode,
      sims: Math.min(Math.max(sims, 50), 10000),
      tradesPerSim: horizon ?? deckSize,
      ddLimit,
      rng: mulberry32(seed),
    });
  }, [active, mode, sims, horizon, deckSize, ddLimit, seed]);

  if (series.length === 0) {
    return (
      <div className="mt-3 p-4 border border-[var(--color-border)] rounded-[6px] bg-[var(--color-bg-inset)]/40 text-[11px] text-[var(--color-text-secondary)]">
        Monte Carlo needs at least one populated move. Load data, then reopen.
        <button onClick={onClose} className="ml-3 text-[var(--color-accent)]">close</button>
      </div>
    );
  }

  return (
    <div className="mt-3 p-4 border border-[var(--color-border)] rounded-[6px] bg-[var(--color-bg-inset)]/40">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">Monte Carlo</span>
          <InfoTip id="mc-feature" />
          <VideoButton slug="monte-carlo" />
        </div>
        <button onClick={onClose} className="text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">close ✕</button>
      </div>

      {/* controls */}
      <div className="flex flex-wrap items-end gap-3 mb-3 text-[10px]">
        <label className="flex flex-col gap-1">
          <span className="text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-1">Source<InfoTip id="mc-source" /></span>
          <select value={active?.key ?? ''} onChange={(e) => setSelKey(e.target.value)}
            className="bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2 py-1 text-[var(--color-text-primary)] max-w-[280px]">
            {!(combineKeys && combineKeys.length) && <option value="" disabled>▣ Combined basket — pick / Apply a basket in Compare</option>}
            {!(cycleKeys && cycleKeys.length) && <option value="" disabled>↻ Cycle stream — pick / Apply a setup in Cycle</option>}
            {series.map((s) => <option key={s.key} value={s.key}>{s.label} ({s.returns.length})</option>)}
          </select>
          <span className="text-[8px] text-[var(--color-text-muted)] max-w-[280px] leading-snug">A Combine basket (Set A) or Cycle setup you build — or a recommendation you Apply there — appears at the top here.</span>
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-1">Mode<InfoTip id="mc-mode" /></span>
          <div className="flex gap-1">
            {([['bootstrap', 'Resample'], ['shuffle', 'Shuffle']] as const).map(([m, lab]) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                className={`px-2 py-1 rounded-[4px] border ${mode === m ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-text-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}>{lab}</button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[var(--color-text-secondary)] uppercase tracking-wide">Simulations</span>
          <input type="number" min={50} max={10000} step={500} value={sims} onChange={(e) => setSims(+e.target.value || 2000)}
            className="w-[80px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2 py-1 text-[var(--color-text-primary)] font-[var(--font-mono)]" />
        </label>

        <label className="flex flex-col gap-1" title={mode === 'shuffle' ? 'Shuffle always uses the full deck' : 'How many trades ahead to simulate'}>
          <span className="text-[var(--color-text-secondary)] uppercase tracking-wide">Trades ahead</span>
          <input type="number" min={1} max={5000} value={horizon ?? deckSize} disabled={mode === 'shuffle'}
            onChange={(e) => setHorizon(+e.target.value || deckSize)}
            className="w-[80px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2 py-1 text-[var(--color-text-primary)] font-[var(--font-mono)] disabled:opacity-40" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-1">DD limit %<InfoTip id="mc-ddlimit" /></span>
          <input type="number" min={0} step={0.1} value={ddLimit} onChange={(e) => setDdLimit(Math.max(0, +e.target.value))}
            className="w-[70px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2 py-1 text-[var(--color-text-primary)] font-[var(--font-mono)]" />
        </label>

        <button onClick={() => setSeed((s) => s + 1)} title="Re-roll the random draws"
          className="px-2 py-1 rounded-[4px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">🎲 Re-roll</button>
      </div>

      {res && (
        <>
          {/* stat cards */}
          <div className="flex flex-wrap gap-2 mb-3">
            <div className={cardCls}><div className={lblCls}>Prob. of Profit<InfoTip id="mc-prob-profit" /></div><div className={valCls}>{(res.probProfit * 100).toFixed(0)}%</div></div>
            <div className={cardCls}><div className={lblCls}>Median Outcome<InfoTip id="mc-median" /></div><div className={valCls}>{fmtV(res.finalP50)}</div></div>
            <div className={cardCls}><div className={lblCls}>Range P5…P95<InfoTip id="mc-range" /></div><div className={valCls} style={{ fontSize: 12 }}>{fmtV(res.finalP5)} … {fmtV(res.finalP95)}</div></div>
            <div className={cardCls}><div className={lblCls}>Median Max DD<InfoTip id="mc-maxdd" /></div><div className={valCls}>{fmtV(res.maxDDMedian)}</div></div>
            <div className={cardCls}><div className={lblCls}>Worst-5% DD<InfoTip id="mc-worstdd" /></div><div className={valCls} style={{ color: '#d06666' }}>{fmtV(res.maxDDWorst5)}</div></div>
            <div className={cardCls}><div className={lblCls}>Worst Loss Streak<InfoTip id="mc-lossstreak" /></div><div className={valCls} style={{ color: res.lossStreakP95 >= 8 ? '#d06666' : undefined }}>{res.lossStreakP95}<span className="text-[10px] text-[var(--color-text-secondary)]"> in a row</span></div></div>
            {ddLimit > 0 && <div className={cardCls}><div className={lblCls}>P(hit −{ddLimit}%)<InfoTip id="mc-hitlimit" /></div><div className={valCls} style={{ color: res.probHitDDLimit > 0.2 ? '#d06666' : 'var(--color-text-primary)' }}>{(res.probHitDDLimit * 100).toFixed(0)}%</div></div>}
          </div>

          <FanChart res={res} unit={unit} />

          <div className="text-[9px] text-[var(--color-text-secondary)] mt-1">
            {mode === 'bootstrap'
              ? `Resampled ${res.sims.toLocaleString()}× from ${deckSize} real ${unit === '$' ? 'days/trades' : 'trades'}, ${res.tradesPerSim} ahead.`
              : `Reshuffled the same ${deckSize} ${unit === '$' ? 'days/trades' : 'trades'} ${res.sims.toLocaleString()}× — the band shows ordering luck (all paths end at ${fmtV(res.base.final)}).`} Bands: P5 / median / P95 cumulative {unit === '$' ? 'dollars' : '%'}. Dashed = your actual sequence.{unit === '$' ? ' Combined / Cycle stream is in $ across assets.' : ''}
          </div>
        </>
      )}
    </div>
  );
}

/** Inline SVG fan: shaded P5–P95 band, median line, and the actual path dashed. */
function FanChart({ res, unit }: { res: ReturnType<typeof runMonteCarlo>; unit: Unit }) {
  const tickLabel = (t: number) => unit === '$' ? `${t < 0 ? '−' : ''}$${Math.abs(Math.round(t))}` : `${t >= 0 ? '+' : ''}${t.toFixed(1)}%`;
  const W = 720, H = 200, padL = 44, padR = 10, padT = 10, padB = 22;
  const n = res.bands.length;
  if (n === 0) return null;
  const lo = Math.min(0, ...res.bands.map((b) => b.p5));
  const hi = Math.max(0, ...res.bands.map((b) => b.p95));
  const span = hi - lo || 1;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);

  const line = (key: 'p5' | 'p50' | 'p95') => res.bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(b[key]).toFixed(1)}`).join(' ');
  const band = `${res.bands.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(b.p95).toFixed(1)}`).join(' ')} ` +
    `${[...res.bands].reverse().map((b, i) => `L${x(n - 1 - i).toFixed(1)} ${y(b.p5).toFixed(1)}`).join(' ')} Z`;
  const zeroY = y(0);
  const ticks = [hi, (hi + lo) / 2, lo];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={0.5} opacity={0.5} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="var(--color-text-secondary)" fontFamily="var(--font-mono)">{tickLabel(t)}</text>
        </g>
      ))}
      <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="var(--color-text-secondary)" strokeWidth={0.8} opacity={0.7} />
      <path d={band} fill="var(--color-accent)" opacity={0.16} />
      <path d={line('p95')} fill="none" stroke="var(--color-accent)" strokeWidth={1} opacity={0.5} />
      <path d={line('p5')} fill="none" stroke="var(--color-accent)" strokeWidth={1} opacity={0.5} />
      <path d={line('p50')} fill="none" stroke="var(--color-accent)" strokeWidth={1.8} />
      <text x={W - padR} y={y(res.bands[n - 1].p95) - 3} textAnchor="end" fontSize={9} fill="var(--color-accent)" opacity={0.8}>P95</text>
      <text x={W - padR} y={y(res.bands[n - 1].p5) + 10} textAnchor="end" fontSize={9} fill="var(--color-accent)" opacity={0.8}>P5</text>
    </svg>
  );
}
