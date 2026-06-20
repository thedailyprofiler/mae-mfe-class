/**
 * MAE / MFE Analysis Dashboard — standalone app.
 *
 * This is the exact dashboard from the trading bootcamp, extracted to run on
 * its own with no auth. Persistence goes through ./storage, which uses the
 * lightweight SQLite backend (server/index.mjs) when it's running and falls
 * back to localStorage otherwise — so it always works.
 *
 * Loads empty: no seeded data. Add your own moves/trades and they autosave;
 * "Clear data" wipes everything back to empty.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  MaeMfeAnalysisView,
  type MaeMfeDocument,
  type MaeMfeState,
} from './components/assignments/mae-mfe/MaeMfeAnalysisView';
import { loadDoc, saveDoc, clearDoc, activeBackend, type Backend } from './storage';

type Loaded = {
  initialState: Partial<MaeMfeDocument> | Partial<MaeMfeState>;
  backend: Backend;
};

export default function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadDoc().then((saved) => {
      if (cancelled) return;
      // Empty object when nothing is saved → dashboard hydrates to an empty,
      // ready-to-fill state (no seeded sample data).
      setLoaded({ initialState: saved ?? {}, backend: activeBackend });
    });
    return () => { cancelled = true; };
  }, []);

  const handleChange = useCallback((doc: MaeMfeDocument) => {
    saveDoc(doc);
  }, []);

  const reset = useCallback(async () => {
    const ok = window.confirm(
      'Are you sure you want to wipe the whole database?\n\nThis permanently deletes all saved moves, studies, and trades. This cannot be undone.',
    );
    if (!ok) return;
    await clearDoc();
    location.reload();
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-text-primary)] tracking-tight">
              MAE / MFE Analysis
            </h1>
            <p className="section-label mt-1">
              Maximum Adverse / Favorable Excursion · Trade Metrics Lab
            </p>
          </div>
          <div className="flex items-center gap-3">
            {loaded && (
              <span
                className="badge badge-muted"
                title={
                  loaded.backend === 'sqlite'
                    ? 'Saving to SQLite (server/data/mae-mfe.db)'
                    : 'Backend not running — saving to browser localStorage'
                }
              >
                {loaded.backend === 'sqlite' ? 'SQLite' : 'Local'}
              </span>
            )}
            <button type="button" className="btn btn-secondary" onClick={reset}>
              Clear data
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {loaded ? (
          <MaeMfeAnalysisView initialState={loaded.initialState} onChange={handleChange} />
        ) : (
          <div className="text-[var(--color-text-muted)] py-20 text-center">Loading…</div>
        )}
      </main>
    </div>
  );
}
