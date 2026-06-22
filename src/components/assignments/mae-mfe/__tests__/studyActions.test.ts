import { documentReducer, hydrateDocument, makeStudyId, resolveStudy, DEFAULT_STUDY } from '../maeMfeDocument';

const ROW = { rowIndex: 1, tradeDate: '2026-05-01', maePct: 0.1, mfePct: 0.3, contracts: 5, refPrice: null };

describe('study actions (Phase 3)', () => {
  it('ADD_STUDY creates a named extra study scoped to one (asset, move)', () => {
    const doc = hydrateDocument(undefined);
    const next = documentReducer(doc, { type: 'ADD_STUDY', asset: 'MNQ', move: '1800', study: 'st_1', label: 'Q2 Retest' });
    expect(next.MNQ['1800'].extraStudies?.st_1).toBeDefined();
    expect(next.MNQ['1800'].extraStudies?.st_1.label).toBe('Q2 Retest');
    // Scoped: other moves/assets get no extra study.
    expect(next.MNQ['0300'].extraStudies).toBeUndefined();
    expect(next.MES['1800'].extraStudies).toBeUndefined();
  });

  it('rows route to the targeted study; default and extra are isolated', () => {
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'ADD_STUDY', asset: 'MNQ', move: '1800', study: 'st_1', label: 'S2' });
    // Add a row to the DEFAULT study.
    doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', sample: 'inSample', tradeDate: '2026-05-01' });
    // Add a row to the EXTRA study.
    doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', study: 'st_1', sample: 'inSample', tradeDate: '2026-06-01' });

    expect(doc.MNQ['1800'].inSample.rows).toHaveLength(1); // default study (inline)
    expect(doc.MNQ['1800'].inSample.rows[0].tradeDate).toBe('2026-05-01');
    expect(doc.MNQ['1800'].extraStudies?.st_1.inSample.rows).toHaveLength(1); // extra study
    expect(doc.MNQ['1800'].extraStudies?.st_1.inSample.rows[0].tradeDate).toBe('2026-06-01');
  });

  it('omitting study targets the default (inline) study', () => {
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MES', move: '0300', sample: 'oos2', tradeDate: '2026-05-02' });
    expect(doc.MES['0300'].oos2.rows).toHaveLength(1);
    expect(doc.MES['0300'].extraStudies).toBeUndefined();
  });

  it('RENAME_STUDY changes the label, never the key', () => {
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'ADD_STUDY', asset: 'MNQ', move: 'MO', study: 'st_r', label: 'Old' });
    const next = documentReducer(doc, { type: 'RENAME_STUDY', asset: 'MNQ', move: 'MO', study: 'st_r', label: 'New' });
    expect(next.MNQ['MO'].extraStudies?.st_r).toBeDefined();
    expect(next.MNQ['MO'].extraStudies?.st_r.label).toBe('New');
  });

  it('DELETE_STUDY removes an extra study but never the default', () => {
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'ADD_STUDY', asset: 'MNQ', move: 'LB', study: 'st_d', label: 'Del' });
    let next = documentReducer(doc, { type: 'DELETE_STUDY', asset: 'MNQ', move: 'LB', study: 'st_d' });
    expect(next.MNQ['LB'].extraStudies?.st_d).toBeUndefined();
    // Deleting 'default' is a no-op (the inline buckets are not removable).
    next = documentReducer(doc, { type: 'DELETE_STUDY', asset: 'MNQ', move: 'LB', study: DEFAULT_STUDY });
    expect(next.MNQ['LB'].inSample).toBeDefined();
  });

  it('resolveStudy returns inline buckets for default, the extra study otherwise', () => {
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'ADD_STUDY', asset: 'MNQ', move: '1800', study: 'st_x', label: 'X' });
    doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', study: 'st_x', sample: 'oos1', tradeDate: '2026-07-01' });
    const ms = doc.MNQ['1800'];
    expect(resolveStudy(ms, DEFAULT_STUDY).inSample).toBe(ms.inSample);
    expect(resolveStudy(ms, 'st_x').oos1.rows).toHaveLength(1);
    // Missing id resolves to an empty study (never throws).
    expect(resolveStudy(ms, 'st_missing').inSample.rows).toEqual([]);
  });

  it('an extra study with data survives a persistence round-trip', () => {
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'ADD_STUDY', asset: 'MCL', move: '1800', study: 'st_rt', label: 'Round' });
    doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MCL', move: '1800', study: 'st_rt', sample: 'inSample', tradeDate: '2026-08-01' });
    const reloaded = hydrateDocument(doc);
    expect(reloaded.MCL['1800'].extraStudies?.st_rt.label).toBe('Round');
    expect(reloaded.MCL['1800'].extraStudies?.st_rt.inSample.rows).toHaveLength(1);
    // Default study still empty + intact.
    expect(reloaded.MCL['1800'].inSample.rows).toEqual([]);
  });

  it('a blob WITHOUT extraStudies hydrates unchanged (no key added)', () => {
    const doc = hydrateDocument(undefined);
    doc.MNQ['1800'].inSample.rows.push({ ...ROW });
    const reloaded = hydrateDocument(doc);
    expect(reloaded.MNQ['1800'].extraStudies).toBeUndefined();
    expect(reloaded).toEqual(doc);
  });

  it('makeStudyId produces st_-prefixed ids', () => {
    expect(makeStudyId().startsWith('st_')).toBe(true);
  });

  // Study-aware routing for every row op — writes must hit the targeted study
  // and never corrupt the default study or sibling studies.
  describe('row ops route to the targeted study without cross-contamination', () => {
    function withTwoStudies() {
      let doc = hydrateDocument(undefined);
      doc = documentReducer(doc, { type: 'ADD_STUDY', asset: 'MNQ', move: '1800', study: 'st_a', label: 'A' });
      doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', sample: 'inSample', tradeDate: '2026-01-01' }); // default
      doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', study: 'st_a', sample: 'inSample', tradeDate: '2026-02-01' }); // study A
      return doc;
    }

    it('SET_START_DATE on a study touches only that study', () => {
      let doc = withTwoStudies();
      doc = documentReducer(doc, { type: 'SET_START_DATE', asset: 'MNQ', move: '1800', study: 'st_a', sample: 'inSample', startDate: '2026-02-01' });
      expect(doc.MNQ['1800'].extraStudies?.st_a.inSample.startDate).toBe('2026-02-01');
      expect(doc.MNQ['1800'].inSample.startDate).toBeNull(); // default untouched
    });

    it('UPDATE_ROW on the default study leaves the extra study untouched', () => {
      let doc = withTwoStudies();
      doc = documentReducer(doc, { type: 'UPDATE_ROW', asset: 'MNQ', move: '1800', sample: 'inSample', rowIndex: 1, patch: { maePct: 0.99 } });
      expect(doc.MNQ['1800'].inSample.rows[0].maePct).toBe(0.99);
      expect(doc.MNQ['1800'].extraStudies?.st_a.inSample.rows[0].maePct).not.toBe(0.99); // study A intact
    });

    it('UPDATE_ROW on a study leaves the default study untouched', () => {
      let doc = withTwoStudies();
      doc = documentReducer(doc, { type: 'UPDATE_ROW', asset: 'MNQ', move: '1800', study: 'st_a', sample: 'inSample', rowIndex: 1, patch: { mfePct: 0.77 } });
      expect(doc.MNQ['1800'].extraStudies?.st_a.inSample.rows[0].mfePct).toBe(0.77);
      expect(doc.MNQ['1800'].inSample.rows[0].mfePct).not.toBe(0.77);
    });

    it('DELETE_ROW on a study removes only that study\'s row', () => {
      let doc = withTwoStudies();
      doc = documentReducer(doc, { type: 'DELETE_ROW', asset: 'MNQ', move: '1800', study: 'st_a', sample: 'inSample', rowIndex: 1 });
      expect(doc.MNQ['1800'].extraStudies?.st_a.inSample.rows).toHaveLength(0);
      expect(doc.MNQ['1800'].inSample.rows).toHaveLength(1); // default still has its row
    });

    it('RENAME_STUDY on a non-existent study is a no-op', () => {
      const doc = hydrateDocument(undefined);
      const next = documentReducer(doc, { type: 'RENAME_STUDY', asset: 'MNQ', move: '1800', study: 'st_missing', label: 'x' });
      expect(next).toEqual(doc); // no change — no phantom study created
      expect(next.MNQ['1800'].extraStudies).toBeUndefined();
    });
  });
});

