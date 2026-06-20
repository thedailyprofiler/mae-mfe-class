# Class Tutorial — Build the MAE/MFE System From Zero (with Claude Code)

> For someone who has **never** installed a dev tool. We go from a blank Windows PC
> → Claude Code installed → the TradingView bridge running → collecting Gunship Lite
> MAE/MFE data → the dashboard running → committed to GitHub → stress-tested.
>
> **Every prompt you paste into Claude is in a copy box.** Copy it exactly.
> *(Using the finished dashboard is a separate video — this is purely setup + how it was built.)*
>
> Bridge reference (the tool we use to talk to TradingView): the author's setup post —
> https://x.com/Tradesdontlie/status/2039080409581891890 — repo: `github.com/tradesdontlie/tradingview-mcp`.

---

## Part 0 — What you're building & the 30-second mental model

- **Claude Code** = an AI teammate that lives in your terminal and edits files / runs commands for you. You talk to it in plain English.
- **The TradingView bridge** (`tradingview-mcp`) = lets Claude *read* the Gunship Lite indicator off your TradingView chart.
- **The dashboard** = a local web app that turns the collected MAE/MFE data into analytics + recommendations.
- **GitHub** = cloud backup + sharing for your code.

You'll do four installs (Node, Git, VS Code, Claude Code), then three setups (bridge, data, dashboard).

---

## Part 1 — Install the prerequisites (one time)

Do these in order. After each, **restart any open terminal** so it picks up the new tool.

### 1.1 Node.js (the engine everything runs on)
1. Go to **https://nodejs.org** → download the **LTS** version (must be **22.5 or newer**; 24+ is great).
2. Run the installer, click Next through it (accept defaults), Finish.
3. Verify: open **PowerShell** (press Start, type "PowerShell", Enter) and run:
   ```powershell
   node -v
   ```
   You should see a version like `v24.x`. If "not recognized," restart the PC and retry.

### 1.2 Git (version control)
1. Go to **https://git-scm.com/download/win** → it downloads automatically → run it → Next through defaults → Finish.
2. Verify: `git --version` in PowerShell.

### 1.3 VS Code (the editor)
1. **https://code.visualstudio.com** → Download for Windows → install (check "Add to PATH").
2. Open VS Code once so it finishes setup.

### 1.4 A GitHub account
1. Go to **https://github.com** → Sign up → verify email. Remember your username.

---

## Part 2 — Install & sign in to Claude Code

Claude Code is the AI you'll give all the prompts to.

### 2.1 Install
In PowerShell:
```powershell
npm install -g @anthropic-ai/claude-code
```
Verify:
```powershell
claude --version
```

### 2.2 Make a workspace folder & open it
```powershell
mkdir C:\Users\%USERNAME%\Desktop\dev
cd C:\Users\%USERNAME%\Desktop\dev
claude
```
The first run asks you to **log in** — a browser opens, sign in with your Anthropic / Claude account (a Claude Pro/Max subscription or API key works), approve, come back.

### 2.3 (Optional) Use it inside VS Code
- In VS Code: **Extensions** (left bar) → search **"Claude Code"** → Install.
- Or just open VS Code's terminal (`` Ctrl+` ``) and type `claude` — same thing.

> **How to talk to Claude:** type a request in plain English and press Enter. It will
> propose commands/edits and ask permission. Read what it's doing, approve, repeat.
> To stop it, press `Esc`. To exit, `Ctrl+C` twice.

---

## Part 3 — Set up the TradingView bridge

