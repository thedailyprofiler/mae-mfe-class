# SOP — Gunship MAE/MFE Pipeline (TradingView → Dashboard → Analytics)

**Purpose:** the exact, repeatable process for collecting Gunship MAE/MFE data from
TradingView, loading it into the mae-mfe-dashboard, and verifying every analysis lab
is synced, debugged, and driven by real data. Drag this file into a Claude session to
resume the workflow at any time.

**Repos / paths**
- Dashboard: `C:\Users\matth\Desktop\dev\mae-mfe-dashboard` (React/Vite/TS, SQLite API)
- TradingView bridge: `C:\Users\matth\Desktop\dev\tradingview-mcp` (CDP `tv` CLI)
- Memory (bridge + schema details): `…/.claude/projects/…/memory/` — see
  `tradingview-mcp-bridge.md`, `gunship-mae-mfe-measurement.md`, `mae-mfe-dashboard-wiring.md`.

---

## 0. Mental model (read once)

- Each **move** (1800, 0300, Market Open, Lunch Break + custom 1800 Multiple Attempt /
  Front Run / Pullback) is collected per **instrument** (MNQ, MES, MYM, MCL, MGC, RTY).
- One **row** = one trade: `tradeDate, maePct, mfePct, contracts`. MAE/MFE are stored as
  **percent** (0.10 = 0.10%). Multi-attempt moves legitimately have **several rows per
  date** — the engines **sum per date**.
- The dashboard derives every result from one **win/stop rule** (the *sync contract*):
  - `isWin = mfePct >= Min Cashflow` → banks `+Min Cashflow`
  - else loss of `−MAE`, **capped at −Max MAE** when Max MAE > 0 (a win is never flipped)
- All five analysis labs read this same rule, so changing **Min Cashflow** or **Max MAE**
  re-drives Correlate, Monte Carlo, Prop Sim, Recommendations, and Portfolio together.

---

## 1. Measurement definition (must match every collection)

Measure MAE/MFE **from the breakout** until the price hits **the opposite side of the
1800–1815 range** OR the **0300 cutoff**, whichever comes first. (If the opposite side is
never hit by 0300, MAE is whatever it was at 0300.) In the Gunship Lite indicator this is
**SL Mode = RangeOpposite**. Collect **breakout only** unless the move is explicitly a
Front Run / Pullback / Multiple Attempt variant.

---

## 2. One-time setup

```bash
# Dashboard (two processes; web :5185, API :8787)
cd C:\Users\matth\Desktop\dev\mae-mfe-dashboard
npm install
npm run dev:full          # API + web together

# TradingView must be open with the Gunship Lite indicator on a 5-min chart,
# and Chrome/TV launched with the CDP debug port (see tradingview-mcp-bridge memory).
```

**Bridge guardrail (critical):** the TV bridge can **read** the indicator table and drive
**replay**, but **writes** (`tv symbol`, `tv indicator set`) blank the table. So **you (the
user) set the indicator manually in the TV UI**; the agent only reads + walks replay.

---

## 3. Collect one (instrument, move) — repeat per slot

1. **User:** in the TV UI set the chart instrument and the indicator inputs for the move:
   - `in_0` = move (1800 / 0300 / MO / LB)
   - `in_75` = activation (Breakout / Front Run / Pullback)
   - `in_76` = max attempts (1 for single; >1 for Multiple Attempt)
   - `in_77/in_78` = range filter (leave per the standard config)
   Tell the agent: **"<INSTRUMENT> <MOVE> ready"**.
2. **Collect (read-only, scripted):** walk replay backward and dump each window's table:
   ```bash
   # TV must be open + configured; CDP debug port up (default 9333)
   node scripts/collection/tv-collect.mjs --days 100 --out scripts/collection/windows.jsonl
   ```
3. **Load:** parse + dedupe to 100 days + upload (merge-safe — replaces only this move):
   ```bash
   node scripts/collection/tv-load.mjs MNQ 0300 --in scripts/collection/windows.jsonl
   # variants: --label "0300 Multiple Attempt" --multi   (per-attempt rows)
   ```
   `--dry` prints stats without uploading. Year inference: months 07–12 → 2025, 01–06 → 2026.

