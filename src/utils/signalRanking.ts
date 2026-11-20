import { extractSpecificEntityTokens } from '../../shared/supernovaEngine';
import type {
  LiteracyLevel,
  LiteracySpectrumPayload,
  SpatialSignal,
} from '../../shared/types';

export const LENS_SHORT_LABELS: Record<LiteracyLevel, string> = {
  1: 'Analogy',
  2: 'Plain',
  3: 'Builder',
  4: 'R&D',
  5: 'Dev',
};

export function computeSignalMomentumScore(
  sig: SpatialSignal,
  nowMs: number = Date.now()
): number {
  const ups = Math.max(0, sig.engagementVelocity?.likesOrUps ?? 0);
  const velPerHr = Math.max(0, sig.engagementVelocity?.velocityPerHour ?? 0);
  const engBoost = Math.min(
    18,
    Math.log10(ups + 1) * 4.5 + Math.min(6, velPerHr * 0.05)
  );
  const hasValidTs =
    typeof sig.publishedAtMs === 'number' &&
    Number.isFinite(sig.publishedAtMs) &&
    sig.publishedAtMs > 0;
  const ageHrs = hasValidTs ? Math.max(0, (nowMs - sig.publishedAtMs) / 3_600_000) : 9999;
  const recencyBoost =
    ageHrs <= 12
      ? 14
      : ageHrs <= 24
      ? 8
      : ageHrs <= 48
      ? 3
      : ageHrs <= 72
      ? -2
      : -10;
  const supernovaBonus = sig.isSupernova ? 14 : 0;
  const seedPenalty = sig.isDemoSeed ? -18 : 0;
  return sig.mass * 10 + supernovaBonus + engBoost + recencyBoost + seedPenalty;
}

export function isRecentSignal12h(
  sig: SpatialSignal,
  nowMs: number = Date.now()
): boolean {
  if (typeof sig.publishedAtMs !== 'number' || !Number.isFinite(sig.publishedAtMs) || sig.publishedAtMs <= 0) {
    return false;
  }
  const ageMs = nowMs - sig.publishedAtMs;
  return ageMs >= -600_000 && ageMs <= 12 * 3_600_000;
}

export function formatRelativeAgeShort(
  publishedAtMs: number,
  nowMs: number = Date.now()
): string {
  if (typeof publishedAtMs !== 'number' || !Number.isFinite(publishedAtMs) || publishedAtMs <= 0) {
    return '—';
  }
  const diffMin = Math.max(1, Math.round((nowMs - publishedAtMs) / 60_000));
  if (diffMin < 60) return `${diffMin}m`;
  const diffHrs = Math.round(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h`;
  const diffDays = Math.max(1, Math.round(diffHrs / 24));
  return `${diffDays}d`;
}

export interface RelatedSignalLink {
  index: number;
  reason: 'entity' | 'keyword' | 'sector';
  strength: number;
}

const tokenCache = new Map<string, Set<string>>();

function getCachedEntityTokens(sig: SpatialSignal): Set<string> {
  const key = `${sig.id}:${sig.title.length}`;
  let cached = tokenCache.get(key);
  if (!cached) {
    cached = new Set(extractSpecificEntityTokens(sig.title));
    if (tokenCache.size > 600) tokenCache.clear();
    tokenCache.set(key, cached);
  }
  return cached;
}

export function findRelatedSignalIndices(
  signals: SpatialSignal[],
  sourceIdx: number,
  maxLinks = 6
): RelatedSignalLink[] {
  const src = signals[sourceIdx];
  if (!src) return [];

  const srcTokens = getCachedEntityTokens(src);
  const srcStacks = new Set(
    (src.affectedEnterpriseStacks || []).map((s) => s.toLowerCase())
  );
  const causalTargets = new Set(src.causalTargetIds || []);
  const results: Array<RelatedSignalLink & { momentum: number }> = [];
  const nowMs = Date.now();

  for (let i = 0; i < signals.length; i++) {
    if (i === sourceIdx) continue;
    const cand = signals[i];
    if (!cand) continue;

    let reason: RelatedSignalLink['reason'] | null = null;
    let strength = 0;

    if (
      causalTargets.has(cand.id) ||
      cand.causalTargetIds?.includes(src.id) ||
      (src.canonicalEntity && cand.canonicalEntity && src.canonicalEntity === cand.canonicalEntity)
    ) {
      reason = 'entity';
      strength = 1.0;
    } else {
      const candTokens = getCachedEntityTokens(cand);
      let sharedToks = 0;
      for (const tok of srcTokens) {
        if (candTokens.has(tok)) sharedToks++;
      }
      let sharedStacks = 0;
      for (const st of cand.affectedEnterpriseStacks || []) {
        if (srcStacks.has(st.toLowerCase())) sharedStacks++;
      }
      if (sharedToks >= 2 || (sharedToks >= 1 && sharedStacks >= 1) || sharedStacks >= 2) {
        reason = 'keyword';
        strength = 0.82;
      } else if (
        cand.primarySector === src.primarySector ||
        src.secondarySectors.includes(cand.primarySector) ||
        cand.secondarySectors.includes(src.primarySector)
      ) {
        reason = 'sector';
        strength = 0.58;
      }
    }

    if (reason) {
      results.push({
        index: i,
        reason,
        strength,
        momentum: computeSignalMomentumScore(cand, nowMs),
      });
    }
  }

  results.sort((a, b) => b.strength - a.strength || b.momentum - a.momentum);
  return results.slice(0, maxLinks).map(({ index, reason, strength }) => ({
    index,
    reason,
    strength,
  }));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function stripOriginPrefixClean(sig: SpatialSignal): string {
  const origin = sig.originFeedName || '';
  let cleaned = sig.title
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^r\/[A-Za-z0-9_]+:\s*/i, '')
    .replace(/^(?:X\s*[·•-]\s*)?@[A-Za-z0-9_.-]+:\s*/i, '')
    .replace(/^(?:OpenAI News|Google DeepMind|Anthropic News|Meta AI Eng|HF Paper|arXiv)\s*:\s*/i, '')
    .trim();
  if (origin) {
    cleaned = cleaned.replace(new RegExp(`^${escapeRegExp(origin)}\\s*[:—-]\\s*`, 'i'), '').trim();
  }
  return cleaned || sig.title.trim();
}

export function getCleanDisplayHeadline(
  sig: SpatialSignal,
  level: LiteracyLevel
): string {
  if (level <= 2 && sig.literacy?.plainFullTitle) {
    return sig.literacy.plainFullTitle;
  }
  return stripOriginPrefixClean(sig);
}

export function getActiveLensTakeaway(
  _sig: SpatialSignal,
  lit: LiteracySpectrumPayload,
  level: LiteracyLevel
): { label: string; text: string } {
  switch (level) {
    case 1:
      return {
        label: 'L1 · ANALOGY',
        text: `${lit.levels[1].analogy} ${lit.levels[1].everydayWhy}`.trim(),
      };
    case 2:
      return {
        label: 'L2 · PLAIN',
        text: `${lit.levels[2].whatHappened} ${lit.levels[2].problemSolved}`.trim(),
      };
    case 3:
      return {
        label: 'L3 · BUILDER',
        text: lit.levels[3].bridgeSummary,
      };
    case 4:
      return {
        label: 'L4 · R&D & ROI',
        text: `${lit.levels[4].roiAndFinOps} ${lit.levels[4].clientAdvice}`.trim(),
      };
    case 5:
    default:
      return {
        label: 'L5 · DEV SPECS',
        text: `${lit.levels[5].architectureBrief} ${lit.levels[5].specsAndCaveats}`.trim(),
      };
  }
}
