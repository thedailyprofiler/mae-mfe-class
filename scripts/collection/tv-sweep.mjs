#!/usr/bin/env node
/**
 * tv-sweep.mjs — collect ONE indicator config across every instrument by
 * switching the chart symbol (a symbol change recalcs the Gunship table cleanly,
 * unlike an input change which blanks it). You set the move + activation +
 * attempts ONCE in the TV UI; this sweeps all six assets and loads each.
 *
 *   node scripts/collection/tv-sweep.mjs 0300FR --label "0300 Front Run"
 *   node scripts/collection/tv-sweep.mjs 0300MA --label "0300 Multiple Attempt" --multi
 *   node scripts/collection/tv-sweep.mjs 0300   --only MES,MYM,MCL,MGC,RTY   # skip MNQ (already done)
 *
 * flags: --label TEXT  --multi  --days N (default 100)  --only A,B,...
 * env:   TV_MCP_DIR, TV_CDP_PORT (default 9333)
 */
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TV_DIR = process.env.TV_MCP_DIR || resolve(HERE, '../../../tradingview-mcp');
const CLI = join(TV_DIR, 'src/cli/index.js');
const ENV = { ...process.env, TV_CDP_PORT: process.env.TV_CDP_PORT || '9333' };
const WIN = join(HERE, 'windows.jsonl');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CME/CBOT/NYMEX/COMEX micro continuous contracts (verified to resolve).
const SYMBOLS = {
  MNQ: 'CME_MINI:MNQ1!', MES: 'CME_MINI:MES1!', MYM: 'CBOT_MINI:MYM1!',
  MCL: 'NYMEX:MCL1!', MGC: 'COMEX_MINI:MGC1!', RTY: 'CME_MINI:M2K1!',
};

const has = (k) => process.argv.includes(k);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const MOVEKEY = process.argv[2];
if (!MOVEKEY || MOVEKEY.startsWith('--')) { console.error('Usage: node tv-sweep.mjs <MOVEKEY> [--label "…"] [--multi] [--only A,B] [--days 100]'); process.exit(2); }
const LABEL = arg('--label', null);
const MULTI = has('--multi');
const DAYS = arg('--days', '100');
const ONLY = arg('--only', null);
const assets = (ONLY ? ONLY.split(',') : Object.keys(SYMBOLS)).map((s) => s.trim().toUpperCase());

const tv = (...a) => { try { return execFileSync('node', [CLI, ...a], { cwd: TV_DIR, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
const run = (script, ...a) => { try { return execFileSync('node', [join(HERE, script), ...a], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
const chartSymbol = () => { try { return JSON.parse(tv('status')).chart_symbol || ''; } catch { return ''; } };

console.log(`tv-sweep "${MOVEKEY}"${LABEL ? ` (${LABEL})` : ''}${MULTI ? ' --multi' : ''} · ${DAYS}d · assets: ${assets.join(', ')}\n`);
const results = [];
for (const asset of assets) {
  const sym = SYMBOLS[asset];
  if (!sym) { console.log(`${asset}: no symbol mapped — skip`); results.push(`${asset}: SKIP`); continue; }
  console.log(`=== ${asset} (${sym}) ===`);
  tv('symbol', sym);
  await sleep(8000);                                   // let the new symbol's data load
  for (let i = 0; i < 6 && !chartSymbol().includes(sym.split(':')[1].replace('1!', '')); i++) await sleep(2000);
  run('tv-collect.mjs', '--days', DAYS, '--out', WIN); // read-only replay walk-back
  const loadArgs = ['tv-load.mjs', asset, MOVEKEY, '--in', WIN, ...(LABEL ? ['--label', LABEL] : []), ...(MULTI ? ['--multi'] : [])];
  const out = run(...loadArgs);
  console.log('  ' + out.split('\n').filter(Boolean).slice(-2).join('\n  '));
  results.push(`${asset}: ${out.includes('200 OK') ? 'OK' : 'FAIL'}`);
}
tv('symbol', SYMBOLS.MNQ); // leave the chart back on MNQ
console.log('\n=== sweep summary ===\n' + results.join('\n') + '\n\nVerify: node scripts/verify-data.mjs');
