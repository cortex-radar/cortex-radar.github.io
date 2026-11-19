import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Prevent server/index.ts from binding port 3001 or starting daemon intervals during CLI bake
process.env.CORTEX_CLI_IMPORT_ONLY = '1';

import {
  buildDeterministicLiteracyPayload,
  enforceZeroJargonL1,
  isSubstantiveVividMetaphor,
  sanitizeLiteracyPayloadPlainLevels,
  simplifyPlainEnglishL2,
  stripHtmlMarkupAndEntities,
  stripTrailingIncompleteClause,
} from '../shared/literacyEngine';
import { fetchCuratedXSignals } from './fxTwitterIngest';
import {
  buildInitial72hSeed,
  type RawUpstreamSignal,
  synthesizeRawItemToSpatialSignal,
} from '../shared/seed72h';
import {
  computeDivergenceMetrics,
  shouldClusterIntoSupernova,
} from '../shared/supernovaEngine';
import {
  SECTOR_BY_ID,
  type GlossaryTerm,
  type LiteracySpectrumPayload,
  type SpatialSignal,
  type StaticGalaxySnapshot,
} from '../shared/types';
import {
  computeSignalMomentumScore,
  getCleanDisplayHeadline,
} from '../src/utils/signalRanking';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_PATH = path.resolve(__dirname, '../public/data/live-galaxy.json');
const RSS_OUTPUT_PATH = path.resolve(__dirname, '../public/rss.xml');
const SITE_BASE_URL = 'https://cortex-radar.github.io/';

