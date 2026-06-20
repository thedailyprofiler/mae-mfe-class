import { hydrateDocument, documentReducer } from '../maeMfeDocument';
import { ASSET_ORDER } from '../../../../lib/assets';

describe('hydrateDocument', () => {
  it('builds an empty per-asset document from nothing (3 OOS each)', () => {
    const doc = hydrateDocument(undefined);
    expect(Object.keys(doc).sort()).toEqual([...ASSET_ORDER].sort());
    for (const a of ASSET_ORDER) {
      expect(doc[a]['1800'].inSample.rows).toEqual([]);
      expect(doc[a]['1800'].oos1.rows).toEqual([]);
      expect(doc[a]['1800'].oos2.rows).toEqual([]);
      expect(doc[a]['1800'].oos3.rows).toEqual([]);
      expect(doc[a]['1800'].defaultContracts).toBe(5);
    }
  });

  it('migrates a legacy MNQ-only submission: outOfSample → oos1, others empty', () => {
    // Pre-multi-asset, pre-multi-OOS shape (bare move keys, single outOfSample).
    const legacy = {
      '1800': {
        minCashflowPct: 0.1,
        defaultContracts: 2,
        inSample: { startDate: '2026-01-05', rows: [{ rowIndex: 1, tradeDate: '2026-01-05', maePct: 0.05, mfePct: 0.2, contracts: 2, refPrice: null }] },
        outOfSample: { startDate: '2026-02-01', rows: [{ rowIndex: 1, tradeDate: '2026-02-01', maePct: 0.1, mfePct: 0.3, contracts: 2, refPrice: null }] },
      },
    } as unknown as Parameters<typeof hydrateDocument>[0];

    const doc = hydrateDocument(legacy);
    // Folded under MNQ.
    expect(doc.MNQ['1800'].inSample.rows).toHaveLength(1);
    expect(doc.MNQ['1800'].defaultContracts).toBe(2);
    // outOfSample carried into oos1 (no data loss); oos2/oos3 empty.
    expect(doc.MNQ['1800'].oos1.rows).toHaveLength(1);
    expect(doc.MNQ['1800'].oos1.startDate).toBe('2026-02-01');
    expect(doc.MNQ['1800'].oos2.rows).toEqual([]);
    expect(doc.MNQ['1800'].oos3.rows).toEqual([]);
    // Other assets remain empty.
    expect(doc.MES['1800'].inSample.rows).toEqual([]);
  });

  it('round-trips a new per-asset document with OOS data', () => {
    const docIn = hydrateDocument(undefined);
    docIn.MNQ['0300'].oos3.rows.push({ rowIndex: 1, tradeDate: '2026-02-02', maePct: 0.1, mfePct: 0.3, contracts: 5, refPrice: null });
    const docOut = hydrateDocument(docIn);
    expect(docOut.MNQ['0300'].oos3.rows).toHaveLength(1);
    expect(docOut.MES['1800'].oos2.rows).toEqual([]);
  });

  // ── Phase 1A: production-shape fidelity + custom-move survival ──────────────

  it('migrates the EXACT production legacy blob shape with zero data loss', () => {
    // Faithful to the single live legacy submission (prod read-only inventory
    // 2026-06-07): bare-move top-level keys, single `outOfSample`, defaultContracts 1.
    const prodLegacy = {
      '1800': {
        minCashflowPct: 0.1,
        defaultContracts: 1,
        inSample: { startDate: null, rows: [{ rowIndex: 1, tradeDate: '2026-03-02', maePct: 0.07, mfePct: 0.24, contracts: 1, refPrice: null }] },
        outOfSample: { startDate: null, rows: [] },
      },
      '0300': { minCashflowPct: 0.1, defaultContracts: 1, inSample: { startDate: null, rows: [] }, outOfSample: { startDate: null, rows: [] } },
      MO: { minCashflowPct: 0.1, defaultContracts: 1, inSample: { startDate: null, rows: [] }, outOfSample: { startDate: null, rows: [] } },
      LB: { minCashflowPct: 0.1, defaultContracts: 1, inSample: { startDate: null, rows: [] }, outOfSample: { startDate: null, rows: [] } },
    } as unknown as Parameters<typeof hydrateDocument>[0];

    const doc = hydrateDocument(prodLegacy);
    // Folded under MNQ; the single IS row preserved.
    expect(doc.MNQ['1800'].inSample.rows).toHaveLength(1);
    expect(doc.MNQ['1800'].inSample.rows[0].mfePct).toBe(0.24);
    expect(doc.MNQ['1800'].defaultContracts).toBe(1);
    // outOfSample → oos1 for every move; all four built-ins present.
    for (const m of ['1800', '0300', 'MO', 'LB'] as const) {
      expect(doc.MNQ[m].oos1.rows).toEqual([]);
      expect(doc.MNQ[m].oos2.rows).toEqual([]);
      expect(doc.MNQ[m].oos3.rows).toEqual([]);
    }
    // Other assets untouched.
    expect(doc.MES['1800'].inSample.rows).toEqual([]);
  });

  it('PRESERVES a custom move key across a hydrate round-trip (Phase 1A foundation)', () => {
    const withCustom = {
      MNQ: {
        '1800': { minCashflowPct: 0.1, defaultContracts: 5, inSample: { startDate: null, rows: [] }, oos1: { startDate: null, rows: [] }, oos2: { startDate: null, rows: [] }, oos3: { startDate: null, rows: [] } },
        mv_custom: {
          minCashflowPct: 0.2,
          defaultContracts: 3,
          inSample: { startDate: '2026-04-01', rows: [{ rowIndex: 1, tradeDate: '2026-04-01', maePct: 0.1, mfePct: 0.4, contracts: 3, refPrice: null }] },
          oos1: { startDate: null, rows: [] }, oos2: { startDate: null, rows: [] }, oos3: { startDate: null, rows: [] },
        },
      },
    } as unknown as Parameters<typeof hydrateDocument>[0];

    const doc = hydrateDocument(withCustom);
    // The custom move and its data survive (before 1A, normalizeState dropped it).
    expect(doc.MNQ['mv_custom']).toBeDefined();
    expect(doc.MNQ['mv_custom'].inSample.rows).toHaveLength(1);
    expect(doc.MNQ['mv_custom'].defaultContracts).toBe(3);
    // Built-ins still present alongside it.
    expect(doc.MNQ['1800'].inSample.rows).toEqual([]);
  });

  it('is an identity on a current multi-asset blob (no data field added/removed)', () => {
    const current = hydrateDocument(undefined);
    current.MES['0300'].inSample.rows.push({ rowIndex: 1, tradeDate: '2026-05-01', maePct: 0.03, mfePct: 0.5, contracts: 5, refPrice: 21000 });
    current.MCL['LB'].oos2.startDate = '2026-05-10';
    // Hydrating an already-current document must return deep-equal data.
    expect(hydrateDocument(current)).toEqual(current);
  });

  // ── Non-destructive: migration is idempotent + stale-bundle safe ────────────

  it('is IDEMPOTENT on a fully-loaded blob (custom move + extra study + rows + labels)', () => {
    let doc = hydrateDocument(undefined);
    // Custom move on all assets + an extra study with data + a default-study row.
    doc = documentReducer(doc, { type: 'ADD_MOVE', id: 'mv_a', label: 'Custom A' });
    doc = documentReducer(doc, { type: 'ADD_STUDY', asset: 'MNQ', move: 'mv_a', study: 'st_1', label: 'Study One' });
    doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: 'mv_a', study: 'st_1', sample: 'oos1', tradeDate: '2026-03-01' });
    doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', sample: 'inSample', tradeDate: '2026-03-02' });
    const once = hydrateDocument(doc);
    const twice = hydrateDocument(once);
    // A second hydrate changes nothing — the migration is a fixed point.
    expect(twice).toEqual(once);
    // And hydrating the live doc preserves every addition.
    expect(once.MNQ['mv_a'].label).toBe('Custom A');
    expect(once.MNQ['mv_a'].extraStudies?.st_1.label).toBe('Study One');
    expect(once.MNQ['mv_a'].extraStudies?.st_1.oos1.rows).toHaveLength(1);
    expect(once.MNQ['1800'].inSample.rows).toHaveLength(1);
  });

  it('STALE-BUNDLE safety: existing inline (default-study) rows survive even if new fields are stripped', () => {
    // Simulate what an OLDER deployed bundle does when it saves a new-shape blob:
    // its normalize() rebuilds only the fields it knows, dropping `label` + `extraStudies`.
    let doc = hydrateDocument(undefined);
    doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', sample: 'inSample', tradeDate: '2026-04-01' });
    doc = documentReducer(doc, { type: 'ADD_STUDY', asset: 'MNQ', move: '1800', study: 'st_x', label: 'X' });
    doc = documentReducer(doc, { type: 'ADD_ROW', asset: 'MNQ', move: '1800', study: 'st_x', sample: 'inSample', tradeDate: '2026-04-02' });

    // Strip the additive overlay fields (what an old bundle would not write back).
    const stripped = JSON.parse(JSON.stringify(doc));
    for (const a of Object.keys(stripped)) {
      for (const mv of Object.keys(stripped[a])) {
        delete stripped[a][mv].label;
        delete stripped[a][mv].extraStudies;
      }
    }
    const rehydrated = hydrateDocument(stripped);
    // The 1,334-rows-equivalent (inline default-study data) is intact; only the
    // brand-new extra study is lost — never the existing inline rows.
    expect(rehydrated.MNQ['1800'].inSample.rows).toHaveLength(1);
    expect(rehydrated.MNQ['1800'].inSample.rows[0].tradeDate).toBe('2026-04-01');
    expect(rehydrated.MNQ['1800'].extraStudies).toBeUndefined();
  });
});
