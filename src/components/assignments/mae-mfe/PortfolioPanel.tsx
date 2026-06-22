/**
 * PortfolioPanel — two halves, both settings-synced to the dashboard's daily
 * returns:
 *   1. Recommendations — runs the prop sim + correlation across every loaded
 *      move and names the fastest payout, safest, best-overall, and best
 *      diversifier, plus a suggested independent basket (one-click Apply).
 *   2. Builder — pick moves + weights → combined equity curve, blended stats,
 *      diversification benefit, and per-move contribution.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { MaeMfeDocument } from './maeMfeDocument';
import { buildSeries, computePortfolio } from '../../../lib/portfolio';
import { mulberry32, type PropRules } from '../../../lib/propSim';
import { type Alloc } from '../../../lib/recommendations';
import { grandRecommend, GRAND_APPETITES, type GrandRec, type Appetite } from '../../../lib/grandRecommend';
import { InfoTip } from './InfoTip';
import { VideoButton } from './SectionVideo';

interface MoveOpt { id: string; label: string }
export interface PortfolioPanelProps {
  doc: MaeMfeDocument;
  moves: MoveOpt[];
  onClose: () => void;
  /** Shared global Account Profile (set above the asset switcher). */
  acctRules: PropRules;
  acctContracts: number;
  acctMode: 'prop' | 'live';
  /** A basket of move keys to preload into the builder (from an Apply→Portfolio elsewhere). */
  preset?: string[] | null;
  /** Send a recommended basket to another lab (Compare/Cycle/Monte Carlo/Prop Sim). */
  onApplyBasketTo?: (keys: string[], lab: 'compare' | 'cycle' | 'montecarlo' | 'portfolio' | 'propsim', source?: string) => void;
}

const GRAND_TARGETS: { lab: 'compare' | 'cycle' | 'montecarlo' | 'propsim'; label: string }[] = [
  { lab: 'compare', label: 'Compare' }, { lab: 'cycle', label: 'Cycle' },
  { lab: 'montecarlo', label: 'Monte Carlo' }, { lab: 'propsim', label: 'Prop Sim' },
];

const cardCls = 'flex-1 min-w-[120px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[6px] px-3 py-2';
const lblCls = 'text-[9px] uppercase tracking-wide text-[var(--color-text-secondary)] flex items-center gap-1';
const valCls = 'text-[15px] font-[var(--font-mono)] text-[var(--color-text-primary)]';
const inputCls = 'w-[80px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2 py-1 text-[var(--color-text-primary)] font-[var(--font-mono)] text-[10px]';
const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;

function NumField({ label, info, value, onChange, step = 1, min = 0 }: { label: string; info?: string; value: number; onChange: (n: number) => void; step?: number; min?: number }) {
  return (
    <label className="flex flex-col gap-1 text-[10px]">
      <span className="text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-1">{label}{info && <InfoTip id={info} />}</span>
      <input type="number" min={min} step={step} value={value} onChange={(e) => onChange(Math.max(min, +e.target.value || 0))} className={inputCls} />
    </label>
  );
}

