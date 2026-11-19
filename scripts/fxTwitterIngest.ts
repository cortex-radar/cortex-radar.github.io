import { stripHtmlMarkupAndEntities } from '../shared/literacyEngine';
import type { RawUpstreamSignal } from '../shared/seed72h';
import type { MediaAttachment } from '../shared/types';

export const CURATED_X_HANDLES = [
  'OpenAI',
  'OpenAIDevs',
  'AnthropicAI',
  'GoogleDeepMind',
  'karpathy',
  'huggingface',
  'Alibaba_Qwen',
  'MistralAI',
  'xai',
  'ollama',
  'ylecun',
  'demishassabis',
  'DrJimFan',
  'sama',
] as const;

const X_FETCH_UA =
  'Mozilla/5.0 (compatible; CORTEX-Radar/2.0; +https://cortex-radar.github.io/)';
const WINDOW_72H_MS = 72 * 3_600_000;
const CONCURRENCY_LIMIT = 3;
const BATCH_STAGGER_MS = 300;
const PER_REQUEST_TIMEOUT_MS = 8_000;
const MAX_PER_HANDLE = 2;
const MAX_TOTAL_X_SIGNALS = 12;

function unwrapCdata(raw: string): string {
  return (raw || '')
    .trim()
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1')
    .trim();
}

function extractTagText(block: string, tag: string): string {
  const rx = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(rx);
  return m?.[1] ? unwrapCdata(m[1]) : '';
}

function normalizeXUrl(rawUrl: string): {
  canonicalUrl: string;
  linkAuthor: string;
  statusId: string;
} {
  const cleaned = (rawUrl || '').trim();
  try {
    const u = new URL(cleaned);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (
      host === 'fxtwitter.com' ||
      host === 'd.fxtwitter.com' ||
      host === 'fixupx.com' ||
      host === 'vxtwitter.com' ||
      host === 'twitter.com' ||
      host === 'mobile.twitter.com' ||
      host === 'x.com'
    ) {
      u.protocol = 'https:';
      u.hostname = 'x.com';
    }
    u.search = '';
    u.hash = '';
    const canonicalUrl = u.toString().replace(/\/+$/, '');
    const match = canonicalUrl.match(/^https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/i);
    return {
      canonicalUrl,
      linkAuthor: match?.[1] || '',
      statusId: match?.[2] || '',
    };
  } catch {
    const rewritten = cleaned
      .replace(
        /^https?:\/\/(?:www\.)?(?:(?:d\.)?fxtwitter|fixupx|vxtwitter|(?:mobile\.)?twitter)\.com/i,
        'https://x.com'
      )
      .split('?')[0]
      .replace(/\/+$/, '');
    const match = rewritten.match(/https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/i);
    return {
      canonicalUrl: rewritten,
      linkAuthor: match?.[1] || '',
      statusId: match?.[2] || '',
    };
  }
}

function isXInternalHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    return (
      host === 'x.com' ||
      host === 'twitter.com' ||
      host === 't.co' ||
      host.endsWith('.twimg.com') ||
      host.endsWith('fxtwitter.com') ||
      host.endsWith('fixupx.com') ||
      host.endsWith('vxtwitter.com')
    );
  } catch {
    return true;
  }
}

function extractImageMedia(itemXml: string, descHtml: string, handle: string): MediaAttachment[] {
  const seen = new Set<string>();
  const media: MediaAttachment[] = [];

  const enclosureMatches = itemXml.matchAll(/<enclosure\b([^>]+)\/?>/gi);
  for (const m of enclosureMatches) {
    const attrs = m[1] || '';
    const urlMatch = attrs.match(/\burl=["']([^"']+)["']/i);
    const typeMatch = attrs.match(/\btype=["']([^"']+)["']/i);
    const imgUrl = urlMatch?.[1]?.trim() || '';
    const mime = (typeMatch?.[1] || '').toLowerCase();
    if (
      imgUrl &&
      /^https?:\/\//i.test(imgUrl) &&
      (mime.startsWith('image/') || /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(imgUrl)) &&
      !seen.has(imgUrl)
    ) {
      seen.add(imgUrl);
      media.push({
        type: 'image',
        url: imgUrl,
        caption: `X · @${handle} visual attachment`,
        sourceNetwork: 'X',
      });
      return media;
    }
  }

  const imgMatches = descHtml.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi);
  for (const m of imgMatches) {
    const imgUrl = (m[1] || '').trim();
    if (
      imgUrl &&
      /^https?:\/\//i.test(imgUrl) &&
      !/\/profile_images\//i.test(imgUrl) &&
      !seen.has(imgUrl)
    ) {
      seen.add(imgUrl);
      media.push({
        type: 'image',
        url: imgUrl,
        caption: `X · @${handle} visual attachment`,
        sourceNetwork: 'X',
      });
      return media;
    }
  }

  return media;
}

