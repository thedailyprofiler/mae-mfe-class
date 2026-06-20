/**
 * Persistence for the dashboard document.
 *
 * Tries the SQLite backend (server/index.mjs) first; if it's unreachable —
 * e.g. you ran `npm run dev` without the server — it transparently falls back
 * to localStorage, so the app always works. Every save also mirrors to
 * localStorage as a durability safeguard.
 */
import type { MaeMfeDocument } from './components/assignments/mae-mfe/MaeMfeAnalysisView';
import { mergeExternalMoves } from './components/assignments/mae-mfe/maeMfeDocument';

const API = '/api/doc';
const LS_KEY = 'mae-mfe-dashboard:doc:v1';
const PROFILE = 'default';
const SAVE_DEBOUNCE_MS = 600;

export type Backend = 'sqlite' | 'localStorage';

/** Where the last load came from — surfaced in the UI so it's never a mystery. */
export let activeBackend: Backend = 'localStorage';

function readLocal(): Partial<MaeMfeDocument> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Partial<MaeMfeDocument>) : null;
  } catch {
    return null;
  }
}

function writeLocal(doc: MaeMfeDocument): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(doc));
  } catch {
    // storage full / unavailable — non-fatal
  }
}

/** Load the saved document. Returns null if nothing has been saved yet. */
export async function loadDoc(): Promise<Partial<MaeMfeDocument> | null> {
  try {
    const res = await fetch(`${API}?profile=${PROFILE}`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const json = (await res.json()) as { doc: Partial<MaeMfeDocument> | null };
      activeBackend = 'sqlite';
      return json.doc ?? null;
    }
  } catch {
    // backend down — fall through to localStorage
  }
  activeBackend = 'localStorage';
  return readLocal();
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Debounced save. Mirrors to localStorage immediately, then writes to SQLite.
 * MERGE-ON-SAVE GUARD: before the PUT, re-read the server doc and additively
 * merge in any (asset, move) it has that this client doesn't — so a stale tab
 * (e.g. one open during CLI collection) can never clobber externally-added
 * moves. Additive only; intentional deletes still propagate for moves the client
 * knows about (mergeExternalMoves only fills missing/empty slots).
 */
export function saveDoc(doc: MaeMfeDocument): void {
  writeLocal(doc);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    let toSave = doc;
    try {
      const res = await fetch(`${API}?profile=${PROFILE}`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const json = (await res.json()) as { doc: MaeMfeDocument | null };
        if (json.doc) toSave = mergeExternalMoves(doc, json.doc);
      }
    } catch {
      // backend unreachable — fall through and PUT what we have
    }
    fetch(`${API}?profile=${PROFILE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: toSave }),
    })
      .then(() => { activeBackend = 'sqlite'; writeLocal(toSave); })
      .catch(() => { activeBackend = 'localStorage'; });
  }, SAVE_DEBOUNCE_MS);
}

/** Wipe the saved document from both backends. */
export async function clearDoc(): Promise<void> {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  try {
    await fetch(`${API}?profile=${PROFILE}`, { method: 'DELETE', signal: AbortSignal.timeout(2000) });
  } catch {
    /* backend down — localStorage already cleared */
  }
}
