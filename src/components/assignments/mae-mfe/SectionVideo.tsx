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
  'samples-studies': {
    title: 'In Sample / Out of Sample / All / Compare — don’t fool yourself',
    src: '/videos/deepdives/05-samples-studies.mp4',
    vtt: '/videos/deepdives/05-samples-studies.vtt',
    blurb: 'In-Sample is your lab where you found the edge; Out-of-Sample is the unseen data that proves it’s real. Compare pits them side by side so you don’t bet on a curve-fit.',
  },
  'headline-metrics': {
    title: 'The headline metrics — Total PNL, Win Rate, Streaks & Span',
    src: '/videos/deepdives/06-headline-metrics.mp4',
    vtt: '/videos/deepdives/06-headline-metrics.vtt',
    blurb: 'The top ticker at a glance: total P&L, sample count, win rate, average win streak, worst loss streak, and the time span the data covers.',
  },
  'mae-risk-ladder': {
    title: 'MAE Risk Ladder — where your stop costs you trades',
    src: '/videos/deepdives/07-mae-risk-ladder.mp4',
    vtt: '/videos/deepdives/07-mae-risk-ladder.vtt',
    blurb: 'Each row is a stop level: how many trades it would have stopped out, the rate, and the dollar exposure — so you can see the price of a tighter stop.',
  },
  'ev-risk-matrix': {
    title: 'EV Risk Matrix — the best target × stop combo, in dollars',
    src: '/videos/deepdives/08-ev-risk-matrix.mp4',
    vtt: '/videos/deepdives/08-ev-risk-matrix.vtt',
    blurb: 'Every target (MFE) crossed with every stop (Max MAE), each cell the expected $ per trade = strike×win$ − loss×loss$. Green is positive EV; find the brightest cell.',
  },
  'contract-dollar': {
    title: 'Contract $ / Move — what each % is worth in real money',
    src: '/videos/deepdives/09-contract-dollar.mp4',
    vtt: '/videos/deepdives/09-contract-dollar.vtt',
    blurb: 'Turns each MAE/MFE percent into dollars at your contract size: the loss $ if it goes against you and the win $ if it goes your way, row by row.',
  },
  'compare-combine': {
    title: 'Compare & Combine — Set A vs Set B, netted in dollars',
    src: '/videos/deepdives/10-compare-combine.mp4',
    vtt: '/videos/deepdives/10-compare-combine.vtt',
    blurb: 'Put one basket of moves/assets against another and net them per day in dollars — is A or B better, and what happens if you trade both together?',
  },
  'account-cycling': {
    title: 'Account Portfolio Cycling — rotate trades across prop accounts',
    src: '/videos/deepdives/11-account-cycling.mp4',
    vtt: '/videos/deepdives/11-account-cycling.vtt',
    blurb: 'Spread the trade stream across several prop accounts so no single account eats a whole losing streak — the “sick account” takes the hits while the others bank wins.',
  },
  'correlation': {
    title: 'Portfolio Correlation — which setups actually diversify',
    src: '/videos/deepdives/12-correlation.mp4',
    vtt: '/videos/deepdives/12-correlation.vtt',
    blurb: 'Green pairs are independent (they smooth each other); red pairs win and lose together (stacking risk). It flags the most redundant pair, the best diversifier, and the tail-risk pair that crashes together.',
  },
  'monte-carlo': {
    title: 'Monte Carlo — “did I just get lucky?”',
    src: '/videos/deepdives/13-monte-carlo.mp4',
    vtt: '/videos/deepdives/13-monte-carlo.vtt',
    blurb: 'Your backtest is one path the market happened to take. Monte Carlo replays it thousands of times to show the realistic range of outcomes and how deep the drawdown could get. Resample = keep trading the edge; Shuffle = ordering luck.',
  },
  'setup-fastest': {
    title: 'Recommended setup — ⚡ Fastest Growth',
    src: '/videos/deepdives/15a-fastest-growth.mp4',
    vtt: '/videos/deepdives/15a-fastest-growth.vtt',
    blurb: 'The highest-edge configuration: bigger size and a target that pushes growth hardest, accepting deeper swings. The aggressive end of the recommendation set.',
  },
  'setup-safest': {
    title: 'Recommended setup — 🛡 Safest',
    src: '/videos/deepdives/15b-safest.mp4',
    vtt: '/videos/deepdives/15b-safest.vtt',
    blurb: 'The lowest-risk configuration: smaller size and a high-strike target for the smoothest equity and the shallowest drawdown. The conservative end of the set.',
  },
  'setup-best': {
    title: 'Recommended setup — 🏆 Best Overall',
    src: '/videos/deepdives/15c-best-overall.mp4',
    vtt: '/videos/deepdives/15c-best-overall.vtt',
    blurb: 'The best risk-adjusted blend — the configuration with the strongest expected outcome relative to its drawdown. The balanced pick most traders should start from.',
  },
  'setup-professional': {
    title: 'Recommended setup — 🏛 Professionally',
    src: '/videos/deepdives/15d-professionally.mp4',
    vtt: '/videos/deepdives/15d-professionally.vtt',
    blurb: 'How a desk would size it — volatility-targeted under a drawdown cap, the institutionally disciplined configuration that prioritizes surviving the worst case.',
  },
  'portfolio-grand': {
    title: 'Grand Recommendation — your whole plan per appetite',
    src: '/videos/deepdives/16-portfolio-grand.mp4',
    vtt: '/videos/deepdives/16-portfolio-grand.vtt',
    blurb: 'The capstone: a correlation-aware basket of complementary moves (each at its own risk) run through the prop-sim together — pass/bust, Sharpe, drawdown, diversification, and a $ equity curve with your bust line and a Day-14 marker.',
  },
  'doomsday-budget': {
    title: 'Doomsday Budget — survive the worst streak, the rest is gravy',
    src: '/videos/deepdives/17-doomsday-budget.mp4',
    vtt: '/videos/deepdives/17-doomsday-budget.vtt',
    blurb: 'Your worst losing streak (history + Monte-Carlo P95) × risk per trade = the hole you must survive. It gives the capital, the account rotation, the scaling ladder, and the position size that survives it.',
  },
  'propsim-setup': {
    title: 'Prop Sim setup — firm preset, account size, eval cost & split',
    src: '/videos/deepdives/14a-propsim-setup.mp4',
    vtt: '/videos/deepdives/14a-propsim-setup.vtt',
    blurb: 'Pick your firm (Apex, Topstep, TPT, Lucid, Alpha Futures, Tradeify) to load its rules, set account size, eval cost, and profit split — so every result is net of what you pay the firm.',
  },
  'propsim-best-moves': {
    title: 'Best moves to flip — fastest, most reliable, best EV',
    src: '/videos/deepdives/14b-propsim-best-moves.mp4',
    vtt: '/videos/deepdives/14b-propsim-best-moves.vtt',
    blurb: 'Scans every move at your eval rules and ranks them: Fastest Flip, Highest Pass %, Best EV per account, and most Consistent — each sized at its own tuned target/stop.',
  },
  'propsim-best-roi': {
    title: 'Best ROI to flip — net payouts vs $ spent on props',
    src: '/videos/deepdives/14c-propsim-best-roi.mp4',
    vtt: '/videos/deepdives/14c-propsim-best-roi.vtt',
    blurb: 'The full eval→funded→payout lifecycle, net of eval + reset spend: Best ROI per $, Fastest Payout, and Cheapest to profit.',
  },
  'propsim': {
    title: 'Prop Simulator — will this pass an eval before it busts?',
    src: '/videos/deepdives/14-prop-simulator.mp4',
    vtt: '/videos/deepdives/14-prop-simulator.vtt',
    blurb: 'The full prop-flipping cockpit: simulate an evaluation thousands of times to see pass rate, bust rate, days to pass, and expected $ — for one move or a whole basket.',
  },
  'propsim-best-basket': {
    title: 'Best basket to flip — which moves to run together',
    src: '/videos/deepdives/14d-propsim-best-basket.mp4',
    vtt: '/videos/deepdives/14d-propsim-best-basket.vtt',
    blurb: 'Which MULTIPLE moves to run together — combining stacks trades per day so you pass faster and smoother: Best ROI, Fastest Payout, and Cheapest baskets.',
  },
  'propsim-results': {
    title: 'Prop Sim results — pass / bust / days / expected $',
    src: '/videos/deepdives/14e-propsim-results.mp4',
    vtt: '/videos/deepdives/14e-propsim-results.vtt',
    blurb: 'The simulation read-out: pass rate, bust rate (and what busts you), still-active %, median days to pass with its range, and expected ending balance with its P5–P95 spread.',
  },
  'rotation-ladder': {
    title: 'Rotation & scaling ladder — how many props, how much bank',
    src: '/videos/deepdives/17a-rotation-ladder.mp4',
    vtt: '/videos/deepdives/17a-rotation-ladder.vtt',
    blurb: 'For each number of props: the bank needed (keep ~2× the per-account doomsday per prop) and the losing streak that many accounts survive — add a prop above the line, drop below it.',
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
        {/* No autoPlay: browsers mute autoplay, so the user pressing play guarantees sound. */}
        <video controls preload="metadata" className="w-full max-h-[70vh] bg-black">
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
