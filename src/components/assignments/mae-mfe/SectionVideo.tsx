/**
 * SectionVideo — a small "▶ Watch" button that pops a "how to use this section"
 * deep-dive video in a modal. Lazy by design: the (large) .mp4 only loads when
 * the modal opens, never on page render. Captions come from a WebVTT track
 * (converted from the source .srt).
 *
 * Add a new deep-dive in ONE place — the DEEP_DIVES registry below — then drop
 * a <VideoButton slug="…" /> next to the section it explains (or pass a
 * `video` slug to <SectionLabel>).
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DeepDive {
  title: string;
  src: string;   // /videos/deepdives/<file>.mp4  (gitignored; shipped by the build)
  vtt: string;   // /videos/deepdives/<file>.vtt  (captions)
  blurb?: string;
}

export const DEEP_DIVES = {
  'stop-target-entry': {
    title: 'Your stop, target & is-it-worth-it (the 3 stat tables)',
    src: '/videos/deepdives/01-stop-target-entry.mp4',
    vtt: '/videos/deepdives/01-stop-target-entry.vtt',
    blurb: 'How Risk·MAE sets your stop, Profit·MFE sets your target, and Cashflow EVs tells you whether the trade is worth taking.',
  },
  'strike-rates': {
    title: 'MFE Strike Rates — pick a target you’ll actually hit',
    src: '/videos/deepdives/02-strike-rates.mp4',
    vtt: '/videos/deepdives/02-strike-rates.vtt',
    blurb: 'Read the probability map: bigger targets pay more but fill less often. Find the row that hits on most trades and still pays.',
  },
  'mae-mfe-basics': {
    title: 'MAE & MFE — the only two numbers you need',
    src: '/videos/deepdives/03-mae-mfe-basics.mp4',
    vtt: '/videos/deepdives/03-mae-mfe-basics.vtt',
    blurb: 'Every trade travels against you (MAE = risk) and in your favor (MFE = reward). Stored as percent so every instrument is comparable.',
  },
  'sync-rule': {
    title: 'The one rule it all runs on — Min Cashflow & Max MAE',
    src: '/videos/deepdives/04-sync-rule.mp4',
    vtt: '/videos/deepdives/04-sync-rule.vtt',
    blurb: 'Min Cashflow is your win target; Max MAE is your stop. Set these two and every chart, table, and recommendation recomputes around them.',
  },
} as const satisfies Record<string, DeepDive>;

export type DeepDiveSlug = keyof typeof DEEP_DIVES;

function VideoModal({ dive, onClose }: { dive: DeepDive; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return createPortal(
    <div onClick={onClose} role="dialog" aria-modal="true" aria-label={dive.title}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-4">
      <div onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[920px] bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-[10px] overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)]">
          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">▶ {dive.title}</span>
          <button type="button" onClick={onClose} title="Close (Esc)"
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-[15px] leading-none px-1">✕</button>
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption — caption track IS provided below */}
        <video controls autoPlay preload="metadata" className="w-full max-h-[70vh] bg-black">
          <source src={dive.src} type="video/mp4" />
          <track kind="captions" srcLang="en" label="English" src={dive.vtt} default />
        </video>
        {dive.blurb && (
          <p className="px-4 py-2.5 text-[11px] text-[var(--color-text-secondary)] leading-relaxed">{dive.blurb}</p>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** "▶ Watch" pill that opens the deep-dive for `slug` in a modal. Self-contained. */
export function VideoButton({ slug, label = 'Watch' }: { slug: DeepDiveSlug; label?: string }) {
  const [open, setOpen] = useState(false);
  const dive = DEEP_DIVES[slug];
  return (
    <>
      <button type="button" title={`How to use: ${dive.title}`}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] border border-[var(--color-accent)]/60 text-[var(--color-accent)] text-[9px] font-[var(--font-mono)] uppercase tracking-[0.1em] hover:bg-[var(--color-accent)]/10 transition-colors">
        ▶ {label}
      </button>
      {open && <VideoModal dive={dive} onClose={() => setOpen(false)} />}
    </>
  );
}
