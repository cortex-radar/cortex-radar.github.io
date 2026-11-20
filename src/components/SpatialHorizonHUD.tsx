import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Compass,
  Cpu,
  FastForward,
  KeyRound,
  ListFilter,
  Menu,
  Play,
  Radar,
  Radio,
  RotateCcw,
  Rss,
  Search,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  CLIENT_INDUSTRIES,
  ClientIndustry,
  DefconAnomalyEvent,
  LITERACY_LEVELS,
  LiteracyLevel,
  SECTOR_BY_ID,
  SECTORS,
  SectorId,
  SemanticZoomBand,
  SpatialSignal,
  SynthesisEngineId,
  SynthesisEngineStatus,
} from '../../shared/types';
import { formatRelativeAgeShort, LENS_SHORT_LABELS } from '../utils/signalRanking';
import { InstrumentButton, Kbd, ObsidianPanel } from './ui/cockpit-primitives';

interface SpatialHorizonHUDProps {
  zoom: number;
  zoomBand: SemanticZoomBand;
  fps: number;
  workerMs: number;
  visibleCount: number;
  activeClient: ClientIndustry;
  globalLiteracyLevel: LiteracyLevel;
  audioEnabled: boolean;
  isTimeWarpPlaying: boolean;
  playheadOffsetMs: number;
  signals: SpatialSignal[];
  latestLiveToast: { sector: string; title: string; source: string } | null;
  geminiApiKey: string;
  activeSynthesisEngine: SynthesisEngineId;
  synthesisStatus: SynthesisEngineStatus | null;
  defconAnomaly: DefconAnomalyEvent | null;
  showCalibrationHint: boolean;
  showDemoSeed: boolean;
  sourcesDrawerOpen: boolean;
  tourActive: boolean;
  newSignalsCount: number;
  isReturnVisit?: boolean;
  onlyNewFilterActive: boolean;
  onToggleOnlyNewFilter: () => void;
  briefingActive: boolean;
  briefingStepIndex: number;
  briefingTotalSteps: number;
  onToggleBriefing: () => void;
  signalRailOpen: boolean;
  onToggleSignalRail: () => void;
  onOpenCommandPalette: () => void;
  mutedSectors: ReadonlySet<SectorId>;
  onToggleMuteSector: (sec: SectorId) => void;
  onResetMutedSectors: () => void;
  onHoverSectorIndex: (idx: number) => void;
  mobileViewMode?: 'FEED' | 'MAP';
  mobileSheetOpen?: boolean;
  isStaticPublicMode?: boolean;
  staticBakedAtMs?: number | null;
  onDismissHint: () => void;
  onSelectClient: (ind: ClientIndustry) => void;
  onSelectLiteracyLevel: (lvl: LiteracyLevel) => void;
  onSelectSynthesisEngine: (engine: SynthesisEngineId) => void;
  onFocusDefconSignal: (signalId: string) => void;
  onDismissDefcon: () => void;
  onToggleAudio: () => void;
  onTriggerLiveDrop: () => void;
  onScrubOffsetMs: (offsetMs: number) => void;
  onToggleTimeWarp60x: () => void;
  onSnapToLive: () => void;
  onFlyToSector: (sectorIndex: number) => void;
  onTriggerGlobalStandup: () => void;
  onSaveGeminiKey: (key: string) => void;
  onToggleDemoSeed: (show: boolean) => void;
  onToggleSourcesDrawer: () => void;
  onStart15sTour: () => void;
}

const WINDOW_72H_MS = 72 * 3600_000;