function buildCleanXHeadline(textWithoutUrls: string, externalUrls: string[]): string {
  const normalized = (textWithoutUrls || '')
    .replace(/\u2026+$/g, '')
    .replace(/\.\.\.+$/g, '')
    .replace(/^[•\-–—:\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized && externalUrls.length > 0) {
    try {
      const u = new URL(externalUrls[0]);
      return `Shared resource on ${u.hostname.replace(/^www\./, '')}`;
    } catch {
      return '';
    }
  }

  const lines = normalized
    .split(/\s*\n+\s*|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  let candidate = lines[0] || normalized;
  if (candidate.length < 34 && lines.length > 1) {
    const combined = `${candidate} ${lines[1]}`.trim();
    if (combined.length <= 138) candidate = combined;
  }

  // Strip dangling colon if headline ended abruptly before a removed URL
  candidate = candidate.replace(/[:\-\s]+$/, '').trim();

  if (candidate.length <= 138) return candidate;
  const clipped = candidate.slice(0, 135).replace(/\s+\S*$/, '').replace(/[,:;\-]+$/, '').trim();
  return clipped ? `${clipped}…` : candidate.slice(0, 136);
}

function hashShortId(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

interface RankedXCandidate {
  handle: string;
  handleRank: number;
  qualityScore: number;
  signal: RawUpstreamSignal;
}

async function fetchHandleFeedXml(handle: string): Promise<string | null> {
  const urls = [
    `https://fxtwitter.com/${encodeURIComponent(handle)}/feed.xml?count=10`,
    `https://fxtwitter.com/${encodeURIComponent(handle)}/feed.xml`,
  ];

  let lastReason = 'unknown error';
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': X_FETCH_UA,
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        },
        signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        lastReason = `HTTP ${res.status}`;
        continue;
      }
      const xml = await res.text();
      if (xml.includes('<item>')) {
        return xml;
      }
      lastReason = 'empty RSS payload';
    } catch (err) {
      lastReason = (err as Error)?.message || 'timeout/network error';
    }
  }

  console.warn(`[CORTEX // X-FX] Warn: @${handle} unavailable (${lastReason}); skipping.`);
  return null;
}

