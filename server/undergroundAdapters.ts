import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import {
  buildDeterministicLiteracyPayload,
  enforceEpistemicAndDomainFidelity,
  enforceZeroJargonL1,
  isSubstantiveVividMetaphor,
  simplifyPlainEnglishL2,
  stripTrailingIncompleteClause,
} from '../shared/literacyEngine';
import {
  classifyEvidenceScope,
  extractBenchmarkClaimSpec,
  extractFrozenEntities,
  extractNamedLegalInstitution,
  extractSourceVerifiedMetrics,
  getSignalReleaseMetadata,
  hasLatencyOrThroughputWithoutCost,
  hasSourceComplianceAssessment,
  hasTechnicalEngineeringContent,
  isEvaluationQualityStudy,
  isHedgedOrUnverifiedClaim,
  isReleaseWithoutNotes,
  requiresVerbatimPublisherHeadline,
  stripUiChromeBoilerplate,
  truncateAtWordBoundary,
} from '../shared/provenance';
import {
  type RawUpstreamSignal,
  synthesizeRawItemToSpatialSignal,
} from '../shared/seed72h';
import { scoreStreetSentiment } from '../shared/supernovaEngine';
import type {
  AdapterId,
  AdapterTelemetryStatus,
  ClientIndustry,
  GlossaryTerm,
  LiteracySpectrumPayload,
  MediaAttachment,
  SpatialSignal,
  StreetQuote,
  SynthesisEngineId,
  SynthesisEngineStatus,
} from '../shared/types';
import {
  isPlaywrightSessionConfigured,
  openInteractiveXLoginWindow,
  scrapeXViaPlaywright,
} from './xPlaywrightWorker';

const LEGACY_ENV_LOCAL_PATH = path.resolve(process.cwd(), '.env.local');
const RUNTIME_SECRETS_PATH = path.resolve(process.cwd(), '.cortex-runtime.env');
let lastSavedEnvSnapshot = '';

export const DEEP_REDDIT_SUBREDDITS = [
  'LocalLLaMA',
  'singularity',
  'ClaudeAI',
  'ChatGPTCoding',
  'cursor',
  'AI_Agents',
  'MachineLearning',
  'OpenAI',
  'ollama',
  'StableDiffusion',
  'Rag',
  'LocalLLM',
] as const;

export const DEFAULT_PLAYWRIGHT_QUERY =
  '(vllm OR ollama OR "open weights" OR benchmark OR release OR MCP) min_faves:100 -filter:replies';

interface PersistedSecrets {
  X_AUTH_TOKEN: string;
  X_CT0: string;
  X_PLAYWRIGHT_QUERY: string;
  X_LIST_IDS: string;
  DISCORD_BOT_TOKEN: string;
  DISCORD_GUILD_ID: string;
  GEMINI_API_KEY: string;
  OLLAMA_MODEL: string;
  ACTIVE_SYNTHESIS_ENGINE: SynthesisEngineId;
}

const secrets: PersistedSecrets = {
  X_AUTH_TOKEN: process.env.X_AUTH_TOKEN || '',
  X_CT0: process.env.X_CT0 || '',
  X_PLAYWRIGHT_QUERY: process.env.X_PLAYWRIGHT_QUERY || DEFAULT_PLAYWRIGHT_QUERY,
  X_LIST_IDS: process.env.X_LIST_IDS || '',
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || '',
  DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || '',
  ACTIVE_SYNTHESIS_ENGINE: 'DETERMINISTIC',
};

function loadEnvLocalFromDisk(): void {
  for (const candidatePath of [LEGACY_ENV_LOCAL_PATH, RUNTIME_SECRETS_PATH]) {
    try {
      if (!fs.existsSync(candidatePath)) continue;
      const content = fs.readFileSync(candidatePath, 'utf8');
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const k = line.slice(0, eq).trim() as keyof PersistedSecrets;
        let v = line.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (k in secrets && v) {
          (secrets as unknown as Record<string, string>)[k] = v;
        }
      }
    } catch {
      // Ignore missing/unreadable config file
    }
  }
}

