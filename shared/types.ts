export type SectorId = 'REL' | 'SCI' | 'ARC' | 'INN' | 'GOV' | 'CRT' | 'ECO' | 'MKT';

export type ClientIndustry = 'BANKING' | 'HEALTHCARE' | 'RETAIL' | 'FINOPS' | 'PUBLIC' | 'SAAS';

export type ReadinessState = 'GA' | 'PREVIEW' | 'RESEARCH';
export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH';
export type FinOpsImpact = 'REDUCER' | 'NEUTRAL' | 'INTENSIVE';

export type SourceCategory =
  | 'RESEARCH'
  | 'VIP_VOICE'
  | 'SOCIAL_BLUESKY'
  | 'REDDIT'
  | 'AI_LAB'
  | 'GH_RELEASE'
  | 'HN_COMMUNITY'
  | 'X_BRIDGE'
  | 'X_PLAYWRIGHT'
  | 'DISCORD_RELAY'
  | 'DEMO_SEED';

export type AdapterId = 'x_playwright' | 'discord_relay' | 'reddit_street';

export type LiteracyLevel = 1 | 2 | 3 | 4 | 5;

export interface LiteracyLevelMeta {
  level: LiteracyLevel;
  code: `L${LiteracyLevel}`;
  shortName: string;
  persona: string;
  accentHex: string;
}

export const LITERACY_LEVELS: LiteracyLevelMeta[] = [
  {
    level: 1,
    code: 'L1',
    shortName: 'Zero-Jargon',
    persona: 'Absolute Beginner · Everyday Analogy',
    accentHex: '#34D399',
  },
  {
    level: 2,
    code: 'L2',
    shortName: 'Plain English',
    persona: 'Curious Newcomer · Clear Outcome',
    accentHex: '#38BDF8',
  },
  {
    level: 3,
    code: 'L3',
    shortName: 'Builder Bridge',
    persona: 'Upskilling Builder · Interactive Glossary',
    accentHex: '#A78BFA',
  },
  {
    level: 4,
    code: 'L4',
    shortName: 'Consultant ROI',
    persona: 'AI Strategist · FinOps, Risk & Advisory',
    accentHex: '#FBBF24',
  },
  {
    level: 5,
    code: 'L5',
    shortName: 'Frontier Pro',
    persona: 'Bare Metal · Architecture, Specs & Street',
    accentHex: '#F43F5E',
  },
];

export interface GlossaryTerm {
  term: string;
  definition: string;
}

export interface LiteracySpectrumPayload {
  plainTitle: string;
  plainFullTitle: string;
  levels: {
    1: {
      analogy: string;
      everydayWhy: string;
    };
    2: {
      whatHappened: string;
      whoBuiltIt: string;
      problemSolved: string;
    };
    3: {
      bridgeSummary: string;
    };
    4: {
      roiAndFinOps: string;
      readinessAndRisk: string;
      clientAdvice: string;
    };
    5: {
      architectureBrief: string;
      specsAndCaveats: string;
      streetConsensus: string;
    };
  };
  glossary: GlossaryTerm[];
  generatedBy?: SynthesisEngineId;
}

export type AdapterRunState =
  | 'ACTIVE'
  | 'READY_FOR_CREDENTIALS'
  | 'CONNECTING'
  | 'PAUSED'
  | 'ERROR';

export interface AdapterTelemetryStatus {
  id: AdapterId;
  name: string;
  subtitle: string;
  costBadge: string;
  enabled: boolean;
  state: AdapterRunState;
  signalsFetched: number;
  avgLatencyMs: number;
  lastLatencyMs: number;
  mediaCount: number;
  lastPollMs: number;
  lastError: string | null;
  hasCredentials: boolean;
  credentialSummary: string;
  queryInfo: string;
}

export type SynthesisEngineId = 'OLLAMA' | 'GEMINI' | 'DETERMINISTIC';

