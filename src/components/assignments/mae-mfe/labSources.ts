/**
 * Shared source-building for the Compare and Cycle labs.
 *
 * A lab "source" is one (asset, move) cell resolved at a chosen STUDY and
 * ATTEMPT subset, then valued in dollars. This lets you e.g. compare/cycle the
 * "1st attempt of Study 2 on MNQ·1800" — study + attempt are picked per set.
 *
 * Study is selected by ORDINAL (1 = default/inline study, 2 = first named study,
 * …) because study ids are per-(asset,move) and can't be matched across moves;
 * the ordinal resolves to each source's nth study, falling back to its default.
 */
import type { AssetTicker } from '../../../lib/assets';
import { applyAttemptFilter, type AttemptMode } from '../../../lib/maeMfeStats';
import type { SourceInput } from '../../../lib/maeMfeCombine';
import { resolveStudy, DEFAULT_STUDY, type MaeMfeDocument } from './maeMfeDocument';
import type { MoveState } from './MoveDashboard';

export const SEP = '::';
export const keyOf = (asset: AssetTicker, move: string) => `${asset}${SEP}${move}`;

/** Resolve a 1-based study ordinal to a concrete study id for one move. */
export function studyIdAtOrdinal(ms: MoveState, ordinal: number): string {
  if (ordinal <= 1) return DEFAULT_STUDY;
  const extras = Object.keys(ms.extraStudies ?? {});
  return extras[ordinal - 2] ?? DEFAULT_STUDY; // ordinal 2 → first extra; fall back to default
}

/** Largest study count across every (asset, move) — drives the study selector options. */
export function maxStudyCount(doc: MaeMfeDocument): number {
  let m = 1;
  for (const a of Object.keys(doc) as AssetTicker[]) {
    const state = doc[a];
    for (const mv of Object.keys(state)) {
      m = Math.max(m, 1 + Object.keys(state[mv].extraStudies ?? {}).length);
    }
  }
  return m;
}

/** Build dollar-valued sources from selected (asset,move) keys at a study ordinal + attempt filter. */
export function buildLabSources(
  doc: MaeMfeDocument,
  selected: Set<string>,
  studyOrdinal: number,
  attemptMode: AttemptMode,
): SourceInput[] {
  const out: SourceInput[] = [];
  for (const key of selected) {
    const [asset, move] = key.split(SEP) as [AssetTicker, string];
    const ms = doc[asset]?.[move];
    if (!ms) continue;
    const st = resolveStudy(ms, studyIdAtOrdinal(ms, studyOrdinal));
    const rows = applyAttemptFilter(
      [...st.inSample.rows, ...st.oos1.rows, ...st.oos2.rows, ...st.oos3.rows],
      attemptMode,
    );
    if (rows.length === 0) continue;
    out.push({ ticker: asset, move, minCashflowPct: ms.minCashflowPct, maxMaePct: ms.maxMaePct ?? 0, defaultContracts: ms.defaultContracts, rows });
  }
  return out;
}

export const ATTEMPT_OPTIONS = [
  { v: 'all', label: 'All attempts' },
  { v: 'first:1', label: '1st only' },
  { v: 'first:2', label: 'First 2' },
  { v: 'first:3', label: 'First 3' },
  { v: 'only:2', label: 'Only 2nd' },
  { v: 'only:3', label: 'Only 3rd' },
  { v: 'only:4', label: 'Only 4th' },
] as const;

export function parseAttempt(v: string): AttemptMode {
  if (v === 'all') return { kind: 'all' };
  const [kind, n] = v.split(':');
  return { kind: kind as 'first' | 'only', n: Number(n) };
}

export function attemptValue(mode: AttemptMode): string {
  return mode.kind === 'all' ? 'all' : `${mode.kind}:${mode.n}`;
}