**FAST PATH — sweep one config across ALL instruments.** A symbol change recalcs the
table cleanly (unlike an input change), so set the move/activation/attempts **once** in the
TV UI, then sweep every asset by switching symbols automatically:
```bash
node scripts/collection/tv-sweep.mjs 0300FR --label "0300 Front Run"
node scripts/collection/tv-sweep.mjs 0300MA --label "0300 Multiple Attempt" --multi
node scripts/collection/tv-sweep.mjs 0300   --only MES,MYM,MCL,MGC,RTY   # skip an already-done asset
```
So per move you set just **4 configs** (1-attempt / multiple / front run / pullback); each sweep
collects all 6 instruments (~8–10 min/sweep). Symbols: MNQ `CME_MINI:MNQ1!`, MES
`CME_MINI:MES1!`, MYM `CBOT_MINI:MYM1!`, MCL `NYMEX:MCL1!`, MGC `COMEX_MINI:MGC1!` (the
`_MINI` matters — `COMEX:MGC1!` is full-size gold and renders no Gunship table), RTY
`CME_MINI:M2K1!`. The sweep maps each variant to a move key: `<MOVE>` (BO 1-att, built-in),
`<MOVE>MA` (`--multi`), `<MOVE>FR`, `<MOVE>PB`.

**ALWAYS verify it PERSISTED, not just that PUTs returned 200.** A stale dashboard tab can
overwrite a sweep; a `200 OK` in the sweep log is not proof. After each sweep, re-read the DB:
```bash
curl -s "http://localhost:8787/api/doc?profile=default" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s).doc;const A=["MNQ","MES","MYM","MCL","MGC","RTY"];console.log(A.map(a=>a+"="+(((m[a]||{}).KEY||{inSample:{rows:[]}}).inSample.rows.length)).join("  "))})'   # replace KEY
```
Or check for an active writer first: GET `updatedAt` twice ~5s apart — if it changes while you're
not writing, a tab is saving (close it). The clobber is now defended in code (poll-merge +
merge-on-save, see Troubleshooting), but verifying persistence is cheap insurance.

**Verify the indicator config before every sweep** (`tv data tables | node read-table.mjs`):
the header must read e.g. `Market Open Break · Front Run`, and Attempt columns must match
(1 col = 1-attempt, 1/2/3 = multiple). Never change the indicator mid-sweep — it mislabels.

> Reliable workflow rule (PROVEN): **user configures the indicator (symbol + inputs) in the
> TV UI, then collection runs read-only via replay + loads.** Writes to the chart blank the
> indicator table — `tv-collect.mjs` never writes. Full-auto config-setting via
> `tv indicator set` was tested and **confirmed non-viable** (2026-06-19): even the proper
> `study.setInputValues()` blanks the Pine table and it only recovers on a chart **refresh
> (F5)**. So collection is semi-auto. If a stray write ever blanks the table, refresh TV.

**Gunship Lite input map** (read via `tv indicator get <studyId>`; study id via `tv state`):
`in_0` = move (string, e.g. `"1800 Break"`, `"0300 Break"`), `in_75` = activation
(`"Breakout"` / `"Front Run"` / `"Pullback"`), `in_76` = max attempts (`1` or `N`),
`in_77` = range-filter toggle (**keep `false`/off** — the `in_78`=0.3 size filter skews the
hit rate, per the 1800 lesson).

---

## 4. Load into the dashboard

- Rows are written to the move's `inSample` bucket (or OOS buckets for different periods)
  via the API (`PUT /api/doc?profile=default`). Built-in move keys: `1800`, `0300`, `MO`,
  `LB`. Custom moves get a generated key + a `label` (e.g. "1800 Multiple Attempt").
