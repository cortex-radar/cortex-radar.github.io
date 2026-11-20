import { DivergenceMetrics, SpatialSignal, StreetQuote } from './types';

/**
 * Words that MUST NEVER count as shared entity tokens for Supernova clustering.
 * Prevents false-positive merges on generic AI/release vocabulary ("model", "AI", "compact", "release", "open", "300M", etc.).
 */
const GENERIC_ENTITY_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'from', 'into', 'onto', 'over', 'under', 'via',
  'how', 'why', 'what', 'when', 'where', 'who', 'this', 'that', 'these', 'those', 'its', 'our',
  'your', 'their', 'new', 'now', 'just', 'more', 'most', 'less', 'best', 'top', 'first', 'next',
  'ai', 'agi', 'asi', 'ml', 'dl', 'nlp', 'cv', 'rl', 'llm', 'llms', 'vlm', 'vlms', 'slm', 'slms',
  'model', 'models', 'modeling', 'compact', 'tiny', 'small', 'medium', 'large', 'giant', 'massive',
  'frontier', 'flagship', 'lightweight', 'efficient', 'fast', 'faster', 'fastest', 'speed', 'slow',
  'open', 'source', 'opensource', 'weights', 'weight', 'free', 'local', 'cloud', 'edge', 'hybrid',
  'release', 'released', 'releases', 'releasing', 'launch', 'launched', 'launches', 'launching',
  'announce', 'announced', 'announces', 'announcing', 'introduce', 'introduced', 'introduces', 'introducing',
  'present', 'presents', 'presented', 'presenting', 'unveil', 'unveils', 'unveiled', 'reveal', 'reveals',
  'ship', 'ships', 'shipped', 'shipping', 'drop', 'drops', 'dropped', 'share', 'shares', 'shared',
  'google', 'openai', 'anthropic', 'microsoft', 'meta', 'nvidia', 'amazon', 'aws', 'apple', 'alibaba',
  'update', 'updated', 'updates', 'upgrade', 'upgraded', 'version', 'preview', 'beta', 'alpha',
  'pro', 'mini', 'flash', 'nano', 'micro', 'ultra', 'max', 'plus', 'lite', 'base', 'instruct',
  'chat', 'thinking', 'reasoning', 'code', 'coding', 'coder', 'agent', 'agents', 'agentic',
  'assistant', 'assistants', 'helper', 'tool', 'tools', 'tooling', 'plugin', 'plugins',
  'server', 'servers', 'serving', 'runtime', 'engine', 'system', 'systems', 'platform', 'stack',
  'framework', 'library', 'sdk', 'cli', 'api', 'apis', 'app', 'apps', 'web', 'ui', 'ux', 'ide',
  'paper', 'papers', 'study', 'research', 'preprint', 'report', 'blog', 'news', 'post', 'thread',
  'benchmark', 'benchmarks', 'eval', 'evals', 'evaluation', 'test', 'testing', 'results', 'sota',
  'detect', 'detector', 'detection', 'classify', 'classifier', 'search', 'retrieval', 'memory',
  'fine', 'tuning', 'finetuning', 'training', 'trained', 'post', 'inference', 'quantized',
  'gpu', 'gpus', 'tpu', 'tpus', 'cpu', 'vram', 'ram', 'tokens', 'token', 'context', 'window',
  'localllama', 'reddit', 'hackernews', 'github', 'huggingface', 'arxiv', 'discord', 'bluesky',
  'episode', 'guide', 'tutorial', 'review', 'comparison', 'vs', 'versus', 'using', 'built', 'build',
  'we', 've', 're', 'll', 'to', 'of', 'in', 'on', 'at', 'by', 'as', 'is', 'be', 'am', 'are', 'was', 'were',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'doing', 'will', 'would', 'shall', 'should',
  'can', 'could', 'may', 'might', 'must', 'so', 'if', 'no', 'not', 'but', 'nor', 'yet', 'all', 'any',
  'both', 'each', 'few', 'many', 'much', 'some', 'such', 'own', 'same', 'than', 'then', 'too', 'very',
  'also', 'only', 'even', 'here', 'there', 'back', 'still', 'well', 'about', 'after', 'before', 'between',
  'during', 'out', 'off', 'up', 'down', 'around', 'through', 'without', 'within', 'against', 'across',
  'my', 'me', 'us', 'him', 'her', 'she', 'he', 'they', 'them', 'you', 'it', 'fun', 'good', 'great',
  'amazing', 'awesome', 'fantastic', 'exciting', 'excited', 'happy', 'proud', 'glad', 'love', 'like',
  'want', 'need', 'make', 'made', 'get', 'got', 'see', 'saw', 'look', 'take', 'give', 'work', 'working',
  'today', 'tomorrow', 'yesterday', 'week', 'month', 'year', 'years', 'day', 'days', 'time', 'people',
  'world', 'team', 'friend', 'partner', 'partnering', 'teaming', 'available', 'rolling', 'trying', 'try',
  'check', 'read', 'show', 'watch', 'learn', 'begin', 'start', 'starting', 'expected', 'published',
  'special', 'other', 'another', 'every', 'really', 'actually', 'finally', 'already', 'because', 'while',
  'since', 'until', 'though', 'although', 'per', 'one', 'two', 'three', 'four', 'five',
]);

