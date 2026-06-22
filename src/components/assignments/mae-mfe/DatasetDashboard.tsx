/**
 * DatasetDashboard — terminal-ledger analytics for one MAE/MFE dataset.
 *
 * Exported as two band components so DatasetCard can compose a layout with
 * no height-coupling voids:
 *
 *   <DashboardCore>  — distribution stats (3-col) + MFE strike-rate bars.
 *                      Pairs beside the trade log; both land ≈400px tall.
 *   <DashboardBand>  — full-width strip: MAE risk ladder | contract $/move |
 *                      EV heatmap. All three are 6-row tables, so the band
 *                      is a single aligned horizontal block.
 */
import { useMemo, useState } from 'react';
import type { DatasetDashboard as DashType, DerivedRow } from '../../../lib/maeMfeStats';
import { regimeBreakdown, REGIME_META, MIN_TRUST, type RegimeAxis } from '../../../lib/regimeAnalysis';
import { dollarTone, fmtDollars, fmtPct, fmtRatio } from './format';
import { InfoTip } from './InfoTip';
import { VideoButton, type DeepDiveSlug } from './SectionVideo';

/** Mono uppercase section label with a gold tick. Optional ⓘ help + ▶ how-to video. */
export function SectionLabel({ children, info, video }: { children: React.ReactNode; info?: string; video?: DeepDiveSlug }) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="w-[3px] h-[11px] bg-[var(--color-accent)]" aria-hidden />
      <span className="text-[10px] font-[var(--font-mono)] font-medium uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
        {children}
      </span>
      {info && <InfoTip id={info} />}
      {video && <VideoButton slug={video} />}
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] text-[12px] leading-tight">
      <span className="text-[var(--color-text-muted)] whitespace-nowrap">{label}</span>
      <span
        className={`font-[var(--font-mono)] tabular-nums whitespace-nowrap ${tone ?? 'text-[var(--color-text-primary)]'}`}
      >
        {value}
      </span>
    </div>
  );
}