export interface SynthesisEngineStatus {
  activeEngine: SynthesisEngineId;
  ollama: {
    online: boolean;
    endpoint: string;
    models: string[];
    selectedModel: string;
    vramSafeCtx: number;
    lastTokensPerSec: number;
    lastLatencyMs: number;
    errorHint?: string;
  };
  gemini: {
    configured: boolean;
    model: string;
    lastTokensPerSec: number;
    lastLatencyMs: number;
  };
  deterministic: {
    ready: boolean;
    lastLatencyMs: number;
  };
}

export interface MediaAttachment {
  type: 'image' | 'video' | 'chart';
  url: string;
  thumbnailUrl?: string;
  caption?: string;
  sourceNetwork?: string;
}

export interface StreetQuote {
  id: string;
  network: 'X' | 'Reddit' | 'Discord' | 'GitHub' | 'HackerNews' | 'Bluesky';
  originLabel: string; // e.g. "r/LocalLLaMA", "@karpathy", "#announcements · vLLM Discord"
  author: string;
  text: string;
  score: number;
  sentiment: 'HYPE' | 'VERIFIED' | 'SKEPTICAL';
  publishedAtMs: number;
  url?: string;
}

export interface DivergenceMetrics {
  hypeScore: number; // 0..100 (X / launch excitement)
  streetScore: number; // 0..100 (Reddit / Discord engineer benchmark reality)
  divergenceDelta: number; // hypeScore - streetScore (+ = Hype > Reality, - = Quiet Sleeper Gem)
  verdictLabel: 'STREET VERIFIED' | 'HYPE > REALITY' | 'SLEEPER GEM' | 'CONSENSUS';
  summary: string;
}

export interface DefconAnomalyEvent {
  id: string;
  entityKey: string;
  entityLabel: string;
  signalId: string;
  platforms: string[];
  detectedAtMs: number;
  divergenceSummary: string;
}

export interface UpstreamFeedHealth {
  id: string;
  name: string;
  category: Exclude<SourceCategory, 'DEMO_SEED'>;
  url: string;
  status: 'ONLINE' | 'FAST_FAIL' | 'IDLE';
  latencyMs: number;
  itemCount: number;
  lastCheckedMs: number;
  errorHint?: string;
}

export interface BlastOrderConsequence {
  horizon: '30D' | '60D' | '90D';
  orderLabel: string;
  title: string;
  targetSector: SectorId;
  consequence: string;
  consultantAction: string;
  kpiMetric: string;
}

export interface SectorMeta {
  id: SectorId;
  index: number;
  code: SectorId;
  name: string;
  subtitle: string;
  colorHex: string;
  rgb: [number, number, number];
  orbitAngleRad: number;
  orbitRadius: number;
  harmonicFreqHz: number;
}

