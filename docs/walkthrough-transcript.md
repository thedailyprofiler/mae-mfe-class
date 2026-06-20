# MAE/MFE Dashboard — Beginner Walkthrough (Video Transcript & Article Source)

> Plain-language narration that explains every part of the dashboard for someone
> who has **never** heard of MAE/MFE, prop firms, Monte Carlo, or correlation.
> Use it as a video script or rework it into an article. Each `##` is a scene.

---

## 0. Cold open — what is this thing?

This dashboard answers one question: **"If I trade this setup with real money or a
prop account, what actually happens — and how do I size it so I don't blow up?"**

It does that with nothing fancier than two numbers you record for each trade, and a
pile of simulations on top. By the end you'll know how to pick a setup, size it, test
whether it survives, and build a small portfolio of setups that smooths the ride.

No prior knowledge needed. Let's build it up from zero.

---

## 1. The two numbers: MAE and MFE

Every trade, after you enter, the price wiggles around before the trade is over. Two
things matter:

- **MAE — Maximum Adverse Excursion** = the worst it went *against* you before it
  ended. Think "how much heat did I take." This is your **risk**.
- **MFE — Maximum Favorable Excursion** = the best it went *for* you. Think "how much
  was on the table." This is your **reward**.

We record both as a **percent** of price (so 0.10 means a 0.10% move), plus the date.
That's it — no indicators, no curve-fitting. Just: for each day, how far for me, how
far against me.

Why percent? Because a percent move means the same thing on a $20,000 Nasdaq contract
and a $2,300 Russell contract — it's comparable across instruments.

---

## 2. The one rule everything is built on (the "sync contract")

You decide two settings:

- **Min Cashflow (your target / take-profit):** if MFE reached at least this, you win,
  and you bank exactly this much. (Example: target 0.10% → a winning day = +0.10%.)
- **Max MAE (your stop):** if it's a loss and MAE went past this, the loss is *capped*
  here (you got stopped out). If Max MAE is off, a loss costs the full MAE.

So each trade becomes a simple win/loss number. **Change the target or the stop and the
ENTIRE dashboard recomputes** — every chart, every recommendation. One rule, everywhere.
That consistency is the whole point: nothing can disagree with anything else.

---

## 3. The 5-step flow (your trading business plan)

The dashboard is five collapsible steps, top to bottom — a business plan:

1. **Pick your move** — choose the setup (a short video shows how it's drawn).
2. **Build your business plan** — pick the instrument, the move, and your risk.
3. **Surviving your 14-day risk of ruin** — stress-test it so it doesn't blow up.
4. **Manage your portfolio** — combine setups that don't all lose on the same day.
5. **Apply to your algo** — export it (coming soon).

---

## 4. Step 2 — build the plan

**Account Profile (top):** tell it your situation once. *Prop eval* mode = a prop-firm
challenge (account size, profit target, max drawdown). *Live capital* = your own money
(a drawdown % you can stomach). This drives every recommendation below.

Then three numbered, gold-ringed sub-steps:

- **① Pick your asset** — MNQ (Nasdaq), MES (S&P), MYM (Dow), MCL (oil), MGC (gold),
  RTY (Russell). Each is priced with its own contract math automatically.
- **② Pick your move** — 1800 / 0300 / Market Open / Lunch Break, each with Breakout,
  Front Run, and Pullback entries.
- **③ Set your risk** — two ways, side by side:
  - **"Let us select your risk"** — recommendation cards (Fastest Growth, Safest, Best
    Overall, Professionally). Each is the best target/stop/size for that appetite,
    tested through the simulator. Click **Apply** to use one.
  - **"You set your risk"** — set the contracts, target, and stop yourself; a live
    bar shows the pass/fail odds as you type.

**Auto-default to safest:** any move you haven't personally touched is automatically set
to *its own safest* configuration, so the rest of the dashboard always reflects a sane
default. Your picks are never overwritten.

The analytics below (win rate, the MAE risk ladder, the EV matrix, the loss-streak
counter) all update live off the sync rule.

---

## 5. Step 3 — surviving (this is the survival lab)

Four-plus tools, all using your move's settings:

- **⚖ Compare & Combine** — put one set of moves against another, netted per day in
  dollars. "Is A or B better, and what if I trade both?"
- **⟳ Cycle** — you have several prop accounts; this rotates each trade across them so
  no single account eats a whole losing streak (the "sick account" takes the hits while
  the others bank wins). Shows each account's drawdown + the combined budget.
- **🎲 Monte Carlo** — your backtest is *one* path the market happened to take. Monte
  Carlo replays it thousands of times in random order to show the realistic **range** of
  outcomes and how bad the drawdown could get. "Did I just get lucky?"
- **🏛 Prop Sim** — the heart of it. Simulates a prop-firm evaluation: will this setup
  hit the target before the trailing drawdown busts it? Pass rate, bust rate, days to
  pass, expected dollars. Plus, folded in:
  - **💀 Doomsday Budget** — "hope for the best, prepare for the worst." It finds your
    worst losing streak (history + a Monte-Carlo 95th-percentile), multiplies by your
    risk per trade to get the deepest hole you must survive, then tells you the capital,
    the account rotation, and the position size that survives it. *Survive doomsday and
    the other 99% is gravy.*
  - **🏴‍☠️ Best moves to flip** + **💸 Best ROI to flip** — recommendation cards that scan
    every move and tell you which one (and what size) passes fastest, most reliably, for
    the best return per dollar spent on accounts, and cheapest to profit.
  - **🧩 Best basket to flip** — which *several* moves to run together to flip faster.

---

## 6. Step 4 — the portfolio (don't put all your eggs in one basket)

- **⊞ Correlation** — shows which setups are basically the same bet and which actually
  diversify. Green = independent (good — they smooth each other). Red = they win and
  lose on the same days (stacking risk, not spreading it). It flags the **most redundant
  pair**, the **best diversifier to add**, and the **tail-risk pair that crashes
  together** — and dims any correlation that's just small-sample noise.
- **📊 Portfolio → 🏆 Grand Recommendation** — the capstone. For each appetite it builds
  a basket of complementary moves (each at its own risk) and runs the *whole basket*
  through the simulator together: pass/bust, Sharpe, drawdown, diversification, and a
  dollar equity curve with your bust line and a Day-14 marker drawn on it.

---

## 7. The prop-flipping concept (the Doomsday Budget lesson)

If you're trading prop accounts, the game is **asymmetric**: a blown account only costs
the fee, but a pass unlocks payouts. So you don't minimize risk — you maximize *passes
per dollar spent*. The dashboard models the full lifecycle: buy eval → pass under the
trailing/locking max-loss-limit → get funded → take payouts (split, min days, caps) →
on a bust, pay the reset fee and start again. It picks the firm preset (Apex, Topstep,
Take Profit, Lucid, Alpha Futures, Tradeify), nets the eval cost against payouts, and
tells you ROI, fastest payout, and the cheapest path to profit.

The survival math underneath is the Doomsday Budget: size everything off the worst-case
losing streak, rotate accounts to share the drawdown, scale accounts as your bank grows
(keep ~2× the per-account doomsday in reserve per prop), and diversify across uncorrelated
moves so the streak rarely lands on everything at once.

---

## 8. Close

That's the whole machine: record MAE/MFE → set one win/stop rule → pick your risk (or let
it recommend) → stress-test survival → combine setups that diversify → size it so the
worst case can't take you out. Hover the ⓘ on any number for a one-line explanation, or
hit **? Help** for the full glossary.

Trade the plan, not the feeling. It's a marathon, not a sprint.
