/**
 * PropSimPanel — simulate a prop-firm evaluation on a single move. Resamples
 * the move's daily P&L thousands of times against your account rules (target,
 * trailing/static drawdown, daily loss limit, min trading days) and reports the
 * pass / bust / still-active odds. % → $ per asset at your position size (contracts
 * × point value × price). Settings-synced.
 */
import { useEffect, useMemo, useState } from 'react';
import type { MaeMfeDocument } from './maeMfeDocument';
import { buildDollarSeries, runPropSim, mulberry32, type McMode, type PropRules } from '../../../lib/propSim';
import { combinedStats } from '../../../lib/maeMfeCombine';
import { buildLabSources } from './labSources';
import { computeDoomsday, computeDoomsdayFromDollars } from '../../../lib/doomsdayBudget';
import { recommendFlip, FLIP_STYLES, type FlipRec, type FlipStyle } from '../../../lib/flipRecommend';
import { FIRM_PRESETS, FIRM_SIZES, scalePreset, passPayout } from '../../../lib/propFirms';
import { recommendFlipRoi, ROI_STYLES, type RoiRec, type RoiStyle, recommendFlipBasket, BASKET_STYLES, type FlipBasket, type BasketStyle } from '../../../lib/flipRoiRecommend';
import type { PropFirmRules } from '../../../lib/propFirmSim';
import type { AssetTicker } from '../../../lib/assets';
import { InfoTip } from './InfoTip';
import { VideoButton } from './SectionVideo';

interface MoveOpt { id: string; label: string }
export interface PropSimPanelProps {
  doc: MaeMfeDocument;
  moves: MoveOpt[];
  onClose: () => void;
  /** Load a recommended basket (move keys) into a chosen lab and jump there. */
  onApplyBasketTo?: (keys: string[], lab: ApplyLab, source?: string) => void;
  /** Keys of the Combine basket (Set A) — offered as a "Combined basket" source here too. */
  combineKeys?: string[];
}

type ApplyLab = 'compare' | 'cycle' | 'montecarlo' | 'portfolio' | 'propsim';
const BASKET_TARGETS: { lab: ApplyLab; label: string }[] = [
  { lab: 'compare', label: 'Compare' },
  { lab: 'cycle', label: 'Cycle' },
  { lab: 'montecarlo', label: 'Monte Carlo' },
  { lab: 'propsim', label: 'Prop Sim' },
  { lab: 'portfolio', label: 'Portfolio' },
];

