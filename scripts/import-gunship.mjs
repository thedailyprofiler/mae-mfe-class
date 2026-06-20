/**
 * import-gunship.mjs — GunShip session-detail CSV → MAE/MFE dashboard document.
 *
 * Reads gunship_session_detail.csv (the full GunShip's per-session dump) and
 * builds a MaeMfeDocument, then PUTs it to the SQLite backend (profile=default).
 *
 * Handles the file's THREE concatenated schema versions (28 / 29 / 36 columns,
 * one stale header) by branching the MAE/MFE column index on field count. The
 * `bo_p80_inval_px` insert at col 16 shifts mae_pct/mfe_pct from 18/19 → 19/20.
 *
 * Dedup: the file re-dumps the rolling history every snapshot (and duplicates
 * rows within a snapshot), so we keep ONE row per (asset, move, session_date),
 * preferring the latest snapshot_date that contains it.
 *
 * IS/OOS: only ~92 sessions exist (one ~4.5-month regime), so a true 100-day /
 * different-regime split isn't possible. We do a chronological 65% IS / 35% OOS1
 * per (asset, move) and report each side's median range_pct so you can see
 * whether OOS happened to land in a different volatility bucket.
 *
 * Usage:
 *   node scripts/import-gunship.mjs                 # build + PUT to :8787
 *   node scripts/import-gunship.mjs --out doc.json  # also dump the document
 *   node scripts/import-gunship.mjs --no-put        # build + dump only
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CSV_PATH =
  process.env.GUNSHIP_CSV ||
  'C:/Users/matth/Documents/NinjaTrader 8/gunship_session_detail_regen.csv'; // bounded / BO / clean-contract regen
const API = process.env.GUNSHIP_API || 'http://localhost:8787/api/doc?profile=default';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null;
const NO_PUT = argv.includes('--no-put');
const fracIdx = argv.indexOf('--is-fraction');
const IS_FRACTION = fracIdx >= 0 ? parseFloat(argv[fracIdx + 1]) : 0.65; // 1.0 = all rows in In-Sample (full by-date timeline)

// ---- maps -----------------------------------------------------------------
const ASSET_ORDER = ['MNQ', 'MES', 'MYM', 'MCL', 'MGC'];
// Regen uses dated NT8 contract names; JUN26 (06-26) is the liquid front month
// across the Feb–Jun data window, so it's the clean MNQ series.
const INSTRUMENT_TO_ASSET = { 'MNQ 06-26': 'MNQ' };

// move name (CSV) → { id, label?, builtin }
const BUILTIN_ORDER = ['1800', '0300', 'MO', 'LB'];
const MOVE_MAP = {
  '1800 Break': { id: '1800', builtin: true },
  '0300 Break': { id: '0300', builtin: true },
  'Market Open Break': { id: 'MO', builtin: true },
  'Lunch Break': { id: 'LB', builtin: true },
  '0300 Transfer': { id: '0300T', label: '0300 Transfer' },
  '1100 Break': { id: '1100', label: '1100 Break' },
  '1400 Break': { id: '1400', label: '1400 Break' },
  'Magic Hour': { id: 'MAGIC', label: 'Magic Hour' },
  'Q1 Break': { id: 'Q1', label: 'Q1 Break' },
};
const CUSTOM_ORDER = ['0300T', '1100', '1400', 'MAGIC', 'Q1'];
const CUSTOM_LABEL = {
  '0300T': '0300 Transfer', '1100': '1100 Break', '1400': '1400 Break',
  MAGIC: 'Magic Hour', Q1: 'Q1 Break',
};

// ---- column index by schema (0-based) -------------------------------------
// common (stable, before the col-16 insert): snapshot 0, instrument 1, move 3,
// session_date 4, direction 5, result 6, entry_px 13.
function cols(nf) {
  if (nf === 28) return { mae: 17, mfe: 18, rq: 26 };
  return { mae: 18, mfe: 19, rq: 27 }; // 29 and 36
}

// ---- parse ----------------------------------------------------------------
const text = readFileSync(CSV_PATH, 'utf8');
const lines = text.split('\n');

// dedup map: key `${asset}|${moveId}|${sessionDate}` → record (latest snapshot wins)
const recs = new Map();
let scanned = 0, kept = 0;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const f = line.split(',');
  const nf = f.length;
  if (nf !== 28 && nf !== 29 && nf !== 36) continue;
  scanned++;

  const asset = INSTRUMENT_TO_ASSET[f[1]];
  if (!asset) continue;
  const mv = MOVE_MAP[f[3]];
  if (!mv) continue;

  const snapshot = f[0];
  const sessionDate = f[4];
  const c = cols(nf);
  const maePct = parseFloat(f[c.mae]);
  const mfePct = parseFloat(f[c.mfe]);
  const refPrice = parseFloat(f[13]);
  const rangePct = parseFloat(f[c.rq]);
  if (!Number.isFinite(maePct) || !Number.isFinite(mfePct)) continue;

  const key = `${asset}|${mv.id}|${sessionDate}`;
  const prev = recs.get(key);
  if (!prev || snapshot > prev.snapshot) {
    recs.set(key, { asset, moveId: mv.id, sessionDate, maePct, mfePct, refPrice, rangePct, snapshot });
  }
}
kept = recs.size;

// ---- group by asset → move → sorted sessions ------------------------------
const byAssetMove = {};
for (const r of recs.values()) {
  (byAssetMove[r.asset] ??= {});
  (byAssetMove[r.asset][r.moveId] ??= []).push(r);
}

function emptyBucket() { return { startDate: null, rows: [] }; }
function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function buildMove(moveId, sessions) {
  const move = {
    minCashflowPct: 0.1,
    defaultContracts: 5,
    maxMaePct: 0, // no stop by default — set per-move in the dashboard
    inSample: emptyBucket(),
    oos1: emptyBucket(),
    oos2: emptyBucket(),
    oos3: emptyBucket(),
  };
  if (CUSTOM_LABEL[moveId]) move.label = CUSTOM_LABEL[moveId];
  if (!sessions || !sessions.length) return move;

  sessions.sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
  const cut = Math.max(1, Math.floor(sessions.length * IS_FRACTION));
  const is = sessions.slice(0, cut);
  const oos = sessions.slice(cut);

  const toRow = (r, idx) => ({
    rowIndex: idx + 1,
    tradeDate: r.sessionDate,
    maePct: r.maePct,
    mfePct: r.mfePct,
    contracts: 5,
    refPrice: Number.isFinite(r.refPrice) ? r.refPrice : null,
  });
  move.inSample.rows = is.map(toRow);
  move.oos1.rows = oos.map(toRow);
  return { move, is, oos };
}

// seed every asset with all built-in + custom moves (empty) so tabs are
// consistent across assets; populate where data exists.
const doc = {};
const report = [];
for (const asset of ASSET_ORDER) {
  const state = {};
  const allMoveIds = [...BUILTIN_ORDER, ...CUSTOM_ORDER];
  for (const moveId of allMoveIds) {
    const sessions = byAssetMove[asset]?.[moveId] ?? [];
    const built = buildMove(moveId, sessions);
    if (built.move) {
      state[moveId] = built.move;
      if (built.is && built.is.length) {
        report.push({
          asset, moveId,
          is: built.is.length, oos: built.oos.length,
          isMedRange: median(built.is.map((r) => r.rangePct)),
          oosMedRange: median(built.oos.map((r) => r.rangePct)),
          isFirst: built.is[0].sessionDate, oosLast: built.oos.length ? built.oos[built.oos.length - 1].sessionDate : '-',
        });
      }
    } else {
      state[moveId] = built; // empty-move case (buildMove returned a bare move)
    }
  }
  doc[asset] = state;
}

// ---- report ---------------------------------------------------------------
console.log(`Scanned ${scanned} schema-valid rows → ${kept} unique (asset,move,session).\n`);
console.log('asset move    IS  OOS  IS_medRange  OOS_medRange  span');
for (const r of report.sort((a, b) => a.asset.localeCompare(b.asset) || a.moveId.localeCompare(b.moveId))) {
  console.log(
    `${r.asset.padEnd(4)} ${r.moveId.padEnd(6)} ${String(r.is).padStart(3)} ${String(r.oos).padStart(4)}  ` +
    `${(r.isMedRange).toFixed(4).padStart(10)}  ${(r.oosMedRange).toFixed(4).padStart(11)}  ${r.isFirst}→${r.oosLast}`,
  );
}

if (OUT) { writeFileSync(OUT, JSON.stringify({ doc }, null, 2)); console.log(`\nWrote ${OUT}`); }

// ---- PUT ------------------------------------------------------------------
if (!NO_PUT) {
  try {
    const res = await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc }),
    });
    console.log(`\nPUT ${API} → ${res.status} ${res.ok ? 'OK' : await res.text()}`);
  } catch (e) {
    console.error(`\nPUT failed (is the server up? \`npm run server\`): ${e.message}`);
    process.exitCode = 1;
  }
}
