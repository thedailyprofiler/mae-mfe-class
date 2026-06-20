/**
 * Move registry — the single source of truth for "what moves exist" and their
 * display label + trading-calendar weekdays.
 *
 * Phase 1A foundation: today this only holds the 4 built-in gunship moves, so
 * behavior is identical to the old hard-coded enumerations. It exists so that
 * custom user-defined moves (Phase 2) slot in without touching every call site
 * again — the enumeration sites read from here + the document's own move keys.
 *
 * Keys are STABLE ids (built-in literals today; generated `mv_xxx` ids for custom
 * moves in Phase 2). Labels are display-only and user-editable for custom moves —
 * never key by the label. See discovery report 2026-06-07.
 */

export const BUILTIN_MOVES = ['1800', '0300', 'MO', 'LB'] as const;
export type BuiltinMove = (typeof BUILTIN_MOVES)[number];

export interface MoveDef {
  /** Stable key (built-in literal, or generated `mv_xxx` for custom). */
  id: string;
  /** Display text. User-editable for custom moves. */
  label: string;
  builtin: boolean;
  /**
   * JS getUTCDay() weekday set this move trades on (0=Sun … 6=Sat).
   * Empty array = "no weekday restriction" (every day is a trading day).
   */
  weekdays: number[];
}

/**
 * The 4 built-ins. Weekday sets are lifted verbatim from the old
 * tradingCalendar.MOVE_WEEKDAYS so the calendar behaves identically:
 *   1800 (evening open) → Sun–Thu;  0300/MO/LB → Mon–Fri.
 */
export const DEFAULT_MOVE_DEFS: Record<BuiltinMove, MoveDef> = {
  '1800': { id: '1800', label: '1800', builtin: true, weekdays: [0, 1, 2, 3, 4] },
  '0300': { id: '0300', label: '0300', builtin: true, weekdays: [1, 2, 3, 4, 5] },
  MO: { id: 'MO', label: 'Market Open', builtin: true, weekdays: [1, 2, 3, 4, 5] },
  LB: { id: 'LB', label: 'Lunch Break', builtin: true, weekdays: [1, 2, 3, 4, 5] },
};

/** Built-in display order (custom moves are appended after these). */
export const DEFAULT_MOVE_ORDER: string[] = [...BUILTIN_MOVES];

/** Default weekdays for a move not found in any registry (custom-move fallback). */
const FALLBACK_WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri

/** Is this id one of the 4 built-in moves? */
export function isBuiltinMove(id: string): id is BuiltinMove {
  return (BUILTIN_MOVES as readonly string[]).includes(id);
}

/**
 * Display label for a move id. Looks in the document-provided defs first
 * (custom moves), then the built-in table, then falls back to the id itself.
 */
export function getMoveLabel(id: string, defs?: Record<string, MoveDef>): string {
  return defs?.[id]?.label ?? DEFAULT_MOVE_DEFS[id as BuiltinMove]?.label ?? id;
}

/**
 * Trading weekdays for a move id. Built-ins return their fixed set; unknown
 * (custom, not-yet-registered) ids fall back to Mon–Fri so the calendar never
 * crashes on a key it hasn't seen.
 */
export function getMoveWeekdays(id: string, defs?: Record<string, MoveDef>): number[] {
  return defs?.[id]?.weekdays ?? DEFAULT_MOVE_DEFS[id as BuiltinMove]?.weekdays ?? FALLBACK_WEEKDAYS;
}
