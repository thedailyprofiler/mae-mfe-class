/**
 * Single source of truth for MAE/MFE contextual help — used by both the inline
 * ⓘ tooltips (InfoTip) and the Help glossary panel (HelpPanel), so wording never
 * drifts between the two. Grounded in the engine semantics (maeMfeStats.ts,
 * maeMfeCombine.ts) — keep definitions accurate if the math changes.
 */
export interface HelpItem {
  /** stable key used by <InfoTip id="…" /> */
  id: string;
  term: string;
  body: string;
}
export interface HelpGroup {
  title: string;
  items: HelpItem[];
}

export const HELP_GROUPS: HelpGroup[] = [
  {
    title: 'Core concepts',
    items: [
      { id: 'mae', term: 'MAE — Max Adverse Excursion', body: 'The worst the trade went AGAINST you (in %) before it resolved. Your risk / heat. Stored as a percent: 0.10 = 0.10%.' },
      { id: 'mfe', term: 'MFE — Max Favorable Excursion', body: 'The best the trade moved IN YOUR FAVOR (in %) before it resolved. Your profit potential. 0.30 = 0.30%.' },
      { id: 'move', term: 'Move', body: 'A trade setup tied to a time of day — built-ins 1800, 0300, Market Open, Lunch Break — or any custom move you add. Each asset carries the same moves.' },
      { id: 'study', term: 'Study', body: 'One independent in-sample / out-of-sample analysis (its own four buckets). Keep several per asset+move to test different periods or rule tweaks side by side.' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { id: 'contracts', term: 'Contracts', body: 'Position size for the move. Changing it updates the $ value of every existing trade. $ scales linearly with contracts.' },
      { id: 'minCashflow', term: 'Min Cashflow %', body: 'The MFE target you would bank as a win. A trade counts as a WIN when its MFE ≥ this value; it drives the win/loss flag, total P&L, and the Compare deltas.' },
      { id: 'maxMae', term: 'Max MAE %', body: 'Your stop. It never cancels a win — a trade whose MFE hit Min Cashflow stays a win (the target was reached before invalidation). It only protects LOSERS: a losing trade whose MAE exceeds this value has its loss capped here, so you can never lose more than Max MAE. 0 = no stop. Affects total P&L and the Compare deltas.' },
      { id: 'attempts', term: 'Attempts / Day', body: 'Which same-day re-entries to count: All, 1st only, First N (took N entries that day), or Only the Nth (e.g. just the 2nd attempt). A view lens — it never deletes rows.' },
      { id: 'dow', term: 'DOW (day of week)', body: 'Keep only the selected weekday(s) — e.g. just Mondays, or Tue+Thu. No selection = all days. A view lens that never deletes rows: every stat, the trade log, and the By-Day-of-Week breakdown update to the chosen days. Press “clear” to reset.' },
      { id: 'inSampleStart', term: 'In-Sample Start', body: 'The first trade date of the in-sample window. Trades auto-step along the move’s trading calendar from here.' },
    ],
  },
  {
    title: 'Samples & views',
    items: [
      { id: 'inSample', term: 'In Sample (IS)', body: 'Your original study window — the data you build the edge on.' },
      { id: 'outOfSample', term: 'Out of Sample (OOS 1/2/3)', body: 'Later, untouched windows used to check the edge still holds out of sample. Three independent OOS windows per study.' },
      { id: 'all', term: 'All', body: 'Combined analytics over the buckets you toggle on (IS + any OOS) — one pooled dataset.' },
      { id: 'compareTab', term: 'Compare (tab)', body: 'In-sample vs a chosen target (an OOS window or all OOS) side by side, with the strike-rate / EV differences.' },
    ],
  },
  {
    title: 'Headline metrics',
    items: [
      { id: 'totalPnl', term: 'Total PNL', body: 'Sum of every trade’s cashflow ($): a win banks the Min-Cashflow target, a loss takes the full MAE. Auto-priced from each asset’s daily close.' },
      { id: 'samples', term: 'Samples', body: 'How many trades are in the current (attempt-filtered) dataset.' },
      { id: 'winRate', term: 'Win Rate', body: 'Share of trades whose MFE reached the Min-Cashflow target.' },
      { id: 'avgWinStreak', term: 'Avg Win Streak', body: 'Average length of consecutive winning runs.' },
      { id: 'maxLossStreak', term: 'Loss Streak', body: 'Longest run of consecutive losing trades in this selection — the streak behind risk of ruin. A long losing run is what busts an account.' },
      { id: 'span', term: 'Span', body: 'Calendar days from the first to the last trade date in the dataset.' },
    ],
  },
  {
    title: 'Analytics panels',
    items: [
      { id: 'riskMae', term: 'Risk · MAE', body: 'Distribution of your adverse excursions — average, median, 70th percentile, and the "key" MAE (median of those).' },
      { id: 'profitMfe', term: 'Profit · MFE', body: 'Distribution of your favorable excursions — average, median, 30th percentile, and the "key" MFE.' },
      { id: 'cashflowEv', term: 'Cashflow EVs', body: 'Expected $ per trade at high-probability, medium, and high-EV target choices — a quick read on which target pays best.' },
      { id: 'mfeStrikeRates', term: 'MFE Strike Rates', body: 'For each MFE target: how often trades reached it (strike rate), the loss rate, the win $ at that target, and the total potential $.' },
      { id: 'dayOfWeek', term: 'By Day of Week', body: 'How this move plays out on each weekday under your current rule (win = MFE ≥ Min Cashflow, else −MAE capped at Max MAE): trades (N), win rate, average per-trade result %, and total $. The ◄ marks the best win-rate day. Multi-attempt days count each attempt. Updates live as you change Min Cashflow / Max MAE.' },
      { id: 'regimeBreakdown', term: 'By Vol Regime', body: 'How this move plays out in each volatility state — the basis for a per-regime risk profile. Toggle the lens: Expanding/Contracting (VVIX momentum above/below its trailing median — the robust ~50/50 default), +Stable (adds a narrow middle band, thin on short data), or Contango/Backwardation (VIX term structure). Each row: trades (N), win rate, MAE, MFE, total $. Win rate shows raw% [Wilson 95% confidence range] →shrunk% (pulled toward the move\'s all-regime rate so thin buckets don\'t mislead). "thin" = under 30 trades — directional only, never size off it. Regime is the PRIOR session\'s value (no lookahead). Respects the active tab + Attempts + DOW filters.' },
      { id: 'maeRiskLadder', term: 'MAE Risk Ladder', body: 'For each MAE threshold: how many trades went beyond it, the rate, and the $ exposure that drawdown represents.' },
      { id: 'contractDollarMove', term: 'Contract $ / Move', body: 'The dollar value of each % move at your current contract size — loss $ and win $.' },
      { id: 'evMatrix', term: 'EV Risk Matrix', body: 'Expected $ per trade for each (MFE target ↓, MAE stop →) pair: P(hit MFE)×$target − P(hit MAE)×$stop. Green = positive expectancy.' },
    ],
  },
  {
    title: 'Compare & Combine lab',
    items: [
      { id: 'compareLab', term: 'Compare & Combine', body: 'Net multiple moves/assets together per day (in dollars — cross-asset safe) and compare Set A vs Set B. Covers move↔move, asset↔asset, and combined↔combined.' },
      { id: 'setAB', term: 'Set A / Set B', body: 'Two independent selections. Tick any asset×move cells; each set can use its own study and attempt filter, so you can compare e.g. "1st attempt" vs "2nd attempt".' },
      { id: 'winRateDays', term: 'Win Rate (days)', body: 'Share of trading days whose combined (netted) P&L was positive.' },
      { id: 'maxDrawdownDays', term: 'Max Drawdown', body: 'The deepest the combined equity curve dipped below its running high-water mark.' },
    ],
  },
  {
    title: 'Account cycling lab',
    items: [
      { id: 'cycleLab', term: 'Account Portfolio Cycling', body: 'Distribute your trade stream across N prop accounts by gap rotation, tracking each account’s net, peak, and trailing drawdown. Mirrors the cycling spreadsheet.' },
      { id: 'gap', term: 'Gap', body: 'How many trades an account sits out between fires. gap = accounts ÷ (accounts firing per trade) − 1. 5 accounts, 1 firing → 4-gap.' },
      { id: 'size', term: 'Size (×)', body: 'How many accounts fire on each trade — 1× / 2× / 3×. Each firing account takes the full trade P&L, so total P&L = size × the stream total.' },
      { id: 'accountPeak', term: 'Peak', body: 'The highest balance an account reached (its high-water mark).' },
      { id: 'accountDrawdown', term: 'Max Drawdown', body: 'The worst trailing dip from that account’s peak — what a prop firm’s trailing-drawdown rule would watch.' },
    ],
  },
  {
    title: 'Correlation lab',
    items: [
      { id: 'corr-feature', term: 'Portfolio Correlation', body: 'BLUF: shows which of your moves are basically the same bet and which actually diversify. Each move becomes a daily win/loss series — using the SAME Min Cashflow + Max MAE settings as the rest of the dashboard — and we compare every pair. Low/negative = they zig when others zag (good, smooths the curve); high = they win and lose on the same days (stacking risk, not spreading it).' },
      { id: 'corr-pearson', term: 'Returns (Pearson)', body: 'BLUF: do two moves’ daily results rise and fall together? +1 = twins (redundant), 0 = unrelated (diversifying), −1 = opposites (a hedge). The standard correlation everyone means by default.' },
      { id: 'corr-spearman', term: 'Returns (Spearman)', body: 'BLUF: same question as Pearson, but ranks the days instead of using raw size, so one giant outlier day can’t fake a relationship. Trust this more than Pearson when a move has a few monster days.' },
      { id: 'corr-downside', term: 'Downside', body: 'BLUF: do they lose together? Looks only at the bad days. Two moves can look uncorrelated overall yet bleed on the exact same days — that’s the risk this catches. High = they gang up on your drawdowns.' },
      { id: 'corr-drawdown', term: 'Drawdown', body: 'BLUF: do their equity curves dig holes at the same time? Correlates the underwater (below-peak) curves. High = when one is in a slump the other is too, so the account never gets a breather.' },
      { id: 'corr-codrawdown', term: 'Co-Drawdown %', body: 'BLUF: what share of days were BOTH moves underwater at once? A plain percentage, not a coefficient. 0% = one is always recovering while the other dips (ideal); high % = they’re in the mud together.' },
      { id: 'corr-tail', term: 'Tail Risk', body: 'BLUF: do their absolute worst days land on the same dates? Overlap of each move’s worst-10% drawdown days. High = your nightmare days are shared — the real account-killer that average correlation hides.' },
      { id: 'corr-diversified', term: 'Diversified Pairs', body: 'BLUF: how many move-pairs are genuinely independent (|correlation| under 0.30, or under 30% overlap). More diversified pairs = a smoother combined equity curve and smaller drawdowns.' },
      { id: 'corr-insights', term: 'Correlation insights', body: 'BLUF: the actionable read of the matrix. MOST REDUNDANT = the two moves that move together most (keep the higher-edge one; if "structural", they share a session/instrument so the overlap won\'t diversify away). BEST DIVERSIFIER = the move most independent of the rest (add it to smooth the curve). TAIL-RISK PAIR = the two whose WORST days overlap most (don\'t stack — they crash together). Correlations from too few shared days are flagged as noise and ignored here.' },
      { id: 'corr-portfolio', term: 'Equal-weight portfolio', body: 'BLUF: if you ran every loaded move at equal size, here’s the blended result. Total Return (sum of daily %), Ann. Vol (yearly swing), Max Drawdown (deepest dip), Sharpe (return per unit of risk — higher is better, >1 is good). The payoff of diversifying: more low-correlation moves → same return, less vol.' },
    ],
  },
  {
    title: 'Monte Carlo lab',
    items: [
      { id: 'mc-feature', term: 'Monte Carlo', body: 'BLUF: your backtest is ONE path the market happened to take. Monte Carlo replays this move thousands of times in random order/draws to show the realistic RANGE of where you could end up — and how bad the drawdown could get — instead of trusting a single lucky (or unlucky) run. Same win/stop settings as the rest of the dashboard.' },
      { id: 'mc-source', term: 'Source', body: 'BLUF: what to resample. Any individual move (in %), OR the multi-move basket you built in Compare (Set A) / the stream you built in Cycle (both in $, since you can\'t add % across assets). Build/Apply a basket in Compare or Cycle — including a recommendation — and it shows up at the top of this list.' },
      { id: 'mc-mode', term: 'Resample vs Shuffle', body: 'BLUF: two questions. Resample (bootstrap) draws trades WITH replacement — "if I keep trading this edge, what’s the spread of outcomes?" Shuffle keeps the exact same trades but reorders them — "same results, did I just get lucky/unlucky with the order?" Shuffle’s endpoints are all identical (same trades); only the drawdown path changes.' },
      { id: 'mc-prob-profit', term: 'Probability of Profit', body: 'BLUF: out of all the simulated runs, what share finished in the green. 80%+ = a robust edge; near 50% = a coin flip you shouldn’t lean on.' },
      { id: 'mc-median', term: 'Median Outcome', body: 'BLUF: the middle result — half the simulations did better, half worse. A more honest "expected" number than the single backtest total, which can sit at a lucky extreme.' },
      { id: 'mc-range', term: 'Range P5…P95', body: 'BLUF: the realistic spread. 90% of simulated runs landed between these two numbers — P5 is a bad-luck outcome, P95 a good-luck one. A wide gap = high variance; plan for the low end, not the average.' },
      { id: 'mc-maxdd', term: 'Median Max Drawdown', body: 'BLUF: the typical worst peak-to-trough dip across runs. This is what your equity will likely dig through at some point — make sure your account (and nerves) can survive it.' },
      { id: 'mc-worstdd', term: 'Worst-5% Drawdown', body: 'BLUF: the deep tail — only 1 in 20 runs drew down this much or more. Size your account/risk so even THIS doesn’t blow you out, because over enough trades the tail eventually shows up.' },
      { id: 'mc-ddlimit', term: 'Drawdown limit %', body: 'BLUF: set your account’s pain threshold (e.g. a prop firm’s trailing-drawdown cap, in cumulative %). The panel then reports how often a simulated run would breach it — your real "risk of ruin" for this move.' },
      { id: 'mc-lossstreak', term: 'Worst Loss Streak', body: 'BLUF: the longest run of consecutive LOSING trades you should plan for — the 95th-percentile worst streak across all simulations. This is the number behind your Doomsday Budget: capital-to-survive = worst streak × risk per trade.' },
      { id: 'mc-hitlimit', term: 'P(hit limit)', body: 'BLUF: the chance a run’s drawdown reaches your limit. Under ~5% is comfortable; above ~20% (shown red) means this move is too big for that account — cut size or raise the limit.' },
    ],
  },
  {
    title: 'Prop Simulator',
    items: [
      { id: 'ps-feature', term: 'Prop Simulator', body: 'BLUF: will this move PASS a prop-firm evaluation, or blow the account first? It replays the move thousands of times against your rules (profit target, drawdown, daily loss, min days) and tells you how often you pass vs bust. Same win/stop settings as the rest of the dashboard.' },
      { id: 'ps-mode', term: 'Resample vs Shuffle', body: 'BLUF: Resample draws trading days with replacement — "what happens if I attempt this eval over and over." Shuffle just reorders your real days — "could the ORDER of my actual results have busted me." Pass/bust order matters because drawdown is path-dependent.' },
      { id: 'ps-account', term: 'Account size $', body: 'BLUF: your evaluation/funded account balance. Context only — the target and drawdown $ are what actually drive pass/bust.' },
      { id: 'ps-contracts', term: 'Contracts (position size)', body: 'BLUF: how many contracts you trade per fire. This IS your position size — the single biggest lever, and the only sizing input you need. Each move converts to real dollars per asset automatically (contracts × the instrument’s point value × its price on each trade date), so bigger size hits the target faster but also busts the drawdown faster. Bump it up and watch pass rate vs bust rate trade off.' },
      { id: 'ps-target', term: 'Profit target $', body: 'BLUF: the profit that PASSES the evaluation. Reaching this (after min trading days) ends the run as a pass.' },
      { id: 'ps-maxdd', term: 'Max drawdown $', body: 'BLUF: the drawdown that BUSTS you. Set 0 to disable. How it’s measured depends on the DD mode below.' },
      { id: 'ps-ddmode', term: 'Trailing vs Static DD', body: 'BLUF: Trailing measures the drop from your highest equity (the limit follows you up — harsher, the classic funded-account rule). Static measures the drop below your starting balance (once you’re up, you can’t bust from giving back early gains). Trailing is always at least as strict.' },
      { id: 'ps-daily', term: 'Daily loss limit $', body: 'BLUF: if a single day loses more than this, the account busts that day — separate from total drawdown. Common in evaluations. Set 0 to ignore.' },
      { id: 'ps-mindays', term: 'Min trading days', body: 'BLUF: many evals require you to trade at least N different days before a pass counts. If you hit the target early you must keep trading — which risks busting. Set 0 to ignore.' },
      { id: 'ps-maxdays', term: 'Max days', body: 'BLUF: the horizon. If a run neither passes nor busts within this many trading days it’s counted as "still active" (inconclusive). Match it to the eval’s time limit, or set high for funded accounts with no deadline.' },
      { id: 'ps-passrate', term: 'Pass Rate', body: 'BLUF: the share of simulated attempts that hit the target before busting. This is the number that matters — 60%+ (green) means the move comfortably clears these rules; under ~30% means the rules are too tight for it (or it’s too big).' },
      { id: 'ps-bust', term: 'Bust Rate', body: 'BLUF: share of attempts that failed a rule. The split shows WHY — "DD" = drawdown breach, "daily" = single-day loss limit. If daily busts dominate, your size is too big for the daily rule.' },
      { id: 'ps-active', term: 'Still Active', body: 'BLUF: share that neither passed nor busted within Max days. High here means the horizon is too short to judge — raise Max days, or the edge is too slow to clear the target in time.' },
      { id: 'ps-daystopass', term: 'Days to Pass', body: 'BLUF: among the attempts that PASSED, the typical number of trading days it took (with a 10th–90th percentile range). Tells you how long to budget for the evaluation.' },
      { id: 'ps-ev', term: 'Expected $ End', body: 'BLUF: the average ending balance across ALL attempts (pass, bust, and active), with a P5…P95 range. A blended reality check — a high pass rate still has a low expected end if busts are expensive.' },
    ],
  },
  {
    title: 'Setup recommender',
    items: [
      { id: 'sr-feature', term: 'Recommended setup', body: 'BLUF: tells you the best way to trade THIS move for your account. It compares every entry × attempt slice (Breakout 1st / first-2 / first-3 / only-2nd / only-3rd / all, Front Run, Pullback) across MFE target, Max MAE stop and position size, then recommends the full setup — entry, attempts, Min Cashflow, Max MAE, and contracts — for each risk appetite, using your Account Profile (Prop or Live).' },
      { id: 'sr-fastest', term: 'Fastest Growth', body: 'BLUF: the setup + size that grows fastest — in Prop, reaches the target in the fewest days (still passing often); in Live, the most expected $ growth. Higher variance — the aggressive (≈full-Kelly) pick.' },
      { id: 'sr-safest', term: 'Safest', body: 'BLUF: the setup + size least likely to blow up — lowest bust/risk-of-ruin and shallowest drawdown, among setups with a real edge. Slower but durable (≈¼-Kelly).' },
      { id: 'sr-bestoverall', term: 'Best Overall', body: 'BLUF: the balanced pick — best expected outcome with a real chance of passing/surviving (≈½-Kelly, which captures ~75% of the growth at far less drawdown).' },
      { id: 'sr-professional', term: 'Professionally', body: 'BLUF: how an institution/desk would size it — the highest risk-adjusted return (Sharpe) under a strict drawdown cap, vol-targeted size. Not the biggest number, the best return per unit of risk with tight risk control.' },
      { id: 'lr-fastest', term: 'Fastest Growth (basket)', body: 'BLUF: combine the highest-edge moves for the most growth (Kelly-style). Bigger total but bigger swings — moves can be correlated. Each move is valued at the risk you set in Step 2.' },
      { id: 'lr-safest', term: 'Safest (basket)', body: 'BLUF: combine moves that DON\'T lose together (low downside/tail co-movement) — the min-variance / max-diversification basket. Smoothest combined equity and shallowest drawdown.' },
      { id: 'lr-bestoverall', term: 'Best Overall (basket)', body: 'BLUF: the basket with the best risk-adjusted return — highest combined Sharpe (return per unit of volatility). The balanced pick.' },
      { id: 'lr-professional', term: 'Professionally (basket)', body: 'BLUF: how a desk builds it — a diversified basket across DISTINCT setups (no stacking one asset\'s variants), drawdown-aware. For Cycle it also sizes accounts × fire-per-trade so the worst account stays within your drawdown budget.' },
    ],
  },
  {
    title: 'Portfolio lab',
    items: [
      { id: 'pf-feature', term: 'Portfolio & Recommendations', body: 'BLUF: two tools in one. The top half scores every loaded move against YOUR prop rules and tells you which to trade for the fastest payout, the safest ride, and the best all-rounder. The bottom half lets you combine moves at chosen weights and see the blended equity curve. Both use the same win/stop settings as the rest of the dashboard.' },
      { id: 'pf-recs', term: 'Per-objective baskets', body: 'BLUF: set your real account rules below (size, target, drawdown, etc.) and the cards update to name the best move for each goal. Change the rules and the picks re-rank — a tight drawdown favors safer moves, a big target favors faster ones.' },
      { id: 'pf-grand', term: 'Grand Recommendation', body: 'BLUF: your whole plan in one card per appetite. It ties together everything the dashboard computes — each move valued at the risk YOU set in Step 2 (or its default-safest), a correlation-aware basket of complementary moves, and then the WHOLE basket run through the prop-sim together (pass / bust, expected $, Sharpe, drawdown, diversification). Pick your appetite (Fastest / Safest / Best Overall / Professionally), hit Apply, and it loads that allocation into the builder.' },
      { id: 'gr-fastest', term: 'Fastest Growth (plan)', body: 'BLUF: the basket that grows fastest — highest-edge moves, lightly de-correlated (≈full-Kelly). Bigger expected result, bigger swings.' },
      { id: 'gr-safest', term: 'Safest (plan)', body: 'BLUF: the basket least likely to blow up — moves that don’t lose together (downside/tail-aware), lowest bust rate and shallowest drawdown (≈¼-Kelly).' },
      { id: 'gr-bestoverall', term: 'Best Overall (plan)', body: 'BLUF: the best risk-adjusted blend — strong expected outcome with a real chance of passing/surviving (≈½-Kelly).' },
      { id: 'gr-professional', term: 'Professionally (plan)', body: 'BLUF: how a desk runs it — a diversified basket of independent setups, inverse-volatility (risk-parity) weighted so no single move dominates the risk. Robust, drawdown-aware sizing.' },
      { id: 'pf-grandchart', term: 'Combined $ equity', body: 'BLUF: the actual dollar equity curve of the selected plan, summed across its moves day by day. The red dashed line is your bust threshold fed straight from the Account Profile Max DD (trailing = peak − Max DD, static = −Max DD) — if equity touches it you\'d bust. The gold dashed line marks Day 14 (your 14-day risk-of-ruin checkpoint). X-axis is trading days; the flat start is just early dates where only some basket moves have data yet.' },
      { id: 'dd-feature', term: 'Doomsday Budget', body: 'BLUF: "hope for the best, prepare for the worst." It finds the worst losing streak this move can throw at you, multiplies by your risk per trade to get the deepest drawdown you must survive, and tells you the capital + account rotation + scaling that survives it. Built for binary systems (fixed TP/SL). Survive doomsday and the other 99% is gravy.' },
      { id: 'dd-streak', term: 'Worst Loss Streak', body: 'BLUF: the longest run of consecutive losers to plan for — the larger of what actually happened (history) and the 95th-percentile worst run across 1,500 Monte-Carlo resamples. The forward-looking number is what you budget around.' },
      { id: 'dd-risk', term: 'Risk / Trade', body: 'BLUF: the dollars a single losing trade costs at your size — the stop-out loss (Max MAE % × price × contracts × point value). With a fixed stop every loss is ≈ this; with no stop it uses a bad (90th-pct) loss.' },
      { id: 'dd-drawdown', term: 'Doomsday Drawdown', body: 'BLUF: worst streak × risk per trade — the deepest peak-to-trough hole a single account must absorb in the worst case. This is the number your account size has to survive.' },
      { id: 'dd-survive', term: 'Survive on 1 account?', body: 'BLUF: does the Doomsday Drawdown fit inside one account\'s Max DD cap (from the Account Profile)? Green = yes with headroom; red = the worst streak would bust a single account — you need rotation.' },
      { id: 'dd-rotation', term: 'Accounts to Survive', body: 'BLUF: how many prop accounts to run in rotation so the worst streak is shared instead of busting one account. On a loss you rotate to the next account, so N accounts ≈ N× the drawdown cap (combined budget). The "sick account" takes the hits while the others bank payouts.' },
      { id: 'dd-scaling', term: 'Scaling template', body: 'BLUF: add a prop for each Max-DD of bank you can set aside; drop one if you fall below. The table shows the bank needed for N props and the losing streak that many accounts can survive. Scale slowly — it\'s a marathon. Diversify across uncorrelated moves (Portfolio) so the streak rarely lands on everything at once.' },
      { id: 'fl-feature', term: 'Best moves to flip', body: 'BLUF: which move (and what size) to run to PASS this eval. Flipping is asymmetric — a blown eval only costs the account fee, a pass unlocks payouts — so it maximizes passes per account, not min drawdown. It scans every move, sweeps position size at each move\'s tuned target/stop through the prop-sim, and names the best move for four flip styles. Each card shows pass %, days-to-pass, and bust %. Apply loads that move + size.' },
      { id: 'fl-fastest', term: 'Fastest Flip', body: 'BLUF: the move + size that PASSES in the fewest days — max throughput so you can withdraw, reset, and recycle capital fastest. Among setups with a real pass rate. Accepts more bust because speed compounds your account turnover.' },
      { id: 'fl-pass', term: 'Highest Pass %', body: 'BLUF: the move + size most likely to pass within your Max Days — the fewest blown accounts (wasted fees). Most reliable flip, even if slower.' },
      { id: 'fl-ev', term: 'Best EV / Account', body: 'BLUF: the move + size with the highest expected $ end per account attempt — the best payout efficiency once you net passes against busts. The "most money per account bought" pick.' },
      { id: 'fl-consistency', term: 'Consistency', body: 'BLUF: a high pass rate with the lowest single-day concentration (the biggest day as a share of total profit). Steady, repeatable days that fit prop "no big day" consistency caps — important for firms that void payouts when one day is too large a share.' },
      { id: 'ps-firm', term: 'Prop firm preset', body: 'BLUF: pick a firm + account size to auto-fill the eval rules (target, max loss limit, daily limit, min days) and flip economics (eval cost, profit split). Values are APPROXIMATE starting points — prop rules + prices change constantly, so confirm against the firm\'s live rules and edit the fields. Covers Apex, Topstep, Take Profit, Lucid, Alpha Futures, Tradeify.' },
      { id: 'ps-evalcost', term: 'Eval cost $', body: 'BLUF: what you pay to buy the challenge/eval. This is the real cost of flipping — it nets against payouts in "Best EV / Account" (EV = pass% × payout − cost) and totals into your Doomsday prop-spend (accounts to survive × eval cost).' },
      { id: 'ps-split', term: 'Profit split %', body: 'BLUF: the share of profit you keep on a payout. A pass nets payout = profit-target × split (capped at the firm\'s payout max), which drives the EV/account number.' },
      { id: 'fr-feature', term: 'Best ROI to flip', body: 'BLUF: which move makes the most money per dollar you spend on props. It runs each move through the FULL flip lifecycle — buy eval → pass under the trailing/locking MLL → funded → payouts (split, min days, max) → bust → pay reset → repeat — over your horizon, then ranks by return-on-spend, payout speed, and cheapest path to profit. Approximate firm rules; edit them above.' },
      { id: 'fr-roi', term: 'Best ROI / $ spent', body: 'BLUF: the move with the highest net profit ÷ total eval+reset spend. The most capital-efficient flipper — every dollar of account fees works hardest here.' },
      { id: 'fr-payout', term: 'Fastest Payout', body: 'BLUF: the move whose first payout lands soonest (fewest days), so you withdraw and recycle capital fastest — weighed against the account price.' },
      { id: 'fr-cheapest', term: 'Cheapest to Profit', body: 'BLUF: the move that turns net-positive for the least total spend — fewest blown accounts / resets before you\'re in the green. Best when bankroll is tight.' },
      { id: 'fb-feature', term: 'Best basket to flip', body: 'BLUF: which MULTIPLE moves to run together to flip. Combining moves stacks more trades per day, so the basket reaches the eval target faster and with a smoother curve — fewer blown accounts. It ranks each move by solo flip ROI (family-collapsed so one asset\'s variants don\'t stack), then tests cumulative top-N baskets through the full lifecycle. Apply→Compare loads the basket into the Compare lab.' },
      { id: 'fb-roi', term: 'Best ROI basket', body: 'BLUF: the combination of moves with the most net profit per dollar of prop spend.' },
      { id: 'fb-payout', term: 'Fastest-payout basket', body: 'BLUF: the combination that reaches the first payout soonest — more trades/day means the target arrives in fewer calendar days.' },
      { id: 'fb-cheapest', term: 'Cheapest basket', body: 'BLUF: the combination that turns net-positive for the least total spend — a smoother combined curve blows fewer accounts before profit.' },
      { id: 'pf-fastest', term: 'Fastest Payout', body: 'BLUF: the move that hits the profit target in the fewest trading days — among moves that actually pass often enough to trust (not a lucky long-shot). Pick this when you want to get funded/paid quickly and can stomach more variance.' },
      { id: 'pf-safest', term: 'Safest', body: 'BLUF: the move least likely to blow the account — lowest bust rate and shallowest drawdown, among moves with a real edge. Its basket weighting uses DOWNSIDE + TAIL correlation (do they lose/crash on the same days), not plain Pearson — because two moves can look uncorrelated overall yet crash together, which is what actually busts an account. Pick this to protect the account and grind, even if payout is slower.' },
      { id: 'pf-bestoverall', term: 'Best Overall', body: 'BLUF: the highest pass rate, tie-broken by speed — the move most likely to get you through, in good time. The sensible default if you’re not optimizing for one extreme.' },
      { id: 'pf-diversifier', term: 'Best Diversifier', body: 'BLUF: the positive-edge move whose daily results are LEAST correlated (overall, Pearson) to everything else you trade. Adding it smooths your combined curve the most — the best move to pair WITH your main one rather than to trade alone. (Safest uses crash-together correlation instead; this one uses overall independence.)' },
      { id: 'pf-suggested', term: 'Suggested basket', body: 'BLUF: a ready-made combo — the most independent positive-edge moves, picked so they don’t all win and lose on the same days. "Apply" drops them into the builder at equal weight so you can see the blended curve.' },
      { id: 'pf-builder', term: 'Build & weight', body: 'BLUF: tick the moves you want and set a weight for each (they auto-normalize to 100%). The chart and stats show what trading that exact mix would have done, day by day.' },
      { id: 'pf-total', term: 'Total Return', body: 'BLUF: the blended cumulative % over all trading days at your chosen weights. The end point of the equity curve.' },
      { id: 'pf-maxdd', term: 'Max Drawdown', body: 'BLUF: the deepest peak-to-trough dip of the COMBINED curve. A good basket has a shallower drawdown than its individual moves — that’s diversification doing its job.' },
      { id: 'pf-sharpe', term: 'Sharpe', body: 'BLUF: return earned per unit of risk (volatility), annualized. Higher is better; above 1 is strong. Combining low-correlation moves usually raises Sharpe even when total return is unchanged.' },
      { id: 'pf-winrate', term: 'Win Days', body: 'BLUF: share of trading days the combined portfolio finished green. Diversified baskets tend to have more green days because one move covers another’s off day.' },
      { id: 'pf-diversification', term: 'Diversification', body: 'BLUF: how much of the raw, weighted-average volatility the blend cancelled out by combining moves that don’t move together. 0% = no benefit (everything’s correlated); 30%+ (green) = a genuinely smoother ride than the parts alone.' },
    ],
  },
];

/** Flat lookup by id for InfoTip. */
export const HELP: Record<string, HelpItem> = Object.fromEntries(
  HELP_GROUPS.flatMap((g) => g.items).map((i) => [i.id, i]),
);