/** Heatmap background for EV cells — green for +, red for −, scaled by magnitude. */
function evCellStyle(v: number | null, maxAbs: number): React.CSSProperties {
  if (v === null || maxAbs === 0) return {};
  const t = Math.min(1, Math.abs(v) / maxAbs);
  const alpha = 0.07 + t * 0.33;
  return {
    backgroundColor:
      v >= 0 ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`,
  };
}

const TH =
  'text-[9px] font-[var(--font-mono)] font-medium uppercase tracking-[0.14em] text-[var(--color-text-muted)] pb-1.5';

// =============================================================================
// Band A right side — stats + strike-rate bars
// =============================================================================

export function DashboardCore({ dashboard: d }: { dashboard: DashType }) {
  if (d.totalSamples === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[180px]">
        <p className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)] uppercase tracking-wider">
          Log a trade to activate analytics
        </p>
      </div>
    );
  }

  const maxStrike = Math.max(0.0001, ...d.mfeStrikeRates.map((r) => r.strikeRate ?? 0));

  return (
    <div className="space-y-4">
      {/* Distribution stats — 3 columns */}
      <div className="grid grid-cols-3 divide-x divide-[var(--color-border)]">
        <div className="pr-4">
          <SectionLabel info="riskMae" video="stop-target-entry">Risk · MAE</SectionLabel>
          <MiniStat label="Average" value={fmtPct(d.risk.average)} />
          <MiniStat label="Median" value={fmtPct(d.risk.median)} />
          <MiniStat label="70th %ile" value={fmtPct(d.risk.percentile70)} />
          <MiniStat
            label="Key MAE"
            value={fmtPct(d.maeAnalysis.key)}
            tone="text-[var(--color-accent)]"
          />
        </div>
        <div className="px-4">
          <SectionLabel info="profitMfe">Profit · MFE</SectionLabel>
          <MiniStat label="Average" value={fmtPct(d.profit.average)} />
          <MiniStat label="Median" value={fmtPct(d.profit.median)} />
          <MiniStat label="30th %ile" value={fmtPct(d.profit.percentile30)} />
          <MiniStat
            label="Key MFE"
            value={fmtPct(d.mfeAnalysis.key)}
            tone="text-[var(--color-accent)]"
          />
        </div>
        <div className="pl-4">
          <SectionLabel info="cashflowEv">Cashflow EVs</SectionLabel>
          <MiniStat
            label="High Prob"
            value={fmtDollars(d.cashflowEv.highProb)}
            tone={dollarTone(d.cashflowEv.highProb)}
          />
          <MiniStat
            label="Medium Prob"
            value={fmtDollars(d.cashflowEv.mediumProb)}
            tone={dollarTone(d.cashflowEv.mediumProb)}
          />
          <MiniStat
            label="High EV"
            value={fmtDollars(d.cashflowEv.highEv)}
            tone={dollarTone(d.cashflowEv.highEv)}
          />
          <MiniStat label="Mode MFE" value={fmtPct(d.mfeAnalysis.mode)} />
        </div>
      </div>

      {/* Strike rates with bars */}
      <div className="border-t border-[var(--color-border)] pt-3.5">
        <SectionLabel info="mfeStrikeRates" video="strike-rates">MFE Strike Rates</SectionLabel>
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr>
              <th className={`${TH} text-left w-14`}>Target</th>
              <th className={`${TH} text-left`}>Strike Rate</th>
              <th className={`${TH} text-right w-12`}>Hits</th>
              <th className={`${TH} text-right w-14`}>Loss</th>
              <th className={`${TH} text-right w-18`}>Win $</th>
              <th className={`${TH} text-right w-22`}>Potential</th>
            </tr>
          </thead>
          <tbody>
            {d.mfeStrikeRates.map((r, i) => ({ r, i })).filter((x) => x.r.count > 0).map(({ r, i }) => {
              const pct = (r.strikeRate ?? 0) * 100;
              const barW = ((r.strikeRate ?? 0) / maxStrike) * 100;
              return (
                <tr key={r.thresholdPct}>
                  <td className="py-[4px] pr-2 font-[var(--font-mono)] text-[var(--color-text-secondary)]">
                    {fmtPct(r.thresholdPct)}
                  </td>
                  <td className="py-[4px] pr-3">
                    <div className="relative h-[14px] bg-[var(--color-bg-secondary)] rounded-[2px] overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 rounded-[2px]"
                        style={{
                          width: `${barW}%`,
                          background:
                            'linear-gradient(90deg, rgba(34,197,94,0.35), rgba(34,197,94,0.75))',
                        }}
                      />
                      <span className="absolute inset-y-0 left-1.5 flex items-center text-[10px] font-[var(--font-mono)] font-semibold text-white/90">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-[4px] text-right font-[var(--font-mono)] text-[var(--color-text-secondary)]">
                    {r.count}
                  </td>
                  <td className="py-[4px] text-right font-[var(--font-mono)] text-[var(--color-error)]">
                    {fmtRatio(r.lossRate, 0)}
                  </td>
                  <td className="py-[4px] text-right font-[var(--font-mono)] text-[var(--color-success)]">
                    {fmtDollars(r.winCashflow)}
                  </td>
                  <td className="py-[4px] text-right font-[var(--font-mono)] text-[var(--color-text-primary)]">
                    {fmtDollars(d.potentialPnl[i])}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* By Day of Week — how this move + its win/stop rule plays out per weekday */}
      {d.dayOfWeek.length > 0 && (() => {
        const bestWin = Math.max(...d.dayOfWeek.map((w) => w.winRate));
        return (
          <div className="border-t border-[var(--color-border)] pt-3.5">
            <SectionLabel info="dayOfWeek">By Day of Week</SectionLabel>
            <table className="w-full text-[12px] tabular-nums">
              <thead>
                <tr>
                  <th className={`${TH} text-left w-12`}>Day</th>
                  <th className={`${TH} text-right w-9`}>N</th>
                  <th className={`${TH} text-left`}>Win Rate</th>
                  <th className={`${TH} text-right w-16`}>Avg</th>
                  <th className={`${TH} text-right w-20`}>Total $</th>
                </tr>
              </thead>
              <tbody>
                {d.dayOfWeek.map((w) => {
                  const best = w.winRate === bestWin && d.dayOfWeek.length > 1;
                  return (
                    <tr key={w.dow}>
                      <td className={`py-[4px] pr-2 font-[var(--font-mono)] uppercase ${best ? 'text-[var(--color-accent)] font-semibold' : 'text-[var(--color-text-secondary)]'}`}>{w.label}{best ? ' ◄' : ''}</td>
                      <td className="py-[4px] text-right font-[var(--font-mono)] text-[var(--color-text-muted)]">{w.n}</td>
                      <td className="py-[4px] pr-3">
                        <div className="relative h-[14px] bg-[var(--color-bg-secondary)] rounded-[2px] overflow-hidden">
                          <div className="absolute inset-y-0 left-0 rounded-[2px]" style={{ width: `${w.winRate * 100}%`, background: w.winRate >= 0.5 ? 'linear-gradient(90deg, rgba(34,197,94,0.35), rgba(34,197,94,0.75))' : 'linear-gradient(90deg, rgba(239,68,68,0.3), rgba(239,68,68,0.65))' }} />
                          <span className="absolute inset-y-0 left-1.5 flex items-center text-[10px] font-[var(--font-mono)] font-semibold text-white/90">{(w.winRate * 100).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td className="py-[4px] text-right font-[var(--font-mono)]" style={{ color: w.avgPct >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>{w.avgPct >= 0 ? '+' : ''}{w.avgPct.toFixed(2)}%</td>
                      <td className={`py-[4px] text-right font-[var(--font-mono)] ${w.totalPnl === null ? 'text-[var(--color-text-muted)]' : dollarTone(w.totalPnl)}`}>{w.totalPnl === null ? '—' : fmtDollars(w.totalPnl)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}
    </div>
  );
}

// =============================================================================
// Band B — full-width strip: ladder | contract | EV heatmap (all 6 rows)
// =============================================================================

export function DashboardBand({ dashboard: d }: { dashboard: DashType }) {
  if (d.totalSamples === 0) return null;

  const maxAbsEv = Math.max(
    1,
    ...d.evMatrix.values.flat().filter((v): v is number => v !== null).map(Math.abs),
  );

  // Hide EV-matrix rows/cols with no data: an MFE target nothing reached, or a
  // Max-MAE stop nothing exceeded (all-$0). Show them only when data is present.
  const mfeHasData = (t: number) => (d.mfeStrikeRates.find((r) => Math.abs(r.thresholdPct - t) < 1e-9)?.count ?? 0) > 0;
  const maeHasData = (t: number) => (d.maeLossRates.find((r) => Math.abs(r.thresholdPct - t) < 1e-9)?.count ?? 0) > 0;
  const evMfeRows = d.evMatrix.mfeThresholds.map((t, i) => ({ t, i })).filter((x) => mfeHasData(x.t));
  const evMaeCols = d.evMatrix.maeThresholds.map((t, j) => ({ t, j })).filter((x) => maeHasData(x.t));

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_0.85fr_1.5fr] divide-y md:divide-y-0 md:divide-x divide-[var(--color-border)]">
      {/* MAE risk ladder */}
      <div className="py-4 pr-5">
        <SectionLabel info="maeRiskLadder" video="mae-risk-ladder">MAE Risk Ladder</SectionLabel>
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>Beyond</th>
              <th className={`${TH} text-right`}>Count</th>
              <th className={`${TH} text-right`}>Rate</th>
              <th className={`${TH} text-right`}>Exposure</th>
            </tr>
          </thead>
          <tbody>
            {d.maeLossRates.filter((r) => r.count > 0).map((r) => {
              const loss = d.snapshot.lossSeries.find(
                (l) => Math.abs(l.thresholdPct - r.thresholdPct) < 1e-9,
              );
              return (
                <tr key={r.thresholdPct}>
                  <td className="py-[5px] font-[var(--font-mono)] text-[var(--color-text-secondary)]">
                    &gt;{fmtPct(r.thresholdPct)}
                  </td>
                  <td className="py-[5px] text-right font-[var(--font-mono)] text-[var(--color-text-secondary)]">
                    {r.count}
                  </td>
                  <td className="py-[5px] text-right font-[var(--font-mono)] text-[var(--color-text-primary)]">
                    {fmtRatio(r.lossRate, 0)}
                  </td>
                  <td className="py-[5px] text-right font-[var(--font-mono)] text-[var(--color-error)]">
                    {fmtDollars(loss?.lossDollars ?? null)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Contract $ per move */}
      <div className="py-4 md:px-5">
        <SectionLabel info="contractDollarMove" video="contract-dollar">Contract $ / Move</SectionLabel>
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>Move</th>
              <th className={`${TH} text-right`}>Loss $</th>
              <th className={`${TH} text-right`}>Win $</th>
            </tr>
          </thead>
          <tbody>
            {d.contractSizeWins.map((win) => {
              const loss = d.contractSizeLoss.find(
                (l) => Math.abs(l.thresholdPct - win.thresholdPct) < 1e-9,
              );
              return (
                <tr key={win.thresholdPct}>
                  <td className="py-[5px] font-[var(--font-mono)] text-[var(--color-text-secondary)]">
                    {fmtPct(win.thresholdPct)}
                  </td>
                  <td className="py-[5px] text-right font-[var(--font-mono)] text-[var(--color-error)]">
                    {fmtDollars(loss?.dollarValue ?? null)}
                  </td>
                  <td className="py-[5px] text-right font-[var(--font-mono)] text-[var(--color-success)]">
                    {fmtDollars(win.dollarValue)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* EV heatmap */}
      <div className="py-4 md:pl-5">
        <div className="flex items-baseline justify-between">
          <SectionLabel info="evMatrix" video="ev-risk-matrix">EV Risk Matrix</SectionLabel>
          <span className="text-[9px] font-[var(--font-mono)] text-[var(--color-text-muted)] uppercase tracking-wider hidden xl:block">
            (strike × win$) − (loss × loss$)
          </span>
        </div>
        <table className="w-full text-[11px] tabular-nums border-separate border-spacing-[2px]">
          <thead>
            <tr>
              <th className="text-left text-[9px] font-[var(--font-mono)] font-medium uppercase tracking-wider text-[var(--color-text-muted)] pb-0.5 pr-1">
                MFE↓ MAE→
              </th>
              {evMaeCols.map(({ t }) => (
                <th
                  key={t}
                  className="text-center text-[9px] font-[var(--font-mono)] font-medium text-[var(--color-text-muted)] pb-0.5"
                >
                  {t.toFixed(2)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evMfeRows.map(({ t: mfeT, i }) => (
              <tr key={mfeT}>
                <td className="text-[10px] font-[var(--font-mono)] text-[var(--color-text-secondary)] pr-1 whitespace-nowrap">
                  {fmtPct(mfeT, 2)}
                </td>
                {evMaeCols.map(({ j }) => {
                  const v = d.evMatrix.values[i][j];
                  return (
                    <td
                      key={j}
                      className="text-center font-[var(--font-mono)] font-medium py-[4px] px-0.5 rounded-[3px] text-white/90"
                      style={evCellStyle(v, maxAbsEv)}
                    >
                      {v === null ? '—' : `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v))}`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =============================================================================
// By Vol Regime — per-(vol state) risk profile for one move
// =============================================================================

const REGIME_AXES: { id: RegimeAxis; label: string }[] = [
  { id: 'vol2', label: 'Expanding / Contracting' },
  { id: 'vol3', label: '+ Stable' },
  { id: 'ts', label: 'Contango / Backwardation' },
];

/**
 * How a move + its Min Cashflow / Max MAE rule plays out in each volatility
 * state — the descriptive layer for building a per-regime risk profile.
 * Win rate carries a Wilson 95% interval + a shrunk estimate; thin buckets
 * (< MIN_TRUST trades) are flagged, not trusted. No-lookahead (prior session).
 */
export function RegimeBreakdownPanel({ derived, minCashflowPct }: { derived: DerivedRow[]; minCashflowPct: number }) {
  const [axis, setAxis] = useState<RegimeAxis>('vol2');
  const stats = useMemo(() => regimeBreakdown(derived, axis, minCashflowPct), [derived, axis, minCashflowPct]);
  if (derived.length === 0) return null;
  return (
    <div className="border-t border-[var(--color-border)] pt-3.5 mt-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <SectionLabel info="regimeBreakdown">By Vol Regime</SectionLabel>
        <div className="flex items-center gap-1 ml-auto">
          {REGIME_AXES.map((a) => (
            <button key={a.id} type="button" onClick={() => setAxis(a.id)} aria-pressed={axis === a.id}
              className={`px-2 py-[3px] rounded-[4px] border text-[9px] font-[var(--font-mono)] uppercase tracking-[0.08em] transition-colors ${axis === a.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
      {stats.length === 0 ? (
        <div className="text-[10px] text-[var(--color-text-secondary)] py-2">No regime data for these trade dates (dates outside the bundled vol history).</div>
      ) : (
        <table className="w-full text-[12px] tabular-nums">
          <thead>
            <tr>
              <th className={`${TH} text-left w-28`}>Regime</th>
              <th className={`${TH} text-right w-9`}>N</th>
              <th className={`${TH} text-left`}>Win Rate (95% CI · shrunk)</th>
              <th className={`${TH} text-right w-16`}>Avg</th>
              <th className={`${TH} text-right w-14`}>MAE</th>
              <th className={`${TH} text-right w-14`}>MFE</th>
              <th className={`${TH} text-right w-20`}>Total $</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => {
              const meta = REGIME_META[s.regime] ?? { label: s.regime, tone: 'var(--color-text-secondary)' };
              return (
                <tr key={s.regime} className={s.thin ? 'opacity-70' : undefined}>
                  <td className="py-[4px] pr-2 font-[var(--font-mono)] uppercase" style={{ color: meta.tone }}>
                    {meta.label}{s.thin && <span className="ml-1 text-[8px] text-[var(--color-text-muted)] normal-case tracking-normal" title={`Only ${s.n} trades (<${MIN_TRUST}) — directional only`}>· thin</span>}
                  </td>
                  <td className="py-[4px] text-right font-[var(--font-mono)] text-[var(--color-text-muted)]">{s.n}</td>
                  <td className="py-[4px] pr-3">
                    <div className="relative h-[14px] bg-[var(--color-bg-secondary)] rounded-[2px] overflow-hidden">
                      {/* Wilson 95% band (light) with the shrunk estimate as the fill */}
                      <div className="absolute inset-y-0 bg-[var(--color-text-muted)]/20" style={{ left: `${s.wilsonLo * 100}%`, width: `${(s.wilsonHi - s.wilsonLo) * 100}%` }} />
                      <div className="absolute inset-y-0 left-0 rounded-[2px]" style={{ width: `${s.shrunkWinRate * 100}%`, background: s.winRate >= 0.5 ? 'linear-gradient(90deg, rgba(34,197,94,0.3), rgba(34,197,94,0.6))' : 'linear-gradient(90deg, rgba(239,68,68,0.25), rgba(239,68,68,0.55))' }} />
                      <span className="absolute inset-y-0 left-1.5 flex items-center text-[10px] font-[var(--font-mono)] font-semibold text-white/90">
                        {(s.winRate * 100).toFixed(0)}%
                        <span className="ml-1 text-[8px] text-white/55">[{(s.wilsonLo * 100).toFixed(0)}–{(s.wilsonHi * 100).toFixed(0)}] →{(s.shrunkWinRate * 100).toFixed(0)}</span>
                      </span>
                    </div>
                  </td>
                  <td className="py-[4px] text-right font-[var(--font-mono)]" style={{ color: s.avgPct >= 0 ? 'var(--color-success)' : 'var(--color-error)' }}>{s.avgPct >= 0 ? '+' : ''}{s.avgPct.toFixed(2)}%</td>
                  <td className="py-[4px] text-right font-[var(--font-mono)] text-[var(--color-text-secondary)]">{s.avgMae.toFixed(2)}%</td>
                  <td className="py-[4px] text-right font-[var(--font-mono)] text-[var(--color-text-secondary)]">{s.avgMfe.toFixed(2)}%</td>
                  <td className={`py-[4px] text-right font-[var(--font-mono)] ${s.totalPnl === null ? 'text-[var(--color-text-muted)]' : dollarTone(s.totalPnl)}`}>{s.totalPnl === null ? '—' : fmtDollars(s.totalPnl)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="text-[8px] text-[var(--color-text-muted)] mt-1.5 leading-snug">Win rate shows raw% [Wilson 95% range] →shrunk% (pulled toward this move's all-regime rate; thin buckets move most). Regime uses the prior session's value (no lookahead).</div>
    </div>
  );
}