This lets Claude read your chart. You need the **TradingView Desktop** app installed
and logged in (download from tradingview.com if you don't have it).

### 3.1 Let Claude install the bridge — paste this prompt:
```
Install the TradingView MCP bridge for me. Clone https://github.com/tradesdontlie/tradingview-mcp.git
into C:\Users\<ME>\Desktop\dev\tradingview-mcp, run npm install in it, then add it to my
Claude Code MCP config at ~/.claude/.mcp.json as a server named "tradingview" pointing at
its src/server.js (merge it in, don't overwrite other servers). Then tell me exactly how to
launch TradingView with the debug port and how to verify the connection.
```
*(Replace `<ME>` with your Windows username.)*

### 3.2 Launch TradingView with the debug port
Close TradingView fully, then in PowerShell:
```powershell
& "$env:LOCALAPPDATA\TradingView\TradingView.exe" --remote-debugging-port=9333
```
> We use port **9333** (the data-collection scripts default to it). Log in and open a chart.

### 3.3 Restart Claude Code so the bridge loads
Exit Claude (`Ctrl+C` twice), then `claude` again in your `dev` folder.

### 3.4 Verify — paste:
```
Check the TradingView bridge connection and tell me if it's working.
```
You want to see `success: true` / `cdp_connected: true`. If not, TradingView isn't running
with the debug port — redo 3.2.

---

## Part 4 — Set up the Gunship Lite indicator (in TradingView, by hand)

The bridge can **read** the indicator but **writing to it blanks the table** — so *you*
configure it in the TradingView UI; Claude only reads.

1. On a **5-minute** chart of your instrument (e.g. `CME_MINI:MNQ1!`), add the **Gunship Lite
   – Bootcamp** indicator (Indicators → search → add).
2. Open its settings (gear) and set:
   - **Move** (`in_0`): e.g. `1800 Break`, `0300 Break`, `Market Open Break`, `Lunch Break`.
   - **Activation** (`in_75`): `Breakout`, `Front Run`, or `Pullback`.
   - **Max attempts** (`in_76`): `1` for single-attempt, higher for multiple-attempt.
   - **Range filter** (`in_77`): leave **off** (the size filter skews the hit rate).
3. Confirm the table on the chart shows the right header (e.g. "1800 Break · Breakout").

---

## Part 5 — Collect the MAE/MFE data

The scripts live in the dashboard repo (Part 6) under `scripts/collection/`. The flow:
*you set the indicator once → one command sweeps all 6 instruments by switching the symbol.*

### 5.1 Verify the indicator is configured — paste:
```
Read the Gunship Lite indicator table from my TradingView chart and show me the header and
the first few rows, so I can confirm it's set to the move I want before collecting.
```

### 5.2 Sweep one config across all instruments — paste:
```
Using the tv-sweep collection script, collect the "1800 Breakout" move across all 6
instruments (MNQ, MES, MYM, MCL, MGC, RTY) — symbols CME_MINI:MNQ1!, CME_MINI:MES1!,
CBOT_MINI:MYM1!, NYMEX:MCL1!, COMEX_MINI:MGC1!, CME_MINI:M2K1! — about 100 days each, and
load each into the dashboard database. Then VERIFY it persisted in the DB (don't just trust
that the PUTs returned 200), and report the row counts per instrument.
```
> Repeat for each variant by reconfiguring the indicator (5.4 below) — a full move = 4 sweeps:
> Breakout 1-attempt, Multiple-attempt, Front Run, Pullback.

### 5.3 Critical rule (tell your students): **verify persistence**
A stale dashboard tab can overwrite a sweep. After every sweep, paste:
```
Re-read the live database and show me the row counts + date ranges for every populated
move/instrument, and flag anything with 0 rows or duplicate dates.
```

### 5.4 Next variant — reconfigure in the TV UI, then paste:
```
I've reconfigured Gunship Lite to "1800 Front Run". Verify the table header matches, then
sweep "1800 Front Run" (key 1800FR) across all 6 instruments and load + verify.
```

> **If the indicator table ever goes blank:** a write hit it — just refresh TradingView (F5)
> and reconfigure. Collection is read-only by design; never let it write to the chart.

---

## Part 6 — Get the dashboard running

Two paths. **Path A (fastest)** clones the public class repo (code only — you collect your own
data in Parts 4–5). **Path B** builds it with Claude from scratch. Pick A for the class.

### Path A — clone & run the class dashboard (public, no login needed)
Paste:
```
Clone https://github.com/thedailyprofiler/mae-mfe-class.git into C:\Users\<ME>\Desktop\dev,
run npm install, then start it with npm run dev:full and tell me the local URL to open.
```
Open **http://localhost:5185**. It starts **empty** — that's expected; this public copy ships
without trade data so you learn to collect your own (Parts 4–5). Once you've swept a move, it
shows up automatically. *(Your instructor may instead give you a copy that's pre-loaded with
sample data.)*

### Path B — build it with Claude (the workflow we used)
This is how the dashboard was actually built — feature by feature, in plain English. Example
opening prompts (each followed by review + the verify battery in Part 8):
```
Build a React + Vite + TypeScript dashboard that loads one JSON document of MAE/MFE trade
data per asset/move from a tiny local SQLite API (node:sqlite, no extra deps), and derives
every result from one win/stop rule: a win banks the Min-Cashflow target, else the loss is
the MAE capped at Max-MAE. Start with the data model + the storage layer + one move dashboard
showing win rate and a strike-rate ladder. Use clear, testable lib functions.
```
```
Add a Monte Carlo lab that resamples a move's per-trade % returns thousands of times and shows
the P5/median/P95 outcome fan and the worst-case drawdown. Add unit tests for the engine.
```
> You build it the same way for every feature (Prop Sim, Correlation, recommenders, Doomsday).
> The golden rule: **one small feature → review → test → commit** (Parts 7–8).

---

## Part 7 — Set up GitHub & commit your work

### 7.1 Connect Git to GitHub (one time) — paste:
```
Set up Git on this machine: set my user.name and user.email to <your name> and <your GitHub
email>, and walk me through authenticating to GitHub with the gh CLI (install it if needed).
```
Follow the browser login it gives you.

### 7.2 Create the repo + first commit — paste:
```
Create a new PRIVATE GitHub repo called "my-mae-mfe", commit everything in this project with
a clear message, and push it. Show me the repo URL when done.
```

### 7.3 From then on, after each feature — paste:
```
Commit and push what we just did with a clear message describing the change.
```

> **Good habit for the class:** never commit straight to the main branch on shared work — ask
> Claude to "make a branch first." And only push when a feature is finished and tested.

---

## Part 8 — Stress testing (do this before every commit)

The "is it actually working?" gate. Paste:
```
Run the full verification battery and report the results: type-check (tsc --noEmit), the unit
tests (use jest --runInBand — the parallel run can crash a worker on Windows/Node 24), the
production build (vite build), and the data integrity check (node scripts/verify-data.mjs).
If anything fails, diagnose and fix it before we commit.
```
You want: **tsc 0 errors · all tests pass · build succeeds · verify-data PASS.** Only then commit.

> Ask Claude to **stress-test new logic** too:
```
Write unit tests that stress this new engine: edge cases, empty input, and a cross-check that
it agrees with the rest of the dashboard's win/stop rule. Run them and show me they pass.
```

---

## Part 9 — Keep an SOP (so anyone can repeat it)

Have Claude maintain a living instruction doc. Paste:
```
Create/update docs/SOP-mae-mfe-pipeline.md — the exact, repeatable process we use to collect
data from TradingView, load it, and verify it. Write it so a new person could follow it cold.
Commit it.
```
Drag that SOP file (or `HANDOFF.md`) back into any future Claude session to restore full context.

---

## Part 10 — Cheat sheet & troubleshooting

| Want to… | Paste this |
|---|---|
| Start the dashboard | `Start the dashboard with npm run dev:full and give me the URL.` |
| Check the bridge | `Is the TradingView bridge connected?` |
| Collect a move | `Sweep "<MOVE> <ENTRY>" across all 6 instruments and verify it persisted.` |
| Verify data | `Re-read the DB and show row counts + date ranges; flag 0-row or dup-date moves.` |
| Test everything | `Run tsc, jest --runInBand, vite build, and verify-data; fix any failures.` |
| Save work | `Commit and push with a clear message.` |

| Problem | Fix |
|---|---|
| `claude` not found | Restart PowerShell; re-run `npm install -g @anthropic-ai/claude-code`. |
| Bridge `cdp_connected: false` | Relaunch TradingView with `--remote-debugging-port=9333`, then restart Claude. |
| Indicator table blank | A write hit the chart — press **F5** in TradingView and reconfigure the indicator. |
| Dashboard won't start | Node too old — install Node 22.5+; re-run `npm install`. |
| Collected data vanished | A stale browser tab overwrote it — keep the dashboard tab closed during collection and re-verify after each sweep. |
| Tests "fail" but 0 failed | Windows/Node 24 worker quirk — run `jest --runInBand`. |

---

### The rhythm to teach
**Configure indicator → collect → verify → build one feature → stress-test → commit → push → repeat.**
Small steps, always verified, always saved. That's the whole method.
