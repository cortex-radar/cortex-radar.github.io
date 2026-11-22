import { stripHtmlMarkupAndEntities } from './literacyEngine';
import {
  EvidenceScope,
  SECTOR_BY_ID,
  SpatialSignal,
  SupportingSourceLink,
  VerifiedSourceMetric,
} from './types';

export function normalizeProvenanceUrl(url: string): string {
  return (url || '')
    .trim()
    .toLowerCase()
    .replace(/#.*$/, '')
    .replace(/\/+$/, '')
    .replace(/^https?:\/\/(www\.)?/, '');
}

/**
 * Classifies official labs, arXiv preprints, Hugging Face releases, and GitHub repositories as Primary Sources.
 * HN, Reddit, X, Bluesky, VIP blogs, and Discord are classified as Community / Commentary.
 */
export function isPrimarySourceSignal(
  sig: Pick<SpatialSignal, 'source' | 'sourceCategory' | 'url' | 'originFeedName'>
): boolean {
  if (
    sig.source === 'LabRelease' ||
    sig.source === 'arXiv' ||
    sig.source === 'HuggingFace' ||
    sig.source === 'GHRelease' ||
    sig.source === 'GitHub'
  ) {
    return true;
  }
  if (
    sig.sourceCategory === 'AI_LAB' ||
    sig.sourceCategory === 'RESEARCH' ||
    sig.sourceCategory === 'GH_RELEASE'
  ) {
    return true;
  }
  return false;
}

export function buildSupportingSourceEntry(
  sig: Pick<
    SpatialSignal,
    'originFeedName' | 'source' | 'sourceCategory' | 'title' | 'url' | 'publishedAtMs'
  >
): SupportingSourceLink {
  const validMs =
    typeof sig.publishedAtMs === 'number' && Number.isFinite(sig.publishedAtMs) && sig.publishedAtMs > 0
      ? sig.publishedAtMs
      : Date.now();
  return {
    source: sig.originFeedName || sig.source,
    title: stripHtmlMarkupAndEntities(sig.title || '').trim(),
    url: (sig.url || '').trim(),
    publishedAt: new Date(validMs).toISOString(),
    publishedAtMs: validMs,
    isPrimary: isPrimarySourceSignal(sig),
  };
}

export function getGroupedSourcesForSignal(sig: SpatialSignal): SupportingSourceLink[] {
  const seen = new Map<string, SupportingSourceLink>();

  const upsert = (entry: SupportingSourceLink) => {
    const cleanUrl = (entry.url || '').trim();
    if (!cleanUrl) return;
    const key = normalizeProvenanceUrl(cleanUrl);
    if (!key) return;
    const prev = seen.get(key);
    const parsedMs =
      typeof entry.publishedAtMs === 'number' && Number.isFinite(entry.publishedAtMs)
        ? entry.publishedAtMs
        : Date.parse(entry.publishedAt || '') || 0;
    const normalized: SupportingSourceLink = {
      source: entry.source || sig.originFeedName || sig.source,
      title: stripHtmlMarkupAndEntities(entry.title || sig.title || '').trim(),
      url: cleanUrl,
      publishedAt:
        entry.publishedAt || (parsedMs > 0 ? new Date(parsedMs).toISOString() : ''),
      publishedAtMs: parsedMs > 0 ? parsedMs : undefined,
      isPrimary: Boolean(entry.isPrimary),
    };
    if (!prev || (!prev.isPrimary && normalized.isPrimary)) {
      seen.set(key, normalized);
    }
  };

  upsert(buildSupportingSourceEntry(sig));
  for (const sup of sig.supportingSources || []) {
    if (sup) upsert(sup);
  }

  return Array.from(seen.values()).sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    const ta = a.publishedAtMs ?? (Date.parse(a.publishedAt) || 0);
    const tb = b.publishedAtMs ?? (Date.parse(b.publishedAt) || 0);
    return tb - ta;
  });
}

export function getIndependentSourceCount(sig: SpatialSignal): number {
  return analyzeClusterCoverage(sig).independentPublisherCount;
}

export function getEventLastUpdatedMs(sig: SpatialSignal): number {
  let latest =
    typeof sig.publishedAtMs === 'number' && Number.isFinite(sig.publishedAtMs) && sig.publishedAtMs > 0
      ? sig.publishedAtMs
      : 0;
  if (
    typeof sig.lastUpdatedAtMs === 'number' &&
    Number.isFinite(sig.lastUpdatedAtMs) &&
    sig.lastUpdatedAtMs > latest
  ) {
    latest = sig.lastUpdatedAtMs;
  }
  for (const sup of sig.supportingSources || []) {
    const t =
      typeof sup.publishedAtMs === 'number' && Number.isFinite(sup.publishedAtMs)
        ? sup.publishedAtMs
        : Date.parse(sup.publishedAt || '') || 0;
    if (t > latest) latest = t;
  }
  return latest || sig.publishedAtMs;
}

const UTC_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

export function formatUtcTimestamp(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) {
    return 'Timestamp unavailable';
  }
  return `${UTC_FORMATTER.format(new Date(ms))} UTC`;
}

export function truncateAtWordBoundary(text: string, maxChars: number): string {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned || maxChars <= 1) return cleaned;
  if (cleaned.length <= maxChars) return cleaned;

  const slice = cleaned.slice(0, maxChars - 1);
  const lastSpaceIdx = slice.lastIndexOf(' ');
  const trimmed =
    lastSpaceIdx >= Math.floor((maxChars - 1) * 0.45)
      ? slice.slice(0, lastSpaceIdx)
      : slice;
  const cleanEnd = trimmed.replace(/[,;:\-–—(\s]+$/g, '').trim();
  return cleanEnd ? `${cleanEnd}…` : `${slice.trim()}…`;
}

