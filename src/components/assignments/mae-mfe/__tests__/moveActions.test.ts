import { documentReducer, hydrateDocument, makeMoveId } from '../maeMfeDocument';
import { ASSET_ORDER } from '../../../../lib/assets';

describe('custom move actions (Phase 2)', () => {
  it('ADD_MOVE adds the move to EVERY asset with its label', () => {
    const doc = hydrateDocument(undefined);
    const id = 'mv_test';
    const next = documentReducer(doc, { type: 'ADD_MOVE', id, label: 'Morning Gap' });
    for (const a of ASSET_ORDER) {
      expect(next[a][id]).toBeDefined();
      expect(next[a][id].label).toBe('Morning Gap');
      expect(next[a][id].inSample.rows).toEqual([]);
      expect(next[a][id].defaultContracts).toBe(5);
    }
    // Built-ins untouched.
    expect(next.MNQ['1800']).toBeDefined();
  });

  it('ADD_MOVE does not clobber an existing move with the same id', () => {
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'ADD_MOVE', id: 'mv_keep', label: 'Keep' });
    doc.MNQ['mv_keep'].inSample.rows.push({ rowIndex: 1, tradeDate: '2026-05-01', maePct: 0.1, mfePct: 0.3, contracts: 5, refPrice: null });
    const next = documentReducer(doc, { type: 'ADD_MOVE', id: 'mv_keep', label: 'Keep' });
    expect(next.MNQ['mv_keep'].inSample.rows).toHaveLength(1); // data preserved
  });

  it('RENAME_MOVE changes the label on every asset, never the key', () => {
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'ADD_MOVE', id: 'mv_r', label: 'Old' });
    const next = documentReducer(doc, { type: 'RENAME_MOVE', id: 'mv_r', label: 'New' });
    for (const a of ASSET_ORDER) {
      expect(next[a]['mv_r']).toBeDefined(); // key intact
      expect(next[a]['mv_r'].label).toBe('New');
    }
  });

  it('DELETE_MOVE removes a custom move from every asset', () => {
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'ADD_MOVE', id: 'mv_del', label: 'Del' });
    const next = documentReducer(doc, { type: 'DELETE_MOVE', id: 'mv_del' });
    for (const a of ASSET_ORDER) expect(next[a]['mv_del']).toBeUndefined();
  });

  it('DELETE_MOVE refuses to delete a built-in move', () => {
    const doc = hydrateDocument(undefined);
    const next = documentReducer(doc, { type: 'DELETE_MOVE', id: '1800' });
    expect(next.MNQ['1800']).toBeDefined();
  });

  it('a custom move + its label survive a persistence round-trip', () => {
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'ADD_MOVE', id: 'mv_rt', label: 'Round Trip' });
    doc.MES['mv_rt'].oos2.rows.push({ rowIndex: 1, tradeDate: '2026-06-01', maePct: 0.2, mfePct: 0.4, contracts: 5, refPrice: null });
    const reloaded = hydrateDocument(doc); // simulate save → reload
    expect(reloaded.MES['mv_rt'].label).toBe('Round Trip');
    expect(reloaded.MES['mv_rt'].oos2.rows).toHaveLength(1);
  });

  it('makeMoveId produces unique mv_-prefixed ids', () => {
    const a = makeMoveId();
    expect(a.startsWith('mv_')).toBe(true);
  });

  describe('PATCH_CONFIG contracts propagation (bug fix)', () => {
    it('changing defaultContracts rewrites EVERY existing row across buckets + studies', () => {
      let doc = hydrateDocument(undefined);
      // Rows added at default 5.
      doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', sample: 'inSample', tradeDate: '2026-01-01' });
      doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', sample: 'oos2', tradeDate: '2026-01-02' });
      doc = documentReducer(doc, { type: 'ADD_STUDY', asset: 'MNQ', move: '1800', study: 'st_1', label: 'S2' });
      doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', study: 'st_1', sample: 'inSample', tradeDate: '2026-01-03' });
      expect(doc.MNQ['1800'].inSample.rows[0].contracts).toBe(5);

      doc = documentReducer(doc, { type: 'PATCH_CONFIG', asset: 'MNQ', move: '1800', patch: { defaultContracts: 12 } });

      expect(doc.MNQ['1800'].defaultContracts).toBe(12);
      expect(doc.MNQ['1800'].inSample.rows[0].contracts).toBe(12); // default-study bucket
      expect(doc.MNQ['1800'].oos2.rows[0].contracts).toBe(12);     // another bucket
      expect(doc.MNQ['1800'].extraStudies?.st_1.inSample.rows[0].contracts).toBe(12); // extra study too
    });

    it('a min-cashflow-only change leaves row contracts untouched', () => {
      let doc = hydrateDocument(undefined);
      doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', sample: 'inSample', tradeDate: '2026-01-01' });
      doc = documentReducer(doc, { type: 'PATCH_CONFIG', asset: 'MNQ', move: '1800', patch: { minCashflowPct: 0.25 } });
      expect(doc.MNQ['1800'].minCashflowPct).toBe(0.25);
      expect(doc.MNQ['1800'].inSample.rows[0].contracts).toBe(5); // unchanged
    });
  });
});