- CSV path (when starting from a GunShip export): `node scripts/import-gunship.mjs` (schema-aware).
- **A populated move appears automatically in every lab** — the engines enumerate
  `Object.keys(state)` and skip empty moves. No code change needed for 0300/MO/LB.

---

## 5. Verify (run after every batch — this is the debug/stress gate)

```bash
cd C:\Users\matth\Desktop\dev\mae-mfe-dashboard

# (a) Real-data integrity on the live DB: counts, date coverage, dup dates,
#     %-sanity, null/NaN scan. Multi-attempt dup dates show as "N*" (expected).
node scripts/verify-data.mjs

# (b) Engine correctness + cross-lab sync contract (unit + integration/stress tests)
npx jest                       # all suites
npx jest pipeline              # just the end-to-end pipeline stress test

# (c) Type + build health
npx tsc --noEmit
npx vite build
```

**Green bar to trust the dashboard:** `verify-data.mjs` prints **PASS**, `jest` is all-green,
`tsc` exits 0, `vite build` succeeds. The `pipeline.integration.test.ts` suite specifically
asserts the built-in 0300/MO/LB moves flow through all five labs and that Max MAE / position
size behave identically wherever a move is consumed.

---

## 6. The five analysis labs (what each answers)

| Lab | Question | Units |
|-----|----------|-------|
| ⊞ Correlate | Which moves are redundant vs diversifying? Per-cell hover gives a trade-together / hedge verdict through the chosen lens (Pearson/Spearman/Downside/Drawdown/Co-DD%/Tail). | % (scale-free) |
| ⚖ Compare & Combine | Net Set A vs Set B per day in $ (move↔move, asset↔asset, or combined baskets). Recommendation cards pick WHICH moves to combine per appetite. | **$** |
| ⟳ Cycle | Distribute the trade stream across N prop accounts via gap rotation. Recommendation cards pick moves + accounts + size per appetite. | **$** |
| 🎲 Monte Carlo | Realistic range of outcomes / drawdown if I keep trading this — an individual move (%), or the **Combine basket / Cycle stream** you built ($). Resample = keep trading the edge; Shuffle = ordering luck. | % move, **$** basket |
| 🏛 Prop Sim | Will this move PASS a prop eval before busting? Pass/bust/active, days-to-pass, expected $ end. | **$** |
| 📊 Portfolio | **🏆 Grand Recommendation** (full plan per appetite) + per-objective weighted baskets + build/weight your own blend. | **$** recs, % builder |

**Position size & dollars (Prop Sim + Recommendations):** the only sizing input is
**Contracts**. Each move converts to $ **per asset** automatically:
`contracts × pointValue × price(date) × pct/100`. Prices come from each instrument's bundled
daily-close table — **all six now have one**, including RTY (pulled from `CME_MINI:M2K1!`, the
micro Russell; table `RTY_DAILY_CLOSES` in `assetPrices.ts`, 2025-04→2026-06). `FALLBACK_PRICE`
in `propSim.ts` is now **empty** (no flat fallback needed), so the dashboard and the labs price
RTY identically. Bigger size → faster target but faster bust (the Fastest-vs-Safest tradeoff).
To re-pull/refresh a price table: set the chart to the symbol + 1D, `tv ohlcv -n 500`, convert
unix `time` → **ET session date**, write the `<ASSET>_DAILY_CLOSES` table + wire into `TABLES`
and `ASSET_PRICE_RANGE`. (Note: a fresh `1!` continuous pull sits ~1% off older tables due to
contract-roll re-adjustment — immaterial for bps→$ since the point value dominates.)

Every metric in every lab has a BLUF (bottom-line-up-front) hover tooltip.

---

## 6b. The guided 5-step layout & recommendation flow (in-dashboard)

The dashboard is a collapsible **5-step accordion** (`MaeMfeAnalysisView`):
1. **Pick your Move** — embedded chart-collection video (`public/videos/pick-your-move.mp4`).
2. **Build your business plan** — the workspace, with **three gold-ringed numbered sub-steps**:
   Account Profile (global) → ① **Pick your asset** → ② **Pick your move** → ③ **Let us select
   your risk** (the auto recommendation cards) / ③ **You set your risk** (manual config row +
   Entry/Study, with a live pass/bust **RiskReadout** to the right that updates as you edit).
