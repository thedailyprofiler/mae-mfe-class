/**
 * RowTable — the trade ledger for a MAE/MFE dataset.
 *
 * Dense mono ledger: zebra rows, inline editing, derived W/L + P/L columns.
 * Paginated 10 rows at a time so it sits compact beside the dashboard.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CornerDownRight, Plus, SkipForward, Trash2 } from 'lucide-react';
import type { DerivedRow, RawRow } from '../../../lib/maeMfeStats';
import { dollarTone, fmtDollars } from './format';
import { NumericInput } from './NumericInput';

export interface RowTableProps {
  rows: RawRow[];
  derived: DerivedRow[];
  refPrice: number | null;
  defaultContracts: number;
  /** Add a row dated the move's next trading day. */
  onAddRow: () => void;
  /** Add a same-day re-entry attempt (after a loss). */
  onAddAttempt?: () => void;
  /** Skip a closed session (holiday) — add a row one trading day further. */
  onAddSkip?: () => void;
  onUpdateRow: (rowIndex: number, patch: Partial<RawRow>) => void;
  onDeleteRow: (rowIndex: number) => void;
  readOnly?: boolean;
  pageSize?: number;
  /** Ledger header label. Defaults to "Trade Log". */
  title?: string;
}

const cellInput =
  'w-full bg-transparent border-0 font-[var(--font-mono)] text-[12px] text-[var(--color-text-primary)] focus:outline-none focus:bg-[var(--color-bg-hover)] rounded-[3px] px-1.5 py-[5px] transition-colors';