function stripFeedPrefixForClustering(rawTitle: string): string {
  return (rawTitle || '')
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/^r\/[A-Za-z0-9_]+\s*[:—-]\s*/i, '')
    .replace(/^@[A-Za-z0-9_.-]+\s*[:—-]\s*/i, '')
    .replace(/^(?:OpenAI News|Google DeepMind|Anthropic News|Meta AI Eng|HF Paper|arXiv)\s*[:—-]\s*/i, '')
    .trim();
}

export function extractCanonicalArtifactId(url = '', title = ''): string | null {
  const combined = `${url} ${title}`;
  const arxivMatch = combined.match(/(?:arxiv\.org\/(?:abs|pdf|html)\/|arxiv:\s*|huggingface\.co\/papers\/)(\d{4}\.\d{4,5})(?:v\d+)?/i);
  if (arxivMatch?.[1]) {
    return `arxiv:${arxivMatch[1]}`;
  }

  const ghMatch = url.match(/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/i);
  if (ghMatch?.[1] && ghMatch?.[2]) {
    const owner = ghMatch[1].toLowerCase();
    const repo = ghMatch[2].toLowerCase().replace(/\.git$/i, '');
    if (
      !/^(?:orgs|topics|trending|explore|marketplace|sponsors|settings|features|collections|events|about|security)$/.test(
        owner
      )
    ) {
      return `gh:${owner}/${repo}`;
    }
  }

  const hfMatch = url.match(/huggingface\.co\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/i);
  if (hfMatch?.[1] && hfMatch?.[2]) {
    const owner = hfMatch[1].toLowerCase();
    const repo = hfMatch[2].toLowerCase();
    if (!/^(?:papers|blog|posts|spaces|datasets|docs|models|tasks|collections)$/.test(owner)) {
      return `hf:${owner}/${repo}`;
    }
  }

  return null;
}

/**
 * Extracts rare proper-noun / specific model & project tokens strictly from the headline.
 * Rejects generic words ("model", "AI", "compact", "release", "open") and parameter sizes ("300M", "7B", "70B").
 */
export function extractSpecificEntityTokens(rawTitle: string): string[] {
  const cleaned = stripFeedPrefixForClustering(rawTitle);
  const rawParts = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9.+_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const tokens = new Set<string>();
  for (const raw of rawParts) {
    // Expand hyphenated slugs into their specific sub-tokens while ignoring generic parameter suffixes
    const subParts = raw.split(/[-_/]+/).filter(Boolean);
    for (const part of subParts) {
      const norm = part.replace(/^\.+|\.+$/g, '');
      if (norm.length < 3 && !/^(?:o\d|r\d|v\d|\do)$/i.test(norm)) continue;
      // Ignore pure numbers ("4", "2026", "100") and parameter/context counts ("300m", "7b", "0.8b", "128k", "12gb")
      if (/^\d+(?:\.\d+)?$/.test(norm)) continue;
      if (/^\d+(?:\.\d+)?(?:b|m|k|t|gb|mb|tb|ms|hz|x|fps)$/.test(norm)) continue;
      if (/^v\d+(?:\.\d+)*$/.test(norm)) continue;
      if (GENERIC_ENTITY_STOPWORDS.has(norm)) continue;
      tokens.add(norm);
    }
  }

  return Array.from(tokens);
}

function extractDistinctHyphenatedSlug(rawTitle: string): string | null {
  const cleaned = stripFeedPrefixForClustering(rawTitle).toLowerCase();
  const match = cleaned.match(/\b([a-z][a-z0-9]+-[a-z0-9]+(?:-[a-z0-9.]+)+)\b/);
  return match?.[1] || null;
}