3. **Surviving your 14-day Risk of Ruin** — Compare / Cycle / Monte Carlo / Prop Sim.
4. **Manage your portfolio** — Correlate / Portfolio.
5. **Apply your template to your Algo** — coming soon.

**Account Profile** (top of Step 2, drives BOTH recommenders): a **Prop ⇄ Live** toggle +
account rules. Prop = eval fields (Account $, Target $, Max DD $, DD mode, Daily $, Min/Max
days). Live = **Max drawdown % from the high-water mark (trailing) + Horizon** (no eval target;
drawdown = relative-% ruin level). One source of truth; `profileRules` flows to both panels.

**🎯 Setup recommender** (`setupRecommender.ts`, under the move header): for the picked move it
sweeps every entry × attempt slice (Breakout 1 / 2 / 3 / 2nd-only / 3rd-only / all + Front Run +
Pullback) × MFE target × Max MAE × contracts through the prop sim and recommends the full setup
(entry + attempts + Min Cashflow + Max MAE + **contracts**) per appetite — ⚡ Fastest Growth · 🛡
Safest · 🏆 Best Overall · 🏛 Professionally. Prop optimizes pass/days/bust; Live optimizes
return/Sharpe/max-DD/risk-of-ruin. Cards show a pass / still-trading / bust bar + avg result.
Button-triggered (heavy); **clears stale results when move/asset/mode/rules change** (no desync).
Research basis: fractional Kelly (¼/½/full ≈ safest/balanced/fastest) + institutional
vol-targeting under a drawdown cap for "Professionally."

**⚡ Default all to Safest** (`recommendSafestConfig`): sets **every populated (asset, move) dataset
to its OWN safest** Min Cashflow / Max MAE / contracts — computed from that dataset's own MAE/MFE
data (min bust, positive edge), independent of entry. **Auto-runs on EVERY load, but only for
UNTOUCHED moves** (still at raw defaults: Min Cashflow 0.1 / Max MAE 0 / 5 contracts) — so a move
you set or applied is never overwritten, and a freshly collected move gets defaulted next load. The
Account Profile button force-re-defaults **all** moves. This is what guarantees that Correlate /
Monte Carlo / Prop Sim / Portfolio always read each move at **its manual pick or its safest default**.

**Transfer:** Min Cashflow / Max MAE / attempt lens live in the shared document → flow to Steps 3/4
live. **Contracts** also persists per move (`defaultContracts`); each recommendation's **Apply** and
the config-row **Apply** sync the global size. So whatever you select — a recommendation, the manual
config, or Default-to-Safest — transfers to the risk & portfolio steps.

**Ticker metrics** include **Loss Streak** (longest consecutive-loser run — the streak behind risk
of ruin) next to Avg Win Streak. **Empty-row hiding:** the MFE Strike Rates table, MAE Risk Ladder,
and EV Risk Matrix hide thresholds with no data and show them only when data is present.

---

## 6c. The recommendation system (the heart of "tie everything in")

Four recommenders, all research-backed (fractional-Kelly / Markowitz min-variance / max-Sharpe /
institutional risk-parity), all valuing each move at **its manual-or-safest config**:

1. **🎯 Setup (per move)** — `setupRecommender.ts`, Step 2. For the picked move, sweeps every entry ×
   attempt slice × MFE × Max MAE × contracts → the full setup per appetite (⚡ Fastest / 🛡 Safest /
   🏆 Best Overall / 🏛 Professionally). Auto-runs; "Active: …" chip shows which path the current
   config matches. Apply sets the move's config.
2. **⚖ Combine baskets** — `labRecommend.ts → recommendCombine`, Compare lab. Picks WHICH moves to net
   together per appetite (Kelly / min-variance / max-Sharpe / diversified). **→ A / → B** apply into
   either set; **Clear** resets.