export const SECTORS: SectorMeta[] = [
  {
    id: 'REL',
    index: 0,
    code: 'REL',
    name: 'Releases & Frontier',
    subtitle: 'Foundation models, open-weights drops & multimodal APIs',
    colorHex: '#00F0FF',
    rgb: [0.0, 0.94, 1.0],
    orbitAngleRad: 0,
    orbitRadius: 495,
    harmonicFreqHz: 523.25, // C5
  },
  {
    id: 'SCI',
    index: 1,
    code: 'SCI',
    name: 'Science & Research',
    subtitle: 'arXiv breakthroughs, reasoning math & interpretability',
    colorHex: '#A855F7',
    rgb: [0.66, 0.33, 0.97],
    orbitAngleRad: Math.PI * 0.25,
    orbitRadius: 515,
    harmonicFreqHz: 587.33, // D5
  },
  {
    id: 'ARC',
    index: 2,
    code: 'ARC',
    name: 'Architecture & Infra',
    subtitle: 'Agentic stacks, MCP gateways, inference engines & silicon',
    colorHex: '#3B82F6',
    rgb: [0.23, 0.51, 0.96],
    orbitAngleRad: Math.PI * 0.5,
    orbitRadius: 480,
    harmonicFreqHz: 392.0, // G4
  },
  {
    id: 'INN',
    index: 3,
    code: 'INN',
    name: 'Innovation & ROI',
    subtitle: 'Production enterprise deployments & vertical case studies',
    colorHex: '#F59E0B',
    rgb: [0.96, 0.62, 0.04],
    orbitAngleRad: Math.PI * 0.75,
    orbitRadius: 515,
    harmonicFreqHz: 440.0, // A4
  },
  {
    id: 'GOV',
    index: 4,
    code: 'GOV',
    name: 'Governance & Security',
    subtitle: 'EU AI Act, NIST RMF, ISO 42001 & adversarial red-teaming',
    colorHex: '#F43F5E',
    rgb: [0.96, 0.25, 0.37],
    orbitAngleRad: Math.PI,
    orbitRadius: 495,
    harmonicFreqHz: 293.66, // D4
  },
  {
    id: 'CRT',
    index: 5,
    code: 'CRT',
    name: 'Certifications & Labs',
    subtitle: 'Hyperscaler credentials, architect labs & mastery tracks',
    colorHex: '#10B981',
    rgb: [0.06, 0.73, 0.51],
    orbitAngleRad: Math.PI * 1.25,
    orbitRadius: 510,
    harmonicFreqHz: 493.88, // B4
  },
  {
    id: 'ECO',
    index: 6,
    code: 'ECO',
    name: 'Economics & FinOps',
    subtitle: 'Token pricing curves, TTFT benchmarks & routing matrices',
    colorHex: '#14B8A6',
    rgb: [0.08, 0.72, 0.65],
    orbitAngleRad: Math.PI * 1.5,
    orbitRadius: 480,
    harmonicFreqHz: 369.99, // F#4
  },
  {
    id: 'MKT',
    index: 7,
    code: 'MKT',
    name: 'Market & Strategy',
    subtitle: 'Sovereign compute alliances, M&A & enterprise shifts',
    colorHex: '#CBD5E1',
    rgb: [0.8, 0.84, 0.88],
    orbitAngleRad: Math.PI * 1.75,
    orbitRadius: 515,
    harmonicFreqHz: 329.63, // E4
  },
];

export const SECTOR_BY_ID: Record<SectorId, SectorMeta> = Object.fromEntries(
  SECTORS.map((s) => [s.id, s])
) as Record<SectorId, SectorMeta>;

export interface ClientIndustryMeta {
  id: ClientIndustry;
  label: string;
  shortLabel: string;
  regulatoryFocus: string;
  prioritySectors: SectorId[];
}

export const CLIENT_INDUSTRIES: ClientIndustryMeta[] = [
  {
    id: 'BANKING',
    label: 'Banking & FinServ',
    shortLabel: 'FinServ',
    regulatoryFocus: 'SR 11-7 Model Risk, PCI-DSS, SOC2, Zero Data Retention',
    prioritySectors: ['GOV', 'ECO', 'ARC', 'INN'],
  },
  {
    id: 'HEALTHCARE',
    label: 'Healthcare & Bio',
    shortLabel: 'Health',
    regulatoryFocus: 'HIPAA BAA, FDA SaMD Clinical Auditability, Hallucination Guardrails',
    prioritySectors: ['SCI', 'GOV', 'INN', 'REL'],
  },
  {
    id: 'FINOPS',
    label: 'Cloud FinOps & Platform',
    shortLabel: 'FinOps',
    regulatoryFocus: 'Unit Token Economics, Prompt Caching, vLLM Self-Host Crossover',
    prioritySectors: ['ECO', 'ARC', 'REL', 'CRT'],
  },
  {
    id: 'RETAIL',
    label: 'Retail & Commerce',
    shortLabel: 'Retail',
    regulatoryFocus: 'Sub-250ms Multimodal UX, Catalog Scale, Margin Protection',
    prioritySectors: ['INN', 'REL', 'ECO', 'MKT'],
  },
  {
    id: 'PUBLIC',
    label: 'Public Sector & Sovereign',
    shortLabel: 'Public',
    regulatoryFocus: 'FedRAMP High, EU AI Act Compliance, Air-Gapped Open-Weights',
    prioritySectors: ['GOV', 'REL', 'CRT', 'MKT'],
  },
  {
    id: 'SAAS',
    label: 'Enterprise B2B SaaS',
    shortLabel: 'B2B SaaS',
    regulatoryFocus: 'Multi-Tenant MCP Security, Agentic Reliability, Gross Margin >75%',
    prioritySectors: ['ARC', 'REL', 'ECO', 'INN'],
  },
];

