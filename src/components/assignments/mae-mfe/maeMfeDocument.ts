/**
 * MAE/MFE document model — state shape, reducer, and persistence migration.
 *
 * Kept separate from MaeMfeAnalysisView so the view file only exports a
 * component (react-refresh) and so the pure state logic is unit-testable.
 *
 * Shape: one MaeMfeState per asset (MaeMfeDocument). A MaeMfeState is the
 * per-move config + two sample buckets. Legacy submissions (pre multi-asset)
 * were a bare MaeMfeState keyed by move and are folded under MNQ on hydrate.
 */
import type { GunshipMove, RawRow } from '../../../lib/maeMfeStats';
import { ASSETS, ASSET_ORDER, type AssetTicker } from '../../../lib/assets';
import { BUILTIN_MOVES, DEFAULT_MOVE_ORDER } from '../../../lib/moveRegistry';
import type { MoveState, Study } from './MoveDashboard';

/** The inline buckets are the default study; named studies live in extraStudies. */
export const DEFAULT_STUDY = 'default';

/** One asset's data: per-move config + sample buckets. */
export type MaeMfeState = Record<GunshipMove, MoveState>;

/** The persisted document: one MaeMfeState per asset. */
export type MaeMfeDocument = Record<AssetTicker, MaeMfeState>;

export type SampleKey = 'inSample' | 'oos1' | 'oos2' | 'oos3';
export const OOS_KEYS = ['oos1', 'oos2', 'oos3'] as const;
export type OosKey = (typeof OOS_KEYS)[number];

// `study` selects which study's buckets an op targets (defaults to the inline
// default study when omitted — keeps every existing call site behaving the same).
export type Action =
  | { type: 'PATCH_CONFIG'; asset: AssetTicker; move: GunshipMove; patch: Partial<Pick<MoveState, 'minCashflowPct' | 'defaultContracts' | 'maxMaePct' | 'attemptMode'>>; userSet?: boolean }
  | { type: 'SET_START_DATE'; asset: AssetTicker; move: GunshipMove; study?: string; sample: SampleKey; startDate: string | null }
  | { type: 'ADD_ROW'; asset: AssetTicker; move: GunshipMove; study?: string; sample: SampleKey; tradeDate: string }
  | { type: 'UPDATE_ROW'; asset: AssetTicker; move: GunshipMove; study?: string; sample: SampleKey; rowIndex: number; patch: Partial<RawRow> }
  | { type: 'DELETE_ROW'; asset: AssetTicker; move: GunshipMove; study?: string; sample: SampleKey; rowIndex: number }
  // Study-management — scoped to one (asset, move).
  | { type: 'ADD_STUDY'; asset: AssetTicker; move: GunshipMove; study: string; label: string }
  | { type: 'RENAME_STUDY'; asset: AssetTicker; move: GunshipMove; study: string; label: string }
  | { type: 'DELETE_STUDY'; asset: AssetTicker; move: GunshipMove; study: string }
  // Move-management — document-level: a custom move exists on EVERY asset, like the built-ins.
  | { type: 'ADD_MOVE'; id: string; label: string }
  | { type: 'RENAME_MOVE'; id: string; label: string }
  | { type: 'DELETE_MOVE'; id: string }
  // Merge externally-added data (e.g. CLI collection while the app is open) into
  // missing/empty (asset, move) slots without clobbering local edits.
  | { type: 'MERGE_EXTERNAL'; incoming: Partial<MaeMfeDocument> };

/** Actions scoped to a single asset's MaeMfeState (everything except the
 *  document-level move-management actions). moveReducer only ever sees these. */
type MoveAction = Extract<Action, { asset: AssetTicker }>;

function emptyBucket() {
  return { startDate: null, rows: [] };
}

function emptyStudy(label?: string): Study {
  return {
    inSample: emptyBucket(),
    oos1: emptyBucket(),
    oos2: emptyBucket(),
    oos3: emptyBucket(),
    ...(label != null ? { label } : {}),
  };
}