/** One appetite's full plan: basket + combined prop-sim survival + Apply. */
function GrandCard({ rec, mode, onApply, selected, onSelect, onApplyBasketTo }: { rec: GrandRec | null; title: string; info: string; mode: 'prop' | 'live'; onApply: () => void; selected: boolean; onSelect: () => void; onApplyBasketTo?: PortfolioPanelProps['onApplyBasketTo'] }) {
  if (!rec) return null;
  const seg = (w: number, bg: string) => (w > 0 ? <div key={bg} style={{ width: `${w * 100}%`, background: bg }} className="overflow-hidden text-center text-[var(--color-text-primary)]">{w >= 0.16 ? `${(w * 100).toFixed(0)}%` : ''}</div> : null);
  return (
    <button type="button" onClick={onSelect}
      className={`flex-1 min-w-[250px] text-left bg-[var(--color-bg-inset)] border rounded-[6px] px-3 py-2.5 transition-colors ${selected ? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/40' : 'border-[var(--color-accent)]/25 hover:border-[var(--color-accent)]/60'}`}>
      <div className="flex items-center justify-between">
        <div className={lblCls}>{rec.title}<InfoTip id={GRAND_APPETITES.find((a) => a.key === rec.appetite)!.info} /></div>
        <span onClick={(e) => { e.stopPropagation(); onApply(); }} className="text-[9px] px-1.5 py-0.5 rounded-[4px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 cursor-pointer">Apply</span>
      </div>
      <div className="text-[9px] text-[var(--color-text-muted)] mt-1 leading-snug">{rec.rationale}</div>
      <div className="text-[10px] text-[var(--color-text-primary)] mt-1.5 leading-snug">
        {rec.alloc.slice(0, 4).map((a) => `${a.label} ${(a.weight * 100).toFixed(0)}%`).join(' · ')}{rec.alloc.length > 4 ? ` · +${rec.alloc.length - 4}` : ''}
      </div>
      {mode === 'prop' ? (
        <div className="mt-1.5">
          <div className="flex h-[12px] w-full rounded-[3px] overflow-hidden border border-[var(--color-border)] text-[8px] leading-[12px] font-[var(--font-mono)]">
            {seg(rec.pass, 'rgba(95,174,127,0.55)')}{seg(rec.active, 'rgba(150,150,150,0.35)')}{seg(rec.bust, 'rgba(208,102,102,0.55)')}
          </div>
          <div className="text-[8px] text-[var(--color-text-secondary)] mt-1">🟩 pass {(rec.pass * 100).toFixed(0)}% · ⬜ trading {(rec.active * 100).toFixed(0)}% · 🟥 bust {(rec.bust * 100).toFixed(0)}%</div>
          <div className="text-[9px] font-[var(--font-mono)] text-[var(--color-text-secondary)] mt-0.5">{rec.medianDays != null ? `~${Math.round(rec.medianDays)}d · ` : ''}avg {usd(rec.expEnd)} · Sharpe {rec.sharpe.toFixed(2)} · DD {usd(rec.maxDD)} · div {(rec.diversification * 100).toFixed(0)}%</div>
        </div>
      ) : (
        <div className="text-[9px] font-[var(--font-mono)] text-[var(--color-text-secondary)] mt-1.5">
          <div><span className="text-[var(--color-text-primary)]">{usd(rec.expEnd)}</span> expected · Sharpe {rec.sharpe.toFixed(2)}</div>
          <div>{usd(rec.maxDD)} max DD · {(rec.bust * 100).toFixed(0)}% risk of ruin · div {(rec.diversification * 100).toFixed(0)}%</div>
        </div>
      )}
      {onApplyBasketTo && (
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          <span className="text-[8px] uppercase tracking-wide text-[var(--color-text-muted)]">Send→</span>
          {GRAND_TARGETS.map((t) => (
            <span key={t.lab} onClick={(e) => { e.stopPropagation(); onApplyBasketTo(rec.alloc.map((a) => a.key), t.lab, `Grand · ${rec.title}`); }}
              className="text-[8px] px-1 py-0.5 rounded-[4px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/60 cursor-pointer">{t.label}</span>
          ))}
        </div>
      )}
    </button>
  );
}

