import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Layers, Play, X } from 'lucide-react';
import { computeDeterministicBlastRadius } from '../shared/blastRadiusEngine';
import {
  ATTRACTOR_STRIDE,
  HEADER_FLOATS,
  NODE_OFFSET,
} from '../shared/frameLayout';
import { buildDeterministicLiteracyPayload } from '../shared/literacyEngine';
import {
  BlastOrderConsequence,
  ClientIndustry,
  DefconAnomalyEvent,
  getZoomBand,
  LiteracyLevel,
  NODE_STRIDE,
  SECTOR_BY_ID,
  SECTORS,
  SectorId,
  SemanticZoomBand,
  SourceCategory,
  SpatialSignal,
  StaticGalaxySnapshot,
  SynthesisEngineId,
  SynthesisEngineStatus,
} from '../shared/types';
import { CommandPalette } from './components/CommandPalette';
import { CosmosDecoderHUD, TourStageInfo } from './components/CosmosDecoderHUD';
import {
  BattlecardPair,
  BlastSatellite,
  clampDiegeticCardCoords,
  DiegeticPool,
  hydrateStaticSnapshotLiteracyMap,
  PlanetariumBriefingBarProps,
  StandupFusionState,
} from './components/DiegeticPool';
import { MobileSignalDeck, MobileSignalDeckEntry } from './components/MobileSignalDeck';
import { SignalRail, SignalRailEntry } from './components/SignalRail';
import { SourcesRadarDrawer } from './components/SourcesRadarDrawer';
import { SpatialHorizonHUD } from './components/SpatialHorizonHUD';
import { SpatialAudioSynth } from './engine/synthEngine';
import { ConstellationArcLink, LassoPoint, renderTacticalOverlay } from './engine/tacticalOverlay';
import { SpatialWebGLEngine, WebGLDiagnostics } from './engine/webglEngine';
import { cockpitAudio } from './utils/cockpitAudio';
import {
  buildCortexDeepLinkUrl,
  matchSignalByDeepLinkParam,
  parseCortexDeepLink,
} from './utils/deepLink';
import {
  computeSignalMomentumScore,
  findRelatedSignalIndices,
  getActiveLensTakeaway,
  getCleanDisplayHeadline,
} from './utils/signalRanking';

const DEFAULT_CAM_X = 0;
const DEFAULT_CAM_Y = -14;
const DEFAULT_CAM_ZOOM = 0.74;

const INITIAL_ENABLED_CATEGORIES: Record<Exclude<SourceCategory, 'DEMO_SEED'>, boolean> = {
  VIP_VOICE: true,
  SOCIAL_BLUESKY: true,
  AI_LAB: true,
  GH_RELEASE: true,
  REDDIT: true,
  RESEARCH: true,
  HN_COMMUNITY: true,
  X_BRIDGE: true,
  X_PLAYWRIGHT: true,
  DISCORD_RELAY: true,
};

const TOUR_STEPS: Array<{ title: string; caption: string }> = [
  {
    title: 'CENTRAL SYNTHESIS CORE & GRAVITY',
    caption:
      'World (0,0) anchors 8 Sector Attractors. Switching Client Gravity physically pulls priority industry breakthroughs into inner orbits.',
  },
  {
    title: '8 SECTOR ATTRACTORS & SHADER RINGS',
    caption:
      'Solid rings = GA Ready, Dashed = Preview, Double Halo = Research, 4-Point Spikes = Model Collider, Crimson Corona = High Governance Risk.',
  },
  {
    title: 'SEMANTIC ZOOM & LIVE INBOUND COMETS',
    caption:
      'Zooming shifts lenses automatically (C-Suite → Architect → Raw Signal) while source-linked $0 VIP, Lab, X & arXiv signals enter on comet trajectories.',
  },
  {
    title: '30/60/90d BLAST-RADIUS & 72h TIME-WARP',
    caption:
      'Click any orb for 30/60/90-day client consequences, collide two orbs for a Battlecard, or scrub 72h history at 60x speed.',
  },
];

function pointInPolygon(px: number, py: number, poly: LassoPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-6) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

declare global {
  interface Window {
    __CORTEX_DIAGNOSTICS__?: {
      fps: number;
      avgFrameMs: number;
      p95FrameMs: number;
      workerMs: number;
      clsScore: number;
      lcpMs: number;
      longTaskCount: number;
      maxLongTaskMs: number;
      jsHeapUsedMB: number | null;
      nodeCount: number;
      visibleNodeCount: number;
      webgl: WebGLDiagnostics | null;
    };
    __CORTEX_ACTIONS__?: {
      triggerLiveDrop: () => void;
      toggleTimeWarp60x: () => void;
      setZoom: (z: number) => void;
      collideTopModels: () => void;
      clearOverlays: () => void;
      start15sTour: () => void;
    };
  }
}

