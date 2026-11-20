import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Layers,
  Link2,
  MessageSquare,
  Orbit,
  Pause,
  Play,
  RefreshCw,
  Share2,
  ShieldAlert,
  Sparkles,
  Swords,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  buildDeterministicLiteracyPayload,
  inferDomainEnterpriseStacks,
  matchGlossaryTextSegments,
  sanitizeLiteracyPayloadPlainLevels,
} from '../../shared/literacyEngine';
import { computeDivergenceMetrics } from '../../shared/supernovaEngine';
import {
  BlastOrderConsequence,
  CLIENT_INDUSTRIES,
  ClientIndustry,
  GlossaryTerm,
  LITERACY_LEVELS,
  LiteracyLevel,
  LiteracySpectrumPayload,
  SECTOR_BY_ID,
  SemanticZoomBand,
  SpatialSignal,
  StreetQuote,
  SynthesisEngineId,
} from '../../shared/types';
import { cockpitAudio } from '../utils/cockpitAudio';
import { buildCortexDeepLinkUrl } from '../utils/deepLink';
import { renderShareCardPngBlob } from '../utils/shareCardCanvas';
import { LENS_SHORT_LABELS } from '../utils/signalRanking';
import { InstrumentButton, Kbd } from './ui/cockpit-primitives';

// Persistent module-level GPU synthesis & quote caches so 60fps physics / HUD ticks NEVER orphan in-flight promises!
const persistentGpuLiteracyMap = new Map<string, LiteracySpectrumPayload>();
const persistentHydratedQuotesMap = new Map<string, StreetQuote[]>();
const inFlightGpuNodeSet = new Set<string>();
const inFlightGpuPromises = new Map<string, Promise<void>>();
const attemptedRedditQuoteHydrateSet = new Set<string>();

/**
 * Hydrates pre-baked L1-L5 literacy payloads & street quotes into persistent caches in <1ms
 * when running in serverless Static Cloud Snapshot mode (GitHub Pages / Cloudflare Pages).
 */
export function hydrateStaticSnapshotLiteracyMap(
  entries: Record<string, LiteracySpectrumPayload>,
  signals: SpatialSignal[] = []
): void {
  for (const [sigId, payload] of Object.entries(entries || {})) {
    if (!payload || !payload.levels) continue;
    persistentGpuLiteracyMap.set(sigId, sanitizeLiteracyPayloadPlainLevels(payload));
  }
  for (const sig of signals) {
    if (sig.literacy) {
      const cleanLit = sanitizeLiteracyPayloadPlainLevels(sig.literacy);
      sig.literacy = cleanLit;
      if (cleanLit.generatedBy !== 'DETERMINISTIC') {
        persistentGpuLiteracyMap.set(sig.id, cleanLit);
      }
    }
    if (Array.isArray(sig.streetQuotes) && sig.streetQuotes.length > 0) {
      persistentHydratedQuotesMap.set(sig.id, sig.streetQuotes);
    }
  }
}

export interface BattlecardPair {
  nodeAIndex: number;
  nodeBIndex: number;
  pinned: boolean;
}

export interface StandupFusionState {
  signals: SpatialSignal[];
  originLabel: string;
}

export interface BlastSatellite {
  nodeIndex: number;
  signal: SpatialSignal;
}

export interface PlanetariumBriefingBarProps {
  step: number;
  total: number;
  paused: boolean;
  remainingSec: number;
  listenEnabled: boolean;
  speechSupported: boolean;
  onPrev: () => void;
  onTogglePause: () => void;
  onNext: () => void;
  onToggleListen: () => void;
  onExit: () => void;
}

interface DiegeticPoolProps {
  slotRefs: React.MutableRefObject<Array<HTMLDivElement | null>>;
  focusedSignal: SpatialSignal | null;
  zoomBand: SemanticZoomBand;
  globalLiteracyLevel: LiteracyLevel;
  activeClient: ClientIndustry;
  battlecardPair: BattlecardPair | null;
  signals: SpatialSignal[];
  standupFusion: StandupFusionState | null;
  blastSatellites: BlastSatellite[];
  blastHorizons: [BlastOrderConsequence, BlastOrderConsequence, BlastOrderConsequence] | null;
  geminiApiKey: string;
  activeSynthesisEngine: SynthesisEngineId;
  userLockedRules?: boolean;
  ollamaOnline: boolean;
  ollamaModel: string;
  isMobileViewport?: boolean;
  isStaticPublicMode?: boolean;
  briefingBar?: PlanetariumBriefingBarProps | null;
  onSynthesisTelemetry?: (stats: {
    engineUsed: SynthesisEngineId;
    tokensPerSec: number;
    latencyMs: number;
    modelUsed?: string;
  }) => void;
  onCloseFocused: () => void;
  onTriggerBlastRadiusWave: () => void;
  onClearBlastRadiusWave: () => void;
  onReleaseBattlecard: () => void;
  onCloseStandup: () => void;
  onSelectSatellite: (nodeIdx: number) => void;
  deepLinkLevelOverride?: { signalId: string; level: LiteracyLevel; nonce: number } | null;
  onActiveLevelChange?: (signalId: string, level: LiteracyLevel) => void;
  onSelectGlobalLiteracyLevel?: (level: LiteracyLevel) => void;
}

function hashSignalSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function deriveClientGitHubOgImage(rawUrl?: string): string | null {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    if (!/^(?:www\.)?github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    if (
      /^(?:orgs|topics|trending|explore|marketplace|sponsors|settings|notifications|login|pricing|features|collections|events|about|security|customer-stories)$/i.test(
        owner
      )
    ) {
      return null;
    }
    return `https://opengraph.githubassets.com/1/${owner}/${repo}`;
  } catch {
    return null;
  }
}

const DeterministicSvgDataHeader: React.FC<{
  signal: SpatialSignal;
  sectorColor: string;
  sectorCode: string;
}> = ({ signal, sectorColor, sectorCode }) => {
  const h = hashSignalSeed(`${signal.id}:${signal.title}`);
  const f1 = 1.6 + ((h & 0xff) / 255) * 2.2;
  const f2 = 3.5 + (((h >>> 8) & 0xff) / 255) * 3.1;
  const phase = (((h >>> 16) & 0xff) / 255) * Math.PI * 2;

  const wavePoints: string[] = [];
  for (let i = 0; i <= 38; i++) {
    const t = i / 38;
    const x = (t * 265).toFixed(1);
    const env = Math.sin(t * Math.PI);
    const y = (
      28 +
      (Math.sin(t * Math.PI * 2 * f1 + phase) * 10.5 +
        Math.cos(t * Math.PI * 2 * f2 - phase * 0.6) * 5.2) *
        (0.35 + 0.65 * env)
    ).toFixed(1);
    wavePoints.push(`${i === 0 ? 'M' : 'L'} ${x} ${y}`);
  }
  const wavePath = wavePoints.join(' ');
  const fillPath = `${wavePath} L 265 56 L 0 56 Z`;

  // 5-node constellation topology graph on right side (x: 282..386)
  const nodes = Array.from({ length: 5 }, (_, k) => {
    const sub = hashSignalSeed(`${signal.id}-node-${k}`);
    const nx = 286 + k * 23 + ((sub & 7) - 3.5);
    const ny = 13 + (((sub >>> 4) % 30));
    const r = k === 2 ? 3.2 : 2.1;
    return { nx, ny, r };
  });

  const gradId = `hdr-grad-${(h & 0xfffff).toString(16)}`;

  return (
    <div
      aria-hidden="true"
      className="cockpit-well relative h-14 w-full rounded-lg overflow-hidden select-none"
    >
      <svg
        viewBox="0 0 400 56"
        preserveAspectRatio="none"
        className="w-full h-full block"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sectorColor} stopOpacity="0.24" />
            <stop offset="100%" stopColor={sectorColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Subtle Horizontal Telemetry Baseline Grid */}
        <line x1="0" y1="14" x2="400" y2="14" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        <line x1="0" y1="28" x2="400" y2="28" stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" strokeWidth="1" />
        <line x1="0" y1="42" x2="400" y2="42" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />

        {/* Deterministic Sector-Tinted Waveform */}
        <path d={fillPath} fill={`url(#${gradId})`} />
        <path
          d={wavePath}
          fill="none"
          stroke={sectorColor}
          strokeOpacity="0.82"
          strokeWidth="1.5"
        />

        {/* Divider & Node Topology Constellation */}
        <line x1="273" y1="8" x2="273" y2="48" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        {nodes.slice(0, -1).map((n, idx) => (
          <line
            key={idx}
            x1={n.nx}
            y1={n.ny}
            x2={nodes[idx + 1].nx}
            y2={nodes[idx + 1].ny}
            stroke={sectorColor}
            strokeOpacity="0.42"
            strokeWidth="1.1"
          />
        ))}
        <line
          x1={nodes[0].nx}
          y1={nodes[0].ny}
          x2={nodes[2].nx}
          y2={nodes[2].ny}
          stroke="rgba(255,255,255,0.16)"
          strokeDasharray="2 2"
          strokeWidth="0.9"
        />
        {nodes.map((n, idx) => (
          <circle
            key={idx}
            cx={n.nx}
            cy={n.ny}
            r={n.r}
            fill={idx === 2 ? sectorColor : '#E4E4E7'}
            fillOpacity={idx === 2 ? '0.95' : '0.7'}
          />
        ))}
      </svg>

      {/* Crisp Top-Left & Bottom-Right Monospace Telemetry Stamp */}
      <div className="pointer-events-none absolute top-1.5 left-2.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-zinc-400 tabular-nums">
        <span
          style={{ backgroundColor: sectorColor }}
          className="h-1.5 w-1.5 rounded-full opacity-90"
        />
        <span>{sectorCode} SIGNAL WAVEFORM</span>
      </div>
      <div className="pointer-events-none absolute bottom-1 right-2.5 font-mono text-[9px] text-zinc-400 tabular-nums">
        M{signal.mass.toFixed(1)} · {signal.readiness}
      </div>
    </div>
  );
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function clampDiegeticCardCoords(
  rawX: number,
  rawY: number,
  cardWidth: number,
  cardHeight: number,
  viewportW: number = window.innerWidth,
  viewportH: number = window.innerHeight,
  rightInsetPx: number = 16
): { x: number; y: number } {
  const safeW = Math.max(180, Math.min(cardWidth, viewportW - 16 - rightInsetPx));
  const safeH = Math.max(84, Math.min(cardHeight, viewportH - 172));
  const maxX = Math.max(16, viewportW - safeW - rightInsetPx);
  const maxY = Math.max(62, viewportH - safeH - 108);
  return {
    x: Math.max(16, Math.min(maxX, rawX)),
    y: Math.max(62, Math.min(maxY, rawY)),
  };
}