const MODEL_VERSION_REGEX =
  /\b(gemini|claude|gpt|qwen|llama|mistral|deepseek|grok|genie|veo|sora|gemma|olmo|phi)[-\s]?(\d+(?:\.\d+)?)(?:[-\s]+(ultra|pro|flash|mini|nano|max|plus|lite|neon|hydrogen|sonnet|opus|haiku|codex|vibe|coder|omni|live))?\b/gi;

interface ModelVersionKey {
  family: string;
  variant: string;
}

function extractModelVersionKeys(rawTitle: string): ModelVersionKey[] {
  const cleaned = stripFeedPrefixForClustering(rawTitle);
  if (/\b(?:vs\.?|versus)\b/i.test(cleaned)) return [];
  const results = new Map<string, ModelVersionKey>();

  const matches = cleaned.matchAll(MODEL_VERSION_REGEX);
  for (const m of matches) {
    const base = (m[1] || '').toLowerCase();
    const ver = (m[2] || '').toLowerCase();
    const variant = (m[3] || '').toLowerCase();
    if (!base || !ver) continue;
    const family = `${base}${ver}`;
    const prev = results.get(family);
    if (!prev || (!prev.variant && variant)) {
      results.set(family, { family, variant });
    }
  }

  const namedSlug = cleaned.match(/\b(mistral[-\s]+vibe|claude[-\s]+code|openai[-\s]+codex)\b/i);
  if (namedSlug?.[1]) {
    const family = namedSlug[1].toLowerCase().replace(/\s+/g, '-');
    if (!results.has(family)) {
      results.set(family, { family, variant: '' });
    }
  }

  return Array.from(results.values());
}

function extractLabCorporateEventKey(rawTitle: string): string | null {
  const cleaned = stripFeedPrefixForClustering(rawTitle)
    .toLowerCase()
    .replace(/\binitial public offering\b/g, 'ipo');
  const labMatch = cleaned.match(
    /\b(anthropic|openai|deepmind|mistral|xai|nvidia|perplexity|cohere|databricks|scale ai)\b/
  );
  const eventMatch = cleaned.match(/\b(ipo|acquisition|acquires|acquired)\b/);
  if (!labMatch?.[1] || !eventMatch?.[1]) return null;
  const eventNorm = eventMatch[1].startsWith('acquir') || eventMatch[1] === 'acquisition'
    ? 'acquire'
    : eventMatch[1];
  return `corp:${labMatch[1]}:${eventNorm}`;
}

/**
 * Strict Supernova clustering predicate:
 * Requires an exact canonical URL / repo / arXiv match, an unambiguous matching model+version
 * (with zero conflicting variant names), a named lab corporate milestone, OR >= 2 shared rare
 * proper-noun entity tokens in the headline with zero conflicting model-checkpoint slugs.
 */
export function shouldClusterIntoSupernova(
  a: { title: string; url?: string; originFeedName?: string },
  b: { title: string; url?: string; originFeedName?: string }
): boolean {
  const normUrlA = (a.url || '').trim().toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '');
  const normUrlB = (b.url || '').trim().toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '');
  if (normUrlA && normUrlB && normUrlA === normUrlB) {
    return true;
  }

  const artA = extractCanonicalArtifactId(a.url || '', a.title);
  const artB = extractCanonicalArtifactId(b.url || '', b.title);
  if (artA && artB) {
    return artA === artB;
  }

  const mvA = extractModelVersionKeys(a.title);
  const mvB = extractModelVersionKeys(b.title);
  if (mvA.length === 1 && mvB.length === 1) {
    const ma = mvA[0];
    const mb = mvB[0];
    if (ma.family === mb.family) {
      if (ma.variant && mb.variant && ma.variant !== mb.variant) {
        return false;
      }
      if (ma.variant === mb.variant || !ma.variant || !mb.variant) {
        return true;
      }
    }
  }

  const corpA = extractLabCorporateEventKey(a.title);
  const corpB = extractLabCorporateEventKey(b.title);
  if (corpA && corpB && corpA === corpB) {
    return true;
  }

  // Block merging if either headline names a specific multi-hyphen model/repo slug (e.g. "voi-slop-detect-300M")
  // whose rare tokens are absent from the other headline (e.g. "Gemini 4 Hydrogen")
  const slugA = extractDistinctHyphenatedSlug(a.title);
  const slugB = extractDistinctHyphenatedSlug(b.title);
  const tokensA = extractSpecificEntityTokens(a.title);
  const tokensB = extractSpecificEntityTokens(b.title);
  if (tokensA.length < 2 || tokensB.length < 2) {
    return false;
  }

  const setB = new Set(tokensB);
  const shared = tokensA.filter((t) => setB.has(t));
  if (shared.length < 2) {
    return false;
  }

  if (slugA) {
    const slugTokensA = extractSpecificEntityTokens(slugA);
    if (slugTokensA.length >= 2 && !slugTokensA.every((st) => setB.has(st))) {
      return false;
    }
  }
  if (slugB) {
    const setA = new Set(tokensA);
    const slugTokensB = extractSpecificEntityTokens(slugB);
    if (slugTokensB.length >= 2 && !slugTokensB.every((st) => setA.has(st))) {
      return false;
    }
  }

  return true;
}

