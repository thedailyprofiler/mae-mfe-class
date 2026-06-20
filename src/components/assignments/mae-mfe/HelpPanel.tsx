/**
 * HelpPanel — a "? Help" toggle that opens a glossary dropdown explaining every
 * term/section/control. Shares its content with the inline ⓘ tooltips via
 * helpContent, so the two never disagree. Portal + position:fixed so it floats
 * above everything; closes on backdrop click or Escape.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HELP_GROUPS } from './helpContent';

const PANEL_WIDTH = 360;

export function HelpPanel() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 8));
    setPos({ left, top: r.bottom + 6 });
    setOpen((o) => !o);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="mae-mfe-help-toggle"
        className={[
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] border font-[var(--font-mono)] text-[11px] uppercase tracking-[0.12em] transition-colors',
          open
            ? 'border-[var(--color-accent-dim)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
            : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
        ].join(' ')}
      >
        <span className="inline-flex items-center justify-center w-[14px] h-[14px] rounded-full border border-current text-[9px] font-semibold leading-none">?</span>
        Help
      </button>
      {open && pos
        && createPortal(
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9998 }} />
            <div
              role="dialog"
              aria-label="MAE/MFE help glossary"
              data-testid="mae-mfe-help-panel"
              style={{ position: 'fixed', left: pos.left, top: pos.top, width: PANEL_WIDTH, maxHeight: '72vh', zIndex: 9999 }}
              className="overflow-y-auto rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-2xl p-4"
            >
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="font-[var(--font-serif)] text-base font-semibold text-[var(--color-text-primary)]">How to read this dashboard</h3>
                <button type="button" onClick={() => setOpen(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] text-[14px] leading-none">×</button>
              </div>
              {HELP_GROUPS.map((g) => (
                <div key={g.title} className="mb-4 last:mb-0">
                  <div className="text-[9px] font-[var(--font-mono)] uppercase tracking-[0.16em] text-[var(--color-accent)] mb-1.5">{g.title}</div>
                  <div className="space-y-2">
                    {g.items.map((it) => (
                      <div key={it.id}>
                        <div className="text-[11px] font-[var(--font-mono)] font-semibold text-[var(--color-text-primary)]">{it.term}</div>
                        <div className="text-[11px] leading-snug text-[var(--color-text-muted)]">{it.body}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
