/**
 * verify-data.mjs — integrity check on the LIVE dashboard data.
 *
 * Fetches the persisted document from the API and validates what was collected
 * from TradingView and loaded: row counts, date coverage, duplicate dates,
 * percentage sanity, and null/NaN scan. Prints a per-(asset,move) table and a
 * PASS/FAIL summary. Run after every collection batch.
 *
 *   node scripts/verify-data.mjs                 # default API on :8787
 *   API=http://localhost:8787 node scripts/verify-data.mjs
 */
const API = process.env.API || 'http://localhost:8787';
const PROFILE = process.env.PROFILE || 'default';

const MOVE_LABEL = { '1800': '1800', '0300': '0300', MO: 'Market Open', LB: 'Lunch Break' };
const ok = (b) => (b ? '✓' : '✗');

const res = await fetch(`${API}/api/doc?profile=${PROFILE}`).catch((e) => {
  console.error(`Cannot reach API at ${API} — is the server running (npm run server)?\n`, e.message);
  process.exit(2);
});
const payload = await res.json();
const doc = payload.doc || payload.document || payload;

let failures = 0;
const note = (msg) => { failures++; console.log('  ⚠ ' + msg); };

console.log(`\nData integrity — ${API} (profile: ${PROFILE})\n`);
console.log('ASSET  MOVE            ROWS  DATES                     DUP  BADPCT  NULLS');
console.log('─'.repeat(78) + '   (* = expected stacked days on multi-attempt moves)');

for (const asset of Object.keys(doc)) {
  const moves = doc[asset];
  if (!moves || typeof moves !== 'object') continue;
  for (const moveId of Object.keys(moves)) {
    const ms = moves[moveId];
    if (!ms || !ms.inSample) continue;
    const rows = ['inSample', 'oos1', 'oos2', 'oos3'].flatMap((k) => ms[k]?.rows || []);
    if (rows.length === 0) continue;

    // Multi-attempt moves legitimately stack several rows on one date (the engines
    // sum per date), so duplicate dates are expected there — only flag for others.
    const isMulti = /MA$|multi/i.test(moveId) || /multiple/i.test(ms.label || '');
    const dates = rows.map((r) => r.tradeDate).filter(Boolean).sort();
    const dupCount = dates.length - new Set(dates).size;
    let badPct = 0, nulls = 0;
    for (const r of rows) {
      if (r.maePct == null || r.mfePct == null || Number.isNaN(r.maePct) || Number.isNaN(r.mfePct)) nulls++;
      else if (r.maePct < 0 || r.mfePct < 0 || r.maePct > 20 || r.mfePct > 20) badPct++; // % out of sane range
    }
    const range = dates.length ? `${dates[0]}…${dates[dates.length - 1]}` : '—';
    const label = (MOVE_LABEL[moveId] || ms.label || moveId).padEnd(15);
    const dupCell = dupCount ? (isMulti ? `${dupCount}*` : '✗') : '✓';
    console.log(`${asset.padEnd(6)} ${label} ${String(rows.length).padStart(4)}  ${range.padEnd(24)} ${dupCell.padStart(4)}  ${ok(!badPct).padStart(5)}  ${ok(!nulls).padStart(5)}`);
    if (dupCount && !isMulti) note(`${asset} ${moveId}: ${dupCount} duplicate trade dates (unexpected for a single-attempt move)`);
    if (badPct) note(`${asset} ${moveId}: ${badPct} rows with out-of-range MAE/MFE %`);
    if (nulls) note(`${asset} ${moveId}: ${nulls} rows with null/NaN MAE or MFE`);
  }
}

console.log('─'.repeat(78));
console.log(failures === 0 ? '\nPASS — all populated moves look clean.\n' : `\nFAIL — ${failures} issue(s) above.\n`);
process.exit(failures === 0 ? 0 : 1);
