/**
 * ComparePanel — the Compare tab body.
 *
 * Band A: key-metric differences (IS | OOS | Δ) beside paired strike-rate
 * bars per MFE threshold. Band B: the combined dashboard strip over all
 * trades. Every metric is straight from the XLSX dashboard; the Δ column is
 * the only addition, computed as OOS − IS.
 */
import type { DatasetDashboard as DashType, DerivedRow } from '../../../lib/maeMfeStats';
import { DashboardBand, SectionLabel } from './DatasetDashboard';
import { fmtDollars, fmtPct } from './format';

interface Props {
  isDash: DashType;
  oosDash: DashType;
  combinedDash: DashType;
  isDerived: DerivedRow[];
  oosDerived: DerivedRow[];
}

const IS_COLOR = '#7dd3fc';

type Fmt = (n: number | null) => string;

interface MetricRow {
  label: string;
  is: number | null;
  oos: number | null;
  fmt: Fmt;
  /** Lower is better (MAE-style metrics) — flips the Δ tone. */
  betterWhenLower?: boolean;
}

function winRate(derived: DerivedRow[]): number | null {
  if (derived.length === 0) return null;
  return derived.filter((d) => d.isWin).length / derived.length;
}

const pctFmt: Fmt = (n) => (n === null ? '—' : fmtPct(n));
const ratioFmt: Fmt = (n) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
const dollarFmt: Fmt = (n) => fmtDollars(n);
const numFmt: Fmt = (n) => (n === null ? '—' : n.toFixed(1));

function deltaTone(delta: number | null, betterWhenLower = false): string {
  if (delta === null || delta === 0) return 'text-[var(--color-text-muted)]';
  const good = betterWhenLower ? delta < 0 : delta > 0;
  return good ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]';
}