export interface ModelSpecs {
  modelFamily: string;
  provider: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  cachedCostPer1M: number;
  contextWindowK: number;
  ttftMs: number;
  tokensPerSec: number;
  license: 'Apache-2.0' | 'MIT' | 'Open-Weights' | 'Proprietary';
  sweBenchVerified: number;
  capabilities: {
    reasoning: number;
    coding: number;
    agenticToolUse: number;
    governanceSafety: number;
    costEfficiency: number;
  };
}

export interface SpatialSignal {
  id: string;
  title: string;
  shortLabel: string;
  source:
    | 'arXiv'
    | 'HuggingFace'
    | 'GitHub'
    | 'HackerNews'
    | 'LabRelease'
    | 'Bluesky'
    | 'VIPBlog'
    | 'Reddit'
    | 'GHRelease'
    | 'XBridge'
    | 'XPlaywright'
    | 'Discord';
  sourceCategory?: SourceCategory;
  originFeedName?: string;
  isDemoSeed?: boolean;
  sourceProvenance: string[];
  networkFamilies?: string[];
  canonicalEntity?: string;
  isSupernova?: boolean;
  supernovaLevel?: number; // 0 = normal, 1 = 2-network Supernova, 2 = 3+ network DEFCON Supernova
  divergence?: DivergenceMetrics;
  mediaItems?: MediaAttachment[];
  streetQuotes?: StreetQuote[];
  codeSnippet?: string;
  engagementVelocity?: {
    likesOrUps: number;
    commentsOrReplies: number;
    velocityPerHour: number;
    badgeText: string;
  };
  literacy?: LiteracySpectrumPayload;
  url: string;
  publishedAtMs: number;
  isLiveInbound: boolean;
  primarySector: SectorId;
  secondarySectors: SectorId[];
  mass: number;
  readiness: ReadinessState;
  risk: RiskLevel;
  finOps: FinOpsImpact;
  rawAbstract: string;
  architectBrief: {
    summary: string;
    stackImpact: string[];
    integrationPattern: string;
    latencyAndCostNote: string;
  };
  cSuiteBrief: {
    headlineSoWhat: string;
    talkingPoints: string[];
    industryLens: Record<ClientIndustry, string>;
  };
  affectedEnterpriseStacks: string[];
  causalTargetIds?: string[];
  modelSpecs?: ModelSpecs;
}

export const OPTICAL_Y_OFFSET_PX = 12;

export const MAX_NODES = 512;
export const NODE_STRIDE = 16;
export const MAX_TETHERS = 1024;
export const TETHER_STRIDE = 10;
export const MAX_TRAIL_POINTS = 12;

export interface ShockwaveEvent {
  x: number;
  y: number;
  sectorIndex: number;
  intensity: number;
  createdAtPerfMs: number;
}

export type SemanticZoomBand = 'MACRO' | 'CSUITE' | 'ARCHITECT' | 'RAW';

export function getZoomBand(zoom: number): SemanticZoomBand {
  if (zoom < 0.65) return 'MACRO';
  if (zoom < 1.85) return 'CSUITE';
  if (zoom < 3.35) return 'ARCHITECT';
  return 'RAW';
}

export interface StaticGalaxySnapshot {
  version: 1;
  bakedAtIso: string;
  bakedAtMs: number;
  synthesizedBy: string;
  signalCount: number;
  signals: SpatialSignal[];
  literacyBySignalId: Record<string, LiteracySpectrumPayload>;
}
