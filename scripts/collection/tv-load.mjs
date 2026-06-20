#!/usr/bin/env node
/**
 * tv-load.mjs — parse a tv-collect JSONL, dedupe to the last N trading days, and
 * upload one (asset, move) into the dashboard. Merge-safe: it GETs the current
 * document, replaces only the target move, and PUTs the whole doc back.
 *
 *   node scripts/collection/tv-load.mjs MNQ 0300 --in windows.jsonl
 *   node scripts/collection/tv-load.mjs MNQ 0300MA --label "0300 Multiple Attempt" --multi --in windows.jsonl
 *
 * flags:
 *   --in PATH     input JSONL from tv-collect (default scripts/collection/windows.jsonl)
 *   --label TEXT  display label (required for custom non-builtin move keys)
 *   --multi       per-attempt rows (a 3-attempt day = 3 rows); default 1 row/day
 *   --days N      keep the most recent N trading days (default 100)
 *   --api URL     dashboard API (default http://localhost:8787/api/doc?profile=default)
 *   --bucket B    target bucket: inSample|oos1|oos2|oos3 (default inSample)
 *   --dry         parse + print stats, do not upload
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const has = (k) => process.argv.includes(k);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };

const [ASSET, MOVEKEY] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!ASSET || !MOVEKEY) { console.error('Usage: node tv-load.mjs <ASSET> <MOVEKEY> [--label "…"] [--multi] [--days 100] [--in file]'); process.exit(2); }
const IN = arg('--in', join(HERE, 'windows.jsonl'));
const LABEL = arg('--label', null);
const MULTI = has('--multi');
const KEEP = +arg('--days', 100);
const API = arg('--api', 'http://localhost:8787/api/doc?profile=default');
const BUCKET = arg('--bucket', 'inSample');
const DRY = has('--dry');

// Parse pipe-delimited Gunship rows; date is MM/DD (year: month ≥ 7 → 2025 else 2026).
const byKey = new Map();
for (const line of readFileSync(IN, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let w; try { w = JSON.parse(line); } catch { continue; }
  for (const row of w.rows || []) {
    if (!/\d{2}\/\d{2}/.test(row)) continue;
    const dm = row.match(/(\d{2})\/(\d{2})/); if (!dm) continue;
    const [, mm, dd] = dm;
    const date = `${+mm >= 7 ? 2025 : 2026}-${mm}-${dd}`;
    const parts = row.split('|');
    if (MULTI) {
      for (let i = 1; i < parts.length; i++) {
        const a = parts[i].match(/MAE\s*([\d.]+)%[\s\S]*?MFE\s*([\d.]+)%/);
        if (a) { const k = `${date}|${i}`; if (!byKey.has(k)) byKey.set(k, { date, att: i, maePct: +a[1], mfePct: +a[2] }); }
      }
    } else {
      const a = row.match(/MAE\s*([\d.]+)%[\s\S]*?MFE\s*([\d.]+)%/);
      if (a && !byKey.has(date)) byKey.set(date, { date, att: 1, maePct: +a[1], mfePct: +a[2] });
    }
  }
}

let all = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.att - b.att);
const days = [...new Set(all.map((r) => r.date))].sort();
const keep = new Set(days.slice(-KEEP));
all = all.filter((r) => keep.has(r.date));
if (all.length === 0) { console.error(`No MAE/MFE rows parsed from ${IN}. Is the indicator configured + table visible?`); process.exit(1); }

const wins = all.filter((r) => r.mfePct >= 0.1).length;
const avg = (a) => (a.reduce((s, x) => s + x, 0) / a.length).toFixed(3);
console.log(`${ASSET}.${MOVEKEY}${LABEL ? ` (${LABEL})` : ''}: ${all.length} rows / ${keep.size} days | win@0.10 ${(100 * wins / all.length).toFixed(1)}% | avg MAE ${avg(all.map((r) => r.maePct))} MFE ${avg(all.map((r) => r.mfePct))}`);
if (DRY) process.exit(0);

const rows = all.map((r, i) => ({ rowIndex: i + 1, tradeDate: r.date, maePct: r.maePct, mfePct: r.mfePct, contracts: 5, refPrice: null }));
const cur = await (await fetch(API)).json();
const doc = cur.doc;
doc[ASSET] = doc[ASSET] || {};
const prev = doc[ASSET][MOVEKEY] || {};
const empty = { startDate: null, rows: [] };
doc[ASSET][MOVEKEY] = {
  minCashflowPct: prev.minCashflowPct ?? 0.1, defaultContracts: prev.defaultContracts ?? 5, maxMaePct: prev.maxMaePct ?? 0,
  ...(LABEL ? { label: LABEL } : prev.label ? { label: prev.label } : {}),
  inSample: prev.inSample ?? empty, oos1: prev.oos1 ?? empty, oos2: prev.oos2 ?? empty, oos3: prev.oos3 ?? empty,
  [BUCKET]: { startDate: null, rows },
};
const res = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc }) });
console.log(`PUT → ${res.status} ${res.ok ? 'OK' : await res.text()} | ${ASSET} moves: ${Object.keys(doc[ASSET]).join(', ')}`);
