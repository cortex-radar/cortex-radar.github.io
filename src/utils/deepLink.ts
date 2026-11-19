import type { LiteracyLevel } from '../../shared/types';

export interface ParsedCortexDeepLink {
  signalId: string | null;
  level: LiteracyLevel | null;
}

/**
 * Safely parses canonical ?orb=<id>&lens=<1-5> (and legacy ?signal=<id>&level=<1-5>)
 * from any query string without throwing or mutating state.
 */
export function parseCortexDeepLink(search: string): ParsedCortexDeepLink {
  if (!search) return { signalId: null, level: null };
  try {
    const cleanSearch = search.startsWith('?') ? search.slice(1) : search;
    const params = new URLSearchParams(cleanSearch);
    const rawSig = (params.get('orb') || params.get('signal') || '').trim();
    const rawLvlStr = params.get('lens') ?? params.get('level');
    const rawLvl = rawLvlStr !== null ? Number(rawLvlStr) : NaN;
    const validLevel: LiteracyLevel | null =
      Number.isInteger(rawLvl) && rawLvl >= 1 && rawLvl <= 5
        ? (rawLvl as LiteracyLevel)
        : null;
    return {
      signalId: rawSig.length > 0 ? rawSig.slice(0, 140) : null,
      level: validLevel,
    };
  } catch {
    return { signalId: null, level: null };
  }
}

export function buildCortexDeepLinkUrl(
  signalId: string,
  level: LiteracyLevel,
  baseHref?: string
): string {
  try {
    const base =
      baseHref || (typeof window !== 'undefined' ? window.location.href : 'http://localhost:5173/');
    const url = new URL(base);
    url.searchParams.delete('signal');
    url.searchParams.delete('level');
    url.searchParams.set('orb', signalId);
    url.searchParams.set('lens', String(level));
    return url.toString();
  } catch {
    return `?orb=${encodeURIComponent(signalId)}&lens=${level}`;
  }
}

export function matchSignalByDeepLinkParam(
  signals: Array<{ id: string }>,
  targetId: string
): number {
  if (!targetId) return -1;
  const exactIdx = signals.findIndex((s) => s.id === targetId);
  if (exactIdx >= 0) return exactIdx;
  const lower = targetId.toLowerCase();
  return signals.findIndex(
    (s) => s.id.toLowerCase() === lower || s.id.toLowerCase().includes(lower)
  );
}