const NON_TOOL_NEWS_MARKET_REGEX =
  /\b(ipo|initial public offering|underwriters?|nasdaq|nyse|stock markets?|share price|valuation|funding|series [a-f]|acquisition|acquires|antitrust|lawsuit|4th amendment|court|ruling|protesters?|bailout|fbi|senate|congress|regulation|eu ai act|debate|who['’]s next|came for the coders|gtm|arr|sell-off)\b/i;

const EXPLICIT_TOOL_RELEASE_REGEX =
  /\b(introducing|announcing|releasing|are out|v\d+\.\d+|api|sdk|cli|weights|models?|qwen[-\s]?\d|gpt[-\s]?\d|claude[-\s]?\d|gemini[-\s]?\d|open[- ]source|github|framework|runtime|server)\b/i;

export function isNonToolNewsOrMarketSignal(
  sig: Pick<SpatialSignal, 'title' | 'primarySector' | 'source' | 'sourceCategory' | 'url'> &
    Partial<Pick<SpatialSignal, 'rawAbstract'>>
): boolean {
  if (
    sig.source === 'GHRelease' ||
    sig.source === 'GitHub' ||
    sig.source === 'arXiv' ||
    sig.source === 'HuggingFace'
  ) {
    return false;
  }
  const title = sig.title || '';
  if (NON_TOOL_NEWS_MARKET_REGEX.test(title)) {
    return true;
  }
  if (isEvaluationQualityStudy({ title, rawAbstract: sig.rawAbstract || '' })) {
    return false;
  }
  if (
    (sig.primarySector === 'ECO' ||
      sig.primarySector === 'MKT' ||
      sig.primarySector === 'GOV') &&
    !EXPLICIT_TOOL_RELEASE_REGEX.test(title)
  ) {
    return true;
  }
  return false;
}

export function extractVerbatimSourceExcerpt(sig: SpatialSignal): string {
  const cleanTitle = stripHtmlMarkupAndEntities(sig.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const isRel =
    sig.source === 'GHRelease' ||
    /github\.com\/[^/\s]+\/[^/\s]+\/releases\/tag\//i.test(sig.url || '');
  const sanitizedInput = isRel
    ? sanitizeReleaseNotesText(sig.rawAbstract || '', sig.title).cleanText
    : stripUiChromeBoilerplate(sig.rawAbstract || '');

  const cleanedRaw = stripHtmlMarkupAndEntities(sanitizedInput)
    .replace(/^\s*\|[^\n]*\|(?:\s*\n\s*\|[^\n]*\|)*/gm, ' ')
    .replace(/\bQuoted context:\s*/gi, 'Quoted: ')
    .replace(/\s*Reference:\s*https?:\/\/\S+/gi, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanedRaw || cleanedRaw.length < 24) return '';

  const normRaw = cleanedRaw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !normRaw ||
    normRaw === cleanTitle ||
    (cleanTitle.length > 20 &&
      normRaw.startsWith(cleanTitle) &&
      normRaw.length <= cleanTitle.length + 12)
  ) {
    return '';
  }

  // Strip duplicated leading title prefix if rawAbstract starts verbatim with the headline
  let excerpt = cleanedRaw;
  const rawHeadline = stripHtmlMarkupAndEntities(sig.title || '')
    .replace(/[\u2026.]+$/, '')
    .trim();
  if (rawHeadline.length >= 20 && excerpt.toLowerCase().startsWith(rawHeadline.toLowerCase())) {
    const stripped = excerpt.slice(rawHeadline.length).replace(/^[\s.:—–-]+/, '').trim();
    if (stripped.length >= 28) excerpt = stripped;
  }

  return truncateAtWordBoundary(excerpt, 240);
}

const TITLE_HEDGE_CLAIM_REGEX =
  /\b(may have been|might have been|could have been|may solve|might solve|could solve|may mark|claims? (?:to|it|they)|claimed to|purports?|reportedly|allegedly|rumou?r(?:ed|s)?|unverified|unconfirmed|if true|not yet verified|awaiting verification|speculated?)\b/i;

const ABSTRACT_HEDGE_CLAIM_REGEX =
  /\b(may have been|might have been|could have been|claims? to have|purports?|reportedly|allegedly|unverified\s+(?:claim|manuscript|proof|report|result|solution|breakthrough)|unconfirmed|rumou?r(?:ed)?|if true|not yet verified|not independently verified|awaiting peer review)\b/i;

/**
 * Returns true when the source headline or abstract frames the claim with hedged, speculative,
 * or unverified language so downstream L1-L5 synthesis never upgrades it into a settled fact.
 */
export function isHedgedOrUnverifiedClaim(
  sig: Pick<SpatialSignal, 'title'> & Partial<Pick<SpatialSignal, 'rawAbstract'>>
): boolean {
  const title = sig.title || '';
  // Scan only the lead 280 chars of rawAbstract so trailing "Related Stories" website footers
  // cannot falsely classify an unrelated engineering/product report as hedged.
  const leadAbstract = (sig.rawAbstract || '').slice(0, 280);
  return TITLE_HEDGE_CLAIM_REGEX.test(title) || ABSTRACT_HEDGE_CLAIM_REGEX.test(leadAbstract);
}

const CONCRETE_TECH_SPEC_REGEX =
  /\b(api|apis|sdk|cli|weights|open[- ]source|open[- ]weights|benchmark|context window|tokens?\/s|tok\/s|latency|throughput|vram|tpu|cuda|rocm|cpu|cpus|asic|fpga|silicon|rtl|superscalar|in-order|interaction nets|performance[- ]per[- ]watt|perf[- ]per[- ]watt|accelerator|instruction set|isa\b|gguf|fp8|fp16|int4|int8|quantiz(?:ed|ation)|fine-tun(?:e|ing|ed)|distill(?:ed|ation)|kv cache|mixture of experts|moe\b|mcp\b|tool[- ]calling|function calling|json schema|oauth|docker|kubernetes|helm|wasm|rust|python|typescript|pip install|npm install|brew install|v\d+\.\d+\.\d+)\b|\b\d+(?:\.\d+)?[bm]\s*(?:params?|parameters?)\b|\bgithub\.com\/|\bhuggingface\.co\/|\barxiv\.org\/abs\//i;

/**
 * Returns true only when the upstream source is an inherently technical artifact (code release,
 * GitHub repo, HuggingFace model, arXiv paper, or concrete modelSpecs) or explicitly cites
 * verifiable engineering/API/architecture details in its source text.
 */
export function hasTechnicalEngineeringContent(
  sig: Pick<
    SpatialSignal,
    'title' | 'rawAbstract' | 'source' | 'sourceCategory' | 'primarySector' | 'url' | 'modelSpecs'
  >
): boolean {
  if (isNonToolNewsOrMarketSignal(sig)) {
    return false;
  }
  if (
    sig.source === 'GHRelease' ||
    sig.source === 'GitHub' ||
    sig.source === 'arXiv' ||
    sig.source === 'HuggingFace' ||
    Boolean(sig.modelSpecs) ||
    isEvaluationQualityStudy(sig)
  ) {
    return true;
  }
  const combined = `${sig.title || ''} ${sig.rawAbstract || ''}`;
  return CONCRETE_TECH_SPEC_REGEX.test(combined);
}

export type ReleaseChannel = 'stable' | 'rc' | 'alpha' | 'beta' | 'preview';

export interface ReleaseMetadata {
  owner: string;
  repo: string;
  productName: string;
  rawTag: string;
  versionLabel: string;
  displayTitle: string;
  channel: ReleaseChannel;
  stabilityLabel: string;
  isPreRelease: boolean;
}

const KNOWN_GITHUB_PRODUCT_NAMES: Record<string, string> = {
  'ollama/ollama': 'Ollama',
  'openai/codex': 'OpenAI Codex',
  'anthropics/claude-code': 'Claude Code',
  'vllm-project/vllm': 'vLLM',
  'langchain-ai/langchain': 'LangChain',
  'ggml-org/llama.cpp': 'llama.cpp',
  'ggerganov/llama.cpp': 'llama.cpp',
  'huggingface/transformers': 'Hugging Face Transformers',
  'modelcontextprotocol/servers': 'MCP Servers',
  'microsoft/playwright': 'Playwright',
};

function humanizeRepoSlug(repo: string): string {
  return (repo || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'ai') return 'AI';
      if (lower === 'llm') return 'LLM';
      if (lower === 'vllm') return 'vLLM';
      if (lower === 'cli') return 'CLI';
      if (lower === 'sdk') return 'SDK';
      if (lower === 'api') return 'API';
      if (lower === 'mcp') return 'MCP';
      if (lower === 'gpt') return 'GPT';
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function formatCleanReleaseVersion(tagOrTitle: string): string {
  const trimmed = (tagOrTitle || '').trim();
  const strippedPrefix = trimmed.replace(/^(?:rust|python|js|ts|go|node|cli)-v?/i, (m) =>
    m.toLowerCase().endsWith('v') ? 'v' : ''
  );
  if (/^v\d/i.test(strippedPrefix)) {
    return `v${strippedPrefix.slice(1)}`;
  }
  if (/^\d+\.\d+/.test(strippedPrefix)) {
    return `v${strippedPrefix}`;
  }
  return trimmed;
}

function classifyReleaseChannel(text: string): {
  channel: ReleaseChannel;
  stabilityLabel: string;
  isPreRelease: boolean;
} {
  if (/-(?:alpha|a\d+)(?:[.\-_]?\d+)?\b/i.test(text)) {
    return { channel: 'alpha', stabilityLabel: 'Alpha', isPreRelease: true };
  }
  if (/-(?:beta|b\d+)(?:[.\-_]?\d+)?\b/i.test(text)) {
    return { channel: 'beta', stabilityLabel: 'Beta', isPreRelease: true };
  }
  if (/-(?:rc)(?:[.\-_]?\d+)?\b/i.test(text)) {
    return { channel: 'rc', stabilityLabel: 'Release candidate', isPreRelease: true };
  }
  if (/-(?:preview|pre|dev|nightly|canary)(?:[.\-_]?\d+)?\b/i.test(text)) {
    return { channel: 'preview', stabilityLabel: 'Preview', isPreRelease: true };
  }
  return { channel: 'stable', stabilityLabel: 'Stable release', isPreRelease: false };
}

/**
 * Extracts normalized product name, version tag (preserving prerelease suffixes like -rc2/-alpha.1),
 * and stability channel from a GitHub release URL and title/tag. Returns null for non-release links.
 */
export function parseGitHubReleaseMetadata(
  titleOrTag: string,
  url: string,
  repoHint?: string
): ReleaseMetadata | null {
  const urlMatch = (url || '').match(
    /github\.com\/([^/\s]+)\/([^/\s]+)\/releases\/tag\/([^/?#\s]+)/i
  );
  const hintMatch = (repoHint || '').match(/([^/\s]+)\/([^/\s]+)/);
  if (!urlMatch && !hintMatch) return null;

  const owner = urlMatch ? urlMatch[1] : hintMatch![1];
  const repo = urlMatch ? urlMatch[2] : hintMatch![2];
  const repoKey = `${owner}/${repo}`.toLowerCase();
  const rawTagFromUrl = urlMatch ? decodeURIComponent(urlMatch[3]) : '';
  const cleanInputTitle = stripHtmlMarkupAndEntities(titleOrTag || '').trim();

  const productName = KNOWN_GITHUB_PRODUCT_NAMES[repoKey] || humanizeRepoSlug(repo);

  // Prefer the exact URL tag when the RSS <title> dropped a prefix or prerelease suffix (-rc2 / -alpha.1)
  const chosenTagSource =
    rawTagFromUrl && /\d+\.\d+/.test(rawTagFromUrl)
      ? rawTagFromUrl
      : cleanInputTitle.match(/(?:[a-z]+-)?v?\d+\.\d+[^\s]*/i)?.[0] || cleanInputTitle;

  const versionLabel = formatCleanReleaseVersion(chosenTagSource);
  const channelInfo = classifyReleaseChannel(`${rawTagFromUrl} ${cleanInputTitle}`);

  // Avoid doubling product name if cleanInputTitle already includes something richer with the full tag
  let displayTitle = versionLabel ? `${productName} ${versionLabel}` : productName;
  if (
    cleanInputTitle &&
    cleanInputTitle.toLowerCase().includes(productName.toLowerCase()) &&
    versionLabel &&
    cleanInputTitle.toLowerCase().includes(versionLabel.toLowerCase())
  ) {
    displayTitle = cleanInputTitle.replace(/\s+/g, ' ').trim();
  }

  return {
    owner,
    repo,
    productName,
    rawTag: rawTagFromUrl || chosenTagSource,
    versionLabel,
    displayTitle,
    ...channelInfo,
  };
}

export function getSignalReleaseMetadata(
  sig: Pick<SpatialSignal, 'title' | 'url' | 'source' | 'originFeedName' | 'canonicalEntity'>
): ReleaseMetadata | null {
  if (sig.source !== 'GHRelease' && !/github\.com\/[^/\s]+\/[^/\s]+\/releases\/tag\//i.test(sig.url || '')) {
    return null;
  }
  const repoHint =
    sig.originFeedName?.replace(/^gh\s*release\s*[·:-]?\s*/i, '').trim() ||
    sig.canonicalEntity ||
    undefined;
  return parseGitHubReleaseMetadata(sig.title || '', sig.url || '', repoHint);
}

const KNOWN_PUBLISHER_DISPLAY_BY_HOST: Record<string, string> = {
  'anthropic.com': 'Anthropic News',
  'architectlabs.com': 'Architect Labs',
  'openai.com': 'OpenAI',
  'deepmind.google': 'Google DeepMind',
  'blog.google': 'Google Blog',
  'ai.meta.com': 'Meta AI',
  'mistral.ai': 'Mistral AI',
  'qwenlm.github.io': 'Alibaba Qwen',
  'huggingface.co': 'Hugging Face',
  'arxiv.org': 'arXiv',
  'news.ycombinator.com': 'Hacker News',
  'reddit.com': 'Reddit',
  'old.reddit.com': 'Reddit',
  'bsky.app': 'Bluesky',
  'x.com': 'X',
  'twitter.com': 'X',
  'fxtwitter.com': 'X',
  'theguardian.com': 'The Guardian',
  'techpolicy.press': 'Tech Policy Press',
  'latent.space': 'Latent Space',
  'simonwillison.net': 'Simon Willison',
  'bloomberg.com': 'Bloomberg',
  'ft.com': 'Financial Times',
  'reuters.com': 'Reuters',
  'theverge.com': 'The Verge',
  'arstechnica.com': 'Ars Technica',
  'techcrunch.com': 'TechCrunch',
  'wired.com': 'Wired',
  'cnbc.com': 'CNBC',
  'nytimes.com': 'The New York Times',
  'wsj.com': 'The Wall Street Journal',
  'nature.com': 'Nature',
  'science.org': 'Science',
};

const AGGREGATOR_OR_DISCUSSION_HOSTS = new Set([
  'news.ycombinator.com',
  'reddit.com',
  'old.reddit.com',
  'bsky.app',
  'x.com',
  'twitter.com',
  'fxtwitter.com',
]);

function extractCleanHostname(url: string): string {
  try {
    const host = new URL((url || '').trim()).hostname.toLowerCase();
    return host.replace(/^(www|m|mobile)\./, '');
  } catch {
    return '';
  }
}

function titleCaseDomainLabel(host: string): string {
  const known = KNOWN_PUBLISHER_DISPLAY_BY_HOST[host];
  if (known) return known;
  const parts = host.split('.').filter(Boolean);
  const core = parts.length >= 2 ? parts[parts.length - 2] : parts[0] || 'Source';
  return core
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Normalizes same-company announcements and same-repository releases to one canonical publisher key
 * so multi-post announcements from a single entity cannot inflate corroboration counts.
 */
export function extractCanonicalPublisherKey(url: string, fallbackSource = ''): string {
  const host = extractCleanHostname(url);
  if (host === 'github.com') {
    const m = (url || '').match(/github\.com\/([^/\s]+)\/([^/\s]+)/i);
    if (m) return `github.com/${m[1].toLowerCase()}/${m[2].toLowerCase()}`;
    return 'github.com';
  }
  if (host === 'x.com' || host === 'twitter.com' || host === 'fxtwitter.com') {
    const handleMatch = (url || '').match(/(?:x|twitter|fxtwitter)\.com\/([^/\s?]+)/i);
    const handle = handleMatch?.[1]?.toLowerCase();
    if (handle && !['i', 'search', 'hashtag', 'intent', 'home'].includes(handle)) {
      return `x.com/${handle}`;
    }
    return 'x.com';
  }
  if (host === 'bsky.app') {
    const bskyMatch = (url || '').match(/bsky\.app\/profile\/([^/\s?]+)/i);
    if (bskyMatch?.[1]) return `bsky.app/${bskyMatch[1].toLowerCase()}`;
    return 'bsky.app';
  }
  if (host) {
    return host;
  }
  return (fallbackSource || 'unknown')
    .toLowerCase()
    .replace(/^(hn|reddit|vip|x)\s*·\s*/i, '')
    .trim();
}

export function extractPublisherDisplayName(
  entry: Pick<SupportingSourceLink, 'source' | 'title' | 'url'>
): string {
  const host = extractCleanHostname(entry.url || '');
  const relMeta = parseGitHubReleaseMetadata(entry.title || '', entry.url || '');
  if (relMeta) {
    return `GitHub · ${relMeta.productName}`;
  }
  if (host === 'github.com') {
    const m = (entry.url || '').match(/github\.com\/([^/\s]+)\/([^/\s]+)/i);
    if (m) return `GitHub · ${m[1]}/${m[2]}`;
  }
  if (host === 'x.com' || host === 'twitter.com' || host === 'fxtwitter.com') {
    const handleMatch = (entry.url || '').match(/(?:x|twitter|fxtwitter)\.com\/([^/\s?]+)/i);
    const handle = handleMatch?.[1];
    if (handle && !['i', 'search', 'hashtag', 'intent', 'home'].includes(handle.toLowerCase())) {
      return `X (@${handle})`;
    }
  }
  if (host === 'reddit.com' || host === 'old.reddit.com') {
    const subMatch = (entry.url || '').match(/\/r\/([A-Za-z0-9_]+)/i);
    return subMatch ? `Reddit · r/${subMatch[1]}` : 'Reddit';
  }

  const rawSource = (entry.source || '').trim();
  if (/^vip\s*·\s*/i.test(rawSource)) {
    return rawSource.replace(/^vip\s*·\s*/i, '').trim();
  }
  if (/^hn\s*·\s*/i.test(rawSource)) {
    if (host && host !== 'news.ycombinator.com') {
      return `${titleCaseDomainLabel(host)} (via HN)`;
    }
    return 'Hacker News';
  }
  if (host) {
    return KNOWN_PUBLISHER_DISPLAY_BY_HOST[host] || titleCaseDomainLabel(host);
  }
  return rawSource || 'Source';
}

export type SupportingLinkRole =
  | 'Primary'
  | 'Closing'
  | 'Pricing'
  | 'Filing'
  | 'Release candidate'
  | 'Alpha'
  | 'Beta'
  | 'Preview'
  | 'Release'
  | 'Paper'
  | 'Model weights'
  | 'Market reaction'
  | 'Discussion'
  | 'Commentary'
  | 'Related';

export function inferSupportingLinkRole(
  entry: Pick<SupportingSourceLink, 'source' | 'title' | 'url' | 'isPrimary'>,
  isCanonicalPrimary = false
): SupportingLinkRole {
  const relMeta = parseGitHubReleaseMetadata(entry.title || '', entry.url || '');
  if (relMeta) {
    if (relMeta.channel === 'rc') return 'Release candidate';
    if (relMeta.channel === 'alpha') return 'Alpha';
    if (relMeta.channel === 'beta') return 'Beta';
    if (relMeta.channel === 'preview') return 'Preview';
    return 'Release';
  }

  const url = (entry.url || '').toLowerCase();
  const title = (entry.title || '').toLowerCase();
  const source = (entry.source || '').toLowerCase();
  const host = extractCleanHostname(entry.url || '');

  if (host === 'arxiv.org') return 'Paper';
  if (host === 'huggingface.co') return 'Model weights';

  if (/\bpricing\b|\bprices\b|\bpriced\b/i.test(`${url} ${title}`)) return 'Pricing';
  if (/\bclosing\b|\bcloses\b|\bclose\b/i.test(`${url} ${title}`) && /\b(ipo|round|offering|deal)\b/i.test(title)) {
    return 'Closing';
  }
  if (/\bs-1\b|\bsec filing\b|\bfiling\b/i.test(`${url} ${title}`)) return 'Filing';

  if (entry.isPrimary || isCanonicalPrimary) {
    return 'Primary';
  }

  if (
    /\b(ipo|market|shares?|stock|valuation|investors?|nasdaq|nyse|wall street|bailout|regulator|regulators|antitrust)\b/i.test(
      title
    ) &&
    !AGGREGATOR_OR_DISCUSSION_HOSTS.has(host) &&
    !/^vip\s*·/i.test(source)
  ) {
    return 'Market reaction';
  }

  if (
    /^hn\b|^reddit\b|^vip\s*·|^bsky|^x\b/i.test(source) ||
    AGGREGATOR_OR_DISCUSSION_HOSTS.has(host) ||
    host === 'latent.space' ||
    host === 'simonwillison.net'
  ) {
    return host === 'news.ycombinator.com' || host === 'reddit.com' || host === 'old.reddit.com'
      ? 'Discussion'
      : 'Commentary';
  }

  return 'Related';
}

export interface ClusterCoverageSummary {
  groupedLinks: SupportingSourceLink[];
  relatedLinkCount: number;
  independentPublisherCount: number;
  hasIndependentCorroboration: boolean;
  isReleaseHistoryCluster: boolean;
  headerBadgeLabel: string;
  compactRailLabel: string;
  provenanceHeadlineLabel: string;
  verificationNote: string;
}

/**
 * Distinguishes true independent cross-publisher corroboration from single-entity coverage
 * (e.g. primary PR + secondary commentary, multiple company updates, or same-repo release history).
 */
export function analyzeClusterCoverage(sig: SpatialSignal): ClusterCoverageSummary {
  const groupedLinks = getGroupedSourcesForSignal(sig);
  const relatedLinkCount = Math.max(1, groupedLinks.length);

  const uniquePublishers = new Set<string>();
  const directReportingPublishers = new Set<string>();
  let primaryOriginCount = 0;
  let releaseLinkCount = 0;
  let secondaryReactionOrCommentaryCount = 0;

  for (const link of groupedLinks) {
    const pubKey = extractCanonicalPublisherKey(link.url, link.source);
    uniquePublishers.add(pubKey);
    const role = inferSupportingLinkRole(link, false);
    if (link.isPrimary) {
      primaryOriginCount += 1;
    }
    if (
      role === 'Release' ||
      role === 'Release candidate' ||
      role === 'Alpha' ||
      role === 'Beta' ||
      role === 'Preview'
    ) {
      releaseLinkCount += 1;
    }
    const host = extractCleanHostname(link.url);
    const isAggregatorOrigin = /^(?:hn|reddit|vip|bsky|x)\b/i.test((link.source || '').trim());
    const isSecondaryReaction =
      role === 'Commentary' ||
      role === 'Discussion' ||
      role === 'Market reaction' ||
      AGGREGATOR_OR_DISCUSSION_HOSTS.has(host) ||
      isAggregatorOrigin;
    if (isSecondaryReaction) {
      secondaryReactionOrCommentaryCount += 1;
    } else {
      directReportingPublishers.add(pubKey);
    }
  }

  const independentPublisherCount = Math.max(1, uniquePublishers.size);
  const isReleaseHistoryCluster =
    relatedLinkCount > 1 &&
    (sig.source === 'GHRelease' || releaseLinkCount === relatedLinkCount) &&
    independentPublisherCount === 1;

  // True independent corroboration requires 2+ distinct direct reporting publishers without mixing
  // a single primary press release with secondary reaction/commentary or aggregator threads.
  const mixesPrimaryWithReactions = primaryOriginCount >= 1 && secondaryReactionOrCommentaryCount >= 1;
  const hasIndependentCorroboration =
    independentPublisherCount >= 2 &&
    directReportingPublishers.size >= 2 &&
    !isReleaseHistoryCluster &&
    !mixesPrimaryWithReactions;

  let headerBadgeLabel = 'Single-Source';
  let compactRailLabel = 'SRC';
  let provenanceHeadlineLabel = isPrimarySourceSignal(sig)
    ? 'Primary source'
    : 'Single upstream source';
  let verificationNote = isPrimarySourceSignal(sig)
    ? 'Direct primary announcement or technical artifact — check upstream source for full context'
    : 'Claim not independently verified — linked to single upstream source';

  if (relatedLinkCount > 1) {
    if (hasIndependentCorroboration) {
      headerBadgeLabel = `${independentPublisherCount} Publishers · ${relatedLinkCount} links`;
      compactRailLabel = `${independentPublisherCount} SRC`;
      provenanceHeadlineLabel = `Corroborated across ${independentPublisherCount} independent publishers`;
      verificationNote = '';
    } else if (isReleaseHistoryCluster) {
      headerBadgeLabel = `${relatedLinkCount} related links · Release history`;
      compactRailLabel = `${relatedLinkCount} REL`;
      provenanceHeadlineLabel = `${relatedLinkCount} related links · Release history`;
      verificationNote = 'Release timeline from a single upstream repository';
    } else {
      headerBadgeLabel = `${relatedLinkCount} related links`;
      compactRailLabel = `${relatedLinkCount} LNK`;
      provenanceHeadlineLabel = `${relatedLinkCount} related links`;
      verificationNote =
        independentPublisherCount === 1
          ? 'Multiple updates from 1 publisher — not independently verified by external sources'
          : `Primary announcement paired with ${relatedLinkCount - 1} related updates or commentary links`;
    }
  }

  return {
    groupedLinks,
    relatedLinkCount,
    independentPublisherCount,
    hasIndependentCorroboration,
    isReleaseHistoryCluster,
    headerBadgeLabel,
    compactRailLabel,
    provenanceHeadlineLabel,
    verificationNote,
  };
}

export function matchesSignalSearchQuery(sig: SpatialSignal, rawQuery: string): boolean {
  const q = (rawQuery || '').trim().toLowerCase();
  if (!q) return true;

  const secName = SECTOR_BY_ID[sig.primarySector]?.name || '';
  const relMeta = getSignalReleaseMetadata(sig);
  const supText = (sig.supportingSources || [])
    .map((s) => `${s.source} ${s.title}`)
    .join(' ');
  const haystack = [
    sig.title,
    sig.literacy?.plainFullTitle || '',
    relMeta?.displayTitle || '',
    relMeta?.stabilityLabel || '',
    sig.rawAbstract,
    sig.originFeedName || '',
    sig.source,
    sig.primarySector,
    secName,
    sig.canonicalEntity || '',
    ...(sig.affectedEnterpriseStacks || []),
    ...(sig.sourceProvenance || []),
    supText,
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(q);
}

const UI_CHROME_LINE_PATTERNS: RegExp[] = [
  /Uh oh!\s*There was an error while loading\.?/gi,
  /There was an error while loading\.?/gi,
  /Please reload this page\.?/gi,
  /Sorry,\s*something went wrong\.?/gi,
  /Choose a tag to compare/gi,
  /Skip to content/gi,
  /You signed in with another tab or window\.?/gi,
  /You signed out in another tab or window\.?/gi,
  /Reload to refresh your session\.?/gi,
  /Could not load (?:tags|branches)\.?/gi,
  /\bFilter\s+Loading\b/gi,
  /\bAssets\s+\d+\s*(?:Loading)?\b/gi,
  /\bLoading\s*…?/gi,
];

export function hasUiChromeBoilerplate(text: string): boolean {
  const s = text || '';
  return UI_CHROME_LINE_PATTERNS.some((rx) => {
    rx.lastIndex = 0;
    return rx.test(s);
  });
}

export function stripUiChromeBoilerplate(text: string): string {
  let out = stripHtmlMarkupAndEntities(text || '');
  for (const rx of UI_CHROME_LINE_PATTERNS) {
    out = out.replace(rx, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

export interface SanitizedReleaseNotesResult {
  cleanText: string;
  hadBoilerplate: boolean;
  isEmptyOrUseless: boolean;
}

/**
 * Cleans GitHub release notes (API body or Atom content), removing HTML page-shell chrome,
 * repo <meta description> taglines, and bare tag banners. Flags polluted/empty releases so the
 * pipeline never asks an LLM to hallucinate summaries over page error strings.
 */
export function sanitizeReleaseNotesText(
  rawText: string,
  titleOrTag = ''
): SanitizedReleaseNotesResult {
  const decoded = stripHtmlMarkupAndEntities(rawText || '');
  const hadBoilerplate = hasUiChromeBoilerplate(decoded);
  let cleaned = stripUiChromeBoilerplate(decoded);

  // Strip GitHub HTML <meta description> banner: "<repo tagline> - Release <tag> · <owner>/<repo>"
  cleaned = cleaned
    .replace(
      /^.{0,240}?\s+-\s+Release\s+[^\s·]+\s+·\s+[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\s*/i,
      ''
    )
    .replace(/\bRelease\s+(?:[a-z]+-)?v?\d+\.\d+[^\s]*\s*·\s*[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/gi, ' ')
    .replace(/\bRelease\s+(?:[a-z]+-)?v?\d+\.\d+[^\s]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (titleOrTag) {
    const bareTitle = stripHtmlMarkupAndEntities(titleOrTag).trim();
    if (bareTitle && cleaned.toLowerCase() === bareTitle.toLowerCase()) {
      cleaned = '';
    }
  }

  // Empty, tag-only, or tiny commit stub (<48 chars) without substantive release notes
  const isEmptyOrUseless = !cleaned || cleaned.length < 48;

  return {
    cleanText: isEmptyOrUseless ? '' : cleaned,
    hadBoilerplate,
    isEmptyOrUseless,
  };
}

export function isReleaseWithoutNotes(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract' | 'url' | 'source' | 'originFeedName' | 'canonicalEntity'>
): boolean {
  if (!getSignalReleaseMetadata(sig)) return false;
  return sanitizeReleaseNotesText(sig.rawAbstract || '', sig.title || '').isEmptyOrUseless;
}

export interface BenchmarkClaimSpec {
  multiplier: string;
  metric: string;
  baseline: string;
  attribution: string;
  canonicalSentence: string;
}

const BENCHMARK_CLAIM_REGEX =
  /(\b\d+(?:\.\d+)?\s*[x×]|\b\d+(?:\.\d+)?%)(?:\s+(?:the|better|higher|lower|faster|more|improved))?\s+(performance[- ]per[- ]watt|perf[- ]per[- ]watt|energy[- ]efficiency|power[- ]efficiency|memory[- ]efficiency|throughput|tokens?[- ]per[- ]second|tok\/s|latency|speedup)\s+(?:of|than|vs\.?|versus|compared\s+to|compared\s+with|over)\s+([^.;!\n]{5,110})/i;

function normalizeBenchmarkMetric(rawMetric: string): string {
  const lower = (rawMetric || '').trim().toLowerCase();
  if (/^perf(?:ormance)?[- ]per[- ]watt$/.test(lower)) return 'performance per watt';
  if (/^tokens?[- ]per[- ]second$|^tok\/s$/.test(lower)) return 'tokens per second';
  return lower.replace(/-/g, ' ');
}

function normalizeComparisonBaseline(rawBaseline: string): string {
  let clean = (rawBaseline || '')
    .replace(/\s*(?:;|\bwhich\b|\bthat\b).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Preserve specific technical microarchitecture parentheticals (e.g. "a modern superscalar (dual-issue, in-order) CPU core" -> "a dual-issue, in-order CPU core")
  clean = clean
    .replace(
      /^(a|an|the)?\s*(?:modern|current|leading|typical|standard)\s+(?:[a-z0-9-]+\s+)?\(([^)]+)\)\s*/i,
      (_m, art: string | undefined, inner: string) =>
        `${art ? `${art.toLowerCase()} ` : ''}${inner.trim()} `
    )
    .replace(/\s+/g, ' ')
    .replace(/[,:;]+$/g, '')
    .trim();
  return clean;
}

/**
 * Extracts quantitative benchmark claims that include an explicit metric, comparison baseline,
 * and source attribution so L1-L5 synthesis never drops or broadens baseline specifics.
 */
export function extractBenchmarkClaimSpec(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract' | 'url' | 'source' | 'originFeedName'>
): BenchmarkClaimSpec | null {
  const text = `${sig.title || ''}. ${stripUiChromeBoilerplate(sig.rawAbstract || '')}`;
  const m = text.match(BENCHMARK_CLAIM_REGEX);
  if (!m) return null;

  const multiplier = m[1].replace(/\s+/g, '');
  const metric = normalizeBenchmarkMetric(m[2]);
  const baseline = normalizeComparisonBaseline(m[3]);
  if (!baseline || baseline.length < 6) return null;

  const rawPublisher = extractPublisherDisplayName({
    source: sig.originFeedName || sig.source,
    title: sig.title || '',
    url: sig.url || '',
  });
  const attribution =
    rawPublisher.replace(/\s*\(via\s+[^)]+\)$/i, '').trim() || sig.originFeedName || sig.source;

  const canonicalSentence = `${attribution} reports ${multiplier} ${metric} compared to ${baseline}.`;
  return {
    multiplier,
    metric,
    baseline,
    attribution,
    canonicalSentence,
  };
}

function splitExactSourceSentences(rawText: string): string[] {
  const cleaned = stripUiChromeBoilerplate(stripHtmlMarkupAndEntities(rawText || ''));
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?]["')\]]*)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 16);
}

function extractComparisonBaseline(sentence: string): string | undefined {
  const clean = (sentence || '').replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  const vsMatch = clean.match(
    /(?:compared\s+(?:with|to)|versus|\bvs\.?|(?:above|over)\s+the\s+(?:best|baseline|prior|previous))\s+([^.,;]{4,80})/i
  );
  const configMatch = clean.match(/\bacross\s+([^.,;]{4,65}\bconfigurations?)\b/i);
  const parts: string[] = [];
  if (vsMatch) {
    let target = vsMatch[1].trim();
    if (/^(?:best|baseline|prior|previous)/i.test(target) && /above|over/i.test(vsMatch[0])) {
      target = `vs. ${target}`;
    } else if (!/^vs\.?/i.test(target)) {
      target = `vs. ${target}`;
    }
    parts.push(target);
  }
  if (configMatch) {
    parts.push(`across ${configMatch[1].trim()}`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function normalizeRangeSeparator(raw: string): string {
  return (raw || '')
    .replace(/%/g, '')
    .replace(/\s*(?:--|–|—|-|\bto\b)\s*/gi, '–')
    .trim();
}

function extractMetricSubject(
  sentence: string,
  sigTitle: string,
  matchIndex: number
): { subject?: string; isFeatured?: boolean } {
  const cleanTitle = stripHtmlMarkupAndEntities(sigTitle || '');
  const titleLower = cleanTitle.toLowerCase();
  const sentenceBefore = sentence.slice(0, matchIndex);
  const clauseStart = Math.max(0, sentenceBefore.lastIndexOf(';'));
  const localClause = sentenceBefore.slice(clauseStart).trim();
  const isBaselineSentence =
    /\b(strongest\s+general-purpose|baseline|best\s+alternative|compared\s+with|compared\s+to|\bvs\.?\b|incumbent|previous\s+sota|alternative\s+tested)\b/i.test(
      sentence
    );

  // 1. Explicit named model / system at start of sentence or clause (e.g., "Squoosh UX-1, a model...", "Qwen3 Next 80B, the strongest...")
  const leadModelMatch = localClause.match(
    /^(?:In\s+[^,]+,\s+)?((?:Squoosh\s+)?[A-Z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*(?:\s+(?:Next|Astra|Pro|Ultra|Flash|Mini|Nano|Turbo|Max|Plus|Omni|\d+(?:\.\d+)?[BM]))*)\b/
  );
  if (leadModelMatch) {
    let subj = leadModelMatch[1].trim();
    if (/^Squoosh\s+(UX-\d+)/i.test(subj)) {
      subj = subj.replace(/^Squoosh\s+/i, '');
    }
    if (
      !/^(?:In|It|We|The|This|Our|Each|Page|Across|Implemented|Evaluated|Experimentation|While|However|These|Those)$/i.test(
        subj
      ) &&
      (/[A-Z].*[-.\d]/.test(subj) ||
        titleLower.includes(subj.toLowerCase()) ||
        /^(?:Qwen|UX-\d+|GPT|Claude|Gemini|Llama|DeepSeek|Mistral|TideCache|Actuator|Frostbite|Hebbia)/i.test(
          subj
        ))
    ) {
      const inTitle = titleLower.includes(subj.toLowerCase());
      return {
        subject: subj,
        isFeatured: isBaselineSentence ? false : inTitle ? true : undefined,
      };
    }
  }

  // 2. Fallback: look for well-known model/product tokens in the sentence itself or title
  const knownModelInSentence = sentence.match(
    /\b(UX-\d+|Qwen\d*(?:\.\d+)?(?:\s+Next)?(?:\s+\d+[BM])?|GPT-\d+(?:\.\d+)?(?:\s+[A-Z][a-z]+)?|Claude\s+\d+(?:\.\d+)?(?:\s+[A-Z][a-z]+)?|Gemini\s+\d+(?:\.\d+)?(?:\s+[A-Z][a-z]+)?|Actuator-\d+[BM]|TideCache|Frostbite|DeepSeek[- ]?[A-Z]?\d*|Llama[- ]?\d+(?:\.\d+)?)\b/
  );
  if (knownModelInSentence) {
    const subj = knownModelInSentence[1].trim();
    const inTitle = titleLower.includes(subj.toLowerCase());
    return {
      subject: subj,
      isFeatured: isBaselineSentence ? false : inTitle ? true : undefined,
    };
  }

  // 3. When sentence refers to the title's primary model implicitly ("In the live tests, 118 of those variants won (93.7%)")
  const titleEntity = cleanTitle.match(
    /\b(UX-\d+|Qwen[\w.-]*|GPT-\d+(?:\.\d+)?(?:\s+[A-Z][a-z]+)?|TideCache|Actuator-\d+[BM]|Frostbite|Ollama|vLLM|AgentRoboCritic)\b/
  );
  if (titleEntity && !isBaselineSentence) {
    return {
      subject: titleEntity[1].trim(),
      isFeatured: true,
    };
  }

  return isBaselineSentence ? { isFeatured: false } : {};
}

function extractConfidenceIntervalNote(sentence: string): string | undefined {
  const ciMatch = sentence.match(
    /\b(\d+%)\s*(?:wilson|confidence)\s+interval\s+(\d+(?:\.\d+)?)\s*(?:--|–|—|-|\bto\b)\s*(\d+(?:\.\d+)?)%/i
  );
  if (ciMatch) {
    return `${ciMatch[1]} Wilson CI ${ciMatch[2]}–${ciMatch[3]}%`;
  }
  return undefined;
}

function inferPercentageLabel(
  sentence: string,
  matchIndex: number,
  isFeatured?: boolean
): { label: string; context?: string } {
  const lower = sentence.toLowerCase();
  const nearbyStart = Math.max(0, matchIndex - 75);
  const nearbyEnd = Math.min(sentence.length, matchIndex + 75);
  const windowStr = sentence.slice(nearbyStart, nearbyEnd).toLowerCase();
  const baseline = extractComparisonBaseline(sentence);
  const ciNote = extractConfidenceIntervalNote(sentence);
  const combinedContext = [ciNote, baseline].filter(Boolean).join(' · ') || undefined;

  if (/\b(?:excerpt|citation|cited)\b/.test(windowStr) && /\brelevan\w*\b/.test(windowStr)) {
    return { label: 'Cited excerpt relevance', context: 'Relevant cited excerpts in evaluation' };
  }
  if (/\bpresentation\s+requirements?\b/.test(windowStr)) {
    return { label: 'Presentation requirements met', context: combinedContext };
  }
  if (/\brequired\s+(?:types?\s+of\s+)?sources?\b|\bsource\s+coverage\b/.test(lower)) {
    return { label: 'Source coverage score', context: combinedContext };
  }
  if (/\bswe-bench\b/.test(windowStr)) return { label: 'SWE-bench score', context: combinedContext };
  if (/\bvariants?\s+won\b/.test(windowStr)) return { label: 'Variant win rate', context: combinedContext };
  if (/\bcorrectly\s+classified\b|\boutcomes?\b|\boutcome\s+accuracy\b/.test(lower)) {
    return {
      label: isFeatured === false ? 'Baseline accuracy' : 'Outcome accuracy',
      context: combinedContext,
    };
  }
  if (/\baccuracy\b/.test(windowStr)) {
    return {
      label: isFeatured === false ? 'Baseline accuracy' : 'Reported accuracy',
      context: combinedContext,
    };
  }
  if (/\b(?:latency|ttft|tpot|per-token)\b/.test(windowStr) && /\breduc\w*|\blower|\bcut|\bdrop/.test(windowStr)) {
    return { label: 'Latency reduction', context: combinedContext };
  }
  if (/\b(?:memory|hbm|vram)\b/.test(windowStr) && /\breduc\w*|\blower|\bsaving/.test(windowStr)) {
    return { label: 'Memory reduction', context: combinedContext };
  }
  if (/\breduction\b|\bfaster\b|\bcheaper\b|\blower\b|\bcut\b|\bdrop\b|\bsaving\w*\b/.test(windowStr)) {
    const word = windowStr.match(/\b(reduction|faster|cheaper|lower|cut|drop|saving\w*)\b/)?.[1];
    return { label: word ? `Reported ${word}` : 'Reported delta', context: combinedContext };
  }
  if (/\bverified\b|\bpass(?:ed|@\d+)?\b/.test(windowStr)) return { label: 'Evaluation pass rate', context: combinedContext };
  return { label: 'Source-reported percentage', context: combinedContext };
}

function inferPercentagePointLabel(sentence: string, matchIndex: number): { label: string; context?: string } {
  const nearby = sentence.slice(Math.max(0, matchIndex - 30), Math.min(sentence.length, matchIndex + 90)).toLowerCase();
  if (/\bciting\b.*\bsources?\b|\brequired\s+(?:types?\s+of\s+)?sources?\b|\bsource\s+coverage\b/.test(nearby)) {
    return { label: 'Required source coverage', context: 'Lead vs. best alternative tested' };
  }
  if (/\bpresentation\s+requirements?\b/.test(nearby)) {
    return { label: 'Presentation requirements lead', context: 'Lead vs. best alternative tested' };
  }
  return { label: 'Percentage-point lead', context: 'Comparative evaluation' };
}

/**
 * Extracts quantitative metrics verbatim from ingested source text along with the exact
 * supporting sentence (`quote`), comparison baseline, and subject attribution, ordering
 * featured systems before comparison baselines.
 */
export function extractSourceVerifiedMetrics(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract'>
): VerifiedSourceMetric[] {
  const sentences = [
    ...splitExactSourceSentences(sig.rawAbstract || ''),
    ...splitExactSourceSentences(sig.title || ''),
  ];
  const out: VerifiedSourceMetric[] = [];
  const seenKeys = new Set<string>();

  const pushMetric = (metric: VerifiedSourceMetric) => {
    const subjKey = (metric.subject || '').toLowerCase().trim();
    const valKey = metric.value.toLowerCase().replace(/\s+/g, ' ').trim();
    const dedupKey = `${subjKey}|${valKey}`;
    if (seenKeys.has(dedupKey) || out.length >= 6) return;
    seenKeys.add(dedupKey);
    out.push(metric);
  };

  for (const sentence of sentences) {
    const baseline = extractComparisonBaseline(sentence);

    // 1. Percentage-point leads (e.g., "+13.6 percentage points" / "scored 13.6 percentage points above")
    const ppRegex = /([+-]?\d+(?:\.\d+)?)\s*percentage[- ]points?\b/gi;
    let m: RegExpExecArray | null;
    while ((m = ppRegex.exec(sentence)) !== null) {
      const numRaw = m[1];
      const valStr = numRaw.startsWith('+') || numRaw.startsWith('-') ? `${numRaw} percentage points` : `+${numRaw} percentage points`;
      const meta = inferPercentagePointLabel(sentence, m.index);
      const subjMeta = extractMetricSubject(sentence, sig.title || '', m.index);
      pushMetric({
        value: valStr,
        label: meta.label,
        quote: sentence,
        context: meta.context,
        subject: subjMeta.subject,
        isFeatured: subjMeta.isFeatured,
      });
    }

    // 2. Percentages & full numeric ranges (e.g., "20--59%", "84.0%", "61.6%", skipping CI bounds)
    const pctRegex = /\b(\d{1,3}(?:\.\d+)?(?:\s*%?\s*(?:--|–|—|-|\bto\b)\s*\d{1,3}(?:\.\d+)?)?)%/gi;
    while ((m = pctRegex.exec(sentence)) !== null) {
      const afterSlice = sentence.slice(m.index + m[0].length, m.index + m[0].length + 28).toLowerCase();
      const beforeSlice = sentence.slice(Math.max(0, m.index - 28), m.index).toLowerCase();
      if (
        /^\s*(?:wilson|confidence)\s+interval\b|^\s*ci\b/.test(afterSlice) ||
        /(?:wilson|confidence)\s+interval\s*$|\bci\s*$/.test(beforeSlice)
      ) {
        continue;
      }

      const windowLower = sentence
        .slice(Math.max(0, m.index - 75), Math.min(sentence.length, m.index + m[0].length + 75))
        .toLowerCase();
      const hasEvalContext =
        /\b(excerpts?|cited|relevan\w*|presentation|requirements?|sources?|coverage|verified|reduc\w*|faster|cheaper|lower|cut|drop|accuracy|score|swe-bench|mmlu|gpqa|pass|recall|precision|benchmark|utilization|overhead|gain|improv\w*|latency|ttft|tpot|throughput|memory|vram|hbm|correctly\s+classified|classified|classification|outcomes?|win\s+rate|variants?\s+won|\bwon\b|simulated|shoppers)\b/.test(
          windowLower
        );
      if (!hasEvalContext) continue;
      const subjMeta = extractMetricSubject(sentence, sig.title || '', m.index);
      const meta = inferPercentageLabel(sentence, m.index, subjMeta.isFeatured);
      const normNum = normalizeRangeSeparator(m[1]);
      pushMetric({
        value: `${normNum}%`,
        label: meta.label,
        quote: sentence,
        context: meta.context,
        subject: subjMeta.subject,
        isFeatured: subjMeta.isFeatured,
      });
    }

    // 3. Token throughput (preserving ranges & exact unit "tokens per second", e.g., "51.8–58.3 tokens per second")
    const tokRegex =
      /\b(\d+(?:\.\d+)?(?:\s*(?:--|–|—|-|\bto\b)\s*\d+(?:\.\d+)?)?)\s*(?:tokens\s+per\s+second|tok\/s|t\/s|tokens\/s)\b/gi;
    while ((m = tokRegex.exec(sentence)) !== null) {
      const rangeClean = normalizeRangeSeparator(m[1]);
      const subjMeta = extractMetricSubject(sentence, sig.title || '', m.index);
      pushMetric({
        value: `${rangeClean} tokens/s`,
        label: 'Measured throughput',
        quote: sentence,
        context: baseline || 'Source-reported token generation rate',
        subject: subjMeta.subject,
        isFeatured: subjMeta.isFeatured,
      });
    }

    // 4. Efficiency, turn & speedup multipliers including full ranges (e.g., "1.40--3.05x", "2x–4x", "4.59x")
    const multRegex =
      /\b(\d+(?:\.\d+)?(?:\s*[x×]?\s*(?:--|–|—|-|\bto\b)\s*\d+(?:\.\d+)?)?)\s*([x×])(?:\s+(?:the\s+)?(performance[- ]per[- ]watt|perf[- ]per[- ]watt|energy\s+efficiency|throughput|speedup))?(?=\b|[\s,.;:!?])/gi;
    while ((m = multRegex.exec(sentence)) !== null) {
      const prefixChar = m.index > 0 ? sentence[m.index - 1] : '';
      if (/[A-Za-z0-9]/.test(prefixChar)) continue;
      const windowLower = sentence
        .slice(Math.max(0, m.index - 55), Math.min(sentence.length, m.index + m[0].length + 55))
        .toLowerCase();
      const explicitUnit = m[3];
      const hasTechContext =
        Boolean(explicitUnit) ||
        /\b(ttft|latency|throughput|speedup|faster|agent turns?|performance|efficiency|improv\w*|hicache|sglang|reduction|training compute|productivity)\b/.test(
          windowLower
        );
      if (!hasTechContext) continue;
      const normNum = normalizeRangeSeparator(m[1].replace(/[x×]/gi, ''));
      const sym = m[2] === '×' && !normNum.includes('–') ? '×' : 'x';
      const unitClean = explicitUnit ? explicitUnit.replace(/-/g, ' ').toLowerCase() : '';
      const label = unitClean
        ? 'Benchmark multiplier'
        : /\bttft\b/i.test(windowLower)
        ? 'TTFT speedup'
        : /\bturns?\b/i.test(windowLower)
        ? 'Task completion speedup'
        : 'Measured speedup';
      const subjMeta = extractMetricSubject(sentence, sig.title || '', m.index);
      pushMetric({
        value: unitClean ? `${normNum}${sym} ${unitClean}` : `${normNum}${sym}`,
        label,
        quote: sentence,
        context: baseline,
        subject: subjMeta.subject,
        isFeatured: subjMeta.isFeatured,
      });
    }

    // 5. Explicit hardware latency / VRAM / memory numbers
    const msRegex = /\b(\d+(?:\.\d+)?(?:\s*(?:--|–|—|-|\bto\b)\s*\d+(?:\.\d+)?)?)\s*ms\b/gi;
    while ((m = msRegex.exec(sentence)) !== null) {
      const windowLower = sentence
        .slice(Math.max(0, m.index - 40), Math.min(sentence.length, m.index + 45))
        .toLowerCase();
      if (!/\b(latency|ttft|tpot|response|delay|time|inference|turnaround)\b/.test(windowLower)) {
        continue;
      }
      const subjMeta = extractMetricSubject(sentence, sig.title || '', m.index);
      pushMetric({
        value: `${normalizeRangeSeparator(m[1])} ms`,
        label: 'Reported latency',
        quote: sentence,
        context: baseline,
        subject: subjMeta.subject,
        isFeatured: subjMeta.isFeatured,
      });
    }

    const memRegex = /\b(\d+(?:\.\d+)?)\s*(GB|TB)\s*(VRAM|RAM|unified memory|memory)\b/gi;
    while ((m = memRegex.exec(sentence)) !== null) {
      pushMetric({
        value: `${m[1]} ${m[2].toUpperCase()} ${m[3]}`,
        label: 'Memory footprint',
        quote: sentence,
      });
    }
  }

  // Order featured systems FIRST, then neutral metrics, then comparison baselines
  return out
    .map((m, idx) => ({ m, idx }))
    .sort((a, b) => {
      const rank = (x: VerifiedSourceMetric) =>
        x.isFeatured === true ? 0 : x.isFeatured === false ? 2 : 1;
      return rank(a.m) - rank(b.m) || a.idx - b.idx;
    })
    .map((x) => x.m)
    .slice(0, 5);
}

/**
 * True when a source primarily evaluates retrieval, citation relevance, or grading quality
 * rather than measuring inference latency or token throughput.
 */
export function isEvaluationQualityStudy(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract'>
): boolean {
  const hay = `${sig.title || ''} ${stripUiChromeBoilerplate(sig.rawAbstract || '')}`;
  const hasEvalTerms =
    /\b(citations?|cited excerpts?|relevan\w*|source coverage|grading criteria|presentation requirements?|percentage[- ]point|rubric|eval(?:uation)?s?|accuracy)\b/i.test(
      hay
    );
  const hasSpeedTerms = /\b(?:\d+\s*(?:tok\/s|t\/s|tokens\/s|tokens per second)|ttft|tpot)\b/i.test(hay);
  return hasEvalTerms && !hasSpeedTerms;
}

const SINGLE_USER_EXPERIMENT_REGEX =
  /\b(i built|i fine[- ]?tuned|i ran|i tested|i trained|my home|my laptop|my mac|on cpu|on my machine|offline\b|raspberry\s*pi|rockchip|rk35\d+|orange\s*pi|jetson|home server|side project|weekend project|pet project|for fun|3d modeling partner)\b/i;

const HARDWARE_OR_BUILD_EXPERIMENT_REGEX =
  /\b(i built|i fine[- ]?tuned|i ran|i tested|i trained|rockchip|rk35\d+|raspberry\s*pi|orange\s*pi|jetson|tok\/s|tokens\s+per\s+second|llama\.cpp|llamacpp|quantiz\w*|q4_k_m|gguf|vram|cpu\s+cores?|gpu|cve-\d{4}-\d+|exploit|vulnerability|github\.com\/|model\s+release)\b/i;

const DISCUSSION_PERSONAL_REGEX =
  /\b(ask\s+hn|tell\s+hn|unemployed|job search|find employment|what should i do|what to do\??|career advice|resume gap|laid off|layoffs|burnout|writes an essay|giving everyone the same advice|personal essay|my thoughts on|unpopular opinion)\b/i;

const LEGAL_COURT_RULING_REGEX =
  /\b(court|tribunal|echr|supreme court|federal court|district court|judge|ruling|sanction(?:s|ed)?|disbar\w*|bars?\s+(?:a\s+)?(?:[\w-]+\s+){1,4}for\s+\d+\s+(?:years?|months?)|barred\s+for\s+(?:\d+|two|three|four|five)\s+(?:years?|months?)|representing\s+(?:applicants|litigants)\s+before)\b/i;

const CONDITIONAL_POLICY_REGEX =
  /\b(?:if\s+[\w\s]{2,40}\s+(?:disable|turn\s+off|opt\s+out|refuse|don['’]t)|unless\s+[\w\s]{2,40}|(?:disable[ds]?|turn(?:s|ed|ing)?\s+off|opt(?:s|ed|ing)?\s+out|don['’]t\s+want|punish(?:es|ing|ed)?)\b[^.]{0,90}\b(?:lose\s+access|cut(?:ting)?\s+off\s+access|block\w*\s+[^.]{0,60}from\s+access|search\s+engine|google\s+search|require\b))/i;

export function isLegalOrCourtRulingSignal(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract'>
): boolean {
  const hay = `${sig.title || ''} ${stripUiChromeBoilerplate(sig.rawAbstract || '').slice(0, 480)}`;
  return LEGAL_COURT_RULING_REGEX.test(hay);
}

export function isConditionalPolicyHeadline(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract'>
): boolean {
  const hay = `${sig.title || ''} ${stripUiChromeBoilerplate(sig.rawAbstract || '').slice(0, 520)}`;
  return CONDITIONAL_POLICY_REGEX.test(hay);
}

export function requiresVerbatimPublisherHeadline(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract'>
): boolean {
  return isLegalOrCourtRulingSignal(sig) || isConditionalPolicyHeadline(sig);
}

function normalizeHeadlineForCompare(text: string): string {
  return stripHtmlMarkupAndEntities(text || '')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/\u2026|\.\.\.$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function validateHeadlineMeaningPreserved(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract' | 'originFeedName'>,
  candidateHeadline: string
): { valid: boolean; reason?: string; forceVerbatimPublisherFallback: boolean } {
  const candClean = (candidateHeadline || '').trim();
  if (!candClean) {
    return { valid: false, reason: 'Empty candidate headline', forceVerbatimPublisherFallback: true };
  }

  const normCand = normalizeHeadlineForCompare(candClean);
  const normSource = normalizeHeadlineForCompare(sig.title || '');
  const matchesVerbatimPublisher =
    normSource.length > 0 &&
    (normCand === normSource ||
      (normCand.length >= 24 && normSource.startsWith(normCand)));

  const sourceHay = `${sig.title || ''} ${stripUiChromeBoilerplate(sig.rawAbstract || '').slice(0, 650)}`;

  // 1. Legal / Jurisdictional Scope Integrity
  if (isLegalOrCourtRulingSignal(sig)) {
    const sourceHasGeneralPracticeBan =
      /\b(?:practicing\s+law|practice\s+of\s+law|disbarred)\b/i.test(sourceHay);
    if (
      !sourceHasGeneralPracticeBan &&
      /\b(?:barred|banned|suspended)\s+from\s+practicing(?:\s+law)?\b|\bdisbarred\b/i.test(candClean)
    ) {
      return {
        valid: false,
        reason: 'Broadened court-specific bar into general practice ban',
        forceVerbatimPublisherFallback: true,
      };
    }

    const sourceNamesCourt = /\b(?:court|tribunal|echr|judge)\b/i.test(sourceHay);
    if (
      sourceNamesCourt &&
      /\b(?:bar(?:s|red)?|ban(?:s|ned)?|suspend(?:s|ed)?|exclud(?:e|es|ed))\b/i.test(candClean) &&
      !/\b(?:court|tribunal|echr|federal|appeals?|rights)\b/i.test(candClean)
    ) {
      return {
        valid: false,
        reason: 'Dropped court jurisdictional scope qualifier',
        forceVerbatimPublisherFallback: true,
      };
    }

    if (!matchesVerbatimPublisher) {
      return {
        valid: false,
        reason: 'Legal/court ruling requires verbatim publisher headline',
        forceVerbatimPublisherFallback: true,
      };
    }
  }

  // 2. Conditional & Cause/Effect Integrity (e.g., disabled tool vs. blocked target product)
  if (isConditionalPolicyHeadline(sig)) {
    const sourceTargetsSearchLoss =
      /\b(?:google\s+search|search\s+engine)\b/i.test(sourceHay) &&
      /\b(?:disable|turn\s+off|opt\s+out|don['’]t\s+want)\b[^.]{0,80}\b(?:gemini|ai)\b|\b(?:gemini|ai)\b[^.]{0,80}\b(?:lose\s+access|block|cut(?:ting)?\s+off)\b[^.]{0,80}\bsearch\b/i.test(
        sourceHay
      );

    if (sourceTargetsSearchLoss) {
      const invertedToolBlock =
        /\bblock(?:s|ing)?\s+schools\s+from\s+(?:using\s+)?(?:gemini|ai)\b|\bban(?:s|ning)?\s+schools\s+from\s+(?:using\s+)?(?:gemini|ai)\b/i.test(
          candClean
        );
      if (invertedToolBlock) {
        return {
          valid: false,
          reason: 'Inverted conditional clause (disabled Gemini/AI vs. lost Google Search access)',
          forceVerbatimPublisherFallback: true,
        };
      }
      if (/\bgemini\b/i.test(candClean) && !/\bsearch\b/i.test(candClean)) {
        return {
          valid: false,
          reason: 'Dropped affected Google Search target in conditional headline',
          forceVerbatimPublisherFallback: true,
        };
      }
    }

    if (!matchesVerbatimPublisher) {
      return {
        valid: false,
        reason: 'Conditional policy headline requires verbatim publisher headline',
        forceVerbatimPublisherFallback: true,
      };
    }
  }

  return { valid: true, forceVerbatimPublisherFallback: false };
}

export function isDiscussionOrPersonalSignal(
  sig: Pick<
    SpatialSignal,
    'title' | 'rawAbstract' | 'url' | 'source' | 'originFeedName' | 'sourceCategory' | 'primarySector'
  >
): boolean {
  if (
    sig.source === 'GHRelease' ||
    sig.source === 'GitHub' ||
    sig.source === 'arXiv' ||
    sig.source === 'HuggingFace' ||
    sig.source === 'LabRelease'
  ) {
    return false;
  }
  const title = (sig.title || '').trim();
  if (/^(?:ask\s+hn|tell\s+hn)\s*:/i.test(title)) {
    return true;
  }
  if (
    NON_TOOL_NEWS_MARKET_REGEX.test(title) ||
    isLegalOrCourtRulingSignal(sig) ||
    isConditionalPolicyHeadline(sig)
  ) {
    return false;
  }
  const hay = `${title} ${stripUiChromeBoilerplate(sig.rawAbstract || '')}`;
  if (DISCUSSION_PERSONAL_REGEX.test(hay)) {
    return true;
  }
  if (
    sig.source === 'HackerNews' ||
    sig.source === 'Reddit' ||
    sig.source === 'Bluesky' ||
    sig.source === 'Discord' ||
    sig.source === 'XBridge'
  ) {
    if (
      !hasTechnicalEngineeringContent(sig) &&
      !HARDWARE_OR_BUILD_EXPERIMENT_REGEX.test(hay) &&
      !/\b(?:model|agent|cve-\d|tip:|release|weights|github\.com)\b/i.test(title)
    ) {
      return true;
    }
  }
  return false;
}

const ENTERPRISE_LAUNCH_REGEX =
  /\b(introducing|announcing|general availability|\bga\b|enterprise|platform|api|pricing|customer stor(?:y|ies)|eu ai act|executive order|compliance mandate|frontier model|gpt-\d|claude[-\s]\d|gemini[-\s]\d|llama[-\s]\d|qwen\s*\d|mistral\s+large)\b/i;

export function classifyEvidenceScope(
  sig: Pick<
    SpatialSignal,
    'title' | 'rawAbstract' | 'url' | 'source' | 'originFeedName' | 'readiness' | 'sourceCategory' | 'primarySector'
  >
): EvidenceScope {
  if (isDiscussionOrPersonalSignal(sig)) {
    return 'discussion_or_personal';
  }
  if (isNonToolNewsOrMarketSignal(sig)) {
    return 'market_or_policy';
  }
  if (sig.source === 'GHRelease') {
    return 'software_release';
  }
  if (sig.source === 'arXiv' || sig.source === 'HuggingFace' || sig.readiness === 'RESEARCH') {
    return 'research_paper';
  }
  const hay = `${sig.title || ''} ${stripUiChromeBoilerplate(sig.rawAbstract || '')}`;
  if (SINGLE_USER_EXPERIMENT_REGEX.test(hay)) {
    return 'single_user_experiment';
  }
  if (sig.source === 'LabRelease') {
    return 'enterprise_launch';
  }
  if (sig.source === 'Reddit' || sig.source === 'Bluesky' || sig.source === 'HackerNews' || sig.source === 'Discord') {
    if (sig.primarySector === 'GOV' && ENTERPRISE_LAUNCH_REGEX.test(hay)) {
      return 'enterprise_launch';
    }
    return 'single_user_experiment';
  }
  if (ENTERPRISE_LAUNCH_REGEX.test(hay)) {
    return 'enterprise_launch';
  }
  return 'software_release';
}

const COST_EVIDENCE_REGEX =
  /(?:\$\s*\d|cost\s+savings?|lower\s+(?:inference\s+)?costs?|per[- ]million|\/\s*1m\s*tok|token\s+(?:price|pricing|cost)|run[- ]rate|cheaper|spend|margin|roi\b|pricing|compute\s+savings?|dollars?)/i;

const LATENCY_OR_THROUGHPUT_REGEX =
  /\b(?:latency|ttft|tpot|per-token|tokens\s+per\s+second|tok\/s|throughput|speedup|faster|cache\s+management|serving\s+system|agent\s+turns?)\b/i;

export function hasLatencyOrThroughputWithoutCost(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract'>
): boolean {
  const hay = `${sig.title || ''} ${stripUiChromeBoilerplate(sig.rawAbstract || '')}`;
  return LATENCY_OR_THROUGHPUT_REGEX.test(hay) && !COST_EVIDENCE_REGEX.test(hay);
}

const WORD_MULTIPLIER_REGEX = /\b(twofold|threefold|fourfold|fivefold|tenfold)\b/i;

export function normalizeNumericCorpus(text: string): string {
  return stripUiChromeBoilerplate(stripHtmlMarkupAndEntities(text || ''))
    .replace(/(\d+(?:\.\d+)?)\s*(?:--|–|—|\bto\b)\s*(\d+(?:\.\d+)?)/gi, '$1-$2')
    .replace(/(\d+(?:\.\d+)?)%\s*-\s*(\d+(?:\.\d+)?)%/g, '$1-$2%')
    .replace(/\b(?:tok\/s|t\/s|tokens\/s|tokens\s+per\s+second)\b/gi, 'tokens/s')
    .replace(/×/g, 'x')
    .replace(/(\d+(?:\.\d+)?)\s*percent(?:age)?\s+points?\b/gi, '$1 percentage points')
    .replace(/(\d+(?:\.\d+)?)\s*percent\b/gi, '$1%')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function escapeNumericRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isTokenBackedInCorpus(rawTok: string, normCorpus: string): boolean {
  if (!normCorpus) return false;
  const tokLower = rawTok.trim().toLowerCase();
  if (WORD_MULTIPLIER_REGEX.test(tokLower)) {
    const foldNum = tokLower.startsWith('two')
      ? '2x'
      : tokLower.startsWith('three')
      ? '3x'
      : tokLower.startsWith('four')
      ? '4x'
      : tokLower.startsWith('five')
      ? '5x'
      : '10x';
    return new RegExp(`\\b${tokLower}\\b`, 'i').test(normCorpus) || normCorpus.includes(foldNum);
  }

  let normTok = tokLower
    .replace(/^[<>≤≥]\s*/, '')
    .replace(/(\d+(?:\.\d+)?)\s*(?:--|–|—|\bto\b)\s*(\d+(?:\.\d+)?)/gi, '$1-$2')
    .replace(/(\d+(?:\.\d+)?)%\s*-\s*(\d+(?:\.\d+)?)%/g, '$1-$2%')
    .replace(/\b(?:tok\/s|t\/s|tokens\/s|tokens\s+per\s+second)\b/gi, 'tokens/s')
    .replace(/×/g, 'x')
    .replace(/\s+/g, ' ')
    .trim();

  if (normTok.startsWith('$')) {
    normTok = normTok.replace(/^\$\s*/, '$');
  }

  // Exact match with numeric left/right boundaries so "59%" does NOT match "20-59%"
  const esc = escapeNumericRegex(normTok);
  const rx = new RegExp(`(?<![\\d.%\\-–—])${esc}(?![\\d.%])`, 'i');
  if (rx.test(normCorpus)) return true;

  // Allow "+13.6 percentage points" to match "13.6 percentage points" in source
  if (normTok.startsWith('+') && normTok.includes('percentage points')) {
    const unsigned = escapeNumericRegex(normTok.slice(1));
    if (new RegExp(`(?<![\\d.%\\-–—])${unsigned}`, 'i').test(normCorpus)) return true;
  }

  // Allow formatted multiplier range (e.g. "1.40-3.05x") when source says "1.40-3.05x" or "2x-4x"
  const xRangeClean = normTok.replace(/(\d)x-(\d)/g, '$1-$2');
  if (xRangeClean !== normTok) {
    if (new RegExp(`(?<![\\d.%\\-–—])${escapeNumericRegex(xRangeClean)}`, 'i').test(normCorpus)) {
      return true;
    }
  }

  return false;
}

const QUANT_CLAIM_TOKEN_REGEX =
  /\b\d+(?:\.\d+)?(?:\s*%?\s*(?:--|–|—|-|\bto\b)\s*\d+(?:\.\d+)?)?\s*%|\b\d+(?:\.\d+)?\s*percentage[- ]points?\b|\$\s*\d+(?:\.\d+)?(?:\s*[kmbt]\+?)?(?:\s*(?:--|–|—|-|\bto\b)\s*\$?\d+(?:\.\d+)?(?:\s*[kmbt]\+?)?)?|\b\d+(?:\.\d+)?(?:\s*[x×]?\s*(?:--|–|—|-|\bto\b)\s*\d+(?:\.\d+)?)?\s*[x×](?=\b|[\s,.;:!?])|\b(?:two|three|four|five|ten)fold\b|[<>≤≥]\s*0?\.\d+\b|\b\d+(?:\.\d+)?(?:\s*(?:--|–|—|-|\bto\b)\s*\d+(?:\.\d+)?)?\s*(?:ms\s*(?:ttft|tpot|latency)|tok\/s|tokens\/s|tokens\s+per\s+second)\b/gi;

export function findUnbackedNumericTokens(text: string, sourceCorpus: string): string[] {
  if (!text) return [];
  const normCorpus = normalizeNumericCorpus(sourceCorpus);
  const unbacked: string[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  const rx = new RegExp(QUANT_CLAIM_TOKEN_REGEX.source, 'gi');
  while ((m = rx.exec(text)) !== null) {
    const raw = m[0].trim();
    const prefixChar = m.index > 0 ? text[m.index - 1] : '';
    // Ignore resolutions (1280x800), hex literals (0x1f), and prose like "GPT-4x"
    if (/[A-Za-z0-9]/.test(prefixChar)) continue;
    const afterStr = text.slice(m.index + raw.length, m.index + raw.length + 12).toLowerCase();
    if (/^\s*\d/.test(afterStr) && /[x×]$/i.test(raw)) continue;

    // Ignore harmless UI labels or formatting hints if ever passed directly (none expected in prose)
    const key = raw.toLowerCase();
    if (!isTokenBackedInCorpus(raw, normCorpus) && !seen.has(key)) {
      seen.add(key);
      unbacked.push(raw);
    }
  }
  return unbacked;
}

export function stripUnbackedNumericClaims(
  text: string,
  sourceCorpus: string
): { cleaned: string; removedTokens: string[] } {
  const removedTokens = findUnbackedNumericTokens(text, sourceCorpus);
  if (removedTokens.length === 0) {
    return { cleaned: text, removedTokens: [] };
  }

  // Split by sentence/clause boundaries and remove only segments/parentheticals with unbacked numbers
  const normCorpus = normalizeNumericCorpus(sourceCorpus);
  let out = text.replace(/\([^()]{3,160}\)/g, (paren) => {
    return findUnbackedNumericTokens(paren, normCorpus).length > 0 ? '' : paren;
  });

  if (findUnbackedNumericTokens(out, normCorpus).length > 0) {
    const sentences = out.split(/(?<=[.!?])\s+/);
    const keptSentences = sentences.filter(
      (s) => findUnbackedNumericTokens(s, normCorpus).length === 0
    );
    if (keptSentences.length > 0) {
      out = keptSentences.join(' ');
    } else {
      // Strip clause-level fragments containing unbacked numbers
      const clauses = out.split(/\s*[;—]\s*/);
      const keptClauses = clauses.filter(
        (c) => findUnbackedNumericTokens(c, normCorpus).length === 0
      );
      if (keptClauses.length > 0) {
        out = keptClauses.join('; ');
      } else {
        for (const tok of removedTokens) {
          out = out.replace(new RegExp(escapeNumericRegex(tok), 'gi'), '');
        }
      }
    }
  }

  out = out
    .replace(/\s+([.,;!?])/g, '$1')
    .replace(/([.,;])\s*[.,;]+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { cleaned: out, removedTokens };
}

const FROZEN_ENTITY_REGEX =
  /\b(?:Actuator|Qwen|Llama|Mistral|DeepSeek|Claude|Gemini|GPT|Gemma|Ollama|Rockchip|Hebbia|Frostbite|Whisper|Inkling|Granite|Phi|SmolLM)(?:[-.](?:[A-Za-z0-9]+))*(?:\s+(?:v?\d+(?:\.\d+)*(?:-[A-Za-z0-9.]+)?|Astra|Ultra|Pro|Flash|Mini|Nano|Turbo|Opus|Sonnet|Haiku|Large|Small|Coder|Instruct|Omni|Max|Air|R\d+|V\d+|RK\d+[A-Za-z0-9]*))*\b|\b[A-Z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*-\d+(?:\.\d+)?[BM]\b/g;

export function extractFrozenEntities(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract'>
): string[] {
  const hay = `${sig.title || ''} ${stripUiChromeBoilerplate(sig.rawAbstract || '')}`;
  const matches = hay.match(FROZEN_ENTITY_REGEX) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const clean = raw.trim();
    const key = clean.toLowerCase();
    if (clean.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

const SIX_HOURS_MS = 6 * 3_600_000;
const NEW_BADGE_WINDOW_MS = 48 * 3_600_000;

export function isUpstreamUpdatedSignal(
  sig: Pick<SpatialSignal, 'publishedAtMs' | 'updatedAtMs'>
): boolean {
  return (
    typeof sig.updatedAtMs === 'number' &&
    Number.isFinite(sig.updatedAtMs) &&
    sig.updatedAtMs > 0 &&
    typeof sig.publishedAtMs === 'number' &&
    sig.updatedAtMs > sig.publishedAtMs + SIX_HOURS_MS
  );
}

export function isEligibleForNewBadge(
  sig: Pick<SpatialSignal, 'publishedAtMs' | 'updatedAtMs'>,
  baselineTs: number,
  nowMs: number = Date.now()
): boolean {
  if (isUpstreamUpdatedSignal(sig)) return false;
  if (typeof sig.publishedAtMs !== 'number' || !Number.isFinite(sig.publishedAtMs)) return false;
  return sig.publishedAtMs > baselineTs && nowMs - sig.publishedAtMs <= NEW_BADGE_WINDOW_MS;
}

// =============================================================================
// CORTEX v2.5: ZERO UNBACKED COMPLIANCE CLAIMS & SUMMARY ACTOR/SCOPE GUARD
// =============================================================================

export const COMPLIANCE_NOT_ASSESSED_STUDY = 'Not assessed in this study';
export const COMPLIANCE_NOT_ASSESSED_SOURCE = 'Not assessed in source';

const SOURCE_COMPLIANCE_ASSESSMENT_REGEX =
  /\b(?:soc\s*2|zero[- ]retention|zero\s+training\s+retention|hipaa|gdpr|fedramp|iso\s*42001|pci[- ]dss|compliance\s+audit|security\s+clearance|enterprise[- ]ready|ready\s+for\s+(?:an?\s+|governed\s+)?enterprise\s+pilot)\b/i;

const UNBACKED_COMPLIANCE_RULES: Array<{ label: string; textRx: RegExp; corpusRx: RegExp }> = [
  { label: 'SOC 2', textRx: /\bsoc\s*2\b/i, corpusRx: /\bsoc\s*2\b/i },
  {
    label: 'zero-retention',
    textRx: /\bzero[- ]retention\b/i,
    corpusRx: /\bzero[- ]retention\b|\bzero\s+training\s+retention\b/i,
  },
  { label: 'HIPAA', textRx: /\bhipaa\b/i, corpusRx: /\bhipaa\b/i },
  { label: 'GDPR', textRx: /\bgdpr\b/i, corpusRx: /\bgdpr\b/i },
  {
    label: 'ready for an enterprise pilot',
    textRx: /\bready\s+for\s+(?:an?\s+|governed\s+)?enterprise\s+pilot\b/i,
    corpusRx: /\bready\s+for\s+(?:an?\s+|governed\s+)?enterprise\s+pilot\b/i,
  },
  {
    label: 'enterprise-ready',
    textRx: /\benterprise[- ]ready\b/i,
    corpusRx: /\benterprise[- ]ready\b/i,
  },
];

export function hasSourceComplianceAssessment(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract' | 'streetQuotes'>
): boolean {
  const hay = [
    sig.title || '',
    sig.rawAbstract || '',
    ...(sig.streetQuotes || []).map((q) => q.text || ''),
  ].join(' ');
  return SOURCE_COMPLIANCE_ASSESSMENT_REGEX.test(hay);
}

export function findUnbackedComplianceClaims(text: string, rawSourceCorpus: string): string[] {
  if (!text) return [];
  const corpus = stripUiChromeBoilerplate(stripHtmlMarkupAndEntities(rawSourceCorpus || ''));
  const found: string[] = [];
  for (const rule of UNBACKED_COMPLIANCE_RULES) {
    if (rule.textRx.test(text) && !rule.corpusRx.test(corpus)) {
      found.push(rule.label);
    }
  }
  return found;
}

export function stripUnbackedComplianceClaims(
  text: string,
  rawSourceCorpus: string,
  fallbackNote: string
): { cleaned: string; removedClaims: string[] } {
  const removedClaims = findUnbackedComplianceClaims(text, rawSourceCorpus);
  if (removedClaims.length === 0) {
    return { cleaned: text, removedClaims: [] };
  }

  const corpus = stripUiChromeBoilerplate(stripHtmlMarkupAndEntities(rawSourceCorpus || ''));
  const hasClaimInSentence = (sentence: string) =>
    UNBACKED_COMPLIANCE_RULES.some((r) => r.textRx.test(sentence) && !r.corpusRx.test(corpus));

  let out = text.replace(/\([^()]{3,160}\)/g, (paren) =>
    hasClaimInSentence(paren) ? '' : paren
  );
  if (findUnbackedComplianceClaims(out, corpus).length > 0) {
    const sentences = out.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((s) => !hasClaimInSentence(s));
    if (kept.length > 0) {
      out = kept.join(' ');
    } else {
      out = '';
    }
  }

  out = out
    .replace(/\s+([.,;!?])/g, '$1')
    .replace(/([.,;])\s*[.,;]+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!out || findUnbackedComplianceClaims(out, corpus).length > 0) {
    out = fallbackNote;
  }

  return { cleaned: out, removedClaims };
}

export function extractNamedLegalInstitution(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract' | 'url'>
): string | null {
  const urlLower = (sig.url || '').toLowerCase();
  if (urlLower.includes('echr.coe.int') || urlLower.includes('hudoc.echr.coe.int')) {
    return 'European Court of Human Rights';
  }
  if (urlLower.includes('curia.europa.eu')) {
    return 'Court of Justice of the European Union';
  }
  if (urlLower.includes('supremecourt.gov')) {
    return 'U.S. Supreme Court';
  }

  const hay = `${sig.title || ''} ${stripUiChromeBoilerplate(sig.rawAbstract || '').slice(0, 700)}`;
  const explicitMatch = hay.match(
    /\b(European Court of Human Rights|Court of Justice of the European Union|U\.S\. Supreme Court|Supreme Court of [A-Z][A-Za-z]+|Court of Appeals for the [A-Za-z0-9\s]+ Circuit|U\.S\. District Court(?:\s+for\s+the\s+[A-Z][A-Za-z\s]+)?|Federal Trade Commission|Securities and Exchange Commission|European Commission|European rights court)\b/i
  );
  return explicitMatch ? explicitMatch[1].trim() : null;
}

function textMentionsLegalInstitution(text: string, institution: string): boolean {
  const low = (text || '').toLowerCase();
  if (low.includes(institution.toLowerCase())) return true;
  if (
    institution === 'European Court of Human Rights' &&
    (/\beuropean rights court\b/i.test(low) || /\bechr\b/i.test(low))
  ) {
    return true;
  }
  if (
    institution === 'European rights court' &&
    (/\beuropean court of human rights\b/i.test(low) || /\bechr\b/i.test(low))
  ) {
    return true;
  }
  if (institution === 'U.S. Supreme Court' && /\bsupreme court\b/i.test(low)) {
    return true;
  }
  return false;
}

export function validateSummaryProseScope(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract' | 'url'>,
  summaryText: string
): { valid: boolean; reason?: string } {
  const txt = (summaryText || '').trim();
  if (!txt) return { valid: true };

  if (isConditionalPolicyHeadline(sig)) {
    const invertedPolicyRegex =
      /\b(?:block|ban)(?:s|ing)?\s+schools\s+from\s+(?:using\s+)?(?:gemini|ai)\b/i;
    if (invertedPolicyRegex.test(txt)) {
      return { valid: false, reason: 'Summary inverted conditional policy target' };
    }
  }

  if (isLegalOrCourtRulingSignal(sig)) {
    const inst = extractNamedLegalInstitution(sig);
    const sourceHay = `${sig.title || ''} ${sig.rawAbstract || ''}`.toLowerCase();
    const sourceHasGeneralPracticeBan =
      /\b(?:practicing\s+law|practice\s+of\s+law|disbarred)\b/i.test(sourceHay);

    if (
      !sourceHasGeneralPracticeBan &&
      /\b(?:barred|banned|suspended)\s+from\s+practicing(?:\s+law)?\b|\bdisbarred\b/i.test(txt)
    ) {
      return {
        valid: false,
        reason: 'Summary broadened court sanction to practicing law ban',
      };
    }

    if (inst) {
      if (/\b(?:representing\s+(?:clients|applicants|litigants)\s+in\s+court|(?:barred|banned|excluded)\s+from\s+court)\b/i.test(txt)) {
        return {
          valid: false,
          reason: `Summary flattened "${inst}" into generic "in court"`,
        };
      }
      if (
        /\b(?:bar(?:s|red)?|ban(?:s|ned)?|exclud(?:e|es|ed)|sanction\w*|decision|ruling)\b/i.test(
          txt
        ) &&
        !textMentionsLegalInstitution(txt, inst)
      ) {
        return {
          valid: false,
          reason: `Summary omitted named institution "${inst}"`,
        };
      }
    }
  }

  return { valid: true };
}

export function repairSummaryProseScope(
  sig: Pick<SpatialSignal, 'title' | 'rawAbstract' | 'url'>,
  text: string
): string {
  if (!text || !isLegalOrCourtRulingSignal(sig)) return text;
  const inst = extractNamedLegalInstitution(sig);
  const targetLabel = inst || 'that court';

  let out = text;
  const sourceHay = `${sig.title || ''} ${sig.rawAbstract || ''}`.toLowerCase();
  const sourceHasGeneralPracticeBan =
    /\b(?:practicing\s+law|practice\s+of\s+law|disbarred)\b/i.test(sourceHay);

  if (!sourceHasGeneralPracticeBan) {
    out = out
      .replace(
        /\b(?:barred|banned|suspended)\s+from\s+practicing(?:\s+law)?\b/gi,
        `barred from representing applicants before the ${targetLabel}`
      )
      .replace(/\bdisbarred\b/gi, `barred before the ${targetLabel}`);
  }

  out = out
    .replace(
      /\brepresenting\s+(?:clients|applicants|litigants)\s+in\s+court\b/gi,
      `representing applicants before the ${targetLabel}`
    )
    .replace(
      /\b((?:barred|banned|excluded|suspended))\s+from\s+court\b/gi,
      `$1 before the ${targetLabel}`
    )
    .replace(/\bThe court's decision\b/gi, `The ${targetLabel}'s decision`)
    .replace(/\bthe court's decision\b/gi, `the ${targetLabel}'s decision`);

  if (inst && !textMentionsLegalInstitution(out, inst)) {
    out = out.replace(
      /\bbefore the Court\b/g,
      `before the ${inst}`
    );
  }

  return out;
}