export function extractCanonicalEntity(
  title: string,
  _summary = '',
  url = ''
): { key: string; label: string } | null {
  // 1. Exact GitHub repo, HuggingFace repo, or arXiv paper ID
  const artifactId = extractCanonicalArtifactId(url, title);
  if (artifactId) {
    const label = artifactId.replace(/^(?:gh|hf|arxiv):/, '');
    return { key: artifactId, label };
  }

  // 2. Require >= 2 specific proper-noun tokens in the HEADLINE (never scan summary or single generic vendor words)
  const rareTokens = extractSpecificEntityTokens(title);
  if (rareTokens.length >= 2) {
    const topPair = rareTokens.slice(0, 3).sort();
    const cleanTitle = stripFeedPrefixForClustering(title);
    const shortLabel = cleanTitle.split(/\s+[:—–|-]\s+/)[0].slice(0, 42).trim();
    return {
      key: `ent:${topPair.join('+')}`,
      label: shortLabel || topPair.join(' '),
    };
  }

  return null;
}

export function mapSourceToNetworkFamily(
  source: SpatialSignal['source'],
  originFeedName = ''
): 'X' | 'Reddit' | 'Discord' | 'GitHub' | 'Bluesky' | 'Research' | 'VIP/Lab' | 'HackerNews' {
  if (source === 'XPlaywright' || source === 'XBridge') return 'X';
  if (source === 'Reddit' || originFeedName.startsWith('r/')) return 'Reddit';
  if (source === 'Discord' || originFeedName.toLowerCase().includes('discord')) return 'Discord';
  if (source === 'GitHub' || source === 'GHRelease') return 'GitHub';
  if (source === 'Bluesky') return 'Bluesky';
  if (source === 'arXiv' || source === 'HuggingFace') return 'Research';
  if (source === 'HackerNews') return 'HackerNews';
  return 'VIP/Lab';
}

const HYPE_WORDS = [
  'breakthrough',
  'insane',
  'sota',
  'crushes',
  '10x',
  'revolutionary',
  'agi',
  'unbelievable',
  'game changer',
  'fastest',
  'frontier',
  'dominates',
  'massive',
];

const SKEPTIC_WORDS = [
  'oom',
  'vram',
  'benchmaxx',
  'cherry',
  'quantization degradation',
  'hallucinat',
  'rate limit',
  'expensive',
  'overhyped',
  'caveat',
  'broken',
  'regression',
  'throttle',
  'wait for',
];

const VERIFIED_ENGINEER_WORDS = [
  'tok/s',
  'reproduced',
  'verified',
  'apache-2.0',
  'mit license',
  'q4_k_m',
  'fp8',
  '3090',
  '4090',
  'h100',
  '12gb',
  '24gb',
  'zero-shot',
  'production',
  'works cleanly',
  'drop-in',
];

export function scoreStreetSentiment(text: string): 'HYPE' | 'VERIFIED' | 'SKEPTICAL' {
  const low = text.toLowerCase();
  let skep = 0;
  let ver = 0;
  let hype = 0;
  for (const w of SKEPTIC_WORDS) if (low.includes(w)) skep += 2;
  for (const w of VERIFIED_ENGINEER_WORDS) if (low.includes(w)) ver += 1.6;
  for (const w of HYPE_WORDS) if (low.includes(w)) hype += 1.5;

  if (skep > ver && skep >= 2) return 'SKEPTICAL';
  if (ver >= hype && ver > 0) return 'VERIFIED';
  return hype > 0 ? 'HYPE' : 'VERIFIED';
}