function emptyMove(label?: string): MoveState {
  return {
    minCashflowPct: 0.1,
    defaultContracts: 5,
    maxMaePct: 0,
    inSample: emptyBucket(),
    oos1: emptyBucket(),
    oos2: emptyBucket(),
    oos3: emptyBucket(),
    ...(label != null ? { label } : {}),
  };
}

/** Resolve a study's four buckets: the inline default, or a named extra study. */
export function resolveStudy(move: MoveState, studyId: string): Study {
  if (studyId === DEFAULT_STUDY) {
    return { inSample: move.inSample, oos1: move.oos1, oos2: move.oos2, oos3: move.oos3 };
  }
  return move.extraStudies?.[studyId] ?? emptyStudy();
}

function normalizeStudy(s: Partial<Study>): Study {
  const base = emptyStudy();
  return {
    inSample: s.inSample ?? base.inSample,
    oos1: s.oos1 ?? base.oos1,
    oos2: s.oos2 ?? base.oos2,
    oos3: s.oos3 ?? base.oos3,
    ...(s.label != null ? { label: s.label } : {}),
  };
}

function normalizeExtraStudies(e: Record<string, Partial<Study>>): Record<string, Study> {
  return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, normalizeStudy(v)]));
}

// Normalize one move to the current shape. Migrates the pre-multi-OOS field
// `outOfSample` → `oos1` (no data loss) and back-fills any missing buckets.
// `label` (custom move) and `extraStudies` (named studies) are preserved when present.
function normalizeMove(m: Partial<MoveState> & { outOfSample?: MoveState['oos1'] }): MoveState {
  const base = emptyMove();
  return {
    minCashflowPct: m.minCashflowPct ?? base.minCashflowPct,
    defaultContracts: m.defaultContracts ?? base.defaultContracts,
    maxMaePct: m.maxMaePct ?? base.maxMaePct,
    inSample: m.inSample ?? base.inSample,
    oos1: m.oos1 ?? m.outOfSample ?? base.oos1,
    oos2: m.oos2 ?? base.oos2,
    oos3: m.oos3 ?? base.oos3,
    ...(m.label != null ? { label: m.label } : {}),
    ...(m.extraStudies ? { extraStudies: normalizeExtraStudies(m.extraStudies) } : {}),
  };
}

// Iterate the UNION of built-in moves (seeded empty by defaultState) and whatever
// keys the stored blob actually has, so a custom user-defined move (Phase 2) is
// preserved across a hydrate round-trip instead of being silently dropped.
function normalizeState(s: Partial<MaeMfeState>): MaeMfeState {
  const out = defaultState();
  for (const move of Object.keys(s)) {
    const incoming = s[move] as (Partial<MoveState> & { outOfSample?: MoveState['oos1'] }) | undefined;
    if (incoming) out[move] = normalizeMove(incoming);
  }
  return out;
}

export function defaultState(): MaeMfeState {
  return Object.fromEntries(DEFAULT_MOVE_ORDER.map((m) => [m, emptyMove()])) as MaeMfeState;
}

export function defaultDocument(): MaeMfeDocument {
  return Object.fromEntries(ASSET_ORDER.map((a) => [a, defaultState()])) as MaeMfeDocument;
}

// A legacy submission (pre multi-asset) is a bare MaeMfeState keyed by move.
export function isLegacyState(s: unknown): s is Partial<MaeMfeState> {
  if (!s || typeof s !== 'object') return false;
  const keys = Object.keys(s);
  return keys.some((k) => (BUILTIN_MOVES as readonly string[]).includes(k))
    && !keys.some((k) => k in ASSETS);
}

/** Build the working document from a persisted blob (handles the legacy shape). */
export function hydrateDocument(
  initial?: Partial<MaeMfeDocument> | Partial<MaeMfeState>,
): MaeMfeDocument {
  const base = defaultDocument();
  if (!initial) return base;
  if (isLegacyState(initial)) {
    // Old MNQ-only data → fold under MNQ (and migrate outOfSample → oos1).
    return { ...base, MNQ: normalizeState(initial as Partial<MaeMfeState>) };
  }
  for (const a of ASSET_ORDER) {
    const incoming = (initial as Partial<MaeMfeDocument>)[a];
    if (incoming) base[a] = normalizeState(incoming);
  }
  return base;
}

