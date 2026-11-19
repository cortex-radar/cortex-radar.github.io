import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RawUpstreamSignal } from '../shared/seed72h';
import type {
  AdapterId,
  ClientIndustry,
  SourceCategory,
  SpatialSignal,
  SynthesisEngineId,
  UpstreamFeedHealth,
} from '../shared/types';
import {
  abortActivePrewarmForUserClick,
  enqueueTopLiveNodesForOllamaPrewarm,
  fetchTopRedditCommentsByPostId,
  getFullSwitchboardAndSynthesisStatus,
  getPrewarmedLiteracyEntries,
  ingestDiscordWebhookRelay,
  isHighSignalRedditPost,
  pollDeepRedditStreetEngine,
  pollPlaywrightXAdapter,
  probeOllamaStatus,
  registerAdapterSignalSink,
  resolveGitHubOpenGraphImage,
  runTriEngineLiteracySpectrum,
  runTriEngineTextSynthesis,
  startUndergroundAdapterSchedulers,
  triggerPlaywrightLoginFlow,
  updateSwitchboardConfig,
} from './undergroundAdapters';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3001);
const UPSTREAM_TIMEOUT_MS = 2500;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

interface FeedDescriptor {
  id: string;
  name: string;
  category: Exclude<SourceCategory, 'DEMO_SEED'>;
  sourceType: RawUpstreamSignal['source'];
  url: string;
  fetcher: () => Promise<RawUpstreamSignal[]>;
}

const seenUpstreamIds = new Set<string>();
let cachedLiveSignals: RawUpstreamSignal[] = [];
const sseClients = new Set<express.Response>();
const feedHealthMap = new Map<string, UpstreamFeedHealth>();

let xBridgeBaseUrl = 'https://nitter.jaydenha.uk';
let xBridgeHandle = 'karpathy';

function stripHtmlAndEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<table[\s\S]*?<\/table>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;|&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
    .replace(/&#39;|&#8217;|&#8216;|&lsquo;|&rsquo;|&apos;/g, "'")
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, '—')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 31 ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 31 ? String.fromCodePoint(code) : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchFast(url: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    headers: {
      'User-Agent': 'web:cortex-singularity:v2.0 (Enterprise-AI-Telemetry)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*',
      ...headers,
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

interface ArticleEnrichmentResult {
  fullText: string;
  ogImage?: string;
}

const articleEnrichmentCache = new Map<string, ArticleEnrichmentResult>();
const arxivFigureCache = new Map<string, string | null>();

function isValidContentImageUrl(candidate: string): boolean {
  if (!candidate || !candidate.startsWith('https://')) return false;
  const lower = candidate.toLowerCase();
  if (
    lower.endsWith('.svg') ||
    lower.endsWith('.ico') ||
    lower.includes('favicon') ||
    lower.includes('avatar') ||
    lower.includes('pixel') ||
    lower.includes('1x1') ||
    lower.includes('tracker') ||
    lower.includes('emoji') ||
    lower.includes('logo-small') ||
    lower.includes('orcid')
  ) {
    return false;
  }
  return true;
}

/**
 * Extracts first figure thumbnail from https://arxiv.org/html/<id> when an HTML edition is available.
 */
async function extractArxivFirstFigureUrl(rawUrlOrId: string): Promise<string | undefined> {
  const idMatch = (rawUrlOrId || '').match(/\b(\d{4}\.\d{4,5}(?:v\d+)?)\b/i);
  if (!idMatch) return undefined;
  const arxivId = idMatch[1];

  if (arxivFigureCache.has(arxivId)) {
    return arxivFigureCache.get(arxivId) || undefined;
  }

  try {
    const htmlUrl = `https://arxiv.org/html/${arxivId}`;
    const res = await fetch(htmlUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(2400),
    });
    if (!res.ok) {
      arxivFigureCache.set(arxivId, null);
      return undefined;
    }
    const html = (await res.text()).slice(0, 220_000);
    const baseTagHref = html.match(/<base[^>]+href=["']([^"']+)["']/i)?.[1];
    const effectiveBase = baseTagHref ? new URL(baseTagHref, res.url).href : res.url;

    const figImgMatch =
      html.match(/<figure[\s\S]{0,1800}?<img[^>]+src=["']([^"']+)["']/i) ||
      html.match(/<img[^>]+class=["'][^"']*ltx_graphics[^"']*["'][^>]+src=["']([^"']+)["']/i) ||
      html.match(/<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*ltx_graphics[^"']*["']/i);

    const rawSrc = figImgMatch?.[1] ? stripHtmlAndEntities(figImgMatch[1]) : '';
    if (rawSrc) {
      const resolved = new URL(rawSrc, effectiveBase).href;
      if (isValidContentImageUrl(resolved)) {
        if (arxivFigureCache.size > 200) {
          const oldest = arxivFigureCache.keys().next().value;
          if (oldest) arxivFigureCache.delete(oldest);
        }
        arxivFigureCache.set(arxivId, resolved);
        return resolved;
      }
    }
  } catch {
    // Ignore papers without HTML figure rendering
  }

  arxivFigureCache.set(arxivId, null);
  return undefined;
}

function extractMetaContent(html: string, attrPattern: string): string {
  const rx1 = new RegExp(
    `<meta[^>]+(?:property|name)=["'](?:${attrPattern})["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const rx2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:${attrPattern})["']`,
    'i'
  );
  return stripHtmlAndEntities(html.match(rx1)?.[1] || html.match(rx2)?.[1] || '');
}

/**
 * Fast, cached full-text HTML & OpenGraph extractor (2.5s hard timeout) for thin RSS/blog/HN links.
 * Strips chrome (<script>/<style>/<nav>/<header>/<footer>/<aside>) and extracts multi-paragraph facts + og:image / twitter:image.
 */
async function enrichThinArticle(rawUrl: string): Promise<ArticleEnrichmentResult | null> {
  if (!rawUrl || !rawUrl.startsWith('http')) return null;

  const ghOg = resolveGitHubOpenGraphImage(rawUrl);
  if (rawUrl.includes('github.com/') && ghOg) {
    const cachedGh = articleEnrichmentCache.get(rawUrl);
    if (cachedGh) return cachedGh;
  }

  if (
    rawUrl.includes('reddit.com/') ||
    rawUrl.includes('news.ycombinator.com/item') ||
    rawUrl.includes('bsky.app/') ||
    rawUrl.endsWith('.pdf')
  ) {
    return null;
  }

  const cached = articleEnrichmentCache.get(rawUrl);
  if (cached) return cached;

  try {
    const res = await fetch(rawUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) {
      return ghOg ? { fullText: '', ogImage: ghOg } : null;
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('xhtml')) {
      return ghOg ? { fullText: '', ogImage: ghOg } : null;
    }

    const rawHtml = (await res.text()).slice(0, 260_000);
    const ogDesc = extractMetaContent(
      rawHtml,
      'og:description|twitter:description|description'
    );
    const rawOgImg = extractMetaContent(
      rawHtml,
      'og:image:secure_url|og:image:url|og:image|twitter:image:src|twitter:image'
    );
    let ogImage: string | undefined = ghOg;
    if (rawOgImg) {
      try {
        const resolved = new URL(rawOgImg, res.url || rawUrl).href;
        if (isValidContentImageUrl(resolved)) ogImage = resolved;
      } catch {
        // Ignore malformed relative image URL
      }
    }

    // Strip non-content boilerplate blocks before scanning <article> / <main> / <p>
    const cleanedRegionHtml = rawHtml
      .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|button)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');

    const articleMatch =
      cleanedRegionHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
      cleanedRegionHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    const targetRegion = articleMatch?.[1] || cleanedRegionHtml;

    const paragraphs: string[] = [];
    const seenNorm = new Set<string>();
    const pRegex = /<(?:p|li)[^>]*>([\s\S]*?)<\/(?:p|li)>/gi;
    let m: RegExpExecArray | null;
    while ((m = pRegex.exec(targetRegion)) !== null) {
      const text = stripHtmlAndEntities(m[1]);
      if (text.length < 48) continue;
      if (
        /^(cookie|privacy policy|terms of use|subscribe to|sign up for|all rights reserved|share this|follow us on|read more at)/i.test(
          text
        )
      ) {
        continue;
      }
      const norm = text.toLowerCase().slice(0, 80);
      if (seenNorm.has(norm)) continue;
      seenNorm.add(norm);
      paragraphs.push(text);
      if (paragraphs.join(' ').length >= 3000 || paragraphs.length >= 12) break;
    }

    const joinedBody = paragraphs.join(' ').trim();
    const fullText =
      joinedBody.length >= 140
        ? ogDesc && !joinedBody.toLowerCase().includes(ogDesc.toLowerCase().slice(0, 45))
          ? `${ogDesc} ${joinedBody}`.slice(0, 3200)
          : joinedBody.slice(0, 3200)
        : ogDesc.slice(0, 1200);

    const entry: ArticleEnrichmentResult = { fullText, ogImage };
    if (articleEnrichmentCache.size > 320) {
      const oldestKey = articleEnrichmentCache.keys().next().value;
      if (oldestKey) articleEnrichmentCache.delete(oldestKey);
    }
    articleEnrichmentCache.set(rawUrl, entry);
    return entry;
  } catch {
    return null;
  }
}

function stripRedundantOriginPrefix(rawTitle: string, originName: string): string {
  let cleaned = rawTitle.trim();
  const escapedOrigin = originName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  cleaned = cleaned.replace(new RegExp(`^${escapedOrigin}\\s*[:—-]\\s*`, 'i'), '');
  cleaned = cleaned.replace(/^(?:OpenAI News|Google DeepMind|Anthropic News|Meta AI Eng|HF Paper|arXiv)\s*:\s*/i, '');
  return cleaned.trim() || rawTitle.trim();
}

function parseUniversalFeedXml(
  xml: string,
  feedId: string,
  originName: string,
  sourceType: RawUpstreamSignal['source'],
  category: Exclude<SourceCategory, 'DEMO_SEED'>,
  fallbackUrl: string,
  maxItems = 4
): RawUpstreamSignal[] {
  const isAtom = xml.includes('<entry>') || xml.includes('<entry ');
  const chunks = isAtom
    ? xml.split(/<entry[\s>]/i).slice(1, maxItems + 1)
    : xml.split(/<item[\s>]/i).slice(1, maxItems + 1);

  return chunks
    .map((chunk, idx): RawUpstreamSignal | null => {
      const titleMatch = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const rawTitleParsed = stripHtmlAndEntities(titleMatch?.[1] || '');
      if (!rawTitleParsed) return null;
      const cleanTitle = stripRedundantOriginPrefix(rawTitleParsed, originName);

      let link = fallbackUrl;
      const hrefMatch = chunk.match(/<link[^>]+href=["']([^"']+)["']/i);
      const tagLinkMatch = chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
      if (hrefMatch?.[1]) {
        link = stripHtmlAndEntities(hrefMatch[1]);
      } else if (tagLinkMatch?.[1]) {
        const cand = stripHtmlAndEntities(tagLinkMatch[1]);
        if (cand.startsWith('http')) link = cand;
      }

      // Prefer richest XML content block first (Atom <content> or RSS <content:encoded>)
      const contentEncodedMatch = chunk.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
      const contentMatch = chunk.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
      const descMatch = chunk.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
      const summaryMatch = chunk.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
      const rawBodyHtml =
        contentEncodedMatch?.[1] || contentMatch?.[1] || descMatch?.[1] || summaryMatch?.[1] || '';
      const cleanSummary = stripHtmlAndEntities(rawBodyHtml).slice(0, 3200);

      // Extract real upstream image from <media:content>, <enclosure>, or inline <img> if valid
      const mediaUrlMatch =
        chunk.match(/<media:(?:content|thumbnail)[^>]+url=["']([^"']+)["']/i) ||
        chunk.match(/<enclosure[^>]+url=["']([^"']+\.(?:png|jpe?g|webp))["']/i) ||
        rawBodyHtml.match(/<img[^>]+src=["'](https:\/\/[^"']+)["']/i);
      const candidateImg = mediaUrlMatch?.[1] ? stripHtmlAndEntities(mediaUrlMatch[1]) : '';
      const ghOgFallback = !isValidContentImageUrl(candidateImg)
        ? resolveGitHubOpenGraphImage(link)
        : undefined;
      const resolvedVisualUrl = isValidContentImageUrl(candidateImg) ? candidateImg : ghOgFallback;
      const mediaItems: RawUpstreamSignal['mediaItems'] = resolvedVisualUrl
        ? [
            {
              type: 'image',
              url: resolvedVisualUrl,
              caption: ghOgFallback ? `${originName} repository preview` : `${originName} figure`,
              sourceNetwork: originName,
            },
          ]
        : undefined;

      const dateMatch =
        chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
        chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/i) ||
        chunk.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
      const parsedDate = dateMatch?.[1] ? Date.parse(stripHtmlAndEntities(dateMatch[1])) : NaN;

      const guidMatch = chunk.match(/<(?:guid|id)[^>]*>([\s\S]*?)<\/(?:guid|id)>/i);
      const stableKey = stripHtmlAndEntities(guidMatch?.[1] || link || `${cleanTitle}-${idx}`)
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(-36);

      return {
        id: `${feedId}-${stableKey || idx}`,
        title: cleanTitle,
        summary: cleanSummary || cleanTitle,
        url: link,
        source: sourceType,
        sourceCategory: category,
        originFeedName: originName,
        publishedAtMs: Number.isFinite(parsedDate) ? parsedDate : Date.now(),
        score: category === 'AI_LAB' || category === 'VIP_VOICE' ? 165 : 120,
        mediaItems,
      };
    })
    .filter((item): item is RawUpstreamSignal => item !== null);
}

function makeRssDescriptor(
  id: string,
  name: string,
  category: Exclude<SourceCategory, 'DEMO_SEED'>,
  sourceType: RawUpstreamSignal['source'],
  url: string,
  maxItems = 3
): FeedDescriptor {
  return {
    id,
    name,
    category,
    sourceType,
    url,
    fetcher: async () => {
      const res = await fetchFast(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const parsed = parseUniversalFeedXml(xml, id, name, sourceType, category, url, maxItems).filter(
        (item) =>
          category !== 'REDDIT' ||
          isHighSignalRedditPost({ title: item.title, selftext: item.summary, ups: 25, num_comments: 8 })
      );

      // Enrich thin AI_LAB / VIP_VOICE / GHRelease RSS items with real article paragraphs + og:image
      if (category === 'AI_LAB' || category === 'VIP_VOICE' || category === 'GH_RELEASE') {
        await Promise.allSettled(
          parsed.map(async (item) => {
            const isThin =
              item.summary.length < 280 ||
              item.summary.toLowerCase() === item.title.toLowerCase();
            if (!isThin && item.mediaItems && item.mediaItems.length > 0) return;
            const enriched = await enrichThinArticle(item.url);
            if (!enriched) return;
            if (enriched.fullText && enriched.fullText.length > item.summary.length) {
              item.summary = enriched.fullText;
            }
            if (enriched.ogImage && (!item.mediaItems || item.mediaItems.length === 0)) {
              item.mediaItems = [
                {
                  type: 'image',
                  url: enriched.ogImage,
                  caption: `${name} article visual`,
                  sourceNetwork: name,
                },
              ];
            }
          })
        );
      }

      return parsed;
    },
  };
}

function makeBlueskyDescriptor(id: string, displayName: string, actorHandle: string): FeedDescriptor {
  const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(
    actorHandle
  )}&filter=posts_no_replies&limit=4`;
  return {
    id,
    name: displayName,
    category: 'SOCIAL_BLUESKY',
    sourceType: 'Bluesky',
    url: `https://bsky.app/profile/${actorHandle}`,
    fetcher: async () => {
      const res = await fetchFast(apiUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        feed?: Array<{
          post?: {
            uri?: string;
            likeCount?: number;
            replyCount?: number;
            indexedAt?: string;
            author?: { handle?: string };
            record?: { text?: string; createdAt?: string };
          };
        }>;
      };
      return (data.feed || [])
        .map((entry) => entry.post)
        .filter((p) => p?.record?.text && p.record.text.trim().length > 24)
        .slice(0, 3)
        .map((p, i) => {
          const text = stripHtmlAndEntities(p!.record!.text!);
          const rkey = p!.uri?.split('/').pop() || `${i}`;
          const handle = p!.author?.handle || actorHandle;
          const likes = Number(p!.likeCount || 0);
          const replies = Number(p!.replyCount || 0);
          const publishedAtMs = Date.parse(p!.record?.createdAt || p!.indexedAt || '') || Date.now();
          const ageHrs = Math.max(0.5, (Date.now() - publishedAtMs) / 3_600_000);
          return {
            id: `bsky-${handle}-${rkey}`,
            title: text.slice(0, 118),
            summary: text.slice(0, 900),
            url: `https://bsky.app/profile/${handle}/post/${rkey}`,
            source: 'Bluesky' as const,
            sourceCategory: 'SOCIAL_BLUESKY' as const,
            originFeedName: displayName,
            publishedAtMs,
            score: 110 + Math.min(120, likes / 2),
            engagementVelocity:
              likes > 0
                ? {
                    likesOrUps: likes,
                    commentsOrReplies: replies,
                    velocityPerHour: Math.max(1, Math.round(likes / ageHrs)),
                    badgeText: `${likes} ${likes === 1 ? 'like' : 'likes'}${
                      replies > 0 ? ` · ${replies} ${replies === 1 ? 'reply' : 'replies'}` : ''
                    }`,
                  }
                : undefined,
          };
        });
    },
  };
}

const dynamicCustomFeeds: FeedDescriptor[] = [];

function buildCoreDescriptors(): FeedDescriptor[] {
  const list: FeedDescriptor[] = [
    // 1. Core Research & Technical Streams
    {
      id: 'arxiv-ai',
      name: 'arXiv cs.AI / cs.CL',
      category: 'RESEARCH',
      sourceType: 'arXiv',
      url: 'https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=6',
      fetcher: async () => {
        const res = await fetchFast(
          'https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=6'
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        const parsed = parseUniversalFeedXml(
          xml,
          'arxiv',
          'arXiv',
          'arXiv',
          'RESEARCH',
          'https://arxiv.org',
          5
        );
        await Promise.allSettled(
          parsed.map(async (item) => {
            if (item.mediaItems && item.mediaItems.length > 0) return;
            const figUrl = await extractArxivFirstFigureUrl(item.url);
            if (figUrl) {
              item.mediaItems = [
                {
                  type: 'image',
                  url: figUrl,
                  caption: 'arXiv HTML paper Figure 1',
                  sourceNetwork: 'arXiv',
                },
              ];
            }
          })
        );
        return parsed;
      },
    },
    {
      id: 'hf-daily-papers',
      name: 'Hugging Face Daily Papers',
      category: 'RESEARCH',
      sourceType: 'HuggingFace',
      url: 'https://huggingface.co/api/daily_papers?limit=5',
      fetcher: async () => {
        const res = await fetchFast('https://huggingface.co/api/daily_papers?limit=5');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items = (await res.json()) as Array<{
          paper?: { id?: string; title?: string; summary?: string; upvotes?: number; publishedAt?: string };
          thumbnail?: string;
        }>;
        const mapped: RawUpstreamSignal[] = items
          .filter((it) => it.paper?.title)
          .map((it) => {
            const pid = it.paper!.id || '';
            const upvotes = Number(it.paper!.upvotes || 0);
            const publishedAtMs = Date.parse(it.paper!.publishedAt || '') || Date.now();
            const ageHrs = Math.max(1, (Date.now() - publishedAtMs) / 3_600_000);
            const hfThumb =
              it.thumbnail && isValidContentImageUrl(it.thumbnail)
                ? it.thumbnail
                : pid
                ? `https://cdn-thumbnails.huggingface.co/social-thumbnails/papers/${pid}.png`
                : '';
            return {
              id: `hf-${pid || Math.random().toString(36).slice(2, 8)}`,
              title: it.paper!.title!.trim(),
              summary: (it.paper!.summary || it.paper!.title!).replace(/\s+/g, ' ').trim().slice(0, 1500),
              url: `https://huggingface.co/papers/${pid}`,
              source: 'HuggingFace' as const,
              sourceCategory: 'RESEARCH' as const,
              originFeedName: 'HF Daily Papers',
              publishedAtMs,
              score: (upvotes || 25) * 3 + 50,
              mediaItems: hfThumb
                ? [
                    {
                      type: 'image',
                      url: hfThumb,
                      caption: 'Paper preview figure · HF Daily Papers',
                      sourceNetwork: 'HuggingFace',
                    },
                  ]
                : undefined,
              engagementVelocity:
                upvotes > 0
                  ? {
                      likesOrUps: upvotes,
                      commentsOrReplies: 0,
                      velocityPerHour: Math.max(1, Math.round(upvotes / ageHrs)),
                      badgeText: `${upvotes} ${upvotes === 1 ? 'upvote' : 'upvotes'}`,
                    }
                  : undefined,
            };
          });

        // Upgrade HF papers to direct arXiv HTML Figure 1 when available
        await Promise.allSettled(
          mapped.map(async (item) => {
            const figUrl = await extractArxivFirstFigureUrl(item.url);
            if (figUrl) {
              item.mediaItems = [
                {
                  type: 'image',
                  url: figUrl,
                  caption: 'Paper Figure 1 · arXiv HTML',
                  sourceNetwork: 'arXiv / HF',
                },
              ];
            }
          })
        );
        return mapped;
      },
    },
    {
      id: 'hn-algolia',
      name: 'Hacker News AI Stream',
      category: 'HN_COMMUNITY',
      sourceType: 'HackerNews',
      url: 'https://hn.algolia.com/api/v1/search_by_date?query=AI%20OR%20LLM%20OR%20MCP&tags=story&hitsPerPage=6',
      fetcher: async () => {
        const res = await fetchFast(
          'https://hn.algolia.com/api/v1/search_by_date?query=AI%20OR%20LLM%20OR%20MCP%20OR%20Anthropic%20OR%20OpenAI&tags=story&hitsPerPage=6'
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          hits?: Array<{
            objectID: string;
            title?: string;
            url?: string;
            story_text?: string;
            points?: number;
            num_comments?: number;
            created_at_i?: number;
          }>;
        };
        const mapped: RawUpstreamSignal[] = (data.hits || [])
          .filter((h) => h.title)
          .map((h) => {
            const pts = Number(h.points || 0);
            const comments = Number(h.num_comments || 0);
            const publishedAtMs = h.created_at_i ? h.created_at_i * 1000 : Date.now();
            const ageHrs = Math.max(0.5, (Date.now() - publishedAtMs) / 3_600_000);
            const storyText = stripHtmlAndEntities(h.story_text || '').slice(0, 1400);
            return {
              id: `hn-${h.objectID}`,
              title: h.title!.trim(),
              summary: storyText || h.title!.trim(),
              url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
              source: 'HackerNews' as const,
              sourceCategory: 'HN_COMMUNITY' as const,
              originFeedName: 'Hacker News',
              publishedAtMs,
              score: (pts || 20) + 35,
              engagementVelocity:
                pts > 0
                  ? {
                      likesOrUps: pts,
                      commentsOrReplies: comments,
                      velocityPerHour: Math.max(1, Math.round((pts + comments * 2) / ageHrs)),
                      badgeText: `${pts} ${pts === 1 ? 'pt' : 'pts'}${
                        comments > 0 ? ` · ${comments} ${comments === 1 ? 'comment' : 'comments'}` : ''
                      }`,
                    }
                  : undefined,
            };
          });

        // Enrich external HN story links that lack inline story_text
        await Promise.allSettled(
          mapped.map(async (item) => {
            if (item.summary.length >= 240) return;
            const enriched = await enrichThinArticle(item.url);
            if (!enriched) return;
            if (enriched.fullText && enriched.fullText.length > item.summary.length) {
              item.summary = enriched.fullText;
            }
            if (enriched.ogImage && (!item.mediaItems || item.mediaItems.length === 0)) {
              item.mediaItems = [
                {
                  type: 'image',
                  url: enriched.ogImage,
                  caption: 'Linked article figure',
                  sourceNetwork: 'Hacker News',
                },
              ];
            }
          })
        );
        return mapped;
      },
    },
    {
      id: 'gh-mcp-repos',
      name: 'GitHub Agent & MCP Repos',
      category: 'GH_RELEASE',
      sourceType: 'GitHub',
      url: 'https://api.github.com/search/repositories?q=topic:mcp+OR+topic:ai-agents+stars:>150&sort=updated&order=desc&per_page=4',
      fetcher: async () => {
        const res = await fetchFast(
          'https://api.github.com/search/repositories?q=topic:mcp+OR+topic:ai-agents+stars:>150&sort=updated&order=desc&per_page=4',
          { Accept: 'application/vnd.github+json' }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          items?: Array<{
            id: number;
            full_name: string;
            description?: string;
            html_url: string;
            stargazers_count?: number;
            forks_count?: number;
            pushed_at?: string;
          }>;
        };
        return (data.items || []).map((repo) => {
          const stars = Number(repo.stargazers_count || 0);
          const forks = Number(repo.forks_count || 0);
          const publishedAtMs = Date.parse(repo.pushed_at || '') || Date.now();
          const ghOg = resolveGitHubOpenGraphImage(repo.html_url);
          return {
            id: `gh-${repo.id}`,
            title: `${repo.full_name}${repo.description ? ` — ${repo.description}` : ''}`.slice(0, 150),
            summary:
              repo.description ||
              `Open-source repository ${repo.full_name} updated on GitHub (${stars.toLocaleString()} stars).`,
            url: repo.html_url,
            source: 'GitHub' as const,
            sourceCategory: 'GH_RELEASE' as const,
            originFeedName: `GitHub · ${repo.full_name.split('/')[0]}`,
            publishedAtMs,
            score: Math.min(400, (stars || 150) / 5),
            mediaItems: ghOg
              ? [
                  {
                    type: 'image',
                    url: ghOg,
                    caption: `${repo.full_name} OpenGraph card`,
                    sourceNetwork: 'GitHub',
                  },
                ]
              : undefined,
            engagementVelocity:
              stars > 0
                ? {
                    likesOrUps: stars,
                    commentsOrReplies: forks,
                    velocityPerHour: Math.max(1, Math.round(stars / 120)),
                    badgeText: `${stars.toLocaleString()} stars${forks > 0 ? ` · ${forks} forks` : ''}`,
                  }
                : undefined,
          };
        });
      },
    },

    // 2. $0 VIP Voices & Builder Substacks / Blogs
    makeRssDescriptor('vip-karpathy', 'Andrej Karpathy', 'VIP_VOICE', 'VIPBlog', 'https://karpathy.bearblog.dev/feed/', 2),
    makeRssDescriptor('vip-willison', 'Simon Willison', 'VIP_VOICE', 'VIPBlog', 'https://simonwillison.net/atom/everything/', 3),
    makeRssDescriptor('vip-mollick', 'Ethan Mollick', 'VIP_VOICE', 'VIPBlog', 'https://www.oneusefulthing.org/feed', 2),
    makeRssDescriptor('vip-swyx', 'Swyx · Latent Space', 'VIP_VOICE', 'VIPBlog', 'https://www.latent.space/feed', 2),
    makeRssDescriptor('vip-lambert', 'Nathan Lambert', 'VIP_VOICE', 'VIPBlog', 'https://www.interconnects.ai/feed', 2),
    makeRssDescriptor('vip-lilian', 'Lilian Weng', 'VIP_VOICE', 'VIPBlog', 'https://lilianweng.github.io/index.xml', 2),

    // 3. $0 Bluesky Public AppView Feeds
    makeBlueskyDescriptor('bsky-willison', 'Bluesky · @simonwillison', 'simonwillison.net'),
    makeBlueskyDescriptor('bsky-mollick', 'Bluesky · @emollick', 'emollick.bsky.social'),
    makeBlueskyDescriptor('bsky-lambert', 'Bluesky · @natolambert', 'natolambert.bsky.social'),

    // 4. $0 Reddit AI Communities (RSS with custom User-Agent)
    makeRssDescriptor('reddit-localllama', 'r/LocalLLaMA', 'REDDIT', 'Reddit', 'https://www.reddit.com/r/LocalLLaMA/hot.rss?limit=4', 3),
    makeRssDescriptor('reddit-ml', 'r/MachineLearning', 'REDDIT', 'Reddit', 'https://www.reddit.com/r/MachineLearning/hot.rss?limit=3', 2),
    makeRssDescriptor('reddit-agents', 'r/AI_Agents', 'REDDIT', 'Reddit', 'https://www.reddit.com/r/AI_Agents/hot.rss?limit=3', 2),
    makeRssDescriptor('reddit-singularity', 'r/singularity', 'REDDIT', 'Reddit', 'https://www.reddit.com/r/singularity/hot.rss?limit=3', 2),

    // 5. Official AI Lab Blogs
    makeRssDescriptor('lab-openai', 'OpenAI News', 'AI_LAB', 'LabRelease', 'https://openai.com/news/rss.xml', 3),
    makeRssDescriptor('lab-deepmind', 'Google DeepMind', 'AI_LAB', 'LabRelease', 'https://deepmind.google/blog/rss.xml', 3),
    makeRssDescriptor('lab-google-ai', 'Google AI Blog', 'AI_LAB', 'LabRelease', 'https://blog.google/technology/ai/rss/', 2),
    makeRssDescriptor(
      'lab-anthropic',
      'Anthropic News',
      'AI_LAB',
      'LabRelease',
      'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml',
      2
    ),
    makeRssDescriptor('lab-meta-ai', 'Meta AI Eng', 'AI_LAB', 'LabRelease', 'https://engineering.fb.com/category/ml-applications/feed/', 2),
    makeRssDescriptor('lab-mistral', 'Mistral AI', 'AI_LAB', 'LabRelease', 'https://mistral.ai/news/rss.xml', 2),

    // 6. GitHub Official Releases (.atom feeds — $0, no REST rate-limit bottleneck)
    makeRssDescriptor('ghrel-ollama', 'ollama Release', 'GH_RELEASE', 'GHRelease', 'https://github.com/ollama/ollama/releases.atom', 2),
    makeRssDescriptor('ghrel-vllm', 'vLLM Release', 'GH_RELEASE', 'GHRelease', 'https://github.com/vllm-project/vllm/releases.atom', 2),
    makeRssDescriptor('ghrel-langchain', 'LangChain Release', 'GH_RELEASE', 'GHRelease', 'https://github.com/langchain-ai/langchain/releases.atom', 2),
    makeRssDescriptor('ghrel-claude-code', 'claude-code Release', 'GH_RELEASE', 'GHRelease', 'https://github.com/anthropics/claude-code/releases.atom', 2),
    makeRssDescriptor('ghrel-codex', 'openai/codex Release', 'GH_RELEASE', 'GHRelease', 'https://github.com/openai/codex/releases.atom', 2),
  ];

  // Optional Fast-Fail X-RSS / RSS-Bridge Slot (explicitly forbidding dead nitter.net / xcancel.com)
  if (
    xBridgeBaseUrl &&
    !xBridgeBaseUrl.includes('nitter.net') &&
    !xBridgeBaseUrl.includes('xcancel.com')
  ) {
    const cleanBase = xBridgeBaseUrl.replace(/\/+$/, '');
    const bridgeFeedUrl = cleanBase.includes('/rss') ? cleanBase : `${cleanBase}/${xBridgeHandle}/rss`;
    list.push(
      makeRssDescriptor(
        'x-rss-bridge',
        `X-Bridge · @${xBridgeHandle}`,
        'X_BRIDGE',
        'XBridge',
        bridgeFeedUrl,
        2
      )
    );
  }

  return [...list, ...dynamicCustomFeeds];
}

let isRefreshing = false;
async function refreshAllUpstreams(): Promise<RawUpstreamSignal[]> {
  if (isRefreshing) return cachedLiveSignals;
  isRefreshing = true;

  try {
    const descriptors = buildCoreDescriptors();
    const settled = await Promise.allSettled(
      descriptors.map(async (desc) => {
        const t0 = performance.now();
        try {
          const items = await desc.fetcher();
          const latencyMs = Math.round(performance.now() - t0);
          feedHealthMap.set(desc.id, {
            id: desc.id,
            name: desc.name,
            category: desc.category,
            url: desc.url,
            status: 'ONLINE',
            latencyMs,
            itemCount: items.length,
            lastCheckedMs: Date.now(),
          });
          return items;
        } catch (err) {
          const latencyMs = Math.round(performance.now() - t0);
          feedHealthMap.set(desc.id, {
            id: desc.id,
            name: desc.name,
            category: desc.category,
            url: desc.url,
            status: 'FAST_FAIL',
            latencyMs,
            itemCount: 0,
            lastCheckedMs: Date.now(),
            errorHint: (err as Error).name === 'TimeoutError' ? 'Timeout >2.5s' : (err as Error).message.slice(0, 60),
          });
          throw err;
        }
      })
    );

    const newlyFound: RawUpstreamSignal[] = [];
    for (const res of settled) {
      if (res.status === 'fulfilled') {
        for (const item of res.value) {
          if (!seenUpstreamIds.has(item.id)) {
            seenUpstreamIds.add(item.id);
            newlyFound.push(item);
          }
        }
      }
    }

    if (newlyFound.length > 0) {
      // Interleave diverse categories first so no single feed dominates
      newlyFound.sort((a, b) => (b.score ?? 100) - (a.score ?? 100));
      cachedLiveSignals = [...newlyFound, ...cachedLiveSignals].slice(0, 140);
      for (const client of sseClients) {
        client.write(`event: upstream_batch\ndata: ${JSON.stringify(newlyFound.slice(0, 12))}\n\n`);
      }
      // Quietly pre-warm top 8 highest-mass / Supernova live nodes via local Ollama (1 at a time)
      enqueueTopLiveNodesForOllamaPrewarm(cachedLiveSignals);
    }
    return cachedLiveSignals;
  } finally {
    isRefreshing = false;
  }
}

function broadcastLiveSignalsToSse(items: RawUpstreamSignal[], eventName = 'upstream_batch'): void {
  if (items.length === 0) return;
  const fresh: RawUpstreamSignal[] = [];
  for (const item of items) {
    if (!seenUpstreamIds.has(item.id)) {
      seenUpstreamIds.add(item.id);
      fresh.push(item);
    }
  }
  if (fresh.length === 0) return;

  cachedLiveSignals = [...fresh, ...cachedLiveSignals].slice(0, 180);
  const payload = JSON.stringify(fresh.slice(0, 14));
  for (const client of sseClients) {
    client.write(`event: ${eventName}\ndata: ${payload}\n\n`);
  }
  enqueueTopLiveNodesForOllamaPrewarm(cachedLiveSignals);
}

registerAdapterSignalSink((items, adapterId) => {
  broadcastLiveSignalsToSse(
    items,
    adapterId === 'discord_relay' ? 'discord_announcement' : 'upstream_batch'
  );
});

export async function collectAllUpstreamSignalsOnce(): Promise<RawUpstreamSignal[]> {
  return refreshAllUpstreams();
}

// Initial parallel non-blocking warm-up + 60s cadence + Underground Adapter Switchboard
if (!process.env.CORTEX_CLI_IMPORT_ONLY) {
  void refreshAllUpstreams();
  startUndergroundAdapterSchedulers();
  setInterval(() => {
    void refreshAllUpstreams();
  }, 60_000);
}

app.get('/api/health', async (_req, res) => {
  const healthList = Array.from(feedHealthMap.values());
  const onlineCount = healthList.filter((h) => h.status === 'ONLINE').length;
  const switchboard = await getFullSwitchboardAndSynthesisStatus();
  res.json({
    ok: true,
    edition: 'CORTEX // OMNISCIENCE v3',
    sseStreamLive: true,
    sseConnectedClients: sseClients.size,
    cachedLiveCount: cachedLiveSignals.length,
    totalFeeds: healthList.length,
    onlineFeeds: onlineCount,
    timeoutCapMs: UPSTREAM_TIMEOUT_MS,
    adapters: switchboard.adapters.map((a) => ({
      id: a.id,
      state: a.state,
      enabled: a.enabled,
      signalsFetched: a.signalsFetched,
      avgLatencyMs: a.avgLatencyMs,
    })),
    ollamaOnline: switchboard.synthesis.ollama.online,
    ollamaSelectedModel: switchboard.synthesis.ollama.selectedModel,
    timestamp: Date.now(),
  });
});

app.get('/api/adapters/status', async (_req, res) => {
  const status = await getFullSwitchboardAndSynthesisStatus();
  res.json({
    ok: true,
    sseStreamEndpoint: '/api/stream/live',
    sseStreamLive: true,
    ...status,
  });
});

app.post('/api/adapters/config', async (req, res) => {
  try {
    await updateSwitchboardConfig(req.body || {});
    const status = await getFullSwitchboardAndSynthesisStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

app.post('/api/adapters/benchmark', async (req, res) => {
  const { adapterId } = (req.body || {}) as { adapterId?: AdapterId };
  const t0 = Date.now();
  try {
    let items: RawUpstreamSignal[] = [];
    if (adapterId === 'x_playwright') {
      items = await pollPlaywrightXAdapter();
    } else {
      items = await pollDeepRedditStreetEngine();
    }
    const status = await getFullSwitchboardAndSynthesisStatus();
    res.json({
      ok: true,
      adapterId: adapterId || 'reddit_street',
      fetchedCount: items.length,
      elapsedMs: Date.now() - t0,
      ...status,
    });
  } catch (err) {
    res.status(502).json({ ok: false, error: (err as Error).message });
  }
});

app.post('/api/adapters/x-playwright/login-window', async (_req, res) => {
  const out = await triggerPlaywrightLoginFlow();
  const status = await getFullSwitchboardAndSynthesisStatus();
  res.json({ ...out, ...status });
});

app.post('/api/ingest/discord-webhook', async (req, res) => {
  try {
    const signal = ingestDiscordWebhookRelay(req.body || {});
    const status = await getFullSwitchboardAndSynthesisStatus();
    res.json({ ok: true, signal, ...status });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

app.get('/api/synthesis/engines', async (_req, res) => {
  const ollama = await probeOllamaStatus();
  const full = await getFullSwitchboardAndSynthesisStatus();
  res.json({ ok: true, ollama, synthesis: full.synthesis });
});

app.get('/api/live-batch', async (_req, res) => {
  if (cachedLiveSignals.length === 0) {
    await refreshAllUpstreams();
  }
  res.json({
    items: cachedLiveSignals.slice(0, 72),
    fetchedAtMs: Date.now(),
  });
});

app.get('/api/sources', (_req, res) => {
  const descriptors = buildCoreDescriptors();
  const sources: UpstreamFeedHealth[] = descriptors.map(
    (d) =>
      feedHealthMap.get(d.id) || {
        id: d.id,
        name: d.name,
        category: d.category,
        url: d.url,
        status: 'IDLE',
        latencyMs: 0,
        itemCount: 0,
        lastCheckedMs: 0,
      }
  );
  res.json({
    sources,
    xBridgeBaseUrl,
    xBridgeHandle,
    cachedLiveCount: cachedLiveSignals.length,
  });
});

app.post('/api/sources/refresh', async (_req, res) => {
  await Promise.allSettled([refreshAllUpstreams(), pollDeepRedditStreetEngine()]);
  res.json({ ok: true, cachedLiveCount: cachedLiveSignals.length });
});

app.post('/api/sources/custom', async (req, res) => {
  const { kind, value, label, xBaseUrl, xHandle } = req.body as {
    kind?: 'RSS' | 'BLUESKY' | 'REDDIT' | 'X_BRIDGE';
    value?: string;
    label?: string;
    xBaseUrl?: string;
    xHandle?: string;
  };

  if (kind === 'X_BRIDGE') {
    if (
      xBaseUrl &&
      (xBaseUrl.includes('nitter.net') || xBaseUrl.includes('xcancel.com'))
    ) {
      res.status(400).json({
        error: 'Dead endpoints nitter.net and xcancel.com are blocked. Use nitter.jaydenha.uk or a live RSS-Bridge/RSSHub URL.',
      });
      return;
    }
    if (xBaseUrl !== undefined) xBridgeBaseUrl = xBaseUrl.trim();
    if (xHandle) xBridgeHandle = xHandle.trim().replace(/^@/, '');
    await refreshAllUpstreams();
    res.json({ ok: true, xBridgeBaseUrl, xBridgeHandle });
    return;
  }

  const rawVal = (value || '').trim();
  if (!rawVal) {
    res.status(400).json({ error: 'Missing feed URL or handle' });
    return;
  }

  const customId = `custom-${Date.now().toString(36)}`;
  if (kind === 'BLUESKY' || (!rawVal.startsWith('http') && rawVal.includes('.'))) {
    const cleanHandle = rawVal.replace(/^@/, '');
    dynamicCustomFeeds.push(
      makeBlueskyDescriptor(customId, label || `Bluesky · @${cleanHandle}`, cleanHandle)
    );
  } else if (kind === 'REDDIT' || rawVal.startsWith('r/')) {
    const sub = rawVal.replace(/^\/?r\//, '');
    dynamicCustomFeeds.push(
      makeRssDescriptor(
        customId,
        label || `r/${sub}`,
        'REDDIT',
        'Reddit',
        `https://www.reddit.com/r/${sub}/hot.rss?limit=4`,
        3
      )
    );
  } else {
    dynamicCustomFeeds.push(
      makeRssDescriptor(
        customId,
        label || new URL(rawVal).hostname.replace(/^www\./, ''),
        'VIP_VOICE',
        'VIPBlog',
        rawVal,
        3
      )
    );
  }

  await refreshAllUpstreams();
  res.json({ ok: true, addedId: customId, health: feedHealthMap.get(customId) });
});

function handleSseStream(req: express.Request, res: express.Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(
    `event: connected\ndata: ${JSON.stringify({
      status: 'OMNISCIENCE_LIVE_FIREHOSE_LOCKED',
      ts: Date.now(),
    })}\n\n`
  );
  sseClients.add(res);

  const keepAlive = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15_000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
}

app.get('/api/stream', handleSseStream);
app.get('/api/stream/live', handleSseStream);

app.post('/api/synthesize', async (req, res) => {
  const { engine, ollamaModel, apiKey, clientIndustry, prompt } = req.body as {
    engine?: SynthesisEngineId;
    ollamaModel?: string;
    apiKey?: string;
    clientIndustry?: string;
    prompt?: string;
  };

  if (!prompt) {
    res.status(400).json({ error: 'Missing prompt' });
    return;
  }

  try {
    const result = await runTriEngineTextSynthesis({
      engine: engine || (apiKey ? 'GEMINI' : 'OLLAMA'),
      ollamaModel,
      apiKey,
      clientIndustry,
      prompt,
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.get('/api/visual-preview', async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  if (!targetUrl.startsWith('http')) {
    res.status(400).json({ ok: false, imageUrl: null });
    return;
  }

  const ghOg = resolveGitHubOpenGraphImage(targetUrl);
  if (ghOg) {
    res.json({ ok: true, kind: 'github_opengraph', imageUrl: ghOg });
    return;
  }

  if (targetUrl.includes('arxiv.org/') || targetUrl.includes('huggingface.co/papers/')) {
    const arxivFig = await extractArxivFirstFigureUrl(targetUrl);
    if (arxivFig) {
      res.json({ ok: true, kind: 'arxiv_figure', imageUrl: arxivFig });
      return;
    }
  }

  const enriched = await enrichThinArticle(targetUrl);
  res.json({
    ok: Boolean(enriched?.ogImage),
    kind: enriched?.ogImage ? 'opengraph_meta' : 'none',
    imageUrl: enriched?.ogImage || null,
  });
});

app.get('/api/reddit/comments', async (req, res) => {
  const postId = String(req.query.postId || '').trim();
  const subreddit = String(req.query.subreddit || 'LocalLLaMA').trim();
  if (!postId) {
    res.status(400).json({ ok: false, quotes: [] });
    return;
  }
  const quotes = await fetchTopRedditCommentsByPostId(postId, subreddit);
  res.json({ ok: true, quotes });
});

app.get('/api/synthesize/prewarmed', (_req, res) => {
  res.json({
    ok: true,
    entries: getPrewarmedLiteracyEntries(),
  });
});

app.post('/api/synthesize/literacy', async (req, res) => {
  const { engine, ollamaModel, apiKey, clientIndustry, signal, forceRefresh, priority } =
    req.body as {
      engine?: SynthesisEngineId;
      ollamaModel?: string;
      apiKey?: string;
      clientIndustry?: ClientIndustry;
      signal?: SpatialSignal;
      forceRefresh?: boolean;
      priority?: 'user' | 'background';
    };

  const isBackground = priority === 'background';
  // Immediate AbortController pre-emption so Ollama starts the user's clicked card in <50ms!
  const didPreempt = !isBackground ? abortActivePrewarmForUserClick() : false;

  if (!signal || !signal.title) {
    res.status(400).json({ error: 'Missing signal object' });
    return;
  }

  try {
    const out = await runTriEngineLiteracySpectrum({
      engine: engine || (apiKey ? 'GEMINI' : 'OLLAMA'),
      ollamaModel,
      apiKey,
      clientIndustry,
      signal,
      forceRefresh,
      isBackgroundPrewarm: isBackground,
      preemptedByRoute: didPreempt,
    });
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

app.post('/api/blast-radius', async (req, res) => {
  const { engine, ollamaModel, apiKey, clientIndustry, signalTitle, signalSummary } = req.body as {
    engine?: SynthesisEngineId;
    ollamaModel?: string;
    apiKey?: string;
    clientIndustry?: string;
    signalTitle?: string;
    signalSummary?: string;
  };

  if (!signalTitle) {
    res.status(400).json({ error: 'Missing signalTitle' });
    return;
  }

  const chosenEngine: SynthesisEngineId = engine || (apiKey ? 'GEMINI' : 'DETERMINISTIC');
  if (chosenEngine === 'DETERMINISTIC') {
    res.json({ horizons: null, engineUsed: 'DETERMINISTIC', latencyMs: 1, tokensPerSec: 999 });
    return;
  }

  const jsonPrompt = `Analyze "${signalTitle}" (${signalSummary || ''}) for a ${
    clientIndustry || 'Enterprise'
  } organization. Return ONLY a valid JSON array of 3 objects for 30D (Architecture), 60D (Governance/Security), and 90D (FinOps/Skills), each with keys: horizon ("30D"|"60D"|"90D"), title (<=35 chars), consequence (<=140 chars), consultantAction (<=110 chars), kpiMetric (<=45 chars).`;

  try {
    if (chosenEngine === 'OLLAMA') {
      const out = await runTriEngineTextSynthesis({
        engine: 'OLLAMA',
        ollamaModel,
        clientIndustry,
        prompt: jsonPrompt,
      });
      const arrMatch = out.text.match(/\[[\s\S]*\]/);
      const horizons = arrMatch ? JSON.parse(arrMatch[0]) : null;
      res.json({
        horizons,
        engineUsed: out.engineUsed,
        modelUsed: out.modelUsed,
        tokensPerSec: out.tokensPerSec,
        latencyMs: out.latencyMs,
      });
      return;
    }

    if (!apiKey) {
      res.status(400).json({ error: 'Missing Gemini API key' });
      return;
    }

    const t0 = Date.now();
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(9500),
        body: JSON.stringify({
          contents: [{ parts: [{ text: jsonPrompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 450,
            responseMimeType: 'application/json',
          },
        }),
      }
    );
    if (!resp.ok) {
      const errTxt = await resp.text();
      res.status(resp.status).json({ error: errTxt.slice(0, 200) });
      return;
    }
    const json = (await resp.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const latencyMs = Date.now() - t0;
    const estTokens = Math.max(20, Math.round(rawText.length / 4));
    res.json({
      horizons: JSON.parse(rawText),
      engineUsed: 'GEMINI',
      modelUsed: 'gemini-2.5-flash',
      tokensPerSec: Number((estTokens / Math.max(0.1, latencyMs / 1000)).toFixed(1)),
      latencyMs,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

const distDir = path.resolve(__dirname, '../dist');
app.use(express.static(distDir));
app.get('/{*splat}', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    next();
    return;
  }
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) next();
  });
});

if (!process.env.CORTEX_CLI_IMPORT_ONLY) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[CORTEX // OMNISCIENCE PROXY v3] Listening on http://127.0.0.1:${PORT}`);
  });
}