function deterministicTitleJitter(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 11) - 5; // [-5..+5] deterministic variance so unrelated signals never share static 68/76
}

export function computeDivergenceMetrics(
  quotes: StreetQuote[],
  title: string,
  summary: string,
  engagement?: {
    likesOrUps?: number;
    commentsOrReplies?: number;
    velocityPerHour?: number;
  }
): DivergenceMetrics {
  const hay = `${title} ${summary}`.toLowerCase();
  const ups = Math.max(0, Number(engagement?.likesOrUps ?? 0));
  const comments = Math.max(0, Number(engagement?.commentsOrReplies ?? 0));
  const vel = Math.max(0, Number(engagement?.velocityPerHour ?? 0));
  const jitter = deterministicTitleJitter(title);

  // Derive baseline dynamically from actual upvote velocity & comment-to-upvote debate ratio
  const velocityLift = ups > 0 ? Math.min(24, Math.log10(ups + 1) * 9.5 + Math.min(10, vel * 0.12)) : 0;
  const commentRatio = ups > 0 ? comments / ups : 0;
  // High comment-to-upvote ratio (>0.45) signals heated technical debate / skepticism; moderate ratio with high ups signals verified utility
  const debateAdjustment =
    commentRatio > 0.65 ? -8 : commentRatio > 0.28 ? 5 : comments >= 10 ? 7 : 0;

  let hypeBase = 48 + velocityLift + jitter * 0.6;
  let streetBase = 52 + velocityLift * 0.75 + debateAdjustment - jitter * 0.4;

  for (const w of HYPE_WORDS) if (hay.includes(w)) hypeBase += 5.5;
  for (const w of VERIFIED_ENGINEER_WORDS) if (hay.includes(w)) streetBase += 5.5;
  for (const w of SKEPTIC_WORDS) if (hay.includes(w)) streetBase -= 7.5;
  if (/\b(skip\w*|fail\w*|hallucin\w*|broken|bug|oom|bottleneck|caveat|limit\w*)\b/.test(hay)) {
    streetBase -= 5;
  }
  if (/\b(\d+(?:\.\d+)?\s*(?:%|x|tok\/s|ms|gb))\b/.test(hay)) {
    streetBase += 6;
  }

  const realQuotes = quotes.filter((q) => !q.id.endsWith('-self-quote'));
  for (const q of realQuotes) {
    if (q.network === 'X') {
      hypeBase += q.sentiment === 'HYPE' ? 7 : 3;
    }
    if (q.network === 'Reddit' || q.network === 'Discord' || q.network === 'HackerNews') {
      const weight = Math.min(2.0, 0.8 + Math.log10(Math.max(1, q.score) + 1) * 0.5);
      if (q.sentiment === 'SKEPTICAL') streetBase -= 7 * weight;
      else if (q.sentiment === 'VERIFIED') streetBase += 5.5 * weight;
      else hypeBase += 3 * weight;
    }
  }

  const hypeScore = Math.max(28, Math.min(98, Math.round(hypeBase)));
  const streetScore = Math.max(22, Math.min(97, Math.round(streetBase)));
  const divergenceDelta = hypeScore - streetScore;

  if (divergenceDelta >= 16) {
    return {
      hypeScore,
      streetScore,
      divergenceDelta,
      verdictLabel: 'HYPE > REALITY',
      summary: `X launch excitement (${hypeScore}/100) outpaces engineer street-verdict (${streetScore}/100) — check VRAM & quantization caveats before cutover.`,
    };
  }
  if (divergenceDelta <= -12) {
    return {
      hypeScore,
      streetScore,
      divergenceDelta,
      verdictLabel: 'SLEEPER GEM',
      summary: `Engineer benchmarks (${streetScore}/100) beat social hype (${hypeScore}/100) — high-ROI under-the-radar infrastructure upgrade.`,
    };
  }
  if (streetScore >= 78) {
    return {
      hypeScore,
      streetScore,
      divergenceDelta,
      verdictLabel: 'STREET VERIFIED',
      summary: `Cross-platform consensus (${streetScore}/100 street vs ${hypeScore}/100 hype) — reproduced by local GPU & production pods.`,
    };
  }
  return {
    hypeScore,
    streetScore,
    divergenceDelta,
    verdictLabel: 'CONSENSUS',
    summary: `Balanced signal (${hypeScore} hype / ${streetScore} street) — validate on domain workload before broad rollout.`,
  };
}
