/**
 * MaeMfeAnalysisView — single-dashboard MAE/MFE Analysis.
 *
 * Mirrors the source XLSX: one workbook, one sheet per gunship move — except
 * the sheet tabs live at the TOP. An asset switcher above the tabs picks the
 * instrument (MNQ / MES / MYM / MCL / MGC); each asset keeps its own data and
 * is priced with its own contract spec. Within a move, a segmented control
 * switches In Sample / Out of Sample / Both / Compare.
 *
 * State + persistence migration live in ./maeMfeDocument (one MaeMfeState per
 * asset; legacy MNQ-only blobs are folded under MNQ on hydrate).
 */
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { GunshipMove } from '../../../lib/maeMfeStats';
import { ASSETS, ASSET_ORDER, type AssetTicker } from '../../../lib/assets';
import { DEFAULT_MOVE_ORDER, getMoveLabel, isBuiltinMove } from '../../../lib/moveRegistry';
import { MoveDashboard, type SampleTab } from './MoveDashboard';
import { CombineComparePanel } from './CombineComparePanel';
import { CyclingPanel } from './CyclingPanel';
import { CorrelationPanel } from './CorrelationPanel';
import { MonteCarloPanel } from './MonteCarloPanel';
import { PropSimPanel } from './PropSimPanel';
import { PortfolioPanel } from './PortfolioPanel';
import { SetupRecommenderPanel } from './SetupRecommenderPanel';
import { recommendSafestConfig, type SetupRec } from '../../../lib/setupRecommender';
import { mulberry32, moveDailyDollars, runPropSim, type PropRules } from '../../../lib/propSim';
import type { RawRow } from '../../../lib/maeMfeStats';
import { HelpPanel } from './HelpPanel';
import { documentReducer, hydrateDocument, makeMoveId, makeStudyId, DEFAULT_STUDY } from './maeMfeDocument';
import { STEP_GUIDES } from './userGuide';
import { loadDoc } from '../../../storage';
import type { MaeMfeDocument, MaeMfeState } from './maeMfeDocument';

// Re-export for existing importers (e.g. MaeMfeAssignment).
export type { MaeMfeDocument, MaeMfeState } from './maeMfeDocument';

// =============================================================================
// Moves — XLSX sheet tabs, relocated to the top
// =============================================================================

function movesForTier(accessTier: string | null | undefined): GunshipMove[] {
  // Bootcamp tier: 1800 / 0300 / MO / LB. Pack tier unlocks the full list
  // (same four today; extend here when new moves ship). Custom user-defined
  // moves are always the user's own and are appended in the view regardless.
  void accessTier;
  return [...DEFAULT_MOVE_ORDER];
}

// =============================================================================
// StepBar — collapsible "step" section for the guided 5-step layout.
// Purely presentational; the shared document/state drives every step so nothing
// desyncs between them.
// =============================================================================
function StepBar({ n, title, badge, open, onToggle, children }: {
  n: number; title: string; badge?: string; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <div className="mb-2 border border-[var(--color-border)] rounded-[8px] overflow-hidden bg-[var(--color-bg-inset)]/30">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-testid={`mae-mfe-step-${n}`}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--color-bg-secondary)]/40 transition-colors"
      >
        <span className="flex items-center justify-center w-6 h-6 rounded-full border border-[var(--color-accent-dim)] text-[var(--color-accent)] font-[var(--font-mono)] text-[11px] shrink-0">{n}</span>
        <span className="text-[14px] font-semibold text-[var(--color-text-primary)]">{title}</span>
        {badge && <span className="text-[8px] uppercase tracking-[0.14em] text-[var(--color-text-muted)] border border-[var(--color-border)] rounded px-1.5 py-0.5">{badge}</span>}
        <span className="ml-auto text-[var(--color-text-muted)] text-[13px]">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-4 pb-4 pt-2 border-t border-[var(--color-border)]">{children}</div>}
    </div>
  );
}

// "Loaded here from …" banner shown in a lab after an Apply→ / Send→ from elsewhere.
function AppliedBanner({ text, onClear }: { text: string; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 mb-2 px-3 py-1.5 rounded-[6px] border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[10px]">
      <span className="text-[var(--color-accent)] font-semibold">✓ Loaded here from:</span>
      <span className="text-[var(--color-text-primary)]">{text}</span>
      <button type="button" onClick={onClear} className="ml-auto text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]" title="Dismiss">✕</button>
    </div>
  );
}

