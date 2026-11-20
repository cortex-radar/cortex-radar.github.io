import React from 'react';
import { Compass, HelpCircle, Play, X } from 'lucide-react';
import { SECTORS } from '../../shared/types';
import { InstrumentButton, Kbd, ObsidianPanel } from './ui/cockpit-primitives';

export interface TourStageInfo {
  active: boolean;
  stepIndex: number;
  title: string;
  caption: string;
  progressNorm: number;
}

interface CosmosDecoderHUDProps {
  isOpen: boolean;
  showWelcomeModal: boolean;
  tourState: TourStageInfo | null;
  onToggleOpen: () => void;
  onFocusAndPulseSector: (sectorIndex: number) => void;
  onStart15sTour: () => void;
  onDismissWelcome: () => void;
  onStopTour: () => void;
}

export const CosmosDecoderHUD: React.FC<CosmosDecoderHUDProps> = ({
  isOpen,
  showWelcomeModal,
  tourState,
  onToggleOpen,
  onFocusAndPulseSector,
  onStart15sTour,
  onDismissWelcome,
  onStopTour,
}) => {
  return (
    <>
      {/* =================================================================== */}
      {/* ACTIVE 15-SECOND AUTOMATED CAMERA FLYTHROUGH STAGE BANNER           */}
      {/* =================================================================== */}
      {tourState?.active && (
        <ObsidianPanel className="fixed top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-auto w-[472px] max-w-[92vw] rounded-xl px-4 py-3">
          <div className="flex items-center justify-between gap-2 text-[10.5px] font-mono text-zinc-300 tabular-nums mb-1">
            <span className="font-semibold text-teal-300">
              ORBITAL TOUR · 0{tourState.stepIndex + 1}/04 · {tourState.title}
            </span>
            <InstrumentButton size="xs" onClick={onStopTour}>
              <span>Skip</span>
              <Kbd>ESC</Kbd>
            </InstrumentButton>
          </div>
          <p className="text-xs text-zinc-300 leading-relaxed">{tourState.caption}</p>
          <div className="mt-2.5 h-1 w-full rounded-full bg-zinc-900 overflow-hidden">
            <div
              style={{ width: `${Math.min(100, Math.round(tourState.progressNorm * 100))}%` }}
              className="h-full bg-teal-400 transition-all duration-150"
            />
          </div>
        </ObsidianPanel>
      )}

      {/* =================================================================== */}
      {/* FIRST-VISIT SPATIAL BRIEFING MODAL                                  */}
      {/* =================================================================== */}
      {showWelcomeModal && !tourState?.active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 pointer-events-auto">
          <ObsidianPanel className="w-[520px] max-w-full rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-white/8 pb-3">
              <div>
                <div className="flex items-center gap-2 font-mono text-[10.5px] text-teal-300 font-medium tracking-wider uppercase">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                  <span>CORTEX SPATIAL INTELLIGENCE DECK</span>
                </div>
                <h2 className="cockpit-heading text-base font-semibold text-zinc-100 mt-1">
                  Zero-Grid Relativistic AI Telemetry & L1–L5 Universal Literacy
                </h2>
              </div>
              <InstrumentButton
                size="icon"
                variant="ghost"
                onClick={onDismissWelcome}
                className="h-7 w-7"
              >
                <X className="w-4 h-4" />
              </InstrumentButton>
            </div>

            <p className="text-[12.5px] text-zinc-400 leading-[1.55]">
              Every luminous body is a source-linked AI signal (refreshed on an auto-updated 3h cycle) carrying physical mass, readiness rings, and cross-sector causal tethers—streaming from arXiv, Hugging Face, VIP Substacks, X, Bluesky, 12 Reddit engineering communities, AI Labs, and GitHub Releases.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div className="cockpit-well p-2.5 rounded-lg space-y-1">
                <div className="flex items-center justify-between font-mono text-[10.5px] font-semibold text-zinc-100">
                  <span>1. UNIVERSAL LITERACY</span>
                  <Kbd>1–5</Kbd>
                </div>
                <p className="text-zinc-400 leading-snug">
                  Scrub any opened orb instantaneously from L1 Everyday Analogy to L5 Bare-Metal Specs.
                </p>
              </div>
              <div className="cockpit-well p-2.5 rounded-lg space-y-1">
                <div className="flex items-center justify-between font-mono text-[10.5px] font-semibold text-zinc-100">
                  <span>2. KINETIC BATTLECARD</span>
                  <Kbd>Drag</Kbd>
                </div>
                <p className="text-zinc-400 leading-snug">
                  Collide any two model nodes to synthesize a 5-axis pricing, speed, and FinOps routing verdict.
                </p>
              </div>
              <div className="cockpit-well p-2.5 rounded-lg space-y-1">
                <div className="flex items-center justify-between font-mono text-[10.5px] font-semibold text-zinc-100">
                  <span>3. 30/60/90d BLAST-RADIUS</span>
                  <Kbd>Click</Kbd>
                </div>
                <p className="text-zinc-400 leading-snug">
                  Project 1st-, 2nd-, and 3rd-order client consequences across affected enterprise sectors.
                </p>
              </div>
              <div className="cockpit-well p-2.5 rounded-lg space-y-1">
                <div className="flex items-center justify-between font-mono text-[10.5px] font-semibold text-zinc-100">
                  <span>4. STANDUP LASSO</span>
                  <Kbd>Shift</Kbd>
                </div>
                <p className="text-zinc-400 leading-snug">
                  Lasso node clusters or drop into the `(0,0)` Core for a 60-second Slack or Exec Memo.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1 border-t border-white/8">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-zinc-400">
                Press <Kbd>?</Kbd> anytime for visual legend
              </span>
              <div className="flex items-center gap-2">
                <InstrumentButton onClick={onDismissWelcome}>Enter Deck</InstrumentButton>
                <InstrumentButton
                  variant="accent"
                  onClick={() => {
                    onDismissWelcome();
                    onStart15sTour();
                  }}
                >
                  <Play className="w-3 h-3" />
                  <span>15s Guided Tour</span>
                </InstrumentButton>
              </div>
            </div>
          </ObsidianPanel>
        </div>
      )}

      {/* =================================================================== */}
      {/* BOTTOM-LEFT COLLAPSIBLE COSMOS VISUAL DECODER                       */}
      {/* =================================================================== */}
      <div
        className={`${
          !isOpen ? 'hidden md:block ' : ''
        }fixed left-2.5 bottom-14 z-30 pointer-events-auto select-none`}
      >
        {!isOpen ? (
          <InstrumentButton
            onClick={onToggleOpen}
            title="Open Visual Shader & Ring Legend (Shortcut: ?)"
            className="cockpit-obsidian h-7 px-2.5"
          >
            <HelpCircle className="w-3.5 h-3.5 text-teal-400" />
            <span>Legend</span>
            <Kbd>?</Kbd>
          </InstrumentButton>
        ) : (
          <ObsidianPanel className="w-[336px] max-h-[72dvh] overflow-y-auto rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-white/8 pb-2">
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-zinc-100">
                <Compass className="w-3.5 h-3.5 text-teal-400" />
                <span>COSMOS VISUAL DECODER</span>
              </div>
              <div className="flex items-center gap-1">
                <Kbd>?</Kbd>
                <InstrumentButton
                  size="icon"
                  variant="ghost"
                  onClick={onToggleOpen}
                  title="Collapse Legend"
                  className="h-6 w-6"
                >
                  <X className="w-3.5 h-3.5" />
                </InstrumentButton>
              </div>
            </div>

            {/* Shader Glyph Key */}
            <div className="cockpit-well rounded-lg divide-y divide-white/6 text-[11px]">
              <div className="p-2 flex items-center gap-2.5">
                <svg width="24" height="24" viewBox="0 0 26 26" className="shrink-0">
                  <line x1="13" y1="1" x2="13" y2="25" stroke="#2DD4BF" strokeWidth="1.4" />
                  <line x1="1" y1="13" x2="25" y2="13" stroke="#2DD4BF" strokeWidth="1.4" />
                  <circle cx="13" cy="13" r="4.2" fill="#CCFBF1" />
                </svg>
                <div>
                  <span className="font-mono font-semibold text-zinc-100">4-Point Spikes:</span>{' '}
                  <span className="text-zinc-400">Drag onto peer node to collide Battlecard</span>
                </div>
              </div>

              <div className="p-2 flex items-center gap-2.5">
                <svg width="24" height="24" viewBox="0 0 26 26" className="shrink-0">
                  <circle cx="13" cy="13" r="9" fill="none" stroke="#10B981" strokeWidth="1.8" />
                  <circle cx="13" cy="13" r="3.5" fill="#10B981" />
                </svg>
                <div>
                  <span className="font-mono font-semibold text-zinc-100">Solid Ring:</span>{' '}
                  <span className="text-zinc-400">GA (Enterprise Production Ready)</span>
                </div>
              </div>

              <div className="p-2 flex items-center gap-2.5">
                <svg width="24" height="24" viewBox="0 0 26 26" className="shrink-0">
                  <circle
                    cx="13"
                    cy="13"
                    r="9"
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="1.8"
                    strokeDasharray="4 3"
                  />
                  <circle cx="13" cy="13" r="3.5" fill="#F59E0B" />
                </svg>
                <div>
                  <span className="font-mono font-semibold text-zinc-100">Dashed Ring:</span>{' '}
                  <span className="text-zinc-400">PREVIEW / Beta Canary</span>
                </div>
              </div>

              <div className="p-2 flex items-center gap-2.5">
                <svg width="24" height="24" viewBox="0 0 26 26" className="shrink-0">
                  <circle cx="13" cy="13" r="7.5" fill="none" stroke="#A855F7" strokeWidth="1.2" />
                  <circle
                    cx="13"
                    cy="13"
                    r="10.5"
                    fill="none"
                    stroke="#C084FC"
                    strokeWidth="1.2"
                    strokeDasharray="2 2"
                  />
                  <circle cx="13" cy="13" r="3" fill="#E9D5FF" />
                </svg>
                <div>
                  <span className="font-mono font-semibold text-zinc-100">Double Halo:</span>{' '}
                  <span className="text-zinc-400">RESEARCH / arXiv Early Discovery</span>
                </div>
              </div>

              <div className="p-2 flex items-center gap-2.5">
                <svg width="24" height="24" viewBox="0 0 26 26" className="shrink-0">
                  <circle
                    cx="13"
                    cy="13"
                    r="10.5"
                    fill="rgba(244,63,94,0.16)"
                    stroke="#F43F5E"
                    strokeWidth="1.8"
                  />
                  <circle cx="13" cy="13" r="4" fill="#FFE4E6" />
                </svg>
                <div>
                  <span className="font-mono font-semibold text-zinc-100">Crimson Corona:</span>{' '}
                  <span className="text-zinc-400">HIGH Governance / Security Risk</span>
                </div>
              </div>

              <div className="p-2 flex items-center gap-2.5">
                <svg width="24" height="24" viewBox="0 0 26 26" className="shrink-0">
                  <path d="M2 20 Q 8 15, 15 11" stroke="#2DD4BF" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                  <circle cx="17" cy="9" r="6.5" fill="none" stroke="#2DD4BF" strokeWidth="1.3" />
                  <circle cx="17" cy="9" r="3" fill="#CCFBF1" />
                </svg>
                <div>
                  <span className="font-mono font-semibold text-zinc-100">Entry Comet:</span>{' '}
                  <span className="text-zinc-400">Source-Linked Inbound Signal</span>
                </div>
              </div>

              <div className="p-2 flex items-center gap-2.5">
                <svg width="24" height="24" viewBox="0 0 26 26" className="shrink-0">
                  <circle cx="13" cy="13" r="11" fill="none" stroke="#FBBF24" strokeWidth="1.4" strokeDasharray="3 2" />
                  <circle cx="13" cy="13" r="8" fill="none" stroke="#2DD4BF" strokeWidth="1.3" />
                  <circle cx="13" cy="13" r="3.5" fill="#FEF3C7" />
                </svg>
                <div>
                  <span className="font-mono font-semibold text-zinc-100">Supernova Ring:</span>{' '}
                  <span className="text-zinc-400">Grouped Multi-Source Event</span>
                </div>
              </div>
            </div>

            <div className="cockpit-well px-2.5 py-2 rounded-lg text-[10.5px] text-zinc-400 leading-snug space-y-1">
              <div>
                <span className="font-mono text-[9.5px] font-semibold text-emerald-300">
                  PRIMARY SOURCE:
                </span>{' '}
                Official AI lab blogs, arXiv preprints, Hugging Face releases, and GitHub repositories.
              </div>
              <div>
                <span className="font-mono text-[9.5px] font-semibold text-zinc-200">
                  COMMENTARY:
                </span>{' '}
                Hacker News, Reddit, X, Bluesky, and expert newsletters linked alongside verbatim upstream text.
              </div>
            </div>

            {/* Interactive 8-Sector Attractor Legend */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between font-mono text-[9.5px] uppercase tracking-wider text-zinc-500">
                <span>8 Sector Attractors</span>
                <Kbd>1–8</Kbd>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {SECTORS.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => onFocusAndPulseSector(sec.index)}
                    className="cockpit-well flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:border-white/20 text-left transition-colors cursor-pointer"
                  >
                    <span
                      style={{ backgroundColor: sec.colorHex }}
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                    />
                    <span className="font-mono text-[10px] font-semibold text-zinc-200">
                      {sec.code}
                    </span>
                    <span className="text-[10.5px] text-zinc-400 truncate">
                      {sec.name.split(' ')[0]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </ObsidianPanel>
        )}
      </div>
    </>
  );
};
