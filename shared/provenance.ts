import { stripHtmlMarkupAndEntities } from './literacyEngine';
import {
  SECTOR_BY_ID,
  SpatialSignal,
  SupportingSourceLink,
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
  sig: Pick<SpatialSignal, 'title' | 'primarySector' | 'source' | 'sourceCategory' | 'url'>
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

  const cleanedRaw = stripHtmlMarkupAndEntities(sig.rawAbstract || '')
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
  /\b(may have been|might have been|could have been|claims? to have|purports?|reportedly|allegedly|unverified|unconfirmed|rumou?r(?:ed)?|if true|not independently verified|awaiting peer review)\b/i;

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
  /\b(api|apis|sdk|cli|weights|open[- ]source|open[- ]weights|benchmark|context window|tokens?\/s|tok\/s|latency|throughput|vram|tpu|cuda|rocm|gguf|fp8|fp16|int4|int8|quantiz(?:ed|ation)|fine-tun(?:e|ing|ed)|distill(?:ed|ation)|kv cache|mixture of experts|moe\b|mcp\b|tool[- ]calling|function calling|json schema|oauth|docker|kubernetes|helm|wasm|rust|python|typescript|pip install|npm install|brew install|v\d+\.\d+\.\d+)\b|\b\d+(?:\.\d+)?[bm]\s*(?:params?|parameters?)\b|\bgithub\.com\/|\bhuggingface\.co\/|\barxiv\.org\/abs\//i;

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
    Boolean(sig.modelSpecs)
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
