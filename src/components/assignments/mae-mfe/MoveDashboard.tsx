/**
 * MoveDashboard — THE dashboard. One per view; its data switches with the
 * selected move and the In Sample / Out of Sample / ALL / Compare control.
 *
 *   IN_SAMPLE          → IS ledger (entry) + analytics
 *   OUT_OF_SAMPLE      → ledger for the active OOS window (1 / 2 / 3) + analytics
 *   ALL                → combined analytics over a selectable set (IS + any OOS)
 *   COMPARE            → IS vs a chosen target (OOS 1/2/3 or all OOS) + Δ
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  applyAttemptFilter,
  computeDatasetDashboard,
  deriveRows,
  type AttemptMode,
  type DatasetConfig,
  type GunshipMove,
  type RawRow,
} from '../../../lib/maeMfeStats';
import { assetCloseForDate, type AssetSpec } from '../../../lib/assets';
import { getMoveLabel, getMoveWeekdays } from '../../../lib/moveRegistry';
import { InfoTip } from './InfoTip';
import { firstTradingDateOnOrAfter, nextTradingDate } from '../../../lib/tradingCalendar';
import { DashboardBand, DashboardCore, RegimeBreakdownPanel } from './DatasetDashboard';
import { REGIME_ORDER, REGIME_META, REGIME_DEF, regimeWindows, regimeDates, type RegimeAxis } from '../../../lib/regimeAnalysis';
import { ComparePanel } from './ComparePanel';
import { RowTable } from './RowTable';
import { VideoButton, type DeepDiveSlug } from './SectionVideo';
import { NumericInput } from './NumericInput';
import { dollarTone, fmtDollars } from './format';
import { OOS_KEYS, resolveStudy, type OosKey, type SampleKey } from './maeMfeDocument';

export type SampleTab = 'IN_SAMPLE' | 'OUT_OF_SAMPLE' | 'ALL' | 'COMPARE';

export interface SampleData {
  startDate: string | null;
  rows: RawRow[];
}

// One study = the four sample buckets (In Sample + OOS 1/2/3) for a single
// in-sample/out-of-sample analysis. Custom studies carry their own label.
export interface Study {
  inSample: SampleData;
  oos1: SampleData;
  oos2: SampleData;
  oos3: SampleData;
  label?: string;
}

// Three independent out-of-sample windows per move (OOS 1 / 2 / 3).
// The four inline buckets ARE the "default" study (kept inline so old blobs and
// older bundles read them unchanged). Additional named studies live in the
// optional `extraStudies` overlay — purely additive, never moves existing data.
export interface MoveState {
  minCashflowPct: number;
  defaultContracts: number;
  /** Max-MAE stop (percent). 0 = no stop. Caps loss & MAE, forces a stop-out loss. */
  maxMaePct?: number;
  /** Same-day attempt lens (persisted). Carries from Step 2 into the analysis labs. */
  attemptMode?: AttemptMode;
  /** True once the user explicitly edits/applies this move's config — so the
   *  auto-default-to-safest leaves it alone (it only snaps un-flagged moves). */
  userSet?: boolean;
  inSample: SampleData;
  oos1: SampleData;
  oos2: SampleData;
  oos3: SampleData;
  /** Display label for custom (non-built-in) moves. Built-ins use the registry. */
  label?: string;
  /** Additional named studies beyond the default (inline) one. Keyed by `st_xxx`. */
  extraStudies?: Record<string, Study>;
}

export interface MoveDashboardProps {
  move: GunshipMove;
  /** Active asset — drives auto-pricing + contract math + header label. */
  asset: AssetSpec;
  moveState: MoveState;
  /** Which study's buckets to show ('default' = the inline buckets). */
  activeStudy: string;
  activeTab: SampleTab;
  onTabChange: (tab: SampleTab) => void;
  onPatchConfig: (
    patch: Partial<Pick<MoveState, 'minCashflowPct' | 'defaultContracts' | 'maxMaePct' | 'attemptMode'>>,
  ) => void;
  onSetStartDate: (sample: SampleKey, startDate: string | null) => void;
  onAddRow: (sample: SampleKey, tradeDate: string) => void;
  onUpdateRow: (sample: SampleKey, rowIndex: number, patch: Partial<RawRow>) => void;
  onDeleteRow: (sample: SampleKey, rowIndex: number) => void;
  /** Bulk-seed empty rows for a list of dates (the regime's sessions to collect). */
  onSeedDates?: (sample: SampleKey, dates: string[]) => void;
  readOnly?: boolean;
  /** Rendered ABOVE the config row (the auto recommender). */
  topSlot?: ReactNode;
  /** Apply the manual config as the active setup (syncs position size, transfers to later steps). */
  onApplyConfig?: () => void;
  /** Live pass/bust readout for the CURRENT config — rendered inside the ③ ring, adapts on change. */
  riskReadout?: ReactNode;
  /** Rendered between the config row and the metrics/analysis (entry/study pick). */
  middle?: ReactNode;
}

