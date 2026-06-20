/**
 * InfoTip — a small ⓘ affordance with an accessible tooltip.
 *
 * Renders the bubble through a portal with position:fixed so it never clips
 * inside the dashboard's overflow-hidden panels. Opens on hover/focus (and tap),
 * closes on leave/blur/Escape/scroll. Content comes from helpContent by `id`,
 * or pass `term`/`body` directly.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HELP } from './helpContent';

interface InfoTipProps {
  id?: string;
  term?: string;
  body?: string;
  className?: string;
}

const TIP_WIDTH = 264;

export function InfoTip({ id, term, body, className }: InfoTipProps) {
  const entry = id ? HELP[id] : undefined;
  const title = term ?? entry?.term;
  const text = body ?? entry?.body ?? '';
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const tipId = useId();

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = r.left + r.width / 2 - TIP_WIDTH / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - TIP_WIDTH - 8));
    setPos({ left, top: r.top - 8 });
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onMove = () => setOpen(false);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  if (!text) return null;

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={title ? `Help: ${title}` : 'Help'}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === 'Escape') hide();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) hide();
          else show();
        }}
        data-testid={id ? `mae-mfe-info-${id}` : undefined}
        className={[
          'inline-flex items-center justify-center w-[14px] h-[14px] rounded-full border border-[var(--color-border)] font-[var(--font-mono)] text-[9px] font-semibold leading-none text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent-dim)] transition-colors align-middle cursor-help',
          className ?? '',
        ].join(' ')}
      >
        i
      </button>
      {open && pos
        && createPortal(
          <div
            id={tipId}
            role="tooltip"
            style={{ position: 'fixed', left: pos.left, top: pos.top, width: TIP_WIDTH, transform: 'translateY(-100%)', zIndex: 9999 }}
            className="pointer-events-none rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-xl px-3 py-2"
          >
            {title && (
              <div className="text-[10px] font-[var(--font-mono)] font-semibold uppercase tracking-[0.1em] text-[var(--color-accent)] mb-1">
                {title}
              </div>
            )}
            <div className="text-[11px] leading-snug text-[var(--color-text-secondary)]">{text}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