export function RowTable({
  rows,
  derived,
  refPrice,
  defaultContracts,
  onAddRow,
  onAddAttempt,
  onAddSkip,
  onUpdateRow,
  onDeleteRow,
  readOnly,
  pageSize = 10,
  title = 'Trade Log',
}: RowTableProps) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const end = Math.min(start + pageSize, rows.length);
  const visible = useMemo(() => rows.slice(start, end), [rows, start, end]);
  const visibleDerived = useMemo(() => derived.slice(start, end), [derived, start, end]);

  return (
    <div data-testid="mae-mfe-row-table">
      {/* Ledger label */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <span className="w-[3px] h-[11px] bg-[var(--color-accent)]" aria-hidden />
          <span className="text-[10px] font-[var(--font-mono)] font-medium uppercase tracking-[0.18em] text-[var(--color-text-secondary)]">
            {title}
          </span>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1.5">
            {onAddAttempt && (
              <button
                type="button"
                onClick={() => {
                  onAddAttempt();
                  setPage(Math.floor(rows.length / pageSize));
                }}
                data-testid="mae-mfe-add-attempt"
                title="Re-entry on the same trading day (after a loss)"
                className="
                  inline-flex items-center gap-1 px-2 py-[3px] rounded-[4px]
                  text-[10px] font-[var(--font-mono)] font-semibold uppercase tracking-wider
                  bg-[var(--color-bg-active)] text-[var(--color-text-secondary)]
                  border border-[var(--color-border-bright)]
                  hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)] transition-colors
                "
              >
                <CornerDownRight className="w-3 h-3" /> Attempt
              </button>
            )}
            {onAddSkip && (
              <button
                type="button"
                onClick={() => {
                  onAddSkip();
                  setPage(Math.floor(rows.length / pageSize));
                }}
                data-testid="mae-mfe-add-skip"
                title="Holiday / closed session — skip to the next available trading day"
                className="
                  inline-flex items-center gap-1 px-2 py-[3px] rounded-[4px]
                  text-[10px] font-[var(--font-mono)] font-semibold uppercase tracking-wider
                  bg-[var(--color-bg-active)] text-[var(--color-text-secondary)]
                  border border-[var(--color-border-bright)]
                  hover:text-[var(--color-text-primary)] hover:border-[var(--color-text-muted)] transition-colors
                "
              >
                <SkipForward className="w-3 h-3" /> Skip
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                onAddRow();
                setPage(Math.floor(rows.length / pageSize));
              }}
              data-testid="mae-mfe-add-row"
              title="Add the next trading day for this move"
              className="
                inline-flex items-center gap-1 px-2 py-[3px] rounded-[4px]
                text-[10px] font-[var(--font-mono)] font-semibold uppercase tracking-wider
                bg-[rgba(247,208,0,0.1)] text-[var(--color-accent)]
                border border-[rgba(247,208,0,0.25)]
                hover:bg-[rgba(247,208,0,0.18)] transition-colors
              "
            >
              <Plus className="w-3 h-3" /> Next Day
            </button>
          </div>
        )}
      </div>

      <table className="w-full tabular-nums border-collapse">
        <thead>
          <tr className="text-[9px] font-[var(--font-mono)] uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
            <th className="text-left font-medium pb-1.5 pr-1 w-6">#</th>
            <th className="text-left font-medium pb-1.5 px-1">Date</th>
            <th className="text-right font-medium pb-1.5 px-1 w-[56px]">MAE</th>
            <th className="text-right font-medium pb-1.5 px-1 w-[56px]">MFE</th>
            <th className="text-right font-medium pb-1.5 px-1 w-9">Ct</th>
            <th className="text-center font-medium pb-1.5 px-0.5 w-5"></th>
            <th className="text-right font-medium pb-1.5 px-1 w-[74px]">P/L</th>
            <th className="w-6"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={8}
                className="text-center py-8 text-[11px] font-[var(--font-mono)] text-[var(--color-text-muted)]"
              >
                NO TRADES LOGGED
              </td>
            </tr>
          )}
          {visible.map((row, i) => {
            const d = visibleDerived[i];
            return (
              <tr
                key={row.rowIndex}
                data-testid={`mae-mfe-row-${row.rowIndex}`}
                className="odd:bg-[var(--color-bg-secondary)]/50 hover:bg-[var(--color-bg-hover)]/60 transition-colors"
              >
                <td className="py-[4px] pr-1 text-[10px] font-[var(--font-mono)] text-[var(--color-text-muted)]">
                  {row.rowIndex}
                </td>
                <td className="py-[4px] px-1">
                  <input
                    type="date"
                    value={row.tradeDate ?? ''}
                    onChange={(e) =>
                      onUpdateRow(row.rowIndex, { tradeDate: e.target.value || null })
                    }
                    disabled={readOnly}
                    className={cellInput}
                    style={{ colorScheme: 'dark' }}
                  />
                </td>
                <td className="py-[4px] px-1">
                  <NumericInput
                    value={row.maePct}
                    onCommit={(n) => onUpdateRow(row.rowIndex, { maePct: n })}
                    disabled={readOnly}
                    placeholder="0.00"
                    className={`${cellInput} text-right text-[#fda4af]`}
                  />
                </td>
                <td className="py-[4px] px-1">
                  <NumericInput
                    value={row.mfePct}
                    onCommit={(n) => onUpdateRow(row.rowIndex, { mfePct: n })}
                    disabled={readOnly}
                    placeholder="0.00"
                    className={`${cellInput} text-right text-[#86efac]`}
                  />
                </td>
                <td className="py-[4px] px-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={row.contracts}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '' || /^[0-9]+$/.test(v)) {
                        onUpdateRow(row.rowIndex, {
                          contracts: Math.max(1, Number(v) || defaultContracts),
                        });
                      }
                    }}
                    disabled={readOnly}
                    className={`${cellInput} text-right`}
                  />
                </td>
                <td className="py-[4px] px-1 text-center">
                  <span
                    aria-label={d.isWin ? 'Win' : 'Loss'}
                    className={[
                      'inline-block w-[7px] h-[7px] rounded-full',
                      d.isWin
                        ? 'bg-[var(--color-success)] shadow-[0_0_6px_rgba(34,197,94,0.6)]'
                        : 'bg-[var(--color-error)] shadow-[0_0_6px_rgba(239,68,68,0.6)]',
                    ].join(' ')}
                  />
                </td>
                <td
                  className={`py-[4px] px-1 text-right font-[var(--font-mono)] text-[12px] font-medium ${dollarTone(d.netCashflow)}`}
                >
                  {fmtDollars(d.netCashflow)}
                </td>
                <td className="py-[4px] pl-1 text-right">
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => onDeleteRow(row.rowIndex)}
                      className="p-0.5 text-[var(--color-text-muted)]/50 hover:text-[var(--color-error)] transition-colors"
                      aria-label={`Delete row ${row.rowIndex}`}
                      data-testid={`mae-mfe-delete-row-${row.rowIndex}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Footer — pagination + bp value */}
      <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-[var(--color-border)]">
        <span className="text-[9px] font-[var(--font-mono)] uppercase tracking-wider text-[var(--color-text-muted)]">
          {refPrice !== null ? `$${(refPrice * 0.0002).toFixed(2)} / bp / ct` : 'Set ref price for $'}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1.5 text-[10px] font-[var(--font-mono)] text-[var(--color-text-muted)]">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="p-0.5 hover:text-[var(--color-accent)] disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous page"
              data-testid="mae-mfe-page-prev"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="tabular-nums">
              {start + 1}–{end} / {rows.length}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))}
              disabled={safePage >= totalPages - 1}
              className="p-0.5 hover:text-[var(--color-accent)] disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
              aria-label="Next page"
              data-testid="mae-mfe-page-next"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