export function PortfolioPanel({ doc, moves, onClose, acctRules, acctContracts, acctMode, preset, onApplyBasketTo }: PortfolioPanelProps) {
  const moveLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mv of moves) m[mv.id] = mv.label;
    return (id: string) => m[id] ?? id;
  }, [moves]);

  const series = useMemo(() => buildSeries(doc, moveLabel), [doc, moveLabel]);

  // builder state: per-key include + weight
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const isIn = (k: string) => included[k] ?? true;
  const wOf = (k: string) => weights[k] ?? 1;

  // Recommendations use the GLOBAL account profile (set above the asset switcher)
  // and value EACH move at its own Step-2 / default-safest size (not one global size).
  const rules = acctRules;
  // Grand recommendation — the full plan per appetite (basket + combined survival).
  const grand = useMemo(() => grandRecommend(doc, rules, moveLabel, { sims: 1200, rng: mulberry32(1) }), [doc, rules, moveLabel]);
  // Which appetite's $ equity curve is charted (with the Max-DD bust line + Day-14 marker).
  const [grandSel, setGrandSel] = useState<Appetite>('bestOverall');
  const grandShown = grand[grandSel] ?? grand.bestOverall ?? grand.safest ?? grand.fastest ?? grand.professional;

  const chosen = series.filter((s) => isIn(s.key));
  const port = useMemo(() => computePortfolio(chosen, chosen.map((s) => wOf(s.key))), [chosen, weights]);

  const applyAlloc = (alloc: Alloc[]) => {
    const inc: Record<string, boolean> = {};
    const w: Record<string, number> = {};
    for (const s of series) { inc[s.key] = false; w[s.key] = 0; }
    for (const a of alloc) { inc[a.key] = true; w[a.key] = a.weight * 100; }
    setIncluded(inc); setWeights(w);
  };
  // A basket applied from another lab (Apply→Portfolio) preloads the builder equal-weight.
  useEffect(() => {
    if (!preset || preset.length === 0) return;
    const inc: Record<string, boolean> = {}; const w: Record<string, number> = {};
    for (const s of series) { inc[s.key] = false; w[s.key] = 0; }
    for (const k of preset) { inc[k] = true; w[k] = 100; }
    setIncluded(inc); setWeights(w);
  }, [preset, series]);

  if (series.length === 0) {
    return (
      <div className="mt-3 p-4 border border-[var(--color-border)] rounded-[6px] bg-[var(--color-bg-inset)]/40 text-[11px] text-[var(--color-text-secondary)]">
        Portfolio needs at least one populated move. Load data, then reopen.
        <button onClick={onClose} className="ml-3 text-[var(--color-accent)]">close</button>
      </div>
    );
  }

  return (
    <div className="mt-3 p-4 border border-[var(--color-border)] rounded-[6px] bg-[var(--color-bg-inset)]/40">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">Portfolio &amp; Recommendations</span>
          <InfoTip id="pf-feature" />
        </div>
        <button onClick={onClose} className="text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">close ✕</button>
      </div>

      {/* ── Grand recommendation — the full plan per appetite ───────────── */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[11px] font-semibold text-[var(--color-accent)]">🏆 Grand Recommendation</span>
        <InfoTip id="pf-grand" />
        <VideoButton slug="portfolio-grand" />
      </div>
      <div className="text-[9px] text-[var(--color-text-secondary)] mb-1">Your whole plan per appetite: the correlation-aware basket (each move at its own manual / safest risk) run through the prop-sim together — pass/bust, Sharpe, drawdown, diversification. Click a card to chart it; Apply loads it into the builder.</div>
      <div className="text-[9px] text-[var(--color-text-muted)] mb-2">{acctMode === 'prop' ? 'Prop eval' : 'Live capital'} · each move at its own size · ${acctRules.accountSize.toLocaleString()} acct · target ${acctRules.profitTarget.toLocaleString()} · DD ${acctRules.maxDrawdown.toLocaleString()} ({acctRules.ddMode}) — change these in the Account Profile above the asset switcher.</div>
      <div className="flex flex-wrap gap-2 mb-3">
        {GRAND_APPETITES.map(({ key, title, info }) => (
          <GrandCard key={key} rec={grand[key]} title={title} info={info} mode={acctMode} selected={grandSel === key} onSelect={() => setGrandSel(key)} onApply={() => grand[key] && applyAlloc(grand[key]!.alloc)} onApplyBasketTo={onApplyBasketTo} />
        ))}
      </div>

      {/* $ equity of the selected plan: a 14-day risk-of-ruin zoom + the full run.
          Both trim the flat lead-in (dates before every move has data). */}
      {grandShown && (() => {
        const activeDays = grandShown.dollars.length - grandShown.activeFrom;
        return (
          <div className="mb-4 p-3 rounded-[6px] border border-[var(--color-border)] bg-[var(--color-bg-inset)]/30">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] uppercase tracking-wide text-[var(--color-accent)]">{grandShown.title} · combined $ equity</span>
              <InfoTip id="pf-grandchart" />
              <span className="text-[9px] text-[var(--color-text-muted)] ml-auto">{activeDays} active trading days · {acctRules.maxDrawdown ? `bust at −$${acctRules.maxDrawdown.toLocaleString()} (${acctRules.ddMode})` : 'no DD limit'}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {/* 14-day zoom — the danger window */}
              {activeDays > 2 && (
                <div className="flex-1 min-w-[300px]">
                  <div className="text-[9px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-0.5">⚠ First 14 days — risk-of-ruin window</div>
                  <GrandDollarChart dollars={grandShown.dollars} rules={acctRules} activeFrom={grandShown.activeFrom} zoomDays={14} />
                </div>
              )}
              {/* full run — zoomed out */}
              <div className="flex-1 min-w-[300px]">
                <div className="text-[9px] uppercase tracking-wide text-[var(--color-text-secondary)] mb-0.5">Full run — all {activeDays} days</div>
                <GrandDollarChart dollars={grandShown.dollars} rules={acctRules} activeFrom={grandShown.activeFrom} />
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Builder ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[11px] font-semibold text-[var(--color-text-primary)]">Build &amp; weight</span>
        <InfoTip id="pf-builder" />
        <button
          type="button"
          onClick={() => { const inc: Record<string, boolean> = {}; for (const s of series) inc[s.key] = false; setIncluded(inc); setWeights({}); }}
          className="ml-auto text-[10px] px-2.5 py-1 rounded-[5px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/60 transition-colors"
          title="Uncheck every move and zero all weights">
          Clear all
        </button>
      </div>

      <div className="flex flex-wrap gap-4">
        {/* selector */}
        <div className="min-w-[280px] flex-1">
          <div className="grid grid-cols-[16px_1fr_64px] gap-x-2 gap-y-1 items-center text-[10px]">
            <div></div><div className="text-[var(--color-text-secondary)] uppercase tracking-wide">Move</div><div className="text-[var(--color-text-secondary)] uppercase tracking-wide text-right">Weight</div>
            {series.map((s) => {
              const w = port.perMove.find((p) => p.key === s.key);
              return (
                <Fragment key={s.key}>
                  <input type="checkbox" checked={isIn(s.key)} onChange={(e) => setIncluded((m) => ({ ...m, [s.key]: e.target.checked }))} />
                  <span className={`truncate ${isIn(s.key) ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`} title={s.label}>{s.label}{w && isIn(s.key) ? <span className="text-[var(--color-text-secondary)]"> · {(w.weight * 100).toFixed(0)}%</span> : null}</span>
                  <input type="number" min={0} step={1} value={wOf(s.key)} disabled={!isIn(s.key)} onChange={(e) => setWeights((m) => ({ ...m, [s.key]: Math.max(0, +e.target.value || 0) }))} className={`${inputCls} w-[60px] text-right disabled:opacity-40`} />
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* equity + stats */}
        <div className="min-w-[320px] flex-[2]">
          <EquityChart equity={port.equity} />
          <div className="flex flex-wrap gap-2 mt-2">
            <div className={cardCls}><div className={lblCls}>Total Return<InfoTip id="pf-total" /></div><div className={valCls}>{pct(port.metrics.total)}</div></div>
            <div className={cardCls}><div className={lblCls}>Max Drawdown<InfoTip id="pf-maxdd" /></div><div className={valCls}>{pct(port.metrics.maxDD)}</div></div>
            <div className={cardCls}><div className={lblCls}>Sharpe<InfoTip id="pf-sharpe" /></div><div className={valCls}>{port.metrics.sharpe.toFixed(2)}</div></div>
            <div className={cardCls}><div className={lblCls}>Win Days<InfoTip id="pf-winrate" /></div><div className={valCls}>{(port.metrics.winRateDays * 100).toFixed(0)}%</div></div>
            <div className={cardCls}><div className={lblCls}>Diversification<InfoTip id="pf-diversification" /></div><div className={valCls} style={{ color: port.diversification > 0.2 ? '#5fae7f' : 'var(--color-text-primary)' }}>{(port.diversification * 100).toFixed(0)}%</div></div>
          </div>
        </div>
      </div>

      <div className="text-[9px] text-[var(--color-text-secondary)] mt-2">
        {chosen.length} move{chosen.length === 1 ? '' : 's'} · {port.metrics.days} trading days · diversification = how much of the weighted-average volatility ({port.weightedVolSum.toFixed(1)}% ann.) the blend removed. All settings-synced to your Min Cashflow / Max MAE.
      </div>
    </div>
  );
}

/**
 * $-equity of the chosen plan with the prop bust line + Day-14 marker.
 * equity = cumulative $; the bust line is the trailing (peak − MaxDD) or static
 * (−MaxDD) floor — touching it = busting the account. Vertical marker at day 14.
 */
function GrandDollarChart({ dollars, rules, activeFrom = 0, zoomDays }: { dollars: number[]; rules: PropRules; activeFrom?: number; zoomDays?: number }) {
  const W = 720, H = 190, padL = 58, padR = 14, padT = 14, padB = 28;
  // Trim the flat lead-in (dates before every move has data), then optionally zoom to N days.
  const active = dollars.slice(activeFrom);
  const shown = zoomDays != null ? active.slice(0, zoomDays) : active;
  if (shown.length < 2) return <div className="text-[10px] text-[var(--color-text-secondary)] h-[120px] flex items-center">Not enough days to chart.</div>;
  // Cumulative equity + the trailing/static bust floor per day.
  const equity: number[] = []; const floor: number[] = [];
  let eq = 0, peak = 0;
  const dd = rules.maxDrawdown > 0 ? rules.maxDrawdown : 0;
  for (const d of shown) {
    eq += d; if (eq > peak) peak = eq;
    equity.push(eq);
    floor.push(dd ? (rules.ddMode === 'trailing' ? peak - dd : -dd) : NaN);
  }
  const vals = [0, ...equity, ...(dd ? floor.filter((f) => Number.isFinite(f)) : [])];
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const n = equity.length;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);
  const eqPath = equity.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const floorPath = dd ? floor.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ') : '';
  const up = equity[n - 1] >= 0;
  const col = up ? '#5fae7f' : '#d06666';
  const usdT = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;
  const day14 = (zoomDays == null && n > 14) ? x(13) : null; // marker only on the full view
  const yTicks = Array.from({ length: 5 }, (_, k) => lo + (span * k) / 4);          // 5 horizontal lines
  const xCount = Math.min(zoomDays != null ? 5 : 5, n);
  const xTicks = Array.from(new Set(Array.from({ length: xCount }, (_, k) => Math.round((k / (xCount - 1)) * (n - 1))))); // even day ticks
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={`y${i}`}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={0.5} opacity={0.4} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={8.5} fill="var(--color-text-secondary)" fontFamily="var(--font-mono)">{usdT(t)}</text>
        </g>
      ))}
      {/* vertical day gridlines + labels */}
      {xTicks.map((i, k) => (
        <g key={`x${k}`}>
          <line x1={x(i)} x2={x(i)} y1={padT} y2={H - padB} stroke="var(--color-border)" strokeWidth={0.5} opacity={0.22} />
          <text x={x(i)} y={H - 9} textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'} fontSize={8} fill="var(--color-text-muted)" fontFamily="var(--font-mono)">day {i + 1}</text>
        </g>
      ))}
      {/* zero baseline */}
      <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="var(--color-text-secondary)" strokeWidth={0.8} opacity={0.5} />
      {/* bust floor (fed by Account Profile Max DD) */}
      {dd > 0 && <path d={floorPath} fill="none" stroke="#d06666" strokeWidth={1.2} strokeDasharray="4 3" opacity={0.85} />}
      {/* Day-14 risk-of-ruin marker (full view only) */}
      {day14 !== null && (
        <g>
          <line x1={day14} x2={day14} y1={padT} y2={H - padB} stroke="var(--color-accent)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
          <text x={day14 + 3} y={padT + 8} fontSize={8} fill="var(--color-accent)" fontFamily="var(--font-mono)">Day 14</text>
        </g>
      )}
      <path d={`${eqPath} L${x(n - 1).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`} fill={col} opacity={0.12} />
      <path d={eqPath} fill="none" stroke={col} strokeWidth={1.6} />
      {dd > 0 && <text x={W - padR} y={y(floor[n - 1]) - 3} textAnchor="end" fontSize={8} fill="#d06666" fontFamily="var(--font-mono)">bust line</text>}
    </svg>
  );
}

/** Cumulative % equity line with a zero baseline + defined x/y axes. */
function EquityChart({ equity }: { equity: number[] }) {
  const W = 640, H = 156, padL = 46, padR = 10, padT = 10, padB = 24;
  if (equity.length < 2) return <div className="text-[10px] text-[var(--color-text-secondary)] h-[150px] flex items-center">Select at least one move with 2+ days to chart.</div>;
  const lo = Math.min(0, ...equity), hi = Math.max(0, ...equity);
  const span = hi - lo || 1;
  const nn = equity.length;
  const x = (i: number) => padL + (i / (nn - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);
  const path = equity.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(nn - 1).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const up = equity[nn - 1] >= 0;
  const col = up ? '#5fae7f' : '#d06666';
  const yTicks = Array.from({ length: 5 }, (_, k) => lo + (span * k) / 4);
  const xCount = Math.min(5, nn);
  const xTicks = Array.from(new Set(Array.from({ length: xCount }, (_, k) => Math.round((k / (xCount - 1)) * (nn - 1)))));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
      {yTicks.map((t, i) => (
        <g key={`y${i}`}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={0.5} opacity={0.4} />
          <text x={padL - 5} y={y(t) + 3} textAnchor="end" fontSize={8.5} fill="var(--color-text-secondary)" fontFamily="var(--font-mono)">{t >= 0 ? '+' : ''}{t.toFixed(1)}%</text>
        </g>
      ))}
      {xTicks.map((i, k) => (
        <g key={`x${k}`}>
          <line x1={x(i)} x2={x(i)} y1={padT} y2={H - padB} stroke="var(--color-border)" strokeWidth={0.5} opacity={0.22} />
          <text x={x(i)} y={H - 8} textAnchor={k === 0 ? 'start' : k === xTicks.length - 1 ? 'end' : 'middle'} fontSize={8} fill="var(--color-text-muted)" fontFamily="var(--font-mono)">day {i + 1}</text>
        </g>
      ))}
      <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke="var(--color-text-secondary)" strokeWidth={0.8} opacity={0.6} />
      <path d={area} fill={col} opacity={0.14} />
      <path d={path} fill="none" stroke={col} strokeWidth={1.6} />
    </svg>
  );
}