export const App: React.FC = () => {
  const webglCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tacticalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const poolSlotRefs = useRef<Array<HTMLDivElement | null>>([null, null, null, null, null, null]);

  const webglEngineRef = useRef<SpatialWebGLEngine | null>(null);
  const ingestWorkerRef = useRef<Worker | null>(null);
  const physicsWorkerRef = useRef<Worker | null>(null);
  const audioSynthRef = useRef<SpatialAudioSynth>(new SpatialAudioSynth());

  const latestPacketRef = useRef<Float32Array | null>(null);
  const signalsRef = useRef<SpatialSignal[]>([]);
  const baseNowMsRef = useRef<number>(Date.now());

  // Smooth camera state framed to true 16:9 optical center below top HUD ribbon
  const camRef = useRef({
    x: DEFAULT_CAM_X,
    y: DEFAULT_CAM_Y,
    zoom: DEFAULT_CAM_ZOOM,
    targetX: DEFAULT_CAM_X,
    targetY: DEFAULT_CAM_Y,
    targetZoom: DEFAULT_CAM_ZOOM,
  });

  // 15-Second Automated Camera Flythrough Tour ref (driven cleanly inside RAF)
  const tourRef = useRef<{
    active: boolean;
    startMs: number;
    lastTriggeredAct: number;
  }>({
    active: false,
    startMs: 0,
    lastTriggeredAct: -1,
  });

  // Pointer & Gesture state
  const pointerRef = useRef({
    screenX: 0,
    screenY: 0,
    worldX: 99999,
    worldY: 99999,
    lastMoveMs: 0,
    active: false,
    isPanning: false,
    panStartScreenX: 0,
    panStartScreenY: 0,
    panStartCamX: 0,
    panStartCamY: DEFAULT_CAM_Y,
    pointerDownScreenX: 0,
    pointerDownScreenY: 0,
    pointerDownPerfMs: 0,
    pendingNodeIdx: -1,
    hasInitiatedNodeDrag: false,
    dropTargetNodeIdx: -1,
    draggedNodeIdx: -1,
    isLassoing: false,
    lassoPoints: [] as LassoPoint[],
    lassoCaptured: new Set<number>(),
    lastHoveredIdx: -1,
    hoverStartPerfMs: 0,
  });

  const initialDeepLinkRef = useRef(
    typeof window !== 'undefined'
      ? parseCortexDeepLink(window.location.search)
      : { signalId: null, level: null }
  );
  const pendingDeepLinkRef = useRef<{ signalId: string | null; level: LiteracyLevel | null }>({
    signalId: initialDeepLinkRef.current.signalId,
    level: initialDeepLinkRef.current.level,
  });
  const pendingCameraFlyNodeIdxRef = useRef<number>(-1);
  const hasAutoSelectedInitialRef = useRef<boolean>(false);
  const shouldSyncUrlRef = useRef<boolean>(Boolean(initialDeepLinkRef.current.signalId));

  // Daily Habit Loop: Persist cortex_last_visit (+ legacy cortex_last_visit_ts) & cortex_seen_node_ids
  const isReturnVisitRef = useRef<boolean>(false);
  const previousVisitTsRef = useRef<number>((() => {
    try {
      const saved = Number(
        localStorage.getItem('cortex_last_visit') || localStorage.getItem('cortex_last_visit_ts')
      );
      if (Number.isFinite(saved) && saved > 0) {
        isReturnVisitRef.current = true;
        return saved;
      }
    } catch {
      // Ignore storage errors
    }
    return Date.now() - 12 * 3600_000;
  })());

  const [seenNodeIds, setSeenNodeIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('cortex_seen_node_ids');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr.filter((x) => typeof x === 'string'));
      }
    } catch {
      // Ignore storage errors
    }
    return new Set<string>();
  });
  const seenNodeIdsRef = useRef<Set<string>>(seenNodeIds);
  seenNodeIdsRef.current = seenNodeIds;

  // Custom My Radar Muted Categories (persisted locally in localStorage, zero backend)
  const [mutedSectors, setMutedSectors] = useState<Set<SectorId>>(() => {
    try {
      const raw = localStorage.getItem('cortex_my_radar_muted_v1');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return new Set(
            parsed.filter((id): id is SectorId => typeof id === 'string' && id in SECTOR_BY_ID)
          );
        }
      }
    } catch {
      // Ignore storage errors
    }
    return new Set<SectorId>();
  });
  const mutedSectorsRef = useRef<Set<SectorId>>(mutedSectors);
  mutedSectorsRef.current = mutedSectors;

  const mutedSectorIndices = useMemo(() => {
    const indices = new Set<number>();
    for (const sec of mutedSectors) {
      const meta = SECTOR_BY_ID[sec];
      if (meta) indices.add(meta.index);
    }
    return indices;
  }, [mutedSectors]);
  const mutedSectorIndicesRef = useRef<ReadonlySet<number>>(mutedSectorIndices);
  mutedSectorIndicesRef.current = mutedSectorIndices;

  const toggleMuteSector = useCallback((sec: SectorId) => {
    setMutedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sec)) next.delete(sec);
      else next.add(sec);
      try {
        localStorage.setItem('cortex_my_radar_muted_v1', JSON.stringify(Array.from(next)));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
    cockpitAudio.playScrubberDetentTick(2);
  }, []);

  const resetMutedSectors = useCallback(() => {
    setMutedSectors(new Set<SectorId>());
    try {
      localStorage.removeItem('cortex_my_radar_muted_v1');
    } catch {
      // Ignore storage errors
    }
    cockpitAudio.playScrubberDetentTick(1);
  }, []);

  const [onlyNewFilterActive, setOnlyNewFilterActive] = useState(false);
  const [deepLinkLevelOverride, setDeepLinkLevelOverride] = useState<{
    signalId: string;
    level: LiteracyLevel;
    nonce: number;
  } | null>(null);

  // Stage 7 & Phase 2: Responsive Mobile Signal Deck (< 768px), Signal Rail, Command Palette & Guided 90s Briefing
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const isMobileViewportRef = useRef<boolean>(isMobileViewport);
  isMobileViewportRef.current = isMobileViewport;

  const [mobileViewMode, setMobileViewMode] = useState<'FEED' | 'MAP'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'FEED' : 'MAP'
  );
  const mobileViewModeRef = useRef(mobileViewMode);
  mobileViewModeRef.current = mobileViewMode;

  const [signalRailOpen, setSignalRailOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const signalRailOpenRef = useRef(signalRailOpen);
  signalRailOpenRef.current = signalRailOpen;

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [canvasHoveredNodeIdx, setCanvasHoveredNodeIdx] = useState(-1);
  const [railHoveredNodeIdx, setRailHoveredNodeIdx] = useState(-1);
  const [hoveredSectorIdx, setHoveredSectorIdx] = useState(-1);

  const constellationLinksRef = useRef<ConstellationArcLink[]>([]);
  const spotlightSourceIdxRef = useRef<number>(-1);
  const spotlightSectorIdxRef = useRef<number>(-1);
  const hasActiveFilterRef = useRef<boolean>(false);

  const [showCoachmark, setShowCoachmark] = useState<boolean>(() => {
    try {
      return !localStorage.getItem('cortex_onboarded_v1');
    } catch {
      return false;
    }
  });

  const [briefingListenEnabled, setBriefingListenEnabled] = useState(false);
  const briefingListenEnabledRef = useRef(briefingListenEnabled);
  briefingListenEnabledRef.current = briefingListenEnabled;
  const speechSupported =
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined';

  const [briefingState, setBriefingState] = useState<{
    active: boolean;
    stopIndices: number[];
    currentStep: number;
    paused: boolean;
    remainingSec: number;
    elapsedStepMs: number;
  }>({
    active: false,
    stopIndices: [],
    currentStep: 0,
    paused: false,
    remainingSec: 18,
    elapsedStepMs: 0,
  });
  const briefingStateRef = useRef(briefingState);
  briefingStateRef.current = briefingState;

  // Multi-pointer touch pinch-zoom & single-finger pan tracker
  const activeTouchPointsRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchBaselineRef = useRef<{
    spanPx: number;
    startZoom: number;
    midWorldX: number;
    midWorldY: number;
  } | null>(null);

  // React UI state (updated only on discrete semantic transitions or 4Hz HUD telemetry)
  const [signalsVersion, setSignalsVersion] = useState(0);
  const [selectedNodeIdx, setSelectedNodeIdx] = useState<number>(-1);
  const [zoomHoverNodeIdx, setZoomHoverNodeIdx] = useState<number>(-1);
  const [blastWaveActiveForNodeIdx, setBlastWaveActiveForNodeIdx] = useState<number>(-1);
  const [battlecardPair, setBattlecardPair] = useState<BattlecardPair | null>(null);
  const [standupFusion, setStandupFusion] = useState<StandupFusionState | null>(null);
  const [activeClient, setActiveClient] = useState<ClientIndustry>('BANKING');
  const [audioEnabled, setAudioEnabled] = useState<boolean>(() => cockpitAudio.isEnabled());
  const [isTimeWarpPlaying, setIsTimeWarpPlaying] = useState(false);
  const [playheadOffsetMs, setPlayheadOffsetMs] = useState(0);
  const [hudStats, setHudStats] = useState({
    zoom: DEFAULT_CAM_ZOOM,
    zoomBand: 'CSUITE' as SemanticZoomBand,
    fps: 60,
    workerMs: 0.3,
    visibleCount: 16,
  });
  const [latestLiveToast, setLatestLiveToast] = useState<{
    sector: string;
    title: string;
    source: string;
  } | null>(null);
  const [showCalibrationHint, setShowCalibrationHint] = useState(true);

  // Stage 2: Cosmos Decoder (opened manually via ? Legend) — Zero-Friction Coachmark handles cold visits
  const [decoderOpen, setDecoderOpen] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState<boolean>(false);
  const [tourState, setTourState] = useState<TourStageInfo | null>(null);
  const [sourcesDrawerOpen, setSourcesDrawerOpen] = useState(false);
  const [showDemoSeed, setShowDemoSeed] = useState(true);
  const showDemoSeedRef = useRef(showDemoSeed);
  showDemoSeedRef.current = showDemoSeed;
  const userManuallyToggledSeedRef = useRef(false);
  const hasAutoSwitchedToPureLiveRef = useRef(false);
  const [enabledCategories, setEnabledCategories] =
    useState<Record<Exclude<SourceCategory, 'DEMO_SEED'>, boolean>>(INITIAL_ENABLED_CATEGORIES);

  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('cortex_gemini_key') || '';
    } catch {
      return '';
    }
  });

  // Stage 4 ("UNIVERSAL LITERACY LENS: L1 -> L5"): Global Default Literacy Level (persisted + Deep-Link aware)
  const [globalLiteracyLevel, setGlobalLiteracyLevel] = useState<LiteracyLevel>(() => {
    if (initialDeepLinkRef.current.level) {
      return initialDeepLinkRef.current.level;
    }
    try {
      const saved = Number(localStorage.getItem('cortex_literacy_level_v4'));
      if (saved >= 1 && saved <= 5) return saved as LiteracyLevel;
    } catch {
      // Ignore storage errors
    }
    return 2; // Default L2 Plain English for approachable humanized galaxy out of the box
  });
  const globalLiteracyLevelRef = useRef<LiteracyLevel>(globalLiteracyLevel);
  globalLiteracyLevelRef.current = globalLiteracyLevel;

  const handleSelectLiteracyLevel = useCallback((lvl: LiteracyLevel) => {
    shouldSyncUrlRef.current = true;
    setGlobalLiteracyLevel(lvl);
    cockpitAudio.playScrubberDetentTick(lvl);
    audioSynthRef.current.playHoverStasisTick((lvl - 3) * 0.25);
    try {
      localStorage.setItem('cortex_literacy_level_v4', String(lvl));
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  // Persist cortex_last_visit & cortex_last_visit_ts cleanly after session dwell + unload
  useEffect(() => {
    const commitVisitTs = () => {
      try {
        const nowStr = String(Date.now());
        localStorage.setItem('cortex_last_visit', nowStr);
        localStorage.setItem('cortex_last_visit_ts', nowStr);
      } catch {
        // Ignore storage restrictions
      }
    };
    const dwellTimer = setTimeout(commitVisitTs, 15_000);
    const onVisChange = () => {
      if (document.visibilityState === 'hidden') commitVisitTs();
    };
    window.addEventListener('beforeunload', commitVisitTs);
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      clearTimeout(dwellTimer);
      window.removeEventListener('beforeunload', commitVisitTs);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, []);

  // Stage 8: Dual-Mode Serverless Static Snapshot state (GitHub Pages / Cloudflare Pages vs Local :3001)
  const [isStaticPublicMode, setIsStaticPublicMode] = useState(false);
  const [staticBakedAtMs, setStaticBakedAtMs] = useState<number | null>(null);

  // Stage 3 ("CORTEX // OMNISCIENCE"): Tri-Engine Synthesis & Seismic DEFCON Anomaly state
  const [activeSynthesisEngine, setActiveSynthesisEngine] =
    useState<SynthesisEngineId>('DETERMINISTIC');
  const [userLockedRules, setUserLockedRules] = useState(false);
  const userLockedRulesRef = useRef(false);
  const [synthesisStatus, setSynthesisStatus] = useState<SynthesisEngineStatus | null>(null);
  const [defconAnomaly, setDefconAnomaly] = useState<DefconAnomalyEvent | null>(null);

  // Purge any legacy stale localStorage synthesis engine lock from before Ollama was installed
  useEffect(() => {
    try {
      localStorage.removeItem('cortex_synthesis_engine');
      localStorage.removeItem('cortex_synth_engine');
      localStorage.removeItem('activeSynthesisEngine');
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  // Probe Tri-Engine status on boot + continuous health sync (skipped cleanly in Static Public Mode)
  useEffect(() => {
    if (isStaticPublicMode) return;
    let cancelled = false;
    const syncEngines = async () => {
      try {
        const r = await fetch('/api/synthesis/engines');
        if (!r.ok || cancelled) return;
        const raw = (await r.json()) as { synthesis?: SynthesisEngineStatus } | SynthesisEngineStatus;
        if (cancelled) return;
        const data: SynthesisEngineStatus =
          'synthesis' in raw && raw.synthesis ? raw.synthesis : (raw as SynthesisEngineStatus);
        if (!data.ollama) return;
        setSynthesisStatus(data);

        if (!userLockedRulesRef.current) {
          if (data.ollama.online && data.ollama.selectedModel) {
            setActiveSynthesisEngine((prev) =>
              prev !== 'OLLAMA' && !(prev === 'GEMINI' && Boolean(geminiApiKey)) ? 'OLLAMA' : prev
            );
          } else if (data.gemini?.configured || geminiApiKey) {
            setActiveSynthesisEngine((prev) => (prev === 'DETERMINISTIC' ? 'GEMINI' : prev));
          }
        }
      } catch {
        // Proxy restarting — retry cleanly on next interval
      }
    };

    void syncEngines();
    const fastRetry = setTimeout(() => void syncEngines(), 1500);
    const pollId = setInterval(() => void syncEngines(), 8000);
    return () => {
      cancelled = true;
      clearTimeout(fastRetry);
      clearInterval(pollId);
    };
  }, [geminiApiKey, isStaticPublicMode]);

  const handleSelectSynthesisEngine = useCallback((engine: SynthesisEngineId) => {
    const lockedToRules = engine === 'DETERMINISTIC';
    userLockedRulesRef.current = lockedToRules;
    setUserLockedRules(lockedToRules);
    setActiveSynthesisEngine(engine);
    audioSynthRef.current.playHoverStasisTick(0);
    fetch('/api/adapters/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeSynthesisEngine: engine }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.synthesis) setSynthesisStatus(data.synthesis);
      })
      .catch(() => {
        // Local UI selection persists even if offline
      });
  }, []);

  const selectedNodeIdxRef = useRef(-1);
  selectedNodeIdxRef.current = selectedNodeIdx;

  const zoomHoverNodeIdxRef = useRef(-1);
  zoomHoverNodeIdxRef.current = zoomHoverNodeIdx;

  const battlecardPairRef = useRef<BattlecardPair | null>(null);
  battlecardPairRef.current = battlecardPair;

  const standupFusionRef = useRef<StandupFusionState | null>(null);
  standupFusionRef.current = standupFusion;

  const dismissCoachmarkPermanently = useCallback(() => {
    setShowCoachmark(false);
    try {
      localStorage.setItem('cortex_onboarded_v1', '1');
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  const dismissWelcome = useCallback(() => {
    setShowWelcomeModal(false);
    dismissCoachmarkPermanently();
    try {
      localStorage.setItem('cortex_welcome_seen_v2', '1');
    } catch {
      // Ignore storage restrictions
    }
  }, [dismissCoachmarkPermanently]);

  const stop15sTour = useCallback(() => {
    if (!tourRef.current.active) return;
    tourRef.current.active = false;
    tourRef.current.lastTriggeredAct = -1;
    setTourState(null);
  }, []);

  const flyCameraToNodeIndex = useCallback((nodeIdx: number) => {
    const pkt = latestPacketRef.current;
    if (pkt && nodeIdx >= 0 && nodeIdx < (pkt[0] | 0)) {
      const off = NODE_OFFSET + nodeIdx * NODE_STRIDE;
      const targetZoom = isMobileViewportRef.current ? 1.28 : 1.48;
      // On mobile (< 768px), offset camera downward in world space so the focused orb shines visibly above the docked bottom sheet!
      const mobileWorldYOffset = isMobileViewportRef.current ? 140 / targetZoom : 0;
      camRef.current.targetX = pkt[off];
      camRef.current.targetY = pkt[off + 1] + mobileWorldYOffset;
      camRef.current.targetZoom = targetZoom;
    } else {
      pendingCameraFlyNodeIdxRef.current = nodeIdx;
    }
  }, []);

  const speakBriefingStop = useCallback(
    (nodeIdx: number) => {
      if (!speechSupported || !briefingListenEnabledRef.current) return;
      try {
        window.speechSynthesis.cancel();
        const sig = signalsRef.current[nodeIdx];
        if (!sig) return;
        const lvl = globalLiteracyLevelRef.current;
        const lit = sig.literacy || buildDeterministicLiteracyPayload(sig, activeClient);
        const headline = getCleanDisplayHeadline(sig, lvl);
        const takeaway = getActiveLensTakeaway(sig, lit, lvl).text;
        const utter = new SpeechSynthesisUtterance(`${headline}. ${takeaway}`);
        utter.rate = 1.04;
        window.speechSynthesis.speak(utter);
      } catch {
        // Ignore browser speech synthesis edge errors
      }
    },
    [activeClient, speechSupported]
  );

  const stopPlanetariumBriefing = useCallback(() => {
    if (speechSupported) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore cancellation errors
      }
    }
    setBriefingState({
      active: false,
      stopIndices: [],
      currentStep: 0,
      paused: false,
      remainingSec: 18,
      elapsedStepMs: 0,
    });
  }, [speechSupported]);

  const startPlanetariumBriefing = useCallback(() => {
    dismissCoachmarkPermanently();
    stop15sTour();
    shouldSyncUrlRef.current = true;
    setShowWelcomeModal(false);
    setShowCalibrationHint(false);
    setBattlecardPair(null);
    setStandupFusion(null);
    setBlastWaveActiveForNodeIdx(-1);
    if (isMobileViewportRef.current) {
      setMobileViewMode('MAP');
    }

    const all = signalsRef.current;
    const nowMs = Date.now();
    const liveCandidates: Array<{ idx: number; score: number }> = [];
    const fallbackCandidates: Array<{ idx: number; score: number }> = [];

    for (let i = 0; i < all.length; i++) {
      const s = all[i];
      if (!s) continue;
      if (mutedSectors.has(s.primarySector)) continue;
      if (s.sourceCategory && s.sourceCategory !== 'DEMO_SEED' && !enabledCategories[s.sourceCategory]) {
        continue;
      }
      const score = computeSignalMomentumScore(s, nowMs);
      if (!s.isDemoSeed && s.sourceCategory !== 'DEMO_SEED') {
        liveCandidates.push({ idx: i, score });
      } else if (showDemoSeedRef.current) {
        fallbackCandidates.push({ idx: i, score });
      }
    }

    const pool =
      liveCandidates.length >= 5
        ? liveCandidates
        : [...liveCandidates, ...fallbackCandidates];
    if (pool.length === 0 && all.length > 0) {
      all.forEach((s, idx) =>
        pool.push({ idx, score: computeSignalMomentumScore(s, nowMs) })
      );
    }

    pool.sort((a, b) => b.score - a.score);
    const stops = pool.slice(0, 5).map((c) => c.idx);
    if (stops.length === 0) return;

    const firstIdx = stops[0];
    setBriefingState({
      active: true,
      stopIndices: stops,
      currentStep: 0,
      paused: false,
      remainingSec: 18,
      elapsedStepMs: 0,
    });
    setSelectedNodeIdx(firstIdx);
    flyCameraToNodeIndex(firstIdx);
    physicsWorkerRef.current?.postMessage({ type: 'SELECT_NODE', nodeIndex: firstIdx });
    speakBriefingStop(firstIdx);
  }, [
    dismissCoachmarkPermanently,
    enabledCategories,
    flyCameraToNodeIndex,
    mutedSectors,
    speakBriefingStop,
    stop15sTour,
  ]);

  const stepPlanetariumBriefing = useCallback(
    (delta: number) => {
      const cur = briefingStateRef.current;
      if (!cur.active || cur.stopIndices.length === 0) return;
      const len = cur.stopIndices.length;
      const nextStep = (cur.currentStep + delta + len) % len;
      const targetNodeIdx = cur.stopIndices[nextStep];
      shouldSyncUrlRef.current = true;
      setBriefingState((prev) => ({
        ...prev,
        currentStep: nextStep,
        remainingSec: 18,
        elapsedStepMs: 0,
      }));
      setSelectedNodeIdx(targetNodeIdx);
      setBlastWaveActiveForNodeIdx(-1);
      flyCameraToNodeIndex(targetNodeIdx);
      physicsWorkerRef.current?.postMessage({
        type: 'SELECT_NODE',
        nodeIndex: targetNodeIdx,
      });
      speakBriefingStop(targetNodeIdx);
    },
    [flyCameraToNodeIndex, speakBriefingStop]
  );

  // 90-Second Guided Briefing Timer (5 stops x 18s = 90s; 200ms smooth progress bar update)
  useEffect(() => {
    if (!briefingState.active || briefingState.paused) {
      if (briefingState.paused && speechSupported) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // Ignore cancellation errors
        }
      }
      return;
    }

    const BRIEFING_STEP_MS = 18_000;
    const timer = setInterval(() => {
      const cur = briefingStateRef.current;
      if (!cur.active || cur.paused) return;
      const nextElapsed = cur.elapsedStepMs + 200;
      if (nextElapsed < BRIEFING_STEP_MS) {
        const nextRem = Math.max(1, Math.ceil((BRIEFING_STEP_MS - nextElapsed) / 1000));
        setBriefingState((prev) => ({
          ...prev,
          elapsedStepMs: nextElapsed,
          remainingSec: nextRem,
        }));
      } else if (cur.currentStep + 1 < cur.stopIndices.length) {
        const nextStep = cur.currentStep + 1;
        const nextNodeIdx = cur.stopIndices[nextStep];
        shouldSyncUrlRef.current = true;
        setBriefingState((prev) => ({
          ...prev,
          currentStep: nextStep,
          remainingSec: 18,
          elapsedStepMs: 0,
        }));
        setSelectedNodeIdx(nextNodeIdx);
        setBlastWaveActiveForNodeIdx(-1);
        flyCameraToNodeIndex(nextNodeIdx);
        physicsWorkerRef.current?.postMessage({
          type: 'SELECT_NODE',
          nodeIndex: nextNodeIdx,
        });
        speakBriefingStop(nextNodeIdx);
      } else {
        stopPlanetariumBriefing();
        setSelectedNodeIdx(-1);
        camRef.current.targetX = DEFAULT_CAM_X;
        camRef.current.targetY = DEFAULT_CAM_Y;
        camRef.current.targetZoom = DEFAULT_CAM_ZOOM;
        physicsWorkerRef.current?.postMessage({ type: 'SELECT_NODE', nodeIndex: -1 });
      }
    }, 200);
    return () => clearInterval(timer);
  }, [
    briefingState.active,
    briefingState.paused,
    flyCameraToNodeIndex,
    speakBriefingStop,
    speechSupported,
    stopPlanetariumBriefing,
  ]);

  const start15sTour = useCallback(() => {
    dismissWelcome();
    stopPlanetariumBriefing();
    setShowCalibrationHint(false);
    setSelectedNodeIdx(-1);
    setBlastWaveActiveForNodeIdx(-1);
    setBattlecardPair(null);
    setStandupFusion(null);
    tourRef.current = {
      active: true,
      startMs: performance.now(),
      lastTriggeredAct: -1,
    };
    setTourState({
      active: true,
      stepIndex: 0,
      title: TOUR_STEPS[0].title,
      caption: TOUR_STEPS[0].caption,
      progressNorm: 0,
    });
  }, [dismissWelcome, stopPlanetariumBriefing]);

  // Fresh signals arrived since previous session (Habit Loop)
  const { newSignalIdSet, newSignalsCount } = useMemo(() => {
    void signalsVersion;
    const baselineTs = previousVisitTsRef.current;
    const freshSet = new Set<string>();
    for (const s of signalsRef.current) {
      if (s.isDemoSeed || s.sourceCategory === 'DEMO_SEED') continue;
      if (mutedSectors.has(s.primarySector)) continue;
      if (s.sourceCategory && !enabledCategories[s.sourceCategory]) continue;
      if (s.publishedAtMs > baselineTs && !seenNodeIds.has(s.id)) {
        freshSet.add(s.id);
      }
    }
    return { newSignalIdSet: freshSet, newSignalsCount: freshSet.size };
  }, [signalsVersion, enabledCategories, mutedSectors, seenNodeIds]);

  // Top 10 Ranked Signals for Desktop Signal Rail (strict <=48h gate, <=72h fallback only if <10) & Mobile Signal Deck
  const { top10Signals, mobileDeckSignals } = useMemo(() => {
    void signalsVersion;
    const all = signalsRef.current;
    const nowMs = Date.now();
    const TOP10_PRIMARY_AGE_MS = 48 * 3_600_000;
    const TOP10_FALLBACK_AGE_MS = 72 * 3_600_000;
    const GALAXY_MAX_AGE_MS = 7 * 24 * 3_600_000;
    const FUTURE_SKEW_MS = 600_000;

    const hasEnoughLive =
      all.filter((s) => !s.isDemoSeed && s.sourceCategory !== 'DEMO_SEED').length >= 5;

    const railFresh48: SignalRailEntry[] = [];
    const railFallback72: SignalRailEntry[] = [];
    const deckPool: Array<MobileSignalDeckEntry & { momentum: number }> = [];

    for (let i = 0; i < all.length; i++) {
      const s = all[i];
      if (!s) continue;
      if (s.sourceCategory && s.sourceCategory !== 'DEMO_SEED' && !enabledCategories[s.sourceCategory]) {
        continue;
      }
      const isSeed = Boolean(s.isDemoSeed || s.sourceCategory === 'DEMO_SEED');
      if (!showDemoSeed && isSeed && hasEnoughLive) continue;
      if (isSeed && hasEnoughLive) {
        // Keep Top 10 & Mobile Feed clean of demo seeds once live/baked signals exist
        continue;
      }

      const validTs =
        typeof s.publishedAtMs === 'number' &&
        Number.isFinite(s.publishedAtMs) &&
        s.publishedAtMs > 0;
      if (!validTs) continue;

      const ageMs = nowMs - s.publishedAtMs;
      if (ageMs < -FUTURE_SKEW_MS || ageMs > GALAXY_MAX_AGE_MS) continue;

      const momentumScore = computeSignalMomentumScore(s, nowMs);
      const isNew = !isSeed && newSignalIdSet.has(s.id);

      if (
        !mutedSectors.has(s.primarySector) &&
        (!onlyNewFilterActive || isNew)
      ) {
        const entry: SignalRailEntry = { nodeIndex: i, signal: s, momentumScore, isNew };
        if (ageMs <= TOP10_PRIMARY_AGE_MS) {
          railFresh48.push(entry);
        } else if (ageMs <= TOP10_FALLBACK_AGE_MS) {
          railFallback72.push(entry);
        }
      }

      if (!onlyNewFilterActive || isNew) {
        deckPool.push({ nodeIndex: i, signal: s, isNew, momentum: momentumScore });
      }
    }

    railFresh48.sort((a, b) => b.momentumScore - a.momentumScore);
    railFallback72.sort((a, b) => b.momentumScore - a.momentumScore);
    deckPool.sort((a, b) => b.momentum - a.momentum);

    const rankedTop10 =
      railFresh48.length >= 10
        ? railFresh48.slice(0, 10)
        : [...railFresh48, ...railFallback72].slice(0, 10);

    return {
      top10Signals: rankedTop10,
      mobileDeckSignals: deckPool
        .slice(0, 40)
        .map(({ nodeIndex, signal, isNew }) => ({ nodeIndex, signal, isNew })),
    };
  }, [signalsVersion, showDemoSeed, enabledCategories, mutedSectors, onlyNewFilterActive, newSignalIdSet]);

  // Sync Source Category + My Radar Muted Categories (completely hidden) vs "+N New" (smoothly dimmed)
  useEffect(() => {
    void signalsVersion;
    const hiddenIds: string[] = [];
    for (const s of signalsRef.current) {
      const categoryHidden =
        Boolean(s.sourceCategory) &&
        s.sourceCategory !== 'DEMO_SEED' &&
        !enabledCategories[s.sourceCategory!];
      const mutedHidden = mutedSectors.has(s.primarySector);
      if (categoryHidden || mutedHidden) {
        hiddenIds.push(s.id);
      }
    }
    physicsWorkerRef.current?.postMessage({
      type: 'SET_HIDDEN_SIGNAL_IDS',
      ids: hiddenIds,
    });
  }, [enabledCategories, mutedSectors, signalsVersion]);

  useEffect(() => {
    void signalsVersion;
    const dimmedIds: string[] = [];
    if (onlyNewFilterActive) {
      for (const s of signalsRef.current) {
        if (s.isDemoSeed || s.sourceCategory === 'DEMO_SEED' || !newSignalIdSet.has(s.id)) {
          dimmedIds.push(s.id);
        }
      }
    }
    physicsWorkerRef.current?.postMessage({
      type: 'SET_DIMMED_SIGNAL_IDS',
      ids: dimmedIds,
    });
    hasActiveFilterRef.current = onlyNewFilterActive || mutedSectors.size > 0;
  }, [onlyNewFilterActive, mutedSectors.size, newSignalIdSet, signalsVersion]);

  // Sync Spotlight Dimming (~15% non-matching) & Constellation Arcs on Orb / Rail / Category Hover
  useEffect(() => {
    void signalsVersion;
    const hoveredNode = railHoveredNodeIdx >= 0 ? railHoveredNodeIdx : canvasHoveredNodeIdx;
    spotlightSourceIdxRef.current = hoveredNode;
    spotlightSectorIdxRef.current = hoveredSectorIdx;

    if (hoveredSectorIdx >= 0) {
      const all = signalsRef.current;
      const secId = SECTORS[hoveredSectorIdx]?.id;
      const matching: number[] = [];
      for (let i = 0; i < all.length; i++) {
        const s = all[i];
        if (!s || mutedSectors.has(s.primarySector)) continue;
        if (!showDemoSeed && (s.isDemoSeed || s.sourceCategory === 'DEMO_SEED')) continue;
        if (
          s.primarySector === secId ||
          (secId && s.secondarySectors.includes(secId))
        ) {
          matching.push(i);
        }
      }
      const arcs: ConstellationArcLink[] = [];
      for (let k = 0; k < Math.min(matching.length - 1, 6); k++) {
        arcs.push({ fromIdx: matching[0], toIdx: matching[k + 1], strength: 0.72 });
      }
      constellationLinksRef.current = arcs;
      physicsWorkerRef.current?.postMessage({
        type: 'SET_SPOTLIGHT',
        active: true,
        dimLevel: 0.15,
        matchingIndices: matching,
      });
      return;
    }

    if (hoveredNode >= 0 && signalsRef.current[hoveredNode]) {
      const all = signalsRef.current;
      const related = findRelatedSignalIndices(all, hoveredNode, 6).filter((r) => {
        const cand = all[r.index];
        if (!cand) return false;
        if (mutedSectors.has(cand.primarySector)) return false;
        if (!showDemoSeed && (cand.isDemoSeed || cand.sourceCategory === 'DEMO_SEED')) return false;
        return true;
      });
      const matching = [hoveredNode, ...related.map((r) => r.index)];
      constellationLinksRef.current = related.map((r) => ({
        fromIdx: hoveredNode,
        toIdx: r.index,
        strength: r.strength,
      }));
      physicsWorkerRef.current?.postMessage({
        type: 'SET_SPOTLIGHT',
        active: true,
        dimLevel: 0.15,
        matchingIndices: matching,
      });
      return;
    }

    constellationLinksRef.current = [];
    physicsWorkerRef.current?.postMessage({
      type: 'SET_SPOTLIGHT',
      active: false,
      matchingIndices: [],
    });
  }, [
    canvasHoveredNodeIdx,
    railHoveredNodeIdx,
    hoveredSectorIdx,
    signalsVersion,
    mutedSectors,
    showDemoSeed,
  ]);

  // Live vs Demo Seed counts for Sources Radar Drawer
  const { liveVerifiedCount, demoSeedCount } = useMemo(() => {
    void signalsVersion;
    let live = 0;
    let seed = 0;
    for (const s of signalsRef.current) {
      if (s.isDemoSeed || s.sourceCategory === 'DEMO_SEED') seed++;
      else live++;
    }
    return { liveVerifiedCount: live, demoSeedCount: seed };
  }, [signalsVersion]);

  const activeFocusIdx = selectedNodeIdx >= 0 ? selectedNodeIdx : zoomHoverNodeIdx;
  const focusedSignal = activeFocusIdx >= 0 ? signalsRef.current[activeFocusIdx] || null : null;

  // Stage 6: Mark clicked orb as seen, play Cockpit Micro-Acoustics chime/pulse, and sync URL deep-link (?orb=<id>&lens=<1-5>)
  useEffect(() => {
    if (selectedNodeIdx < 0) {
      const srch = window.location.search;
      if (srch.includes('orb=') || srch.includes('signal=') || srch.includes('lens=')) {
        const u = new URL(window.location.href);
        u.searchParams.delete('orb');
        u.searchParams.delete('lens');
        u.searchParams.delete('signal');
        u.searchParams.delete('level');
        window.history.replaceState(null, '', u.pathname + u.search + u.hash);
      }
      return;
    }

    const sig = signalsRef.current[selectedNodeIdx];
    if (!sig) return;

    // Permanently dismiss Cold-Visit Coachmark on user interaction (not silent desktop initial auto-focus)
    if (shouldSyncUrlRef.current) {
      dismissCoachmarkPermanently();

      if (sig.isSupernova) {
        cockpitAudio.playSupernovaFocusPulse();
      } else {
        cockpitAudio.playOrbFocusHarmonicChime(SECTOR_BY_ID[sig.primarySector]?.index ?? 0);
      }

      setSeenNodeIds((prev) => {
        if (prev.has(sig.id)) return prev;
        const next = new Set(prev);
        next.add(sig.id);
        try {
          const trimmed = Array.from(next).slice(-600);
          localStorage.setItem('cortex_seen_node_ids', JSON.stringify(trimmed));
        } catch {
          // Ignore storage restrictions
        }
        return next;
      });

      const nextUrl = buildCortexDeepLinkUrl(
        sig.id,
        globalLiteracyLevelRef.current,
        window.location.href
      );
      window.history.replaceState(null, '', nextUrl);
    }
  }, [dismissCoachmarkPermanently, selectedNodeIdx]);

  // Compute 30/60/90-day Blast-Radius Consequence Horizons when Blast Wave is active
  const blastHorizons:
    | [BlastOrderConsequence, BlastOrderConsequence, BlastOrderConsequence]
    | null = useMemo(() => {
    if (blastWaveActiveForNodeIdx < 0 || blastWaveActiveForNodeIdx !== activeFocusIdx || !focusedSignal) {
      return null;
    }
    return computeDeterministicBlastRadius(focusedSignal, activeClient);
  }, [blastWaveActiveForNodeIdx, activeFocusIdx, focusedSignal, activeClient]);

  const blastHorizonsRef = useRef<
    [BlastOrderConsequence, BlastOrderConsequence, BlastOrderConsequence] | null
  >(null);
  blastHorizonsRef.current = blastHorizons;

  // Compute Blast-Radius Causal Satellites when a node is selected (and 30/60/90d wave is not overriding Slots 3-5)
  const blastSatellites: BlastSatellite[] = useMemo(() => {
    void signalsVersion;
    if (selectedNodeIdx < 0) return [];
    const all = signalsRef.current;
    const primary = all[selectedNodeIdx];
    if (!primary) return [];

    const matches: BlastSatellite[] = [];
    for (let i = 0; i < all.length && matches.length < 3; i++) {
      if (i === selectedNodeIdx) continue;
      const cand = all[i];
      const linked =
        primary.causalTargetIds?.includes(cand.id) ||
        cand.causalTargetIds?.includes(primary.id);
      if (linked) {
        matches.push({ nodeIndex: i, signal: cand });
      }
    }
    for (let i = 0; i < all.length && matches.length < 3; i++) {
      if (i === selectedNodeIdx || matches.some((m) => m.nodeIndex === i)) continue;
      const cand = all[i];
      if (primary.secondarySectors.includes(cand.primarySector)) {
        matches.push({ nodeIndex: i, signal: cand });
      }
    }
    return matches;
  }, [selectedNodeIdx, signalsVersion]);

  const blastSatellitesRef = useRef<BlastSatellite[]>([]);
  blastSatellitesRef.current = blastSatellites;

  // Position all 6 Pooled Diegetic Light-Table slots purely via GPU translate3d() inside RAF!
  const updateDiegeticPoolTransforms = useCallback(
    (packet: Float32Array, cssW: number, cssH: number) => {
      const cam = camRef.current;
      const toSx = (wx: number) => (wx - cam.x) * cam.zoom + cssW * 0.5;
      const toSy = (wy: number) => (wy - cam.y) * cam.zoom + cssH * 0.5;

      let slot0Rect: { x: number; y: number; w: number; h: number } | null = null;

      // Slot 0: Focused / Semantic-Zoomed Node Light-Table (Desktop Floating vs <768px Bottom Sheet)
      const isMobile = cssW < 768;
      const rightReserve = !isMobile && signalRailOpenRef.current ? 332 : 16;
      const focusIdx =
        selectedNodeIdxRef.current >= 0 ? selectedNodeIdxRef.current : zoomHoverNodeIdxRef.current;
      const slot0 = poolSlotRefs.current[0];
      if (slot0) {
        if (isMobile) {
          // On <768px mobile/tablet, DiegeticPool docks Slot 0 cleanly as a thumb-friendly bottom sheet (hidden in FEED mode)
          const showMobileSheet =
            mobileViewModeRef.current === 'MAP' &&
            focusIdx >= 0 &&
            focusIdx < (packet[0] | 0);
          slot0.style.transform = showMobileSheet
            ? 'translate3d(0px, 0px, 0)'
            : 'translate3d(0px, 108%, 0)';
        } else if (focusIdx >= 0 && focusIdx < (packet[0] | 0)) {
          const off = NODE_OFFSET + focusIdx * NODE_STRIDE;
          const nx = toSx(packet[off]);
          const ny = toSy(packet[off + 1]);
          const cardW = slot0.offsetWidth || 432;
          const cardH = slot0.offsetHeight || 410;
          const usableRightEdge = cssW - rightReserve;
          const placeLeft = nx > usableRightEdge * 0.54 || nx + cardW + 28 > usableRightEdge;
          const rawX = placeLeft ? nx - cardW - 22 : nx + 24;
          const rawY = ny - Math.min(150, cardH * 0.36);
          const { x: tx, y: ty } = clampDiegeticCardCoords(
            rawX,
            rawY,
            cardW,
            cardH,
            cssW,
            cssH,
            rightReserve
          );
          slot0.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
          slot0Rect = { x: tx, y: ty, w: cardW, h: cardH };
        } else {
          slot0.style.transform = 'translate3d(-9999px, -9999px, 0)';
        }
      }

      // Slot 1: Kinetic Collision Battlecard Reactor
      const slot1 = poolSlotRefs.current[1];
      const bc = battlecardPairRef.current;
      if (slot1) {
        if (bc && bc.nodeAIndex >= 0 && bc.nodeBIndex >= 0) {
          const offA = NODE_OFFSET + bc.nodeAIndex * NODE_STRIDE;
          const offB = NODE_OFFSET + bc.nodeBIndex * NODE_STRIDE;
          const mx = toSx((packet[offA] + packet[offB]) * 0.5);
          const my = toSy((packet[offA + 1] + packet[offB + 1]) * 0.5);
          const cardW = slot1.offsetWidth || 464;
          const cardH = slot1.offsetHeight || 420;
          const { x: tx, y: ty } = clampDiegeticCardCoords(
            mx - cardW * 0.5,
            my + 24,
            cardW,
            cardH,
            cssW,
            cssH,
            rightReserve
          );
          slot1.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
        } else {
          slot1.style.transform = 'translate3d(-9999px, -9999px, 0)';
        }
      }

      // Slot 2: 60-Second Standup Fusion Reactor (Anchored near Central Synthesis Core)
      const slot2 = poolSlotRefs.current[2];
      if (slot2) {
        if (standupFusionRef.current) {
          const cx = toSx(0);
          const cy = toSy(0);
          const cardW = slot2.offsetWidth || 460;
          const cardH = slot2.offsetHeight || 390;
          const { x: tx, y: ty } = clampDiegeticCardCoords(
            cx - cardW * 0.5,
            cy - cardH * 0.45,
            cardW,
            cardH,
            cssW,
            cssH,
            rightReserve
          );
          slot2.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
        } else {
          slot2.style.transform = 'translate3d(-9999px, -9999px, 0)';
        }
      }

      // Slots 3, 4, 5: 30/60/90-Day Blast-Radius Consequence Horizons OR Causal Satellites
      const horizons = blastHorizonsRef.current;
      if (horizons) {
        const placedRects: Array<{ x: number; y: number; w: number; h: number }> = [];
        if (slot0Rect) placedRects.push(slot0Rect);

        for (let s = 0; s < 3; s++) {
          const slotEl = poolSlotRefs.current[3 + s];
          if (!slotEl) continue;
          const hItem = horizons[s];
          const secIdx = SECTOR_BY_ID[hItem.targetSector].index;
          const attrOff = HEADER_FLOATS + secIdx * ATTRACTOR_STRIDE;
          const ax = toSx(packet[attrOff]);
          const ay = toSy(packet[attrOff + 1]);

          const cardW = slotEl.offsetWidth || 276;
          const cardH = slotEl.offsetHeight || 176;
          let { x: tx, y: ty } = clampDiegeticCardCoords(
            ax - cardW * 0.5,
            ay - cardH * 0.5,
            cardW,
            cardH,
            cssW,
            cssH,
            rightReserve
          );

          // De-overlap against Slot 0 and earlier horizon cards
          for (let pass = 0; pass < 3; pass++) {
            for (const r of placedRects) {
              const overlapX = tx < r.x + r.w + 10 && tx + cardW + 10 > r.x;
              const overlapY = ty < r.y + r.h + 10 && ty + cardH + 10 > r.y;
              if (overlapX && overlapY) {
                if (ty + cardH + 185 < cssH - 56) {
                  ty = r.y + r.h + 12;
                } else {
                  tx =
                    tx < (cssW - rightReserve) * 0.5
                      ? Math.min(cssW - cardW - rightReserve, r.x + r.w + 14)
                      : Math.max(16, r.x - cardW - 14);
                }
              }
            }
          }

          const clamped = clampDiegeticCardCoords(
            tx,
            ty,
            cardW,
            cardH,
            cssW,
            cssH,
            rightReserve
          );
          placedRects.push({ x: clamped.x, y: clamped.y, w: cardW, h: cardH });
          slotEl.style.transform = `translate3d(${clamped.x.toFixed(1)}px, ${clamped.y.toFixed(1)}px, 0)`;
        }
        return;
      }

      const sats = blastSatellitesRef.current;
      for (let s = 0; s < 3; s++) {
        const slotEl = poolSlotRefs.current[3 + s];
        if (!slotEl) continue;
        const sat = sats[s];
        if (!isMobile && sat && sat.nodeIndex >= 0 && sat.nodeIndex < (packet[0] | 0)) {
          const off = NODE_OFFSET + sat.nodeIndex * NODE_STRIDE;
          if (packet[off + 15] > 0.08) {
            const cardW = slotEl.offsetWidth || 208;
            const cardH = slotEl.offsetHeight || 62;
            const { x: sx, y: sy } = clampDiegeticCardCoords(
              toSx(packet[off]) + 16,
              toSy(packet[off + 1]) - 22,
              cardW,
              cardH,
              cssW,
              cssH,
              rightReserve
            );
            slotEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
            continue;
          }
        }
        slotEl.style.transform = 'translate3d(-9999px, -9999px, 0)';
      }
    },
    []
  );

  // Boot WebGL2 Engine, Dual Web Workers, CLS Observer & 60fps RAF Render Loop
  useEffect(() => {
    const glCanvas = webglCanvasRef.current;
    const tacCanvas = tacticalCanvasRef.current;
    if (!glCanvas || !tacCanvas) return;

    const engine = new SpatialWebGLEngine(glCanvas);
    webglEngineRef.current = engine;
    const tacCtx = tacCanvas.getContext('2d')!;

    let clsTotal = 0;
    let lcpMs = 0;
    let longTaskCount = 0;
    let maxLongTaskMs = 0;
    const observers: PerformanceObserver[] = [];

    if ('PerformanceObserver' in window) {
      try {
        const clsObs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<
            PerformanceEntry & { hadRecentInput?: boolean; value?: number }
          >) {
            if (!entry.hadRecentInput && typeof entry.value === 'number') {
              clsTotal += entry.value;
            }
          }
        });
        clsObs.observe({ type: 'layout-shift', buffered: true });
        observers.push(clsObs);
      } catch {
        // Ignore if unsupported
      }

      try {
        const lcpObs = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            lcpMs = entries[entries.length - 1].startTime;
          }
        });
        lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
        observers.push(lcpObs);
      } catch {
        // Ignore if unsupported
      }

      try {
        const ltObs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTaskCount++;
            if (entry.duration > maxLongTaskMs) {
              maxLongTaskMs = entry.duration;
            }
          }
        });
        ltObs.observe({ type: 'longtask', buffered: true });
        observers.push(ltObs);
      } catch {
        // Ignore if unsupported
      }
    }

    const physicsWorker = new Worker(new URL('./workers/physics.worker.ts', import.meta.url), {
      type: 'module',
    });
    const ingestWorker = new Worker(new URL('./workers/ingest.worker.ts', import.meta.url), {
      type: 'module',
    });
    physicsWorkerRef.current = physicsWorker;
    ingestWorkerRef.current = ingestWorker;

    // Sync legacy ambient synth with persisted cockpitAudio state on boot
    if (cockpitAudio.isEnabled() && !audioSynthRef.current.enabled) {
      audioSynthRef.current.toggle();
    }

    let autoFocusFallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const tryAutoFocusTopDesktopSignal = (allowSeedFallback = false) => {
      if (
        hasAutoSelectedInitialRef.current ||
        isMobileViewportRef.current ||
        initialDeepLinkRef.current.signalId ||
        pendingDeepLinkRef.current.signalId ||
        selectedNodeIdxRef.current >= 0
      ) {
        return;
      }
      const all = signalsRef.current;
      if (all.length === 0) return;

      const nowMs = Date.now();
      const hasLive = all.some((s) => !s.isDemoSeed && s.sourceCategory !== 'DEMO_SEED');
      if (!hasLive && !allowSeedFallback) return;

      let bestFresh48Idx = -1;
      let bestFresh48Score = -Infinity;
      let bestFallbackIdx = -1;
      let bestFallbackScore = -Infinity;
      for (let i = 0; i < all.length; i++) {
        const s = all[i];
        if (!s) continue;
        const isSeed = Boolean(s.isDemoSeed || s.sourceCategory === 'DEMO_SEED');
        if (hasLive && isSeed) continue;
        if (mutedSectorsRef.current.has(s.primarySector)) continue;
        const ageMs =
          typeof s.publishedAtMs === 'number' && Number.isFinite(s.publishedAtMs) && s.publishedAtMs > 0
            ? nowMs - s.publishedAtMs
            : Number.POSITIVE_INFINITY;
        const sc = computeSignalMomentumScore(s, nowMs);
        if (ageMs >= -600_000 && ageMs <= 48 * 3_600_000) {
          if (sc > bestFresh48Score) {
            bestFresh48Score = sc;
            bestFresh48Idx = i;
          }
        } else if (sc > bestFallbackScore) {
          bestFallbackScore = sc;
          bestFallbackIdx = i;
        }
      }

      const bestIdx = bestFresh48Idx >= 0 ? bestFresh48Idx : bestFallbackIdx;
      if (bestIdx < 0) return;
      hasAutoSelectedInitialRef.current = true;
      shouldSyncUrlRef.current = false;
      setSelectedNodeIdx(bestIdx);
      physicsWorker.postMessage({ type: 'SELECT_NODE', nodeIndex: bestIdx });
    };

    const tryResolvePendingDeepLink = () => {
      const targetId = pendingDeepLinkRef.current.signalId;
      if (!targetId) return;
      const idx = matchSignalByDeepLinkParam(signalsRef.current, targetId);
      if (idx < 0) return;

      const matched = signalsRef.current[idx];
      const requestedLvl = pendingDeepLinkRef.current.level;
      pendingDeepLinkRef.current.signalId = null;

      // Only keep Demo Seed visible if the deep-linked node itself is a 72h seed item;
      // otherwise leave Live Snapshot auto-switch untouched!
      if (matched.isDemoSeed || matched.sourceCategory === 'DEMO_SEED') {
        userManuallyToggledSeedRef.current = true;
        setShowDemoSeed(true);
        physicsWorker.postMessage({ type: 'SET_SHOW_DEMO_SEED', show: true });
      }

      if (requestedLvl) {
        setGlobalLiteracyLevel(requestedLvl);
        setDeepLinkLevelOverride({
          signalId: matched.id,
          level: requestedLvl,
          nonce: Date.now(),
        });
      }

      hasAutoSelectedInitialRef.current = true;
      shouldSyncUrlRef.current = true;
      if (isMobileViewportRef.current) {
        setMobileViewMode('MAP');
      }
      setShowWelcomeModal(false);
      setSelectedNodeIdx(idx);
      setBlastWaveActiveForNodeIdx(-1);
      pendingCameraFlyNodeIdxRef.current = idx;
      physicsWorker.postMessage({ type: 'SELECT_NODE', nodeIndex: idx });
    };

    ingestWorker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg) return;

      if (msg.type === 'SEED_HYDRATED') {
        const seedSignals = msg.signals as SpatialSignal[];
        signalsRef.current = seedSignals;
        baseNowMsRef.current = msg.hydratedAtMs;
        setSignalsVersion((v) => v + 1);
        physicsWorker.postMessage({
          type: 'HYDRATE_SEED',
          signals: seedSignals,
          baseNowMs: msg.hydratedAtMs,
        });
        tryResolvePendingDeepLink();
        if (autoFocusFallbackTimer) clearTimeout(autoFocusFallbackTimer);
        autoFocusFallbackTimer = setTimeout(() => {
          tryAutoFocusTopDesktopSignal(true);
        }, 1400);
      } else if (msg.type === 'LIVE_BATCH_HYDRATED') {
        if (autoFocusFallbackTimer) {
          clearTimeout(autoFocusFallbackTimer);
          autoFocusFallbackTimer = null;
        }
        const liveBatch = msg.signals as SpatialSignal[];
        signalsRef.current = [...signalsRef.current, ...liveBatch];
        setSignalsVersion((v) => v + 1);
        physicsWorker.postMessage({
          type: 'HYDRATE_LIVE_BATCH',
          signals: liveBatch,
        });

        // Automatically default 72h Demo Seed to OFF once >= 15 source-linked signals arrive!
        const liveCount = signalsRef.current.filter(
          (s) => !s.isDemoSeed && s.sourceCategory !== 'DEMO_SEED'
        ).length;
        if (
          liveCount >= 15 &&
          !userManuallyToggledSeedRef.current &&
          !hasAutoSwitchedToPureLiveRef.current
        ) {
          hasAutoSwitchedToPureLiveRef.current = true;
          setShowDemoSeed(false);
          physicsWorker.postMessage({ type: 'SET_SHOW_DEMO_SEED', show: false });
        }
        tryResolvePendingDeepLink();
        tryAutoFocusTopDesktopSignal(false);
      } else if (msg.type === 'LIVE_SIGNAL_INBOUND') {
        const sig = msg.signal as SpatialSignal;
        signalsRef.current = [...signalsRef.current, sig];
        setSignalsVersion((v) => v + 1);
        physicsWorker.postMessage({ type: 'ADD_LIVE_SIGNAL', signal: sig });

        const liveCount = signalsRef.current.filter(
          (s) => !s.isDemoSeed && s.sourceCategory !== 'DEMO_SEED'
        ).length;
        if (
          liveCount >= 15 &&
          !userManuallyToggledSeedRef.current &&
          !hasAutoSwitchedToPureLiveRef.current
        ) {
          hasAutoSwitchedToPureLiveRef.current = true;
          setShowDemoSeed(false);
          physicsWorker.postMessage({ type: 'SET_SHOW_DEMO_SEED', show: false });
        }
        tryResolvePendingDeepLink();

        const secIdx = SECTORS.findIndex((s) => s.id === sig.primarySector);
        audioSynthRef.current.playSectorPing(secIdx >= 0 ? secIdx : 0, Math.cos(secIdx));

        setLatestLiveToast({
          sector: sig.primarySector,
          title: sig.title,
          source: sig.originFeedName || sig.source,
        });
      } else if (msg.type === 'PROVENANCE_MERGE') {
        const { existingId, source } = msg as { existingId: string; source: string };
        const existing = signalsRef.current.find((s) => s.id === existingId);
        if (existing && !existing.sourceProvenance.includes(source)) {
          existing.sourceProvenance.push(source);
          physicsWorker.postMessage({ type: 'BOOST_MASS', id: existingId });
        }
      } else if (msg.type === 'SUPERNOVA_FUSED') {
        const updated = msg.signal as SpatialSignal;
        const idx = signalsRef.current.findIndex((s) => s.id === updated.id);
        if (idx >= 0) {
          const copy = [...signalsRef.current];
          copy[idx] = updated;
          signalsRef.current = copy;
          setSignalsVersion((v) => v + 1);
          audioSynthRef.current.playFusionReactorChord();
          physicsWorker.postMessage({
            type: 'UPGRADE_SUPERNOVA',
            id: updated.id,
            mass: updated.mass,
            supernovaLevel: updated.supernovaLevel || 1,
          });
        }
      } else if (msg.type === 'DEFCON_ANOMALY_DETECTED') {
        const anomaly = msg.anomaly as DefconAnomalyEvent;
        setDefconAnomaly(anomaly);
        audioSynthRef.current.playSeismicDefconSonar();
        physicsWorker.postMessage({
          type: 'TRIGGER_DEFCON_WAVE',
          signalId: anomaly.signalId,
        });
      }
    };

    physicsWorker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg) return;

      if (msg.type === 'FRAME' && msg.buffer instanceof ArrayBuffer) {
        if (latestPacketRef.current) {
          const oldBuf = latestPacketRef.current.buffer;
          physicsWorker.postMessage({ type: 'RETURN_BUFFER', buffer: oldBuf }, [oldBuf]);
        }
        const pkt = new Float32Array(msg.buffer);
        latestPacketRef.current = pkt;

        // Only allow Battlecard preview when an intentional drag (>14px & >140ms) is directly over a tight drop target
        if (!pointerRef.current.hasInitiatedNodeDrag) {
          setBattlecardPair((prev) => (prev && !prev.pinned ? null : prev));
        }

        // Smoothly fly camera to deep-linked orb once physics coordinates hydrate
        if (pendingCameraFlyNodeIdxRef.current >= 0) {
          const flyIdx = pendingCameraFlyNodeIdxRef.current;
          if (flyIdx < (pkt[0] | 0)) {
            const off = NODE_OFFSET + flyIdx * NODE_STRIDE;
            if (pkt[off + 15] > 0.1) {
              camRef.current.targetX = pkt[off];
              camRef.current.targetY = pkt[off + 1];
              camRef.current.targetZoom = 1.52;
              pendingCameraFlyNodeIdxRef.current = -1;
            }
          }
        }

        // Hover Stasis Audio Tick + >100ms Dwell Timer + Automatic Deep Semantic Zoom Bloom + Spotlight Hover
        const hov = pkt[5] | 0;
        if (hov !== pointerRef.current.lastHoveredIdx) {
          pointerRef.current.lastHoveredIdx = hov;
          pointerRef.current.hoverStartPerfMs = hov >= 0 ? performance.now() : 0;
          setCanvasHoveredNodeIdx(hov);
          if (hov >= 0) {
            const off = NODE_OFFSET + hov * NODE_STRIDE;
            const pan = Math.max(-0.9, Math.min(0.9, pkt[off] / 600));
            audioSynthRef.current.playHoverStasisTick(pan);
          }
        }
        if (camRef.current.zoom >= 1.05 && selectedNodeIdxRef.current < 0 && !tourRef.current.active) {
          setZoomHoverNodeIdx((prev) => (prev === hov ? prev : hov));
        } else if ((camRef.current.zoom < 1.05 || tourRef.current.active) && zoomHoverNodeIdxRef.current >= 0) {
          setZoomHoverNodeIdx(-1);
        }
      } else if (msg.type === 'CORE_DROP_FUSED') {
        const droppedIdx = msg.nodeIndex as number;
        const primary = signalsRef.current[droppedIdx];
        if (primary) {
          const cluster = [
            primary,
            ...signalsRef.current
              .filter(
                (s, idx) =>
                  idx !== droppedIdx &&
                  (s.primarySector === primary.primarySector ||
                    primary.secondarySectors.includes(s.primarySector))
              )
              .sort((a, b) => b.mass - a.mass)
              .slice(0, 4),
          ];
          audioSynthRef.current.playFusionReactorChord();
          setStandupFusion({
            signals: cluster,
            originLabel: `Core Drop: ${primary.shortLabel} Cluster`,
          });
        }
      } else if (msg.type === 'TIMEWARP_REACHED_LIVE') {
        setIsTimeWarpPlaying(false);
        setPlayheadOffsetMs(0);
      }
    };

    // Hydrate Frame 1 immediately + Dual-Mode Serverless Static Snapshot Probe (<150ms on public hosts)
    const isLocalHost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    ingestWorker.postMessage({ type: 'INIT', preferStaticOnly: !isLocalHost });

    const viteBaseUrl =
      (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || './';
    const snapshotRelativeUrl = `${viteBaseUrl.endsWith('/') ? viteBaseUrl : `${viteBaseUrl}/`}data/live-galaxy.json`;

    const loadStaticGalaxySnapshot = async (preFetched?: Promise<Response | null>) => {
      try {
        const snapRes = preFetched ? await preFetched : await fetch(snapshotRelativeUrl);
        if (!snapRes || !snapRes.ok) return;
        const ct = snapRes.headers.get('content-type') || '';
        if (!ct.includes('json') && !snapshotRelativeUrl.endsWith('.json')) return;
        const snap = (await snapRes.json()) as StaticGalaxySnapshot;
        if (!snap || !Array.isArray(snap.signals) || snap.signals.length === 0) return;

        hydrateStaticSnapshotLiteracyMap(snap.literacyBySignalId || {}, snap.signals);
        setIsStaticPublicMode(true);
        setSourcesDrawerOpen(false);
        setStaticBakedAtMs(snap.bakedAtMs || Date.now());
        ingestWorker.postMessage({
          type: 'HYDRATE_STATIC_SNAPSHOT',
          signals: snap.signals,
        });
      } catch {
        // Static snapshot optional if neither proxy nor baked JSON is present
      }
    };

    // On public static hosts, kick off ./data/live-galaxy.json fetch in parallel so hydration finishes in <150ms!
    const parallelPublicSnapshotFetch = !isLocalHost
      ? fetch(snapshotRelativeUrl).catch(() => null)
      : undefined;

    fetch('/api/health', { signal: AbortSignal.timeout(1200) })
      .then(async (r) => {
        const ct = r.headers.get('content-type') || '';
        if (!r.ok || !ct.includes('application/json')) {
          throw new Error('Static host detected');
        }
        const j = (await r.json()) as { ok?: boolean };
        if (!j?.ok) throw new Error('Invalid health payload');
      })
      .catch(() => {
        void loadStaticGalaxySnapshot(parallelPublicSnapshotFetch);
      });

    // Resize listener
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      setIsMobileViewport(w < 768);
      engine.resize(w, h);
      tacCanvas.width = Math.floor(w * dpr);
      tacCanvas.height = Math.floor(h * dpr);
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    // RAF Render & Telemetry Loop
    let rafId = 0;
    let lastRafMs = performance.now();
    let lastHudSyncMs = lastRafMs;
    const frameDeltaRing = new Float32Array(90).fill(16.6);
    let ringPtr = 0;

    const tick = (nowMs: number) => {
      rafId = requestAnimationFrame(tick);
      if (document.hidden) {
        lastRafMs = nowMs;
        return;
      }

      const dtMs = Math.min(64, Math.max(0.1, nowMs - lastRafMs));
      lastRafMs = nowMs;
      frameDeltaRing[ringPtr % frameDeltaRing.length] = dtMs;
      ringPtr++;

      const pkt = latestPacketRef.current;
      const cam = camRef.current;

      // Automated 15-Second Guided Flythrough Camera Director
      if (tourRef.current.active && pkt) {
        const elapsed = nowMs - tourRef.current.startMs;
        if (elapsed >= 15000) {
          tourRef.current.active = false;
          tourRef.current.lastTriggeredAct = -1;
          cam.targetX = DEFAULT_CAM_X;
          cam.targetY = DEFAULT_CAM_Y;
          cam.targetZoom = DEFAULT_CAM_ZOOM;
          setTourState(null);
        } else {
          const act = Math.min(3, Math.floor(elapsed / 3750));
          if (act !== tourRef.current.lastTriggeredAct) {
            tourRef.current.lastTriggeredAct = act;
            if (act === 0) {
              cam.targetX = DEFAULT_CAM_X;
              cam.targetY = DEFAULT_CAM_Y;
              cam.targetZoom = 0.76;
              physicsWorker.postMessage({ type: 'LASSO_FUSION_PULSE', cx: 0, cy: 0 });
            } else if (act === 1) {
              const off = HEADER_FLOATS + 0 * ATTRACTOR_STRIDE;
              cam.targetX = pkt[off];
              cam.targetY = pkt[off + 1];
              cam.targetZoom = 1.38;
              physicsWorker.postMessage({ type: 'FOCUS_SECTOR_PULSE', sectorIndex: 0 });
            } else if (act === 2) {
              const off = HEADER_FLOATS + 2 * ATTRACTOR_STRIDE;
              cam.targetX = pkt[off];
              cam.targetY = pkt[off + 1];
              cam.targetZoom = 2.08;
              ingestWorker.postMessage({ type: 'TRIGGER_ORBITAL_DROP' });
            } else if (act === 3) {
              cam.targetX = DEFAULT_CAM_X;
              cam.targetY = DEFAULT_CAM_Y;
              cam.targetZoom = DEFAULT_CAM_ZOOM;
            }
          } else if (act === 1 || act === 2) {
            // Smoothly track moving sector attractor during flythrough
            const trackedSec = act === 1 ? 0 : 2;
            const off = HEADER_FLOATS + trackedSec * ATTRACTOR_STRIDE;
            cam.targetX = pkt[off];
            cam.targetY = pkt[off + 1];
          }
        }
      }

      // Smooth exponential camera damping
      const lerp = 1 - Math.exp(-dtMs * 0.016);
      cam.x += (cam.targetX - cam.x) * lerp;
      cam.y += (cam.targetY - cam.y) * lerp;
      cam.zoom += (cam.targetZoom - cam.zoom) * lerp;

      const cssW = window.innerWidth;
      const cssH = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (pkt) {
        engine.renderFrame(
          pkt,
          cam.x,
          cam.y,
          cam.zoom,
          pointerRef.current.worldX,
          pointerRef.current.worldY,
          pointerRef.current.active
        );

        renderTacticalOverlay({
          ctx: tacCtx,
          cssW,
          cssH,
          dpr,
          packet: pkt,
          signals: signalsRef.current,
          camX: cam.x,
          camY: cam.y,
          zoom: cam.zoom,
          literacyLevel: globalLiteracyLevelRef.current,
          pureLiveMode: !showDemoSeedRef.current,
          hoverDwellMs:
            (pkt[5] | 0) >= 0 && pointerRef.current.hoverStartPerfMs > 0
              ? Math.max(0, nowMs - pointerRef.current.hoverStartPerfMs)
              : 0,
          seenNodeIds: seenNodeIdsRef.current,
          nowMs: Date.now(),
          rightReservedPx: cssW >= 768 && signalRailOpenRef.current ? 324 : 0,
          spotlightSourceIdx: spotlightSourceIdxRef.current,
          spotlightSectorIdx: spotlightSectorIdxRef.current,
          constellationLinks: constellationLinksRef.current,
          hasActiveFilter: hasActiveFilterRef.current,
          mutedSectorIndices: mutedSectorIndicesRef.current,
          selectedNodeIdx:
            selectedNodeIdxRef.current >= 0
              ? selectedNodeIdxRef.current
              : zoomHoverNodeIdxRef.current,
          draggedNodeIdx: pointerRef.current.draggedNodeIdx,
          lassoPoints: pointerRef.current.lassoPoints,
          lassoCapturedIndices: pointerRef.current.lassoCaptured,
        });

        updateDiegeticPoolTransforms(pkt, cssW, cssH);

        // Update HUD & Diagnostics every 240ms
        if (nowMs - lastHudSyncMs > 240) {
          lastHudSyncMs = nowMs;
          let sum = 0;
          const sorted = Array.from(frameDeltaRing).sort((a, b) => a - b);
          for (let k = 0; k < sorted.length; k++) sum += sorted[k];
          const avgMs = sum / sorted.length;
          const p95Ms = sorted[Math.floor(sorted.length * 0.95)];
          const fps = Math.min(120, Math.round(1000 / Math.max(1, avgMs)));
          const band = getZoomBand(cam.zoom);

          engine.checkGlErrors('frame');

          const perfMem = (
            performance as Performance & { memory?: { usedJSHeapSize: number } }
          ).memory;
          const jsHeapUsedMB = perfMem
            ? Number((perfMem.usedJSHeapSize / (1024 * 1024)).toFixed(2))
            : null;

          window.__CORTEX_DIAGNOSTICS__ = {
            fps,
            avgFrameMs: Number(avgMs.toFixed(2)),
            p95FrameMs: Number(p95Ms.toFixed(2)),
            workerMs: Number(pkt[9].toFixed(2)),
            clsScore: Number(clsTotal.toFixed(5)),
            lcpMs: Number(lcpMs.toFixed(1)),
            longTaskCount,
            maxLongTaskMs: Number(maxLongTaskMs.toFixed(1)),
            jsHeapUsedMB,
            nodeCount: pkt[0] | 0,
            visibleNodeCount: pkt[15] | 0,
            webgl: { ...engine.diagnostics },
          };

          if (tourRef.current.active) {
            const elapsed = Math.max(0, nowMs - tourRef.current.startMs);
            const stepIdx = Math.min(3, Math.floor(elapsed / 3750));
            setTourState({
              active: true,
              stepIndex: stepIdx,
              title: TOUR_STEPS[stepIdx].title,
              caption: TOUR_STEPS[stepIdx].caption,
              progressNorm: Math.min(1, elapsed / 15000),
            });
          }

          setPlayheadOffsetMs(pkt[4]);
          setHudStats({
            zoom: cam.zoom,
            zoomBand: band,
            fps,
            workerMs: pkt[9],
            visibleCount: pkt[15] | 0,
          });
        }
      }
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      if (autoFocusFallbackTimer) clearTimeout(autoFocusFallbackTimer);
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // Ignore speech cleanup errors
        }
      }
      window.removeEventListener('resize', handleResize);
      observers.forEach((o) => o.disconnect());
      physicsWorker.terminate();
      ingestWorker.terminate();
      engine.dispose();
    };
  }, [updateDiegeticPoolTransforms]);

  // Keyboard shortcuts (Ctrl+K or / Command Palette, ? Cosmos Decoder, 1-8 sectors, 0 overview, Space briefing pause, Esc dismiss)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }

      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setCommandPaletteOpen(true);
      } else if (e.code === 'Space' && briefingStateRef.current.active) {
        e.preventDefault();
        const cur = briefingStateRef.current;
        const willPause = !cur.paused;
        setBriefingState((prev) => ({ ...prev, paused: willPause }));
        if (willPause && speechSupported) {
          try {
            window.speechSynthesis.cancel();
          } catch {
            // Ignore speech cancel error
          }
        } else if (!willPause && cur.stopIndices.length > 0) {
          speakBriefingStop(cur.stopIndices[cur.currentStep]);
        }
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setDecoderOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
        dismissCoachmarkPermanently();
        stopPlanetariumBriefing();
        stop15sTour();
        setShowWelcomeModal(false);
        setSelectedNodeIdx(-1);
        setBlastWaveActiveForNodeIdx(-1);
        setBattlecardPair(null);
        setStandupFusion(null);
        setSourcesDrawerOpen(false);
        physicsWorkerRef.current?.postMessage({ type: 'SELECT_NODE', nodeIndex: -1 });
      } else if (e.key === 'ArrowRight' && briefingStateRef.current.active) {
        e.preventDefault();
        stepPlanetariumBriefing(1);
      } else if (e.key === 'ArrowLeft' && briefingStateRef.current.active) {
        e.preventDefault();
        stepPlanetariumBriefing(-1);
      } else if (e.key >= '1' && e.key <= '8') {
        const bubbleOpen =
          selectedNodeIdxRef.current >= 0 || zoomHoverNodeIdxRef.current >= 0;
        if (bubbleOpen && e.key >= '1' && e.key <= '5') {
          return; // Handled by DiegeticPool L1-L5 per-bubble scrubber
        }
        stop15sTour();
        const sIdx = Number(e.key) - 1;
        const pkt = latestPacketRef.current;
        if (pkt) {
          const off = HEADER_FLOATS + sIdx * ATTRACTOR_STRIDE;
          camRef.current.targetX = pkt[off];
          camRef.current.targetY = pkt[off + 1];
          camRef.current.targetZoom = 1.45;
          physicsWorkerRef.current?.postMessage({
            type: 'FOCUS_SECTOR_PULSE',
            sectorIndex: sIdx,
          });
        }
      } else if (e.key === '0' || e.key === 'Home') {
        stop15sTour();
        camRef.current.targetX = DEFAULT_CAM_X;
        camRef.current.targetY = DEFAULT_CAM_Y;
        camRef.current.targetZoom = DEFAULT_CAM_ZOOM;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    dismissCoachmarkPermanently,
    speakBriefingStop,
    speechSupported,
    stepPlanetariumBriefing,
    stop15sTour,
    stopPlanetariumBriefing,
  ]);

  // Expose helper actions for diagnostics & console testing
  useEffect(() => {
    window.__CORTEX_ACTIONS__ = {
      triggerLiveDrop: () => {
        ingestWorkerRef.current?.postMessage({ type: 'TRIGGER_ORBITAL_DROP' });
      },
      toggleTimeWarp60x: () => {
        setIsTimeWarpPlaying((prev) => {
          const next = !prev;
          physicsWorkerRef.current?.postMessage({
            type: 'TOGGLE_TIMEWARP_PLAY',
            playing: next,
            speedMultiplier: 60,
          });
          return next;
        });
      },
      setZoom: (z: number) => {
        camRef.current.targetZoom = Math.max(0.22, Math.min(5.2, z));
      },
      collideTopModels: () => {
        const sigs = signalsRef.current;
        const colliders: number[] = [];
        sigs.forEach((s, idx) => {
          if (s.modelSpecs) colliders.push(idx);
        });
        if (colliders.length >= 2) {
          setBattlecardPair({
            nodeAIndex: colliders[0],
            nodeBIndex: colliders[1],
            pinned: true,
          });
        }
      },
      clearOverlays: () => {
        setSelectedNodeIdx(-1);
        setBlastWaveActiveForNodeIdx(-1);
        setBattlecardPair(null);
        setStandupFusion(null);
      },
      start15sTour,
    };
  }, [start15sTour]);

  // =========================================================================
  // SPATIAL POINTER & WHEEL HANDLERS
  // =========================================================================
  const screenToWorld = (sx: number, sy: number) => {
    const cam = camRef.current;
    return {
      wx: (sx - window.innerWidth * 0.5) / cam.zoom + cam.x,
      wy: (sy - window.innerHeight * 0.5) / cam.zoom + cam.y,
    };
  };

  const findHitNodeAtScreen = (sx: number, sy: number): number => {
    const pkt = latestPacketRef.current;
    if (!pkt) return -1;
    const cam = camRef.current;
    const nCount = pkt[0] | 0;
    let bestIdx = -1;
    let bestDistPx = 26;

    for (let i = 0; i < nCount; i++) {
      const off = NODE_OFFSET + i * NODE_STRIDE;
      if (pkt[off + 15] < 0.08) continue;
      const nx = (pkt[off] - cam.x) * cam.zoom + window.innerWidth * 0.5;
      const ny = (pkt[off + 1] - cam.y) * cam.zoom + window.innerHeight * 0.5;
      const rPx = pkt[off + 4] * cam.zoom;
      const d = Math.hypot(sx - nx, sy - ny) - rPx;
      if (d < bestDistPx) {
        bestDistPx = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  // Tight drop-target hit test (requires dragging directly onto a peer orb within tight screen radius)
  const findDropTargetNodeAtScreen = (sx: number, sy: number, excludeIdx: number): number => {
    const pkt = latestPacketRef.current;
    if (!pkt) return -1;
    const cam = camRef.current;
    const nCount = pkt[0] | 0;
    let bestIdx = -1;
    let bestCenterDist = Infinity;

    for (let i = 0; i < nCount; i++) {
      if (i === excludeIdx) continue;
      const off = NODE_OFFSET + i * NODE_STRIDE;
      if (pkt[off + 15] < 0.08) continue;
      const nx = (pkt[off] - cam.x) * cam.zoom + window.innerWidth * 0.5;
      const ny = (pkt[off + 1] - cam.y) * cam.zoom + window.innerHeight * 0.5;
      const rPx = Math.max(10, pkt[off + 4] * cam.zoom);
      const centerDist = Math.hypot(sx - nx, sy - ny);
      const tightSnapLimit = Math.max(22, rPx + 10);
      if (centerDist <= tightSnapLimit && centerDist < bestCenterDist) {
        bestCenterDist = centerDist;
        bestIdx = i;
      }
    }
    return bestIdx;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    stop15sTour();
    const cam = camRef.current;
    const { wx, wy } = screenToWorld(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0014);
    const newZoom = Math.max(0.24, Math.min(5.0, cam.targetZoom * factor));

    cam.targetX = wx - (e.clientX - window.innerWidth * 0.5) / newZoom;
    cam.targetY = wy - (e.clientY - window.innerHeight * 0.5) / newZoom;
    cam.targetZoom = newZoom;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    stop15sTour();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer capture edge cases
    }

    const p = pointerRef.current;
    activeTouchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Multi-touch Gesture: Two-finger Pinch-Zoom & Midpoint Pan!
    if (activeTouchPointsRef.current.size === 2) {
      const pts = Array.from(activeTouchPointsRef.current.values());
      const midX = (pts[0].x + pts[1].x) * 0.5;
      const midY = (pts[0].y + pts[1].y) * 0.5;
      const spanPx = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const { wx, wy } = screenToWorld(midX, midY);
      pinchBaselineRef.current = {
        spanPx,
        startZoom: camRef.current.targetZoom,
        midWorldX: wx,
        midWorldY: wy,
      };
      p.pendingNodeIdx = -1;
      p.hasInitiatedNodeDrag = false;
      p.draggedNodeIdx = -1;
      p.isPanning = false;
      p.isLassoing = false;
      return;
    }

    p.pointerDownScreenX = e.clientX;
    p.pointerDownScreenY = e.clientY;
    p.pointerDownPerfMs = performance.now();
    p.pendingNodeIdx = -1;
    p.hasInitiatedNodeDrag = false;
    p.dropTargetNodeIdx = -1;
    p.draggedNodeIdx = -1;

    // Gesture 1: Shift + Drag Spatial Lasso!
    if (e.shiftKey) {
      p.isLassoing = true;
      p.lassoPoints = [{ x: e.clientX, y: e.clientY }];
      p.lassoCaptured = new Set();
      return;
    }

    // Gesture 2: Arm candidate node ONLY — wait for >14px movement AND >140ms hold before starting drag!
    const hitNode = findHitNodeAtScreen(e.clientX, e.clientY);
    if (hitNode >= 0) {
      p.pendingNodeIdx = hitNode;
      return;
    }

    // Gesture 3: Smooth Cosmos Camera Pan
    p.isPanning = true;
    p.panStartScreenX = e.clientX;
    p.panStartScreenY = e.clientY;
    p.panStartCamX = camRef.current.targetX;
    p.panStartCamY = camRef.current.targetY;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activeTouchPointsRef.current.has(e.pointerId)) {
      activeTouchPointsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Active Two-Finger Pinch-Zoom & Midpoint Pan
    if (activeTouchPointsRef.current.size >= 2 && pinchBaselineRef.current) {
      const pts = Array.from(activeTouchPointsRef.current.values());
      const midX = (pts[0].x + pts[1].x) * 0.5;
      const midY = (pts[0].y + pts[1].y) * 0.5;
      const spanPx = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const base = pinchBaselineRef.current;
      const newZoom = Math.max(0.24, Math.min(5.0, base.startZoom * (spanPx / base.spanPx)));
      camRef.current.targetZoom = newZoom;
      camRef.current.targetX = base.midWorldX - (midX - window.innerWidth * 0.5) / newZoom;
      camRef.current.targetY = base.midWorldY - (midY - window.innerHeight * 0.5) / newZoom;
      return;
    }

    const now = performance.now();
    const p = pointerRef.current;
    const dtSec = Math.max(0.004, (now - p.lastMoveMs) * 0.001);
    const { wx, wy } = screenToWorld(e.clientX, e.clientY);
    const speedWorld = Math.hypot(wx - p.worldX, wy - p.worldY) / dtSec;

    p.screenX = e.clientX;
    p.screenY = e.clientY;
    p.worldX = wx;
    p.worldY = wy;
    p.lastMoveMs = now;
    p.active = true;

    // Strict 14px movement deadzone + >140ms hold gate before initiating node drag-to-collide!
    if (p.pendingNodeIdx >= 0 && !p.hasInitiatedNodeDrag) {
      const moveFromDownPx = Math.hypot(
        e.clientX - p.pointerDownScreenX,
        e.clientY - p.pointerDownScreenY
      );
      const holdMs = now - p.pointerDownPerfMs;
      if (moveFromDownPx >= 14 && holdMs > 140) {
        p.hasInitiatedNodeDrag = true;
        p.draggedNodeIdx = p.pendingNodeIdx;
        physicsWorkerRef.current?.postMessage({
          type: 'DRAG_START',
          nodeIndex: p.draggedNodeIdx,
          worldX: wx,
          worldY: wy,
        });
      }
    }

    physicsWorkerRef.current?.postMessage({
      type: 'POINTER_MOVE',
      worldX: wx,
      worldY: wy,
      speedWorld: Math.min(3000, speedWorld),
      active: true,
    });

    if (p.hasInitiatedNodeDrag && p.draggedNodeIdx >= 0) {
      const targetIdx = findDropTargetNodeAtScreen(e.clientX, e.clientY, p.draggedNodeIdx);
      p.dropTargetNodeIdx = targetIdx;
      if (targetIdx >= 0) {
        const dragIdx = p.draggedNodeIdx;
        setBattlecardPair((prev) => {
          if (prev && prev.nodeAIndex === dragIdx && prev.nodeBIndex === targetIdx) return prev;
          audioSynthRef.current.playHoverStasisTick(0);
          return { nodeAIndex: dragIdx, nodeBIndex: targetIdx, pinned: false };
        });
      } else {
        setBattlecardPair((prev) => (prev && !prev.pinned ? null : prev));
      }
      return;
    }

    if (p.isLassoing) {
      const lastPt = p.lassoPoints[p.lassoPoints.length - 1];
      if (!lastPt || Math.hypot(e.clientX - lastPt.x, e.clientY - lastPt.y) > 6) {
        p.lassoPoints.push({ x: e.clientX, y: e.clientY });
      }
      const pkt = latestPacketRef.current;
      if (pkt && p.lassoPoints.length >= 3) {
        const captured = new Set<number>();
        const cam = camRef.current;
        const nCount = pkt[0] | 0;
        for (let i = 0; i < nCount; i++) {
          const off = NODE_OFFSET + i * NODE_STRIDE;
          if (pkt[off + 15] < 0.08) continue;
          const sx = (pkt[off] - cam.x) * cam.zoom + window.innerWidth * 0.5;
          const sy = (pkt[off + 1] - cam.y) * cam.zoom + window.innerHeight * 0.5;
          if (pointInPolygon(sx, sy, p.lassoPoints)) {
            captured.add(i);
          }
        }
        p.lassoCaptured = captured;
      }
      return;
    }

    if (p.isPanning) {
      const dxPx = e.clientX - p.panStartScreenX;
      const dyPx = e.clientY - p.panStartScreenY;
      camRef.current.targetX = p.panStartCamX - dxPx / camRef.current.zoom;
      camRef.current.targetY = p.panStartCamY - dyPx / camRef.current.zoom;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    activeTouchPointsRef.current.delete(e.pointerId);
    if (pinchBaselineRef.current) {
      if (activeTouchPointsRef.current.size < 2) {
        pinchBaselineRef.current = null;
        // Re-baseline remaining single finger so lifting 1 finger doesn't jump camera
        const remaining = Array.from(activeTouchPointsRef.current.values())[0];
        if (remaining) {
          pointerRef.current.isPanning = true;
          pointerRef.current.panStartScreenX = remaining.x;
          pointerRef.current.panStartScreenY = remaining.y;
          pointerRef.current.panStartCamX = camRef.current.targetX;
          pointerRef.current.panStartCamY = camRef.current.targetY;
        }
      }
      return;
    }

    const p = pointerRef.current;
    const moveDistPx = Math.hypot(
      e.clientX - p.pointerDownScreenX,
      e.clientY - p.pointerDownScreenY
    );

    if (p.isLassoing) {
      p.isLassoing = false;
      const capturedIndices = Array.from(p.lassoCaptured);
      p.lassoPoints = [];
      p.lassoCaptured = new Set();

      if (capturedIndices.length > 0) {
        const capturedSignals = capturedIndices
          .map((idx) => signalsRef.current[idx])
          .filter(Boolean)
          .sort((a, b) => b.mass - a.mass);
        audioSynthRef.current.playFusionReactorChord();
        physicsWorkerRef.current?.postMessage({ type: 'LASSO_FUSION_PULSE', cx: 0, cy: 0 });
        setStandupFusion({
          signals: capturedSignals,
          originLabel: `Spatial Lasso (${capturedSignals.length} Nodes)`,
        });
      }
      return;
    }

    if (p.pendingNodeIdx >= 0) {
      const candidateIdx = p.pendingNodeIdx;
      const wasIntentionalDrag = p.hasInitiatedNodeDrag;
      const dropTargetIdx = p.dropTargetNodeIdx;

      p.pendingNodeIdx = -1;
      p.draggedNodeIdx = -1;
      p.hasInitiatedNodeDrag = false;
      p.dropTargetNodeIdx = -1;

      if (!wasIntentionalDrag) {
        // Normal click (<14px movement or <140ms tap) -> ALWAYS reliably open Hologram Reader (L1->L5)!
        shouldSyncUrlRef.current = true;
        setSelectedNodeIdx((prev) => {
          const next = prev === candidateIdx ? -1 : candidateIdx;
          if (next < 0) setBlastWaveActiveForNodeIdx(-1);
          physicsWorkerRef.current?.postMessage({ type: 'SELECT_NODE', nodeIndex: next });
          return next;
        });
        return;
      }

      if (dropTargetIdx >= 0 && dropTargetIdx !== candidateIdx) {
        audioSynthRef.current.playFusionReactorChord();
        setBattlecardPair({
          nodeAIndex: candidateIdx,
          nodeBIndex: dropTargetIdx,
          pinned: true,
        });
      } else {
        setBattlecardPair((prev) => (prev && !prev.pinned ? null : prev));
      }

      physicsWorkerRef.current?.postMessage({ type: 'DRAG_END' });
      return;
    }

    p.isPanning = false;

    if (moveDistPx < 6) {
      const { wx, wy } = screenToWorld(e.clientX, e.clientY);
      if (Math.hypot(wx, wy) < 92) {
        triggerTopClientStandup();
      } else if (selectedNodeIdxRef.current >= 0) {
        setSelectedNodeIdx(-1);
        setBlastWaveActiveForNodeIdx(-1);
        physicsWorkerRef.current?.postMessage({ type: 'SELECT_NODE', nodeIndex: -1 });
      }
    }
  };

  const triggerTopClientStandup = () => {
    const visibleSignals = signalsRef.current.filter(
      (s) => (showDemoSeed || !s.isDemoSeed) &&
        (!s.sourceCategory || s.sourceCategory === 'DEMO_SEED' || enabledCategories[s.sourceCategory])
    );
    const pool = visibleSignals.length > 0 ? visibleSignals : signalsRef.current;
    const sorted = [...pool].sort((a, b) => b.mass - a.mass).slice(0, 5);
    audioSynthRef.current.playFusionReactorChord();
    physicsWorkerRef.current?.postMessage({ type: 'LASSO_FUSION_PULSE', cx: 0, cy: 0 });
    setStandupFusion({
      signals: sorted,
      originLabel: 'Synthesis Core Global Pulse',
    });
  };

  const handleFocusAndPulseSector = useCallback(
    (sIdx: number) => {
      stop15sTour();
      const pkt = latestPacketRef.current;
      if (pkt) {
        const off = HEADER_FLOATS + sIdx * ATTRACTOR_STRIDE;
        camRef.current.targetX = pkt[off];
        camRef.current.targetY = pkt[off + 1];
        camRef.current.targetZoom = 1.42;
      }
      physicsWorkerRef.current?.postMessage({
        type: 'FOCUS_SECTOR_PULSE',
        sectorIndex: sIdx,
      });
    },
    [stop15sTour]
  );

  const handleToggleDemoSeed = useCallback((show: boolean) => {
    userManuallyToggledSeedRef.current = true;
    setShowDemoSeed(show);
    physicsWorkerRef.current?.postMessage({
      type: 'SET_SHOW_DEMO_SEED',
      show,
    });
  }, []);

  const handleTriggerBlastWave = useCallback(() => {
    if (activeFocusIdx < 0 || !focusedSignal) return;
    setSelectedNodeIdx(activeFocusIdx);
    setBlastWaveActiveForNodeIdx(activeFocusIdx);

    const computed = computeDeterministicBlastRadius(focusedSignal, activeClient);
    const targetSectors = computed.map((h) => SECTOR_BY_ID[h.targetSector].index);

    // Pull camera smoothly to macro/meso view if deeply zoomed so all 3 affected sectors & waves are visible!
    if (camRef.current.targetZoom > 0.92) {
      camRef.current.targetX = DEFAULT_CAM_X;
      camRef.current.targetY = DEFAULT_CAM_Y;
      camRef.current.targetZoom = 0.76;
    }

    audioSynthRef.current.playFusionReactorChord();
    physicsWorkerRef.current?.postMessage({
      type: 'TRIGGER_BLAST_WAVE',
      nodeIndex: activeFocusIdx,
      targetSectors,
    });
  }, [activeFocusIdx, focusedSignal, activeClient]);

  const handleFocusDefconSignal = useCallback(
    (signalId: string) => {
      stop15sTour();
      const idx = signalsRef.current.findIndex((s) => s.id === signalId);
      if (idx < 0) return;
      shouldSyncUrlRef.current = true;
      setSelectedNodeIdx(idx);
      setBlastWaveActiveForNodeIdx(-1);
      if (isMobileViewportRef.current) setMobileViewMode('MAP');
      const pkt = latestPacketRef.current;
      if (pkt && idx < (pkt[0] | 0)) {
        const off = NODE_OFFSET + idx * NODE_STRIDE;
        camRef.current.targetX = pkt[off];
        camRef.current.targetY = pkt[off + 1];
        camRef.current.targetZoom = 1.52;
      }
      physicsWorkerRef.current?.postMessage({ type: 'SELECT_NODE', nodeIndex: idx });
      physicsWorkerRef.current?.postMessage({ type: 'TRIGGER_DEFCON_WAVE', signalId });
    },
    [stop15sTour]
  );

  const handleSelectSignalFromUI = useCallback(
    (idx: number) => {
      stop15sTour();
      if (idx < 0 || !signalsRef.current[idx]) return;
      const sig = signalsRef.current[idx];
      if (mutedSectorsRef.current.has(sig.primarySector)) {
        setMutedSectors((prev) => {
          const next = new Set(prev);
          next.delete(sig.primarySector);
          try {
            localStorage.setItem('cortex_my_radar_muted_v1', JSON.stringify(Array.from(next)));
          } catch {
            // Ignore storage errors
          }
          return next;
        });
      }
      hasAutoSelectedInitialRef.current = true;
      shouldSyncUrlRef.current = true;
      if (isMobileViewportRef.current) {
        setMobileViewMode('MAP');
      }
      setSelectedNodeIdx(idx);
      setBlastWaveActiveForNodeIdx(-1);
      flyCameraToNodeIndex(idx);
      physicsWorkerRef.current?.postMessage({ type: 'SELECT_NODE', nodeIndex: idx });
    },
    [flyCameraToNodeIndex, stop15sTour]
  );

  return (
    <div className="relative w-screen min-h-[100dvh] h-[100dvh] overflow-hidden bg-[#030711]">
      {/* Slim Top 5-Segment Briefing Progress Bar */}
      {briefingState.active && (
        <div
          aria-label="Briefing Progress"
          className="fixed top-0 inset-x-0 z-50 h-1.5 px-2 pt-0.5 pointer-events-none grid gap-1"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, briefingState.stopIndices.length)}, minmax(0, 1fr))`,
          }}
        >
          {briefingState.stopIndices.map((stopNodeIdx, i) => {
            const pct =
              i < briefingState.currentStep
                ? 100
                : i > briefingState.currentStep
                ? 0
                : Math.min(100, (briefingState.elapsedStepMs / 18000) * 100);
            return (
              <div
                key={`${stopNodeIdx}-${i}`}
                className="h-full rounded-full bg-white/12 overflow-hidden"
              >
                <div
                  style={{ width: `${pct.toFixed(1)}%` }}
                  className="h-full bg-teal-400 transition-[width] duration-150 ease-linear"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Z-0: Full-Viewport Multi-Pass WebGL2 Gravitational & Relativistic Cosmos */}
      <canvas
        ref={webglCanvasRef}
        id="webgl-cosmos"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={(e) => {
          activeTouchPointsRef.current.delete(e.pointerId);
          if (activeTouchPointsRef.current.size < 2) pinchBaselineRef.current = null;
        }}
        onPointerLeave={(e) => {
          activeTouchPointsRef.current.delete(e.pointerId);
          if (activeTouchPointsRef.current.size < 2) pinchBaselineRef.current = null;
          pointerRef.current.active = false;
          setCanvasHoveredNodeIdx(-1);
          physicsWorkerRef.current?.postMessage({
            type: 'POINTER_MOVE',
            worldX: 99999,
            worldY: 99999,
            speedWorld: 0,
            active: false,
          });
        }}
        className="fixed inset-0 w-full h-full z-0 cursor-crosshair touch-none"
      />

      {/* Z-10: Synchronized DPR Tactical Vector Reticles, Comet Trails & Lasso Field */}
      <canvas
        ref={tacticalCanvasRef}
        id="tactical-overlay"
        className="fixed inset-0 w-full h-full z-10 pointer-events-none"
      />

      {/* Z-20: Pooled GPU-Composited Diegetic Light-Table Projections (MAX=6, 0.000 CLS) */}
      <DiegeticPool
        slotRefs={poolSlotRefs}
        focusedSignal={focusedSignal}
        zoomBand={hudStats.zoomBand}
        globalLiteracyLevel={globalLiteracyLevel}
        activeClient={activeClient}
        battlecardPair={battlecardPair}
        signals={signalsRef.current}
        standupFusion={standupFusion}
        blastSatellites={blastSatellites}
        blastHorizons={blastHorizons}
        geminiApiKey={geminiApiKey}
        activeSynthesisEngine={activeSynthesisEngine}
        userLockedRules={userLockedRules}
        ollamaOnline={Boolean(synthesisStatus?.ollama.online)}
        ollamaModel={synthesisStatus?.ollama.selectedModel || ''}
        isMobileViewport={isMobileViewport}
        isStaticPublicMode={isStaticPublicMode}
        briefingBar={
          briefingState.active
            ? ({
                step: briefingState.currentStep,
                total: briefingState.stopIndices.length,
                paused: briefingState.paused,
                remainingSec: briefingState.remainingSec,
                listenEnabled: briefingListenEnabled,
                speechSupported,
                onPrev: () => stepPlanetariumBriefing(-1),
                onTogglePause: () => {
                  const willPause = !briefingStateRef.current.paused;
                  setBriefingState((prev) => ({
                    ...prev,
                    paused: willPause,
                  }));
                  if (willPause && speechSupported) {
                    try {
                      window.speechSynthesis.cancel();
                    } catch {
                      // Ignore speech cancellation error
                    }
                  } else if (!willPause && briefingStateRef.current.stopIndices.length > 0) {
                    speakBriefingStop(
                      briefingStateRef.current.stopIndices[briefingStateRef.current.currentStep]
                    );
                  }
                },
                onNext: () => stepPlanetariumBriefing(1),
                onToggleListen: () => {
                  const next = !briefingListenEnabledRef.current;
                  briefingListenEnabledRef.current = next;
                  setBriefingListenEnabled(next);
                  if (!next && speechSupported) {
                    try {
                      window.speechSynthesis.cancel();
                    } catch {
                      // Ignore speech cancellation error
                    }
                  } else if (next && briefingStateRef.current.active && !briefingStateRef.current.paused) {
                    const idx =
                      briefingStateRef.current.stopIndices[briefingStateRef.current.currentStep];
                    if (idx !== undefined) speakBriefingStop(idx);
                  }
                },
                onExit: () => {
                  stopPlanetariumBriefing();
                  setSelectedNodeIdx(-1);
                  physicsWorkerRef.current?.postMessage({ type: 'SELECT_NODE', nodeIndex: -1 });
                },
              } satisfies PlanetariumBriefingBarProps)
            : null
        }
        onSynthesisTelemetry={(stats) => {
          setSynthesisStatus((prev) => {
            if (!prev) return prev;
            if (stats.engineUsed === 'OLLAMA') {
              return {
                ...prev,
                ollama: {
                  ...prev.ollama,
                  lastTokensPerSec: stats.tokensPerSec,
                  lastLatencyMs: stats.latencyMs,
                  selectedModel: stats.modelUsed || prev.ollama.selectedModel,
                },
              };
            }
            if (stats.engineUsed === 'GEMINI') {
              return {
                ...prev,
                gemini: {
                  ...prev.gemini,
                  lastTokensPerSec: stats.tokensPerSec,
                  lastLatencyMs: stats.latencyMs,
                },
              };
            }
            return {
              ...prev,
              deterministic: {
                ...prev.deterministic,
                lastLatencyMs: stats.latencyMs,
              },
            };
          });
        }}
        onCloseFocused={() => {
          stopPlanetariumBriefing();
          setSelectedNodeIdx(-1);
          setZoomHoverNodeIdx(-1);
          setBlastWaveActiveForNodeIdx(-1);
          physicsWorkerRef.current?.postMessage({ type: 'SELECT_NODE', nodeIndex: -1 });
        }}
        onTriggerBlastRadiusWave={handleTriggerBlastWave}
        onClearBlastRadiusWave={() => setBlastWaveActiveForNodeIdx(-1)}
        onReleaseBattlecard={() => setBattlecardPair(null)}
        onCloseStandup={() => setStandupFusion(null)}
        onSelectSatellite={(idx) => {
          shouldSyncUrlRef.current = true;
          setSelectedNodeIdx(idx);
          setBlastWaveActiveForNodeIdx(-1);
          physicsWorkerRef.current?.postMessage({ type: 'SELECT_NODE', nodeIndex: idx });
        }}
        deepLinkLevelOverride={deepLinkLevelOverride}
        onActiveLevelChange={(sigId, lvl) => {
          shouldSyncUrlRef.current = true;
          const nextUrl = buildCortexDeepLinkUrl(sigId, lvl, window.location.href);
          window.history.replaceState(null, '', nextUrl);
        }}
        onSelectGlobalLiteracyLevel={handleSelectLiteracyLevel}
      />

      {/* Z-24: Collapsible Desktop Right-Hand "Top 10 Signals Today" Rail */}
      <SignalRail
        isOpen={signalRailOpen}
        onToggleOpen={() => setSignalRailOpen((v) => !v)}
        topSignals={top10Signals}
        selectedNodeIdx={activeFocusIdx}
        hoveredNodeIdx={canvasHoveredNodeIdx >= 0 ? canvasHoveredNodeIdx : railHoveredNodeIdx}
        activeLiteracyLevel={globalLiteracyLevel}
        onHoverSignal={setRailHoveredNodeIdx}
        onSelectSignal={handleSelectSignalFromUI}
      />

      {/* Z-22: Mobile-First <768px Swipeable Signal Deck over softly blurred galaxy */}
      {isMobileViewport && mobileViewMode === 'FEED' && (
        <MobileSignalDeck
          signals={mobileDeckSignals}
          activeLiteracyLevel={globalLiteracyLevel}
          onSelectLiteracyLevel={handleSelectLiteracyLevel}
          onInspectOnMap={handleSelectSignalFromUI}
          onlyNewFilterActive={onlyNewFilterActive}
          newSignalsCount={newSignalsCount}
          onToggleOnlyNewFilter={() => {
            setOnlyNewFilterActive((prev) => !prev);
            cockpitAudio.playScrubberDetentTick(3);
          }}
          mutedSectors={mutedSectors}
          onToggleMuteSector={toggleMuteSector}
        />
      )}

      {/* Z-28: Zero-Friction Cold-Visit Smoked-Obsidian Coachmark */}
      {showCoachmark &&
        !focusedSignal &&
        !battlecardPair &&
        !standupFusion &&
        !(isMobileViewport && mobileViewMode === 'FEED') && (
        <div
          role="region"
          aria-label="Onboarding Coachmark"
          className="fixed inset-x-3 bottom-[112px] md:bottom-[92px] z-30 pointer-events-none flex justify-center"
        >
          <div className="pointer-events-auto cockpit-obsidian max-w-[680px] w-fit px-3.5 py-2 rounded-xl border border-teal-400/35 shadow-2xl flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 text-[11.5px] text-zinc-200">
            <div className="flex items-center gap-2 min-w-0 leading-snug">
              <span className="h-2 w-2 rounded-full bg-teal-400 animate-pulse shrink-0" />
              <span>
                Click any glowing orb · Press <span className="font-mono text-teal-300">1–5</span> to
                shift lenses or <span className="font-mono text-teal-300">Ctrl+K</span> to search — or start{' '}
                <button
                  type="button"
                  onClick={startPlanetariumBriefing}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-500/18 hover:bg-teal-500/28 border border-teal-400/45 font-mono text-[10.5px] font-semibold text-teal-200 cursor-pointer align-baseline"
                >
                  <Play className="w-2.5 h-2.5 fill-current" />
                  <span>90s Briefing</span>
                </button>
              </span>
            </div>
            <button
              type="button"
              onClick={dismissCoachmarkPermanently}
              title="Dismiss Coachmark (Esc)"
              className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Z-30: Diegetic Peripheral Telemetry Beacons & 72h Kinetic Time-Warp Scrubber */}
      <SpatialHorizonHUD
        zoom={hudStats.zoom}
        zoomBand={hudStats.zoomBand}
        fps={hudStats.fps}
        workerMs={hudStats.workerMs}
        visibleCount={hudStats.visibleCount}
        activeClient={activeClient}
        globalLiteracyLevel={globalLiteracyLevel}
        audioEnabled={audioEnabled}
        isTimeWarpPlaying={isTimeWarpPlaying}
        playheadOffsetMs={playheadOffsetMs}
        signals={signalsRef.current}
        latestLiveToast={latestLiveToast}
        geminiApiKey={geminiApiKey}
        activeSynthesisEngine={activeSynthesisEngine}
        synthesisStatus={synthesisStatus}
        defconAnomaly={defconAnomaly}
        showCalibrationHint={showCalibrationHint && !showWelcomeModal && !showCoachmark}
        showDemoSeed={showDemoSeed}
        sourcesDrawerOpen={sourcesDrawerOpen}
        tourActive={Boolean(tourState?.active)}
        newSignalsCount={newSignalsCount}
        isReturnVisit={isReturnVisitRef.current}
        onlyNewFilterActive={onlyNewFilterActive}
        onToggleOnlyNewFilter={() => {
          setOnlyNewFilterActive((prev) => !prev);
          cockpitAudio.playScrubberDetentTick(3);
        }}
        briefingActive={briefingState.active}
        briefingStepIndex={briefingState.currentStep}
        briefingTotalSteps={Math.max(1, briefingState.stopIndices.length || 5)}
        onToggleBriefing={() => {
          if (briefingState.active) {
            stopPlanetariumBriefing();
            setSelectedNodeIdx(-1);
            physicsWorkerRef.current?.postMessage({ type: 'SELECT_NODE', nodeIndex: -1 });
          } else {
            startPlanetariumBriefing();
          }
        }}
        signalRailOpen={signalRailOpen}
        onToggleSignalRail={() => setSignalRailOpen((v) => !v)}
        onOpenCommandPalette={() => setCommandPaletteOpen(true)}
        mutedSectors={mutedSectors}
        onToggleMuteSector={toggleMuteSector}
        onResetMutedSectors={resetMutedSectors}
        onHoverSectorIndex={setHoveredSectorIdx}
        mobileViewMode={mobileViewMode}
        mobileSheetOpen={isMobileViewport && Boolean(focusedSignal) && mobileViewMode === 'MAP'}
        isStaticPublicMode={isStaticPublicMode}
        staticBakedAtMs={staticBakedAtMs}
        onDismissHint={() => setShowCalibrationHint(false)}
        onSelectClient={(ind) => {
          setActiveClient(ind);
          audioSynthRef.current.playHoverStasisTick(0);
          physicsWorkerRef.current?.postMessage({
            type: 'SET_CLIENT_INDUSTRY',
            industry: ind,
          });
        }}
        onSelectLiteracyLevel={handleSelectLiteracyLevel}
        onSelectSynthesisEngine={handleSelectSynthesisEngine}
        onFocusDefconSignal={handleFocusDefconSignal}
        onDismissDefcon={() => setDefconAnomaly(null)}
        onToggleAudio={() => {
          const next = cockpitAudio.toggle();
          if (audioSynthRef.current.enabled !== next) {
            audioSynthRef.current.toggle();
          }
          setAudioEnabled(next);
          if (next) {
            cockpitAudio.playScrubberDetentTick(globalLiteracyLevelRef.current);
          }
        }}
        onTriggerLiveDrop={() => {
          ingestWorkerRef.current?.postMessage({ type: 'TRIGGER_ORBITAL_DROP' });
        }}
        onScrubOffsetMs={(offsetMs) => {
          stop15sTour();
          setIsTimeWarpPlaying(false);
          setPlayheadOffsetMs(offsetMs);
          physicsWorkerRef.current?.postMessage({
            type: 'SCRUB_TIMEWARP',
            playheadMs: Date.now() + offsetMs,
          });
        }}
        onToggleTimeWarp60x={() => {
          stop15sTour();
          setIsTimeWarpPlaying((prev) => {
            const next = !prev;
            physicsWorkerRef.current?.postMessage({
              type: 'TOGGLE_TIMEWARP_PLAY',
              playing: next,
              speedMultiplier: 60,
            });
            return next;
          });
        }}
        onSnapToLive={() => {
          stop15sTour();
          setIsTimeWarpPlaying(false);
          setPlayheadOffsetMs(0);
          physicsWorkerRef.current?.postMessage({ type: 'SNAP_TO_LIVE' });
        }}
        onFlyToSector={handleFocusAndPulseSector}
        onTriggerGlobalStandup={triggerTopClientStandup}
        onSaveGeminiKey={(k) => {
          setGeminiApiKey(k);
          try {
            localStorage.setItem('cortex_gemini_key', k);
          } catch {
            // Ignore storage errors
          }
        }}
        onToggleDemoSeed={handleToggleDemoSeed}
        onToggleSourcesDrawer={() => setSourcesDrawerOpen((prev) => !prev)}
        onStart15sTour={start15sTour}
      />

      {/* Z-35: Bottom-Left Collapsible "COSMOS DECODER" Visual Legend + First-Visit Welcome + 15s Tour */}
      <CosmosDecoderHUD
        isOpen={decoderOpen}
        showWelcomeModal={showWelcomeModal}
        tourState={tourState}
        onToggleOpen={() => setDecoderOpen((prev) => !prev)}
        onFocusAndPulseSector={handleFocusAndPulseSector}
        onStart15sTour={start15sTour}
        onDismissWelcome={dismissWelcome}
        onStopTour={stop15sTour}
      />

      {/* Z-35: Mobile <768px Persistent Bottom Switcher [Feed | 3D Map] */}
      {isMobileViewport && !(mobileViewMode === 'MAP' && Boolean(focusedSignal)) && (
        <div
          role="tablist"
          aria-label="Mobile View Switcher"
          className="fixed bottom-2.5 left-1/2 -translate-x-1/2 z-[35] md:hidden cockpit-obsidian inline-grid grid-cols-2 p-1 rounded-full border border-white/15 shadow-2xl"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mobileViewMode === 'FEED'}
            onClick={() => setMobileViewMode('FEED')}
            className={`inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3.5 rounded-full font-mono text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              mobileViewMode === 'FEED'
                ? 'bg-teal-500/22 text-teal-100 border border-teal-400/50'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-teal-300 shrink-0" />
            <span>Feed</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileViewMode === 'MAP'}
            onClick={() => setMobileViewMode('MAP')}
            className={`inline-flex items-center justify-center gap-1.5 min-h-[36px] px-3.5 rounded-full font-mono text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
              mobileViewMode === 'MAP'
                ? 'bg-teal-500/22 text-teal-100 border border-teal-400/50'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <Compass className="w-3.5 h-3.5 text-teal-300 shrink-0" />
            <span>3D Map</span>
          </button>
        </div>
      )}

      {/* Z-45: Instant Command Palette (Ctrl+K / /) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        signals={signalsRef.current}
        mutedSectors={mutedSectors}
        activeLiteracyLevel={globalLiteracyLevel}
        onSelectNodeIndex={handleSelectSignalFromUI}
      />

      {/* Z-40: Right-Side Underground Firehose Switchboard (Local Server Mode Only) */}
      {!isStaticPublicMode && (
        <SourcesRadarDrawer
          isOpen={sourcesDrawerOpen}
          showDemoSeed={showDemoSeed}
          enabledCategories={enabledCategories}
          liveVerifiedCount={liveVerifiedCount}
          demoSeedCount={demoSeedCount}
          onClose={() => setSourcesDrawerOpen(false)}
          onToggleDemoSeed={handleToggleDemoSeed}
          onToggleCategory={(cat) =>
            setEnabledCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))
          }
          onSourcesUpdated={() => {
            ingestWorkerRef.current?.postMessage({ type: 'REFRESH_UPSTREAMS' });
          }}
          onSynthesisStatusUpdated={setSynthesisStatus}
        />
      )}
    </div>
  );
};