function cleanVelocityText(raw: string): string {
  return raw
    .replace(/^[^\w+#@]+/, '')
    .replace(/\b1\s+upvotes\b/gi, '1 upvote')
    .replace(/\b1\s+likes\b/gi, '1 like')
    .replace(/\b1\s+replies\b/gi, '1 reply')
    .replace(/\b1\s+comments\b/gi, '1 comment')
    .replace(/\b1\s+stars\b/gi, '1 star')
    .replace(/\b1\s+forks\b/gi, '1 fork')
    .replace(/\b1\s+pts\b/gi, '1 pt')
    .replace(/\b1\s+ups\b/gi, '1 up')
    .trim();
}

function hasAuthenticEngagementVelocity(sig: SpatialSignal): boolean {
  if (!sig.engagementVelocity?.badgeText) return false;
  if (sig.isDemoSeed) return true;
  if (
    sig.source === 'LabRelease' ||
    sig.source === 'VIPBlog' ||
    sig.source === 'arXiv' ||
    sig.source === 'GHRelease'
  ) {
    return false;
  }
  // Reject legacy synthetic fallback pattern ("58/hr · 165 pts") on non-HN feeds
  if (sig.source !== 'HackerNews' && /\/hr\s*·\s*\d+\s*pts$/i.test(sig.engagementVelocity.badgeText)) {
    return false;
  }
  return true;
}

/**
 * Only show HYPE · STREET divergence bar when the signal has genuine community engagement
 * (>= 10 upvotes/points/likes/stars or >= 2 cross-network sources), never on a 1-upvote paper.
 */
function hasSubstantiveCommunityEngagement(sig: SpatialSignal): boolean {
  if (sig.isDemoSeed) return (sig.streetQuotes?.length ?? 0) >= 2;
  const ups = sig.engagementVelocity?.likesOrUps ?? 0;
  const nets = sig.networkFamilies?.length ?? 0;
  const realQuotes = (sig.streetQuotes || []).filter(
    (q) => !q.id.endsWith('-self-quote') && q.author !== sig.originFeedName
  );
  return ups >= 10 || nets >= 2 || realQuotes.length >= 2;
}

function stripSignalOriginPrefix(sig: SpatialSignal): string {
  const origin = sig.originFeedName || '';
  let cleaned = sig.title
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^r\/[A-Za-z0-9_]+:\s*/i, '')
    .replace(/^@[A-Za-z0-9_.-]+:\s*/i, '')
    .replace(/^(?:OpenAI News|Google DeepMind|Anthropic News|Meta AI Eng|HF Paper|arXiv)\s*:\s*/i, '')
    .trim();
  if (origin) {
    const escaped = escapeRegExp(origin);
    cleaned = cleaned.replace(new RegExp(`^${escaped}\\s*[:—-]\\s*`, 'i'), '').trim();
  }
  return cleaned || sig.title.trim();
}

function formatCleanSignalTitle(sig: SpatialSignal, maxChars = 62): string {
  const cleaned = stripSignalOriginPrefix(sig);
  if (cleaned.length <= maxChars) return cleaned || sig.shortLabel;
  return `${cleaned.slice(0, maxChars - 1).replace(/\s+\S*$/, '')}…`;
}

interface VerifiedPostMetric {
  label: string;
  valueText: string;
  barPct: number;
}

/**
 * Extracts ONLY real quantitative figures explicitly stated in the signal text (zero synthetic fallback numbers).
 */
function extractVerifiedPostMetrics(sig: SpatialSignal): VerifiedPostMetric[] {
  const text = `${sig.title} ${sig.rawAbstract}`;
  const found: VerifiedPostMetric[] = [];

  const tokMatch = text.match(/\b(\d{2,4}(?:\.\d+)?)\s*(?:tok\/s|t\/s|tokens\/s)\b/i);
  if (tokMatch) {
    const val = Number(tokMatch[1]);
    found.push({
      label: 'Measured Throughput',
      valueText: `${tokMatch[1]} tok/s`,
      barPct: Math.max(18, Math.min(100, Math.round((val / 350) * 100))),
    });
  }

  const ttftMatch = text.match(/\b(\d{1,4}(?:\.\d+)?)\s*ms\b/i);
  if (ttftMatch) {
    const ms = Number(ttftMatch[1]);
    found.push({
      label: 'Reported Latency',
      valueText: `${ttftMatch[1]} ms`,
      barPct: Math.max(18, Math.min(100, Math.round(Math.max(15, 100 - ms / 8)))),
    });
  }

  const pctMatch = text.match(/\b(\d{1,3}(?:\.\d+)?)%\s*(verified|reduction|faster|cheaper|claims|cut|drop|accuracy|beat)/i);
  if (pctMatch) {
    const pct = Number(pctMatch[1]);
    found.push({
      label: `Reported Delta (${pctMatch[2].toLowerCase()})`,
      valueText: `${pctMatch[1]}%`,
      barPct: Math.max(15, Math.min(100, Math.round(pct))),
    });
  }

  const vramMatch = text.match(/\b(\d{1,3})\s*GB\s*VRAM\b/i);
  if (vramMatch) {
    const gb = Number(vramMatch[1]);
    found.push({
      label: 'VRAM Footprint',
      valueText: `${vramMatch[1]} GB VRAM`,
      barPct: Math.max(18, Math.min(100, Math.round((gb / 80) * 100))),
    });
  }

  return found.slice(0, 3);
}

const THIRD_PARTY_SOURCE_DISCLAIMER =
  'Headlines and summaries reflect linked third-party sources; open upstream links directly to inspect primary claims.';

function formatVerdictDisplayLabel(verdict?: string): string {
  if (!verdict || verdict === 'STREET VERIFIED') return 'MULTI-SOURCE';
  return verdict;
}

function isAuthenticModelEntity(sig: SpatialSignal): boolean {
  if (!sig.modelSpecs) return false;
  if (
    sig.source === 'Reddit' ||
    sig.source === 'HackerNews' ||
    sig.source === 'Bluesky' ||
    sig.source === 'VIPBlog' ||
    sig.source === 'XBridge' ||
    sig.source === 'XPlaywright'
  ) {
    return false;
  }
  if (
    /\b(discussion hub|megathread|weekly|i think|opinion|thoughts on|question|case study|playbook|cert|exam|audit|pact)\b/i.test(
      sig.title
    )
  ) {
    return false;
  }
  return true;
}

function renderTextWithGlossaryPills(
  text: string,
  glossary: GlossaryTerm[],
  activeTerm: GlossaryTerm | null,
  onFocusTerm: (term: GlossaryTerm) => void
): React.ReactNode {
  if (!glossary || glossary.length === 0) return text;
  const segments = matchGlossaryTextSegments(text, glossary);

  return segments.map((seg, idx) => {
    const matched = seg.matchedTerm;
    if (!matched) return <React.Fragment key={idx}>{seg.text}</React.Fragment>;
    const isSelected = activeTerm?.term.toLowerCase() === matched.term.toLowerCase();
    return (
      <button
        key={idx}
        type="button"
        onMouseEnter={() => onFocusTerm(matched)}
        onClick={() => onFocusTerm(matched)}
        className={`inline font-mono text-[11px] px-1 py-0.2 mx-0.5 rounded-[4px] border-b border-dotted transition-colors cursor-help ${
          isSelected
            ? 'bg-teal-500/20 text-teal-100 border-teal-300 font-medium'
            : 'bg-zinc-900 hover:bg-zinc-800 text-teal-200 border-teal-400/75'
        }`}
      >
        {seg.text}
      </button>
    );
  });
}

function buildRadarPoints(
  vals: [number, number, number, number, number],
  cx: number,
  cy: number,
  maxR: number
): string {
  return vals
    .map((v, idx) => {
      const ang = -Math.PI / 2 + (idx * Math.PI * 2) / 5;
      const r = (Math.max(12, v) / 100) * maxR;
      return `${(cx + Math.cos(ang) * r).toFixed(1)},${(cy + Math.sin(ang) * r).toFixed(1)}`;
    })
    .join(' ');
}

export const DiegeticPool: React.FC<DiegeticPoolProps> = ({
  slotRefs,
  focusedSignal,
  globalLiteracyLevel,
  activeClient,
  battlecardPair,
  signals,
  standupFusion,
  blastSatellites,
  blastHorizons,
  geminiApiKey,
  activeSynthesisEngine,
  userLockedRules = false,
  ollamaOnline,
  ollamaModel,
  isMobileViewport = false,
  isStaticPublicMode = false,
  briefingBar = null,
  onSynthesisTelemetry,
  onCloseFocused,
  onTriggerBlastRadiusWave,
  onClearBlastRadiusWave,
  onReleaseBattlecard,
  onCloseStandup,
  onSelectSatellite,
  deepLinkLevelOverride,
  onActiveLevelChange,
  onSelectGlobalLiteracyLevel,
}) => {
  const [bubbleLevels, setBubbleLevels] = useState<Record<string, LiteracyLevel>>({});
  const [showCrossfire, setShowCrossfire] = useState(false);
  const [battlecardTab, setBattlecardTab] = useState<'COMPARE' | 'BRIEF_A' | 'BRIEF_B'>('COMPARE');
  const [battlecardBriefLevel, setBattlecardBriefLevel] =
    useState<LiteracyLevel>(globalLiteracyLevel);
  const [activeGlossaryTerm, setActiveGlossaryTerm] = useState<GlossaryTerm | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [linkCopiedId, setLinkCopiedId] = useState<string | null>(null);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [sharedPngId, setSharedPngId] = useState<string | null>(null);
  const [brokenMediaUrls, setBrokenMediaUrls] = useState<Record<string, boolean>>({});
  const [lightboxMedia, setLightboxMedia] = useState<{
    url: string;
    caption?: string;
    sourceUrl?: string;
  } | null>(null);
  const [liveSynthesisText, setLiveSynthesisText] = useState<Record<string, string>>({});
  const [, bumpGpuCacheRev] = useState(0);
  const [geminiBlastCache, setGeminiBlastCache] = useState<
    Record<string, Array<Partial<BlastOrderConsequence>>>
  >({});
  const [synthesizingKey, setSynthesizingKey] = useState<string | null>(null);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const isDraggingTrackRef = useRef(false);
  const sheetSwipeStartYRef = useRef<number | null>(null);
  const attemptedAutoSynthRef = useRef<Set<string>>(new Set());

  const clientMeta = CLIENT_INDUSTRIES.find((c) => c.id === activeClient) || CLIENT_INDUSTRIES[0];

  const preferredLiveEngine: SynthesisEngineId | null = userLockedRules
    ? null
    : activeSynthesisEngine === 'GEMINI' && Boolean(geminiApiKey)
    ? 'GEMINI'
    : ollamaOnline || activeSynthesisEngine === 'OLLAMA'
    ? 'OLLAMA'
    : geminiApiKey
    ? 'GEMINI'
    : 'OLLAMA';

  const setSignalLiteracyLevel = (sigId: string, nextLvl: LiteracyLevel) => {
    setShowCrossfire(false);
    const current = bubbleLevels[sigId] ?? globalLiteracyLevel;
    if (current !== nextLvl) {
      cockpitAudio.playScrubberDetentTick(nextLvl);
      onActiveLevelChange?.(sigId, nextLvl);
      onSelectGlobalLiteracyLevel?.(nextLvl);
    }
    setBubbleLevels((prev) => {
      if (prev[sigId] === nextLvl) return prev;
      return { ...prev, [sigId]: nextLvl };
    });
  };

  // Sync open bubbles cleanly when global HUD default literacy lens changes
  useEffect(() => {
    setBubbleLevels({});
    setBattlecardBriefLevel(globalLiteracyLevel);
    setShowCrossfire(false);
  }, [globalLiteracyLevel]);

  // Apply explicit deep-link ?signal=<id>&level=<1-5> override cleanly
  useEffect(() => {
    if (!deepLinkLevelOverride) return;
    setBubbleLevels((prev) => ({
      ...prev,
      [deepLinkLevelOverride.signalId]: deepLinkLevelOverride.level,
    }));
  }, [deepLinkLevelOverride?.nonce, deepLinkLevelOverride?.signalId, deepLinkLevelOverride?.level]);

  // Close Lightbox on Escape before dismissing the underlying Hologram Reader
  useEffect(() => {
    if (!lightboxMedia) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setLightboxMedia(null);
      }
    };
    window.addEventListener('keydown', onEsc, { capture: true });
    return () => window.removeEventListener('keydown', onEsc, { capture: true });
  }, [lightboxMedia]);

  // Reset Battlecard tab to COMPARE when a new pair is collided
  useEffect(() => {
    setBattlecardTab('COMPARE');
    setBattlecardBriefLevel(globalLiteracyLevel);
  }, [battlecardPair?.nodeAIndex, battlecardPair?.nodeBIndex, globalLiteracyLevel]);

  // Reset active glossary tooltip & share menu when switching focused signal
  useEffect(() => {
    setActiveGlossaryTerm(null);
    setShowCrossfire(false);
    setShareMenuOpen(false);
    setLightboxMedia(null);
  }, [focusedSignal?.id]);

  // Keyboard 1-5 Zero-Latency Literacy Scrubber while a bubble hologram OR Battlecard Brief is open!
  useEffect(() => {
    const briefOpenInBattlecard = Boolean(battlecardPair && battlecardTab !== 'COMPARE');
    if (!focusedSignal && !briefOpenInBattlecard) return;
    const sigId = focusedSignal?.id;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key >= '1' && e.key <= '5' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const nextLvl = Number(e.key) as LiteracyLevel;
        if (briefOpenInBattlecard) {
          cockpitAudio.playScrubberDetentTick(nextLvl);
          setBattlecardBriefLevel(nextLvl);
        } else if (sigId) {
          setSignalLiteracyLevel(sigId, nextLvl);
        }
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedSignal, battlecardPair, battlecardTab, globalLiteracyLevel]);

  const copyText = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId((prev) => (prev === key ? null : prev)), 1800);
  };

  // Auto-upgrade 30/60/90d Blast-Radius via active Tri-Engine (Ollama or Gemini 2.5 Flash)
  useEffect(() => {
    if (isStaticPublicMode || !blastHorizons || !focusedSignal) return;
    const canRunOllama = activeSynthesisEngine === 'OLLAMA' && ollamaOnline;
    const canRunGemini = activeSynthesisEngine === 'GEMINI' && Boolean(geminiApiKey);
    if (!canRunOllama && !canRunGemini) return;

    const cacheKey = `${focusedSignal.id}-${activeClient}-${activeSynthesisEngine}`;
    if (geminiBlastCache[cacheKey]) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/blast-radius', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engine: activeSynthesisEngine,
            ollamaModel: ollamaModel || undefined,
            apiKey: geminiApiKey || undefined,
            clientIndustry: clientMeta.label,
            signalTitle: focusedSignal.title,
            signalSummary: focusedSignal.rawAbstract,
          }),
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as {
          horizons?: Array<Partial<BlastOrderConsequence>>;
          engineUsed?: SynthesisEngineId;
          tokensPerSec?: number;
          latencyMs?: number;
          modelUsed?: string;
        };
        if (json.engineUsed && onSynthesisTelemetry) {
          onSynthesisTelemetry({
            engineUsed: json.engineUsed,
            tokensPerSec: json.tokensPerSec || 0,
            latencyMs: json.latencyMs || 0,
            modelUsed: json.modelUsed,
          });
        }
        if (Array.isArray(json.horizons) && json.horizons.length >= 3 && !cancelled) {
          setGeminiBlastCache((prev) => ({ ...prev, [cacheKey]: json.horizons! }));
        }
      } catch {
        // Keep deterministic rules seamlessly
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    blastHorizons,
    focusedSignal,
    activeClient,
    activeSynthesisEngine,
    ollamaOnline,
    ollamaModel,
    geminiApiKey,
    clientMeta.label,
    geminiBlastCache,
    onSynthesisTelemetry,
  ]);

  const triggerTriEngineRewrite = async (cacheKey: string, prompt: string) => {
    if (synthesizingKey) return;
    setSynthesizingKey(cacheKey);
    try {
      const res = await fetch('/api/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engine: activeSynthesisEngine,
          ollamaModel: ollamaModel || undefined,
          apiKey: geminiApiKey || undefined,
          clientIndustry: clientMeta.label,
          prompt,
        }),
      });
      const data = (await res.json()) as {
        text?: string;
        error?: string;
        engineUsed?: SynthesisEngineId;
        tokensPerSec?: number;
        latencyMs?: number;
        modelUsed?: string;
      };
      if (data.text) {
        setLiveSynthesisText((prev) => ({ ...prev, [cacheKey]: data.text! }));
        if (data.engineUsed && onSynthesisTelemetry) {
          onSynthesisTelemetry({
            engineUsed: data.engineUsed,
            tokensPerSec: data.tokensPerSec || 0,
            latencyMs: data.latencyMs || 0,
            modelUsed: data.modelUsed,
          });
        }
      } else if (data.error) {
        setLiveSynthesisText((prev) => ({
          ...prev,
          [cacheKey]: `[${activeSynthesisEngine}] ${data.error}`,
        }));
      }
    } catch (err) {
      setLiveSynthesisText((prev) => ({
        ...prev,
        [cacheKey]: `[Offline] ${(err as Error).message}`,
      }));
    } finally {
      setSynthesizingKey(null);
    }
  };

  const triggerTriEngine5LevelSynthesis = async (
    cacheKey: string,
    sig: SpatialSignal,
    engineOverride?: SynthesisEngineId,
    forceRefresh = false
  ) => {
    const engineToUse: SynthesisEngineId =
      engineOverride ||
      preferredLiveEngine ||
      (activeSynthesisEngine === 'DETERMINISTIC' ? 'OLLAMA' : activeSynthesisEngine);

    if (!forceRefresh && inFlightGpuPromises.has(cacheKey)) {
      return inFlightGpuPromises.get(cacheKey);
    }

    inFlightGpuNodeSet.add(sig.id);
    setSynthesizingKey(cacheKey);
    bumpGpuCacheRev((v) => v + 1);

    const job = (async () => {
      try {
        const res = await fetch('/api/synthesize/literacy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engine: engineToUse,
            ollamaModel: ollamaModel || undefined,
            apiKey: geminiApiKey || undefined,
            clientIndustry: activeClient,
            signal: sig,
            forceRefresh,
            priority: 'user',
          }),
        });
        const data = (await res.json()) as {
          literacy?: LiteracySpectrumPayload;
          hydratedQuotes?: StreetQuote[];
          error?: string;
          engineUsed?: SynthesisEngineId;
          tokensPerSec?: number;
          latencyMs?: number;
          modelUsed?: string;
        };
        if (Array.isArray(data.hydratedQuotes) && data.hydratedQuotes.length > 0) {
          persistentHydratedQuotesMap.set(sig.id, data.hydratedQuotes);
        }
        if (data.literacy && data.literacy.generatedBy !== 'DETERMINISTIC') {
          const finalEngine = data.engineUsed || engineToUse;
          persistentGpuLiteracyMap.set(sig.id, data.literacy);
          persistentGpuLiteracyMap.set(cacheKey, data.literacy);
          persistentGpuLiteracyMap.set(`${sig.id}-${activeClient}-${finalEngine}`, data.literacy);
          if (data.engineUsed && onSynthesisTelemetry) {
            onSynthesisTelemetry({
              engineUsed: data.engineUsed,
              tokensPerSec: data.tokensPerSec || 0,
              latencyMs: data.latencyMs || 0,
              modelUsed: data.modelUsed,
            });
          }
        }
      } catch {
        // Deterministic 5-tier cache remains active
      } finally {
        inFlightGpuPromises.delete(cacheKey);
        inFlightGpuNodeSet.delete(sig.id);
        setSynthesizingKey((prev) => (prev === cacheKey ? null : prev));
        bumpGpuCacheRev((v) => v + 1);
      }
    })();

    inFlightGpuPromises.set(cacheKey, job);
    return job;
  };

  // Hydrate server-side background pre-warmed qwen2.5:7b top-8 live orbs so clicking them renders in 0ms!
  useEffect(() => {
    if (isStaticPublicMode) return;
    let active = true;
    const syncPrewarmed = async () => {
      try {
        const res = await fetch('/api/synthesize/prewarmed');
        if (!res.ok || !active) return;
        const json = (await res.json()) as {
          entries?: Record<string, LiteracySpectrumPayload>;
        };
        if (json.entries && active) {
          let changed = false;
          for (const [k, val] of Object.entries(json.entries)) {
            if (!persistentGpuLiteracyMap.has(k)) {
              persistentGpuLiteracyMap.set(k, val);
              const idPart = k.replace(/-(?:BANKING|HEALTHCARE|SAAS|PUBLIC)-(?:OLLAMA|GEMINI|DETERMINISTIC)$/, '');
              if (idPart && !persistentGpuLiteracyMap.has(idPart)) {
                persistentGpuLiteracyMap.set(idPart, val);
              }
              changed = true;
            }
          }
          if (changed) bumpGpuCacheRev((v) => v + 1);
        }
      } catch {
        // Ignore transient offline state
      }
    };
    const initialTimer = setTimeout(() => void syncPrewarmed(), 1800);
    const interval = setInterval(() => void syncPrewarmed(), 14_000);
    return () => {
      active = false;
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [ollamaOnline, isStaticPublicMode]);

  // Immediately hydrate missing Reddit engineer comments via /api/reddit/comments (.rss primary)!
  useEffect(() => {
    if (isStaticPublicMode || !focusedSignal) return;
    const isReddit =
      focusedSignal.source === 'Reddit' ||
      focusedSignal.url.includes('reddit.com/') ||
      /^r\//i.test(focusedSignal.originFeedName || '');
    if (!isReddit) return;

    const realQuotes = (focusedSignal.streetQuotes || []).filter(
      (q) => !q.id.endsWith('-self-quote') && q.author !== focusedSignal.originFeedName
    );
    if (
      realQuotes.length > 0 ||
      persistentHydratedQuotesMap.has(focusedSignal.id) ||
      attemptedRedditQuoteHydrateSet.has(focusedSignal.id)
    ) {
      return;
    }
    // Only skip if upstream explicitly reported 0 comments (RSS Reddit items omit engagementVelocity)
    if (
      focusedSignal.engagementVelocity &&
      focusedSignal.engagementVelocity.commentsOrReplies === 0
    ) {
      return;
    }

    const postId =
      focusedSignal.url.match(/\/comments\/([a-z0-9]{5,10})/i)?.[1] ||
      focusedSignal.id.match(/t3_([a-z0-9]{5,10})/i)?.[1] ||
      (focusedSignal.id.startsWith('rd-street-')
        ? focusedSignal.id.replace('rd-street-', '')
        : '');
    if (!postId) return;

    const sub =
      focusedSignal.url.match(/\/r\/([^/]+)/i)?.[1] ||
      (focusedSignal.originFeedName || '').replace(/^r\//i, '') ||
      'LocalLLaMA';

    attemptedRedditQuoteHydrateSet.add(focusedSignal.id);
    const sigId = focusedSignal.id;
    void fetch(
      `/api/reddit/comments?postId=${encodeURIComponent(postId)}&subreddit=${encodeURIComponent(sub)}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { quotes?: StreetQuote[] } | null) => {
        if (Array.isArray(json?.quotes) && json!.quotes.length > 0) {
          persistentHydratedQuotesMap.set(sigId, json!.quotes);
          bumpGpuCacheRev((v) => v + 1);
        }
      })
      .catch(() => {});
  }, [focusedSignal?.id]);

  // Immediately trigger POST /api/synthesize/literacy whenever ANY focused orb currently has Rules copy!
  useEffect(() => {
    if (isStaticPublicMode || !focusedSignal || userLockedRules || !preferredLiveEngine) return;
    const autoKey = `${focusedSignal.id}-${activeClient}-${preferredLiveEngine}`;
    const defaultBankKey = `${focusedSignal.id}-BANKING-${preferredLiveEngine}`;
    const existing =
      persistentGpuLiteracyMap.get(autoKey) ||
      persistentGpuLiteracyMap.get(focusedSignal.id) ||
      (preferredLiveEngine === 'OLLAMA' ? persistentGpuLiteracyMap.get(defaultBankKey) : undefined);

    if (existing && existing.generatedBy !== 'DETERMINISTIC') {
      return;
    }
    if (attemptedAutoSynthRef.current.has(autoKey)) {
      return;
    }

    attemptedAutoSynthRef.current.add(autoKey);
    void triggerTriEngine5LevelSynthesis(autoKey, focusedSignal, preferredLiveEngine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedSignal?.id, activeClient, preferredLiveEngine, ollamaOnline, userLockedRules]);

  const scrubLevelFromPointer = (clientX: number, sigId: string) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(0.999, (clientX - rect.left) / Math.max(1, rect.width)));
    const nextLvl = (Math.floor(ratio * 5) + 1) as LiteracyLevel;
    setSignalLiteracyLevel(sigId, nextLvl);
  };

  const modelA = battlecardPair ? signals[battlecardPair.nodeAIndex] : null;
  const modelB = battlecardPair ? signals[battlecardPair.nodeBIndex] : null;
  const effectiveSynthEngine: SynthesisEngineId = preferredLiveEngine || activeSynthesisEngine;
  const synthBtnLabel =
    effectiveSynthEngine === 'OLLAMA'
      ? 'Ollama'
      : effectiveSynthEngine === 'GEMINI'
      ? 'Gemini'
      : 'Rules';

  return (
    <div className="fixed inset-0 pointer-events-none z-20 overflow-hidden">
      {/* =================================================================== */}
      {/* SLOT 0: PRECISION HOLOGRAM READER (Desktop Float / Mobile Sheet)    */}
      {/* =================================================================== */}
      <div
        ref={(el) => {
          slotRefs.current[0] = el;
          if (el && !el.style.transform && !isMobileViewport) {
            el.style.transform = 'translate3d(-9999px, -9999px, 0)';
          }
        }}
        onTouchStart={(e) => {
          if (!isMobileViewport) return;
          const scroller = e.currentTarget;
          if (scroller.scrollTop <= 6 && e.touches.length === 1) {
            sheetSwipeStartYRef.current = e.touches[0].clientY;
          } else {
            sheetSwipeStartYRef.current = null;
          }
        }}
        onTouchMove={(e) => {
          if (!isMobileViewport || sheetSwipeStartYRef.current === null) return;
          if (e.currentTarget.scrollTop > 6) {
            sheetSwipeStartYRef.current = null;
            return;
          }
          const deltaY = e.touches[0].clientY - sheetSwipeStartYRef.current;
          if (deltaY > 68) {
            sheetSwipeStartYRef.current = null;
            onCloseFocused();
          }
        }}
        onTouchEnd={() => {
          sheetSwipeStartYRef.current = null;
        }}
        style={
          isMobileViewport
            ? {
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 0,
                willChange: 'transform, opacity',
                opacity: focusedSignal ? 1 : 0,
                pointerEvents: focusedSignal ? 'auto' : 'none',
                transform: focusedSignal ? 'translate3d(0, 0, 0)' : 'translate3d(0, 108%, 0)',
              }
            : {
                position: 'fixed',
                top: 0,
                left: 0,
                willChange: 'transform, opacity',
                opacity: focusedSignal ? 1 : 0,
                pointerEvents: focusedSignal ? 'auto' : 'none',
              }
        }
        className={
          isMobileViewport
            ? 'w-full max-w-full max-h-[78dvh] overflow-y-auto overflow-x-hidden overscroll-contain cockpit-obsidian rounded-t-2xl rounded-b-none px-4 pt-2 pb-6 text-zinc-100 border-t border-white/15 shadow-[0_-16px_48px_rgba(0,0,0,0.82)] transition-all duration-200'
            : 'w-[432px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-178px)] overflow-y-auto overflow-x-hidden cockpit-obsidian rounded-xl p-3.5 text-zinc-100 transition-opacity duration-150'
        }
      >
        {focusedSignal && (() => {
          const sec = SECTOR_BY_ID[focusedSignal.primarySector];
          const synthKey = `${focusedSignal.id}-${activeClient}-${effectiveSynthEngine}`;
          const activeEngineKey = `${focusedSignal.id}-${activeClient}-${activeSynthesisEngine}`;
          const prewarmBankKey = `${focusedSignal.id}-BANKING-OLLAMA`;
          const isSynthesizingCard =
            inFlightGpuNodeSet.has(focusedSignal.id) ||
            synthesizingKey === synthKey ||
            synthesizingKey === activeEngineKey;
          const activeLevel: LiteracyLevel =
            bubbleLevels[focusedSignal.id] ?? globalLiteracyLevel;
          const levelMeta =
            LITERACY_LEVELS.find((l) => l.level === activeLevel) || LITERACY_LEVELS[2];

          const hydratedQuotes = persistentHydratedQuotesMap.get(focusedSignal.id);
          const effectiveSignal: SpatialSignal =
            hydratedQuotes && hydratedQuotes.length > 0
              ? { ...focusedSignal, streetQuotes: hydratedQuotes }
              : focusedSignal;

          const cachedGpuLit =
            (!userLockedRules
              ? persistentGpuLiteracyMap.get(activeEngineKey) ||
                persistentGpuLiteracyMap.get(synthKey) ||
                persistentGpuLiteracyMap.get(prewarmBankKey) ||
                persistentGpuLiteracyMap.get(focusedSignal.id)
              : undefined);

          const baseDetLit = buildDeterministicLiteracyPayload(effectiveSignal, activeClient);
          const rawLit: LiteracySpectrumPayload = cachedGpuLit
            ? hydratedQuotes &&
              hydratedQuotes.length > 0 &&
              /awaiting|loading top engineer/i.test(cachedGpuLit.levels[5].streetConsensus)
              ? {
                  ...cachedGpuLit,
                  levels: {
                    ...cachedGpuLit.levels,
                    5: {
                      ...cachedGpuLit.levels[5],
                      streetConsensus: baseDetLit.levels[5].streetConsensus,
                    },
                  },
                }
              : cachedGpuLit
            : baseDetLit;
          // Guarantee zero Markdown pipe soup and clean "a"/"an" grammar on L1/L2 across both Rules and GPU synthesis
          const lit = sanitizeLiteracyPayloadPlainLevels(rawLit);

          const cleanHeadline = stripSignalOriginPrefix(effectiveSignal);

          const originBadge =
            effectiveSignal.originFeedName ||
            (effectiveSignal.isDemoSeed ? '72h Seed' : effectiveSignal.source);
          const quotes = effectiveSignal.streetQuotes || [];
          const div = computeDivergenceMetrics(
            quotes,
            effectiveSignal.title,
            effectiveSignal.rawAbstract,
            effectiveSignal.engagementVelocity
          );
          const isModelOrLabRelease =
            isAuthenticModelEntity(effectiveSignal) || effectiveSignal.source === 'LabRelease';
          const isCommunityExperiment =
            effectiveSignal.source === 'Reddit' ||
            effectiveSignal.source === 'HackerNews' ||
            effectiveSignal.source === 'Bluesky' ||
            effectiveSignal.source === 'Discord';
          const isResearchPaper =
            effectiveSignal.source === 'arXiv' || effectiveSignal.source === 'HuggingFace';
          const l5HeaderPrimary = isModelOrLabRelease
            ? 'Architecture & Weights'
            : isCommunityExperiment
            ? 'Experiment & Method'
            : isResearchPaper
            ? 'Methodology & Formulation'
            : 'System Design & Implementation';
          const l5HeaderSecondary = isModelOrLabRelease
            ? 'Specs, Latency & Caveats'
            : isCommunityExperiment
            ? 'Observed Failure Mode & Limits'
            : isResearchPaper
            ? 'Empirical Results & Limits'
            : 'Runtime Constraints & Caveats';
          // Strict Single-Hero Rule: at most ONE primary visual hero header per card, strictly prioritizing the primary signal's own media!
          const rawRealMedia = (focusedSignal.mediaItems || []).filter(
            (m) => m.type !== 'chart' && !m.url.startsWith('data:image/svg+xml')
          );
          const clientGhOg =
            rawRealMedia.length === 0 ? deriveClientGitHubOgImage(focusedSignal.url) : null;
          const candidateMedia =
            rawRealMedia.length > 0
              ? rawRealMedia.slice(0, 1)
              : clientGhOg
              ? [
                  {
                    type: 'image' as const,
                    url: clientGhOg,
                    caption: 'GitHub Repository Card',
                    sourceNetwork: 'GitHub',
                  },
                ]
              : [];
          const validMedia = candidateMedia.filter((m) => !brokenMediaUrls[m.url]);
          const primaryHeaderMedia = validMedia[0] || null;

          const verifiedMetrics = extractVerifiedPostMetrics(focusedSignal);
          const distinctQuoteNets = Array.from(new Set(quotes.map((q) => q.network)));
          const hasRealCrossPlatformQuotes =
            !focusedSignal.isDemoSeed && distinctQuoteNets.length >= 2;
          const distinctSourceCount = Math.max(
            focusedSignal.networkFamilies?.length || 0,
            focusedSignal.sourceProvenance?.length || 0,
            1
          );
          const isMultiSource = focusedSignal.isSupernova || distinctSourceCount >= 2;
          const isPlainBubble = activeLevel <= 2 && !showCrossfire;
          const focusedTerm = activeGlossaryTerm || lit.glossary[0] || null;

          return (
            <div className="space-y-3">
              {/* Mobile Swipe-Down Grabber Pill */}
              {isMobileViewport && (
                <div className="flex justify-center pt-0.5 pb-1">
                  <span className="h-1 w-10 rounded-full bg-zinc-600/80" />
                </div>
              )}

              {/* 90s Stories Briefing Autopilot Bar */}
              {briefingBar && (
                <div className="cockpit-well px-2.5 py-1.5 rounded-lg border border-teal-400/35 bg-teal-500/[0.06] flex flex-wrap items-center justify-between gap-1.5 font-mono text-[10px] tabular-nums">
                  <div className="flex items-center gap-1.5 text-teal-200 font-semibold">
                    <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" />
                    <span>
                      Briefing {briefingBar.step + 1} of {briefingBar.total}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {briefingBar.speechSupported && (
                      <button
                        type="button"
                        onClick={briefingBar.onToggleListen}
                        title="Toggle spoken narration using Web Speech API"
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded border cursor-pointer min-h-[28px] transition-colors ${
                          briefingBar.listenEnabled
                            ? 'bg-teal-500/22 border-teal-400/55 text-teal-100 font-semibold'
                            : 'bg-zinc-900 hover:bg-zinc-800 border-white/10 text-zinc-300'
                        }`}
                      >
                        {briefingBar.listenEnabled ? (
                          <Volume2 className="w-3 h-3 text-teal-300" />
                        ) : (
                          <VolumeX className="w-3 h-3 text-zinc-400" />
                        )}
                        <span>Listen</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={briefingBar.onPrev}
                      title="Previous Breakthrough (Left Arrow)"
                      className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-zinc-200 cursor-pointer min-h-[28px]"
                    >
                      <ChevronLeft className="w-3 h-3" />
                      <span>Prev</span>
                    </button>
                    <button
                      type="button"
                      onClick={briefingBar.onTogglePause}
                      title="Pause or Resume Auto-Advance (Spacebar)"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-teal-400/35 text-teal-200 cursor-pointer min-h-[28px]"
                    >
                      {briefingBar.paused ? (
                        <>
                          <Play className="w-2.5 h-2.5 fill-current" />
                          <span>Paused</span>
                        </>
                      ) : (
                        <>
                          <Pause className="w-2.5 h-2.5" />
                          <span>Auto {briefingBar.remainingSec}s</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={briefingBar.onNext}
                      title="Next Breakthrough (Right Arrow)"
                      className="inline-flex items-center gap-0.5 px-1.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-zinc-200 cursor-pointer min-h-[28px]"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={briefingBar.onExit}
                      title="Exit Planetarium Briefing (Esc)"
                      className="inline-flex items-center px-1.5 py-1 rounded bg-zinc-900 hover:bg-rose-500/20 border border-white/10 hover:border-rose-400/40 text-zinc-400 hover:text-rose-200 cursor-pointer min-h-[28px]"
                    >
                      Exit
                    </button>
                  </div>
                </div>
              )}

              {/* Row 1: Sector Dot + Supernova Tag + Honest Provenance & Third-Party Link + Close */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <span className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-zinc-900 border border-white/10 text-[10px] font-mono font-medium text-zinc-200">
                    <span
                      style={{ backgroundColor: sec.colorHex }}
                      className="h-1.5 w-1.5 rounded-full shrink-0"
                    />
                    <span>{activeLevel === 1 ? sec.name : sec.code}</span>
                  </span>

                  {focusedSignal.isSupernova && (
                    <span
                      title={`Corroborated across ${focusedSignal.networkFamilies?.length || 2} independent networks. ${THIRD_PARTY_SOURCE_DISCLAIMER}`}
                      className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-amber-500/15 border border-amber-400/35 text-amber-200 tabular-nums"
                    >
                      {activeLevel === 1
                        ? 'Multi-Source'
                        : `Multi-Source · ${focusedSignal.networkFamilies?.length || 2} Nets`}
                    </span>
                  )}

                  {!focusedSignal.isSupernova && (
                    <span
                      title={
                        isMultiSource
                          ? `Corroborated across ${distinctSourceCount} linked third-party sources. ${THIRD_PARTY_SOURCE_DISCLAIMER}`
                          : `Single linked upstream source. ${THIRD_PARTY_SOURCE_DISCLAIMER}`
                      }
                      className="px-1.5 py-0.5 text-[10px] font-mono font-medium rounded bg-zinc-900 border border-white/10 text-zinc-400 tabular-nums"
                    >
                      {isMultiSource ? 'Multi-Source' : 'Source-Linked'}
                    </span>
                  )}

                  <a
                    href={focusedSignal.url}
                    target="_blank"
                    rel="noreferrer"
                    title={`Open linked third-party source: ${focusedSignal.url} — ${THIRD_PARTY_SOURCE_DISCLAIMER}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300 hover:text-teal-200 rounded bg-zinc-900/90 border border-white/10 hover:border-teal-400/40 transition-colors"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        focusedSignal.isDemoSeed ? 'bg-amber-400' : 'bg-teal-400'
                      }`}
                    />
                    <span className="truncate max-w-[165px]">{originBadge}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0 text-zinc-500" />
                  </a>
                </div>

                <button
                  type="button"
                  onClick={onCloseFocused}
                  className={`rounded-md hover:bg-zinc-800/80 text-zinc-400 hover:text-zinc-100 cursor-pointer shrink-0 flex items-center justify-center ${
                    isMobileViewport ? 'min-h-[44px] min-w-[44px] -mr-2' : 'p-1'
                  }`}
                  title="Close Reader (Esc)"
                >
                  <X className={isMobileViewport ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
                </button>
              </div>

              {/* Universal Visual Header: Real Scraped Visual (with Lightbox Zoom) OR 56px Deterministic SVG Strip */}
              {primaryHeaderMedia ? (
                <div className="cockpit-well relative rounded-lg overflow-hidden group">
                  {primaryHeaderMedia.type === 'video' ? (
                    <video
                      src={primaryHeaderMedia.url}
                      poster={primaryHeaderMedia.thumbnailUrl}
                      controls
                      muted
                      playsInline
                      preload="metadata"
                      onError={() =>
                        setBrokenMediaUrls((prev) => ({
                          ...prev,
                          [primaryHeaderMedia.url]: true,
                        }))
                      }
                      className="w-full max-h-36 object-contain bg-zinc-950"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setLightboxMedia({
                          url: primaryHeaderMedia.url,
                          caption: primaryHeaderMedia.caption || cleanHeadline,
                          sourceUrl: focusedSignal.url,
                        })
                      }
                      title="Click to inspect full-resolution figure in Lightbox"
                      className="relative block w-full text-left cursor-zoom-in"
                    >
                      <img
                        src={primaryHeaderMedia.url}
                        alt={primaryHeaderMedia.caption || cleanHeadline}
                        loading="eager"
                        referrerPolicy="no-referrer"
                        onLoad={(e) => {
                          if (
                            e.currentTarget.naturalWidth < 16 ||
                            e.currentTarget.naturalHeight < 16
                          ) {
                            setBrokenMediaUrls((prev) => ({
                              ...prev,
                              [primaryHeaderMedia.url]: true,
                            }));
                          }
                        }}
                        onError={() =>
                          setBrokenMediaUrls((prev) => ({
                            ...prev,
                            [primaryHeaderMedia.url]: true,
                          }))
                        }
                        className="w-full max-h-36 object-cover bg-zinc-950 transition-transform duration-200 group-hover:scale-[1.015]"
                      />
                      <span className="pointer-events-none absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-950/85 border border-white/15 font-mono text-[9px] text-zinc-200 opacity-85 group-hover:opacity-100 group-hover:border-teal-400/50 transition-opacity">
                        <ZoomIn className="w-2.5 h-2.5 text-teal-400" />
                        <span>Zoom</span>
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <DeterministicSvgDataHeader
                  signal={focusedSignal}
                  sectorColor={sec.colorHex}
                  sectorCode={sec.code}
                />
              )}

              {/* Row 2: Enterprise Metadata Strip + Headline */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono tabular-nums text-zinc-400">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900/80 border border-white/8 text-zinc-200">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        focusedSignal.readiness === 'GA'
                          ? 'bg-emerald-400'
                          : focusedSignal.readiness === 'PREVIEW'
                          ? 'bg-amber-400'
                          : 'bg-violet-400'
                      }`}
                    />
                    {isPlainBubble
                      ? focusedSignal.readiness === 'GA'
                        ? 'Ready Today'
                        : focusedSignal.readiness === 'PREVIEW'
                        ? 'Early Access'
                        : 'Lab Study'
                      : focusedSignal.readiness}
                  </span>

                  <span
                    className={`px-1.5 py-0.5 rounded border ${
                      focusedSignal.risk === 'HIGH'
                        ? 'border-rose-400/35 bg-rose-500/12 text-rose-200'
                        : 'border-white/8 bg-zinc-900/80 text-zinc-300'
                    }`}
                  >
                    {isPlainBubble
                      ? focusedSignal.risk === 'HIGH'
                        ? 'Safety Review'
                        : focusedSignal.risk === 'MODERATE'
                        ? 'Human Check'
                        : 'Standard Safe'
                      : `${focusedSignal.risk} RISK`}
                  </span>

                  <span className="px-1.5 py-0.5 rounded border border-white/8 bg-zinc-900/80 text-zinc-300">
                    {isPlainBubble
                      ? focusedSignal.finOps === 'REDUCER'
                        ? 'Lowers Bills'
                        : focusedSignal.finOps === 'INTENSIVE'
                        ? 'Heavy Compute'
                        : 'Standard Cost'
                      : focusedSignal.finOps === 'REDUCER'
                      ? 'OPEX REDUCER'
                      : focusedSignal.finOps === 'INTENSIVE'
                      ? 'COMPUTE HEAVY'
                      : 'FINOPS NEUTRAL'}
                  </span>

                  {hasAuthenticEngagementVelocity(focusedSignal) && activeLevel >= 2 && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/8 bg-zinc-900/80 text-teal-300 tabular-nums">
                      <Activity className="w-2.5 h-2.5" />
                      {cleanVelocityText(focusedSignal.engagementVelocity!.badgeText)}
                    </span>
                  )}
                </div>

                <h3 className="cockpit-heading text-[14.5px] font-semibold leading-[1.35] text-zinc-100">
                  {isPlainBubble ? lit.plainFullTitle : cleanHeadline}
                </h3>
              </div>

              {/* =============================================================== */}
              {/* PRECISION-MACHINED SEGMENTED L1 -> L5 SCRUBBER TRACK            */}
              {/* =============================================================== */}
              <div
                className={
                  isMobileViewport
                    ? 'sticky top-0 z-20 -mx-4 px-4 py-2 bg-[#09090B]/95 backdrop-blur-md border-y border-white/10 space-y-1.5'
                    : 'space-y-1.5 pt-2 border-t border-white/8'
                }
              >
                <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                  <span className="text-zinc-300 font-medium truncate min-w-0">
                    {showCrossfire
                      ? `Street Crossfire · ${quotes.length} Quotes`
                      : `${levelMeta.code} · ${levelMeta.persona}`}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isMobileViewport && <Kbd>1–5</Kbd>}
                    <button
                      type="button"
                      onClick={() => setShowCrossfire((v) => !v)}
                      className={`inline-flex items-center gap-1 px-2 rounded-[5px] border text-[10px] tabular-nums cursor-pointer transition-colors ${
                        isMobileViewport ? 'min-h-[34px]' : 'py-0.5'
                      } ${
                        showCrossfire
                          ? 'bg-teal-500/18 border-teal-400/45 text-teal-200 font-medium'
                          : 'bg-zinc-900 border-white/10 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      <MessageSquare className="w-2.5 h-2.5" />
                      <span>Crossfire ({quotes.length})</span>
                    </button>
                  </div>
                </div>

                {/* Draggable & Clickable 5-Segment Track with Smooth Sliding Indicator */}
                <div
                  ref={trackRef}
                  role="slider"
                  aria-label="Literacy Level Scrubber"
                  aria-valuemin={1}
                  aria-valuemax={5}
                  aria-valuenow={activeLevel}
                  tabIndex={0}
                  onPointerDown={(e) => {
                    isDraggingTrackRef.current = true;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    scrubLevelFromPointer(e.clientX, focusedSignal.id);
                  }}
                  onPointerMove={(e) => {
                    if (isDraggingTrackRef.current) {
                      scrubLevelFromPointer(e.clientX, focusedSignal.id);
                    }
                  }}
                  onPointerUp={() => {
                    isDraggingTrackRef.current = false;
                  }}
                  className="cockpit-well relative grid grid-cols-5 p-0.5 rounded-lg cursor-ew-resize touch-none"
                >
                  {!showCrossfire && (
                    <div
                      aria-hidden="true"
                      style={{
                        width: 'calc((100% - 4px) / 5)',
                        transform: `translate3d(${(activeLevel - 1) * 100}%, 0, 0)`,
                      }}
                      className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-[6px] bg-zinc-800/95 border border-teal-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] transition-transform duration-150 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    />
                  )}

                  {LITERACY_LEVELS.map((lvl) => {
                    const active = !showCrossfire && activeLevel === lvl.level;
                    return (
                      <button
                        key={lvl.level}
                        type="button"
                        onClick={() => {
                          setSignalLiteracyLevel(focusedSignal.id, lvl.level);
                        }}
                        className={`relative z-10 px-1 rounded-[6px] font-mono tabular-nums flex flex-col items-center justify-center leading-tight transition-colors duration-100 cursor-pointer ${
                          isMobileViewport ? 'min-h-[44px]' : 'py-1'
                        } ${
                          active ? 'text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        <span className={`text-[10.5px] ${active ? 'text-teal-300' : ''}`}>
                          {lvl.level}
                        </span>
                        <span className="text-[8.5px] tracking-tight truncate max-w-full">
                          {LENS_SHORT_LABELS[lvl.level]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* =============================================================== */}
              {/* 1. ZERO-LATENCY <16ms LITERACY EXPLANATION FIRST (L1/L2 Clean!) */}
              {/* =============================================================== */}
              <div
                key={showCrossfire ? 'crossfire' : `lvl-${activeLevel}`}
                className="transition-opacity duration-75 ease-out"
              >
                {showCrossfire ? (
                  <div className="space-y-2">
                    {div && (
                      <p className="text-[11.5px] text-zinc-400 leading-relaxed">{div.summary}</p>
                    )}
                    <div className="cockpit-well rounded-lg divide-y divide-white/6 max-h-52 overflow-y-auto">
                      {quotes.map((q) => (
                        <div key={q.id} className="p-2.5 space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums">
                            <span className="text-zinc-200 font-medium truncate">
                              <span className="text-teal-300">{q.originLabel}</span> · {q.author}
                            </span>
                            <span className="text-zinc-400 shrink-0">
                              +{q.score} · {q.sentiment}
                            </span>
                          </div>
                          <p className="text-[12px] text-zinc-300 leading-[1.5] max-w-[65ch]">
                            “{q.text}”
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : activeLevel === 1 ? (
                  /* L1 — EVERYDAY ANALOGY (Crystal-Clear Left Rule + Everyday Impact) */
                  <div className="space-y-2.5">
                    <div className="border-l-2 border-teal-400/80 pl-3 py-0.5 space-y-1">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-teal-300">
                        Everyday Analogy · Zero Technical Jargon
                      </div>
                      <p className="text-[12.5px] text-zinc-100 leading-[1.6] max-w-[65ch]">
                        {lit.levels[1].analogy}
                      </p>
                    </div>
                    <div className="cockpit-well p-2.5 rounded-lg space-y-0.5">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 block">
                        Why this matters in everyday life
                      </span>
                      <p className="text-[12px] text-zinc-200 leading-[1.5] max-w-[65ch]">
                        {lit.levels[1].everydayWhy}
                      </p>
                    </div>
                  </div>
                ) : activeLevel === 2 ? (
                  /* L2 — PLAIN ENGLISH (Clean Hairline-Divided 3-Part Breakdown) */
                  <div className="cockpit-well rounded-lg divide-y divide-white/6 text-[12px] leading-[1.55]">
                    <div className="p-2.5 space-y-0.5">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 block">
                        What Happened
                      </span>
                      <p className="text-zinc-100 max-w-[65ch]">{lit.levels[2].whatHappened}</p>
                    </div>
                    <div className="p-2.5 space-y-0.5">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 block">
                        Who Built It
                      </span>
                      <p className="text-zinc-200 max-w-[65ch]">{lit.levels[2].whoBuiltIt}</p>
                    </div>
                    <div className="p-2.5 space-y-0.5">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-teal-300 block">
                        Problem Solved
                      </span>
                      <p className="text-zinc-100 max-w-[65ch]">{lit.levels[2].problemSolved}</p>
                    </div>
                  </div>
                ) : activeLevel === 3 ? (
                  /* L3 — BUILDER BRIDGE (Inline Dotted Glossary Pills + Hover Definition Card) */
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                        <span className="inline-flex items-center gap-1 text-zinc-300">
                          <BookOpen className="w-3 h-3 text-teal-400" />
                          Concept & Jargon Bridge
                        </span>
                        <span>Hover or tap dotted terms</span>
                      </div>
                      <div className="text-[12.5px] text-zinc-200 leading-[1.6] max-w-[65ch]">
                        {renderTextWithGlossaryPills(
                          lit.levels[3].bridgeSummary,
                          lit.glossary,
                          focusedTerm,
                          setActiveGlossaryTerm
                        )}
                      </div>
                    </div>

                    {lit.glossary.length > 0 && (
                      <div className="cockpit-well p-2.5 rounded-lg space-y-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-mono text-[9.5px] uppercase tracking-wider text-zinc-500 mr-1">
                            Glossary
                          </span>
                          {lit.glossary.map((g) => {
                            const isSel =
                              focusedTerm?.term.toLowerCase() === g.term.toLowerCase();
                            return (
                              <button
                                key={g.term}
                                type="button"
                                onMouseEnter={() => setActiveGlossaryTerm(g)}
                                onClick={() => setActiveGlossaryTerm(g)}
                                className={`px-1.5 py-0.5 rounded-[4px] font-mono text-[10px] border-b border-dotted transition-colors cursor-help ${
                                  isSel
                                    ? 'bg-teal-500/20 text-teal-100 border-teal-300 font-medium'
                                    : 'bg-zinc-900 text-zinc-300 border-zinc-600 hover:text-teal-200 hover:border-teal-400/70'
                                }`}
                              >
                                {g.term}
                              </button>
                            );
                          })}
                        </div>
                        {focusedTerm && (
                          <div className="pt-1.5 border-t border-white/6 text-[11.5px] text-zinc-200 leading-[1.5]">
                            <span className="font-mono font-semibold text-teal-300">
                              {focusedTerm.term}:
                            </span>{' '}
                            {focusedTerm.definition}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : activeLevel === 4 ? (
                  /* L4 — CONSULTANT ROI & EXECUTIVE STRATEGY */
                  <div className="cockpit-well rounded-lg divide-y divide-white/6 text-[12px] leading-[1.55]">
                    <div className="p-2.5 space-y-0.5">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 block">
                        Enterprise ROI & FinOps Impact
                      </span>
                      <p className="text-zinc-100 max-w-[65ch]">{lit.levels[4].roiAndFinOps}</p>
                    </div>
                    <div className="p-2.5 space-y-0.5">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 block">
                        Production Readiness & Governance Risk
                      </span>
                      <p className="text-zinc-300 max-w-[65ch]">{lit.levels[4].readinessAndRisk}</p>
                    </div>
                    <div className="p-2.5 space-y-0.5 bg-teal-500/[0.04]">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-teal-300 block">
                        Client Advisory · {clientMeta.label}
                      </span>
                      <p className="text-zinc-100 max-w-[65ch]">
                        {liveSynthesisText[synthKey] || lit.levels[4].clientAdvice}
                      </p>
                    </div>
                  </div>
                ) : (
                  /* L5 — FRONTIER PRO / BARE METAL MONOSPACE SPEC BLOCKS */
                  <div className="space-y-2">
                    <div className="cockpit-well rounded-lg divide-y divide-white/6 font-mono text-[10.5px] leading-[1.55] tabular-nums">
                      <div className="p-2.5 space-y-0.5">
                        <span className="text-[9.5px] uppercase tracking-wider text-zinc-500 block">
                          {l5HeaderPrimary}
                        </span>
                        <p className="text-zinc-200">{lit.levels[5].architectureBrief}</p>
                      </div>
                      <div className="p-2.5 space-y-0.5">
                        <span className="text-[9.5px] uppercase tracking-wider text-teal-400 block">
                          {l5HeaderSecondary}
                        </span>
                        <p className="text-zinc-100">{lit.levels[5].specsAndCaveats}</p>
                      </div>
                      <div className="p-2.5 space-y-0.5">
                        <span className="text-[9.5px] uppercase tracking-wider text-zinc-400 block">
                          Community Consensus ({originBadge})
                        </span>
                        <p className="text-zinc-300">{lit.levels[5].streetConsensus}</p>
                      </div>
                    </div>
                    {focusedSignal.codeSnippet && (
                      <pre className="cockpit-well p-2.5 rounded-lg font-mono text-[10px] text-teal-200 overflow-x-auto whitespace-pre-wrap">
                        {focusedSignal.codeSnippet}
                      </pre>
                    )}
                  </div>
                )}
              </div>

              {/* =============================================================== */}
              {/* 2. REPORTED POST METRICS & DIVERGENCE (Tucked into L4-L5 Only!) */}
              {/* =============================================================== */}
              {!showCrossfire && activeLevel >= 4 && verifiedMetrics.length > 0 && (
                <div className="cockpit-well rounded-lg p-2.5 space-y-2 font-mono text-[10px] tabular-nums">
                  <div className="flex items-center justify-between gap-2 text-[9.5px] uppercase tracking-wider text-zinc-400">
                    <span title={THIRD_PARTY_SOURCE_DISCLAIMER}>Extracted Post Telemetry</span>
                    {hasRealCrossPlatformQuotes && (
                      <span title={THIRD_PARTY_SOURCE_DISCLAIMER} className="text-teal-300 shrink-0">
                        Multi-Source · {distinctQuoteNets.join(' + ')}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {verifiedMetrics.map((vm) => (
                      <div key={vm.label} className="space-y-1">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                          <span className="text-zinc-300 truncate">{vm.label}</span>
                          <span className="text-teal-300 font-semibold shrink-0 whitespace-nowrap">
                            {vm.valueText}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-zinc-900 overflow-hidden">
                          <div
                            style={{ width: `${vm.barPct}%` }}
                            className="h-full rounded-full bg-teal-400"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {div &&
                ((activeLevel >= 4 && hasSubstantiveCommunityEngagement(focusedSignal)) ||
                  showCrossfire) && (
                <div className="cockpit-well px-2.5 py-2 rounded-lg space-y-1.5 font-mono text-[10px] tabular-nums">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                    <span className="text-zinc-400 truncate">
                      HYPE <span className="text-zinc-200 font-semibold">{div.hypeScore}</span> ·
                      STREET <span className="text-teal-300 font-semibold">{div.streetScore}</span>
                    </span>
                    <span
                      title={THIRD_PARTY_SOURCE_DISCLAIMER}
                      className={`px-1.5 py-0.2 rounded-[4px] border text-[9.5px] font-medium shrink-0 whitespace-nowrap ${
                        div.verdictLabel === 'HYPE > REALITY'
                          ? 'bg-rose-500/12 text-rose-300 border-rose-400/30'
                          : 'bg-teal-500/12 text-teal-300 border-teal-400/30'
                      }`}
                    >
                      {formatVerdictDisplayLabel(div.verdictLabel)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="h-1 rounded-full bg-zinc-900 overflow-hidden">
                      <div
                        style={{ width: `${div.hypeScore}%` }}
                        className="h-full bg-zinc-400"
                      />
                    </div>
                    <div className="h-1 rounded-full bg-zinc-900 overflow-hidden">
                      <div
                        style={{ width: `${div.streetScore}%` }}
                        className="h-full bg-teal-400"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Affected Enterprise Stacks (L3-L5, Domain-Inferred — Zero Enum Leaks) */}
              {activeLevel >= 3 && !showCrossfire && (
                <div className="pt-2 border-t border-white/8">
                  <div className="flex items-center gap-1.5 text-[9.5px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">
                    <Layers className="w-3 h-3 text-zinc-400" />
                    <span>Affected Enterprise Stacks</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {inferDomainEnterpriseStacks(focusedSignal).map((st) => (
                      <span
                        key={st}
                        className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/8 text-[10px] font-mono text-zinc-300"
                      >
                        {st}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Footer: 30/60/90d Blast-Radius + Copy Memo + Single-Call 5-Level Brain */}
              <div className="pt-2 border-t border-white/8 flex flex-wrap items-center justify-between gap-1.5">
                <InstrumentButton
                  size="xs"
                  variant={blastHorizons ? 'danger' : 'accent'}
                  className={isMobileViewport ? 'min-h-[44px] px-3' : ''}
                  onClick={() => {
                    if (blastHorizons) {
                      onClearBlastRadiusWave();
                    } else {
                      onTriggerBlastRadiusWave();
                    }
                  }}
                >
                  <Orbit className="w-3 h-3" />
                  <span>{blastHorizons ? 'Clear 30/60/90d' : '30/60/90d Blast'}</span>
                </InstrumentButton>

                <div className="flex flex-wrap items-center gap-1.5">
                  <InstrumentButton
                    size="xs"
                    className={isMobileViewport ? 'min-h-[44px] px-3' : ''}
                    onClick={() => {
                      const activeBody =
                        activeLevel === 1
                          ? `${lit.levels[1].analogy} — ${lit.levels[1].everydayWhy}`
                          : activeLevel === 2
                          ? `${lit.levels[2].whatHappened} ${lit.levels[2].problemSolved}`
                          : activeLevel === 3
                          ? lit.levels[3].bridgeSummary
                          : activeLevel === 4
                          ? `${lit.levels[4].roiAndFinOps} | Advice: ${lit.levels[4].clientAdvice}`
                          : `${lit.levels[5].architectureBrief} | ${lit.levels[5].specsAndCaveats}`;
                      const memo = `*${isPlainBubble ? lit.plainFullTitle : cleanHeadline}* [L${activeLevel} ${levelMeta.shortName}]\n• ${activeBody}\n• *Source:* ${focusedSignal.url}`;
                      copyText(focusedSignal.id, memo);
                    }}
                  >
                    {copiedId === focusedSignal.id ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Memo</span>
                      </>
                    )}
                  </InstrumentButton>

                  <div className="relative">
                    <InstrumentButton
                      size="xs"
                      active={shareMenuOpen}
                      className={isMobileViewport ? 'min-h-[44px] px-3' : ''}
                      onClick={() => setShareMenuOpen((v) => !v)}
                      title="Share deep link (?orb=...&lens=...) or Download 1200x630 PNG Summary Card"
                    >
                      <Share2 className="w-3 h-3 text-teal-400" />
                      <span>
                        {linkCopiedId === focusedSignal.id
                          ? 'Link Copied'
                          : sharedPngId === focusedSignal.id
                          ? 'PNG Saved'
                          : 'Share'}
                      </span>
                    </InstrumentButton>

                    {shareMenuOpen && (
                      <div className="cockpit-obsidian absolute bottom-full right-0 mb-1.5 w-52 rounded-lg p-1.5 border border-white/15 shadow-2xl z-30 space-y-1 font-mono text-[10.5px]">
                        <button
                          type="button"
                          onClick={() => {
                            const url = buildCortexDeepLinkUrl(focusedSignal.id, activeLevel);
                            void navigator.clipboard?.writeText(url);
                            setLinkCopiedId(focusedSignal.id);
                            setTimeout(
                              () =>
                                setLinkCopiedId((prev) =>
                                  prev === focusedSignal.id ? null : prev
                                ),
                              2000
                            );
                            setShareMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] text-zinc-200 cursor-pointer text-left"
                        >
                          <Link2 className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                          <span>Copy Deep Link</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const targetSigId = focusedSignal.id;
                            const displayHeadline = isPlainBubble
                              ? lit.plainFullTitle
                              : cleanHeadline;
                            void renderShareCardPngBlob({
                              signal: effectiveSignal,
                              cleanHeadline: displayHeadline,
                              literacy: lit,
                              activeLevel,
                            })
                              .then(({ blob, filename }) => {
                                const objUrl = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = objUrl;
                                a.download = filename;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                setTimeout(() => URL.revokeObjectURL(objUrl), 3500);
                                setSharedPngId(targetSigId);
                                setTimeout(
                                  () =>
                                    setSharedPngId((prev) =>
                                      prev === targetSigId ? null : prev
                                    ),
                                  2200
                                );
                              })
                              .catch(() => {});
                            setShareMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] text-zinc-200 cursor-pointer text-left"
                        >
                          <Download className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                          <span>Download Card (PNG)</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {!isStaticPublicMode && (
                    <InstrumentButton
                      size="xs"
                      variant={lit.generatedBy !== 'DETERMINISTIC' ? 'accent' : 'ghost'}
                      className={isMobileViewport ? 'min-h-[44px] px-3' : ''}
                      onClick={() => {
                        const targetGpuEngine: SynthesisEngineId =
                          activeSynthesisEngine === 'GEMINI' && Boolean(geminiApiKey)
                            ? 'GEMINI'
                            : 'OLLAMA';
                        const gpuKey = `${focusedSignal.id}-${activeClient}-${targetGpuEngine}`;
                        attemptedAutoSynthRef.current.delete(gpuKey);
                        void triggerTriEngine5LevelSynthesis(
                          gpuKey,
                          focusedSignal,
                          targetGpuEngine,
                          true
                        );
                      }}
                      title="Re-synthesize all 5 Literacy Levels (L1→L5) on GPU via Ollama (qwen2.5:7b)"
                    >
                      <RefreshCw
                        className={`w-3 h-3 text-teal-400 ${isSynthesizingCard ? 'animate-spin' : ''}`}
                      />
                      <span>
                        {isSynthesizingCard
                          ? 'Synthesizing GPU...'
                          : lit.generatedBy === 'OLLAMA'
                          ? '5L · Ollama · Re-Synthesize'
                          : lit.generatedBy === 'GEMINI'
                          ? '5L · Gemini · Re-Synthesize'
                          : 'Re-Synthesize with GPU'}
                      </span>
                    </InstrumentButton>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* =================================================================== */}
      {/* SLOT 1: BATTLECARD COMPARATOR / STRATEGIC SIGNAL COMPARISON         */}
      {/* =================================================================== */}
      <div
        ref={(el) => {
          slotRefs.current[1] = el;
          if (el && !el.style.transform) {
            el.style.transform = 'translate3d(-9999px, -9999px, 0)';
          }
        }}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          willChange: 'transform, opacity',
          opacity: modelA && modelB ? 1 : 0,
          pointerEvents: modelA && modelB ? 'auto' : 'none',
        }}
        className="w-[464px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-120px)] overflow-y-auto overflow-x-hidden cockpit-obsidian rounded-xl p-3.5 text-zinc-100 transition-opacity duration-150"
      >
        {modelA && modelB && (() => {
          const bothAreModels =
            isAuthenticModelEntity(modelA) && isAuthenticModelEntity(modelB);
          const titleA = formatCleanSignalTitle(modelA, 58);
          const titleB = formatCleanSignalTitle(modelB, 58);
          const originA = modelA.originFeedName || modelA.source;
          const originB = modelB.originFeedName || modelB.source;
          const secA = SECTOR_BY_ID[modelA.primarySector];
          const secB = SECTOR_BY_ID[modelB.primarySector];

          const litA =
            persistentGpuLiteracyMap.get(`${modelA.id}-${activeClient}-${activeSynthesisEngine}`) ||
            persistentGpuLiteracyMap.get(modelA.id) ||
            buildDeterministicLiteracyPayload(modelA, activeClient);
          const litB =
            persistentGpuLiteracyMap.get(`${modelB.id}-${activeClient}-${activeSynthesisEngine}`) ||
            persistentGpuLiteracyMap.get(modelB.id) ||
            buildDeterministicLiteracyPayload(modelB, activeClient);

          const inspectedSig = battlecardTab === 'BRIEF_B' ? modelB : modelA;
          const inspectedLit = battlecardTab === 'BRIEF_B' ? litB : litA;
          const inspectedLevelMeta =
            LITERACY_LEVELS.find((l) => l.level === battlecardBriefLevel) || LITERACY_LEVELS[2];
          const inspectedGlossaryTerm =
            activeGlossaryTerm || inspectedLit.glossary[0] || null;

          // Distinct nodeA vs. nodeB Routing Verdict when comparing two authentic models/engines
          let modelVerdict = '';
          if (bothAreModels) {
            const sa = modelA.modelSpecs!;
            const sb = modelB.modelSpecs!;
            const tier1 =
              sa.inputCostPer1M <= sb.inputCostPer1M
                ? { sig: modelA, spec: sa }
                : { sig: modelB, spec: sb };
            const tier2 =
              tier1.sig.id === modelA.id
                ? { sig: modelB, spec: sb }
                : { sig: modelA, spec: sa };

            if (tier1.spec.capabilities.reasoning >= tier2.spec.capabilities.reasoning) {
              modelVerdict = `For ${clientMeta.label}: ${tier1.spec.modelFamily} leads on both unit cost ($${tier1.spec.inputCostPer1M.toFixed(
                2
              )}/1M, ${tier1.spec.ttftMs}ms TTFT) and reasoning; retain ${tier2.spec.modelFamily} (${tier2.spec.license}) as secondary multi-vendor failover.`;
            } else {
              modelVerdict = `For ${clientMeta.label}: Route high-volume tier-1 traffic to ${tier1.spec.modelFamily} ($${tier1.spec.inputCostPer1M.toFixed(
                2
              )}/1M, ${tier1.spec.ttftMs}ms TTFT) and escalate complex reasoning turns to ${tier2.spec.modelFamily} (${tier2.spec.license}).`;
            }
          }

          // Strategic synthesis when comparing community/news/research/policy signals (zero fake metrics!)
          const urgentFirst =
            modelA.readiness === 'GA' && modelB.readiness !== 'GA'
              ? titleA
              : modelB.readiness === 'GA' && modelA.readiness !== 'GA'
              ? titleB
              : modelA.mass >= modelB.mass
              ? titleA
              : titleB;
          const secondaryTrack = urgentFirst === titleA ? titleB : titleA;
          const strategicTakeaway = `For ${clientMeta.label}: Prioritize "${urgentFirst}" for near-term ${secA.name.toLowerCase()} review while tracking "${secondaryTrack}" (${secB.code}) to align ${clientMeta.regulatoryFocus.split(',')[0]} guardrails.`;

          return (
            <div className="space-y-2.5">
              {/* Header with [Compare] + [Read L1-L5 Brief] Toggle + [Dissolve ESC] */}
              <div className="flex items-center justify-between gap-2 border-b border-white/8 pb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Swords className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                  <span className="text-[11px] font-mono font-semibold text-zinc-100 truncate">
                    {bothAreModels ? 'MODEL BATTLECARD' : 'STRATEGIC SIGNAL COMPARISON'}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <InstrumentButton
                    size="xs"
                    active={battlecardTab !== 'COMPARE'}
                    onClick={() =>
                      setBattlecardTab((prev) => (prev === 'COMPARE' ? 'BRIEF_A' : 'COMPARE'))
                    }
                    title="Inspect L1–L5 Universal Literacy Briefs without closing comparison"
                  >
                    <BookOpen className="w-3 h-3 text-teal-400" />
                    <span>{battlecardTab === 'COMPARE' ? 'Read L1–L5 Brief' : 'Back to Compare'}</span>
                  </InstrumentButton>

                  <InstrumentButton size="xs" onClick={onReleaseBattlecard}>
                    <span>Dissolve</span>
                    <Kbd>ESC</Kbd>
                  </InstrumentButton>
                </div>
              </div>

              {/* INLINE L1-L5 BRIEF INSPECTOR INSIDE BATTLECARD (No ESC required!) */}
              {battlecardTab !== 'COMPARE' ? (
                <div className="space-y-2.5">
                  {/* Switch between Collided Signal A and Signal B */}
                  <div className="cockpit-well grid grid-cols-2 p-0.5 rounded-lg font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={() => setBattlecardTab('BRIEF_A')}
                      className={`px-2 py-1 rounded-[6px] truncate cursor-pointer transition-colors ${
                        battlecardTab === 'BRIEF_A'
                          ? 'bg-zinc-800 text-teal-200 border border-teal-400/35 font-semibold'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      A · {titleA}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBattlecardTab('BRIEF_B')}
                      className={`px-2 py-1 rounded-[6px] truncate cursor-pointer transition-colors ${
                        battlecardTab === 'BRIEF_B'
                          ? 'bg-zinc-800 text-teal-200 border border-teal-400/35 font-semibold'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      B · {titleB}
                    </button>
                  </div>

                  {/* Inline L1 -> L5 Scrubber */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between font-mono text-[10px] text-zinc-400">
                      <span className="text-zinc-200 font-medium">
                        {inspectedLevelMeta.code} · {inspectedLevelMeta.persona}
                      </span>
                      <Kbd>1–5</Kbd>
                    </div>
                    <div className="cockpit-well relative grid grid-cols-5 p-0.5 rounded-lg">
                      <div
                        aria-hidden="true"
                        style={{
                          width: 'calc((100% - 4px) / 5)',
                          transform: `translate3d(${(battlecardBriefLevel - 1) * 100}%, 0, 0)`,
                        }}
                        className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-[6px] bg-zinc-800/95 border border-teal-400/40 transition-transform duration-150 ease-out"
                      />
                      {LITERACY_LEVELS.map((lvl) => {
                        const active = battlecardBriefLevel === lvl.level;
                        return (
                          <button
                            key={lvl.level}
                            type="button"
                            onClick={() => setBattlecardBriefLevel(lvl.level)}
                            className={`relative z-10 py-1 px-1 rounded-[6px] font-mono text-[10px] tabular-nums flex flex-col items-center leading-tight cursor-pointer ${
                              active ? 'text-zinc-100 font-semibold' : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            <span className={active ? 'text-teal-300' : ''}>{lvl.level}</span>
                            <span className="text-[8.5px]">
                              {LENS_SHORT_LABELS[lvl.level]}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="cockpit-heading text-[13px] font-semibold text-zinc-100 leading-snug">
                    {battlecardBriefLevel <= 2 ? inspectedLit.plainFullTitle : inspectedSig.title}
                  </div>

                  {battlecardBriefLevel === 1 ? (
                    <div className="space-y-2">
                      <div className="border-l-2 border-teal-400/80 pl-3 py-0.5 text-[12px] text-zinc-100 leading-[1.55]">
                        {inspectedLit.levels[1].analogy}
                      </div>
                      <div className="cockpit-well p-2 rounded-lg text-[11.5px] text-zinc-300">
                        <span className="font-mono text-[9.5px] uppercase text-zinc-400 block mb-0.5">
                          Why this matters in everyday life
                        </span>
                        {inspectedLit.levels[1].everydayWhy}
                      </div>
                    </div>
                  ) : battlecardBriefLevel === 2 ? (
                    <div className="cockpit-well rounded-lg divide-y divide-white/6 text-[11.5px] leading-[1.5]">
                      <div className="p-2">
                        <span className="font-mono text-[9.5px] uppercase text-zinc-400 block">
                          What Happened
                        </span>
                        <span className="text-zinc-100">{inspectedLit.levels[2].whatHappened}</span>
                      </div>
                      <div className="p-2">
                        <span className="font-mono text-[9.5px] uppercase text-teal-300 block">
                          Problem Solved
                        </span>
                        <span className="text-zinc-200">{inspectedLit.levels[2].problemSolved}</span>
                      </div>
                    </div>
                  ) : battlecardBriefLevel === 3 ? (
                    <div className="space-y-2">
                      <div className="text-[12px] text-zinc-200 leading-[1.55]">
                        {renderTextWithGlossaryPills(
                          inspectedLit.levels[3].bridgeSummary,
                          inspectedLit.glossary,
                          inspectedGlossaryTerm,
                          setActiveGlossaryTerm
                        )}
                      </div>
                      {inspectedGlossaryTerm && (
                        <div className="cockpit-well p-2 rounded-lg text-[11px] text-zinc-200">
                          <span className="font-mono font-semibold text-teal-300">
                            {inspectedGlossaryTerm.term}:
                          </span>{' '}
                          {inspectedGlossaryTerm.definition}
                        </div>
                      )}
                    </div>
                  ) : battlecardBriefLevel === 4 ? (
                    <div className="cockpit-well rounded-lg divide-y divide-white/6 text-[11.5px] leading-[1.5]">
                      <div className="p-2">
                        <span className="font-mono text-[9.5px] uppercase text-zinc-400 block">
                          ROI & Readiness
                        </span>
                        <span className="text-zinc-100">{inspectedLit.levels[4].roiAndFinOps}</span>
                      </div>
                      <div className="p-2">
                        <span className="font-mono text-[9.5px] uppercase text-teal-300 block">
                          Client Advisory · {clientMeta.shortLabel}
                        </span>
                        <span className="text-zinc-200">{inspectedLit.levels[4].clientAdvice}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="cockpit-well rounded-lg divide-y divide-white/6 font-mono text-[10.5px] leading-[1.5] tabular-nums">
                      <div className="p-2 text-zinc-200">{inspectedLit.levels[5].architectureBrief}</div>
                      <div className="p-2 text-teal-200">{inspectedLit.levels[5].specsAndCaveats}</div>
                      <div className="p-2 text-zinc-300">{inspectedLit.levels[5].streetConsensus}</div>
                    </div>
                  )}
                </div>
              ) : bothAreModels ? (
                /* MODE A: AUTHENTIC MODEL / ENGINE BENCHMARK BATTLECARD */
                (() => {
                  const sa = modelA.modelSpecs!;
                  const sb = modelB.modelSpecs!;
                  const ptsA = buildRadarPoints(
                    [
                      sa.capabilities.reasoning,
                      sa.capabilities.coding,
                      sa.capabilities.agenticToolUse,
                      sa.capabilities.governanceSafety,
                      sa.capabilities.costEfficiency,
                    ],
                    65,
                    62,
                    46
                  );
                  const ptsB = buildRadarPoints(
                    [
                      sb.capabilities.reasoning,
                      sb.capabilities.coding,
                      sb.capabilities.agenticToolUse,
                      sb.capabilities.governanceSafety,
                      sb.capabilities.costEfficiency,
                    ],
                    65,
                    62,
                    46
                  );

                  return (
                    <>
                      <div className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-5 flex justify-center">
                          <svg width="130" height="124" className="overflow-visible">
                            {[18, 32, 46].map((r) => (
                              <circle
                                key={r}
                                cx="65"
                                cy="62"
                                r={r}
                                fill="none"
                                stroke="rgba(255,255,255,0.12)"
                                strokeWidth="1"
                              />
                            ))}
                            <polygon
                              points={ptsA}
                              fill="rgba(45, 212, 191, 0.2)"
                              stroke="#2DD4BF"
                              strokeWidth="1.6"
                            />
                            <polygon
                              points={ptsB}
                              fill="rgba(244, 244, 245, 0.12)"
                              stroke="#A1A1AA"
                              strokeWidth="1.6"
                            />
                            <text x="65" y="10" textAnchor="middle" fill="#A1A1AA" fontSize="8" fontFamily="var(--font-mono)">
                              REASON
                            </text>
                            <text x="118" y="46" textAnchor="start" fill="#A1A1AA" fontSize="8" fontFamily="var(--font-mono)">
                              CODE
                            </text>
                            <text x="102" y="116" textAnchor="middle" fill="#A1A1AA" fontSize="8" fontFamily="var(--font-mono)">
                              AGENT
                            </text>
                            <text x="26" y="116" textAnchor="middle" fill="#A1A1AA" fontSize="8" fontFamily="var(--font-mono)">
                              GOV
                            </text>
                            <text x="10" y="46" textAnchor="end" fill="#A1A1AA" fontSize="8" fontFamily="var(--font-mono)">
                              FINOPS
                            </text>
                          </svg>
                        </div>

                        <div className="col-span-7 space-y-1.5 text-[11px] font-mono tabular-nums">
                          <div className="cockpit-well p-2 rounded-md border-l-2 border-l-teal-400">
                            <div className="text-zinc-100 font-semibold truncate">{sa.modelFamily}</div>
                            <div className="text-[10px] text-zinc-400 mt-0.5">
                              ${sa.inputCostPer1M}/${sa.outputCostPer1M} · {sa.contextWindowK}K ctx ·{' '}
                              {sa.ttftMs}ms · {sa.license}
                            </div>
                          </div>
                          <div className="cockpit-well p-2 rounded-md border-l-2 border-l-zinc-400">
                            <div className="text-zinc-200 font-semibold truncate">{sb.modelFamily}</div>
                            <div className="text-[10px] text-zinc-400 mt-0.5">
                              ${sb.inputCostPer1M}/${sb.outputCostPer1M} · {sb.contextWindowK}K ctx ·{' '}
                              {sb.ttftMs}ms · {sb.license}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="cockpit-well grid grid-cols-4 divide-x divide-white/8 text-center font-mono text-[10px] tabular-nums py-2 rounded-lg">
                        <div className="px-1">
                          <div className="text-zinc-500">CACHED /1M</div>
                          <div className="text-teal-300 mt-0.5">
                            ${sa.cachedCostPer1M} vs ${sb.cachedCostPer1M}
                          </div>
                        </div>
                        <div className="px-1">
                          <div className="text-zinc-500">SPEED</div>
                          <div className="text-zinc-100 mt-0.5">
                            {sa.tokensPerSec} vs {sb.tokensPerSec} t/s
                          </div>
                        </div>
                        <div className="px-1">
                          <div className="text-zinc-500">CONTEXT</div>
                          <div className="text-zinc-100 mt-0.5">
                            {sa.contextWindowK}K vs {sb.contextWindowK}K
                          </div>
                        </div>
                        <div className="px-1">
                          <div className="text-zinc-500">SWE-BENCH</div>
                          <div className="text-emerald-300 mt-0.5">
                            {sa.sweBenchVerified || '—'} vs {sb.sweBenchVerified || '—'}
                          </div>
                        </div>
                      </div>

                      <div className="cockpit-well p-2.5 rounded-lg text-[11.5px] text-zinc-200 leading-[1.5]">
                        <span className="font-mono text-[9.5px] uppercase tracking-wider text-teal-300 block mb-0.5">
                          Routing Verdict · {clientMeta.label}
                        </span>
                        {modelVerdict}
                      </div>

                      <div className="flex justify-end">
                        <InstrumentButton
                          size="xs"
                          variant="accent"
                          onClick={() =>
                            copyText(
                              'battlecard',
                              `### Model Battlecard: ${sa.modelFamily} vs. ${sb.modelFamily} (${clientMeta.label})\n- **${sa.modelFamily}**: $${sa.inputCostPer1M}/$${sa.outputCostPer1M} per 1M (cached $${sa.cachedCostPer1M}), ${sa.contextWindowK}K ctx, ${sa.tokensPerSec} tok/s, ${sa.license}\n- **${sb.modelFamily}**: $${sb.inputCostPer1M}/$${sb.outputCostPer1M} per 1M (cached $${sb.cachedCostPer1M}), ${sb.contextWindowK}K ctx, ${sb.tokensPerSec} tok/s, ${sb.license}\n- **Consultant Verdict**: ${modelVerdict}`
                            )
                          }
                        >
                          {copiedId === 'battlecard' ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span>Copied Markdown</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Export Battlecard MD</span>
                            </>
                          )}
                        </InstrumentButton>
                      </div>
                    </>
                  );
                })()
              ) : (
                /* MODE B: STRATEGIC SIGNAL COMPARISON (Zero Fabricated Token/Context Specs!) */
                <>
                  <div className="space-y-2">
                    <div className="cockpit-well p-2.5 rounded-lg border-l-2 border-l-teal-400 space-y-1">
                      <div className="flex items-center justify-between gap-2 font-mono text-[9.5px] text-zinc-400 tabular-nums">
                        <span className="text-teal-300 font-semibold">
                          SIGNAL A · {secA.code} · {originA}
                        </span>
                        <span>
                          {modelA.readiness} · {modelA.risk} RISK
                        </span>
                      </div>
                      <div className="cockpit-heading text-[12.5px] font-semibold text-zinc-100 leading-snug">
                        {titleA}
                      </div>
                      <p className="text-[11.5px] text-zinc-300 leading-[1.5]">
                        {litA.levels[2].whatHappened}
                      </p>
                    </div>

                    <div className="cockpit-well p-2.5 rounded-lg border-l-2 border-l-zinc-400 space-y-1">
                      <div className="flex items-center justify-between gap-2 font-mono text-[9.5px] text-zinc-400 tabular-nums">
                        <span className="text-zinc-200 font-semibold">
                          SIGNAL B · {secB.code} · {originB}
                        </span>
                        <span>
                          {modelB.readiness} · {modelB.risk} RISK
                        </span>
                      </div>
                      <div className="cockpit-heading text-[12.5px] font-semibold text-zinc-100 leading-snug">
                        {titleB}
                      </div>
                      <p className="text-[11.5px] text-zinc-300 leading-[1.5]">
                        {litB.levels[2].whatHappened}
                      </p>
                    </div>
                  </div>

                  {/* Authentic Community Sentiment & Urgency Matrix (Zero Invented Pricing/Context!) */}
                  <div className="cockpit-well grid grid-cols-2 divide-x divide-white/8 rounded-lg font-mono text-[10px] tabular-nums">
                    <div className="p-2 space-y-0.5">
                      <div className="text-zinc-500 uppercase">Sentiment A</div>
                      <div className="text-zinc-200">
                        {formatVerdictDisplayLabel(modelA.divergence?.verdictLabel)} ·{' '}
                        <span className="text-teal-300">
                          {modelA.divergence?.streetScore ?? 72}/100
                        </span>
                      </div>
                    </div>
                    <div className="p-2 space-y-0.5">
                      <div className="text-zinc-500 uppercase">Sentiment B</div>
                      <div className="text-zinc-200">
                        {formatVerdictDisplayLabel(modelB.divergence?.verdictLabel)} ·{' '}
                        <span className="text-teal-300">
                          {modelB.divergence?.streetScore ?? 72}/100
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="cockpit-well p-2.5 rounded-lg text-[11.5px] text-zinc-200 leading-[1.5]">
                    <span className="font-mono text-[9.5px] uppercase tracking-wider text-teal-300 block mb-0.5">
                      Combined Takeaway · {clientMeta.label}
                    </span>
                    {strategicTakeaway}
                  </div>

                  <div className="flex justify-end">
                    <InstrumentButton
                      size="xs"
                      variant="accent"
                      onClick={() =>
                        copyText(
                          'battlecard',
                          `### Strategic Signal Comparison (${clientMeta.label})\n- **Signal A (${originA} · ${secA.code}) — ${titleA}**: ${litA.levels[2].whatHappened}\n- **Signal B (${originB} · ${secB.code}) — ${titleB}**: ${litB.levels[2].whatHappened}\n- **Combined Takeaway**: ${strategicTakeaway}`
                        )
                      }
                    >
                      {copiedId === 'battlecard' ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>Copied Comparison</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Export Comparison MD</span>
                        </>
                      )}
                    </InstrumentButton>
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>

      {/* =================================================================== */}
      {/* SLOT 2: 60-SECOND STANDUP FUSION REACTOR (Core Drop / Shift+Lasso)  */}
      {/* =================================================================== */}
      <div
        ref={(el) => {
          slotRefs.current[2] = el;
          if (el && !el.style.transform) {
            el.style.transform = 'translate3d(-9999px, -9999px, 0)';
          }
        }}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          willChange: 'transform, opacity',
          opacity: standupFusion ? 1 : 0,
          pointerEvents: standupFusion ? 'auto' : 'none',
        }}
        className="w-[460px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-120px)] overflow-y-auto overflow-x-hidden cockpit-obsidian rounded-xl p-4 text-zinc-100 transition-opacity duration-150"
      >
        {standupFusion && (() => {
          const topSignals = standupFusion.signals.slice(0, 5);
          const standupKey = `standup-${activeClient}-${topSignals.map((s) => s.id).join('_')}`;
          const customStandup = liveSynthesisText[standupKey];

          const slackMarkdown = [
            `*60s AI Standup Brief — ${clientMeta.label} Lens* _(${standupFusion.originLabel})_`,
            ...topSignals.map(
              (s) =>
                `• *[${s.primarySector} | ${s.originFeedName || s.source}] ${s.shortLabel}:* ${
                  s.cSuiteBrief.industryLens[activeClient]
                } (<${s.url}|Source>)`
            ),
            `_Governance Anchor: ${clientMeta.regulatoryFocus}_`,
          ].join('\n');

          const execMemo = [
            `EXECUTIVE ADVISORY BRIEFING — ${clientMeta.label.toUpperCase()}`,
            `Regulatory & Risk Posture: ${clientMeta.regulatoryFocus}`,
            '',
            ...topSignals.map(
              (s, idx) =>
                `${idx + 1}. ${s.title} [${s.originFeedName || s.source} | ${s.readiness}]\n   Advisory Takeaway: ${
                  s.cSuiteBrief.headlineSoWhat
                }\n   Architecture Action: ${s.architectBrief.integrationPattern}\n   URL: ${s.url}`
            ),
          ].join('\n');

          return (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between border-b border-white/8 pb-2">
                <div className="flex items-center gap-1.5 text-xs font-mono font-semibold text-zinc-100">
                  <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                  <span>60s STANDUP BRIEF · {standupFusion.originLabel.toUpperCase()}</span>
                </div>
                <button
                  type="button"
                  onClick={onCloseStandup}
                  className="p-1 rounded-md hover:bg-zinc-800/80 text-zinc-500 hover:text-zinc-100 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="cockpit-well px-2.5 py-1.5 rounded-md font-mono text-[10.5px] text-zinc-300 tabular-nums">
                CLIENT LENS: <span className="text-teal-300">{clientMeta.label}</span> ·{' '}
                {topSignals.length} Signals Fused
              </div>

              {customStandup ? (
                <div className="cockpit-well p-3 rounded-lg text-xs text-zinc-200 whitespace-pre-line leading-relaxed max-h-[215px] overflow-y-auto">
                  {customStandup}
                </div>
              ) : (
                <div className="cockpit-well rounded-lg divide-y divide-white/6 max-h-[220px] overflow-y-auto">
                  {topSignals.map((sig) => {
                    const sec = SECTOR_BY_ID[sig.primarySector];
                    return (
                      <div key={sig.id} className="p-2.5 text-[11.5px] leading-[1.5]">
                        <div className="flex items-center justify-between font-mono text-[10px] mb-0.5">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-100">
                            <span
                              style={{ backgroundColor: sec.colorHex }}
                              className="h-1.5 w-1.5 rounded-full"
                            />
                            <span>
                              [{sec.code}] {sig.shortLabel}
                            </span>
                          </span>
                          <a
                            href={sig.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-teal-300 hover:underline"
                          >
                            {sig.originFeedName || sig.source}
                          </a>
                        </div>
                        <div className="text-zinc-300">
                          {sig.cSuiteBrief.industryLens[activeClient]}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="pt-2 border-t border-white/8 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <InstrumentButton
                    size="xs"
                    variant="accent"
                    onClick={() => copyText('standup-slack', slackMarkdown)}
                  >
                    {copiedId === 'standup-slack' ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Slack Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Slack MD</span>
                      </>
                    )}
                  </InstrumentButton>

                  <InstrumentButton
                    size="xs"
                    onClick={() => copyText('standup-exec', execMemo)}
                  >
                    {copiedId === 'standup-exec' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span>Memo Copied</span>
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="w-3 h-3" />
                        <span>Exec Memo</span>
                      </>
                    )}
                  </InstrumentButton>
                </div>

                <InstrumentButton
                  size="xs"
                  onClick={() =>
                    void triggerTriEngineRewrite(
                      standupKey,
                      `Synthesize a crisp 4-bullet 60-second morning standup briefing for a consultant advising a ${clientMeta.label} executive team based on these signals:\n${topSignals
                        .map((s) => `- ${s.title}: ${s.cSuiteBrief.headlineSoWhat}`)
                        .join('\n')}`
                    )
                  }
                >
                  <Sparkles className="w-3 h-3 text-teal-400" />
                  <span>
                    {synthesizingKey === standupKey ? 'Synthesizing...' : `${synthBtnLabel} Brief`}
                  </span>
                </InstrumentButton>
              </div>
            </div>
          );
        })()}
      </div>

      {/* =================================================================== */}
      {/* SLOTS 3, 4, 5: 30/60/90-DAY BLAST-RADIUS WAVE CARDS OR SATELLITES   */}
      {/* =================================================================== */}
      {[0, 1, 2].map((satSlot) => {
        const poolIdx = 3 + satSlot;
        const horizon = blastHorizons ? blastHorizons[satSlot] : null;
        const geminiKey = focusedSignal
          ? `${focusedSignal.id}-${activeClient}-${activeSynthesisEngine}`
          : '';
        const geminiOverride = geminiKey ? geminiBlastCache[geminiKey]?.[satSlot] : undefined;

        const sat = !horizon ? blastSatellites[satSlot] : null;
        const visible = Boolean(horizon || sat);

        return (
          <div
            key={poolIdx}
            ref={(el) => {
              slotRefs.current[poolIdx] = el;
              if (el && !el.style.transform) {
                el.style.transform = 'translate3d(-9999px, -9999px, 0)';
              }
            }}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              willChange: 'transform, opacity',
              opacity: visible ? 1 : 0,
              pointerEvents: visible ? 'auto' : 'none',
            }}
            onClick={() => {
              if (sat) onSelectSatellite(sat.nodeIndex);
            }}
            className={
              horizon
                ? 'w-[276px] max-w-[calc(100vw-32px)] cockpit-obsidian rounded-xl p-3 text-left transition-opacity duration-150'
                : 'w-[208px] max-w-[calc(100vw-32px)] cockpit-obsidian rounded-lg px-2.5 py-2 text-left cursor-pointer hover:border-teal-400/40 transition-opacity duration-150'
            }
          >
            {horizon && (() => {
              const sec = SECTOR_BY_ID[horizon.targetSector];
              return (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-1 font-mono text-[9.5px] tabular-nums">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-zinc-200">
                      <span
                        style={{ backgroundColor: sec.colorHex }}
                        className="h-1.5 w-1.5 rounded-full"
                      />
                      <span>{horizon.orderLabel}</span>
                    </span>
                    <span className="px-1.5 py-0.2 rounded bg-zinc-900 border border-white/10 text-zinc-300">
                      {sec.code}
                    </span>
                  </div>
                  <div className="cockpit-heading text-xs font-semibold text-zinc-100">
                    {geminiOverride?.title || horizon.title}
                  </div>
                  <p className="text-[11px] text-zinc-300 leading-[1.45]">
                    {geminiOverride?.consequence || horizon.consequence}
                  </p>
                  <div className="pt-1.5 border-t border-white/8 text-[10px] font-mono text-teal-300 leading-snug">
                    {geminiOverride?.consultantAction || horizon.consultantAction}
                  </div>
                  <div className="text-[9.5px] font-mono text-zinc-400 tabular-nums">
                    {geminiOverride?.kpiMetric || horizon.kpiMetric}
                  </div>
                </div>
              );
            })()}

            {!horizon && sat && (() => {
              const sec = SECTOR_BY_ID[sat.signal.primarySector];
              return (
                <div className="space-y-0.5">
                  <div className="flex items-center justify-between text-[9.5px] font-mono">
                    <span className="inline-flex items-center gap-1 font-medium text-zinc-300">
                      <span
                        style={{ backgroundColor: sec.colorHex }}
                        className="h-1.5 w-1.5 rounded-full"
                      />
                      <span>CAUSAL · {sec.code}</span>
                    </span>
                    <span className="text-zinc-500">{sat.signal.readiness}</span>
                  </div>
                  <div className="cockpit-heading text-[11px] font-semibold text-zinc-100 truncate">
                    {sat.signal.shortLabel}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })}

      {/* =================================================================== */}
      {/* FULL-SCREEN SMOKED-OBSIDIAN LIGHTBOX ZOOM MODAL                     */}
      {/* =================================================================== */}
      {lightboxMedia && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Signal Figure Lightbox"
          onClick={() => setLightboxMedia(null)}
          className="fixed inset-0 z-50 pointer-events-auto bg-black/88 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="cockpit-obsidian max-w-5xl w-full max-h-[88dvh] rounded-xl p-3 flex flex-col gap-2.5 border border-white/15 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 px-1">
              <div className="min-w-0 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-teal-400 shrink-0" />
                <span className="cockpit-heading text-xs font-semibold text-zinc-100 truncate">
                  {lightboxMedia.caption || 'Upstream Visual Evidence'}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {lightboxMedia.sourceUrl && (
                  <a
                    href={lightboxMedia.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-900 border border-white/10 font-mono text-[10px] text-zinc-300 hover:text-teal-300 hover:border-teal-400/40"
                  >
                    <span>Source</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setLightboxMedia(null)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/10 font-mono text-[10px] text-zinc-300 hover:text-zinc-100 cursor-pointer"
                >
                  <span>Close</span>
                  <Kbd>Esc</Kbd>
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex items-center justify-center bg-zinc-950/90 rounded-lg overflow-hidden p-2 border border-white/8">
              <img
                src={lightboxMedia.url}
                alt={lightboxMedia.caption || 'Expanded figure'}
                className="max-w-full max-h-[76dvh] object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