3. **⟳ Cycle setups** — `labRecommend.ts → recommendCycle`, Cycle lab. Picks moves **+ accounts N + size
   k** per appetite (size-up / max-gap / Calmar-across-accounts / DD-budgeted to `rules.maxDrawdown`).
4. **🏆 Grand Recommendation** — `grandRecommend.ts`, Portfolio lab (Step 4). The capstone: per appetite
   it builds the correlation-aware basket (reusing `recommend()`), values each move at its own size
   (`buildOwnSizeDollarSeries`), then runs the **whole basket back through the prop-sim together** →
   pass / bust / expected $ / Sharpe / max-DD / diversification. Apply loads it into the builder.
   Professionally = inverse-volatility (risk-parity) over the diversified independent basket.

**Cross-lab carry:** the Compare Set A and the Cycle selection (+N/k) are lifted to shared state, so
**applying a Combine/Cycle recommendation makes that basket runnable in Monte Carlo** (top of the
Source dropdown, in $). Correlation lab is intentionally left untouched.

---

## 7. Collection status & how to add more

**COMPLETE as of 2026-06-19: 96/96 datasets** — all 4 moves (1800 / 0300 / Market Open / Lunch
Break) × 4 variants (Breakout 1-att / Multiple / Front Run / Pullback) × 6 assets
(MNQ / MES / MYM / MCL / MGC / RTY), ~100 days each, verified clean. Move keys per move base:
`<base>` (BO 1-att), `<base>MA`, `<base>FR`, `<base>PB` (bases: `1800`, `0300`, `MO`, `LB`).

To collect a NEW move or refresh data, per variant (4 sweeps for a full move):
1. Set the indicator config in the TV UI (Gunship Move + Activation + attempts).
2. Verify the table header + attempt columns (§3).
3. `node scripts/collection/tv-sweep.mjs <KEY> [--label "…"] [--multi]` — sweeps all 6 assets.
4. Verify it PERSISTED in the DB (§3), not just that PUTs returned 200.
The labs (Correlate / Monte Carlo / Prop Sim / Portfolio) pick up new moves automatically and
family-aware (variants of one asset+move don't double-count).

---

## 8. Troubleshooting

- **API `EADDRINUSE :8787`** — a server is already running from a prior session; just start
  the web (`npm run dev`) or reuse the running one. Web is :5185.
- **Indicator table blank after a change** — a write hit the bridge; reconfigure in the TV UI.
- **RTY $ looks off / shows $0** — RTY now has a real bundled table (`RTY_DAILY_CLOSES` from `CME_MINI:M2K1!`, 2025-04→2026-06). $0 across the ladder/EV/contract-$ means a move's `refPrice` isn't resolving — confirm trade dates fall inside the table range, or re-pull the table (§6 procedure). The old flat `FALLBACK_PRICE` (~2300) is gone (now `{}`).
- **A move missing from a lab** — it has no rows yet; collect/load it (empty moves are skipped).
- **CLI-loaded moves vanish / get overwritten** — TWO-LAYER fix in code: (1) the open dashboard
  polls every 4s and merges external moves into its state (`MERGE_EXTERNAL`) so they show live;
  (2) `saveDoc` re-reads the server doc and additively merges in any (asset,move) the client lacks
  BEFORE every PUT, so no save can drop external moves. With both, the dashboard is safe to keep
  open during collection. **HARD CAVEAT (learned the hard way — lost a whole Market Open run):**
  a tab open from BEFORE a code fix keeps running the old code (Vite HMR does NOT activate a newly
  added effect without a real reload). After any dashboard code change, **hard-refresh (Ctrl+Shift+R)
  or reopen the tab.** When in doubt during collection, keep the tab CLOSED and verify persistence
  in the DB after each sweep (§3). Additive merge means a UI delete during an active sweep can be
  re-added by a poll — don't delete moves mid-sweep.
- **`verify-data.mjs` FAIL on dup dates for a non-multi move** — real issue: re-collect that
  slot (replay windows likely double-counted a date).
