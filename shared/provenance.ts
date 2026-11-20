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
  const grouped = getGroupedSourcesForSignal(sig);
  return Math.max(
    grouped.length,
    sig.sourceProvenance?.length || 1,
    sig.networkFamilies?.length || 1
  );
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

export function matchesSignalSearchQuery(sig: SpatialSignal, rawQuery: string): boolean {
  const q = (rawQuery || '').trim().toLowerCase();
  if (!q) return true;

  const secName = SECTOR_BY_ID[sig.primarySector]?.name || '';
  const supText = (sig.supportingSources || [])
    .map((s) => `${s.source} ${s.title}`)
    .join(' ');
  const haystack = [
    sig.title,
    sig.literacy?.plainFullTitle || '',
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