function fmtDelta(delta: number | null, fmt: Fmt): string {
  if (delta === null) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${fmt(delta)}`;
}

export function ComparePanel({ isDash, oosDash, combinedDash, isDerived, oosDerived }: Props) {
  const bothEmpty = isDash.totalSamples === 0 && oosDash.totalSamples === 0;
  const oneEmpty = isDash.totalSamples === 0 || oosDash.totalSamples === 0;

  if (bothEmpty) {
    return (
      <div className="flex items-center justify-center min-h-[220px]">
        <p className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)] uppercase tracking-wider">
          Log In-Sample and Out-of-Sample trades to compare
        </p>
      </div>
    );
  }

  const d = (is: number | null, oos: number | null): number | null =>
    is === null || oos === null ? null : oos - is;

  const metrics: MetricRow[] = [
    {
      label: 'Total PNL',
      is: isDash.snapshot.totalPnl,
      oos: oosDash.snapshot.totalPnl,
      fmt: dollarFmt,
    },
    {
      label: 'Samples',
      is: isDash.totalSamples,
      oos: oosDash.totalSamples,
      fmt: (n) => (n === null ? '—' : String(n)),
    },
    { label: 'Win Rate', is: winRate(isDerived), oos: winRate(oosDerived), fmt: ratioFmt },
    {
      label: 'Win Streak Avg',
      is: isDash.snapshot.winStreakAvg,
      oos: oosDash.snapshot.winStreakAvg,
      fmt: numFmt,
    },
    {
      label: 'Average MAE',
      is: isDash.risk.average,
      oos: oosDash.risk.average,
      fmt: pctFmt,
      betterWhenLower: true,
    },
    {
      label: 'Key MAE',
      is: isDash.maeAnalysis.key,
      oos: oosDash.maeAnalysis.key,
      fmt: pctFmt,
      betterWhenLower: true,
    },
    { label: 'Average MFE', is: isDash.profit.average, oos: oosDash.profit.average, fmt: pctFmt },
    { label: 'Key MFE', is: isDash.mfeAnalysis.key, oos: oosDash.mfeAnalysis.key, fmt: pctFmt },
    {
      label: 'Medium Prob EV',
      is: isDash.cashflowEv.mediumProb,
      oos: oosDash.cashflowEv.mediumProb,
      fmt: dollarFmt,
    },
  ];

  return (
    <div data-testid="mae-mfe-compare">
      {oneEmpty && (
        <div className="px-5 py-2 border-b border-[var(--color-border)] bg-[rgba(247,208,0,0.04)]">
          <p className="text-[10px] font-[var(--font-mono)] uppercase tracking-wider text-[var(--color-warning)]">
            {isDash.totalSamples === 0 ? 'In-Sample' : 'Out-of-Sample'} has no trades yet —
            differences appear once both sides have data
          </p>
        </div>
      )}

      {/* ─── BAND A — differences | strike-rate comparison ────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[440px_minmax(0,1fr)] divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)] border-b border-[var(--color-border)]">
        {/* Key differences table */}
        <div className="p-4 bg-[var(--color-bg-inset)]/40">
          <SectionLabel>Key Differences</SectionLabel>
          <table className="w-full text-[12px] tabular-nums">
            <thead>
              <tr className="text-[9px] font-[var(--font-mono)] font-medium uppercase tracking-[0.14em]">
                <th className="text-left pb-1.5 text-[var(--color-text-muted)]">Metric</th>
                <th className="text-right pb-1.5" style={{ color: IS_COLOR }}>
                  IS
                </th>
                <th className="text-right pb-1.5 text-[var(--color-accent)]">OOS</th>
                <th className="text-right pb-1.5 text-[var(--color-text-muted)]">Δ</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const delta = d(m.is, m.oos);
                return (
                  <tr key={m.label} className="odd:bg-[var(--color-bg-secondary)]/50">
                    <td className="py-[5px] pr-2 text-[var(--color-text-secondary)]">{m.label}</td>
                    <td className="py-[5px] px-1 text-right font-[var(--font-mono)] text-[var(--color-text-primary)]">
                      {m.fmt(m.is)}
                    </td>
                    <td className="py-[5px] px-1 text-right font-[var(--font-mono)] text-[var(--color-text-primary)]">
                      {m.fmt(m.oos)}
                    </td>
                    <td
                      className={`py-[5px] pl-1 text-right font-[var(--font-mono)] font-medium ${deltaTone(delta, m.betterWhenLower)}`}
                    >
                      {fmtDelta(delta, m.fmt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Strike-rate comparison — paired bars per threshold */}
        <div className="p-4">
          <div className="flex items-baseline justify-between">
            <SectionLabel>Strike Rate · IS vs OOS</SectionLabel>
            <div className="flex items-center gap-3 text-[9px] font-[var(--font-mono)] uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-[2px]" style={{ backgroundColor: IS_COLOR }} />
                <span style={{ color: IS_COLOR }}>In Sample</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-[2px]"
                  style={{ backgroundColor: 'rgb(247,208,0)' }}
                />
                <span className="text-[var(--color-accent)]">Out of Sample</span>
              </span>
            </div>
          </div>
          <table className="w-full text-[12px] tabular-nums">
            <tbody>
              {isDash.mfeStrikeRates.map((isRow, i) => {
                const oosRow = oosDash.mfeStrikeRates[i];
                const isPct = (isRow.strikeRate ?? 0) * 100;
                const oosPct = (oosRow?.strikeRate ?? 0) * 100;
                const delta =
                  isRow.strikeRate === null || (oosRow?.strikeRate ?? null) === null
                    ? null
                    : (oosRow.strikeRate ?? 0) - (isRow.strikeRate ?? 0);
                return (
                  <tr key={isRow.thresholdPct}>
                    <td className="py-[6px] pr-3 font-[var(--font-mono)] text-[var(--color-text-secondary)] w-14 align-middle">
                      {fmtPct(isRow.thresholdPct)}
                    </td>
                    <td className="py-[6px] pr-3 align-middle">
                      {/* IS bar over OOS bar */}
                      <div className="space-y-[3px]">
                        <div className="relative h-[9px] bg-[var(--color-bg-secondary)] rounded-[2px] overflow-hidden">
                          <div
                            className="absolute inset-y-0 left-0 rounded-[2px]"
                            style={{
                              width: `${isPct}%`,
                              background: `linear-gradient(90deg, rgba(125,211,252,0.35), rgba(125,211,252,0.8))`,
                            }}
                          />
                        </div>
                        <div className="relative h-[9px] bg-[var(--color-bg-secondary)] rounded-[2px] overflow-hidden">
                          <div
                            className="absolute inset-y-0 left-0 rounded-[2px]"
                            style={{
                              width: `${oosPct}%`,
                              background:
                                'linear-gradient(90deg, rgba(247,208,0,0.3), rgba(247,208,0,0.75))',
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td
                      className="py-[6px] px-1 text-right font-[var(--font-mono)] w-14 align-middle"
                      style={{ color: IS_COLOR }}
                    >
                      {isDash.totalSamples ? `${isPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-[6px] px-1 text-right font-[var(--font-mono)] text-[var(--color-accent)] w-14 align-middle">
                      {oosDash.totalSamples ? `${oosPct.toFixed(1)}%` : '—'}
                    </td>
                    <td
                      className={`py-[6px] pl-1 text-right font-[var(--font-mono)] font-medium w-16 align-middle ${deltaTone(delta)}`}
                    >
                      {delta === null ? '—' : `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── BAND B — combined analytics over all trades ──────────── */}
      <div className="px-5">
        <div className="pt-3 -mb-1">
          <span className="text-[9px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
            Combined · {combinedDash.totalSamples} trades
          </span>
        </div>
        <DashboardBand dashboard={combinedDash} />
      </div>
    </div>
  );
}