const OOS_LABELS: Record<OosKey, string> = { oos1: 'OOS 1', oos2: 'OOS 2', oos3: 'OOS 3' };
const OOS_AXIS_SHORT: Record<RegimeAxis, string> = { vol2: 'Exp/Con', vol3: '+Stable', ts: 'Term' };

// Which datasets the ALL view combines (default: everything).
type AllInclude = Record<'inSample' | OosKey, boolean>;
// Which dataset the Compare view pits against In Sample.
type CompareTarget = OosKey | 'allOos';

const inputCls =
  'w-full bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2.5 py-[7px] text-[12px] font-[var(--font-mono)] text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-dim)] transition-colors';

function ConfigField({
  label,
  children,
  width,
  info,
}: {
  label: string;
  children: React.ReactNode;
  width?: string;
  info?: string;
}) {
  return (
    <div style={width ? { width } : undefined}>
      <div className="flex items-center gap-1 text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-text-muted)] mb-1">
        {label}
        {info && <InfoTip id={info} />}
      </div>
      {children}
    </div>
  );
}

function TickerMetric({
  label,
  value,
  tone,
  info,
  video,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  info?: string;
  video?: DeepDiveSlug;
}) {
  return (
    <div className="flex-1 min-w-0 px-4 py-2.5">
      <div
        className={`font-[var(--font-mono)] text-lg font-semibold leading-none tabular-nums ${tone ?? 'text-[var(--color-text-primary)]'}`}
      >
        {value}
      </div>
      <div className="mt-1 flex items-center gap-1 text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
        {label}
        {info && <InfoTip id={info} />}
        {video && <VideoButton slug={video} />}
      </div>
    </div>
  );
}