describe('SEED_DATES action', () => {
  it('bulk-adds empty rows per date, sorted, and dedupes on re-seed', () => {
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'SEED_DATES', asset: 'MNQ', move: '1800', sample: 'oos1', dates: ['2026-03-03', '2026-03-01', '2026-03-02'] });
    let rows = doc.MNQ['1800'].oos1.rows;
    expect(rows.map((r) => r.tradeDate)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03']); // sorted
    expect(rows.every((r) => r.maePct === 0 || Number.isFinite(r.maePct))).toBe(true);
    // Re-seed overlapping + new dates → only the genuinely new one is appended.
    doc = documentReducer(doc, { type: 'SEED_DATES', asset: 'MNQ', move: '1800', sample: 'oos1', dates: ['2026-03-02', '2026-03-05'] });
    rows = doc.MNQ['1800'].oos1.rows;
    expect(rows.map((r) => r.tradeDate)).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-05']);
    // unique rowIndexes
    expect(new Set(rows.map((r) => r.rowIndex)).size).toBe(rows.length);
  });
  it('seeding an empty date list adds no rows', () => {
    const doc = hydrateDocument(undefined);
    const next = documentReducer(doc, { type: 'SEED_DATES', asset: 'MNQ', move: '1800', sample: 'oos1', dates: [] });
    expect(next.MNQ['1800'].oos1.rows).toHaveLength(0);
  });
});
