/**
 * Plain-language per-step guides shown in a collapsible "📖 Guide" inside each
 * step of the 5-step flow. Written for someone who's never seen MAE/MFE — kept
 * short; the full walkthrough lives in docs/walkthrough-transcript.md and the
 * glossary in the ? Help panel.
 */
export const STEP_GUIDES: Record<number, { what: string; how: string[] }> = {
  1: {
    what: 'Choose the setup you want to study. A "move" is just a time-of-day breakout (1800, 0300, Market Open, Lunch Break).',
    how: [
      'Watch the short clip to see how the move is drawn on the chart.',
      'You record two numbers per trade: MAE (worst it went against you = risk) and MFE (best it went for you = reward).',
      'Everything else in the dashboard is built from those two numbers.',
    ],
  },
  2: {
    what: 'Build your plan: who you are (Account Profile), what you trade (asset + move), and your risk (target + stop + size).',
    how: [
      'Set the Account Profile once (Prop eval or Live) — it drives every recommendation.',
      '① pick an asset → ② pick a move → ③ set your risk.',
      '③ has two halves: "Let us select your risk" (recommendation cards — click Apply) or "You set your risk" (type it yourself; the bar shows your pass odds live).',
      'Min Cashflow = your take-profit target. Max MAE = your stop (off = take the full loss). Change either and the whole dashboard re-computes.',
      'DOW filter: slice the stats to just the weekday(s) you trade. By Day of Week (under the strike rates) shows how each weekday performs.',
      'By Vol Regime (under the analytics): see how the move performs when volatility is Expanding vs Contracting (or Contango vs Backwardation) — the start of building a per-regime risk profile. Win rates carry a confidence range and a shrunk estimate; "thin" buckets (<30 trades) are directional only.',
      'Any move you don\'t touch is auto-set to its own safest config.',
    ],
  },
  3: {
    what: 'Stress-test the plan so it survives the worst case before you risk money.',
    how: [
      'Prop Sim: will this pass a prop eval before the drawdown busts it? Pass / bust / days-to-pass / expected $. Pick your firm (Apex, Topstep, TPT, Lucid, Alpha Futures, Tradeify) and it loads that firm\'s rules + eval cost.',
      'Doomsday Budget (in Prop Sim): your worst losing streak × risk = the hole you must survive; it gives the capital, account rotation, and the size that survives it. Works for a single move AND for a whole basket you sent in (then it counts worst DOWN-DAYS in a row).',
      'Monte Carlo: replays your trades thousands of times to show the realistic range — "did I just get lucky?"',
      'Compare / Cycle: pit setups against each other and rotate trades across prop accounts so no one account eats a whole streak.',
      'Best-moves-to-flip & ROI cards: which move + size passes fastest / cheapest / best return per $ spent.',
      'Send→ on every card: take any recommendation and load it straight into Compare, Cycle, Monte Carlo, Prop Sim, or Portfolio. The page you land on shows a "✓ Loaded here from: …" banner so you always know what you sent and where it came from.',
    ],
  },
  4: {
    what: 'Combine setups that don\'t all lose on the same day — a smoother combined equity curve.',
    how: [
      'Correlation: green pairs diversify (good), red pairs move together (stacking risk). It flags the most redundant pair, the best diversifier to add, and the pair that crashes together. Dim cells = not enough data to trust.',
      'Grand Recommendation: per risk appetite, a basket of complementary moves run through the simulator together — with a $ equity curve, your bust line, and a Day-14 marker.',
      'Click a Grand card to chart it; Apply loads it into the builder. Send→ ships the same basket into Compare / Cycle / Monte Carlo / Prop Sim if you want to stress it there.',
    ],
  },
  5: {
    what: 'Export your validated move + risk template to your live algo.',
    how: ['Coming soon — once your plan passes Steps 2–4, this will hand it off to your trading bot.'],
  },
};