function escapeXml(input: string): string {
  return (input || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateRssXml(signals: SpatialSignal[], bakedAtMs: number): string {
  const nonSeed = signals.filter((s) => !s.isDemoSeed && s.sourceCategory !== 'DEMO_SEED');
  const pool = nonSeed.length > 0 ? nonSeed : signals;
  const top25 = [...pool]
    .sort((a, b) => computeSignalMomentumScore(b, bakedAtMs) - computeSignalMomentumScore(a, bakedAtMs))
    .slice(0, 25);

  const itemsXml = top25
    .map((sig) => {
      const headline = stripHtmlMarkupAndEntities(getCleanDisplayHeadline(sig, 2));
      const deepLink = `${SITE_BASE_URL}?orb=${encodeURIComponent(sig.id)}&lens=2`;
      const lit = sanitizeLiteracyPayloadPlainLevels(
        sig.literacy || buildDeterministicLiteracyPayload(sig, 'BANKING')
      );
      const l2Text = stripHtmlMarkupAndEntities(
        [lit.levels[2]?.whatHappened, lit.levels[2]?.problemSolved]
          .filter(Boolean)
          .join(' ')
          .trim()
      );
      const sourceLabel = sig.originFeedName || sig.source || 'CORTEX Radar';
      const sectorName = SECTOR_BY_ID[sig.primarySector]?.name || sig.primarySector;
      const desc = `${l2Text || headline}${sig.url ? ` — Upstream (${sourceLabel}): ${sig.url}` : ''}`;
      const pubDate = new Date(sig.publishedAtMs || bakedAtMs).toUTCString();

      return [
        '    <item>',
        `      <title>${escapeXml(headline)}</title>`,
        `      <link>${escapeXml(deepLink)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(deepLink)}</guid>`,
        `      <pubDate>${escapeXml(pubDate)}</pubDate>`,
        `      <category>${escapeXml(sectorName)}</category>`,
        `      <description>${escapeXml(desc)}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  const lastBuildDate = new Date(bakedAtMs).toUTCString();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>CORTEX // Spatial AI Intelligence Radar</title>',
    `    <link>${SITE_BASE_URL}</link>`,
    `    <atom:link href="${SITE_BASE_URL}rss.xml" rel="self" type="application/rss+xml" />`,
    '    <description>Top 25 momentum-ranked AI breakthroughs synthesized across Analogy, Plain, Builder, R&amp;D, and Dev lenses every 3 hours.</description>',
    '    <language>en-us</language>',
    `    <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>`,
    '    <ttl>180</ttl>',
    itemsXml,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

const GITHUB_MODELS_ENDPOINT = 'https://models.inference.ai.azure.com/chat/completions';
const GITHUB_MODELS_MODEL = process.env.GITHUB_MODELS_MODEL || 'gpt-4o-mini';

function normalizeBakeUrl(url: string): string {
  return (url || '').trim().toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '');
}

const LEGACY_CLONED_PLAIN_TITLES = new Set([
  'claude coding update speeds up multi-file software building and bug fixes',
  'new connector lets ai assistants read and update standard software cleanly',
  'ollama update lets powerful private ai run smoothly on standard laptop graphics',
  'server upgrade lets ai handle long conversations faster at a fraction of the cost',
  'security update locks down how ai assistants connect to workplace apps',
]);

function repairLegacyClonedTitles(
  lit: LiteracySpectrumPayload,
  fallbackSignalTitle?: string
): LiteracySpectrumPayload {
  const clean = sanitizeLiteracyPayloadPlainLevels(lit);
  const fullKey = (clean.plainFullTitle || '').trim().toLowerCase();
  if (!LEGACY_CLONED_PLAIN_TITLES.has(fullKey) || !fallbackSignalTitle) {
    return clean;
  }
  const uniqueHeadline = enforceZeroJargonL1(stripHtmlMarkupAndEntities(fallbackSignalTitle));
  const nextShort =
    uniqueHeadline.length <= 44
      ? uniqueHeadline
      : `${uniqueHeadline.slice(0, 41).replace(/\s+\S*$/, '')}…`;
  const nextFull =
    uniqueHeadline.length <= 96
      ? uniqueHeadline
      : `${uniqueHeadline.slice(0, 93).replace(/\s+\S*$/, '')}…`;
  return {
    ...clean,
    plainTitle: nextShort || clean.plainTitle,
    plainFullTitle: nextFull || clean.plainFullTitle,
  };
}

function loadPreviousSnapshotCache(): {
  byId: Map<string, LiteracySpectrumPayload>;
  byUrl: Map<string, LiteracySpectrumPayload>;
  previousSignals: SpatialSignal[];
} {
  const byId = new Map<string, LiteracySpectrumPayload>();
  const byUrl = new Map<string, LiteracySpectrumPayload>();
  let previousSignals: SpatialSignal[] = [];

  try {
    if (!fs.existsSync(OUTPUT_PATH)) {
      return { byId, byUrl, previousSignals };
    }
    const raw = fs.readFileSync(OUTPUT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StaticGalaxySnapshot>;
    const titleById = new Map<string, string>();
    if (Array.isArray(parsed.signals)) {
      previousSignals = parsed.signals;
      for (const s of parsed.signals) {
        if (s?.id && s.title) titleById.set(s.id, s.title);
        if (s?.id && s.literacy && s.literacy.generatedBy !== 'DETERMINISTIC') {
          const clean = repairLegacyClonedTitles(s.literacy, s.title);
          byId.set(s.id, clean);
          if (s.url) byUrl.set(normalizeBakeUrl(s.url), clean);
        }
      }
    }
    if (parsed.literacyBySignalId && typeof parsed.literacyBySignalId === 'object') {
      for (const [id, lit] of Object.entries(parsed.literacyBySignalId)) {
        if (lit && lit.generatedBy !== 'DETERMINISTIC' && !byId.has(id)) {
          byId.set(id, repairLegacyClonedTitles(lit, titleById.get(id)));
        }
      }
    }
  } catch {
    // Ignore corrupt or missing prior snapshot
  }

  return { byId, byUrl, previousSignals };
}

function safeParseJsonObject(raw: string): Partial<LiteracySpectrumPayload> | null {
  try {
    return JSON.parse(raw) as Partial<LiteracySpectrumPayload>;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as Partial<LiteracySpectrumPayload>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function buildBakePrompt(sig: SpatialSignal, baseFallback: LiteracySpectrumPayload): string {
  const realQuotes = (sig.streetQuotes || [])
    .filter((q) => !q.id.endsWith('-self-quote') && q.author !== sig.originFeedName)
    .slice(0, 3);
  const quotesBlock = realQuotes
    .map((q) => `[${q.originLabel} · ${q.author}, +${q.score}] "${q.text}"`)
    .join('\n- ');
  const glossaryHint = baseFallback.glossary
    .slice(0, 3)
    .map((g) => g.term)
    .join(', ');
  const bodyContext = stripTrailingIncompleteClause((sig.rawAbstract || sig.title).slice(0, 2800));

  return `You are a Principal AI Technical Writer & Architecture Strategist translating this verified signal into a rich, insightful 5-level literacy JSON object for an enterprise engineering & executive audience.

Origin Source: ${sig.originFeedName || sig.source} (${sig.url})
Headline: "${sig.title}"
Post Body / Technical Content:
"""
${bodyContext}
"""
${quotesBlock ? `Real Community Engineer Replies:\n- ${quotesBlock}\n` : ''}Required Level 3 Glossary Terms (mention verbatim in Level 3 bridgeSummary): ${glossaryHint}

STRICT RULES:
1. LEVEL 1 MUST BE A TRUE VIVID PHYSICAL METAPHOR (2-3 full sentences, 35-65 words): Start levels["1"].analogy with "Think of it like..." or "Imagine..." comparing the mechanism to an everyday physical system (kitchen prep line, library desk, post office sorting room, hospital chart clipboard, or highway lane). Zero technical acronyms in Level 1.
2. LEVEL 2 MUST BE PLAIN ENGLISH (zero Markdown pipe tables, zero code blocks, concrete facts).
3. LEVEL 5 MUST BE CONCRETE & DENSE (2-3 substantive technical sentences per block citing exact architecture, benchmarks, failure modes, and community consensus).

Return ONLY valid JSON:
{
  "plainTitle": "Humanized outcome badge <=42 chars",
  "plainFullTitle": "Plain-English headline <=88 chars",
  "levels": {
    "1": { "analogy": "...", "everydayWhy": "..." },
    "2": { "whatHappened": "...", "whoBuiltIt": "...", "problemSolved": "..." },
    "3": { "bridgeSummary": "... explicitly mentioning ${glossaryHint} ..." },
    "4": { "roiAndFinOps": "...", "readinessAndRisk": "...", "clientAdvice": "..." },
    "5": { "architectureBrief": "...", "specsAndCaveats": "...", "streetConsensus": "..." }
  }
}`;
}

function mergeParsedWithFallback(
  parsed: Partial<LiteracySpectrumPayload>,
  baseFallback: LiteracySpectrumPayload,
  generatedBy: 'OLLAMA' | 'GEMINI'
): LiteracySpectrumPayload {
  const rawL1 = parsed.levels?.[1];
  const candidateAnalogy = rawL1?.analogy ? enforceZeroJargonL1(rawL1.analogy) : '';
  const finalAnalogy = isSubstantiveVividMetaphor(candidateAnalogy)
    ? candidateAnalogy
    : baseFallback.levels[1].analogy;

  const cleanGlossary: GlossaryTerm[] =
    Array.isArray(parsed.glossary) && parsed.glossary.length >= 2
      ? parsed.glossary
          .filter((g) => g && typeof g.term === 'string' && typeof g.definition === 'string')
          .slice(0, 5)
      : baseFallback.glossary;

  return sanitizeLiteracyPayloadPlainLevels({
    plainTitle: parsed.plainTitle
      ? enforceZeroJargonL1(parsed.plainTitle).slice(0, 48)
      : baseFallback.plainTitle,
    plainFullTitle: parsed.plainFullTitle
      ? enforceZeroJargonL1(parsed.plainFullTitle).slice(0, 98)
      : baseFallback.plainFullTitle,
    levels: {
      1: {
        analogy: finalAnalogy,
        everydayWhy: rawL1?.everydayWhy
          ? enforceZeroJargonL1(rawL1.everydayWhy)
          : baseFallback.levels[1].everydayWhy,
      },
      2: {
        whatHappened: parsed.levels?.[2]?.whatHappened
          ? simplifyPlainEnglishL2(parsed.levels[2].whatHappened)
          : baseFallback.levels[2].whatHappened,
        whoBuiltIt: parsed.levels?.[2]?.whoBuiltIt
          ? simplifyPlainEnglishL2(parsed.levels[2].whoBuiltIt)
          : baseFallback.levels[2].whoBuiltIt,
        problemSolved: parsed.levels?.[2]?.problemSolved
          ? simplifyPlainEnglishL2(parsed.levels[2].problemSolved)
          : baseFallback.levels[2].problemSolved,
      },
      3: {
        bridgeSummary:
          parsed.levels?.[3]?.bridgeSummary?.trim() || baseFallback.levels[3].bridgeSummary,
      },
      4: {
        roiAndFinOps:
          parsed.levels?.[4]?.roiAndFinOps?.trim() || baseFallback.levels[4].roiAndFinOps,
        readinessAndRisk:
          parsed.levels?.[4]?.readinessAndRisk?.trim() || baseFallback.levels[4].readinessAndRisk,
        clientAdvice:
          parsed.levels?.[4]?.clientAdvice?.trim() || baseFallback.levels[4].clientAdvice,
      },
      5: {
        architectureBrief:
          parsed.levels?.[5]?.architectureBrief?.trim() ||
          baseFallback.levels[5].architectureBrief,
        specsAndCaveats:
          parsed.levels?.[5]?.specsAndCaveats?.trim() || baseFallback.levels[5].specsAndCaveats,
        streetConsensus:
          parsed.levels?.[5]?.streetConsensus?.trim() || baseFallback.levels[5].streetConsensus,
      },
    },
    glossary: cleanGlossary,
    generatedBy,
  });
}

async function synthesizeViaGemini(
  sig: SpatialSignal,
  baseFallback: LiteracySpectrumPayload,
  apiKey: string
): Promise<LiteracySpectrumPayload | null> {
  const prompt = buildBakePrompt(sig, baseFallback);
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
      apiKey
    )}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(14_000),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 950,
          responseMimeType: 'application/json',
        },
      }),
    }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parsed = safeParseJsonObject(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
  return parsed ? mergeParsedWithFallback(parsed, baseFallback, 'GEMINI') : null;
}

async function synthesizeViaGitHubModels(
  sig: SpatialSignal,
  baseFallback: LiteracySpectrumPayload,
  githubToken: string
): Promise<LiteracySpectrumPayload | null> {
  const prompt = buildBakePrompt(sig, baseFallback);
  const res = await fetch(GITHUB_MODELS_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${githubToken}`,
    },
    signal: AbortSignal.timeout(16_000),
    body: JSON.stringify({
      model: GITHUB_MODELS_MODEL,
      temperature: 0.25,
      max_tokens: 950,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You output strictly valid JSON matching the requested 5-level AI literacy schema.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const parsed = safeParseJsonObject(data.choices?.[0]?.message?.content || '');
  return parsed ? mergeParsedWithFallback(parsed, baseFallback, 'GEMINI') : null;
}

const HEADLINE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'your', 'our', 'new', 'how',
  'why', 'what', 'now', 'just', 'are', 'you', 'can', 'using', 'via', 'all', 'its', 'more',
]);

function normalizeHeadlineKey(raw: string): string {
  return stripHtmlMarkupAndEntities(raw || '')
    .toLowerCase()
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/^(?:show hn|ask hn|launch hn)\s*[:—-]\s*/i, '')
    .replace(/^r\/[a-z0-9_]+\s*[:—-]\s*/i, '')
    .replace(/^(?:x\s*[·•-]\s*)?@[a-z0-9_.-]+\s*[:—-]?\s*/i, '')
    .replace(/[\u2026.]+$/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function areNearDuplicateHeadlines(a: string, b: string): boolean {
  const ka = normalizeHeadlineKey(a);
  const kb = normalizeHeadlineKey(b);
  if (!ka || !kb) return false;
  if (ka === kb && ka.length >= 16) return true;
  if (
    Math.min(ka.length, kb.length) >= 28 &&
    (ka.startsWith(kb.slice(0, 28)) || kb.startsWith(ka.slice(0, 28)))
  ) {
    return true;
  }
  const ta = new Set(ka.split(' ').filter((w) => w.length >= 3 && !HEADLINE_STOPWORDS.has(w)));
  const tb = new Set(kb.split(' ').filter((w) => w.length >= 3 && !HEADLINE_STOPWORDS.has(w)));
  if (ta.size < 4 || tb.size < 4) return false;
  let intersect = 0;
  for (const t of ta) {
    if (tb.has(t)) intersect++;
  }
  const union = ta.size + tb.size - intersect;
  return union > 0 && intersect / union >= 0.72;
}

function mergeSignalClusterTarget(
  clusterTarget: SpatialSignal,
  synthesized: SpatialSignal
): void {
  const provSet = new Set([
    ...clusterTarget.sourceProvenance,
    ...synthesized.sourceProvenance,
  ]);
  clusterTarget.sourceProvenance = Array.from(provSet);
  const netSet = new Set([
    ...(clusterTarget.networkFamilies || []),
    ...(synthesized.networkFamilies || []),
  ]);
  clusterTarget.networkFamilies = Array.from(netSet);
  if (clusterTarget.networkFamilies.length >= 2) {
    clusterTarget.isSupernova = true;
    clusterTarget.supernovaLevel = clusterTarget.networkFamilies.length >= 3 ? 2 : 1;
    clusterTarget.mass = Math.min(
      5.2,
      Math.max(clusterTarget.mass, synthesized.mass, 4.1 + clusterTarget.networkFamilies.length * 0.35)
    );
  } else {
    clusterTarget.mass = Math.max(clusterTarget.mass, synthesized.mass);
  }
  if ((synthesized.rawAbstract || '').length > (clusterTarget.rawAbstract || '').length + 80) {
    clusterTarget.rawAbstract = synthesized.rawAbstract;
  }
  if (
    (!clusterTarget.mediaItems || clusterTarget.mediaItems.length === 0) &&
    synthesized.mediaItems &&
    synthesized.mediaItems.length > 0
  ) {
    clusterTarget.mediaItems = synthesized.mediaItems.slice(0, 1);
  }
  const seenQuoteKeys = new Set(
    (clusterTarget.streetQuotes || []).map((q) => `${q.originLabel}:${q.text.slice(0, 60)}`)
  );
  const mergedQuotes = [...(clusterTarget.streetQuotes || [])];
  for (const q of synthesized.streetQuotes || []) {
    const k = `${q.originLabel}:${q.text.slice(0, 60)}`;
    if (!seenQuoteKeys.has(k)) {
      seenQuoteKeys.add(k);
      mergedQuotes.push(q);
    }
  }
  clusterTarget.streetQuotes = mergedQuotes.slice(0, 6);
  clusterTarget.divergence = computeDivergenceMetrics(
    clusterTarget.streetQuotes,
    clusterTarget.title,
    clusterTarget.rawAbstract,
    clusterTarget.engagementVelocity
  );
  clusterTarget.literacy = sanitizeLiteracyPayloadPlainLevels(
    buildDeterministicLiteracyPayload(clusterTarget, 'BANKING')
  );
}

function clusterAndBuildSpatialSignals(rawItems: RawUpstreamSignal[]): SpatialSignal[] {
  const signals: SpatialSignal[] = [];
  const urlMap = new Map<string, SpatialSignal>();

  for (const raw of rawItems) {
    if (!raw?.title || !raw?.url) continue;
    const normUrl = normalizeBakeUrl(raw.url);
    const synthesized = synthesizeRawItemToSpatialSignal(raw, true);

    const exactUrlHit = urlMap.get(normUrl);
    if (exactUrlHit) {
      mergeSignalClusterTarget(exactUrlHit, synthesized);
      continue;
    }

    const dupOrClusterTarget = signals.find(
      (existing) =>
        areNearDuplicateHeadlines(existing.title, synthesized.title) ||
        shouldClusterIntoSupernova(existing, synthesized)
    );
    if (dupOrClusterTarget) {
      mergeSignalClusterTarget(dupOrClusterTarget, synthesized);
      urlMap.set(normUrl, dupOrClusterTarget);
      continue;
    }

    urlMap.set(normUrl, synthesized);
    signals.push(synthesized);
  }

  return signals.sort(
    (a, b) => (b.isSupernova ? 10 : 0) + b.mass - ((a.isSupernova ? 10 : 0) + a.mass)
  );
}

function selectBalancedSnapshotSignals(
  sortedSignals: SpatialSignal[],
  maxTotal: number = 64,
  maxXCount: number = 12
): SpatialSignal[] {
  const xSignals = sortedSignals.filter((s) => s.source === 'XBridge').slice(0, maxXCount);
  const pickedIds = new Set(xSignals.map((s) => s.id));
  const nonXSlots = Math.max(0, maxTotal - xSignals.length);
  const nonXSignals = sortedSignals.filter((s) => !pickedIds.has(s.id) && s.source !== 'XBridge').slice(0, nonXSlots);
  return [...xSignals, ...nonXSignals].sort(
    (a, b) => (b.isSupernova ? 10 : 0) + b.mass - ((a.isSupernova ? 10 : 0) + a.mass)
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isRssOnly = args.includes('--rss-only');
  const isDryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const maxSynthCount = limitArg ? Math.max(1, Number(limitArg.split('=')[1]) || 12) : 16;

  if (isRssOnly) {
    if (!fs.existsSync(OUTPUT_PATH)) {
      throw new Error(`Cannot run --rss-only: missing snapshot at ${OUTPUT_PATH}`);
    }
    const raw = fs.readFileSync(OUTPUT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StaticGalaxySnapshot;
    const nowMs = parsed.bakedAtMs || Date.now();
    const rssXml = generateRssXml(parsed.signals || [], nowMs);
    fs.mkdirSync(path.dirname(RSS_OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(RSS_OUTPUT_PATH, rssXml, 'utf8');
    const itemCount = (rssXml.match(/<item>/g) || []).length;
    console.log(
      `[CORTEX // RSS] Generated ${itemCount} RSS items to ${RSS_OUTPUT_PATH} (${(
        Buffer.byteLength(rssXml, 'utf8') / 1024
      ).toFixed(1)} KB) without modifying live-galaxy.json.`
    );
    process.exit(0);
  }

  const t0 = Date.now();
  const { byId: cachedById, byUrl: cachedByUrl, previousSignals } = loadPreviousSnapshotCache();
  console.log(
    `[CORTEX // BAKE] Starting static galaxy bake (dryRun=${isDryRun}, cached=${cachedById.size} nodes)...`
  );

  const { collectAllUpstreamSignalsOnce } = await import('../server/index');
  const {
    fetchTopRedditCommentsByPostId,
    pollDeepRedditStreetEngine,
    probeOllamaStatus,
    runTriEngineLiteracySpectrum,
  } = await import('../server/undergroundAdapters');

  let rawCollected: RawUpstreamSignal[] = [];
  try {
    const [coreFeeds, redditStreet, xSignals] = await Promise.allSettled([
      collectAllUpstreamSignalsOnce(),
      pollDeepRedditStreetEngine(),
      fetchCuratedXSignals(Date.now()),
    ]);
    if (xSignals.status === 'fulfilled') rawCollected.push(...xSignals.value);
    if (redditStreet.status === 'fulfilled') rawCollected.push(...redditStreet.value);
    if (coreFeeds.status === 'fulfilled') {
      const nonLegacyXCore = coreFeeds.value.filter(
        (item) =>
          !item.id.startsWith('x-rss-bridge-') &&
          item.source !== 'XBridge' &&
          !/nitter\./i.test(item.url || '')
      );
      rawCollected.push(...nonLegacyXCore);
    }
  } catch {
    // Offline / sandboxed environment fallback handled below
  }

  let signals = selectBalancedSnapshotSignals(
    clusterAndBuildSpatialSignals(rawCollected),
    64,
    12
  );
  if (signals.length === 0) {
    if (previousSignals.length > 0) {
      console.log(
        `[CORTEX // BAKE] Network unreachable; reusing ${previousSignals.length} cached signals.`
      );
      signals = previousSignals;
    } else {
      console.log('[CORTEX // BAKE] Network unreachable; hydrating deterministic 72h baseline.');
      signals = buildInitial72hSeed(Date.now()).map((s) => ({ ...s, isDemoSeed: false }));
    }
  }

  // Hydrate missing Reddit .rss engineer comments on top Reddit threads when online
  if (!isDryRun) {
    const redditMissingQuotes = signals
      .filter(
        (s) =>
          (s.source === 'Reddit' || s.url.includes('reddit.com/')) &&
          (!s.streetQuotes || s.streetQuotes.length === 0)
      )
      .slice(0, 8);
    await Promise.allSettled(
      redditMissingQuotes.map(async (sig) => {
        const postId =
          sig.url.match(/\/comments\/([a-z0-9]{5,10})/i)?.[1] ||
          sig.id.replace(/^rd-street-/, '');
        const sub =
          sig.url.match(/\/r\/([^/]+)/i)?.[1] ||
          (sig.originFeedName || 'LocalLLaMA').replace(/^r\//i, '');
        if (!postId) return;
        const quotes = await fetchTopRedditCommentsByPostId(postId, sub);
        if (quotes.length > 0) sig.streetQuotes = quotes;
      })
    );
  }

  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const githubToken = (process.env.GITHUB_TOKEN || '').trim();
  const ollama = !isDryRun && !geminiKey && !githubToken ? await probeOllamaStatus() : null;

  const synthProviderLabel = isDryRun
    ? 'DRY_RUN_DETERMINISTIC_AND_CACHE'
    : geminiKey
    ? 'GEMINI_2_5_FLASH'
    : githubToken
    ? `GITHUB_MODELS_${GITHUB_MODELS_MODEL.toUpperCase()}`
    : ollama?.online
    ? `LOCAL_OLLAMA_${ollama.selectedModel || 'QWEN'}`
    : 'DETERMINISTIC_RULES';

  const literacyBySignalId: Record<string, LiteracySpectrumPayload> = {};
  let cacheHits = 0;
  let newlySynthesized = 0;

  for (const sig of signals) {
    const normUrl = normalizeBakeUrl(sig.url);
    const cachedHit = cachedById.get(sig.id) || cachedByUrl.get(normUrl);
    if (cachedHit) {
      sig.literacy = cachedHit;
      literacyBySignalId[sig.id] = cachedHit;
      cacheHits++;
      continue;
    }

    const baseDet = sanitizeLiteracyPayloadPlainLevels(
      buildDeterministicLiteracyPayload(sig, 'BANKING')
    );

    if (!isDryRun && newlySynthesized < maxSynthCount) {
      let upgraded: LiteracySpectrumPayload | null = null;
      try {
        if (geminiKey) {
          upgraded = await synthesizeViaGemini(sig, baseDet, geminiKey);
        } else if (githubToken) {
          upgraded = await synthesizeViaGitHubModels(sig, baseDet, githubToken);
        } else if (ollama?.online && ollama.selectedModel) {
          const res = await runTriEngineLiteracySpectrum({
            engine: 'OLLAMA',
            ollamaModel: ollama.selectedModel,
            clientIndustry: 'BANKING',
            signal: sig,
          });
          if (res.literacy && res.literacy.generatedBy !== 'DETERMINISTIC') {
            upgraded = sanitizeLiteracyPayloadPlainLevels(res.literacy);
          }
        }
      } catch {
        upgraded = null;
      }

      if (upgraded) {
        sig.literacy = upgraded;
        literacyBySignalId[sig.id] = upgraded;
        newlySynthesized++;
        continue;
      }
    }

    sig.literacy = baseDet;
    literacyBySignalId[sig.id] = baseDet;
  }

  // Final post-synthesis deduplication & unique plainFullTitle enforcement
  const dedupedFinal: SpatialSignal[] = [];
  const seenTitleKeys = new Set<string>();
  const seenPlainKeys = new Set<string>();
  for (const sig of signals) {
    const titleKey = normalizeHeadlineKey(sig.title);
    if (titleKey && seenTitleKeys.has(titleKey)) continue;
    if (titleKey) seenTitleKeys.add(titleKey);

    if (sig.literacy) {
      let cleanLit = repairLegacyClonedTitles(sig.literacy, sig.title);
      const plainKey = normalizeHeadlineKey(cleanLit.plainFullTitle || sig.title);
      if (plainKey && seenPlainKeys.has(plainKey)) {
        const fallbackHeadline = enforceZeroJargonL1(stripHtmlMarkupAndEntities(sig.title));
        cleanLit = {
          ...cleanLit,
          plainTitle:
            fallbackHeadline.length <= 44
              ? fallbackHeadline
              : `${fallbackHeadline.slice(0, 41).replace(/\s+\S*$/, '')}…`,
          plainFullTitle:
            fallbackHeadline.length <= 96
              ? fallbackHeadline
              : `${fallbackHeadline.slice(0, 93).replace(/\s+\S*$/, '')}…`,
        };
      }
      seenPlainKeys.add(normalizeHeadlineKey(cleanLit.plainFullTitle || sig.title));
      sig.literacy = cleanLit;
      literacyBySignalId[sig.id] = cleanLit;
    }
    dedupedFinal.push(sig);
  }
  signals = dedupedFinal;

  const nowMs = Date.now();
  const snapshot: StaticGalaxySnapshot = {
    version: 1,
    bakedAtIso: new Date(nowMs).toISOString(),
    bakedAtMs: nowMs,
    synthesizedBy: synthProviderLabel,
    signalCount: signals.length,
    signals,
    literacyBySignalId,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');

  const rssXml = generateRssXml(signals, nowMs);
  fs.mkdirSync(path.dirname(RSS_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(RSS_OUTPUT_PATH, rssXml, 'utf8');

  const xCount = signals.filter((s) => s.source === 'XBridge').length;
  const sizeKb = (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') / 1024).toFixed(1);
  console.log(
    `[CORTEX // BAKE] Wrote ${signals.length} signals (${xCount} from X · ${sizeKb} KB) to ${OUTPUT_PATH} + RSS (${(
      rssXml.match(/<item>/g) || []
    ).length} items) in ${((Date.now() - t0) / 1000).toFixed(
      1
    )}s [cacheHits=${cacheHits}, newLLM=${newlySynthesized}, provider=${synthProviderLabel}].`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error('[CORTEX // BAKE FAILED]', err);
  process.exit(1);
});
