#!/usr/bin/env node
/**
 * tv-collect.mjs — walk the Gunship Lite indicator BACKWARD through TradingView
 * replay and dump each window's Pine-table rows to JSONL (one {label, rows} per
 * line). READ-ONLY and safe: it never changes the chart symbol or indicator
 * inputs, so it can't blank the table. You configure the indicator in the TV UI
 * first; this just reads + walks replay.
 *
 *   node scripts/collection/tv-collect.mjs --days 100 --out windows.jsonl
 *
 * env:
 *   TV_MCP_DIR   path to the tradingview-mcp repo (default: ../tradingview-mcp)
 *   TV_CDP_PORT  TradingView CDP debug port (default: 9333)
 *   TV_TARGET_ID optional indicator entity id (passed through to the CLI)
 * flags:
 *   --days N     trading days to cover (default 100)
 *   --hop N      calendar days to jump per window (default 14 ≈ 10 trading days)
 *   --settle MS  ms to wait after each replay jump before reading (default 5000)
 *   --out PATH   output JSONL (default scripts/collection/windows.jsonl)
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };

const TV_DIR = process.env.TV_MCP_DIR || resolve(HERE, '../../../tradingview-mcp');
const CLI = join(TV_DIR, 'src/cli/index.js');
const ENV = { ...process.env, TV_CDP_PORT: process.env.TV_CDP_PORT || '9333' };
const days = +arg('--days', 100);
const hop = +arg('--hop', 14);
const settle = +arg('--settle', 5000);
const OUT = arg('--out', join(HERE, 'windows.jsonl'));
const END = arg('--end', null); // anchor walk-back at this date (OOS/past window) instead of today

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tv = (...a) => { try { return execFileSync('node', [CLI, ...a], { cwd: TV_DIR, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };

/** Find the table whose rows look like the Gunship MAE/MFE readout. */
function maeRows(jsonText) {
  let j; try { j = JSON.parse(jsonText); } catch { return []; }
  for (const st of j.studies || []) for (const t of st.tables || []) {
    const rows = t.rows || [];
    if (rows.some((r) => /MAE/i.test(String(r)))) return rows;
  }
  return j.studies?.[0]?.tables?.[0]?.rows || [];
}
const readWindow = (label) => { const rows = maeRows(tv('data', 'tables')); appendFileSync(OUT, JSON.stringify({ label, rows }) + '\n'); console.log(`  ${label}: ${rows.length} rows`); };

// Build backward hop dates from the anchor (today, or --end for a past window).
function hopDates() {
  const n = Math.ceil(days / 9) + 1;
  const out = [];
  const d = END ? new Date(`${END}T12:00:00Z`) : new Date();
  if (END) out.push(d.toISOString().slice(0, 10)); // include the anchor (end) date itself
  for (let i = 0; i < n; i++) { d.setUTCDate(d.getUTCDate() - hop); out.push(d.toISOString().slice(0, 10)); }
  return out;
}

console.log(`tv-collect → ${OUT}\n  TV_DIR=${TV_DIR} port=${ENV.TV_CDP_PORT} days=${days} hop=${hop}d settle=${settle}ms`);
writeFileSync(OUT, '');

tv('replay', 'stop'); await sleep(settle);
if (!END) readWindow('realtime'); // skip the live read when targeting a past/OOS window
for (const date of hopDates()) {
  tv('replay', 'start', '--date', date); await sleep(settle);
  readWindow(date);
}
tv('replay', 'stop');
console.log('DONE — now load with: node scripts/collection/tv-load.mjs <ASSET> <MOVEKEY> [--label "…"] [--multi] --in ' + OUT);
