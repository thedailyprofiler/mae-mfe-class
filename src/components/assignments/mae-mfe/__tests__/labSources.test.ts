import { buildLabSources, studyIdAtOrdinal, maxStudyCount, keyOf, parseAttempt, attemptValue } from '../labSources';
import { documentReducer, hydrateDocument, DEFAULT_STUDY } from '../maeMfeDocument';

function seed() {
  let doc = hydrateDocument(undefined);
  // Default study: two rows on MNQ·1800 same day (so attempt filter is observable).
  doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', sample: 'inSample', tradeDate: '2026-01-01' });
  doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', sample: 'inSample', tradeDate: '2026-01-01' });
  // A second study on the same move with one row.
  doc = documentReducer(doc, { type: 'ADD_STUDY', asset: 'MNQ', move: '1800', study: 'st_x', label: 'X' });
  doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', study: 'st_x', sample: 'oos1', tradeDate: '2026-02-01' });
  return doc;
}

describe('labSources', () => {
  it('studyIdAtOrdinal: 1 → default, 2 → first extra, overflow → default', () => {
    const ms = seed().MNQ['1800'];
    expect(studyIdAtOrdinal(ms, 1)).toBe(DEFAULT_STUDY);
    expect(studyIdAtOrdinal(ms, 2)).toBe('st_x');
    expect(studyIdAtOrdinal(ms, 9)).toBe(DEFAULT_STUDY); // no 9th study → fall back
  });

  it('maxStudyCount reflects the move with the most studies', () => {
    expect(maxStudyCount(seed())).toBe(2); // MNQ·1800 has default + 1 extra
    expect(maxStudyCount(hydrateDocument(undefined))).toBe(1);
  });

  it('builds sources from the chosen study ordinal', () => {
    const doc = seed();
    const sel = new Set([keyOf('MNQ', '1800')]);
    const def = buildLabSources(doc, sel, 1, { kind: 'all' });
    expect(def[0].rows).toHaveLength(2); // default study's 2 rows
    const study2 = buildLabSources(doc, sel, 2, { kind: 'all' });
    expect(study2[0].rows).toHaveLength(1); // extra study's 1 row
  });

  it('applies the attempt filter within the chosen study', () => {
    const doc = seed();
    const sel = new Set([keyOf('MNQ', '1800')]);
    // Default study has 2 same-day attempts; "only 2nd" keeps 1.
    const only2 = buildLabSources(doc, sel, 1, { kind: 'only', n: 2 });
    expect(only2[0].rows).toHaveLength(1);
    // "1st only" keeps 1 (the first of that day).
    const first1 = buildLabSources(doc, sel, 1, { kind: 'first', n: 1 });
    expect(first1[0].rows).toHaveLength(1);
  });

  it('skips a source whose chosen study has no rows', () => {
    const doc = seed();
    // MES·1800 default study is empty → excluded entirely.
    expect(buildLabSources(doc, new Set([keyOf('MES', '1800')]), 1, { kind: 'all' })).toEqual([]);
  });

  it('attempt value round-trips through parse', () => {
    expect(attemptValue(parseAttempt('all'))).toBe('all');
    expect(attemptValue(parseAttempt('first:2'))).toBe('first:2');
    expect(attemptValue(parseAttempt('only:3'))).toBe('only:3');
  });
});