// Collapsible plain-language guide shown at the top of each step (📖 Guide).
function SectionGuide({ step }: { step: number }) {
  const g = STEP_GUIDES[step];
  const [open, setOpen] = useState(false);
  if (!g) return null;
  return (
    <div className="mb-3">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">
        <span>📖 Guide</span><span className="text-[var(--color-text-muted)]">{open ? '▾' : '▸'} {open ? 'hide' : 'how this step works'}</span>
      </button>
      {open && (
        <div className="mt-2 p-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-bg-inset)]/40">
          <p className="text-[11px] text-[var(--color-text-primary)] mb-1.5">{g.what}</p>
          <ul className="list-disc pl-4 space-y-1">
            {g.how.map((h, i) => <li key={i} className="text-[10px] text-[var(--color-text-secondary)] leading-snug">{h}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// A numbered "sub-step" inside Step 2 — a gold ring with a gold number badge so
// the user reads the pick order top-to-bottom: ① asset → ② move → ③ risk.
function SubStep({ n, label, hint, children }: { n: number; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mb-3 rounded-[8px] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/[0.04] p-3">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-accent)] text-black font-[var(--font-mono)] text-[10px] font-bold shrink-0">{n}</span>
        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-accent)] font-semibold">{label}</span>
        {hint && <span className="text-[10px] text-[var(--color-text-secondary)]">— {hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Compact numeric field for the global Account Profile bar. */
function AcctField({ label, value, onChange, step = 1, min = 0, width = 84 }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; width?: number }) {
  return (
    <label className="flex flex-col gap-1 text-[10px]">
      <span className="text-[var(--color-text-secondary)] uppercase tracking-wide">{label}</span>
      <input type="number" min={min} step={step} value={value} onChange={(e) => onChange(Math.max(min, +e.target.value || 0))}
        style={{ width }} className="bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2 py-1 text-[var(--color-text-primary)] font-[var(--font-mono)]" />
    </label>
  );
}

// Live "what will this setup do at my account profile" readout for the ③ ring.
// Runs a quick bootstrap prop-sim on the CURRENT config (contracts / MFE target /
// Max MAE / attempts) so the pass/bust bar updates as the user edits the row.
function RiskReadout({ ms, asset, rules, mode }: { ms: MaeMfeState[string]; asset: AssetTicker; rules: PropRules; mode: 'prop' | 'live' }) {
  const res = useMemo(() => {
    const { dollars } = moveDailyDollars(ms, asset, ms.defaultContracts);
    if (dollars.length === 0) return null;
    return runPropSim(dollars, rules, { mode: 'bootstrap', sims: 400, rng: mulberry32(1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms.minCashflowPct, ms.maxMaePct, ms.defaultContracts, ms.attemptMode, asset, rules.profitTarget, rules.maxDrawdown, rules.maxDays, rules.ddMode, rules.dailyLossLimit, rules.minTradingDays, mode]);
  if (!res) return <p className="text-[10px] text-[var(--color-text-muted)]">Add trades to simulate this setup’s risk of ruin.</p>;
  const { passRate: pass, bustRate: bust, activeRate: active, medianDaysToPass, meanFinal } = res;
  const seg = (w: number, bg: string) => (w > 0 ? <div key={bg} style={{ width: `${w * 100}%`, background: bg }} className="overflow-hidden text-center text-[var(--color-text-primary)]">{w >= 0.16 ? `${(w * 100).toFixed(0)}%` : ''}</div> : null);
  const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">This setup at your account profile</span>
        <span className="text-[9px] text-[var(--color-text-muted)]">{mode === 'prop' ? 'prop eval' : 'live capital'} · {ms.defaultContracts}ct · MFE {ms.minCashflowPct}% · Max MAE {(ms.maxMaePct ?? 0) > 0 ? `${ms.maxMaePct}%` : 'off'}</span>
      </div>
      <div className="flex h-[14px] w-full max-w-[520px] rounded-[3px] overflow-hidden border border-[var(--color-border)] text-[9px] leading-[14px] font-[var(--font-mono)]">
        {seg(pass, 'rgba(95,174,127,0.55)')}{seg(active, 'rgba(150,150,150,0.35)')}{seg(bust, 'rgba(208,102,102,0.55)')}
      </div>
      <div className="text-[9px] text-[var(--color-text-secondary)] mt-1">🟩 hit target {(pass * 100).toFixed(0)}% · ⬜ still trading {(active * 100).toFixed(0)}% · 🟥 busted {(bust * 100).toFixed(0)}%</div>
      <div className="text-[10px] text-[var(--color-text-primary)] mt-0.5">{medianDaysToPass != null ? `~${Math.round(medianDaysToPass)}d to target · ` : ''}avg result {usd(meanFinal)}</div>
    </div>
  );
}

// =============================================================================
// View
// =============================================================================

export interface MaeMfeAnalysisViewProps {
  accessTier?: string | null;
  /** Persisted blob — new per-asset document, or a legacy MNQ-only state. */
  initialState?: Partial<MaeMfeDocument> | Partial<MaeMfeState>;
  /** Persist callback — fires (debounced upstream) on every state change. */
  onChange?: (state: MaeMfeDocument) => void;
  readOnly?: boolean;
}

export function MaeMfeAnalysisView({
  accessTier,
  initialState,
  onChange,
  readOnly,
}: MaeMfeAnalysisViewProps) {
  const [doc, dispatch] = useReducer(
    documentReducer,
    undefined,
    () => hydrateDocument(initialState),
  );
  const [activeAsset, setActiveAsset] = useState<AssetTicker>('MNQ');
  const [activeMove, setActiveMove] = useState<GunshipMove>('1800');
  const [activeTab, setActiveTab] = useState<SampleTab>('IN_SAMPLE');
  const [activeStudy, setActiveStudy] = useState<string>(DEFAULT_STUDY);
  const [lab, setLab] = useState<null | 'compare' | 'cycle' | 'correlate' | 'montecarlo' | 'propsim' | 'portfolio'>(null);
  // Shared lab selections — lifted so Monte Carlo (and others) can resample the
  // Combine basket / Cycle stream the user built, not just a single move.
  const [combineSetA, setCombineSetA] = useState<Set<string>>(new Set());
  const [cycleSel, setCycleSel] = useState<Set<string>>(new Set());
  const [cycleN, setCycleN] = useState(5);
  const [cycleK, setCycleK] = useState(1);
  const [portfolioPreset, setPortfolioPreset] = useState<string[] | null>(null);
  // "What did I just load, and from where" — shown as a banner in the destination lab.
  const [appliedNote, setAppliedNote] = useState<{ lab: string; text: string } | null>(null);
  // Apply a recommended basket/move into a chosen lab and jump there. Must OPEN the
  // step that contains the lab (Compare/Cycle/MonteCarlo/PropSim live in Step 3;
  // Correlate/Portfolio in Step 4) — otherwise the panel doesn't render.
  const applyBasketTo = (keys: string[], target: 'compare' | 'cycle' | 'montecarlo' | 'portfolio' | 'propsim', source?: string) => {
    if (target === 'cycle') setCycleSel(new Set(keys));
    else if (target === 'portfolio') setPortfolioPreset(keys);
    else setCombineSetA(new Set(keys)); // compare + monte carlo + prop sim read Set A / the combined source
    const moves = `${keys.length} move${keys.length === 1 ? '' : 's'}`;
    setAppliedNote({ lab: target, text: source ? `${source} · ${moves}` : moves });
    setOpenStep(target === 'portfolio' ? 4 : 3);
    setLab(target);
  };
  // Guided 5-step accordion: which step is expanded (default Step 2 — Build your plan).
  const [openStep, setOpenStep] = useState<number | null>(2);
  const openStepToggle = (n: number) => { setOpenStep((s) => (s === n ? null : n)); setLab(null); };

  // Global ACCOUNT PROFILE — set once, drives both recommenders (Step 2 setup + Step 4 portfolio).
  const [acctMode, setAcctMode] = useState<'prop' | 'live'>('prop');
  const [sizeContracts, setSizeContracts] = useState(5);
  const [acctRules, setAcctRules] = useState<PropRules>({ accountSize: 50000, profitTarget: 3000, maxDrawdown: 2000, ddMode: 'trailing', dailyLossLimit: 0, minTradingDays: 0, maxDays: 60 });
  const setRule = <K extends keyof PropRules>(k: K, v: PropRules[K]) => setAcctRules((r) => ({ ...r, [k]: v }));
  // Live capital is sized/measured differently: max drawdown as a % from the
  // high-water mark (relative, trailing), over a horizon — not a $ eval target.
  const [ddPct, setDdPct] = useState(8);
  const [horizonDays, setHorizonDays] = useState(120);
  // Rules the recommenders actually consume (live derives a relative-% drawdown).
  const profileRules: PropRules = acctMode === 'live'
    ? { ...acctRules, maxDrawdown: Math.round(acctRules.accountSize * ddPct / 100), ddMode: 'trailing', dailyLossLimit: 0, minTradingDays: 0, maxDays: horizonDays }
    : acctRules;
  const applySetup = (r: SetupRec) => {
    setActiveMove(r.variantKey);
    dispatch({ type: 'PATCH_CONFIG', asset: activeAsset, move: r.variantKey, patch: { minCashflowPct: r.minCf, maxMaePct: r.maxMae, defaultContracts: r.contracts }, userSet: true });
    setSizeContracts(r.contracts);
    setOpenStep(2);
  };

  // Default EVERY populated (asset, move) dataset to its own safest config
  // (MFE target / Max MAE / contracts from that dataset's MAE-MFE data). Chunked
  // so the UI never freezes; results persist in the document.
  const [defaultProgress, setDefaultProgress] = useState<{ done: number; total: number } | null>(null);
  const defaultAllToSafest = (onlyUntouched = false) => {
    if (defaultProgress) return;
    const jobs: { asset: AssetTicker; key: string; rows: RawRow[] }[] = [];
    for (const a of ASSET_ORDER) {
      const st = doc[a];
      if (!st) continue;
      for (const key of Object.keys(st)) {
        const ms = st[key];
        if (onlyUntouched && ms.userSet) continue; // never overwrite a move the user explicitly set/applied
        const rows: RawRow[] = [...(ms.inSample?.rows ?? []), ...(ms.oos1?.rows ?? []), ...(ms.oos2?.rows ?? []), ...(ms.oos3?.rows ?? [])];
        if (rows.length >= 5) jobs.push({ asset: a, key, rows });
      }
    }
    if (!jobs.length) { setDefaultProgress(null); return; }
    setDefaultProgress({ done: 0, total: jobs.length });
    let i = 0;
    const run = () => {
      const end = Math.min(i + 3, jobs.length);
      for (; i < end; i++) {
        const j = jobs[i];
        const safe = recommendSafestConfig(j.rows, j.asset, profileRules, { mode: acctMode, sims: 150, rng: mulberry32(1) });
        if (safe) dispatch({ type: 'PATCH_CONFIG', asset: j.asset, move: j.key, patch: { minCashflowPct: safe.minCf, maxMaePct: safe.maxMae, defaultContracts: safe.contracts } });
      }
      if (i < jobs.length) { setDefaultProgress({ done: i, total: jobs.length }); setTimeout(run, 0); }
      else setDefaultProgress(null);
    };
    setTimeout(run, 0);
  };

  // On load, auto-default every UNTOUCHED move (still at raw defaults) to its safest
  // config — so anything you didn't manually set/apply is on safest when the labs
  // (Monte Carlo / Correlation / Portfolio) read it. Set/applied moves are left
  // alone; newly collected (raw) moves get defaulted on the next load. Re-run all
  // any time via the Account Profile button.
  const autoDefaulted = useRef(false);
  useEffect(() => {
    if (autoDefaulted.current || readOnly) return;
    autoDefaulted.current = true;
    const id = setTimeout(() => defaultAllToSafest(true), 400);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Inline name inputs: null = not adding; '' or text = being typed.
  const [draftMoveName, setDraftMoveName] = useState<string | null>(null);
  const [draftStudyName, setDraftStudyName] = useState<string | null>(null);

  // Persist on change, skipping the hydration render so we don't immediately
  // re-save the just-loaded state.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    onChange?.(doc);
  }, [doc, onChange]);

  // Live-merge externally-added data (e.g. CLI collection) while this tab is open,
  // so newly collected moves appear AND can't be clobbered by this client's saves.
  // Additive only (mergeExternalMoves preserves local edits); a no-op merge returns
  // the same doc reference, so this won't churn renders or trigger spurious saves.
  useEffect(() => {
    if (readOnly) return;
    let alive = true;
    const id = setInterval(async () => {
      const remote = await loadDoc();
      if (alive && remote) dispatch({ type: 'MERGE_EXTERNAL', incoming: remote });
    }, 4000);
    return () => { alive = false; clearInterval(id); };
  }, [readOnly]);

  // Guard: if the active move was just deleted, fall back to the first built-in.
  const moveState = doc[activeAsset][activeMove] ?? doc[activeAsset]['1800'];
  const safeMove = doc[activeAsset][activeMove] ? activeMove : '1800';

  // ── Move grouping ──────────────────────────────────────────────────────────
  // The flat variant keys (1800 / 1800MA / 1800FR / 1800PB) are presented as a
  // parent move (1800) with Entry sub-tabs (Breakout / Front Run / Pullback).
  // Breakout maps to the multiple-attempt key when present, so the existing
  // "Attempts / Day" filter does 1st-vs-all; FR/PB map to their own keys.
  const moveGroups = useMemo(() => {
    const assetState = doc[activeAsset] ?? {};
    const has = (k: string) => !!assetState[k];
    const groups: { base: string; label: string; custom: boolean; entries: { entry: string; label: string; key: string }[] }[] = [];
    for (const base of movesForTier(accessTier)) {
      const entries: { entry: string; label: string; key: string }[] = [];
      const boKey = has(`${base}MA`) ? `${base}MA` : has(base) ? base : null;
      if (boKey) entries.push({ entry: 'BO', label: 'Breakout', key: boKey });
      if (has(`${base}FR`)) entries.push({ entry: 'FR', label: 'Front Run', key: `${base}FR` });
      if (has(`${base}PB`)) entries.push({ entry: 'PB', label: 'Pullback', key: `${base}PB` });
      groups.push({ base, label: getMoveLabel(base), custom: false, entries });
    }
    // Custom user moves (not a built-in and not a built-in's variant) → own parent.
    const variantKeys = new Set<string>();
    for (const base of movesForTier(accessTier)) for (const suf of ['', 'MA', 'FR', 'PB']) variantKeys.add(base + suf);
    for (const k of Object.keys(assetState)) {
      if (!variantKeys.has(k) && !isBuiltinMove(k)) groups.push({ base: k, label: assetState[k]?.label ?? k, custom: true, entries: [] });
    }
    return groups;
  }, [accessTier, doc, activeAsset]);

  // The group + entry currently in view (derived from the underlying key).
  const activeGroup = moveGroups.find((g) => g.base === safeMove || g.entries.some((e) => e.key === safeMove)) ?? moveGroups[0];
  const goToGroup = (g: typeof moveGroups[number]) => setActiveMove(g.entries[0]?.key ?? g.base);

  // Label map over ALL underlying keys (incl. variants) for the analysis labs.
  const allMoveOpts = useMemo(() => {
    const assetState = doc[activeAsset] ?? {};
    return Object.keys(assetState).map((id) => ({ id, label: isBuiltinMove(id) ? getMoveLabel(id) : (assetState[id]?.label ?? id) }));
  }, [doc, activeAsset]);

  // Studies for the active (asset, move): the default study + any named extras.
  const studies = useMemo(() => {
    const extras = moveState.extraStudies ?? {};
    return [
      { id: DEFAULT_STUDY, label: 'Default', custom: false },
      ...Object.keys(extras).map((id) => ({ id, label: extras[id].label ?? 'Study', custom: true })),
    ];
  }, [moveState]);
  // Derived guard: if the selected study isn't in the active (asset, move) — e.g.
  // after switching moves or deleting a study — fall back to the default study.
  // No reset effect needed; this recomputes whenever the move's studies change.
  const safeStudy = studies.some((s) => s.id === activeStudy) ? activeStudy : DEFAULT_STUDY;

  function handleAddMove() {
    const name = (draftMoveName ?? '').trim();
    if (!name) {
      setDraftMoveName(null);
      return;
    }
    const id = makeMoveId();
    dispatch({ type: 'ADD_MOVE', id, label: name });
    setActiveMove(id);
    setActiveTab('IN_SAMPLE');
    setDraftMoveName(null);
  }

  function handleDeleteMove(id: string) {
    dispatch({ type: 'DELETE_MOVE', id });
    if (activeMove === id) setActiveMove('1800');
  }

  function handleAddStudy() {
    const name = (draftStudyName ?? '').trim();
    if (!name) {
      setDraftStudyName(null);
      return;
    }
    const id = makeStudyId();
    dispatch({ type: 'ADD_STUDY', asset: activeAsset, move: safeMove, study: id, label: name });
    setActiveStudy(id);
    setActiveTab('IN_SAMPLE');
    setDraftStudyName(null);
  }

  function handleDeleteStudy(id: string) {
    dispatch({ type: 'DELETE_STUDY', asset: activeAsset, move: safeMove, study: id });
    if (activeStudy === id) setActiveStudy(DEFAULT_STUDY);
  }

  // The auto recommender renders ABOVE the config row; the manual Entry + Study
  // pick renders BELOW it (between config and analysis).
  const recommenderTool = (
    <SubStep n={3} label="Let us select your risk" hint="Our picks per risk appetite — click Apply to use one, or set it yourself in ③ You set your risk below.">
      <SetupRecommenderPanel
        doc={doc} asset={activeAsset} moveBase={activeGroup?.base ?? safeMove} rules={profileRules} mode={acctMode} onApply={applySetup}
        current={{ variantKey: safeMove, minCf: moveState.minCashflowPct, maxMae: moveState.maxMaePct ?? 0, contracts: moveState.defaultContracts }}
        onApplyBasketTo={applyBasketTo}
      />
    </SubStep>
  );
  const entryStudyTools = (
    <>
      {activeGroup && !activeGroup.custom && activeGroup.entries.length > 0 && (
        <div className="flex items-center gap-1 mt-3 mb-1 flex-wrap" role="tablist" aria-label="Entry type">
          <span className="mr-1 text-[9px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">Entry</span>
          {activeGroup.entries.map((e) => {
            const active = e.key === safeMove;
            return (
              <button key={e.entry} type="button" role="tab" aria-selected={active} onClick={() => setActiveMove(e.key)} data-testid={`mae-mfe-entry-tab-${e.entry}`}
                className={['px-3 py-1 rounded-[6px] border font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em] transition-colors', active ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)] text-[var(--color-accent)] font-semibold' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'].join(' ')}>
                {e.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap" role="tablist" aria-label="Study" data-testid="mae-mfe-study-switcher">
        <span className="mr-1 text-[9px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">Study</span>
        {studies.map((s) => {
          const active = s.id === safeStudy;
          return (
            <div key={s.id} className="relative flex items-center">
              <button type="button" role="tab" aria-selected={active} onClick={() => setActiveStudy(s.id)} data-testid={`mae-mfe-study-${s.id}`}
                className={['px-3 py-1 rounded-[5px] border font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em] transition-colors', s.custom && !readOnly ? 'pr-6' : '', active ? 'bg-[var(--color-accent)]/12 border-[var(--color-accent-dim)] text-[var(--color-accent)] font-semibold' : 'bg-transparent border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'].join(' ')}>
                {s.label}
              </button>
              {s.custom && !readOnly && (
                <button type="button" title={`Delete ${s.label}`} aria-label={`Delete ${s.label}`} onClick={() => handleDeleteStudy(s.id)} data-testid={`mae-mfe-study-delete-${s.id}`}
                  className="absolute right-1 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-error)] text-[12px] leading-none">×</button>
              )}
            </div>
          );
        })}
        {!readOnly && (draftStudyName === null ? (
          <button type="button" onClick={() => setDraftStudyName('')} data-testid="mae-mfe-add-study"
            className="ml-1 px-3 py-1 rounded-[5px] border border-dashed border-[var(--color-border)] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent-dim)] transition-colors">+ Study</button>
        ) : (
          <input autoFocus type="text" value={draftStudyName} placeholder="Study name…" onChange={(e) => setDraftStudyName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddStudy(); if (e.key === 'Escape') setDraftStudyName(null); }} onBlur={handleAddStudy} data-testid="mae-mfe-add-study-input"
            className="ml-1 w-[130px] px-3 py-1 rounded-[5px] border border-[var(--color-accent-dim)] bg-[var(--color-surface-1)] font-[var(--font-mono)] text-[10px] text-[var(--color-text-primary)] focus:outline-none" />
        ))}
      </div>
    </>
  );

  return (
    <div data-testid="mae-mfe-view">
      <div className="flex items-center justify-end mb-2"><HelpPanel /></div>

      {/* ─── STEP 1 — Pick your Move ──────────────────────────────── */}
      <StepBar n={1} title="Pick your Move" open={openStep === 1} onToggle={() => openStepToggle(1)}>
        <SectionGuide step={1} />
        <p className="text-[11px] text-[var(--color-text-secondary)] mb-2">Draw the range — the geometry is the config. Here’s how a move is picked on the chart:</p>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption — caption track IS provided below */}
        <video controls preload="metadata" className="w-full max-w-[880px] rounded-[8px] border border-[var(--color-border)]">
          <source src="/videos/pick-your-move.mp4" type="video/mp4" />
          <track kind="captions" srcLang="en" label="English" src="/videos/pick-your-move.vtt" default />
        </video>
      </StepBar>

      {/* ─── STEP 2 — Build your business plan ────────────────────── */}
      <StepBar n={2} title="Build your business plan" open={openStep === 2} onToggle={() => openStepToggle(2)}>
      <SectionGuide step={2} />
      {/* ─── ACCOUNT PROFILE — global context for both recommenders ── */}
      <div className="mb-3 p-2.5 rounded-[8px] border border-[var(--color-accent-dim)]/60 bg-[var(--color-bg-inset)]/40">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">Account profile</span>
          <div className="flex gap-1">
            {(['prop', 'live'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setAcctMode(m)} aria-pressed={acctMode === m}
                className={`px-2 py-0.5 rounded-[4px] border text-[10px] uppercase tracking-wide ${acctMode === m ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-accent)] font-semibold' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}>
                {m === 'prop' ? 'Prop eval' : 'Live capital'}
              </button>
            ))}
          </div>
          <span className="text-[9px] text-[var(--color-text-muted)]">drives the setup & portfolio recommenders</span>
          <button type="button" onClick={() => defaultAllToSafest()} disabled={!!defaultProgress}
            className="ml-auto text-[10px] px-2.5 py-1 rounded-[5px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-50"
            title="Set every move on every asset to its own safest MFE / Max MAE / position size, from that dataset's data">
            {defaultProgress ? `Optimizing… ${defaultProgress.done}/${defaultProgress.total}` : '⚡ Default all to Safest'}
          </button>
        </div>
        {acctMode === 'prop' ? (
          <div className="flex flex-wrap items-end gap-2.5">
            <AcctField label="Account $" value={acctRules.accountSize} onChange={(v) => setRule('accountSize', v)} step={1000} />
            <AcctField label="Contracts" value={sizeContracts} onChange={setSizeContracts} min={1} width={64} />
            <AcctField label="Target $" value={acctRules.profitTarget} onChange={(v) => setRule('profitTarget', v)} step={250} />
            <AcctField label="Max DD $" value={acctRules.maxDrawdown} onChange={(v) => setRule('maxDrawdown', v)} step={250} />
            <div className="flex flex-col gap-1 text-[10px]">
              <span className="text-[var(--color-text-secondary)] uppercase tracking-wide">DD mode</span>
              <div className="flex gap-1">
                {(['trailing', 'static'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setRule('ddMode', m)} aria-pressed={acctRules.ddMode === m}
                    className={`px-2 py-1 rounded-[4px] border text-[10px] ${acctRules.ddMode === m ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-text-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}>{m === 'trailing' ? 'Trail' : 'Static'}</button>
                ))}
              </div>
            </div>
            <AcctField label="Daily $ (0=off)" value={acctRules.dailyLossLimit} onChange={(v) => setRule('dailyLossLimit', v)} step={100} />
            <AcctField label="Min days" value={acctRules.minTradingDays} onChange={(v) => setRule('minTradingDays', v)} width={64} />
            <AcctField label="Max days" value={acctRules.maxDays} onChange={(v) => setRule('maxDays', v)} min={1} width={64} />
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2.5">
            <AcctField label="Account $" value={acctRules.accountSize} onChange={(v) => setRule('accountSize', v)} step={1000} />
            <AcctField label="Contracts" value={sizeContracts} onChange={setSizeContracts} min={1} width={64} />
            <AcctField label="Max drawdown %" value={ddPct} onChange={setDdPct} step={0.5} width={90} />
            <AcctField label="Horizon (days)" value={horizonDays} onChange={setHorizonDays} min={1} width={86} />
            <span className="text-[9px] text-[var(--color-text-muted)] self-center max-w-[260px]">Drawdown is measured from your high-water mark (trailing) = ${Math.round(acctRules.accountSize * ddPct / 100).toLocaleString()}. No eval target — it optimizes growth vs. risk-of-ruin over the horizon.</span>
          </div>
        )}
      </div>

      {/* ─── ① ASSET SWITCHER — one dataset per instrument ────────── */}
      <SubStep n={1} label="Pick your asset">
      <div className="flex items-center gap-1.5" role="tablist" aria-label="Asset">
        <span className="mr-1 text-[10px] font-[var(--font-mono)] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
          Asset
        </span>
        {ASSET_ORDER.map((a) => {
          const active = a === activeAsset;
          return (
            <button
              key={a}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveAsset(a)}
              title={ASSETS[a].name}
              data-testid={`mae-mfe-asset-${a}`}
              className={[
                'px-3 py-1.5 rounded-[6px] border font-[var(--font-mono)] text-[11px] uppercase tracking-[0.12em] transition-colors',
                active
                  ? 'bg-[var(--color-accent)]/12 border-[var(--color-accent-dim)] text-[var(--color-accent)] font-semibold'
                  : 'bg-transparent border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]/50',
              ].join(' ')}
            >
              {ASSETS[a].label}
            </button>
          );
        })}
      </div>
      </SubStep>

      {/* ─── ② MOVE TABS — the XLSX sheet tabs, at the top ────────── */}
      <SubStep n={2} label="Pick your move">
      <div className="flex items-end gap-1 flex-wrap" role="tablist" aria-label="Gunship move">
        {moveGroups.map((g) => {
          const active = activeGroup?.base === g.base;
          return (
            <div key={g.base} className="relative flex items-center">
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => goToGroup(g)}
                data-testid={`mae-mfe-move-tab-${g.base}`}
                className={[
                  'px-4 py-2 rounded-t-[6px] border border-b-0 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.12em] transition-colors',
                  g.custom ? 'pr-7' : '',
                  active
                    ? 'bg-[var(--color-surface-1)] border-[var(--color-border)] text-[var(--color-accent)] font-semibold'
                    : 'bg-transparent border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]/50',
                ].join(' ')}
              >
                {g.label}
              </button>
              {g.custom && !readOnly && (
                <button
                  type="button"
                  title={`Delete ${g.label}`}
                  aria-label={`Delete ${g.label}`}
                  onClick={() => handleDeleteMove(g.base)}
                  data-testid={`mae-mfe-move-delete-${g.base}`}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-error)] text-[13px] leading-none"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        {/* + Add custom move */}
        {!readOnly && (
          draftMoveName === null ? (
            <button
              type="button"
              onClick={() => setDraftMoveName('')}
              data-testid="mae-mfe-add-move"
              className="ml-1 px-3 py-2 rounded-t-[6px] border border-dashed border-[var(--color-border)] font-[var(--font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent-dim)] transition-colors"
            >
              + Move
            </button>
          ) : (
            <input
              autoFocus
              type="text"
              value={draftMoveName}
              placeholder="Move name…"
              onChange={(e) => setDraftMoveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddMove();
                if (e.key === 'Escape') setDraftMoveName(null);
              }}
              onBlur={handleAddMove}
              data-testid="mae-mfe-add-move-input"
              className="ml-1 w-[140px] px-3 py-2 rounded-t-[6px] border border-b-0 border-[var(--color-accent-dim)] bg-[var(--color-surface-1)] font-[var(--font-mono)] text-[11px] text-[var(--color-text-primary)] focus:outline-none"
            />
          )
        )}

      </div>
      </SubStep>

      {/* ─── THE dashboard (recommender + Entry/Study live in its middle slot) ─ */}
      <MoveDashboard
        topSlot={recommenderTool}
        onApplyConfig={() => setSizeContracts(moveState.defaultContracts)}
        riskReadout={<RiskReadout ms={moveState} asset={activeAsset} rules={profileRules} mode={acctMode} />}
        middle={entryStudyTools}
        move={safeMove}
        asset={ASSETS[activeAsset]}
        moveState={moveState}
        activeStudy={safeStudy}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        readOnly={readOnly}
        onPatchConfig={(patch) => dispatch({ type: 'PATCH_CONFIG', asset: activeAsset, move: safeMove, patch, userSet: true })}
        onSetStartDate={(sample, startDate) =>
          dispatch({ type: 'SET_START_DATE', asset: activeAsset, move: safeMove, study: safeStudy, sample, startDate })
        }
        onAddRow={(sample, tradeDate) =>
          dispatch({ type: 'ADD_ROW', asset: activeAsset, move: safeMove, study: safeStudy, sample, tradeDate })
        }
        onUpdateRow={(sample, rowIndex, patch) =>
          dispatch({ type: 'UPDATE_ROW', asset: activeAsset, move: safeMove, study: safeStudy, sample, rowIndex, patch })
        }
        onDeleteRow={(sample, rowIndex) =>
          dispatch({ type: 'DELETE_ROW', asset: activeAsset, move: safeMove, study: safeStudy, sample, rowIndex })
        }
      />
      </StepBar>

      {/* ─── STEP 3 — Surviving your 14-day Risk of Ruin ──────────── */}
      <StepBar n={3} title="Surviving your 14-day Risk of Ruin" open={openStep === 3} onToggle={() => openStepToggle(3)}>
        <SectionGuide step={3} />
        <div className="flex flex-wrap gap-1.5 mb-1">
          {([['compare', '⚖ Compare'], ['cycle', '⟳ Cycle'], ['montecarlo', '🎲 Monte Carlo'], ['propsim', '🏛 Prop Sim']] as const).map(([mode, label]) => (
            <button key={mode} type="button" onClick={() => setLab((v) => (v === mode ? null : mode))} aria-pressed={lab === mode} data-testid={`mae-mfe-${mode}-lab-toggle`}
              className={['px-3 py-1.5 rounded-[6px] border font-[var(--font-mono)] text-[11px] uppercase tracking-[0.1em] transition-colors', lab === mode ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)] text-[var(--color-accent)] font-semibold' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'].join(' ')}>{label}</button>
          ))}
        </div>
        {lab && appliedNote && appliedNote.lab === lab && lab !== 'correlate' && lab !== 'portfolio' && <AppliedBanner text={appliedNote.text} onClear={() => setAppliedNote(null)} />}
        {lab === 'compare' ? <CombineComparePanel doc={doc} moves={allMoveOpts} onClose={() => setLab(null)} acctRules={profileRules} setA={combineSetA} setSetA={setCombineSetA} onApplyBasketTo={applyBasketTo} />
          : lab === 'cycle' ? <CyclingPanel doc={doc} moves={allMoveOpts} onClose={() => setLab(null)} acctRules={profileRules} selected={cycleSel} setSelected={setCycleSel} numAccounts={cycleN} setNumAccounts={setCycleN} k={cycleK} setK={setCycleK} onApplyBasketTo={applyBasketTo} />
          : lab === 'montecarlo' ? <MonteCarloPanel doc={doc} moves={allMoveOpts} onClose={() => setLab(null)} combineKeys={[...combineSetA]} cycleKeys={[...cycleSel]} />
          : lab === 'propsim' ? <PropSimPanel doc={doc} moves={allMoveOpts} onClose={() => setLab(null)} onApplyBasketTo={applyBasketTo} combineKeys={[...combineSetA]} />
          : <p className="text-[11px] text-[var(--color-text-secondary)] mt-2">Pick a tool above — your move, Min Cashflow / Max MAE, contracts and attempts from Step 2 carry over automatically.</p>}
      </StepBar>

      {/* ─── STEP 4 — Manage your portfolio ───────────────────────── */}
      <StepBar n={4} title="Manage your portfolio" open={openStep === 4} onToggle={() => openStepToggle(4)}>
        <SectionGuide step={4} />
        <div className="flex flex-wrap gap-1.5 mb-1">
          {([['correlate', '⊞ Correlate'], ['portfolio', '📊 Portfolio']] as const).map(([mode, label]) => (
            <button key={mode} type="button" onClick={() => setLab((v) => (v === mode ? null : mode))} aria-pressed={lab === mode} data-testid={`mae-mfe-${mode}-lab-toggle`}
              className={['px-3 py-1.5 rounded-[6px] border font-[var(--font-mono)] text-[11px] uppercase tracking-[0.1em] transition-colors', lab === mode ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)] text-[var(--color-accent)] font-semibold' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'].join(' ')}>{label}</button>
          ))}
        </div>
        {lab && appliedNote && appliedNote.lab === lab && (lab === 'portfolio' || lab === 'correlate') && <AppliedBanner text={appliedNote.text} onClear={() => setAppliedNote(null)} />}
        {lab === 'correlate' ? <CorrelationPanel doc={doc} moves={allMoveOpts} onClose={() => setLab(null)} />
          : lab === 'portfolio' ? <PortfolioPanel doc={doc} moves={allMoveOpts} onClose={() => setLab(null)} acctRules={profileRules} acctContracts={sizeContracts} acctMode={acctMode} preset={portfolioPreset} onApplyBasketTo={applyBasketTo} />
          : <p className="text-[11px] text-[var(--color-text-secondary)] mt-2">Pick a tool above to see how your moves correlate and combine into a portfolio.</p>}
      </StepBar>

      {/* ─── STEP 5 — Apply your template to your Algo ────────────── */}
      <StepBar n={5} title="Apply your template to your Algo" badge="coming soon" open={openStep === 5} onToggle={() => openStepToggle(5)}>
        <SectionGuide step={5} />
        <p className="text-[12px] text-[var(--color-text-secondary)]">Export your validated move + risk template straight to your live algo. Coming soon.</p>
      </StepBar>
    </div>
  );
}