export const SpatialHorizonHUD: React.FC<SpatialHorizonHUDProps> = ({
  zoom,
  fps,
  workerMs,
  visibleCount,
  activeClient,
  globalLiteracyLevel,
  audioEnabled,
  isTimeWarpPlaying,
  playheadOffsetMs,
  signals,
  latestLiveToast,
  geminiApiKey,
  activeSynthesisEngine,
  synthesisStatus,
  defconAnomaly,
  showCalibrationHint,
  showDemoSeed,
  sourcesDrawerOpen,
  tourActive,
  newSignalsCount,
  isReturnVisit = false,
  onlyNewFilterActive,
  onToggleOnlyNewFilter,
  briefingActive,
  briefingStepIndex,
  briefingTotalSteps,
  onToggleBriefing,
  signalRailOpen,
  onToggleSignalRail,
  onOpenCommandPalette,
  mutedSectors,
  onToggleMuteSector,
  onResetMutedSectors,
  onHoverSectorIndex,
  mobileViewMode = 'MAP',
  mobileSheetOpen = false,
  isStaticPublicMode = false,
  staticBakedAtMs = null,
  onDismissHint,
  onSelectClient,
  onSelectLiteracyLevel,
  onSelectSynthesisEngine,
  onFocusDefconSignal,
  onDismissDefcon,
  onToggleAudio,
  onTriggerLiveDrop,
  onScrubOffsetMs,
  onToggleTimeWarp60x,
  onSnapToLive,
  onFlyToSector,
  onTriggerGlobalStandup,
  onSaveGeminiKey,
  onToggleDemoSeed,
  onToggleSourcesDrawer,
  onStart15sTour,
}) => {
  const scrubberCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingScrubRef = useRef(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [draftKey, setDraftKey] = useState(geminiApiKey);
  const [hoveredSectorCode, setHoveredSectorCode] = useState<string | null>(null);

  // Precision 72h Timeline Rule Renderer (major 12h & minor 3h ticks + signal stems + playhead needle)
  useEffect(() => {
    const canvas = scrubberCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 680;
    const h = canvas.clientHeight || 30;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const padX = 8;
    const usableW = Math.max(1, w - padX * 2);
    const baseY = h - 5;

    // Baseline hairline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, baseY);
    ctx.lineTo(w - padX, baseY);
    ctx.stroke();

    // Precision ruler ticks every 3 hours (24 divisions across 72h)
    for (let step = 0; step <= 24; step++) {
      const tx = padX + (step / 24) * usableW;
      const isMajor = step % 4 === 0;
      ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.24)' : 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, baseY);
      ctx.lineTo(tx, baseY - (isMajor ? 5 : 2.5));
      ctx.stroke();
    }

    const now = Date.now();
    const startMs = now - WINDOW_72H_MS;

    // Signal amplitude stems
    for (const sig of signals) {
      if (sig.isDemoSeed && !showDemoSeed) continue;
      const tNorm = Math.max(0, Math.min(1, (sig.publishedAtMs - startMs) / WINDOW_72H_MS));
      const x = padX + tNorm * usableW;
      const barH = Math.min(h - 9, 5 + sig.mass * 4.2);
      const secMeta = SECTOR_BY_ID[sig.primarySector];
      const isPastPlayhead = sig.publishedAtMs <= now + playheadOffsetMs;

      ctx.strokeStyle = secMeta.colorHex;
      ctx.globalAlpha = isPastPlayhead ? 0.85 : 0.18;
      ctx.lineWidth = sig.isLiveInbound ? 2 : 1.35;
      ctx.beginPath();
      ctx.moveTo(x, baseY - 1);
      ctx.lineTo(x, baseY - 1 - barH);
      ctx.stroke();
    }

    // Playhead cursor needle with top diamond cap
    const playNorm = Math.max(0, Math.min(1, (WINDOW_72H_MS + playheadOffsetMs) / WINDOW_72H_MS));
    const px = padX + playNorm * usableW;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#2DD4BF';
    ctx.fillRect(px - 0.75, 4, 1.5, h - 7);
    ctx.beginPath();
    ctx.moveTo(px, 1.5);
    ctx.lineTo(px + 3.5, 5);
    ctx.lineTo(px, 8.5);
    ctx.lineTo(px - 3.5, 5);
    ctx.closePath();
    ctx.fill();
  }, [signals, playheadOffsetMs, showDemoSeed]);

  const scrubFromPointer = (clientX: number) => {
    const canvas = scrubberCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const norm = Math.max(0, Math.min(1, (clientX - rect.left - 8) / Math.max(1, rect.width - 16)));
    const offsetMs = (norm - 1) * WINDOW_72H_MS;
    onScrubOffsetMs(offsetMs);
  };

  const hoursBehind = Math.abs(playheadOffsetMs) / 3600_000;
  const isLiveNow = hoursBehind < 0.08 && !isTimeWarpPlaying;

  const ollamaOnline = Boolean(synthesisStatus?.ollama.online);
  const activeTelemetryText =
    activeSynthesisEngine === 'OLLAMA'
      ? synthesisStatus?.ollama.lastTokensPerSec
        ? `${synthesisStatus.ollama.lastTokensPerSec.toFixed(0)}t/s · ${synthesisStatus.ollama.lastLatencyMs}ms`
        : ollamaOnline
        ? synthesisStatus?.ollama.selectedModel || '11434'
        : 'OFFLINE'
      : activeSynthesisEngine === 'GEMINI'
      ? synthesisStatus?.gemini.lastTokensPerSec
        ? `${synthesisStatus.gemini.lastTokensPerSec.toFixed(0)}t/s · ${synthesisStatus.gemini.lastLatencyMs}ms`
        : geminiApiKey || synthesisStatus?.gemini.configured
        ? '2.5F'
        : 'KEY'
      : `${synthesisStatus?.deterministic.lastLatencyMs ?? 1}ms`;

  const activeClientMeta =
    CLIENT_INDUSTRIES.find((c) => c.id === activeClient) || CLIENT_INDUSTRIES[0];

  return (
    <div className="fixed inset-0 pointer-events-none z-30 flex flex-col justify-between p-2 select-none">
      {/* =================================================================== */}
      {/* TOP AEROSPACE INSTRUMENT BAR (Responsive 2-Row Mobile + Desktop)    */}
      {/* =================================================================== */}
      <div className="space-y-1.5 w-full max-w-full overflow-x-hidden">
        {/* < 768px Clean 2-Row Mobile Header (Zero Horizontal Overflow) */}
        <ObsidianPanel className="md:hidden pointer-events-auto w-full max-w-full px-2.5 py-2 rounded-lg space-y-2 overflow-hidden">
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="h-2 w-2 rounded-full bg-teal-400 shrink-0" />
              <span className="cockpit-heading font-sans text-xs font-semibold text-zinc-100 tracking-tight">
                CORTEX
              </span>
              <button
                type="button"
                onClick={onToggleOnlyNewFilter}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px] tabular-nums border cursor-pointer ${
                  onlyNewFilterActive
                    ? 'bg-teal-500/20 border-teal-400/50 text-teal-200'
                    : 'bg-zinc-900 border-white/10 text-zinc-300'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    newSignalsCount > 0 ? 'bg-teal-400 animate-pulse' : 'bg-zinc-500'
                  }`}
                />
                <span>{newSignalsCount > 0 ? `+${newSignalsCount}` : '0'}</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <InstrumentButton
                size="xs"
                variant="accent"
                active={briefingActive}
                onClick={onToggleBriefing}
                className="min-h-[34px] px-2.5 tabular-nums"
              >
                {briefingActive ? (
                  <>
                    <Square className="w-2.5 h-2.5 fill-current text-teal-300" />
                    <span>
                      {briefingStepIndex + 1}/{briefingTotalSteps}
                    </span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 fill-current text-teal-300" />
                    <span>Briefing</span>
                  </>
                )}
              </InstrumentButton>

              <InstrumentButton
                size="icon"
                active={mobileMenuOpen || sourcesDrawerOpen}
                onClick={() => setMobileMenuOpen((v) => !v)}
                aria-label="Open Cockpit Controls Menu"
                className="min-h-[34px] min-w-[34px]"
              >
                <Menu className="w-3.5 h-3.5 text-zinc-200" />
              </InstrumentButton>
            </div>
          </div>

          {/* Row 2: Full-Width Touch-Friendly L1 -> L5 Global Literacy Pill */}
          <div
            role="tablist"
            aria-label="Global AI Literacy Lens"
            className="cockpit-well relative grid grid-cols-5 p-0.5 rounded-lg w-full"
          >
            <div
              aria-hidden="true"
              style={{
                width: 'calc((100% - 4px) / 5)',
                transform: `translate3d(${(globalLiteracyLevel - 1) * 100}%, 0, 0)`,
              }}
              className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-[6px] bg-zinc-800/95 border border-teal-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-transform duration-150 ease-out"
            />
            {LITERACY_LEVELS.map((lvl) => {
              const isActive = globalLiteracyLevel === lvl.level;
              return (
                <button
                  key={lvl.level}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelectLiteracyLevel(lvl.level)}
                  className={`relative z-10 min-h-[36px] px-1 rounded-[6px] font-mono text-[10px] tabular-nums transition-colors cursor-pointer flex flex-col items-center justify-center leading-tight ${
                    isActive ? 'text-zinc-100 font-semibold' : 'text-zinc-400'
                  }`}
                >
                  <span className={isActive ? 'text-teal-300' : 'text-zinc-500'}>{lvl.level}</span>
                  <span className="text-[8.5px] truncate max-w-full">
                    {LENS_SHORT_LABELS[lvl.level]}
                  </span>
                </button>
              );
            })}
          </div>

          {mobileMenuOpen && (
            <div className="pt-2 border-t border-white/10 space-y-2 text-[11px] font-mono">
              <div className="grid grid-cols-2 gap-1.5">
                <select
                  aria-label="Client Industry Gravity"
                  value={activeClient}
                  onChange={(e) => onSelectClient(e.target.value as ClientIndustry)}
                  className="cockpit-well h-9 px-2 rounded-md text-[11px] font-mono text-zinc-200 focus:outline-none"
                >
                  {CLIENT_INDUSTRIES.map((ind) => (
                    <option key={ind.id} value={ind.id} className="bg-zinc-950 text-zinc-100">
                      {ind.label}
                    </option>
                  ))}
                </select>
                {!isStaticPublicMode ? (
                  <InstrumentButton
                    size="xs"
                    active={sourcesDrawerOpen}
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onToggleSourcesDrawer();
                    }}
                    className="min-h-[36px] justify-center"
                  >
                    <Radar className="w-3.5 h-3.5 text-teal-400" />
                    <span>Firehose Sources</span>
                  </InstrumentButton>
                ) : (
                  <InstrumentButton
                    size="xs"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onOpenCommandPalette();
                    }}
                    className="min-h-[36px] justify-center"
                  >
                    <Search className="w-3.5 h-3.5 text-teal-400" />
                    <span>Search Radar</span>
                  </InstrumentButton>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {!isStaticPublicMode && (
                  <InstrumentButton
                    size="xs"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      onOpenCommandPalette();
                    }}
                    className="min-h-[36px]"
                  >
                    <Search className="w-3.5 h-3.5 text-teal-400" />
                    <span>Search</span>
                  </InstrumentButton>
                )}
                <InstrumentButton
                  size="xs"
                  active={audioEnabled}
                  onClick={onToggleAudio}
                  className="min-h-[36px]"
                >
                  {audioEnabled ? (
                    <Volume2 className="w-3.5 h-3.5 text-teal-400" />
                  ) : (
                    <VolumeX className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  <span>{audioEnabled ? 'Audio On' : 'Audio Off'}</span>
                </InstrumentButton>
                <InstrumentButton
                  size="xs"
                  active={!showDemoSeed}
                  onClick={() => onToggleDemoSeed(!showDemoSeed)}
                  className="min-h-[36px]"
                >
                  <span>
                    {showDemoSeed
                      ? 'Seed+Feed'
                      : isStaticPublicMode
                      ? 'Auto-Updated · 3h'
                      : 'Live Stream'}
                  </span>
                </InstrumentButton>
                <InstrumentButton
                  size="xs"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onTriggerGlobalStandup();
                  }}
                  className="min-h-[36px]"
                >
                  <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                  <span>Standup</span>
                </InstrumentButton>
                {mutedSectors.size > 0 && (
                  <InstrumentButton
                    size="xs"
                    variant="accent"
                    onClick={onResetMutedSectors}
                    className="min-h-[36px]"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Unmute ({mutedSectors.size})</span>
                  </InstrumentButton>
                )}
                <a
                  href="./rss.xml"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-[7px] font-mono text-[10.5px] bg-zinc-900/90 border border-white/10 text-zinc-200 hover:border-teal-400/50 transition-colors"
                >
                  <Rss className="w-3.5 h-3.5 text-amber-400" />
                  <span>RSS Feed</span>
                </a>
              </div>
            </div>
          )}
        </ObsidianPanel>

        {/* >= 768px Desktop Consolidated Instrument Bar */}
        <ObsidianPanel className="hidden md:flex pointer-events-auto w-full px-2 py-1.5 rounded-lg flex-wrap xl:flex-nowrap items-center justify-between gap-1.5">
          {/* Group 1: Cockpit Identity + Tabular Engine Telemetry */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="h-2 w-2 rounded-full bg-teal-400 shrink-0" />
            <span className="cockpit-heading font-sans text-xs font-semibold text-zinc-100 tracking-tight">
              CORTEX
            </span>
            <span className="h-3.5 w-px bg-white/10" />
            <span className="font-mono text-[10.5px] text-zinc-400 tabular-nums">
              <span className="text-zinc-200">{zoom.toFixed(2)}x</span>
              <span className="hidden 2xl:inline">
                {' '}
                · <span className="text-teal-300">{fps}</span>fps · {workerMs.toFixed(1)}ms ·{' '}
                {visibleCount}n
              </span>
            </span>
          </div>

          {/* Group 2: Global 5-Step Universal Literacy Segmented Track (L1 -> L5) */}
          <div
            role="tablist"
            aria-label="Global AI Literacy Lens"
            className="cockpit-well relative inline-grid grid-cols-5 p-0.5 rounded-[7px] shrink-0"
          >
            {/* Smooth GPU-translated active indicator */}
            <div
              aria-hidden="true"
              style={{
                width: 'calc((100% - 4px) / 5)',
                transform: `translate3d(${(globalLiteracyLevel - 1) * 100}%, 0, 0)`,
              }}
              className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-[5px] bg-zinc-800/95 border border-teal-400/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-transform duration-150 ease-out"
            />
            {LITERACY_LEVELS.map((lvl) => {
              const isActive = globalLiteracyLevel === lvl.level;
              return (
                <button
                  key={lvl.level}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelectLiteracyLevel(lvl.level)}
                  title={`${lvl.code} ${lvl.shortName} — ${lvl.persona}`}
                  className={`relative z-10 px-1.5 2xl:px-2 py-0.5 rounded-[5px] font-mono text-[10.5px] tabular-nums transition-colors duration-100 cursor-pointer flex items-center justify-center gap-0.5 2xl:gap-1 ${
                    isActive ? 'text-zinc-100 font-semibold' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span className={isActive ? 'text-teal-300' : 'text-zinc-500'}>{lvl.code}</span>
                  <span className="hidden lg:inline tracking-tight">
                    {LENS_SHORT_LABELS[lvl.level]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Group 3: Client Gravity + 3-Way Synthesis Brain */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Compact Client Gravity Segmented Bar (Desktop) + Select Fallback (Compact) */}
            <div className="hidden 2xl:inline-flex cockpit-well p-0.5 rounded-[7px] items-center">
              {CLIENT_INDUSTRIES.map((ind) => {
                const active = ind.id === activeClient;
                return (
                  <button
                    key={ind.id}
                    type="button"
                    onClick={() => onSelectClient(ind.id)}
                    title={`${ind.label} — ${ind.regulatoryFocus}`}
                    className={`px-1.5 py-0.5 rounded-[5px] font-mono text-[10px] transition-colors cursor-pointer ${
                      active
                        ? 'bg-zinc-800 text-zinc-100 border border-white/10 font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                        : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                    }`}
                  >
                    {ind.shortLabel}
                  </button>
                );
              })}
            </div>

            <select
              aria-label="Client Industry Gravity"
              value={activeClient}
              onChange={(e) => onSelectClient(e.target.value as ClientIndustry)}
              title={`Client Gravity: ${activeClientMeta.label} — ${activeClientMeta.regulatoryFocus}`}
              className="2xl:hidden h-7 px-1.5 rounded-md cockpit-well font-mono text-[10.5px] text-zinc-200 focus:outline-none focus:border-teal-400/60 cursor-pointer"
            >
              {CLIENT_INDUSTRIES.map((ind) => (
                <option key={ind.id} value={ind.id} className="bg-zinc-950 text-zinc-100">
                  {ind.shortLabel}
                </option>
              ))}
            </select>

            {/* 3-Way Synthesis Brain Track (Local Mode) OR Static Cloud Snapshot Badge */}
            {isStaticPublicMode ? (
              <div
                title={`Auto-Updated · 3h Cycle${
                  staticBakedAtMs
                    ? ` — Snapshot generated ${formatRelativeAgeShort(staticBakedAtMs)} ago (${new Date(
                        staticBakedAtMs
                      ).toLocaleString()})`
                    : ''
                }. Headlines reflect linked third-party sources.`}
                className="cockpit-well inline-flex items-center gap-1.5 px-2 py-1 rounded-[7px] font-mono text-[10px] text-teal-200 tabular-nums"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <span>Live Snapshot</span>
                <span className="text-zinc-500">·</span>
                <span className="text-zinc-300">
                  {staticBakedAtMs
                    ? `Updated ${formatRelativeAgeShort(staticBakedAtMs)} ago`
                    : 'Auto-Updated · 3h Cycle'}
                </span>
              </div>
            ) : (
              <div
                role="tablist"
                aria-label="Active Synthesis Engine"
                className="cockpit-well inline-flex items-center p-0.5 rounded-[7px] gap-0.5"
              >
                <Cpu className="w-3 h-3 text-zinc-500 ml-1.5 mr-0.5 shrink-0" />
                {(
                  [
                    {
                      id: 'OLLAMA' as SynthesisEngineId,
                      label: 'Ollama',
                      dot: ollamaOnline ? 'bg-emerald-400' : 'bg-zinc-600',
                      title: ollamaOnline
                        ? `Local Ollama (${synthesisStatus?.ollama.selectedModel || 'ready'}, ctx 4096)`
                        : 'Local Ollama (127.0.0.1:11434 offline — deterministic fallback armed)',
                    },
                    {
                      id: 'GEMINI' as SynthesisEngineId,
                      label: 'Gemini',
                      dot:
                        geminiApiKey || synthesisStatus?.gemini.configured
                          ? 'bg-teal-400'
                          : 'bg-zinc-600',
                      title: 'Gemini 2.5 Flash Cloud Synthesis',
                    },
                    {
                      id: 'DETERMINISTIC' as SynthesisEngineId,
                      label: 'Rules',
                      dot: 'bg-teal-400',
                      title: 'Sub-millisecond Deterministic Synthesis Engine',
                    },
                  ] as const
                ).map((eng) => {
                  const active = activeSynthesisEngine === eng.id;
                  return (
                    <button
                      key={eng.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => onSelectSynthesisEngine(eng.id)}
                      title={eng.title}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] font-mono text-[10px] transition-colors cursor-pointer ${
                        active
                          ? 'bg-zinc-800 text-zinc-100 border border-white/10 font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                          : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${eng.dot}`} />
                      <span>{eng.label}</span>
                    </button>
                  );
                })}
                <span className="hidden xl:inline px-1.5 font-mono text-[10px] text-zinc-400 tabular-nums border-l border-white/8">
                  {activeTelemetryText}
                </span>
              </div>
            )}
          </div>

          {/* Group 4: Consolidated Right-Side Action Instruments */}
          <div className="flex items-center gap-1 shrink-0">
            <InstrumentButton
              size="xs"
              onClick={onOpenCommandPalette}
              title="Instant Command Search (Ctrl+K or /)"
              className="gap-1.5"
            >
              <Search className="w-3 h-3 text-teal-400" />
              <span className="hidden xl:inline">Search</span>
              <Kbd className="hidden 2xl:inline-block">Ctrl+K</Kbd>
            </InstrumentButton>

            <InstrumentButton
              size="xs"
              active={onlyNewFilterActive}
              onClick={onToggleOnlyNewFilter}
              title={
                onlyNewFilterActive
                  ? 'Showing only new signals since last visit — click to restore all'
                  : 'Filter galaxy to new signals since your last visit'
              }
              className="tabular-nums"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  newSignalsCount > 0 ? 'bg-teal-400 animate-pulse' : 'bg-zinc-500'
                }`}
              />
              <span>
                {newSignalsCount > 0
                  ? isReturnVisit
                    ? `+${newSignalsCount} new since last visit`
                    : `+${newSignalsCount} New`
                  : '0 New'}
              </span>
            </InstrumentButton>

            <InstrumentButton
              size="xs"
              variant="accent"
              active={briefingActive}
              onClick={onToggleBriefing}
              title="90-second guided audio/visual briefing of today's top 5 signals"
              className="tabular-nums"
            >
              {briefingActive ? (
                <>
                  <Square className="w-2.5 h-2.5 fill-current text-teal-300" />
                  <span>
                    {briefingStepIndex + 1}/{briefingTotalSteps}
                  </span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current text-teal-300" />
                  <span>Briefing</span>
                </>
              )}
            </InstrumentButton>

            <InstrumentButton
              size="xs"
              active={signalRailOpen}
              onClick={onToggleSignalRail}
              title="Toggle Top 10 Signals Today sidebar"
            >
              <ListFilter className="w-3 h-3 text-teal-400" />
              <span className="hidden lg:inline">Top 10</span>
            </InstrumentButton>

            {!isStaticPublicMode && (
              <InstrumentButton
                size="xs"
                active={sourcesDrawerOpen}
                onClick={onToggleSourcesDrawer}
                title="Open Zero-Billing Firehose Switchboard & 29 Upstream Streams"
              >
                <Radar className="w-3 h-3 text-teal-400" />
                <span className="hidden 2xl:inline">Firehose</span>
              </InstrumentButton>
            )}

            <InstrumentButton
              size="xs"
              active={!showDemoSeed}
              onClick={() => onToggleDemoSeed(!showDemoSeed)}
              title={
                isStaticPublicMode
                  ? 'Toggle 72h historical baseline vs. Auto-Updated 3h Cycle snapshot (source-linked feeds)'
                  : 'Toggle 72h historical baseline vs. source-linked live stream'
              }
              className="tabular-nums"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  showDemoSeed ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              />
              <span>
                {showDemoSeed
                  ? 'Seed+Feed'
                  : isStaticPublicMode
                  ? 'Auto-Updated · 3h'
                  : 'Live Stream'}
              </span>
            </InstrumentButton>

            {!isStaticPublicMode && (
              <InstrumentButton
                size="xs"
                onClick={onTriggerLiveDrop}
                title="Release next queued live signal along hyperbolic entry trajectory"
              >
                <Radio className="w-3 h-3 text-teal-400" />
                <span className="hidden 2xl:inline">Inbound</span>
              </InstrumentButton>
            )}

            <InstrumentButton
              size="xs"
              onClick={onTriggerGlobalStandup}
              title="Synthesize 60-Second Executive Standup Brief"
            >
              <Sparkles className="w-3 h-3 text-teal-400" />
              <span className="hidden 2xl:inline">Standup</span>
            </InstrumentButton>

            <InstrumentButton
              size="xs"
              active={tourActive}
              onClick={onStart15sTour}
              title="Launch 15-Second Orbital Flythrough Tour"
            >
              <Compass className="w-3 h-3" />
              <span className="hidden 2xl:inline">15s</span>
            </InstrumentButton>

            <InstrumentButton
              size="xs"
              active={audioEnabled}
              onClick={onToggleAudio}
              title="Toggle Cockpit Micro-Acoustics & Telemetry Synth (persisted to localStorage)"
            >
              {audioEnabled ? (
                <Volume2 className="w-3 h-3 text-teal-400" />
              ) : (
                <VolumeX className="w-3 h-3 text-zinc-400" />
              )}
            </InstrumentButton>

            <a
              href="./rss.xml"
              target="_blank"
              rel="noreferrer"
              title="Subscribe to CORTEX Top 25 AI Intelligence RSS 2.0 Feed"
              aria-label="RSS Feed"
              className="inline-flex items-center justify-center h-6 w-6 rounded-[6px] bg-zinc-900/90 border border-white/10 text-zinc-400 hover:text-amber-300 hover:border-amber-400/50 transition-colors"
            >
              <Rss className="w-3 h-3" />
            </a>

            {!isStaticPublicMode && (
              <InstrumentButton
                size="icon"
                active={Boolean(geminiApiKey)}
                onClick={() => {
                  setDraftKey(geminiApiKey);
                  setShowKeyModal((v) => !v);
                }}
                title="Configure Optional Gemini 2.5 Flash Key"
                className="h-6 w-6"
              >
                <KeyRound className="w-3 h-3" />
              </InstrumentButton>
            )}
          </div>
        </ObsidianPanel>

        {/* SEISMIC DEFCON ANOMALY BANNER (3+ Platforms Converging in <45 Minutes) */}
        {defconAnomaly && (
          <ObsidianPanel className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-lg border-amber-400/40">
            <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-200">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-semibold text-amber-300 tabular-nums">
                DEFCON · {defconAnomaly.platforms.length}-NETWORK CONVERGENCE
              </span>
              <span className="h-3 w-px bg-white/12" />
              <span className="font-sans font-semibold text-zinc-100">
                {defconAnomaly.entityLabel}
              </span>
              <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/10 text-[10px] text-zinc-300">
                {defconAnomaly.platforms.join(' + ')}
              </span>
              <span className="hidden lg:inline font-sans text-zinc-400 truncate max-w-[400px]">
                {defconAnomaly.divergenceSummary}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <InstrumentButton
                size="xs"
                variant="accent"
                onClick={() => onFocusDefconSignal(defconAnomaly.signalId)}
              >
                Focus Supernova
              </InstrumentButton>
              <InstrumentButton
                size="icon"
                variant="ghost"
                onClick={onDismissDefcon}
                title="Dismiss DEFCON Alert"
                className="h-6 w-6"
              >
                <X className="w-3.5 h-3.5" />
              </InstrumentButton>
            </div>
          </ObsidianPanel>
        )}

        {/* Calibration Strip + Live Inbound Arrival Ticker */}
        <div className="flex flex-wrap items-center justify-between gap-2 max-w-full">
          {showCalibrationHint && (
            <div className="hidden md:inline-flex pointer-events-auto cockpit-obsidian items-center gap-2 px-2.5 py-1 rounded-md text-[10.5px] font-mono text-zinc-400">
              <span className="text-zinc-200 font-medium">CONTROLS</span>
              <span className="h-3 w-px bg-white/10" />
              <span className="inline-flex items-center gap-1">
                <Kbd>Scroll</Kbd> Zoom
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>1–5</Kbd> Literacy
              </span>
              <span className="hidden sm:inline-flex items-center gap-1">
                <Kbd>Drag</Kbd> Collide
              </span>
              <span className="hidden md:inline-flex items-center gap-1">
                <Kbd>Shift</Kbd> Lasso
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd>?</Kbd> Legend
              </span>
              <button
                type="button"
                onClick={onDismissHint}
                className="text-zinc-500 hover:text-zinc-200 ml-1 cursor-pointer"
                title="Dismiss Control Strip"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {latestLiveToast && (
            <div
              role="status"
              aria-live="polite"
              className={`pointer-events-none cockpit-obsidian items-center gap-2 px-2.5 py-1 rounded-md text-[10.5px] font-mono text-zinc-200 ml-auto max-w-full overflow-hidden ${
                mobileViewMode === 'FEED' ? 'hidden md:inline-flex' : 'inline-flex'
              } ${signalRailOpen ? 'md:mr-[324px]' : ''}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse shrink-0" />
              <span className="text-teal-300 shrink-0">{latestLiveToast.sector}</span>
              <span className="text-zinc-500 shrink-0">·</span>
              <span className="text-zinc-400 truncate max-w-[110px] sm:max-w-none">{latestLiveToast.source}</span>
              <span className="text-zinc-500 shrink-0">·</span>
              <span className="font-sans text-zinc-200 truncate max-w-[180px] sm:max-w-[280px]">
                {latestLiveToast.title}
              </span>
            </div>
          )}
        </div>

        {/* Optional Gemini API Key Popover */}
        {showKeyModal && (
          <ObsidianPanel className="pointer-events-auto ml-auto w-[340px] rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold text-zinc-100">
                GEMINI 2.5 FLASH API KEY
              </span>
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                className="text-zinc-500 hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11.5px] text-zinc-400 leading-relaxed">
              Deterministic 5-level literacy and 30/60/90d Blast-Radius run locally in 1ms. Add an optional Gemini key to synthesize live cloud rewrites.
            </p>
            <div className="space-y-1.5">
              <label className="block font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                API Key
              </label>
              <div className="flex gap-1.5">
                <input
                  type="password"
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="flex-1 h-7 px-2.5 rounded-md cockpit-well text-xs font-mono text-zinc-100 focus:outline-none focus:border-teal-400/70"
                />
                <InstrumentButton
                  variant="accent"
                  onClick={() => {
                    onSaveGeminiKey(draftKey.trim());
                    setShowKeyModal(false);
                  }}
                >
                  Save
                </InstrumentButton>
              </div>
            </div>
          </ObsidianPanel>
        )}
      </div>

      {/* =================================================================== */}
      {/* BOTTOM PLANETARIUM DOCK + SECTOR INDEX + 72H TIMELINE RULE          */}
      {/* =================================================================== */}
      <div
        className={`w-full max-w-full space-y-1.5 flex flex-col items-center transition-opacity duration-150 ${
          mobileSheetOpen || mobileViewMode === 'FEED'
            ? 'max-md:hidden'
            : 'max-md:pb-12'
        }`}
      >
        {/* Bottom-Center Dock: Prominent [▶ Briefing] Autopilot + My Radar 8-Sector Index */}
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={onToggleBriefing}
            title="Launch 90s Planetarium Briefing across today's top 5 highest-signal breakthroughs"
            className={`pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-md font-mono text-[11px] font-semibold tabular-nums transition-all cursor-pointer border shadow-lg ${
              briefingActive
                ? 'bg-teal-500/22 border-teal-400/70 text-teal-100 shadow-teal-500/15'
                : 'cockpit-obsidian border-teal-400/45 text-teal-200 hover:bg-teal-500/15 hover:border-teal-300/70 hover:text-white'
            }`}
          >
            {briefingActive ? (
              <>
                <Square className="w-2.5 h-2.5 fill-current text-teal-300" />
                <span>
                  Briefing {briefingStepIndex + 1} of {briefingTotalSteps} · Stop
                </span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 fill-current text-teal-300" />
                <span>90s Briefing</span>
              </>
            )}
          </button>

          <div
            aria-label="My Radar Category Filter"
            className="hidden sm:inline-flex pointer-events-auto cockpit-obsidian flex-wrap items-center justify-center px-1.5 py-0.5 rounded-md divide-x divide-white/8"
          >
            {SECTORS.map((sec) => {
              const isHovered = hoveredSectorCode === sec.code;
              const isMuted = mutedSectors.has(sec.id);
              return (
                <button
                  key={sec.id}
                  type="button"
                  onMouseEnter={() => {
                    setHoveredSectorCode(sec.code);
                    onHoverSectorIndex(sec.index);
                  }}
                  onMouseLeave={() => {
                    setHoveredSectorCode(null);
                    onHoverSectorIndex(-1);
                  }}
                  onClick={() => onToggleMuteSector(sec.id)}
                  onDoubleClick={() => onFlyToSector(sec.index)}
                  title={
                    isMuted
                      ? `${sec.name} is muted in My Radar — click to unmute (double-click to fly)`
                      : `Spotlight ${sec.name} · Click to mute from My Radar · Double-click to fly`
                  }
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 hover:bg-white/5 transition-all font-mono text-[10px] cursor-pointer ${
                    isMuted ? 'opacity-50' : ''
                  }`}
                >
                  <span
                    style={{ backgroundColor: isMuted ? '#52525b' : sec.colorHex }}
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                  />
                  <span
                    className={`font-semibold ${
                      isMuted ? 'line-through text-zinc-500' : 'text-zinc-200'
                    }`}
                  >
                    {sec.code}
                  </span>
                  <span
                    className={`font-sans transition-opacity duration-100 ${
                      isMuted ? 'line-through text-zinc-600' : 'text-zinc-400'
                    } ${isHovered ? 'inline' : 'hidden xl:inline'}`}
                  >
                    {sec.name.split(' ')[0]}
                  </span>
                </button>
              );
            })}
            {mutedSectors.size > 0 && (
              <button
                type="button"
                onClick={onResetMutedSectors}
                title="Restore all muted categories in My Radar"
                className="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[10px] text-teal-300 hover:text-white hover:bg-teal-500/15 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Unmute All</span>
              </button>
            )}
          </div>
        </div>

        {/* Precision 72h Timeline Scrubber Rule */}
        <ObsidianPanel className="pointer-events-auto w-full max-w-[820px] flex items-center gap-1.5 sm:gap-2.5 px-2 sm:px-2.5 py-1.5 rounded-lg overflow-hidden">
          <InstrumentButton
            size="xs"
            active={isTimeWarpPlaying}
            onClick={onToggleTimeWarp60x}
            title="Replay 72 hours of AI topology genesis at 60x relativistic speed"
            className="shrink-0 tabular-nums"
          >
            {isTimeWarpPlaying ? (
              <>
                <FastForward className="w-3 h-3 text-teal-300 animate-pulse" />
                <span className="sm:hidden">60x</span>
                <span className="hidden sm:inline">60x Active</span>
              </>
            ) : (
              <>
                <Play className="w-3 h-3 text-teal-400" />
                <span className="sm:hidden">60x</span>
                <span className="hidden sm:inline">60x Replay</span>
              </>
            )}
          </InstrumentButton>

          <span className="font-mono text-[10px] text-zinc-500 tabular-nums shrink-0">-72h</span>

          <canvas
            ref={scrubberCanvasRef}
            onPointerDown={(e) => {
              isDraggingScrubRef.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              scrubFromPointer(e.clientX);
            }}
            onPointerMove={(e) => {
              if (isDraggingScrubRef.current) {
                scrubFromPointer(e.clientX);
              }
            }}
            onPointerUp={() => {
              isDraggingScrubRef.current = false;
            }}
            className="w-full min-w-0 flex-1 h-[28px] cursor-ew-resize"
          />

          <InstrumentButton
            size="xs"
            active={isLiveNow}
            onClick={onSnapToLive}
            className="shrink-0 tabular-nums"
          >
            {isLiveNow ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>LIVE</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-3 h-3" />
                <span>-{hoursBehind.toFixed(1)}h</span>
              </>
            )}
          </InstrumentButton>
        </ObsidianPanel>
      </div>
    </div>
  );
};
