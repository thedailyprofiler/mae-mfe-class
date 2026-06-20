/**
 * Trading calendar for gunship moves.
 *
 * The futures week (CME Globex, ET): the market opens Sunday 18:00 and closes
 * Friday 17:00. Each "move" fires at a fixed time of day, so each trades on a
 * specific set of weekdays:
 *
 *   1800  (evening open, 18:00 ET)  → Sun, Mon, Tue, Wed, Thu   (never Fri eve)
 *   0300  (London, 03:00 ET)        → Mon, Tue, Wed, Thu, Fri
 *   MO    (NY open, ~09:30 ET)      → Mon, Tue, Wed, Thu, Fri
 *   LB    (NY lunch, ~12:00 ET)     → Mon, Tue, Wed, Thu, Fri
 *
 * "Next trading day" advances to the move's next valid weekday — so 1800 jumps
 * Thu → Sun (skipping Fri/Sat), and the day moves jump Fri → Mon. Holidays are
 * not modeled here (rare; the $ price lookup falls back to the prior session,
 * and a stray holiday row can be deleted).
 *
 * Weekdays use JS getUTCDay(): 0 = Sunday … 6 = Saturday. We read dates at noon
 * UTC so the weekday never shifts under a timezone or DST boundary.
 */
import type { GunshipMove } from './maeMfeStats';
import { getMoveWeekdays, type MoveDef } from './moveRegistry';

function weekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Does `move` trade on the given date's weekday?
 *
 * Built-in moves resolve to their fixed weekday set (1800 → Sun–Thu, others
 * Mon–Fri) — identical to the old hard-coded table. Custom moves not yet in a
 * registry fall back to Mon–Fri. Pass `defs` (from the document) to honor a
 * custom move's own weekday set. An empty weekday set = trades every day.
 */
export function isTradingDay(move: GunshipMove, iso: string, defs?: Record<string, MoveDef>): boolean {
  const wd = getMoveWeekdays(move, defs);
  return wd.length === 0 ? true : wd.includes(weekday(iso));
}

/** The move's first trading day on or after `iso`. */
export function firstTradingDateOnOrAfter(move: GunshipMove, iso: string, defs?: Record<string, MoveDef>): string {
  let d = iso;
  // Allowed sets are non-empty, so this resolves within 7 steps.
  for (let i = 0; i < 8 && !isTradingDay(move, d, defs); i++) d = addDays(d, 1);
  return d;
}

/** The move's next trading day strictly after `iso`. */
export function nextTradingDate(move: GunshipMove, iso: string, defs?: Record<string, MoveDef>): string {
  let d = addDays(iso, 1);
  for (let i = 0; i < 8 && !isTradingDay(move, d, defs); i++) d = addDays(d, 1);
  return d;
}