// Small segmented control used for the OOS sub-picker + Compare target.
function Segmented<T extends string>({
  options,
  value,
  onChange,
  testidPrefix,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testidPrefix: string;
}) {
  return (
    <div className="inline-flex items-center rounded-[6px] border border-[var(--color-border)] bg-[var(--color-bg-inset)] p-[3px]">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            data-testid={`${testidPrefix}-${o.id}`}
            className={[
              'px-3 py-[5px] rounded-[4px] text-[10px] font-[var(--font-mono)] font-semibold uppercase tracking-[0.12em] transition-colors',
              active
                ? 'bg-[rgba(247,208,0,0.14)] text-[var(--color-accent)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
            ].join(' ')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const SAMPLE_TABS: { id: SampleTab; label: string }[] = [
  { id: 'IN_SAMPLE', label: 'In Sample' },
  { id: 'OUT_OF_SAMPLE', label: 'Out of Sample' },
  { id: 'ALL', label: 'All' },
  { id: 'COMPARE', label: 'Compare' },
];

export function MoveDashboard({
  move,
  asset,
  moveState,
  activeStudy,
  activeTab,
  onTabChange,
  onPatchConfig,
  onSetStartDate,
  onAddRow,
  onUpdateRow,
  onDeleteRow,
  onSeedDates,
  topSlot,
  onApplyConfig,
  riskReadout,
  middle,
  readOnly,
}: MoveDashboardProps) {
  // Config (contracts, min-cashflow) is shared across a move's studies; the four
  // buckets come from the ACTIVE study (default study = the inline buckets).
  const { minCashflowPct, defaultContracts, maxMaePct = 0 } = moveState;
  const study = resolveStudy(moveState, activeStudy);
  const { inSample } = study;

  // ── Ephemeral view state ────────────────────────────────────────
  const [activeOos] = useState<OosKey>('oos1'); // single OOS storage bucket; regime is a view, not a slot
  // OUT-OF-SAMPLE picker = vol regime to collect (axis + regime), drives the "dates to collect" prefill.
  const [oosAxis, setOosAxis] = useState<RegimeAxis>('vol2');
  const [oosRegime, setOosRegime] = useState<string>('EXPANDING');
  const [compareTarget, setCompareTarget] = useState<CompareTarget>('oos1');
  // Multi-attempt-per-day lens — PERSISTED in the move's config so it carries
  // from Step 2 into the analysis labs (Monte Carlo / Correlation / Prop Sim).
  const attemptMode = useMemo<AttemptMode>(() => moveState.attemptMode ?? { kind: 'all' }, [moveState.attemptMode]);
  // DOW filter — keep only the selected weekday(s). A view lens: no selection = all
  // days; it never deletes rows, and flows into every stat, the trade log, and the
  // By-Day-of-Week breakdown because it's folded into the row-prep below.
  const [dowFilter, setDowFilter] = useState<Set<number>>(new Set());
  const filtAttempts = useCallback((rows: RawRow[]) => {
    const att = applyAttemptFilter(rows, attemptMode);
    if (dowFilter.size === 0) return att;
    return att.filter((r) => {
      if (!r.tradeDate) return false;
      const w = new Date(`${r.tradeDate}T12:00:00Z`).getUTCDay(); // noon UTC, matches tradingCalendar
      return dowFilter.has(w);
    });
  }, [attemptMode, dowFilter]);
  const [allIncludes, setAllIncludes] = useState<AllInclude>({
    inSample: true,
    oos1: true,
    oos2: true,
    oos3: true,
  });

  // ── Engine inputs ───────────────────────────────────────────────
  // Ref price resolves automatically from the trade date's daily close, so the
  // bps→$ conversion is exact per trade. No manual price entry.
  const mergeDefaults = useMemo(
    () => (rows: RawRow[]) =>
      rows.map((r) => ({
        ...r,
        refPrice: r.refPrice ?? assetCloseForDate(asset.ticker, r.tradeDate),
        contracts: r.contracts || defaultContracts,
      })),
    [defaultContracts, asset.ticker],
  );

  const cfg = useMemo<DatasetConfig>(
    () => ({
      id: move,
      gunshipMove: move,
      sampleType: 'IN_SAMPLE',
      minCashflowPct,
      defaultContracts,
      maxMaePct,
      pointValueUsd: asset.pointValueUsd,
      label: null,
    }),
    [move, minCashflowPct, defaultContracts, maxMaePct, asset.pointValueUsd],
  );

  // Per-bucket priced rows (attempt-filtered first, so the lens flows everywhere).
  const isRows = useMemo(() => mergeDefaults(filtAttempts(inSample.rows)), [mergeDefaults, filtAttempts, inSample.rows]);
  const oos1Rows = useMemo(() => mergeDefaults(filtAttempts(study.oos1.rows)), [mergeDefaults, filtAttempts, study.oos1.rows]);
  const oos2Rows = useMemo(() => mergeDefaults(filtAttempts(study.oos2.rows)), [mergeDefaults, filtAttempts, study.oos2.rows]);
  const oos3Rows = useMemo(() => mergeDefaults(filtAttempts(study.oos3.rows)), [mergeDefaults, filtAttempts, study.oos3.rows]);

  // Per-bucket derived + dashboards.
  const isDerived = useMemo(() => deriveRows(isRows, cfg), [isRows, cfg]);
  const oos1Derived = useMemo(() => deriveRows(oos1Rows, cfg), [oos1Rows, cfg]);
  const oos2Derived = useMemo(() => deriveRows(oos2Rows, cfg), [oos2Rows, cfg]);
  const oos3Derived = useMemo(() => deriveRows(oos3Rows, cfg), [oos3Rows, cfg]);
  const oosDerivedByKey: Record<OosKey, typeof isDerived> = { oos1: oos1Derived, oos2: oos2Derived, oos3: oos3Derived };

  const isDash = useMemo(() => computeDatasetDashboard(isRows, cfg), [isRows, cfg]);
  const oos1Dash = useMemo(() => computeDatasetDashboard(oos1Rows, cfg), [oos1Rows, cfg]);
  const oos2Dash = useMemo(() => computeDatasetDashboard(oos2Rows, cfg), [oos2Rows, cfg]);
  const oos3Dash = useMemo(() => computeDatasetDashboard(oos3Rows, cfg), [oos3Rows, cfg]);
  const oosDashByKey: Record<OosKey, typeof isDash> = { oos1: oos1Dash, oos2: oos2Dash, oos3: oos3Dash };

  // ── ALL — combined over the selected datasets ───────────────────
  const allRaw = useMemo(() => {
    const parts: RawRow[] = [];
    if (allIncludes.inSample) parts.push(...isRows);
    if (allIncludes.oos1) parts.push(...oos1Rows);
    if (allIncludes.oos2) parts.push(...oos2Rows);
    if (allIncludes.oos3) parts.push(...oos3Rows);
    return parts;
  }, [allIncludes, isRows, oos1Rows, oos2Rows, oos3Rows]);
  const allRows = useMemo(() => allRaw.map((r, i) => ({ ...r, rowIndex: i + 1 })), [allRaw]);
  const allDerived = useMemo(() => deriveRows(allRaw, cfg), [allRaw, cfg]);
  const allDash = useMemo(() => computeDatasetDashboard(allRaw, cfg), [allRaw, cfg]);

  // ── COMPARE — IS vs target (one OOS or all OOS) ─────────────────
  const targetRaw = useMemo(() => {
    if (compareTarget === 'oos1') return oos1Rows;
    if (compareTarget === 'oos2') return oos2Rows;
    if (compareTarget === 'oos3') return oos3Rows;
    return [...oos1Rows, ...oos2Rows, ...oos3Rows]; // allOos
  }, [compareTarget, oos1Rows, oos2Rows, oos3Rows]);
  const targetDerived = useMemo(() => deriveRows(targetRaw, cfg), [targetRaw, cfg]);
  const targetDash = useMemo(() => computeDatasetDashboard(targetRaw, cfg), [targetRaw, cfg]);
  const compareCombinedRaw = useMemo(() => [...isRows, ...targetRaw], [isRows, targetRaw]);
  const compareCombinedDash = useMemo(() => computeDatasetDashboard(compareCombinedRaw, cfg), [compareCombinedRaw, cfg]);

  // ── Active-tab data ─────────────────────────────────────────────
  const comparing = activeTab === 'COMPARE';
  const all = activeTab === 'ALL';
  const oosActive = activeTab === 'OUT_OF_SAMPLE';

  const activeDash = comparing ? compareCombinedDash : all ? allDash : oosActive ? oosDashByKey[activeOos] : isDash;
  // Only read on the non-compare path (Compare renders ComparePanel, not RowTable).
  const activeDerived = all ? allDerived : oosActive ? oosDerivedByKey[activeOos] : isDerived;
  const activeRows = all ? allRows : oosActive ? filtAttempts(study[activeOos].rows) : filtAttempts(inSample.rows);

  const winRate = (() => {
    const d = all ? allDerived : oosActive ? oosDerivedByKey[activeOos] : isDerived;
    return d.length ? d.filter((x) => x.isWin).length / d.length : null;
  })();

  // Longest run of consecutive losers in the active selection — the streak risk
  // behind "risk of ruin" (a long losing run is what busts an account).
  const maxLossStreak = (() => {
    const d = all ? allDerived : oosActive ? oosDerivedByKey[activeOos] : isDerived;
    let max = 0, cur = 0;
    for (const r of d) { if (r.isWin) cur = 0; else { cur += 1; if (cur > max) max = cur; } }
    return max;
  })();

  // Representative price = most recent priced trade, for the "$/bp/ct" readout.
  const latestPriced = [...(all ? allDerived : oosActive ? oosDerivedByKey[activeOos] : isDerived)]
    .reverse()
    .find((r) => r.refPrice !== null);
  const repPrice = latestPriced?.refPrice ?? null;

  // ── Add-trade dates (editable IS / OOS tabs only) ───────────────
  const editableKey: SampleKey = oosActive ? activeOos : 'inSample';
  const editable = study[editableKey];
  const lastRow = editable.rows[editable.rows.length - 1];
  const seedDate = editable.startDate ?? new Date().toISOString().slice(0, 10);
  const nextDayDate = lastRow?.tradeDate
    ? nextTradingDate(move, lastRow.tradeDate)
    : firstTradingDateOnOrAfter(move, seedDate);
  const attemptDate = lastRow?.tradeDate ?? nextDayDate;
  const skipDayDate = nextTradingDate(move, nextDayDate);

  const sampleTypeLabel = comparing
    ? `IS vs ${compareTarget === 'allOos' ? 'All OOS' : OOS_LABELS[compareTarget]}`
    : all
      ? 'All'
      : oosActive
        ? OOS_LABELS[activeOos]
        : 'In Sample';

  const rowTableTitle = all
    ? 'Trade Log · All'
    : oosActive
      ? `Trade Log · ${OOS_LABELS[activeOos]}`
      : 'Trade Log · IS';

  return (
    <section
      data-testid={`mae-mfe-dashboard-${move}`}
      className="rounded-[var(--radius-xl)] rounded-tl-none border border-[var(--color-border)] bg-[var(--color-surface-1)] overflow-hidden"
    >
      {/* ─── HEADER — identity + sample control ───────────────────── */}
      <header className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="w-[3px] h-7 rounded-full"
            style={{
              backgroundColor: activeTab === 'IN_SAMPLE' ? '#7dd3fc' : all ? 'var(--color-success)' : 'var(--color-accent)',
            }}
          />
          <div>
            <div className="flex items-baseline gap-2.5">
              <h2 className="font-[var(--font-serif)] text-xl font-semibold text-[var(--color-text-primary)] leading-none">
                {moveState.label ?? getMoveLabel(move)}
              </h2>
              <span className="text-[10px] font-[var(--font-mono)] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
                {sampleTypeLabel}
              </span>
            </div>
            <p className="mt-1 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.12em] text-[var(--color-text-muted)]">
              {asset.label} · {repPrice !== null ? `$${(repPrice * 0.0001 * asset.pointValueUsd).toFixed(2)}/bp/ct` : 'auto-priced'}
            </p>
          </div>
        </div>

        {/* Sample segmented control + how-to video */}
        <div className="flex items-center gap-2">
        <div
          className="flex items-center rounded-[6px] border border-[var(--color-border)] bg-[var(--color-bg-inset)] p-[3px]"
          role="tablist"
          aria-label="Sample type"
        >
          {SAMPLE_TABS.map((t) => {
            const active = t.id === activeTab;
            const activeCls =
              t.id === 'IN_SAMPLE'
                ? 'bg-[rgba(125,211,252,0.14)] text-[#7dd3fc]'
                : t.id === 'ALL'
                  ? 'bg-[rgba(34,197,94,0.14)] text-[var(--color-success)]'
                  : 'bg-[rgba(247,208,0,0.14)] text-[var(--color-accent)]';
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onTabChange(t.id)}
                data-testid={`mae-mfe-sample-tab-${t.id}`}
                className={[
                  'px-3 py-[5px] rounded-[4px] text-[10px] font-[var(--font-mono)] font-semibold uppercase tracking-[0.12em] transition-colors',
                  active ? activeCls : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                ].join(' ')}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <VideoButton slug="samples-studies" />
        </div>
      </header>

      {topSlot && <div className="px-5 py-3 border-b border-[var(--color-border)]">{topSlot}</div>}

      {/* ─── ③ YOU SET YOUR RISK — manual config + entry/study, gold-ringed ─ */}
      <div className="px-5 py-3 border-b border-[var(--color-border)]">
      <div className="rounded-[8px] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/[0.04] p-3">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-accent)] text-black font-[var(--font-mono)] text-[10px] font-bold shrink-0">3</span>
        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-accent)] font-semibold">You set your risk</span>
        <span className="text-[10px] text-[var(--color-text-secondary)]">— fine-tune contracts, MFE target, Max MAE &amp; attempts yourself, then press Apply.</span>
        <VideoButton slug="sync-rule" />
      </div>

      {/* ─── TOOLBAR — setup inputs (price is automatic) ──────────── */}
      <div className="flex items-end gap-4 flex-wrap">
        <ConfigField label="Contracts" width="78px" info="contracts">
          <input
            type="text"
            inputMode="numeric"
            value={defaultContracts}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '' || /^[0-9]+$/.test(v)) {
                onPatchConfig({ defaultContracts: Math.max(1, Number(v) || 1) });
              }
            }}
            disabled={readOnly}
            className={inputCls}
            data-testid="mae-mfe-contracts"
          />
        </ConfigField>
        <ConfigField label="Min Cashflow %" width="116px" info="minCashflow">
          <NumericInput
            value={minCashflowPct}
            onCommit={(n) => onPatchConfig({ minCashflowPct: n })}
            disabled={readOnly}
            className={inputCls}
            data-testid="mae-mfe-mincashflow"
          />
        </ConfigField>
        <ConfigField label="Max MAE %" width="116px" info="maxMae">
          <NumericInput
            value={maxMaePct}
            onCommit={(n) => onPatchConfig({ maxMaePct: Math.max(0, n) })}
            disabled={readOnly}
            className={inputCls}
            data-testid="mae-mfe-maxmae"
          />
        </ConfigField>
        <ConfigField label="Attempts / Day" width="142px" info="attempts">
          <select
            value={attemptMode.kind === 'all' ? 'all' : `${attemptMode.kind}:${attemptMode.n}`}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'all') onPatchConfig({ attemptMode: { kind: 'all' } });
              else {
                const [kind, n] = v.split(':');
                onPatchConfig({ attemptMode: { kind: kind as 'first' | 'only', n: Number(n) } });
              }
            }}
            className={inputCls}
            style={{ colorScheme: 'dark' }}
            data-testid="mae-mfe-attempts"
          >
            <option value="all">All attempts</option>
            <option value="first:1">1st only</option>
            <option value="first:2">First 2</option>
            <option value="first:3">First 3</option>
            <option value="first:4">First 4</option>
            <option value="only:2">Only 2nd</option>
            <option value="only:3">Only 3rd</option>
            <option value="only:4">Only 4th</option>
          </select>
        </ConfigField>
        <ConfigField label="DOW" info="dow">
          <div className="flex items-center gap-1">
            {([[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri']] as const).map(([d, lbl]) => {
              const on = dowFilter.has(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={readOnly}
                  onClick={() => setDowFilter((s) => { const n = new Set(s); if (n.has(d)) n.delete(d); else n.add(d); return n; })}
                  data-testid={`mae-mfe-dow-${d}`}
                  aria-pressed={on}
                  className={['px-2 py-[5px] rounded-[4px] border text-[10px] font-[var(--font-mono)] font-semibold uppercase tracking-[0.08em] transition-colors', on ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'].join(' ')}>
                  {lbl}
                </button>
              );
            })}
            {dowFilter.size > 0 && (
              <button type="button" onClick={() => setDowFilter(new Set())} className="text-[9px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] ml-0.5" title="Clear DOW filter">clear</button>
            )}
          </div>
        </ConfigField>
        <span className="w-px self-stretch bg-[var(--color-border)] mx-1" aria-hidden />
        <ConfigField label="In-Sample Start" width="156px">
          <input
            type="date"
            value={inSample.startDate ?? ''}
            onChange={(e) => onSetStartDate('inSample', e.target.value || null)}
            disabled={readOnly}
            className={inputCls}
            style={{ colorScheme: 'dark' }}
            data-testid="mae-mfe-is-start"
          />
        </ConfigField>
        {oosActive && (
          <ConfigField label={`${REGIME_META[oosRegime]?.label ?? 'OOS'} Start`} width="156px" info="oosRegimeCollect">
            <input
              type="date"
              value={study[activeOos].startDate ?? ''}
              onChange={(e) => onSetStartDate(activeOos, e.target.value || null)}
              disabled={readOnly}
              className={inputCls}
              style={{ colorScheme: 'dark' }}
              data-testid="mae-mfe-oos-start"
            />
          </ConfigField>
        )}
        <p className="ml-auto self-center text-[10px] font-[var(--font-mono)] uppercase tracking-[0.12em] text-[var(--color-text-muted)] max-w-[180px] text-right leading-snug">
          $ auto-priced from {asset.label} daily close per trade date
        </p>
        {onApplyConfig && (
          <button type="button" onClick={onApplyConfig} data-testid="mae-mfe-apply-config"
            title="Use this manual setup — sets your position size and transfers to the risk & portfolio steps"
            className="self-center text-[10px] px-3 py-1.5 rounded-[6px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 uppercase tracking-[0.1em]">
            Apply
          </button>
        )}
      </div>

      {/* Entry / Study pick (left) + live risk readout (right) on one row to save vertical space. */}
      {(middle || riskReadout) && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          {middle && <div className="min-w-0">{middle}</div>}
          {riskReadout && <div className="shrink-0 ml-auto">{riskReadout}</div>}
        </div>
      )}
      </div>
      </div>

      {/* ─── SUB-CONTROL — OOS picker / ALL toggles / Compare target ─ */}
      {(oosActive || all || comparing) && (
        <div className="flex items-center gap-3 px-5 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40">
          {oosActive && (
            <>
              <span className="text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-text-muted)]">Collect for</span>
              {(['vol2', 'vol3', 'ts'] as RegimeAxis[]).map((ax) => (
                <button key={ax} type="button" onClick={() => { setOosAxis(ax); const rg0 = REGIME_ORDER[ax][0]; setOosRegime(rg0); const w = regimeWindows(ax, rg0)[0]; if (w) onSetStartDate(activeOos, w.start); }} aria-pressed={oosAxis === ax}
                  className={`px-2 py-[4px] rounded-[4px] border text-[9px] font-[var(--font-mono)] uppercase tracking-[0.1em] transition-colors ${oosAxis === ax ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}>{OOS_AXIS_SHORT[ax]}</button>
              ))}
              <span className="w-px self-stretch bg-[var(--color-border)]" aria-hidden />
              {REGIME_ORDER[oosAxis].map((rg) => (
                <button key={rg} type="button" onClick={() => { setOosRegime(rg); const w = regimeWindows(oosAxis, rg)[0]; if (w) onSetStartDate(activeOos, w.start); }} aria-pressed={oosRegime === rg}
                  className={`px-2.5 py-[4px] rounded-[4px] border text-[10px] font-[var(--font-mono)] uppercase tracking-[0.1em] transition-colors ${oosRegime === rg ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                  style={oosRegime === rg ? { color: REGIME_META[rg].tone } : undefined}>{REGIME_META[rg]?.label ?? rg}</button>
              ))}
            </>
          )}
          {all && (
            <>
              <span className="text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                Include
              </span>
              {(['inSample', ...OOS_KEYS] as const).map((k) => {
                const on = allIncludes[k];
                const label = k === 'inSample' ? 'IS' : OOS_LABELS[k as OosKey];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setAllIncludes((s) => ({ ...s, [k]: !s[k] }))}
                    data-testid={`mae-mfe-all-include-${k}`}
                    aria-pressed={on}
                    className={[
                      'px-3 py-[5px] rounded-[5px] border text-[10px] font-[var(--font-mono)] font-semibold uppercase tracking-[0.12em] transition-colors',
                      on
                        ? 'border-[var(--color-success)]/50 bg-[rgba(34,197,94,0.12)] text-[var(--color-success)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                    ].join(' ')}
                  >
                    {on ? '✓ ' : ''}{label}
                  </button>
                );
              })}
            </>
          )}
          {comparing && (
            <>
              <span className="text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                Compare IS vs
              </span>
              <Segmented
                testidPrefix="mae-mfe-compare-target"
                value={compareTarget}
                onChange={setCompareTarget}
                options={[...OOS_KEYS.map((k) => ({ id: k as CompareTarget, label: OOS_LABELS[k] })), { id: 'allOos' as CompareTarget, label: 'All OOS' }]}
              />
            </>
          )}
        </div>
      )}

      {/* ─── OOS REGIME — plain-language definition + "drop the dates into the log" ─ */}
      {oosActive && (() => {
        const meta = REGIME_META[oosRegime] ?? { label: oosRegime, tone: 'var(--color-text-secondary)' };
        const def = REGIME_DEF[oosRegime] ?? '';
        // The regime's sessions that this move actually trades (its weekday set).
        const wkdays = new Set(getMoveWeekdays(move));
        const dates = regimeDates(oosAxis, oosRegime).filter((d) => wkdays.has(new Date(`${d}T12:00:00Z`).getUTCDay()));
        const have = new Set((study[activeOos].rows ?? []).map((r) => r.tradeDate));
        const toAdd = dates.filter((d) => !have.has(d));
        return (
          <div className="px-5 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] mb-0.5"><span className="font-semibold uppercase tracking-wide" style={{ color: meta.tone }}>{meta.label}</span> <span className="text-[var(--color-text-muted)]">— what this means</span></div>
                <p className="text-[10px] text-[var(--color-text-secondary)] leading-relaxed">{def}</p>
              </div>
              {onSeedDates && (
                <div className="shrink-0 text-right">
                  <button type="button" disabled={readOnly || toAdd.length === 0}
                    onClick={() => onSeedDates(activeOos, dates)}
                    className="text-[10px] px-3 py-1.5 rounded-[6px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-40 uppercase tracking-[0.1em] whitespace-nowrap">
                    + Add {toAdd.length} dates to log
                  </button>
                  <div className="text-[8px] text-[var(--color-text-muted)] mt-1 max-w-[180px] leading-snug">{dates.length} {meta.label} sessions this move trades. They drop into the log dated &amp; empty — then collect/fill MAE·MFE.</div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ─── TICKER — active selection ─────────────────────────────── */}
      <div className="flex items-stretch divide-x divide-[var(--color-border)] border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/60">
        <TickerMetric
          label={comparing || all ? 'Combined PNL' : 'Total PNL'}
          value={fmtDollars(activeDash.snapshot.totalPnl)}
          tone={dollarTone(activeDash.snapshot.totalPnl)}
          info="totalPnl"
          video="headline-metrics"
        />
        <TickerMetric label="Samples" value={activeDash.totalSamples} info="samples" />
        <TickerMetric
          label="Win Rate"
          value={winRate === null ? '—' : `${(winRate * 100).toFixed(1)}%`}
          tone={
            winRate === null
              ? undefined
              : winRate >= 0.5
                ? 'text-[var(--color-success)]'
                : 'text-[var(--color-error)]'
          }
          info="winRate"
        />
        <TickerMetric
          label="Avg Win Streak"
          value={activeDash.snapshot.winStreakAvg === null ? '—' : activeDash.snapshot.winStreakAvg.toFixed(1)}
          info="avgWinStreak"
        />
        <TickerMetric
          label="Loss Streak"
          value={maxLossStreak === 0 ? '—' : maxLossStreak}
          tone={maxLossStreak > 0 ? 'text-[var(--color-error)]' : undefined}
          info="maxLossStreak"
        />
        <TickerMetric
          label="Span"
          value={
            activeDash.timeAnchor.days === null || activeDash.timeAnchor.days === 0
              ? (activeDash.timeAnchor.firstDate ?? '—')
              : `${activeDash.timeAnchor.days}d`
          }
          info="span"
        />
      </div>

      {comparing ? (
        /* ─── COMPARE — differences + combined analytics ──────────── */
        <ComparePanel
          isDash={isDash}
          oosDash={targetDash}
          combinedDash={compareCombinedDash}
          isDerived={isDerived}
          oosDerived={targetDerived}
        />
      ) : (
        <>
          {/* ─── BAND A — ledger | analytics ─────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-[440px_minmax(0,1fr)] divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)] border-b border-[var(--color-border)]">
            <div className="p-4 bg-[var(--color-bg-inset)]/40">
              <RowTable
                title={rowTableTitle}
                video="mae-mfe-basics"
                rows={activeRows}
                derived={activeDerived}
                refPrice={repPrice}
                defaultContracts={defaultContracts}
                onAddRow={() => onAddRow(editableKey, nextDayDate)}
                onAddAttempt={() => onAddRow(editableKey, attemptDate)}
                onAddSkip={() => onAddRow(editableKey, skipDayDate)}
                onUpdateRow={(rowIndex, patch) => onUpdateRow(editableKey, rowIndex, patch)}
                onDeleteRow={(rowIndex) => onDeleteRow(editableKey, rowIndex)}
                readOnly={readOnly || all}
                pageSize={12}
              />
            </div>
            <div className="p-4">
              <DashboardCore dashboard={activeDash} />
            </div>
          </div>

          {/* ─── BAND B — ladder | contract | EV heatmap ─────────── */}
          <div className="px-5">
            <DashboardBand dashboard={activeDash} />
            {/* By Vol Regime — per-(vol state) risk profile for the active dataset */}
            <RegimeBreakdownPanel derived={activeDerived} minCashflowPct={minCashflowPct} />
          </div>
        </>
      )}
    </section>
  );
}