export function makeRow(rowIndex: number, contracts: number, tradeDate: string): RawRow {
  return { rowIndex, tradeDate, maePct: 0, mfePct: 0, contracts, refPrice: null };
}

// Read a study's bucket (inline default study, or a named extra study).
function getBucket(move: MoveState, study: string, sample: SampleKey) {
  return resolveStudy(move, study)[sample];
}

// Return a new MoveState with one study's bucket replaced — routing to the
// inline default study or into the extraStudies overlay.
function setBucket(move: MoveState, study: string, sample: SampleKey, bucket: MoveState['inSample']): MoveState {
  if (study === DEFAULT_STUDY) return { ...move, [sample]: bucket };
  const studies = move.extraStudies ?? {};
  const current = studies[study] ?? emptyStudy();
  return { ...move, extraStudies: { ...studies, [study]: { ...current, [sample]: bucket } } };
}

// Bulk-set every row's contract count across a move (all buckets + all studies).
// `defaultContracts` is the move-level master, so changing it propagates to all
// existing trades (a row's baked-in contracts would otherwise shadow the change).
function applyContractsToMove(move: MoveState, contracts: number): MoveState {
  const setRows = (b: MoveState['inSample']) => ({ ...b, rows: b.rows.map((r) => ({ ...r, contracts })) });
  const study = <T extends { inSample: MoveState['inSample']; oos1: MoveState['inSample']; oos2: MoveState['inSample']; oos3: MoveState['inSample'] }>(s: T): T => ({
    ...s, inSample: setRows(s.inSample), oos1: setRows(s.oos1), oos2: setRows(s.oos2), oos3: setRows(s.oos3),
  });
  const base = study(move);
  if (!move.extraStudies) return base;
  return {
    ...base,
    extraStudies: Object.fromEntries(Object.entries(move.extraStudies).map(([k, s]) => [k, study(s)])),
  };
}

// Operates on ONE asset's MaeMfeState. The asset layer is handled by
// documentReducer, so this stays a simple per-move reducer.
function moveReducer(state: MaeMfeState, action: MoveAction): MaeMfeState {
  const move = state[action.move];
  switch (action.type) {
    case 'PATCH_CONFIG': {
      // Config is shared across a move's studies (lives at the move level).
      let next = { ...move, ...action.patch };
      // userSet marks a move as explicitly picked/edited by the user, so the
      // auto-default-to-safest leaves it alone (only auto-default sets no flag).
      if (action.userSet) next = { ...next, userSet: true };
      // Changing the contract count propagates to every existing trade.
      if (action.patch.defaultContracts != null) {
        next = applyContractsToMove(next, action.patch.defaultContracts);
      }
      return { ...state, [action.move]: next };
    }
    case 'SET_START_DATE': {
      const study = action.study ?? DEFAULT_STUDY;
      const bucket = getBucket(move, study, action.sample);
      return { ...state, [action.move]: setBucket(move, study, action.sample, { ...bucket, startDate: action.startDate }) };
    }
    case 'ADD_ROW': {
      const study = action.study ?? DEFAULT_STUDY;
      const bucket = getBucket(move, study, action.sample);
      const nextIndex = bucket.rows.length === 0 ? 1 : bucket.rows[bucket.rows.length - 1].rowIndex + 1;
      const rows = [...bucket.rows, makeRow(nextIndex, move.defaultContracts, action.tradeDate)];
      return { ...state, [action.move]: setBucket(move, study, action.sample, { ...bucket, rows }) };
    }
    case 'UPDATE_ROW': {
      const study = action.study ?? DEFAULT_STUDY;
      const bucket = getBucket(move, study, action.sample);
      const rows = bucket.rows.map((r) => (r.rowIndex === action.rowIndex ? { ...r, ...action.patch } : r));
      return { ...state, [action.move]: setBucket(move, study, action.sample, { ...bucket, rows }) };
    }
    case 'DELETE_ROW': {
      const study = action.study ?? DEFAULT_STUDY;
      const bucket = getBucket(move, study, action.sample);
      const rows = bucket.rows.filter((r) => r.rowIndex !== action.rowIndex);
      return { ...state, [action.move]: setBucket(move, study, action.sample, { ...bucket, rows }) };
    }
    case 'ADD_STUDY': {
      if (action.study === DEFAULT_STUDY || move.extraStudies?.[action.study]) return state; // don't clobber
      const extraStudies = { ...(move.extraStudies ?? {}), [action.study]: emptyStudy(action.label) };
      return { ...state, [action.move]: { ...move, extraStudies } };
    }
    case 'RENAME_STUDY': {
      const existing = move.extraStudies?.[action.study];
      if (!existing) return state;
      const extraStudies = { ...move.extraStudies, [action.study]: { ...existing, label: action.label } };
      return { ...state, [action.move]: { ...move, extraStudies } };
    }
    case 'DELETE_STUDY': {
      if (action.study === DEFAULT_STUDY || !move.extraStudies?.[action.study]) return state;
      const extraStudies = { ...move.extraStudies };
      delete extraStudies[action.study];
      return { ...state, [action.move]: { ...move, extraStudies } };
    }
    default:
      return state;
  }
}