function parseHandleXSignals(handle: string, xml: string, nowMs: number): RankedXCandidate[] {
  const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
  const cutoffMs = nowMs - WINDOW_72H_MS;
  const accepted: Array<{ qualityScore: number; signal: RawUpstreamSignal }> = [];
  const seenIds = new Set<string>();

  for (const itemXml of itemMatches) {
    const rawLink = extractTagText(itemXml, 'link') || extractTagText(itemXml, 'guid');
    const rawTitle = extractTagText(itemXml, 'title');
    const rawPubDate = extractTagText(itemXml, 'pubDate');
    const rawDesc = extractTagText(itemXml, 'description');

    const publishedAtMs = Date.parse(rawPubDate);
    if (!Number.isFinite(publishedAtMs) || publishedAtMs < cutoffMs || publishedAtMs > nowMs + 600_000) {
      continue;
    }

    const { canonicalUrl, linkAuthor, statusId } = normalizeXUrl(rawLink);
    if (!canonicalUrl) continue;

    // Exclude reposts/retweets: explicit RT/@Reposted prefix OR status URL owned by a different author
    const rawTitlePlain = stripHtmlMarkupAndEntities(rawTitle);
    if (/^(?:RT\s+@|Reposted\b|Retweeted\b)/i.test(rawTitlePlain)) continue;
    if (linkAuthor && linkAuthor.toLowerCase() !== handle.toLowerCase()) continue;

    // Separate quoted-tweet blockquote from primary post content before extracting headline/body
    const quoteBlocks: string[] = [];
    const primaryDescHtml = (rawDesc || '').replace(
      /<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi,
      (_, inner: string) => {
        const cleanQ = stripHtmlMarkupAndEntities(inner).trim();
        if (cleanQ) quoteBlocks.push(cleanQ);
        return ' ';
      }
    );

    const primaryCleaned = stripHtmlMarkupAndEntities(
      primaryDescHtml.replace(/<br\s*\/?>/gi, '\n')
    );
    const primaryWithNewlines = primaryCleaned
      .replace(/<\/?(?:p|div)[^>]*>/gi, '\n')
      .trim();
    const fallbackTitleClean = rawTitlePlain.replace(/\u2026+$/g, '').trim();
    const rawBody = primaryWithNewlines || fallbackTitleClean;

    // Exclude pure replies starting with '@' or 'Replying to @'
    if (/^(?:@|Replying to\s+@)/i.test(rawBody)) continue;

    const allUrls = rawBody.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
    const externalUrls = allUrls.filter((u) => !isXInternalHost(u));
    const textWithoutUrls = rawBody
      .replace(/https?:\/\/[^\s<>"')\]]+/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Signal-to-noise gate: drop short one-liners without an external URL/paper/repo link
    if (textWithoutUrls.length < 65 && externalUrls.length === 0) continue;

    const cleanTitle = buildCleanXHeadline(textWithoutUrls, externalUrls);
    if (!cleanTitle || cleanTitle.length < 16) continue;

    const sigId = statusId ? `x-fx-${statusId}` : `x-fx-${handle.toLowerCase()}-${hashShortId(canonicalUrl)}`;
    if (seenIds.has(sigId)) continue;
    seenIds.add(sigId);

    const ageHours = Math.max(0.25, (nowMs - publishedAtMs) / 3_600_000);
    const quoteContext = quoteBlocks.length > 0 ? ` Quoted context: ${quoteBlocks[0].slice(0, 320)}` : '';
    const externalContext =
      externalUrls.length > 0 ? ` Reference: ${externalUrls.slice(0, 2).join(' ')}` : '';
    const summary = `${rawBody}${quoteContext}${externalContext}`.trim().slice(0, 1800);

    const mediaItems = extractImageMedia(itemXml, primaryDescHtml, handle);
    const qualityScore =
      (externalUrls.length > 0 ? 50 : 0) +
      Math.min(35, textWithoutUrls.length * 0.12) +
      Math.max(0, 72 - ageHours) * 0.5 +
      (mediaItems.length > 0 ? 12 : 0);

    // Calibrate synthetic rank score inside a healthy range so X complements high-engagement community/lab feeds
    const calibratedScore = Math.round(
      140 + (externalUrls.length > 0 ? 55 : 0) + Math.max(0, 48 - ageHours) * 0.8
    );

    accepted.push({
      qualityScore,
      signal: {
        id: sigId,
        title: cleanTitle,
        summary,
        url: canonicalUrl,
        source: 'XBridge',
        sourceCategory: 'X_BRIDGE',
        originFeedName: `X · @${handle}`,
        publishedAtMs,
        score: calibratedScore,
        mediaItems: mediaItems.length > 0 ? mediaItems : undefined,
      },
    });
  }

  accepted.sort((a, b) => b.qualityScore - a.qualityScore);
  return accepted.slice(0, MAX_PER_HANDLE).map((entry, idx) => ({
    handle,
    handleRank: idx,
    qualityScore: entry.qualityScore,
    signal: entry.signal,
  }));
}

export async function fetchCuratedXSignals(nowMs: number = Date.now()): Promise<RawUpstreamSignal[]> {
  const candidates: RankedXCandidate[] = [];

  for (let i = 0; i < CURATED_X_HANDLES.length; i += CONCURRENCY_LIMIT) {
    const batch = CURATED_X_HANDLES.slice(i, i + CONCURRENCY_LIMIT);
    const results = await Promise.allSettled(
      batch.map(async (handle) => {
        const xml = await fetchHandleFeedXml(handle);
        if (!xml) return [];
        return parseHandleXSignals(handle, xml, nowMs);
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.length > 0) {
        candidates.push(...r.value);
      }
    }

    if (i + CONCURRENCY_LIMIT < CURATED_X_HANDLES.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_STAGGER_MS));
    }
  }

  // Round-robin by per-handle rank (rank 0 across all handles first, then rank 1) weighted by qualityScore
  candidates.sort((a, b) => {
    if (a.handleRank !== b.handleRank) return a.handleRank - b.handleRank;
    return b.qualityScore - a.qualityScore;
  });

  const selected: RawUpstreamSignal[] = [];
  const seenUrls = new Set<string>();
  for (const c of candidates) {
    if (seenUrls.has(c.signal.url)) continue;
    seenUrls.add(c.signal.url);
    selected.push(c.signal);
    if (selected.length >= MAX_TOTAL_X_SIGNALS) break;
  }

  console.log(
    `[CORTEX // X-FX] Collected ${selected.length} filtered 72h X signals from ${
      new Set(selected.map((s) => s.originFeedName)).size
    } handles.`
  );
  return selected;
}
