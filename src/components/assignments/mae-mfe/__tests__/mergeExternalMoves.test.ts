import { mergeExternalMoves, documentReducer } from '../maeMfeDocument';
import type { MaeMfeDocument } from '../maeMfeDocument';

const bucket = (n: number) => ({ startDate: null, rows: Array.from({ length: n }, (_, i) => ({ rowIndex: i + 1, tradeDate: `2026-02-${String(i + 1).padStart(2, '0')}`, maePct: 0.1, mfePct: 0.2, contracts: 5, refPrice: null })) });
const empty = { startDate: null, rows: [] };
const move = (rows: number, label?: string) => ({ minCashflowPct: 0.1, defaultContracts: 5, maxMaePct: 0, ...(label ? { label } : {}), inSample: bucket(rows), oos1: empty, oos2: empty, oos3: empty });
const blankAsset = () => ({ '1800': move(0), '0300': move(0), MO: move(0), LB: move(0) });

function docWith(over: Record<string, Record<string, ReturnType<typeof move>>>): MaeMfeDocument {
  const d: any = {};
  for (const a of ['MNQ', 'MES', 'MYM', 'MCL', 'MGC', 'RTY']) d[a] = { ...blankAsset(), ...(over[a] || {}) };
  return d;
}

describe('mergeExternalMoves', () => {
  it('fills a missing/empty move from incoming (CLI added rows)', () => {
    const local = docWith({});                                   // MNQ 0300 empty
    const remote = docWith({ MNQ: { '0300': move(100) } });      // server has 100 rows
    const merged = mergeExternalMoves(local, remote);
    expect(merged.MNQ['0300'].inSample.rows.length).toBe(100);
  });

  it('adds a brand-new custom move present only on the server', () => {
    const local = docWith({});
    const remote = docWith({ MNQ: { '0300FR': move(100, '0300 Front Run') } });
    const merged = mergeExternalMoves(local, remote);
    expect(merged.MNQ['0300FR'].inSample.rows.length).toBe(100);
    expect(merged.MNQ['0300FR'].label).toBe('0300 Front Run');
  });

  it('never overwrites a local move that already has data (preserves edits)', () => {
    const local = docWith({ MNQ: { '1800': move(50) } });        // local edited: 50 rows
    const remote = docWith({ MNQ: { '1800': move(100) } });      // server: 100 rows
    const merged = mergeExternalMoves(local, remote);
    expect(merged.MNQ['1800'].inSample.rows.length).toBe(50);    // local wins
  });

  it('returns the same reference when nothing changes (render bail-out)', () => {
    const local = docWith({ MNQ: { '0300': move(100) } });
    const remote = docWith({ MNQ: { '0300': move(100) } });      // both have data
    expect(mergeExternalMoves(local, remote)).toBe(local);
  });

  it('the reducer MERGE_EXTERNAL action delegates to the merge (anti-clobber)', () => {
    const local = docWith({});
    const remote = docWith({ MES: { '0300MA': move(218, '0300 Multiple Attempt') } });
    const next = documentReducer(local, { type: 'MERGE_EXTERNAL', incoming: remote });
    expect(next.MES['0300MA'].inSample.rows.length).toBe(218);
  });
});