/** A stable, collision-safe id for a new custom move. */
export function makeMoveId(): string {
  return `mv_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** A stable, collision-safe id for a new study. */
export function makeStudyId(): string {
  return `st_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** Routes each action. Move-management actions touch every asset; the rest are
 *  scoped to a single asset's MaeMfeState. */
/** True if a move has any rows in any bucket. */
function moveHasData(ms: MoveState | undefined): boolean {
  if (!ms) return false;
  return (['inSample', 'oos1', 'oos2', 'oos3'] as const).some((k) => (ms[k]?.rows?.length ?? 0) > 0);
}

/**
 * Additively merge `incoming` (e.g. the server doc) into `local`: for any
 * (asset, move) that has data in `incoming` but is missing or EMPTY locally,
 * take the incoming move. Never overwrites a local move that already has data,
 * so in-flight local edits are preserved. Returns the same reference when
 * nothing changed, so React/​useReducer can bail out of re-rendering.
 */
export function mergeExternalMoves(local: MaeMfeDocument, incoming: Partial<MaeMfeDocument>): MaeMfeDocument {
  let changed = false;
  const next = {} as MaeMfeDocument;
  for (const a of ASSET_ORDER) {
    const loc = local[a] ?? ({} as MaeMfeState);
    const inc = (incoming[a] ?? {}) as MaeMfeState;
    let merged = loc;
    for (const move of Object.keys(inc)) {
      if (!moveHasData(inc[move])) continue;
      if (!moveHasData(loc[move])) {
        if (merged === loc) merged = { ...loc };
        merged[move] = inc[move];
        changed = true;
      }
    }
    next[a] = merged;
  }
  return changed ? next : local;
}

export function documentReducer(doc: MaeMfeDocument, action: Action): MaeMfeDocument {
  switch (action.type) {
    case 'MERGE_EXTERNAL':
      return mergeExternalMoves(doc, action.incoming);
    case 'ADD_MOVE': {
      // Add the custom move to every asset (built-ins exist everywhere; mirror that).
      const next = {} as MaeMfeDocument;
      for (const a of ASSET_ORDER) {
        next[a] = a in doc && action.id in doc[a]
          ? doc[a] // already present — don't clobber existing data
          : { ...doc[a], [action.id]: emptyMove(action.label) };
      }
      return next;
    }
    case 'RENAME_MOVE': {
      const next = {} as MaeMfeDocument;
      for (const a of ASSET_ORDER) {
        const ms = doc[a]?.[action.id];
        next[a] = ms ? { ...doc[a], [action.id]: { ...ms, label: action.label } } : doc[a];
      }
      return next;
    }
    case 'DELETE_MOVE': {
      // Never delete a built-in move.
      if ((BUILTIN_MOVES as readonly string[]).includes(action.id)) return doc;
      const next = {} as MaeMfeDocument;
      for (const a of ASSET_ORDER) {
        const copy = { ...doc[a] };
        delete copy[action.id];
        next[a] = copy;
      }
      return next;
    }
    default:
      return { ...doc, [action.asset]: moveReducer(doc[action.asset], action) };
  }
}