const cardCls = 'flex-1 min-w-[120px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[6px] px-3 py-2';
const lblCls = 'text-[9px] uppercase tracking-wide text-[var(--color-text-secondary)] flex items-center gap-1';
const valCls = 'text-[15px] font-[var(--font-mono)] text-[var(--color-text-primary)]';
const inputCls = 'w-[84px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2 py-1 text-[var(--color-text-primary)] font-[var(--font-mono)]';
const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString()}`;

function NumField({ label, info, value, onChange, step = 1, min = 0 }: { label: string; info?: string; value: number; onChange: (n: number) => void; step?: number; min?: number }) {
  return (
    <label className="flex flex-col gap-1 text-[10px]">
      <span className="text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-1">{label}{info && <InfoTip id={info} />}</span>
      <input type="number" min={min} step={step} value={value}
        onChange={(e) => onChange(Math.max(min, +e.target.value || 0))} className={inputCls} />
    </label>
  );
}

export function PropSimPanel({ doc, moves, onClose, onApplyBasketTo, combineKeys }: PropSimPanelProps) {
  const moveLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mv of moves) m[mv.id] = mv.label;
    return (id: string) => m[id] ?? id;
  }, [moves]);
  const [sel, setSel] = useState(0);
  const [mode, setMode] = useState<McMode>('bootstrap');
  const [sims, setSims] = useState(2000);
  const [seed, setSeed] = useState(1);
  const [contracts, setContracts] = useState(5);
  const [rules, setRules] = useState<PropRules>({
    accountSize: 50000, profitTarget: 3000, maxDrawdown: 2000,
    ddMode: 'trailing', dailyLossLimit: 0, minTradingDays: 0, maxDays: 60,
  });
  const set = <K extends keyof PropRules>(k: K, v: PropRules[K]) => setRules((r) => ({ ...r, [k]: v }));

  // Prop-firm preset + flip economics (eval cost, profit split → payout).
  const [firmId, setFirmId] = useState('apex');
  const [acctSize, setAcctSize] = useState(50000);
  const [evalCost, setEvalCost] = useState(147);
  const [resetFee, setResetFee] = useState(80);
  const [splitPct, setSplitPct] = useState(100);
  const [payoutMax, setPayoutMax] = useState(0);
  const [consistencyPct, setConsistencyPct] = useState(0);
  const applyFirm = (id: string, size: number) => {
    const p = FIRM_PRESETS.find((f) => f.id === id);
    if (!p) return;
    const s = scalePreset(p, size);
    setRules((r) => ({ ...r, accountSize: size, profitTarget: s.profitTarget, maxDrawdown: s.maxDrawdown, ddMode: s.ddMode, dailyLossLimit: s.dailyLossLimit, minTradingDays: s.minTradingDays }));
    setEvalCost(s.evalCost); setResetFee(s.resetFee); setSplitPct(s.profitSplitPct); setPayoutMax(s.payoutMax); setConsistencyPct(s.consistencyPct); setAcctSize(size); setFirmId(id);
  };
  const payout = passPayout(rules.profitTarget, payoutMax, splitPct);
  // Full firm-rules object for the lifecycle ROI recommender.
  const firmRules: PropFirmRules = useMemo(() => ({
    accountSize: rules.accountSize, evalCost, resetFee, evalTarget: rules.profitTarget,
    maxLossLimit: rules.maxDrawdown, ddMode: rules.ddMode, mllLockAt: 100,
    dailyLossLimit: rules.dailyLossLimit, evalConsistencyPct: consistencyPct,
    minDaysToPayout: rules.minTradingDays, payoutMin: 0, payoutMax, profitSplitPct: splitPct,
    maxPayouts: 0, maxDays: rules.maxDays,
  }), [rules, evalCost, resetFee, consistencyPct, payoutMax, splitPct]);

  // The Combine basket (Set A) is offered as a "▣ Combined basket" source at the top —
  // run the whole basket through the prop-eval, not just one move.
  const combined = useMemo(() => {
    if (!combineKeys || combineKeys.length === 0) return null;
    const { days } = combinedStats(buildLabSources(doc, new Set(combineKeys), 1, { kind: 'all' }));
    if (!days.length) return null;
    return { key: '__combine', label: `▣ Combined basket (${combineKeys.length} moves)`, asset: 'MNQ' as AssetTicker, dollars: days.map((d) => d.pnl), dates: days.map((d) => d.tradeDate) };
  }, [doc, combineKeys]);
  const series = useMemo(() => {
    const base = buildDollarSeries(doc, moveLabel, contracts);
    return combined ? [combined, ...base] : base;
  }, [doc, moveLabel, contracts, combined]);
  const active = series[Math.min(sel, series.length - 1)];
  const isBasket = active?.key === '__combine';
  const activeCfg = useMemo(() => {
    if (!active || active.key === '__combine') return null;
    const [asset, move] = active.key.split('::') as [AssetTicker, string];
    const ms = doc[asset]?.[move];
    return ms ? { minCf: ms.minCashflowPct, maxMae: ms.maxMaePct ?? 0 } : null;
  }, [active, doc]);

  // Prop-flip recommender: scan every move for the best one + size to PASS this eval.
  const [flipRecs, setFlipRecs] = useState<Record<FlipStyle, FlipRec | null> | null>(null);
  const [flipBusy, setFlipBusy] = useState(false);
  const runFlip = () => {
    setFlipBusy(true);
    setTimeout(() => {
      setFlipRecs(recommendFlip(doc, rules, moveLabel, { sims: 150, rng: mulberry32(1), cost: evalCost, payout }));
      setFlipBusy(false);
    }, 20);
  };
  const applyFlip = (rec: FlipRec) => {
    const idx = series.findIndex((s) => s.key === rec.key);
    if (idx >= 0) setSel(idx);
    setContracts(rec.contracts);
  };
  // ROI recommender — best move per ROI / payout-speed / cheapest, via the lifecycle sim.
  const [roiRecs, setRoiRecs] = useState<Record<RoiStyle, RoiRec | null> | null>(null);
  const [roiBusy, setRoiBusy] = useState(false);
  const runRoi = () => {
    setRoiBusy(true);
    setTimeout(() => {
      setRoiRecs(recommendFlipRoi(doc, firmRules, moveLabel, { sims: 80, rng: mulberry32(1) }));
      setRoiBusy(false);
    }, 20);
  };
  const applyRoi = (rec: RoiRec) => {
    const idx = series.findIndex((s) => s.key === rec.key);
    if (idx >= 0) setSel(idx);
    setContracts(rec.contracts);
  };
  // "Send this one move →" a chosen lab (single-move recs). Prop Sim is "use here" (Apply).
  const SINGLE_TARGETS: { lab: ApplyLab; label: string }[] = [
    { lab: 'compare', label: 'Compare' }, { lab: 'cycle', label: 'Cycle' },
    { lab: 'montecarlo', label: 'MC' }, { lab: 'portfolio', label: 'Portfolio' },
  ];
  const targetRow = (key: string, source: string) => onApplyBasketTo ? (
    <div className="flex items-center gap-1 mt-1 flex-wrap">
      <span className="text-[8px] uppercase tracking-wide text-[var(--color-text-muted)]">Send→</span>
      {SINGLE_TARGETS.map((t) => (
        <button key={t.lab} onClick={() => onApplyBasketTo([key], t.lab, source)} className="text-[8px] px-1 py-0.5 rounded-[4px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/60">{t.label}</button>
      ))}
    </div>
  ) : null;
  // Multi-move flip basket (button-triggered — heavier all-moves lifecycle scan).
  const [basketRecs, setBasketRecs] = useState<Record<BasketStyle, FlipBasket | null> | null>(null);
  const [basketBusy, setBasketBusy] = useState(false);
  const runBasket = () => {
    setBasketBusy(true);
    setTimeout(() => {
      setBasketRecs(recommendFlipBasket(doc, firmRules, moveLabel, { sims: 60, rng: mulberry32(1) }));
      setBasketBusy(false);
    }, 20);
  };
  // Auto-run all three flip recommenders once on open (stay open; Re-run after changing rules).
  useEffect(() => { runFlip(); runRoi(); runBasket(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const res = useMemo(() => {
    if (!active) return null;
    return runPropSim(active.dollars, rules, { mode, sims: Math.min(Math.max(sims, 50), 10000), rng: mulberry32(seed) });
  }, [active, rules, mode, sims, seed]);

  // Doomsday Budget for the SAME move at this page's size + Max DD: the worst
  // losing streak and the capital + rotation + scaling that survives it.
  const doom = useMemo(() => {
    if (!active) return null;
    const dsims = Math.min(Math.max(sims, 50), 5000);
    if (active.key === '__combine') return computeDoomsdayFromDollars(active.dollars, rules.maxDrawdown, { sims: dsims }); // basket → combined-day streak
    const [asset, move] = active.key.split('::') as [AssetTicker, string];
    const ms = doc[asset]?.[move];
    return ms ? computeDoomsday(ms, asset, contracts, rules.maxDrawdown, { sims: dsims }) : null;
  }, [active, doc, contracts, rules.maxDrawdown, sims]);

  // Synthesis: the biggest size whose doomsday streak still fits ONE account's cap
  // (size up as far as you can while still surviving the worst streak), + the $ you'd
  // spend on props to cover the doomsday (accounts to survive × eval cost).
  const recSize = doom && !isBasket && doom.doomsdayDrawdown > 0 && doom.perAccountCap > 0
    ? Math.max(1, Math.floor((contracts * doom.perAccountCap) / doom.doomsdayDrawdown)) : null;
  const propSpend = doom && doom.accountsToSurvive > 0 ? doom.accountsToSurvive * evalCost : null;

  if (series.length === 0) {
    return (
      <div className="mt-3 p-4 border border-[var(--color-border)] rounded-[6px] bg-[var(--color-bg-inset)]/40 text-[11px] text-[var(--color-text-secondary)]">
        Prop Simulator needs at least one populated move. Load data, then reopen.
        <button onClick={onClose} className="ml-3 text-[var(--color-accent)]">close</button>
      </div>
    );
  }

  const baseLabel = res?.base
    ? res.base.outcome === 'pass' ? `PASSED on day ${res.base.day}`
      : res.base.outcome === 'bust-dd' ? `BUSTED (drawdown) on day ${res.base.day}`
      : res.base.outcome === 'bust-daily' ? `BUSTED (daily loss) on day ${res.base.day}`
      : `still active after ${res.base.day} days`
    : '';

  return (
    <div className="mt-3 p-4 border border-[var(--color-border)] rounded-[6px] bg-[var(--color-bg-inset)]/40">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">Prop Simulator</span>
          <InfoTip id="ps-feature" />
          <VideoButton slug="propsim" />
        </div>
        <button onClick={onClose} className="text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">close ✕</button>
      </div>

      {/* ── Prop-flip recommender: which move + size to PASS this eval ── */}
      <div className="mb-3 p-2.5 rounded-[6px] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/[0.04]">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[11px] font-semibold text-[var(--color-accent)]">🏴‍☠️ Best moves to flip</span>
          <InfoTip id="fl-feature" />
          <VideoButton slug="propsim-best-moves" />
          <span className="text-[9px] text-[var(--color-text-secondary)]">— scans every move for passing your eval; sizes at each move's tuned target/stop</span>
          <button onClick={runFlip} disabled={flipBusy} className="ml-auto text-[10px] px-2.5 py-1 rounded-[5px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-40">{flipBusy ? 'Computing…' : flipRecs ? 'Re-run' : 'Recommend'}</button>
        </div>
        {flipBusy && <div className="text-[10px] text-[var(--color-text-secondary)]">Scanning every move at your eval rules…</div>}
        {flipRecs && (
          <div className="flex flex-wrap gap-2">
            {FLIP_STYLES.map(({ key, title, info, note }) => {
              const r = flipRecs[key];
              return (
                <div key={key} className="flex-1 min-w-[210px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[6px] px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className={lblCls}>{title}<InfoTip id={info} /></div>
                    {r && <button onClick={() => applyFlip(r)} className="text-[9px] px-1.5 py-0.5 rounded-[4px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10">Apply</button>}
                  </div>
                  {!r ? <div className="text-[9px] text-[var(--color-text-secondary)] mt-1">no qualifying move</div> : (
                    <>
                      <div className="text-[9px] text-[var(--color-text-muted)] mt-1 leading-snug">{note}</div>
                      <div className="text-[11px] font-semibold text-[var(--color-text-primary)] mt-1">{r.label}</div>
                      <div className="text-[9px] font-[var(--font-mono)] text-[var(--color-text-secondary)] mt-0.5"><span className="text-[var(--color-accent)]">{r.contracts}ct</span> · MFE {r.minCf}% · Max MAE {r.maxMae > 0 ? `${r.maxMae}%` : 'off'}</div>
                      <div className="text-[9px] font-[var(--font-mono)] text-[var(--color-text-secondary)] mt-0.5">pass {(r.pass * 100).toFixed(0)}% · {r.medianDays != null ? `~${Math.round(r.medianDays)}d` : '—'} · bust {(r.bust * 100).toFixed(0)}%{key === 'ev' ? ` · EV ${usd(r.evPerAccount)}/acct` : ''}{key === 'consistency' ? ` · ${(r.consistency * 100).toFixed(0)}% top day` : ''}</div>
                      {targetRow(r.key, `Flip · ${title} · ${r.label}`)}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── ROI recommender: best move per ROI / payout-speed / cheapest ── */}
      <div className="mb-3 p-2.5 rounded-[6px] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/[0.04]">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[11px] font-semibold text-[var(--color-accent)]">💸 Best ROI to flip</span>
          <InfoTip id="fr-feature" />
          <VideoButton slug="propsim-best-roi" />
          <span className="text-[9px] text-[var(--color-text-secondary)]">— net payouts vs $ spent on props, full eval→funded→payout lifecycle</span>
          <button onClick={runRoi} disabled={roiBusy} className="ml-auto text-[10px] px-2.5 py-1 rounded-[5px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-40">{roiBusy ? 'Computing…' : roiRecs ? 'Re-run' : 'Recommend'}</button>
        </div>
        {roiBusy && <div className="text-[10px] text-[var(--color-text-secondary)]">Simulating each move's flip lifecycle…</div>}
        {roiRecs && (
          <div className="flex flex-wrap gap-2">
            {ROI_STYLES.map(({ key, title, info, note }) => {
              const r = roiRecs[key];
              return (
                <div key={key} className="flex-1 min-w-[210px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[6px] px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className={lblCls}>{title}<InfoTip id={info} /></div>
                    {r && <button onClick={() => applyRoi(r)} className="text-[9px] px-1.5 py-0.5 rounded-[4px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10">Apply</button>}
                  </div>
                  {!r ? <div className="text-[9px] text-[var(--color-text-secondary)] mt-1">no net-positive move</div> : (
                    <>
                      <div className="text-[9px] text-[var(--color-text-muted)] mt-1 leading-snug">{note}</div>
                      <div className="text-[11px] font-semibold text-[var(--color-text-primary)] mt-1">{r.label} <span className="text-[var(--color-accent)] font-[var(--font-mono)]">{r.contracts}ct</span></div>
                      <div className="text-[9px] font-[var(--font-mono)] text-[var(--color-text-muted)] mt-0.5">MFE {r.minCf}% · Max MAE {r.maxMae > 0 ? `${r.maxMae}%` : 'off'}</div>
                      <div className="text-[9px] font-[var(--font-mono)] text-[var(--color-text-secondary)] mt-0.5">
                        {key === 'roi' ? <><b className="text-[var(--color-text-primary)]">{(r.roi * 100).toFixed(0)}% ROI</b> · net {usd(r.net)} / spend {usd(r.spend)}</> : null}
                        {key === 'payout' ? <><b className="text-[var(--color-text-primary)]">{r.daysToPayout != null ? `~${Math.round(r.daysToPayout)}d` : '—'}</b> to 1st payout · {r.payouts.toFixed(1)} payouts · net {usd(r.net)}</> : null}
                        {key === 'cheapest' ? <><b className="text-[var(--color-text-primary)]">{usd(r.spend)} spend</b> · net {usd(r.net)} · {(r.profitableShare * 100).toFixed(0)}% profitable</> : null}
                      </div>
                      {targetRow(r.key, `ROI · ${title} · ${r.label}`)}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Multi-move flip basket: run several moves together ── */}
      <div className="mb-3 p-2.5 rounded-[6px] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/[0.04]">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[11px] font-semibold text-[var(--color-accent)]">🧩 Best basket to flip</span>
          <InfoTip id="fb-feature" />
          <VideoButton slug="propsim-best-basket" />
          <span className="text-[9px] text-[var(--color-text-secondary)]">— which MULTIPLE moves to run together (combining stacks trades/day → passes faster &amp; smoother)</span>
          <button onClick={runBasket} disabled={basketBusy} className="ml-auto text-[10px] px-2.5 py-1 rounded-[5px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-40">{basketBusy ? 'Computing…' : basketRecs ? 'Re-run' : 'Recommend'}</button>
        </div>
        {basketBusy && <div className="text-[10px] text-[var(--color-text-secondary)]">Simulating combined-basket flip lifecycles…</div>}
        {basketRecs && (
          <div className="flex flex-wrap gap-2">
            {BASKET_STYLES.map(({ key, title, info, note }) => {
              const b = basketRecs[key];
              return (
                <div key={key} className="flex-1 min-w-[230px] bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[6px] px-3 py-2">
                  <div className={lblCls}>{title}<InfoTip id={info} /></div>
                  {!b ? <div className="text-[9px] text-[var(--color-text-secondary)] mt-1">no net-positive basket</div> : (
                    <>
                      <div className="text-[9px] text-[var(--color-text-muted)] mt-1 leading-snug">{note}</div>
                      <div className="text-[10px] text-[var(--color-text-primary)] mt-1 leading-snug">{b.keys.length} moves: <span className="text-[var(--color-text-secondary)]">{b.labels.join(', ')}</span></div>
                      <div className="text-[9px] font-[var(--font-mono)] text-[var(--color-text-secondary)] mt-0.5">
                        {key === 'roi' ? <><b className="text-[var(--color-text-primary)]">{(b.roi * 100).toFixed(0)}% ROI</b> · net {usd(b.net)} / spend {usd(b.spend)}</> : null}
                        {key === 'payout' ? <><b className="text-[var(--color-text-primary)]">{b.daysToPayout != null ? `~${Math.round(b.daysToPayout)}d` : '—'}</b> to 1st payout · {b.payouts.toFixed(1)} payouts</> : null}
                        {key === 'cheapest' ? <><b className="text-[var(--color-text-primary)]">{usd(b.spend)} spend</b> · net {usd(b.net)} · {(b.profitableShare * 100).toFixed(0)}% profitable</> : null}
                      </div>
                      {onApplyBasketTo && (
                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                          <span className="text-[8px] uppercase tracking-wide text-[var(--color-text-muted)]">Apply→</span>
                          {BASKET_TARGETS.map((t) => (
                            <button key={t.lab} onClick={() => onApplyBasketTo(b.keys, t.lab, `Flip basket · ${title}`)} className="text-[8px] px-1.5 py-0.5 rounded-[4px] border border-[var(--color-accent)]/70 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10">{t.label}</button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* prop-firm preset — fills eval rules + flip economics (approximate; edit freely) */}
      <div className="flex flex-wrap items-end gap-2 mb-2 text-[10px]">
        <div className="flex flex-col gap-1">
          <span className="text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-1">Prop firm<InfoTip id="ps-firm" /><VideoButton slug="propsim-setup" /></span>
          <div className="flex gap-1 flex-wrap">
            {FIRM_PRESETS.map((f) => (
              <button key={f.id} onClick={() => applyFirm(f.id, acctSize)} aria-pressed={firmId === f.id}
                className={`px-2 py-1 rounded-[4px] border text-[10px] ${firmId === f.id ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>{f.firm}</button>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[var(--color-text-secondary)] uppercase tracking-wide">Account size</span>
          <select value={acctSize} onChange={(e) => applyFirm(firmId, +e.target.value)} className="bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2 py-1 text-[var(--color-text-primary)] font-[var(--font-mono)]">
            {FIRM_SIZES.map((s) => <option key={s} value={s}>${s.toLocaleString()}</option>)}
          </select>
        </label>
        <NumField label="Eval cost $" info="ps-evalcost" value={evalCost} onChange={setEvalCost} step={10} />
        <NumField label="Profit split %" info="ps-split" value={splitPct} onChange={setSplitPct} step={5} min={1} />
        <div className="text-[8px] text-[var(--color-text-muted)] self-center max-w-[180px] leading-snug">Presets are approximate — edit to your firm's live rules.</div>
      </div>

      {/* row 1: move + mode + sims */}
      <div className="flex flex-wrap items-end gap-3 mb-2 text-[10px]">
        <label className="flex flex-col gap-1">
          <span className="text-[var(--color-text-secondary)] uppercase tracking-wide">Move</span>
          <select value={sel} onChange={(e) => setSel(+e.target.value)}
            className="bg-[var(--color-bg-inset)] border border-[var(--color-border)] rounded-[4px] px-2 py-1 text-[var(--color-text-primary)] max-w-[220px]">
            {series.map((s, i) => <option key={s.key} value={i}>{s.label} ({s.dollars.length}d)</option>)}
          </select>
          {activeCfg && <span className="text-[9px] font-[var(--font-mono)] text-[var(--color-text-secondary)]">MFE {activeCfg.minCf}% · Max MAE {activeCfg.maxMae > 0 ? `${activeCfg.maxMae}%` : 'off'} · {contracts}ct</span>}
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-1">Days<InfoTip id="ps-mode" /></span>
          <div className="flex gap-1">
            {([['bootstrap', 'Resample'], ['shuffle', 'Shuffle']] as const).map(([m, lab]) => (
              <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                className={`px-2 py-1 rounded-[4px] border ${mode === m ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-text-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}>{lab}</button>
            ))}
          </div>
        </div>
        <NumField label="Simulations" value={sims} onChange={setSims} step={500} min={50} />
        <button onClick={() => setSeed((s) => s + 1)} title="Re-roll the random draws"
          className="px-2 py-1 rounded-[4px] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-[10px]">🎲 Re-roll</button>
      </div>

      {/* row 2: account rules */}
      <div className="flex flex-wrap items-end gap-3 mb-1 text-[10px]">
        <NumField label="Account $" info="ps-account" value={rules.accountSize} onChange={(v) => set('accountSize', v)} step={1000} />
        <NumField label="Contracts" info="ps-contracts" value={contracts} onChange={setContracts} min={1} />
        <NumField label="Target $" info="ps-target" value={rules.profitTarget} onChange={(v) => set('profitTarget', v)} step={250} />
        <NumField label="Max DD $" info="ps-maxdd" value={rules.maxDrawdown} onChange={(v) => set('maxDrawdown', v)} step={250} />
        <div className="flex flex-col gap-1">
          <span className="text-[var(--color-text-secondary)] uppercase tracking-wide flex items-center gap-1">DD mode<InfoTip id="ps-ddmode" /></span>
          <div className="flex gap-1">
            {([['trailing', 'Trailing'], ['static', 'Static']] as const).map(([m, lab]) => (
              <button key={m} onClick={() => set('ddMode', m)} aria-pressed={rules.ddMode === m}
                className={`px-2 py-1 rounded-[4px] border ${rules.ddMode === m ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)] text-[var(--color-text-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}>{lab}</button>
            ))}
          </div>
        </div>
        <NumField label="Daily loss $ (0=off)" info="ps-daily" value={rules.dailyLossLimit} onChange={(v) => set('dailyLossLimit', v)} step={100} />
        <NumField label="Min days (0=off)" info="ps-mindays" value={rules.minTradingDays} onChange={(v) => set('minTradingDays', v)} />
        <NumField label="Max days" info="ps-maxdays" value={rules.maxDays} onChange={(v) => set('maxDays', v)} min={1} />
      </div>

      {res && (
        <>
          {/* headline rates */}
          <div className="flex flex-wrap gap-2 my-3">
            <div className={cardCls}><div className={lblCls}>Pass Rate<InfoTip id="ps-passrate" /><VideoButton slug="propsim-results" /></div><div className={valCls} style={{ color: res.passRate >= 0.5 ? '#5fae7f' : 'var(--color-text-primary)' }}>{(res.passRate * 100).toFixed(0)}%</div></div>
            <div className={cardCls}><div className={lblCls}>Bust Rate<InfoTip id="ps-bust" /></div><div className={valCls} style={{ color: res.bustRate > 0.5 ? '#d06666' : 'var(--color-text-primary)' }}>{(res.bustRate * 100).toFixed(0)}%</div><div className="text-[8px] text-[var(--color-text-secondary)] mt-0.5">DD {(res.bustByDD * 100).toFixed(0)}% · daily {(res.bustByDaily * 100).toFixed(0)}%</div></div>
            <div className={cardCls}><div className={lblCls}>Still Active<InfoTip id="ps-active" /></div><div className={valCls}>{(res.activeRate * 100).toFixed(0)}%</div></div>
            <div className={cardCls}><div className={lblCls}>Days to Pass<InfoTip id="ps-daystopass" /></div><div className={valCls}>{res.medianDaysToPass != null ? Math.round(res.medianDaysToPass) : '—'}</div>{res.p10DaysToPass != null && <div className="text-[8px] text-[var(--color-text-secondary)] mt-0.5">{Math.round(res.p10DaysToPass)}–{Math.round(res.p90DaysToPass!)} d range</div>}</div>
            <div className={cardCls}><div className={lblCls}>Expected $ End<InfoTip id="ps-ev" /></div><div className={valCls}>{usd(res.meanFinal)}</div><div className="text-[8px] text-[var(--color-text-secondary)] mt-0.5">{usd(res.finalP5)} … {usd(res.finalP95)}</div></div>
          </div>

          {/* pass/bust/active proportion bar */}
          <div className="flex h-[18px] w-full rounded-[4px] overflow-hidden border border-[var(--color-border)] text-[9px] font-[var(--font-mono)] leading-[18px]">
            {res.passRate > 0 && <div style={{ width: `${res.passRate * 100}%`, background: 'rgba(95,174,127,0.5)' }} className="text-center text-[var(--color-text-primary)] overflow-hidden">{res.passRate >= 0.08 ? 'pass' : ''}</div>}
            {res.bustRate > 0 && <div style={{ width: `${res.bustRate * 100}%`, background: 'rgba(208,102,102,0.5)' }} className="text-center text-[var(--color-text-primary)] overflow-hidden">{res.bustRate >= 0.08 ? 'bust' : ''}</div>}
            {res.activeRate > 0 && <div style={{ width: `${res.activeRate * 100}%`, background: 'rgba(140,140,140,0.4)' }} className="text-center text-[var(--color-text-primary)] overflow-hidden">{res.activeRate >= 0.1 ? 'active' : ''}</div>}
          </div>

          <div className="text-[9px] text-[var(--color-text-secondary)] mt-2">
            {mode === 'bootstrap'
              ? `Resampled ${res.sims.toLocaleString()} evaluations from ${active.dollars.length} real trading days at ${contracts} contract${contracts === 1 ? '' : 's'}, up to ${rules.maxDays} days each.`
              : `Reshuffled the real ${active.dollars.length}-day sequence ${res.sims.toLocaleString()}× at ${contracts} contract${contracts === 1 ? '' : 's'} (order luck only).`}
            {baseLabel && <> Your actual history: <span className="text-[var(--color-text-primary)]">{baseLabel}</span>.</>}
          </div>
        </>
      )}

      {/* ── Doomsday Budget — worst losing streak → capital to survive it ── */}
      {doom && (
        <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[12px] font-semibold text-[var(--color-text-primary)]">💀 Doomsday Budget</span>
            <InfoTip id="dd-feature" />
            <VideoButton slug="doomsday-budget" />
          </div>
          <div className="text-[10px] text-[var(--color-text-primary)] mb-2 leading-relaxed">
            This {isBasket ? 'basket' : 'move'}'s <b>worst losing streak</b> is <b style={{ color: '#d06666' }}>{doom.doomsdayStreak} {isBasket ? 'down days' : ''} in a row</b> (history {doom.histLossStreak} · Monte-Carlo P95 {doom.mcLossStreak}). At {usd(doom.riskPerTrade)} risk per {isBasket ? 'bad combined day' : 'stopped-out trade'}, a full streak digs a <b style={{ color: '#d06666' }}>{usd(doom.doomsdayDrawdown)}</b> hole — your doomsday drawdown. {doom.perAccountCap > 0 ? (doom.survivesOnOne ? <>One {usd(doom.perAccountCap)} account <b style={{ color: '#5fae7f' }}>survives it</b> ({usd(doom.perAccountCap - doom.doomsdayDrawdown)} headroom).</> : <>One {usd(doom.perAccountCap)} account <b style={{ color: '#d06666' }}>can't absorb it</b> — rotate <b>{doom.accountsToSurvive} accounts</b> to share the drawdown.</>) : <>Set a Max DD above to size it.</>}
          </div>
          {recSize != null && (
            <div className="flex flex-wrap items-center gap-3 mb-2 p-2 rounded-[6px] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/[0.05]">
              <span className="text-[11px]"><span className="text-[var(--color-text-secondary)]">Recommended size to survive on ONE account: </span><b className="text-[var(--color-accent)] text-[13px]">{recSize} contract{recSize === 1 ? '' : 's'}</b><span className="text-[9px] text-[var(--color-text-muted)]"> (largest size whose worst streak still fits {usd(doom.perAccountCap)})</span></span>
              {recSize !== contracts && <button onClick={() => setContracts(recSize)} className="text-[9px] px-2 py-0.5 rounded-[4px] border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10">Apply {recSize}ct</button>}
              {propSpend != null && <span className="text-[10px] text-[var(--color-text-secondary)] ml-auto">Prop spend to cover doomsday: <b style={{ color: '#d06666' }}>{usd(propSpend)}</b> ({doom.accountsToSurvive} × {usd(evalCost)} eval)</span>}
            </div>
          )}
          <div className="flex flex-wrap gap-2 mb-2">
            <div className={cardCls}><div className={lblCls}>Worst Loss Streak<InfoTip id="dd-streak" /></div><div className={valCls} style={{ color: doom.doomsdayStreak >= 8 ? '#d06666' : undefined }}>{doom.doomsdayStreak}<span className="text-[10px] text-[var(--color-text-secondary)]"> in a row</span></div></div>
            <div className={cardCls}><div className={lblCls}>Risk / {isBasket ? 'Day' : 'Trade'}<InfoTip id="dd-risk" /></div><div className={valCls} style={{ color: '#d06666' }}>{usd(doom.riskPerTrade)}</div></div>
            <div className={cardCls}><div className={lblCls}>Doomsday Drawdown<InfoTip id="dd-drawdown" /></div><div className={valCls} style={{ color: '#d06666' }}>{usd(doom.doomsdayDrawdown)}</div><div className="text-[8px] text-[var(--color-text-muted)] mt-0.5">{doom.doomsdayStreak} × {usd(doom.riskPerTrade)}</div></div>
            <div className={cardCls}><div className={lblCls}>Survive on 1?<InfoTip id="dd-survive" /></div><div className={valCls} style={{ color: doom.perAccountCap <= 0 ? undefined : doom.survivesOnOne ? '#5fae7f' : '#d06666' }}>{doom.perAccountCap <= 0 ? '—' : doom.survivesOnOne ? 'Yes ✓' : 'No ✕'}</div></div>
            <div className={cardCls}><div className={lblCls}>Accounts to Survive<InfoTip id="dd-rotation" /></div><div className={valCls} style={{ color: 'var(--color-accent)' }}>{doom.accountsToSurvive || '—'}</div><div className="text-[8px] text-[var(--color-text-muted)] mt-0.5">combined {usd(doom.combinedBudget)}</div></div>
          </div>
          {doom.ladder.length > 0 && (
            <div className="flex items-center gap-1.5 mb-1"><span className="text-[9px] uppercase tracking-wide text-[var(--color-text-muted)]">Rotation &amp; scaling ladder</span><VideoButton slug="rotation-ladder" /></div>
          )}
          {doom.ladder.length > 0 && (
            <table className="text-[10px] font-[var(--font-mono)] tabular-nums">
              <thead><tr className="text-[9px] uppercase tracking-wide text-[var(--color-text-muted)]"><th className="text-left pr-6 pb-1">Props</th><th className="text-right pr-6 pb-1">Bank needed</th><th className="text-right pb-1">Survives streak</th></tr></thead>
              <tbody>
                {doom.ladder.map((r) => (
                  <tr key={r.props} className={r.props === doom.accountsToSurvive ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}>
                    <td className="text-left pr-6 py-[2px]">{r.props}{r.props === doom.accountsToSurvive ? ' ◄ needed' : ''}</td>
                    <td className="text-right pr-6 py-[2px]">{usd(r.bank)}</td>
                    <td className="text-right py-[2px]">{r.survivesStreak} in a row</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="text-[9px] text-[var(--color-text-secondary)] mt-2">Keep 2× the per-account doomsday ({usd(doom.bankPerProp)}) as bank per prop — add a prop above it, drop below. Rotation shares the streak; diversify across uncorrelated moves (Portfolio) to smooth the curve. Payouts / blown accounts / P&L are the pass / bust / expected-$ above.</div>
        </div>
      )}
    </div>
  );
}