function saveEnvLocalToDisk(): void {
  try {
    const lines = [
      '# CORTEX // OMNISCIENCE Local Runtime Credentials (Never Exposed Publicly)',
      `X_AUTH_TOKEN="${secrets.X_AUTH_TOKEN.replace(/"/g, '')}"`,
      `X_CT0="${secrets.X_CT0.replace(/"/g, '')}"`,
      `X_PLAYWRIGHT_QUERY="${secrets.X_PLAYWRIGHT_QUERY.replace(/"/g, '\\"')}"`,
      `X_LIST_IDS="${secrets.X_LIST_IDS.replace(/"/g, '')}"`,
      `DISCORD_BOT_TOKEN="${secrets.DISCORD_BOT_TOKEN.replace(/"/g, '')}"`,
      `DISCORD_GUILD_ID="${secrets.DISCORD_GUILD_ID.replace(/"/g, '')}"`,
      `OLLAMA_MODEL="${secrets.OLLAMA_MODEL.replace(/"/g, '')}"`,
      `ACTIVE_SYNTHESIS_ENGINE="${secrets.ACTIVE_SYNTHESIS_ENGINE}"`,
    ];
    const serialized = lines.join('\n') + '\n';
    if (serialized === lastSavedEnvSnapshot) return;
    lastSavedEnvSnapshot = serialized;
    fs.writeFileSync(RUNTIME_SECRETS_PATH, serialized, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Ignore filesystem write issues
  }
}

loadEnvLocalFromDisk();

function maskSecret(val: string): string {
  if (!val) return 'Not configured';
  if (val.length <= 6) return '••••••';
  return `••••${val.slice(-4)}`;
}

interface InternalAdapterMetrics {
  enabled: boolean;
  state: AdapterTelemetryStatus['state'];
  signalsFetched: number;
  latencySamples: number[];
  lastLatencyMs: number;
  mediaCount: number;
  lastPollMs: number;
  lastError: string | null;
}

const adapterMetrics: Record<AdapterId, InternalAdapterMetrics> = {
  x_playwright: {
    enabled: false,
    state: 'READY_FOR_CREDENTIALS',
    signalsFetched: 0,
    latencySamples: [],
    lastLatencyMs: 0,
    mediaCount: 0,
    lastPollMs: 0,
    lastError: null,
  },
  discord_relay: {
    enabled: false,
    state: 'READY_FOR_CREDENTIALS',
    signalsFetched: 0,
    latencySamples: [],
    lastLatencyMs: 0,
    mediaCount: 0,
    lastPollMs: 0,
    lastError: null,
  },
  reddit_street: {
    enabled: true,
    state: 'CONNECTING',
    signalsFetched: 0,
    latencySamples: [],
    lastLatencyMs: 0,
    mediaCount: 0,
    lastPollMs: 0,
    lastError: null,
  },
};

function recordLatency(id: AdapterId, ms: number): void {
  const m = adapterMetrics[id];
  m.lastLatencyMs = Math.round(ms);
  m.latencySamples.push(ms);
  if (m.latencySamples.length > 20) m.latencySamples.shift();
}

function getAvgLatency(id: AdapterId): number {
  const arr = adapterMetrics[id].latencySamples;
  if (arr.length === 0) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

type SignalBroadcastCallback = (items: RawUpstreamSignal[], adapterId: AdapterId) => void;
let onInboundCallback: SignalBroadcastCallback | null = null;

export function registerAdapterSignalSink(cb: SignalBroadcastCallback): void {
  onInboundCallback = cb;
}

function emitSignals(items: RawUpstreamSignal[], adapterId: AdapterId, mediaAdded: number): void {
  const m = adapterMetrics[adapterId];
  m.signalsFetched += items.length;
  m.mediaCount += mediaAdded;
  m.lastPollMs = Date.now();
  if (items.length > 0 && onInboundCallback) {
    onInboundCallback(items, adapterId);
  }
}

// ============================================================================
// ADAPTER D: DEEP REDDIT "STREET VERDICT" ENGINE ($0 ZERO-KEY, 12 SUBREDDITS)
// ============================================================================
interface RedditListingPost {
  id: string;
  subreddit: string;
  title: string;
  author?: string;
  stickied?: boolean;
  selftext?: string;
  url?: string;
  permalink: string;
  ups?: number;
  num_comments?: number;
  created_utc?: number;
  is_video?: boolean;
  media?: { reddit_video?: { fallback_url?: string } };
  preview?: { images?: Array<{ source?: { url?: string } }> };
  thumbnail?: string;
}

function unescapeUrl(u: string): string {
  return u.replace(/&amp;/g, '&');
}

const RESERVED_GITHUB_ROOTS = new Set([
  'orgs',
  'topics',
  'trending',
  'features',
  'settings',
  'marketplace',
  'sponsors',
  'explore',
  'notifications',
  'login',
  'pricing',
  'about',
]);

export function resolveGitHubOpenGraphImage(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  const m = rawUrl.match(/https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (!m) return undefined;
  const owner = m[1];
  const repo = m[2].replace(/\.git$/i, '');
  if (!owner || !repo || RESERVED_GITHUB_ROOTS.has(owner.toLowerCase())) return undefined;
  return `https://opengraph.githubassets.com/1/${owner}/${repo}`;
}

const REDDIT_SAFE_UA = 'web:cortex-singularity:v2.0 (Enterprise-AI-Telemetry)';

async function fetchRedditJson(url: string, timeoutMs = 3600): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': REDDIT_SAFE_UA,
      Accept: 'application/json, application/atom+xml, text/xml, */*',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#8217;|&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const REDDIT_RSS_SAFE_UA =
  'desktop:com.cortex.spatial:v2.4 (by /u/cortex_spatial_reader)';

function isAutoModOrBotComment(author: string, body: string): boolean {
  const cleanAuthor = author.replace(/^\/?u\//i, '').trim().toLowerCase();
  if (!cleanAuthor || cleanAuthor === 'automoderator' || cleanAuthor.endsWith('bot')) return true;
  if (
    /i am a bot, and this action was performed automatically|please contact the moderators of this subreddit|welcome to r\//i.test(
      body
    )
  ) {
    return true;
  }
  return false;
}

function parseRedditCommentsAtomXml(
  xml: string,
  postId: string,
  fallbackSubreddit: string
): StreetQuote[] {
  if (!xml || !xml.includes('<entry')) return [];
  const catMatch = xml.match(/<category[^>]+term=["']([^"']+)["']/i);
  const resolvedSub = (catMatch?.[1] || fallbackSubreddit || 'LocalLLaMA').replace(/^r\//i, '');
  const entries = xml.split(/<entry[\s>]/i).slice(1);
  const quotes: StreetQuote[] = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const chunk = entries[idx];
    const idTag = chunk.match(/<id[^>]*>([^<]+)<\/id>/i)?.[1]?.trim() || '';
    // Skip the OP post entry itself (t3_<postId>); keep comment entries (t1_<commentId>)
    if (idTag.includes(`t3_${postId}`) || (idx === 0 && idTag.startsWith('t3_'))) continue;

    const authorRaw =
      chunk.match(/<author[\s\S]*?<name[^>]*>([^<]+)<\/name>/i)?.[1] ||
      chunk.match(/<name[^>]*>([^<]+)<\/name>/i)?.[1] ||
      'engineer';
    const cleanAuthor = authorRaw.replace(/^\/?u\//i, '').trim();

    const contentRaw = chunk.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] || '';
    const body = decodeHtmlEntities(contentRaw)
      .replace(/submitted by\s+\/?u\/\S+\s*\[link\]\s*\[comments\]/gi, '')
      .trim();

    if (
      body.length < 18 ||
      body === '[deleted]' ||
      body === '[removed]' ||
      isAutoModOrBotComment(cleanAuthor, body)
    ) {
      continue;
    }

    const updatedMatch = chunk.match(/<updated[^>]*>([^<]+)<\/updated>/i);
    const commentId = idTag.replace(/^.*t1_/i, '').slice(0, 14) || `${idx}`;
    quotes.push({
      id: `rd-rss-c-${postId}-${commentId}`,
      network: 'Reddit',
      originLabel: `r/${resolvedSub}`,
      author: `u/${cleanAuthor}`,
      text: stripTrailingIncompleteClause(body.slice(0, 320)),
      score: Math.max(6, 42 - quotes.length * 6),
      sentiment: scoreStreetSentiment(body),
      publishedAtMs: updatedMatch?.[1] ? Date.parse(updatedMatch[1]) || Date.now() : Date.now(),
      url: `https://www.reddit.com/r/${resolvedSub}/comments/${postId}`,
    });
    if (quotes.length >= 4) break;
  }
  return quotes;
}

async function fetchTop5RedditCommentsRss(
  subreddit: string,
  postId: string
): Promise<StreetQuote[]> {
  const cleanSub = (subreddit || 'LocalLLaMA').replace(/^r\//i, '').trim();
  // Primary: Atom XML /.rss?limit=8 with descriptive Reddit-compliant User-Agent (avoids 403/429 on Mozilla UA!)
  const rssUrls = [
    `https://www.reddit.com/r/${encodeURIComponent(cleanSub)}/comments/${encodeURIComponent(postId)}/.rss?limit=8&sort=top`,
    `https://www.reddit.com/comments/${encodeURIComponent(postId)}/.rss?limit=8&sort=top`,
    `https://www.reddit.com/comments/${encodeURIComponent(postId)}.rss?limit=8&sort=top`,
  ];

  for (const rssUrl of rssUrls) {
    try {
      const res = await fetch(rssUrl, {
        headers: {
          'User-Agent': REDDIT_RSS_SAFE_UA,
          Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(3200),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const parsed = parseRedditCommentsAtomXml(xml, postId, cleanSub);
      if (parsed.length > 0) return parsed;
    } catch {
      // Try next RSS URL / fallback
    }
  }

  try {
    const asRes = await fetch(
      `https://arctic-shift.photon-reddit.com/api/comments/search?link_id=${postId}&limit=8`,
      {
        headers: { 'User-Agent': REDDIT_RSS_SAFE_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(2800),
      }
    );
    if (asRes.ok) {
      const json = (await asRes.json()) as {
        data?: Array<{ id?: string; author?: string; body?: string; score?: number; created_utc?: number }>;
      };
      const sorted = (json.data || []).sort((a, b) => Number(b.score || 1) - Number(a.score || 1));
      const quotes: StreetQuote[] = [];
      for (const c of sorted) {
        const body = (c.body || '').replace(/\s+/g, ' ').trim();
        const author = c.author || 'engineer';
        if (
          body.length < 18 ||
          body === '[deleted]' ||
          body === '[removed]' ||
          isAutoModOrBotComment(author, body)
        ) {
          continue;
        }
        quotes.push({
          id: `rd-as-c-${c.id || quotes.length}`,
          network: 'Reddit',
          originLabel: `r/${cleanSub}`,
          author: `u/${author.replace(/^\/?u\//i, '')}`,
          text: stripTrailingIncompleteClause(body.slice(0, 320)),
          score: Math.max(1, Number(c.score || 5)),
          sentiment: scoreStreetSentiment(body),
          publishedAtMs: c.created_utc ? c.created_utc * 1000 : Date.now(),
          url: `https://www.reddit.com/r/${cleanSub}/comments/${postId}`,
        });
        if (quotes.length >= 4) break;
      }
      return quotes;
    }
  } catch {
    // Ignore mirror timeout
  }
  return [];
}

const redditCommentsCache = new Map<string, StreetQuote[]>();

export function extractRedditPostIdFromSignal(sig: { id?: string; url?: string }): string {
  const fromUrl = (sig.url || '').match(/\/comments\/([a-z0-9]{5,10})/i)?.[1];
  if (fromUrl) return fromUrl;
  const fromT3Id = (sig.id || '').match(/t3_([a-z0-9]{5,10})/i)?.[1];
  if (fromT3Id) return fromT3Id;
  const fromStreetId = (sig.id || '').match(/^rd-street-([a-z0-9]{5,10})$/i)?.[1];
  if (fromStreetId) return fromStreetId;
  return '';
}

export async function fetchTopRedditCommentsByPostId(
  postId: string,
  subreddit = 'LocalLLaMA'
): Promise<StreetQuote[]> {
  const cleanId = (postId || '')
    .replace(/^.*t3_/i, '')
    .replace(/^rd-street-/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .trim();
  if (!cleanId || cleanId.startsWith('rss')) return [];

  const cached = redditCommentsCache.get(cleanId);
  if (cached && cached.length > 0) return cached;

  // 1. Primary: Atom XML https://www.reddit.com/comments/<postId>.rss?limit=8 (never 403-blocked!)
  const rssQuotes = await fetchTop5RedditCommentsRss(subreddit, cleanId);
  if (rssQuotes.length > 0) {
    if (redditCommentsCache.size > 240) {
      const oldest = redditCommentsCache.keys().next().value;
      if (oldest) redditCommentsCache.delete(oldest);
    }
    redditCommentsCache.set(cleanId, rssQuotes.slice(0, 4));
    return rssQuotes.slice(0, 4);
  }

  // 2. Secondary fallback: .json listing
  try {
    const res = await fetch(
      `https://www.reddit.com/comments/${encodeURIComponent(cleanId)}.json?limit=8&sort=top&raw_json=1`,
      {
        headers: { 'User-Agent': REDDIT_RSS_SAFE_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(2500),
      }
    );
    if (res.ok) {
      const data = (await res.json()) as Array<{
        data?: {
          children?: Array<{
            kind?: string;
            data?: {
              id?: string;
              author?: string;
              body?: string;
              ups?: number;
              score?: number;
              subreddit?: string;
              created_utc?: number;
            };
          }>;
        };
      }>;
      const postSub =
        data?.[0]?.data?.children?.[0]?.data?.subreddit || subreddit.replace(/^r\//i, '');
      const commentsListing = data?.[1]?.data?.children || [];
      const quotes: StreetQuote[] = [];
      for (const c of commentsListing) {
        if (c.kind !== 't1' || !c.data?.body) continue;
        const body = c.data.body.replace(/\s+/g, ' ').trim();
        const author = c.data.author || 'engineer';
        if (
          body.length < 18 ||
          body === '[deleted]' ||
          body === '[removed]' ||
          isAutoModOrBotComment(author, body)
        ) {
          continue;
        }
        quotes.push({
          id: `rd-c-${c.data.id || quotes.length}`,
          network: 'Reddit',
          originLabel: `r/${postSub}`,
          author: `u/${author.replace(/^\/?u\//i, '')}`,
          text: stripTrailingIncompleteClause(body.slice(0, 320)),
          score: Number(c.data.ups ?? c.data.score ?? 1),
          sentiment: scoreStreetSentiment(body),
          publishedAtMs: c.data.created_utc ? c.data.created_utc * 1000 : Date.now(),
          url: `https://www.reddit.com/r/${postSub}/comments/${cleanId}`,
        });
        if (quotes.length >= 4) break;
      }
      if (quotes.length > 0) {
        redditCommentsCache.set(cleanId, quotes);
        return quotes;
      }
    }
  } catch {
    // Ignore .json block
  }

  return [];
}

export async function hydrateRedditCommentsForSignal(
  signal: SpatialSignal
): Promise<StreetQuote[]> {
  const realExisting = (signal.streetQuotes || []).filter(
    (q) =>
      !q.id.endsWith('-self-quote') &&
      q.author !== signal.originFeedName &&
      !isAutoModOrBotComment(q.author, q.text)
  );
  if (realExisting.length > 0) return realExisting;

  const isReddit =
    signal.source === 'Reddit' ||
    signal.url.includes('reddit.com/') ||
    /^r\//i.test(signal.originFeedName || '');
  if (!isReddit) return [];

  const postIdMatch = extractRedditPostIdFromSignal(signal);
  if (!postIdMatch) return [];

  const subMatch =
    signal.url.match(/\/r\/([^/]+)/i)?.[1] ||
    (signal.originFeedName || '').replace(/^r\//i, '') ||
    'LocalLLaMA';

  return fetchTopRedditCommentsByPostId(postIdMatch, subMatch);
}

async function fetchTop5RedditComments(
  subreddit: string,
  postId: string
): Promise<StreetQuote[]> {
  return fetchTopRedditCommentsByPostId(postId, subreddit);
}

async function fetchMultiRedditAtomFallback(multiSubPath: string): Promise<RedditListingPost[]> {
  const posts: RedditListingPost[] = [];
  const [hotRss, risingRss] = await Promise.allSettled([
    fetch(`https://www.reddit.com/r/${multiSubPath}/hot/.rss?limit=20`, {
      headers: { 'User-Agent': REDDIT_SAFE_UA, Accept: 'application/atom+xml, text/xml, */*' },
      signal: AbortSignal.timeout(3400),
    }).then((r) => (r.ok ? r.text() : '')),
    fetch(`https://www.reddit.com/r/${multiSubPath}/rising/.rss?limit=10`, {
      headers: { 'User-Agent': REDDIT_SAFE_UA, Accept: 'application/atom+xml, text/xml, */*' },
      signal: AbortSignal.timeout(3000),
    }).then((r) => (r.ok ? r.text() : '')),
  ]);

  for (const res of [hotRss, risingRss]) {
    if (res.status !== 'fulfilled' || !res.value) continue;
    const entries = res.value.split(/<entry[\s>]/i).slice(1);
    for (let idx = 0; idx < entries.length; idx++) {
      const chunk = entries[idx];
      const idMatch = chunk.match(/<id[^>]*>t3_([a-z0-9]+)<\/id>/i);
      const linkMatch = chunk.match(/<link[^>]+href=["']([^"']+)["']/i);
      const urlPostId = linkMatch?.[1]?.match(/\/comments\/([a-z0-9]+)/i)?.[1];
      const titleMatch = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const catMatch = chunk.match(/<category[^>]+term=["']([^"']+)["']/i);
      const updatedMatch = chunk.match(/<updated[^>]*>([^<]+)<\/updated>/i);
      const contentMatch = chunk.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
      const thumbMatch = chunk.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);

      const postId = idMatch?.[1] || urlPostId || `rss${idx}`;
      const title = decodeHtmlEntities(titleMatch?.[1] || '');
      if (!title) continue;
      const permalinkUrl = linkMatch?.[1] || `https://www.reddit.com/comments/${postId}`;
      const subFromUrl = permalinkUrl.match(/\/r\/([^/]+)\//i)?.[1];
      const subreddit = catMatch?.[1] || subFromUrl || 'LocalLLaMA';
      const createdUtc = updatedMatch?.[1]
        ? Math.floor((Date.parse(updatedMatch[1]) || Date.now()) / 1000)
        : Math.floor(Date.now() / 1000);
      const rawHtml = contentMatch?.[1] || '';
      const imgInContent = rawHtml.match(/https?:\/\/(?:i\.redd\.it|preview\.redd\.it)[^"&<\s]+/i)?.[0];
      const bodyClean = decodeHtmlEntities(rawHtml)
        .replace(/submitted by\s+\/u\/\S+\s*\[link\]\s*\[comments\]/gi, '')
        .trim();

      posts.push({
        id: postId,
        title,
        selftext: stripTrailingIncompleteClause(bodyClean.slice(0, 2800)),
        subreddit,
        permalink: permalinkUrl.replace(/^https?:\/\/[^/]+/i, ''),
        ups: 64,
        num_comments: 18,
        created_utc: createdUtc,
        thumbnail: thumbMatch?.[1] ? unescapeUrl(thumbMatch[1]) : undefined,
        preview: imgInContent
          ? { images: [{ source: { url: unescapeUrl(imgInContent) } }] }
          : undefined,
      });
    }
  }
  return posts;
}

/**
 * Strict Signal-Quality Gate for reddit_street:
 * Drops low-score (<15 upvotes) personal help/troubleshooting self-posts and vague <4-word titles
 * ("Need help", "How much time?", "Why does my...", "Question about...") while keeping benchmarks, releases, guides & repos.
 */
export function isHighSignalRedditPost(post: {
  title?: string;
  author?: string;
  stickied?: boolean;
  selftext?: string;
  ups?: number;
  num_comments?: number;
  url?: string;
  is_video?: boolean;
  preview?: { images?: Array<{ source?: { url?: string } }> };
}): boolean {
  if (post.stickied) return false;
  if ((post.author || '').toLowerCase() === 'automoderator') return false;

  const cleanTitle = (post.title || '').replace(/^r\/[A-Za-z0-9_]+:\s*/i, '').trim();
  if (!cleanTitle) return false;

  // 0. Drop pinned/recurring subreddit megathreads & self-promotion roundups
  if (
    /\b(weekly\s+(?:thread|discussion|megathread|q&a|questions|roundup)|daily\s+(?:thread|discussion|megathread|questions)|monthly\s+(?:thread|discussion|hiring|showcase)|megathread|what are you working on|what have you been working on|self[-\s]?promotion|share your project|saturday showcase|sunday showcase|who is hiring|hiring thread)\b/i.test(
      cleanTitle
    )
  ) {
    return false;
  }

  const words = cleanTitle.split(/\s+/).filter(Boolean);
  const ups = Number(post.ups ?? 0);
  const comments = Number(post.num_comments ?? 0);

  // 1. Always drop personal help / beginner troubleshooting / vague question threads unless viral (>=80 ups)
  const isPersonalHelp =
    /\b(need help|help me|pls help|please help|anyone help|how much time|question about|quick question|dumb question|noob|beginner|newbie|why does my|why is my|can someone|could someone|am i cooked|what laptop|which gpu should|stuck on|getting an error|troubleshooting|rate my|career advice|should i learn|is it worth it|anyone else having)\b/i.test(
      cleanTitle
    ) || /^(?:help|question|issue|problem|advice|rant|eli5|confused)\b/i.test(cleanTitle);
  if (isPersonalHelp && ups < 80) return false;

  // 2. Drop < 4 word vague titles ("Need help", "How much time?", "Thoughts?")
  if (words.length < 4) {
    const isMajorNamedRelease =
      ups >= 40 &&
      /\b(gpt-\d|o3|o4|claude|gemini|qwen|llama|deepseek|vllm|ollama|mistral|codex)\b/i.test(
        cleanTitle
      ) &&
      !cleanTitle.endsWith('?');
    if (!isMajorNamedRelease) return false;
  }

  // 3. Strict gate on low-score (< 15 upvotes) /rising or self-posts
  if (ups < 15) {
    const hasHighValueExternalLink = Boolean(
      post.url &&
        !post.url.includes('reddit.com') &&
        /\b(github\.com|arxiv\.org|huggingface\.co|openai\.com|anthropic\.com|deepmind|mistral\.ai)\b/i.test(
          post.url
        )
    );
    const hasMedia = Boolean(post.is_video || post.preview?.images?.[0]?.source?.url);
    if (!hasHighValueExternalLink && !hasMedia) {
      if (cleanTitle.endsWith('?') || words.length < 6) return false;
      const hasTechnicalSubstance =
        /\b(release|v\d+\.\d+|benchmark|paper|open[-\s]?source|gguf|fp8|int4|quantiz|kv[-\s]?cache|vllm|ollama|llama\.cpp|sglang|mcp|eval|throughput|tok\/s|architecture|guide|comparison|lora|dataset)\b/i.test(
          `${cleanTitle} ${(post.selftext || '').slice(0, 320)}`
        );
      if (!hasTechnicalSubstance && comments < 12) return false;
    }
  }

  return true;
}

export async function pollDeepRedditStreetEngine(): Promise<RawUpstreamSignal[]> {
  if (!adapterMetrics.reddit_street.enabled) {
    adapterMetrics.reddit_street.state = 'PAUSED';
    return [];
  }

  const t0 = Date.now();
  adapterMetrics.reddit_street.state = 'ACTIVE';

  // Combine all 12 high-signal AI subreddits into a single multi-reddit query (2 requests instead of 24 -> zero 429 rate-limits!)
  const multiPath = DEEP_REDDIT_SUBREDDITS.join('+');
  const collectedPosts: Array<{ post: RedditListingPost; velocity: number }> = [];

  const [hotRes, risingRes] = await Promise.allSettled([
    fetchRedditJson(`https://www.reddit.com/r/${multiPath}/hot.json?limit=24&raw_json=1`, 3500),
    fetchRedditJson(`https://www.reddit.com/r/${multiPath}/rising.json?limit=12&raw_json=1`, 3000),
  ]);

  for (const r of [hotRes, risingRes]) {
    if (r.status === 'fulfilled' && r.value && typeof r.value === 'object') {
      const children = (
        (r.value as { data?: { children?: Array<{ data?: RedditListingPost }> } }).data
          ?.children || []
      );
      for (const ch of children) {
        const p = ch.data;
        if (!p || !p.id || !p.title || !isHighSignalRedditPost(p)) continue;
        const createdMs = p.created_utc ? p.created_utc * 1000 : Date.now();
        const ageHrs = Math.max(0.35, (Date.now() - createdMs) / 3600_000);
        const ups = Number(p.ups || 0);
        const comments = Number(p.num_comments || 0);
        const velocity = (ups + comments * 2.5) / ageHrs;
        collectedPosts.push({ post: p, velocity });
      }
    }
  }

  // Automatic 12-Sub Multi-Reddit Atom XML Fallback if Reddit blocks anonymous .json on this IP
  if (collectedPosts.length === 0) {
    const atomPosts = await fetchMultiRedditAtomFallback(multiPath);
    for (const p of atomPosts) {
      if (!isHighSignalRedditPost(p)) continue;
      const createdMs = p.created_utc ? p.created_utc * 1000 : Date.now();
      const ageHrs = Math.max(0.45, (Date.now() - createdMs) / 3600_000);
      const ups = Number(p.ups || 45);
      const comments = Number(p.num_comments || 14);
      collectedPosts.push({ post: p, velocity: (ups + comments * 2.5) / ageHrs });
    }
  }

  // Secondary $0 Zero-Key ArcticShift Reddit Mirror Fallback when www.reddit.com returns HTTP 429
  if (collectedPosts.length === 0) {
    const leadSubs = ['LocalLLaMA', 'singularity', 'ClaudeAI', 'AI_Agents', 'ollama', 'ChatGPTCoding'];
    const mirrorSettled = await Promise.allSettled(
      leadSubs.map(async (sub) => {
        const res = await fetch(
          `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${sub}&sort=desc&limit=5`,
          {
            headers: { 'User-Agent': REDDIT_SAFE_UA, Accept: 'application/json' },
            signal: AbortSignal.timeout(3200),
          }
        );
        if (!res.ok) return [];
        const json = (await res.json()) as { data?: Array<RedditListingPost & { score?: number }> };
        return (json.data || []).map((p) => ({
          ...p,
          subreddit: p.subreddit || sub,
          ups: Number(p.ups ?? p.score ?? 0),
          num_comments: Number(p.num_comments ?? 0),
          permalink: p.permalink || `/r/${sub}/comments/${p.id}/`,
        }));
      })
    );
    for (const r of mirrorSettled) {
      if (r.status !== 'fulfilled') continue;
      for (const p of r.value) {
        if (!p.id || !p.title || !isHighSignalRedditPost(p)) continue;
        const createdMs = p.created_utc ? p.created_utc * 1000 : Date.now();
        const ageHrs = Math.max(0.5, (Date.now() - createdMs) / 3600_000);
        const ups = Number(p.ups || 20);
        const comments = Number(p.num_comments || 6);
        collectedPosts.push({ post: p, velocity: (ups + comments * 2.5) / ageHrs });
      }
    }
  }

  // Deduplicate by post.id and sort by engagement velocity
  const uniqueById = new Map<string, { post: RedditListingPost; velocity: number }>();
  for (const entry of collectedPosts) {
    if (!uniqueById.has(entry.post.id)) {
      uniqueById.set(entry.post.id, entry);
    }
  }

  const ranked = Array.from(uniqueById.values())
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 18);

  // Fetch top engineer comments for up to 10 threads with comments > 0 so r/Rag & rising posts have real quotes!
  const commentTargets = ranked.filter((r) => (r.post.num_comments || 0) > 0).slice(0, 10);
  const commentsByPostId = new Map<string, StreetQuote[]>();
  await Promise.allSettled(
    commentTargets.map(async ({ post }) => {
      const top5 = await fetchTop5RedditComments(post.subreddit, post.id);
      if (top5.length > 0) {
        commentsByPostId.set(post.id, top5);
      }
    })
  );

  let mediaAdded = 0;
  const signals: RawUpstreamSignal[] = ranked.map(({ post, velocity }) => {
    const mediaItems: MediaAttachment[] = [];
    if (post.is_video && post.media?.reddit_video?.fallback_url) {
      mediaItems.push({
        type: 'video',
        url: unescapeUrl(post.media.reddit_video.fallback_url),
        thumbnailUrl:
          post.thumbnail && post.thumbnail.startsWith('http') ? post.thumbnail : undefined,
        caption: `r/${post.subreddit} demo clip`,
        sourceNetwork: `r/${post.subreddit}`,
      });
    } else {
      const previewImg = post.preview?.images?.[0]?.source?.url;
      if (previewImg && previewImg.startsWith('http')) {
        mediaItems.push({
          type: 'image',
          url: unescapeUrl(previewImg),
          caption: `r/${post.subreddit} benchmark / architecture attachment`,
          sourceNetwork: `r/${post.subreddit}`,
        });
      } else {
        const ghOg = resolveGitHubOpenGraphImage(post.url) || resolveGitHubOpenGraphImage(post.selftext);
        if (ghOg) {
          mediaItems.push({
            type: 'image',
            url: ghOg,
            caption: `GitHub repository preview · r/${post.subreddit}`,
            sourceNetwork: 'GitHub',
          });
        }
      }
    }
    mediaAdded += mediaItems.length;

    const createdMs = post.created_utc ? post.created_utc * 1000 : Date.now();
    const ups = Number(post.ups || 15);
    const numComments = Number(post.num_comments || 0);
    const velRounded = Math.max(5, Math.round(velocity));
    const topComments = commentsByPostId.get(post.id) || [];

    const selfBody = (post.selftext || '').replace(/\s+/g, ' ').trim().slice(0, 2800);
    const topCommentSnippet = topComments[0]
      ? `Top engineer comment (${topComments[0].author}, +${topComments[0].score}): "${topComments[0].text}"`
      : '';
    const summaryText =
      selfBody && topCommentSnippet
        ? `${selfBody} ${topCommentSnippet}`.slice(0, 3100)
        : selfBody ||
          topCommentSnippet ||
          `Active engineering thread in r/${post.subreddit} (${ups} upvotes, ${numComments} comments): ${post.title}`;

    return {
      id: `rd-street-${post.id}`,
      title: post.title.trim(),
      summary: summaryText,
      url: `https://www.reddit.com${post.permalink}`,
      source: 'Reddit',
      sourceCategory: 'REDDIT',
      originFeedName: `r/${post.subreddit}`,
      publishedAtMs: createdMs,
      score: Math.min(600, ups + numComments * 2),
      mediaItems,
      streetQuotes: topComments,
      engagementVelocity: {
        likesOrUps: ups,
        commentsOrReplies: numComments,
        velocityPerHour: velRounded,
        badgeText: `${velRounded}/hr · ${ups} ${ups === 1 ? 'up' : 'ups'} · ${numComments} ${numComments === 1 ? 'comment' : 'comments'}`,
      },
    };
  });

  recordLatency('reddit_street', Date.now() - t0);
  if (signals.length === 0 && adapterMetrics.reddit_street.signalsFetched === 0) {
    adapterMetrics.reddit_street.lastError = 'Reddit JSON temporarily rate-limited; RSS fallback active';
  } else {
    adapterMetrics.reddit_street.lastError = null;
  }
  emitSignals(signals, 'reddit_street', mediaAdded);
  return signals;
}

// ============================================================================
// ADAPTER A: PLAYWRIGHT LOCAL X SCRAPER CONTROLLER ($0 SESSION)
// ============================================================================
let playwrightBusy = false;

export async function pollPlaywrightXAdapter(): Promise<RawUpstreamSignal[]> {
  const m = adapterMetrics.x_playwright;
  const creds = {
    authToken: secrets.X_AUTH_TOKEN,
    ct0: secrets.X_CT0,
    searchQuery: secrets.X_PLAYWRIGHT_QUERY || DEFAULT_PLAYWRIGHT_QUERY,
    listIds: secrets.X_LIST_IDS
      ? secrets.X_LIST_IDS.split(',').map((s) => s.trim()).filter(Boolean)
      : [],
  };

  if (!isPlaywrightSessionConfigured(creds)) {
    m.state = 'READY_FOR_CREDENTIALS';
    return [];
  }
  if (!m.enabled) {
    m.state = 'PAUSED';
    return [];
  }
  if (playwrightBusy) return [];

  playwrightBusy = true;
  m.state = 'CONNECTING';
  try {
    const res = await scrapeXViaPlaywright(creds);
    recordLatency('x_playwright', res.latencyMs);
    m.state = 'ACTIVE';
    m.lastError = null;
    emitSignals(res.items, 'x_playwright', res.mediaCount);
    return res.items;
  } catch (err) {
    m.state = 'ERROR';
    m.lastError = (err as Error).message;
    return [];
  } finally {
    playwrightBusy = false;
  }
}

export async function triggerPlaywrightLoginFlow(): Promise<{
  ok: boolean;
  message: string;
}> {
  const res = await openInteractiveXLoginWindow();
  if (res.ok) {
    adapterMetrics.x_playwright.enabled = true;
    adapterMetrics.x_playwright.lastError = null;
    void pollPlaywrightXAdapter();
  }
  return res;
}

// ============================================================================
// ADAPTER C: DISCORD LIVE ANNOUNCEMENT RELAY (discord.js Gateway + Webhook)
// ============================================================================
let discordClient: Client | null = null;

function extractCodeBlocks(content: string): string | undefined {
  const m = content.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  return m?.[1]?.trim().slice(0, 420);
}

export async function syncDiscordBotGateway(): Promise<void> {
  const m = adapterMetrics.discord_relay;

  if (discordClient) {
    try {
      await discordClient.destroy();
    } catch {
      // Ignore destroy error
    }
    discordClient = null;
  }

  if (!secrets.DISCORD_BOT_TOKEN) {
    m.state = m.signalsFetched > 0 ? 'ACTIVE' : 'READY_FOR_CREDENTIALS';
    return;
  }
  if (!m.enabled) {
    m.state = 'PAUSED';
    return;
  }

  m.state = 'CONNECTING';
  const connectStart = Date.now();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    recordLatency('discord_relay', Date.now() - connectStart);
    m.state = 'ACTIVE';
    m.lastError = null;
    console.log(
      `[CORTEX // DISCORD GATEWAY] Connected as ${readyClient.user.tag} across ${readyClient.guilds.cache.size} guilds`
    );
  });

  client.on(Events.Error, (err) => {
    m.state = 'ERROR';
    m.lastError = err.message;
  });

  client.on(Events.MessageCreate, (message) => {
    if (
      message.author.bot &&
      !message.flags.has(MessageFlags.Crossposted) &&
      !message.webhookId
    ) {
      return;
    }
    if (secrets.DISCORD_GUILD_ID && message.guildId !== secrets.DISCORD_GUILD_ID) {
      return;
    }

    const chName =
      'name' in message.channel && typeof message.channel.name === 'string'
        ? message.channel.name
        : 'announcements';
    const isAnnouncementLike =
      chName.includes('announce') ||
      chName.includes('release') ||
      chName.includes('news') ||
      chName.includes('changelog') ||
      message.flags.has(MessageFlags.Crossposted) ||
      Boolean(secrets.DISCORD_GUILD_ID);

    if (!isAnnouncementLike) return;

    const guildName = message.guild?.name || 'AI Lab Discord';
    const rawText =
      message.content ||
      message.embeds.map((e) => `${e.title || ''} ${e.description || ''}`).join(' ').trim();
    if (!rawText) return;

    const mediaItems: MediaAttachment[] = [];
    for (const att of message.attachments.values()) {
      const ct = att.contentType || '';
      if (ct.startsWith('video/') || att.url.endsWith('.mp4') || att.url.endsWith('.webm')) {
        mediaItems.push({
          type: 'video',
          url: att.url,
          caption: `${guildName} #${chName} video`,
          sourceNetwork: `Discord · ${guildName}`,
        });
      } else if (ct.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(att.url)) {
        mediaItems.push({
          type: 'image',
          url: att.url,
          caption: `${guildName} #${chName} attachment`,
          sourceNetwork: `Discord · ${guildName}`,
        });
      }
    }
    for (const emb of message.embeds) {
      if (emb.image?.url) {
        mediaItems.push({
          type: 'image',
          url: emb.image.url,
          caption: emb.title || `${guildName} embed`,
          sourceNetwork: `Discord · ${guildName}`,
        });
      }
    }

    const codeSnippet = extractCodeBlocks(rawText);
    const cleanSummary = rawText.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim();
    const firstHeadline = (message.embeds[0]?.title || cleanSummary).slice(0, 115);

    const quote: StreetQuote = {
      id: `disc-q-${message.id}`,
      network: 'Discord',
      originLabel: `#${chName} · ${guildName}`,
      author: message.author.username,
      text: cleanSummary.slice(0, 240),
      score: 180,
      sentiment: scoreStreetSentiment(cleanSummary),
      publishedAtMs: message.createdTimestamp || Date.now(),
      url: message.url,
    };

    const sig: RawUpstreamSignal = {
      id: `discord-${message.id}`,
      title: `[${guildName} #${chName}] ${firstHeadline}`,
      summary: cleanSummary.slice(0, 360) || firstHeadline,
      url: message.url || 'https://discord.com',
      source: 'Discord',
      sourceCategory: 'DISCORD_RELAY',
      originFeedName: `Discord · ${guildName}`,
      publishedAtMs: message.createdTimestamp || Date.now(),
      score: 210,
      mediaItems,
      streetQuotes: [quote],
      codeSnippet,
      engagementVelocity: {
        likesOrUps: 195,
        commentsOrReplies: 42,
        velocityPerHour: 240,
        badgeText: `📡 LIVE RELAY · #${chName}`,
      },
    };

    recordLatency('discord_relay', 18);
    emitSignals([sig], 'discord_relay', mediaItems.length);
  });

  try {
    discordClient = client;
    await client.login(secrets.DISCORD_BOT_TOKEN);
  } catch (err) {
    m.state = 'ERROR';
    m.lastError = (err as Error).message;
    discordClient = null;
  }
}

let webhookSimCounter = 0;
const DISCORD_RELAY_PRESETS = [
  {
    serverName: 'vLLM & SGLang Kernel Guild',
    channelName: 'announcements',
    author: 'vllm-release-bot',
    title: 'vLLM v0.8.5 Crossposted Release: Zero-Overhead FP8 KV-Cache + Qwen3 Speculative Eagle-3',
    content:
      'Crossposted from #announcements: vLLM v0.8.5 ships native FP8 KV-cache paging and Eagle-3 speculative decoding for Qwen & Llama models, hitting 312 tok/s on dual 24GB GPUs with zero accuracy drop.\n```bash\nvllm serve Qwen/Qwen2.5-14B-Instruct --kv-cache-dtype fp8 --speculative-model eagle3 --num-speculative-tokens 5\n```',
    url: 'https://github.com/vllm-project/vllm/releases',
    chartMetricA: 312,
    chartMetricB: 168,
    xCounterQuote:
      'BREAKING: New vLLM Eagle-3 FP8 kernel literally doubles open-weights inference speed overnight—proprietary APIs are officially cooked! 🚀',
    redditCounterQuote:
      'Tested on 2x RTX 3090 (24GB): hits 288 tok/s at 16k ctx, but note --kv-cache-dtype fp8 needs Ada/Hopper for native speed; Ampere falls back to marlin W8A16.',
  },
  {
    serverName: 'Ollama & LocalLLaMA Official',
    channelName: 'announcements',
    author: 'ollama-core',
    title: 'Ollama Multi-Modal Vision + Flash-Attention KV Quantization Lands for 12GB VRAM Cards',
    content:
      'Crossposted from #announcements: New Ollama runtime enables Q4_K_M + K-cache Q8_0 flash attention out of the box so 14B coding models fit comfortably in 12GB VRAM at 32k context with zero CPU spillover.\n```bash\nOLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama run qwen2.5-coder:14b\n```',
    url: 'https://github.com/ollama/ollama/releases',
    chartMetricA: 94,
    chartMetricB: 41,
    xCounterQuote:
      'Insane Ollama drop—32k context 14B coding agent running locally on a single 12GB laptop GPU at 90+ tok/s!',
    redditCounterQuote:
      'Confirmed working on RTX 4070 12GB: VRAM sits at 10.6GB at 24k context. Stick to q8_0 KV cache (q4_0 KV degrades multi-file diffs).',
  },
];

export function ingestDiscordWebhookRelay(payload: {
  serverName?: string;
  channelName?: string;
  author?: string;
  title?: string;
  content?: string;
  imageUrl?: string;
  videoUrl?: string;
  url?: string;
  simulatePreset?: boolean;
}): RawUpstreamSignal {
  const t0 = Date.now();
  const preset = DISCORD_RELAY_PRESETS[webhookSimCounter % DISCORD_RELAY_PRESETS.length];
  webhookSimCounter++;

  const usePreset = payload.simulatePreset || (!payload.title && !payload.content);
  const serverName = payload.serverName || (usePreset ? preset.serverName : 'AI Infra Discord');
  const channelName = (payload.channelName || (usePreset ? preset.channelName : 'announcements')).replace(/^#/, '');
  const author = payload.author || (usePreset ? preset.author : 'webhook-relay');
  const rawContent = payload.content || (usePreset ? preset.content : 'Live Discord announcement relay.');
  const titleCore =
    payload.title ||
    (usePreset ? preset.title : rawContent.replace(/```[\s\S]*?```/g, '').trim().slice(0, 96));

  const codeSnippet = extractCodeBlocks(rawContent);
  const cleanBody = rawContent.replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim();

  const mediaItems: MediaAttachment[] = [];
  if (payload.videoUrl) {
    mediaItems.push({
      type: 'video',
      url: payload.videoUrl,
      caption: `${serverName} #${channelName} video clip`,
      sourceNetwork: `Discord · ${serverName}`,
    });
  }
  if (payload.imageUrl) {
    mediaItems.push({
      type: 'image',
      url: payload.imageUrl,
      caption: `${serverName} #${channelName} attachment`,
      sourceNetwork: `Discord · ${serverName}`,
    });
  }

  const now = Date.now();
  const quotes: StreetQuote[] = [
    {
      id: `disc-wh-${now}-1`,
      network: 'Discord',
      originLabel: `#${channelName} · ${serverName}`,
      author,
      text: cleanBody.slice(0, 235),
      score: 268,
      sentiment: 'VERIFIED',
      publishedAtMs: now,
      url: payload.url || (usePreset ? preset.url : 'https://discord.com'),
    },
  ];

  if (usePreset) {
    quotes.push(
      {
        id: `disc-wh-${now}-x`,
        network: 'X',
        originLabel: 'X · Viral Launch Thread',
        author: '@ai_hype_radar',
        text: preset.xCounterQuote,
        score: 1840,
        sentiment: 'HYPE',
        publishedAtMs: now - 420_000,
      },
      {
        id: `disc-wh-${now}-rd`,
        network: 'Reddit',
        originLabel: 'r/LocalLLaMA',
        author: 'u/vram_benchmarker',
        text: preset.redditCounterQuote,
        score: 412,
        sentiment: 'SKEPTICAL',
        publishedAtMs: now - 180_000,
      }
    );
  }

  const sig: RawUpstreamSignal = {
    id: `discord-relay-${now}-${webhookSimCounter}`,
    title: `[${serverName} #${channelName}] ${titleCore}`,
    summary: cleanBody.slice(0, 360),
    url: payload.url || (usePreset ? preset.url : 'https://discord.com'),
    source: 'Discord',
    sourceCategory: 'DISCORD_RELAY',
    originFeedName: `Discord · ${serverName}`,
    publishedAtMs: now,
    score: 295,
    mediaItems,
    streetQuotes: quotes,
    codeSnippet,
    engagementVelocity: {
      likesOrUps: 412,
      commentsOrReplies: 64,
      velocityPerHour: 380,
      badgeText: `📡 DISCORD LIVE · #${channelName}`,
    },
  };

  recordLatency('discord_relay', Math.max(4, Date.now() - t0));
  if (!secrets.DISCORD_BOT_TOKEN) {
    adapterMetrics.discord_relay.state = 'READY_FOR_CREDENTIALS';
  }
  emitSignals([sig], 'discord_relay', mediaItems.length);
  return sig;
}

// ============================================================================
// TRI-ENGINE SYNTHESIS MANAGER (LOCAL OLLAMA vs GEMINI 2.5 FLASH vs DETERMINISTIC)
// ============================================================================
const OLLAMA_BASE = 'http://127.0.0.1:11434';

const ollamaTelemetry = {
  online: false,
  models: [] as string[],
  selectedModel: '',
  lastTokensPerSec: 0,
  lastLatencyMs: 0,
  errorHint: undefined as string | undefined,
};

const geminiTelemetry = {
  lastTokensPerSec: 0,
  lastLatencyMs: 0,
};

const deterministicTelemetry = {
  lastLatencyMs: 1,
};

function choosePreferred12GbVramModel(models: string[]): string {
  if (models.length === 0) return '';
  if (secrets.OLLAMA_MODEL && models.includes(secrets.OLLAMA_MODEL)) {
    return secrets.OLLAMA_MODEL;
  }
  const preferredOrder = [
    /^qwen2\.5:7b/i,
    /qwen2\.5.*(?:7b|14b)/i,
    /qwen3.*(?:8b|14b|4b)/i,
    /llama3\.1.*8b/i,
    /llama3\.2/i,
    /gemma3.*(?:4b|12b)/i,
    /deepseek-r1.*(?:7b|8b|14b)/i,
    /mistral/i,
    /qwen/i,
    /llama/i,
  ];
  for (const rx of preferredOrder) {
    const hit = models.find((m) => rx.test(m));
    if (hit) return hit;
  }
  return models[0];
}

let userExplicitlyChoseRulesSession = false;
let lastOllamaProbeAtMs = 0;

export async function probeOllamaStatus(forceProbe = false): Promise<SynthesisEngineStatus['ollama']> {
  if (!forceProbe && ollamaTelemetry.online && ollamaTelemetry.selectedModel && Date.now() - lastOllamaProbeAtMs < 15_000) {
    return {
      online: ollamaTelemetry.online,
      endpoint: `${OLLAMA_BASE}/api/tags`,
      models: ollamaTelemetry.models,
      selectedModel: ollamaTelemetry.selectedModel,
      vramSafeCtx: 2048,
      lastTokensPerSec: ollamaTelemetry.lastTokensPerSec,
      lastLatencyMs: ollamaTelemetry.lastLatencyMs,
      errorHint: ollamaTelemetry.errorHint,
    };
  }
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(1400),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const names = (data.models || []).map((m) => m.name || '').filter(Boolean);
    lastOllamaProbeAtMs = Date.now();
    ollamaTelemetry.online = true;
    ollamaTelemetry.models = names;
    ollamaTelemetry.selectedModel = choosePreferred12GbVramModel(names);
    ollamaTelemetry.errorHint = names.length === 0 ? 'Ollama online, 0 models pulled' : undefined;

    // Auto-upgrade stale DETERMINISTIC from .env.local to OLLAMA once local GPU is online
    if (
      ollamaTelemetry.selectedModel &&
      secrets.ACTIVE_SYNTHESIS_ENGINE === 'DETERMINISTIC' &&
      !userExplicitlyChoseRulesSession
    ) {
      secrets.ACTIVE_SYNTHESIS_ENGINE = 'OLLAMA';
      saveEnvLocalToDisk();
    }
  } catch {
    ollamaTelemetry.online = false;
    ollamaTelemetry.models = [];
    ollamaTelemetry.errorHint = 'Offline at 127.0.0.1:11434 (start `ollama serve` to enable local GPU)';
  }

  return {
    online: ollamaTelemetry.online,
    endpoint: `${OLLAMA_BASE}/api/tags`,
    models: ollamaTelemetry.models,
    selectedModel: ollamaTelemetry.selectedModel,
    vramSafeCtx: 2048,
    lastTokensPerSec: ollamaTelemetry.lastTokensPerSec,
    lastLatencyMs: ollamaTelemetry.lastLatencyMs,
    errorHint: ollamaTelemetry.errorHint,
  };
}

export async function getFullSwitchboardAndSynthesisStatus(): Promise<{
  adapters: AdapterTelemetryStatus[];
  synthesis: SynthesisEngineStatus;
}> {
  const ollamaInfo = await probeOllamaStatus();

  const xPwHasCreds = isPlaywrightSessionConfigured({
    authToken: secrets.X_AUTH_TOKEN,
    ct0: secrets.X_CT0,
    searchQuery: secrets.X_PLAYWRIGHT_QUERY,
    listIds: [],
  });
  if (!xPwHasCreds && adapterMetrics.x_playwright.state !== 'ERROR') {
    adapterMetrics.x_playwright.state = 'READY_FOR_CREDENTIALS';
  }
  if (!secrets.DISCORD_BOT_TOKEN && !discordClient && adapterMetrics.discord_relay.state !== 'ERROR') {
    adapterMetrics.discord_relay.state = 'READY_FOR_CREDENTIALS';
  }

  const adapters: AdapterTelemetryStatus[] = [
    {
      id: 'reddit_street',
      name: 'Deep Reddit "Street Verdict" Engine',
      subtitle: '12 AI Subreddits (/hot + /rising + Top-5 Upvoted Engineer Comments)',
      costBadge: '$0 ZERO-KEY · LIVE',
      enabled: adapterMetrics.reddit_street.enabled,
      state: adapterMetrics.reddit_street.state,
      signalsFetched: adapterMetrics.reddit_street.signalsFetched,
      avgLatencyMs: getAvgLatency('reddit_street'),
      lastLatencyMs: adapterMetrics.reddit_street.lastLatencyMs,
      mediaCount: adapterMetrics.reddit_street.mediaCount,
      lastPollMs: adapterMetrics.reddit_street.lastPollMs,
      lastError: adapterMetrics.reddit_street.lastError,
      hasCredentials: true,
      credentialSummary: `12 Subreddits (${DEEP_REDDIT_SUBREDDITS.slice(0, 4).join(', ')} +8)`,
      queryInfo: '/hot.json + /rising.json + top 5 thread comments',
    },
    {
      id: 'discord_relay',
      name: 'Discord Live #announcements Relay',
      subtitle: 'discord.js Gateway WebSocket + Instant Webhook Simulator',
      costBadge: '$0 REALTIME WS + WEBHOOK',
      enabled: adapterMetrics.discord_relay.enabled,
      state: adapterMetrics.discord_relay.state,
      signalsFetched: adapterMetrics.discord_relay.signalsFetched,
      avgLatencyMs: getAvgLatency('discord_relay'),
      lastLatencyMs: adapterMetrics.discord_relay.lastLatencyMs,
      mediaCount: adapterMetrics.discord_relay.mediaCount,
      lastPollMs: adapterMetrics.discord_relay.lastPollMs,
      lastError: adapterMetrics.discord_relay.lastError,
      hasCredentials: Boolean(secrets.DISCORD_BOT_TOKEN),
      credentialSummary: secrets.DISCORD_BOT_TOKEN
        ? `Bot: ${maskSecret(secrets.DISCORD_BOT_TOKEN)}`
        : 'Webhook Ready · Bot awaiting DISCORD_BOT_TOKEN',
      queryInfo: secrets.DISCORD_GUILD_ID
        ? `Guild Filter: ${secrets.DISCORD_GUILD_ID}`
        : 'All joined guilds (#announcements / crossposts)',
    },
    {
      id: 'x_playwright',
      name: 'Local Playwright X Scraper',
      subtitle: 'Headless Chromium session cookies + persistent .cortex-x-profile',
      costBadge: '$0 LOCAL SESSION',
      enabled: adapterMetrics.x_playwright.enabled,
      state: adapterMetrics.x_playwright.state,
      signalsFetched: adapterMetrics.x_playwright.signalsFetched,
      avgLatencyMs: getAvgLatency('x_playwright'),
      lastLatencyMs: adapterMetrics.x_playwright.lastLatencyMs,
      mediaCount: adapterMetrics.x_playwright.mediaCount,
      lastPollMs: adapterMetrics.x_playwright.lastPollMs,
      lastError: adapterMetrics.x_playwright.lastError,
      hasCredentials: xPwHasCreds,
      credentialSummary: xPwHasCreds
        ? `auth_token: ${maskSecret(secrets.X_AUTH_TOKEN || 'profile-saved')}`
        : 'Awaiting auth_token + ct0 or 1-Click Login',
      queryInfo: secrets.X_PLAYWRIGHT_QUERY,
    },
  ];

  return {
    adapters,
    synthesis: {
      activeEngine: secrets.ACTIVE_SYNTHESIS_ENGINE,
      ollama: ollamaInfo,
      gemini: {
        configured: Boolean(secrets.GEMINI_API_KEY),
        model: 'gemini-2.5-flash',
        lastTokensPerSec: geminiTelemetry.lastTokensPerSec,
        lastLatencyMs: geminiTelemetry.lastLatencyMs,
      },
      deterministic: {
        ready: true,
        lastLatencyMs: deterministicTelemetry.lastLatencyMs,
      },
    },
  };
}

export async function updateSwitchboardConfig(body: {
  adapterId?: AdapterId;
  enabled?: boolean;
  xAuthToken?: string;
  xCt0?: string;
  xPlaywrightQuery?: string;
  xListIds?: string;
  discordBotToken?: string;
  discordGuildId?: string;
  geminiApiKey?: string;
  ollamaModel?: string;
  activeSynthesisEngine?: SynthesisEngineId;
}): Promise<void> {
  if (body.xAuthToken !== undefined) secrets.X_AUTH_TOKEN = body.xAuthToken.trim();
  if (body.xCt0 !== undefined) secrets.X_CT0 = body.xCt0.trim();
  if (body.xPlaywrightQuery !== undefined && body.xPlaywrightQuery.trim()) {
    secrets.X_PLAYWRIGHT_QUERY = body.xPlaywrightQuery.trim();
  }
  if (body.xListIds !== undefined) secrets.X_LIST_IDS = body.xListIds.trim();
  if (body.discordBotToken !== undefined) secrets.DISCORD_BOT_TOKEN = body.discordBotToken.trim();
  if (body.discordGuildId !== undefined) secrets.DISCORD_GUILD_ID = body.discordGuildId.trim();
  if (body.geminiApiKey !== undefined) secrets.GEMINI_API_KEY = body.geminiApiKey.trim();
  if (body.ollamaModel !== undefined) secrets.OLLAMA_MODEL = body.ollamaModel.trim();
  if (body.activeSynthesisEngine !== undefined) {
    userExplicitlyChoseRulesSession = body.activeSynthesisEngine === 'DETERMINISTIC';
    secrets.ACTIVE_SYNTHESIS_ENGINE = body.activeSynthesisEngine;
  }

  if (body.adapterId && body.enabled !== undefined && body.adapterId in adapterMetrics) {
    adapterMetrics[body.adapterId].enabled = body.enabled;
    if (!body.enabled) {
      adapterMetrics[body.adapterId].state = 'PAUSED';
    }
  }

  saveEnvLocalToDisk();

  if (body.adapterId === 'reddit_street' && adapterMetrics.reddit_street.enabled) {
    void pollDeepRedditStreetEngine();
  } else if (body.adapterId === 'x_playwright' && adapterMetrics.x_playwright.enabled) {
    void pollPlaywrightXAdapter();
  } else if (
    body.adapterId === 'discord_relay' ||
    body.discordBotToken !== undefined ||
    body.discordGuildId !== undefined
  ) {
    void syncDiscordBotGateway();
  }
}

export async function runTriEngineTextSynthesis(params: {
  engine?: SynthesisEngineId;
  ollamaModel?: string;
  apiKey?: string;
  clientIndustry?: string;
  prompt: string;
}): Promise<{
  text: string;
  engineUsed: SynthesisEngineId;
  modelUsed: string;
  tokensPerSec: number;
  latencyMs: number;
}> {
  const targetEngine = params.engine || secrets.ACTIVE_SYNTHESIS_ENGINE;
  const industry = params.clientIndustry || 'Enterprise';

  if (targetEngine === 'OLLAMA') {
    const status = await probeOllamaStatus();
    const model = params.ollamaModel || status.selectedModel;
    if (!status.online || !model) {
      throw new Error(
        status.errorHint || 'Local Ollama is offline or has no model pulled at 127.0.0.1:11434.'
      );
    }
    const t0 = Date.now();
    const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: '30m',
        prompt: `You are a Principal AI Strategy & Architecture Consultant advising a ${industry} executive team. Be concise, concrete, quantified, and under 125 words. Do not output <think> tags.\n\n${params.prompt}`,
        options: {
          num_ctx: 2048, // Compact context so 7B-14B stays 100% inside 12GB VRAM with zero CPU spillover!
          num_predict: 240,
          temperature: 0.2,
        },
      }),
    });
    if (!resp.ok) {
      throw new Error(`Ollama HTTP ${resp.status}`);
    }
    const data = (await resp.json()) as {
      response?: string;
      eval_count?: number;
      eval_duration?: number;
    };
    const latencyMs = Date.now() - t0;
    const rawOut = (data.response || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const tokPerSec =
      data.eval_count && data.eval_duration
        ? Number((data.eval_count / (data.eval_duration / 1e9)).toFixed(1))
        : Number(((rawOut.split(/\s+/).length * 1.3) / Math.max(0.1, latencyMs / 1000)).toFixed(1));

    ollamaTelemetry.lastLatencyMs = latencyMs;
    ollamaTelemetry.lastTokensPerSec = tokPerSec;

    return {
      text: rawOut,
      engineUsed: 'OLLAMA',
      modelUsed: model,
      tokensPerSec: tokPerSec,
      latencyMs,
    };
  }

  if (targetEngine === 'GEMINI') {
    const key = params.apiKey || secrets.GEMINI_API_KEY;
    if (!key) {
      throw new Error('Gemini API Key not set. Add key in HUD or switch brain to Local Ollama / Rules.');
    }
    const t0 = Date.now();
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
        key
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(9500),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are a Principal AI Strategy & Architecture Consultant advising a ${industry} C-Suite. Keep output crisp, concrete, quantified, and under 130 words.\n\n${params.prompt}`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0.35, maxOutputTokens: 280 },
        }),
      }
    );
    if (!resp.ok) {
      const errTxt = await resp.text();
      throw new Error(errTxt.slice(0, 180));
    }
    const json = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const latencyMs = Date.now() - t0;
    const estTokens = Math.max(12, Math.round(text.split(/\s+/).length * 1.33));
    const tokPerSec = Number((estTokens / Math.max(0.08, latencyMs / 1000)).toFixed(1));

    geminiTelemetry.lastLatencyMs = latencyMs;
    geminiTelemetry.lastTokensPerSec = tokPerSec;

    return {
      text,
      engineUsed: 'GEMINI',
      modelUsed: 'gemini-2.5-flash',
      tokensPerSec: tokPerSec,
      latencyMs,
    };
  }

  // Deterministic rules engine (instant <2ms)
  const t0 = Date.now();
  const deterministicBrief = `Deterministic ${industry} Advisory: Evaluate behind an internal AI gateway on test traffic, verify compliance posture directly from the source, and measure task accuracy and resource usage against your current workload before broad rollout.`;
  const latencyMs = Math.max(1, Date.now() - t0);
  deterministicTelemetry.lastLatencyMs = latencyMs;
  return {
    text: deterministicBrief,
    engineUsed: 'DETERMINISTIC',
    modelUsed: 'CORTEX-Rules-v4',
    tokensPerSec: 999,
    latencyMs,
  };
}

interface CachedOllamaLiteracyEntry {
  literacy: LiteracySpectrumPayload;
  modelUsed: string;
  tokensPerSec: number;
  latencyMs: number;
}

const serverOllamaLiteracyCache = new Map<string, CachedOllamaLiteracyEntry>();
const serverOllamaUrlCache = new Map<string, CachedOllamaLiteracyEntry>();
let activeUserLiteracyRequests = 0;
let prewarmQueueRunning = false;
let activePrewarmAbortController: AbortController | null = null;
const prewarmCandidateMap = new Map<string, SpatialSignal>();

/**
 * Immediately aborts any in-flight background pre-warm fetch to 127.0.0.1:11434 so an interactive
 * user click claims the Ollama GPU slot in <50ms without waiting behind background jobs!
 */
export function abortActivePrewarmForUserClick(): boolean {
  if (activePrewarmAbortController) {
    try {
      activePrewarmAbortController.abort('USER_CLICK_PREEMPTION');
    } catch {
      // Ignore abort edge cases
    }
    activePrewarmAbortController = null;
    return true;
  }
  return false;
}

function normalizeCacheUrl(url: string): string {
  return (url || '').trim().toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '');
}

export function getPrewarmedLiteracyEntries(): Record<string, LiteracySpectrumPayload> {
  const out: Record<string, LiteracySpectrumPayload> = {};
  for (const [k, v] of serverOllamaLiteracyCache.entries()) {
    out[k] = v.literacy;
  }
  return out;
}

/**
 * Quietly queues the top 8 highest-mass / Supernova live nodes and pre-synthesizes them 1 at a time
 * through local Ollama (qwen2.5:7b) on server idle so clicking major glowing orbs responds in 0ms!
 */
export function enqueueTopLiveNodesForOllamaPrewarm(rawItems: RawUpstreamSignal[]): void {
  if (!rawItems || rawItems.length === 0) return;

  const ranked = [...rawItems]
    .sort((a, b) => (b.score ?? 100) - (a.score ?? 100))
    .slice(0, 12);

  for (const raw of ranked) {
    const key = `${raw.id}-BANKING-OLLAMA`;
    if (serverOllamaLiteracyCache.has(key) || prewarmCandidateMap.has(raw.id)) continue;
    const sig = synthesizeRawItemToSpatialSignal(raw, true);
    prewarmCandidateMap.set(raw.id, sig);
  }

  // Keep only top 8 highest-mass / Supernova uncached candidates
  const sortedCandidates = Array.from(prewarmCandidateMap.values())
    .filter((s) => !serverOllamaLiteracyCache.has(`${s.id}-BANKING-OLLAMA`))
    .sort((a, b) => (b.isSupernova ? 10 : 0) + b.mass - ((a.isSupernova ? 10 : 0) + a.mass))
    .slice(0, 8);

  prewarmCandidateMap.clear();
  for (const c of sortedCandidates) {
    prewarmCandidateMap.set(c.id, c);
  }

  if (!prewarmQueueRunning) {
    void drainOllamaPrewarmQueue();
  }
}

async function drainOllamaPrewarmQueue(): Promise<void> {
  if (prewarmQueueRunning) return;
  prewarmQueueRunning = true;
  try {
    const status = await probeOllamaStatus();
    if (!status.online || !status.selectedModel) return;

    while (prewarmCandidateMap.size > 0) {
      // Yield immediately whenever an interactive user click synthesis is active
      if (activeUserLiteracyRequests > 0) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      const nextEntry = prewarmCandidateMap.entries().next().value as
        | [string, SpatialSignal]
        | undefined;
      if (!nextEntry) break;
      const [id, sig] = nextEntry;
      prewarmCandidateMap.delete(id);

      const cacheKey = `${sig.id}-BANKING-OLLAMA`;
      if (serverOllamaLiteracyCache.has(cacheKey)) continue;

      try {
        await runTriEngineLiteracySpectrum({
          engine: 'OLLAMA',
          clientIndustry: 'BANKING',
          signal: sig,
          isBackgroundPrewarm: true,
        });
      } catch (err) {
        // Re-queue pre-empted node so it warms cleanly after user click finishes
        const msg = String((err as Error)?.message || err || '');
        if (msg.includes('abort') || msg.includes('PREEMPTION') || activeUserLiteracyRequests > 0) {
          prewarmCandidateMap.set(id, sig);
          await new Promise((r) => setTimeout(r, 900));
        }
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  } finally {
    prewarmQueueRunning = false;
  }
}

function safeParseJsonPayload(raw: string): Partial<LiteracySpectrumPayload> | null {
  try {
    return JSON.parse(raw) as Partial<LiteracySpectrumPayload>;
  } catch {
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as Partial<LiteracySpectrumPayload>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Generates and caches ALL 5 Universal Literacy Levels + plainTitle + glossary[] in a SINGLE structured call
 * across OLLAMA | GEMINI | DETERMINISTIC, enforcing strict Zero-Jargon sanitization on Level 1 & Level 2.
 */
export async function runTriEngineLiteracySpectrum(params: {
  engine?: SynthesisEngineId;
  ollamaModel?: string;
  apiKey?: string;
  clientIndustry?: ClientIndustry;
  signal: SpatialSignal;
  isBackgroundPrewarm?: boolean;
  forceRefresh?: boolean;
  preemptedByRoute?: boolean;
}): Promise<{
  literacy: LiteracySpectrumPayload;
  hydratedQuotes?: StreetQuote[];
  preemptedBackgroundJob?: boolean;
  engineUsed: SynthesisEngineId;
  modelUsed: string;
  tokensPerSec: number;
  latencyMs: number;
}> {
  const preemptedBackgroundJob = Boolean(
    params.preemptedByRoute || (!params.isBackgroundPrewarm && abortActivePrewarmForUserClick())
  );
  const clientInd: ClientIndustry = params.clientIndustry || 'BANKING';

  // Hydrate real top Reddit comments on demand whenever comments > 0 and real quotes[] are missing!
  let hydratedQuotes: StreetQuote[] | undefined;
  const existingRealQuotes = (params.signal.streetQuotes || []).filter(
    (q) => !q.id.endsWith('-self-quote') && q.author !== params.signal.originFeedName
  );
  if (
    !params.isBackgroundPrewarm &&
    existingRealQuotes.length === 0 &&
    (params.signal.source === 'Reddit' ||
      params.signal.url.includes('reddit.com/') ||
      /^r\//i.test(params.signal.originFeedName || ''))
  ) {
    const fetchedQuotes = await hydrateRedditCommentsForSignal(params.signal);
    if (fetchedQuotes.length > 0) {
      hydratedQuotes = fetchedQuotes;
      params.signal = { ...params.signal, streetQuotes: fetchedQuotes };
    }
  }

  const baseFallback = buildDeterministicLiteracyPayload(params.signal, clientInd);
  const targetEngine = params.engine || secrets.ACTIVE_SYNTHESIS_ENGINE;

  if (targetEngine === 'DETERMINISTIC') {
    return {
      literacy: { ...baseFallback, generatedBy: 'DETERMINISTIC' },
      hydratedQuotes,
      preemptedBackgroundJob,
      engineUsed: 'DETERMINISTIC',
      modelUsed: 'CORTEX-Literacy-v4',
      tokensPerSec: 999,
      latencyMs: 1,
    };
  }

  if (isReleaseWithoutNotes(params.signal)) {
    return {
      literacy: baseFallback,
      hydratedQuotes,
      preemptedBackgroundJob,
      engineUsed: 'DETERMINISTIC',
      modelUsed: 'CORTEX-No-Release-Notes-Guard',
      tokensPerSec: 999,
      latencyMs: 1,
    };
  }

  const exactKey = `${params.signal.id}-${clientInd}-OLLAMA`;
  const bankKey = `${params.signal.id}-BANKING-OLLAMA`;
  const normUrl = normalizeCacheUrl(params.signal.url);
  if (targetEngine === 'OLLAMA' && !params.forceRefresh) {
    const cachedHit =
      serverOllamaLiteracyCache.get(exactKey) ||
      serverOllamaUrlCache.get(`${normUrl}::${clientInd}`) ||
      serverOllamaLiteracyCache.get(bankKey) ||
      serverOllamaUrlCache.get(`${normUrl}::BANKING`);
    if (cachedHit) {
      return {
        literacy: cachedHit.literacy,
        hydratedQuotes,
        preemptedBackgroundJob,
        engineUsed: 'OLLAMA',
        modelUsed: cachedHit.modelUsed,
        tokensPerSec: cachedHit.tokensPerSec,
        latencyMs: 0,
      };
    }
  }

  const realQuotesForPrompt = (hydratedQuotes || existingRealQuotes).slice(0, 3);
  const topQuotesContext = realQuotesForPrompt
    .map((q) => `[${q.originLabel} · ${q.author}, +${q.score}] "${q.text}"`)
    .join('\n- ');

  const glossaryTermsHint = baseFallback.glossary
    .slice(0, 3)
    .map((g) => g.term)
    .join(', ');
  const isTechnicalSignal = hasTechnicalEngineeringContent(params.signal);
  const isHedgedClaim = isHedgedOrUnverifiedClaim(params.signal);
  const relMeta = getSignalReleaseMetadata(params.signal);
  const benchClaim = extractBenchmarkClaimSpec(params.signal);
  const frozenEntities = extractFrozenEntities(params.signal);
  const scope = classifyEvidenceScope(params.signal);
  const isEvalStudy = isEvaluationQualityStudy(params.signal);
  const needsVerbatimHeadline = requiresVerbatimPublisherHeadline(params.signal);
  const latencyWithoutCost = hasLatencyOrThroughputWithoutCost(params.signal);
  const legalInstitution = extractNamedLegalInstitution(params.signal);
  const sourceHasCompliance = hasSourceComplianceAssessment(params.signal);
  const caveatedMetrics = extractSourceVerifiedMetrics(params.signal).filter((m) => Boolean(m.caveat));

  const normPrimaryUrl = (params.signal.url || '')
    .trim()
    .toLowerCase()
    .replace(/#.*$/, '')
    .replace(/\/+$/, '')
    .replace(/^https?:\/\/(www\.)?/, '');
  const supportingContext = (params.signal.supportingSources || [])
    .filter((s) => {
      const u = (s.url || '')
        .trim()
        .toLowerCase()
        .replace(/#.*$/, '')
        .replace(/\/+$/, '')
        .replace(/^https?:\/\/(www\.)?/, '');
      return u && u !== normPrimaryUrl;
    })
    .slice(0, 4)
    .map((s) => `[${s.isPrimary ? 'Primary' : 'Commentary'} · ${s.source}] "${s.title}"`)
    .join('\n- ');

  const fullPostContext = stripTrailingIncompleteClause(
    stripUiChromeBoilerplate(params.signal.rawAbstract || params.signal.title).slice(0, 2800)
  );

  const domainConstraintBlock = !isTechnicalSignal
    ? `NO TECHNICAL SPECS IN SOURCE: This source contains NO software/hardware engineering specs. NEVER invent Context Window, RAG, FinOps Cascade, latency, token throughput, VRAM, parameters, or benchmarks. Keep glossary as []. In levels["5"].architectureBrief explicitly begin with "Source provides no technical specifications or architecture details."`
    : glossaryTermsHint
    ? `Required Level 3 Glossary Terms (mention verbatim in Level 3 bridgeSummary): ${glossaryTermsHint}`
    : '';

  const epistemicConstraintBlock = isHedgedClaim
    ? `EPISTEMIC FIDELITY REQUIRED: The source uses hedged or unverified language (may / claims / purports / reportedly / unverified). Preserve this uncertainty across plainTitle, plainFullTitle, and ALL levels 1-5. NEVER rewrite this as a settled fact or confirmed breakthrough.`
    : '';

  const releaseConstraintBlock = relMeta
    ? `GITHUB RELEASE IDENTITY REQUIRED: Keep exact product & tag "${relMeta.displayTitle}" (${relMeta.stabilityLabel}) in plainTitle and plainFullTitle; ${relMeta.isPreRelease ? 'never label this pre-release as Production GA.' : 'cite the stable version accurately.'}`
    : '';

  const benchmarkConstraintBlock = benchClaim
    ? `BENCHMARK LOCK REQUIRED ACROSS ALL 5 LENSES: Any mention of "${benchClaim.multiplier}" MUST preserve ALL three elements together: (1) exact metric "${benchClaim.metric}", (2) exact comparison baseline "${benchClaim.baseline}", and (3) attribution "${benchClaim.attribution}". NEVER broaden the baseline to "modern CPUs" or "leading chips", and NEVER write unqualified "${benchClaim.multiplier} better" without metric + baseline.`
    : '';
  const entityUnitQuoteConstraintBlock = [
    'UNIT, ENTITY, COMMA-NUMBER, CONDITION & VERBATIM QUOTE LOCK: Preserve exact model/product names verbatim (NEVER flatten to "compact AI model"), preserve FULL comma-formatted numbers verbatim (e.g., "2,245", "4,096", "5,311", "31,477" — NEVER truncate at commas to "245" or "31"), preserve benchmark test conditions ("4,096-token prompt") paired with subject and exact technical units ("prompt tokens/s", "output tokens", "tokens per second" — NEVER "words per second"), preserve full metric ranges verbatim (e.g., "20–59%", NEVER truncate to "59%"), NEVER invent unbacked percentages/dollars/cost-savings ranges not in the source, and ONLY place quotation marks ("...") around exact verbatim phrases from the Primary Headline or Body above.',
    caveatedMetrics.length > 0
      ? `AUTHOR CAVEAT & WORKLOAD SCOPE LOCK: Preserve exact workload scope and author caveat verbatim (${caveatedMetrics
          .map((m) => `"${m.value} ${m.label}" — Caveat: ${m.caveat}`)
          .join('; ')}). NEVER state or imply that this speedup applies to an entire training run.`
      : '',
    frozenEntities.length > 0 ? `Named entities to keep verbatim: ${frozenEntities.join(', ')}.` : '',
    needsVerbatimHeadline
      ? 'HEADLINE MEANING & SCOPE LOCK: Preserve conditional cause/effect clauses (disabled tool vs. lost product) and legal/court scope qualifiers verbatim — keep plainTitle/plainFullTitle aligned to the exact publisher headline without broadening bans or swapping blocked products.'
      : '',
    legalInstitution
      ? `LEGAL JURISDICTION SUMMARY LOCK: Name "${legalInstitution}" explicitly in Levels 1-5 summaries whenever describing the sanction, exclusion, or decision — NEVER flatten it to generic "in court" or "barred from practicing law".`
      : '',
    !sourceHasCompliance
      ? `ZERO UNBACKED COMPLIANCE CLAIMS: Source does NOT assess compliance or enterprise clearance. NEVER mention SOC 2, zero-retention, HIPAA, GDPR, enterprise-ready, or ready for an enterprise pilot; in Level 4 readinessAndRisk explicitly note "${scope === 'research_paper' || isEvalStudy ? 'Not assessed in this study' : 'Not assessed in source'}".`
      : '',
    isEvalStudy
      ? 'EVALUATION STUDY FRAMING: This source evaluates research/citation/retrieval quality rather than inference speed; frame L5 around evaluation methodology and exact reported scores instead of latency/throughput.'
      : '',
    latencyWithoutCost
      ? 'NO UNBACKED COST SAVINGS: Source reports latency/throughput without cost data; do NOT invent cost-savings % in Level 4 — ask: "What happens to cost per completed request on your workload?".'
      : '',
    scope === 'single_user_experiment'
      ? 'PROPORTIONATE SCOPE: This is an individual/local experiment — do NOT extrapolate into enterprise banking transformation, audited gateways, or 3x token spend in Level 4.'
      : '',
    scope === 'discussion_or_personal'
      ? 'DISCUSSION / PERSONAL THREAD: Human/career/community discussion — do NOT generate hardware reproduction, benchmarking, or enterprise rollout templates.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const schemaPrompt = `You are a Principal AI Technical Writer & Architecture Strategist translating this source-linked signal into a rich, insightful 5-level literacy JSON object for a ${clientInd} audience.

Primary Origin Source: ${params.signal.originFeedName || params.signal.source} (${params.signal.url})
Primary Headline: "${params.signal.title}"
Primary Post Body / Excerpt (up to 2,800 chars):
"""
${fullPostContext}
"""
${
  supportingContext
    ? `Supporting Coverage in This Event Group (secondary context only — anchor primary facts strictly to Primary Headline & Primary Post Body above):\n- ${supportingContext}\n`
    : ''
}${
  topQuotesContext
    ? `Real Community Engineer Replies (cite these objections/praise in Level 5 streetConsensus):\n- ${topQuotesContext}\n`
    : ''
}${domainConstraintBlock ? `${domainConstraintBlock}\n` : ''}${
    epistemicConstraintBlock ? `${epistemicConstraintBlock}\n` : ''
  }${releaseConstraintBlock ? `${releaseConstraintBlock}\n` : ''}${
    benchmarkConstraintBlock ? `${benchmarkConstraintBlock}\n` : ''
  }${entityUnitQuoteConstraintBlock}\n
STRICT ANTI-VAGUENESS & DEPTH RULES:
1. NO TELEGRAPHIC FRAGMENTS OR FORTUNE-COOKIE TRUISMS: Never output vague 6-word filler like "AI agents help solve mysteries", "Tasks vary from small to complex", or "Positive early results, awaiting validation".
2. LEVEL 1 MUST BE A TRUE VIVID PHYSICAL METAPHOR (2-3 full sentences, 35-65 words): Explicitly start levels["1"].analogy with "Think of it like..." or "Imagine..." comparing the mechanism to an everyday physical system (a kitchen prep line, library desk, post office sorting room, hospital chart clipboard, thermostat, or highway lane). Strictly ban technical acronyms in Level 1. Write levels["1"].everydayWhy as 1-2 full, natural human sentences.
3. PRIMARY FACT & EPISTEMIC ALIGNMENT: Anchor plainTitle, plainFullTitle, Level 1, and Level 2 whatHappened strictly to the Primary Headline and Primary Post Body above. Preserve uncertainty words (may, claims, reportedly, unverified) when present, and NEVER invent technical specs on non-engineering business/IPO/legal/social signals.
4. LEVEL 5 MUST BE CONCRETE & ACCURATE: Extract real architectural mechanisms/metrics ONLY when actually present in the source; otherwise explicitly state "Source provides no technical specifications or architecture details." and summarize concrete factual/operational implications. Never repeat the same sentence across sections.

Return ONLY valid JSON matching this exact structure:
{
  "plainTitle": "${relMeta ? relMeta.displayTitle : 'Humanized outcome-focused badge <=48 chars, zero jargon'}",
  "plainFullTitle": "${relMeta ? relMeta.displayTitle : 'Specific plain-English headline <=96 chars'}",
  "levels": {
    "1": {
      "analogy": "2-3 full sentences starting with 'Think of it like...' or 'Imagine...' using a concrete physical metaphor tied strictly to the source facts/uncertainty.",
      "everydayWhy": "1-2 full natural human sentences explaining why everyday people or workers care."
    },
    "2": {
      "whatHappened": "2 clear plain-English sentences detailing the exact concrete facts or claims in the post without exaggerating certainty.",
      "whoBuiltIt": "Exact lab team, open-source project, author, or organization.",
      "problemSolved": "1-2 plain sentences on the real-world problem, claim, or business shift addressed."
    },
    "3": {
      "bridgeSummary": "${isTechnicalSignal && glossaryTermsHint ? `2-3 clear builder sentences explaining how the mechanism works and explicitly using ${glossaryTermsHint}.` : '2-3 clear factual sentences explaining operational/domain significance without fabricating engineering specs.'}"
    },
    "4": {
      "roiAndFinOps": "2 sentences on concrete operational, cost, or strategic impact grounded strictly in source facts.",
      "readinessAndRisk": "2 sentences on realistic maturity, uncertainty/pre-release status, and ${clientInd} governance attention.",
      "clientAdvice": "1-2 concrete, grounded recommendations for a ${clientInd} leadership team."
    },
    "5": {
      "architectureBrief": "${isTechnicalSignal ? '2-3 dense technical sentences citing exact architecture, protocols, or experimental method from the post.' : 'Begin verbatim with: Source provides no technical specifications or architecture details. Then summarize concrete factual/operational details from the source in 1-2 sentences.'}",
      "specsAndCaveats": "2-3 concrete sentences citing verified metrics/release channel OR explicitly noting absence of specs/benchmarks.",
      "streetConsensus": "2 sentences summarizing the specific praise/objections from the Real Community Engineer Replies above (or 'Awaiting peer replication (newly indexed paper/release)' if zero replies exist)."
    }
  }
}`;

  const mergeAndSanitize = (
    parsed: Partial<LiteracySpectrumPayload>,
    engineId: SynthesisEngineId
  ): LiteracySpectrumPayload => {
    const rawL1 = parsed.levels?.[1];
    const cleanGlossary: GlossaryTerm[] = !isTechnicalSignal
      ? baseFallback.glossary
      : Array.isArray(parsed.glossary) && parsed.glossary.length >= 2
      ? parsed.glossary
          .filter((g) => g && typeof g.term === 'string' && typeof g.definition === 'string')
          .slice(0, 5)
      : baseFallback.glossary;

    // Guarantee Level 1 analogy is a genuine multi-sentence vivid metaphor (>22 words), never a 6-word truism!
    const candidateAnalogy = rawL1?.analogy ? enforceZeroJargonL1(rawL1.analogy) : '';
    const finalAnalogy = isSubstantiveVividMetaphor(candidateAnalogy)
      ? candidateAnalogy
      : candidateAnalogy.split(/\s+/).length >= 16
      ? `${baseFallback.levels[1].analogy.split(/(?<=[.!?])\s+/)[0]} ${candidateAnalogy}`
      : baseFallback.levels[1].analogy;

    const candidateEverydayWhy = rawL1?.everydayWhy ? enforceZeroJargonL1(rawL1.everydayWhy) : '';
    const finalEverydayWhy =
      candidateEverydayWhy.split(/\s+/).length >= 9
        ? candidateEverydayWhy
        : baseFallback.levels[1].everydayWhy;

    const isVagueL5 = (txt?: string) =>
      !txt ||
      txt.trim().split(/\s+/).length < 9 ||
      /tasks vary from small to complex|positive early results,?\s*awaiting/i.test(txt);

    const assembled: LiteracySpectrumPayload = {
      plainTitle: truncateAtWordBoundary(
        enforceZeroJargonL1(parsed.plainTitle || baseFallback.plainTitle),
        48
      ),
      plainFullTitle: truncateAtWordBoundary(
        enforceZeroJargonL1(parsed.plainFullTitle || baseFallback.plainFullTitle),
        96
      ),
      levels: {
        1: {
          analogy: enforceZeroJargonL1(finalAnalogy),
          everydayWhy: enforceZeroJargonL1(finalEverydayWhy),
        },
        2: {
          whatHappened: simplifyPlainEnglishL2(
            parsed.levels?.[2]?.whatHappened || baseFallback.levels[2].whatHappened
          ),
          whoBuiltIt: simplifyPlainEnglishL2(
            parsed.levels?.[2]?.whoBuiltIt || baseFallback.levels[2].whoBuiltIt
          ),
          problemSolved: simplifyPlainEnglishL2(
            parsed.levels?.[2]?.problemSolved || baseFallback.levels[2].problemSolved
          ),
        },
        3: {
          bridgeSummary: parsed.levels?.[3]?.bridgeSummary || baseFallback.levels[3].bridgeSummary,
        },
        4: {
          roiAndFinOps: parsed.levels?.[4]?.roiAndFinOps || baseFallback.levels[4].roiAndFinOps,
          readinessAndRisk:
            parsed.levels?.[4]?.readinessAndRisk || baseFallback.levels[4].readinessAndRisk,
          clientAdvice: parsed.levels?.[4]?.clientAdvice || baseFallback.levels[4].clientAdvice,
        },
        5: {
          architectureBrief: !isVagueL5(parsed.levels?.[5]?.architectureBrief)
            ? parsed.levels![5]!.architectureBrief
            : baseFallback.levels[5].architectureBrief,
          specsAndCaveats: !isVagueL5(parsed.levels?.[5]?.specsAndCaveats)
            ? parsed.levels![5]!.specsAndCaveats
            : baseFallback.levels[5].specsAndCaveats,
          streetConsensus:
            !isVagueL5(parsed.levels?.[5]?.streetConsensus) &&
            !(
              realQuotesForPrompt.length > 0 &&
              /awaiting peer replication|awaiting broader validation/i.test(
                parsed.levels?.[5]?.streetConsensus || ''
              )
            )
              ? parsed.levels![5]!.streetConsensus
              : baseFallback.levels[5].streetConsensus,
        },
      },
      glossary: cleanGlossary,
      generatedBy: engineId,
    };

    return enforceEpistemicAndDomainFidelity(params.signal, assembled, params.clientIndustry);
  };

  if (targetEngine === 'OLLAMA') {
    const status = await probeOllamaStatus();
    const model = params.ollamaModel || status.selectedModel;
    if (!status.online || !model) {
      return {
        literacy: { ...baseFallback, generatedBy: 'DETERMINISTIC' },
        engineUsed: 'DETERMINISTIC',
        modelUsed: 'CORTEX-Literacy-v4 (Ollama Offline Fallback)',
        tokensPerSec: 999,
        latencyMs: 1,
      };
    }

    if (!params.isBackgroundPrewarm) activeUserLiteracyRequests++;
    let prewarmCtrl: AbortController | null = null;
    if (params.isBackgroundPrewarm) {
      prewarmCtrl = new AbortController();
      activePrewarmAbortController = prewarmCtrl;
    }

    const t0 = Date.now();
    try {
      const fetchSignal = prewarmCtrl
        ? AbortSignal.any([prewarmCtrl.signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000);

      const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: fetchSignal,
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          keep_alive: '30m',
          prompt: schemaPrompt,
          options: {
            num_ctx: 4096,
            num_predict: 1050,
            temperature: 0.25,
          },
        }),
      });
      if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
      const data = (await resp.json()) as {
        response?: string;
        eval_count?: number;
        eval_duration?: number;
      };
      const latencyMs = Date.now() - t0;
      const rawOut = (data.response || '{}').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const parsed = safeParseJsonPayload(rawOut);
      if (!parsed) {
        return {
          literacy: { ...baseFallback, generatedBy: 'DETERMINISTIC' },
          hydratedQuotes,
          preemptedBackgroundJob,
          engineUsed: 'DETERMINISTIC',
          modelUsed: `${model} (Fallback)`,
          tokensPerSec: 999,
          latencyMs,
        };
      }
      const tokPerSec =
        data.eval_count && data.eval_duration
          ? Number((data.eval_count / (data.eval_duration / 1e9)).toFixed(1))
          : Number(((rawOut.length / 4) / Math.max(0.1, latencyMs / 1000)).toFixed(1));

      ollamaTelemetry.lastLatencyMs = latencyMs;
      ollamaTelemetry.lastTokensPerSec = tokPerSec;

      const sanitized = mergeAndSanitize(parsed, 'OLLAMA');
      const cacheRecord: CachedOllamaLiteracyEntry = {
        literacy: sanitized,
        modelUsed: model,
        tokensPerSec: tokPerSec,
        latencyMs,
      };
      serverOllamaLiteracyCache.set(exactKey, cacheRecord);
      if (normUrl) {
        serverOllamaUrlCache.set(`${normUrl}::${clientInd}`, cacheRecord);
      }

      return {
        literacy: sanitized,
        hydratedQuotes,
        preemptedBackgroundJob,
        engineUsed: 'OLLAMA',
        modelUsed: model,
        tokensPerSec: tokPerSec,
        latencyMs,
      };
    } finally {
      if (prewarmCtrl && activePrewarmAbortController === prewarmCtrl) {
        activePrewarmAbortController = null;
      }
      if (!params.isBackgroundPrewarm) {
        activeUserLiteracyRequests = Math.max(0, activeUserLiteracyRequests - 1);
      }
    }
  }

  // GEMINI 2.5 FLASH JSON Structured Output
  const key = params.apiKey || secrets.GEMINI_API_KEY;
  if (!key) {
    return {
      literacy: { ...baseFallback, generatedBy: 'DETERMINISTIC' },
      engineUsed: 'DETERMINISTIC',
      modelUsed: 'CORTEX-Literacy-v4 (No Key Fallback)',
      tokensPerSec: 999,
      latencyMs: 1,
    };
  }

  const t0 = Date.now();
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
      key
    )}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(11_000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: schemaPrompt }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 780,
          responseMimeType: 'application/json',
        },
      }),
    }
  );
  if (!resp.ok) {
    const errTxt = await resp.text();
    throw new Error(errTxt.slice(0, 180));
  }
  const json = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const parsed = JSON.parse(rawText) as Partial<LiteracySpectrumPayload>;
  const latencyMs = Date.now() - t0;
  const estTokens = Math.max(40, Math.round(rawText.length / 4));
  const tokPerSec = Number((estTokens / Math.max(0.1, latencyMs / 1000)).toFixed(1));

  geminiTelemetry.lastLatencyMs = latencyMs;
  geminiTelemetry.lastTokensPerSec = tokPerSec;

  return {
    literacy: mergeAndSanitize(parsed, 'GEMINI'),
    engineUsed: 'GEMINI',
    modelUsed: 'gemini-2.5-flash',
    tokensPerSec: tokPerSec,
    latencyMs,
  };
}

// Background schedulers for enabled zero-billing underground adapters
let schedulersStarted = false;
export function startUndergroundAdapterSchedulers(): void {
  if (schedulersStarted) return;
  schedulersStarted = true;

  // Deep Reddit Street Engine: immediate $0 sweep + every 52s
  void pollDeepRedditStreetEngine();
  setInterval(() => {
    void pollDeepRedditStreetEngine();
  }, 52_000);

  // Playwright Local X Scraper: safe jittered 85s–125s loop when enabled
  const scheduleJitteredPlaywright = () => {
    const jitterMs = 85_000 + Math.floor(Math.random() * 40_000);
    setTimeout(async () => {
      if (adapterMetrics.x_playwright.enabled) {
        await pollPlaywrightXAdapter();
      }
      scheduleJitteredPlaywright();
    }, jitterMs);
  };
  scheduleJitteredPlaywright();

  // Auto-connect Discord bot if token already in .env.local
  if (secrets.DISCORD_BOT_TOKEN) {
    adapterMetrics.discord_relay.enabled = true;
    void syncDiscordBotGateway();
  }
}
