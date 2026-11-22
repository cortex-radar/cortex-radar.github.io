import {
  ClientIndustry,
  CLIENT_INDUSTRIES,
  GlossaryTerm,
  LiteracySpectrumPayload,
  SpatialSignal,
  VerifiedSourceMetric,
} from './types';
import {
  BenchmarkClaimSpec,
  classifyEvidenceScope,
  COMPLIANCE_NOT_ASSESSED_SOURCE,
  COMPLIANCE_NOT_ASSESSED_STUDY,
  extractBenchmarkClaimSpec,
  extractFrozenEntities,
  extractNamedLegalInstitution,
  extractSourceVerifiedMetrics,
  findUnbackedComplianceClaims,
  findUnbackedNumericTokens,
  getSignalReleaseMetadata,
  hasLatencyOrThroughputWithoutCost,
  hasSourceComplianceAssessment,
  hasTechnicalEngineeringContent,
  isConditionalPolicyHeadline,
  isEvaluationQualityStudy,
  isHedgedOrUnverifiedClaim,
  isLegalOrCourtRulingSignal,
  isNonToolNewsOrMarketSignal,
  isReleaseWithoutNotes,
  repairSummaryProseScope,
  repairTruncatedCommaNumbers,
  requiresVerbatimPublisherHeadline,
  stripUiChromeBoilerplate,
  stripUnbackedComplianceClaims,
  stripUnbackedNumericClaims,
  truncateAtWordBoundary,
  validateHeadlineMeaningPreserved,
  validateSummaryProseScope,
} from './provenance';

export const NO_RELEASE_NOTES_NOTICE = 'No release notes extracted — see linked release';

/**
 * Strictly banned technical acronyms & jargon words in Level 1 (Zero-Jargon Everyday Analogy).
 * Note: Named models (Actuator-7B, Qwen2.5-7B), units (tokens per second), and parameter counts are preserved verbatim.
 */
export const BANNED_L1_TERMS_REGEX =
  /\b(llms?|rag|graphrag|kv(?:-cache)?|mcp|vram|apis?|gpus?|tpus?|asics?|fp8|int4|q4_k_m|q8_0|moe|cuda|triton|q?lora|peft|dora|rlhf|grpo|dpo|sft|pkce|rbac|soc2|ttft|tpot|flops?|cfg|ptus?|jwts?|rdma|nixl|bm25|swe-bench|quantiz\w*|inference|latenc\w*|subprocessors?|autoregressive|perplexity|ablation)\b/gi;

const JARGON_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\barxiv:\s*\d{4}\.\d{4,5}(?:v\d+)?\b/gi, 'research study'],
  [
    /((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:tok\/s|t\/s)\s+(prompt|prefill|input|generation|decode|output)\b/gi,
    '$1 $2 tokens/s',
  ],
  [/\b(?:tok\/s|t\/s)\b/gi, 'tokens per second'],
  [/\bllms?\b/gi, 'AI assistants'],
  [/\bgraphrag\b/gi, 'organized memory lookup'],
  [/\brag\b/gi, 'reference lookup'],
  [/\bkv(?:-cache)?\b/gi, 'short-term working notes'],
  [/\bmcp\b/gi, 'universal app connector'],
  [/\bvram\b/gi, 'computer memory'],
  [/\bapis?\b/gi, 'software connections'],
  [/\bgpus?\b/gi, 'high-speed computer chips'],
  [/\btpus?\b/gi, 'specialized computer chips'],
  [/\basics?\b/gi, 'custom computer chips'],
  [/\b(?:fp8|int4|q4_k_m|q8_0|quantiz\w*)\b/gi, 'compact packing'],
  [/\bmoe\b/gi, 'team of specialist helpers'],
  [/\b(?:cuda|triton)\b/gi, 'chip software'],
  [/\b(?:q?lora|peft|dora)\b/gi, 'lightweight skill add-on'],
  [/\b(?:rlhf|grpo|dpo|ppo|sft)\b/gi, 'guided training'],
  [/\b(?:pkce|rbac|jwts?)\b/gi, 'visitor pass rules'],
  [/\bsoc2\b/gi, 'safety audit'],
  [/\b(?:ttft|tpot)\b/gi, 'first-response wait time'],
  [/\blatenc\w*\b/gi, 'response wait time'],
  [/\bflops?\b/gi, 'computing effort'],
  [/\bcfg\b/gi, 'strict checklist'],
  [/\bptus?\b/gi, 'reserved fast lanes'],
  [/\b(?:rdma|nixl)\b/gi, 'express data lanes'],
  [/\bbm25\b/gi, 'keyword search'],
  [/\bswe-bench\b/gi, 'real-world software repair test'],
  [/\binference\b/gi, 'live answering work'],
  [/\bsubprocessors?\b/gi, 'outside vendors'],
  [/\bautoregressive\b/gi, 'step-by-step'],
  [/\bperplexity\b/gi, 'prediction error'],
  [/\bablation\s+stud(?:y|ies)\b/gi, 'side-by-side component tests'],
  [/\bablation\b/gi, 'component testing'],
  [/\bsota\b/gi, 'leading'],
  [/\b(?:zero-shot|few-shot)\b/gi, 'out-of-the-box'],
  [/\behr\b/gi, 'medical chart'],
];

const TABLE_ALIGN_CELL_RE = /^(?::-+|-+:|:+-+:|-{2,})$/;

function stripCollapsedAlignmentResidue(input: string): string {
  const tokens = input.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';

  const isAlignToken = (tok: string) =>
    TABLE_ALIGN_CELL_RE.test(tok.replace(/^\|+|\|+$/g, ''));

  const stopProseWord =
    /^(?:is|are|was|were|be|been|has|have|had|can|will|would|should|with|from|into|that|this|these|those|for|and|but|when|where|while|which|we|our|they|their|the|a|an)$/i;

  const keep = new Array<boolean>(tokens.length).fill(true);
  let idx = 0;
  while (idx < tokens.length) {
    if (!isAlignToken(tokens[idx])) {
      idx++;
      continue;
    }

    // Count consecutive alignment tokens (e.g., ":- :- :-" -> runLen = 3)
    let endAlign = idx;
    while (endAlign < tokens.length && isAlignToken(tokens[endAlign])) {
      keep[endAlign] = false;
      endAlign++;
    }
    const runLen = endAlign - idx;

    if (runLen >= 2) {
      // Remove up to runLen preceding column-header tokens (stopping at sentence punctuation or prose verbs/articles)
      let removedBefore = 0;
      let back = idx - 1;
      while (back >= 0 && removedBefore < runLen + 1) {
        const prevTok = tokens[back];
        if (/[.!?]$/.test(prevTok) || stopProseWord.test(prevTok)) break;
        keep[back] = false;
        removedBefore++;
        back--;
      }

      // Remove trailing numeric/score table cell tokens right after the alignment row
      let fwd = endAlign;
      let removedAfter = 0;
      while (fwd < tokens.length && removedAfter < runLen * 5) {
        const nextTok = tokens[fwd];
        if (
          /^(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?|N\/A|-+|✓|✗|\+|\*)$/i.test(
            nextTok.replace(/[,;]+$/, '')
          ) &&
          !/[.!?]$/.test(nextTok)
        ) {
          keep[fwd] = false;
          removedAfter++;
          fwd++;
        } else {
          break;
        }
      }
    }

    idx = endAlign;
  }

  return tokens.filter((_, k) => keep[k]).join(' ');
}

/**
 * Decodes common HTML character entities and strips raw HTML tags (`<p>`, `<a ...>`, `<blockquote>`)
 * that occasionally survive upstream RSS/HN scraping.
 */
export function stripHtmlMarkupAndEntities(input: string): string {
  if (!input) return '';
  const decoded = input
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
  return decoded
    .replace(/<\/?(?:p|br|div|li|ul|ol|blockquote|pre|code|a|strong|em|b|i|span|img|h[1-6]|hr)\b[^>]*>/gi, ' ')
    .replace(/<\/?[a-z][^>]{0,900}>/gi, ' ')
    .replace(/\(?<\/?[a-z][a-z0-9]*(?:\s+[^>]{0,900}|[.…]+)?$/gi, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([.,;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Strips raw Markdown pipe tables (`| col | col |`, `:-`, `:--`, `--:`), HTML tables,
 * fenced code blocks, and space-collapsed benchmark table residue before extracting L1/L2 prose.
 */
export function stripMarkdownTablesAndCodeForPlainProse(input: string): string {
  if (!input) return '';
  let text = stripHtmlMarkupAndEntities(input);

  // 1. Strip fenced code blocks & raw HTML <table> blocks completely from L1/L2 beginner prose
  text = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<table[\s\S]*?<\/table>/gi, ' ');

  // 2. Remove entire multi-line Markdown table blocks (header + :- / :-- / --: separator + data rows)
  const lines = text.split(/\r?\n/);
  const outLines: string[] = [];
  const isSepRow = (s: string) =>
    /^\|?\s*(?::-+|-+:|:+-+:|-{2,})(?:\s*\|\s*(?::-+|-+:|:+-+:|-{2,}))+\s*\|?$/.test(s);

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const pipeCount = (trimmed.match(/\|/g) || []).length;

    if (isSepRow(trimmed)) {
      i++;
      continue;
    }

    if (
      pipeCount >= 2 &&
      (trimmed.startsWith('|') ||
        trimmed.endsWith('|') ||
        (i + 1 < lines.length && isSepRow(lines[i + 1].trim())))
    ) {
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!rowLine) break;
        if ((rowLine.match(/\|/g) || []).length >= 1 || isSepRow(rowLine)) {
          i++;
          continue;
        }
        break;
      }
      continue;
    }

    outLines.push(lines[i]);
    i++;
  }

  text = outLines.join(' ');

  // 3. Remove inline collapsed pipe tables (e.g. "| voi-380m | Pangram | | :- | :- | | 0.98 | 0.91 |")
  text = text
    .replace(/(?:\|\s*[^|\n]+){2,}\|?/g, ' ')
    .replace(/\|+/g, ' ');

  // 4. Strip space-collapsed table header + alignment residue (e.g. "voi-380m Pangram GPTZero :- :- :-")
  text = stripCollapsedAlignmentResidue(text);

  // 5. Strip inline markdown links, backticks, headers, and bold/italic markers
  text = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(?:^|\s)#{1,6}\s+/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1');

  return text.replace(/\s{2,}/g, ' ').trim();
}

function escapeGlossaryTermRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits L3 Builder Bridge text into whole-word glossary segments:
 * - Enforces strict `\b...\b` word boundaries so `"storage"` NEVER splits into `"sto [rag] e"`.
 * - Enforces case-sensitive matching on <= 3-letter acronyms (`RAG`, `RL`, `MCP`, `SLM`, `UI`, `MoE`).
 */
export function matchGlossaryTextSegments(
  text: string,
  glossary: GlossaryTerm[]
): Array<{ text: string; matchedTerm: GlossaryTerm | null }> {
  if (!text || !glossary || glossary.length === 0) {
    return [{ text, matchedTerm: null }];
  }
  const sorted = [...glossary]
    .filter((g) => g && typeof g.term === 'string' && g.term.trim().length > 0)
    .sort((a, b) => b.term.length - a.term.length);
  if (sorted.length === 0) {
    return [{ text, matchedTerm: null }];
  }

  const pattern = sorted
    .map((g) => `\\b${escapeGlossaryTermRegExp(g.term.trim())}\\b`)
    .join('|');
  const rx = new RegExp(`(${pattern})`, 'gi');
  const rawParts = text.split(rx);

  const segments: Array<{ text: string; matchedTerm: GlossaryTerm | null }> = [];
  for (const part of rawParts) {
    if (!part) continue;
    const matched =
      sorted.find((g) => {
        const cleanTerm = g.term.trim();
        const alnumLen = cleanTerm.replace(/[^A-Za-z0-9]/g, '').length;
        if (alnumLen <= 3) {
          return part === cleanTerm;
        }
        return part.toLowerCase() === cleanTerm.toLowerCase();
      }) || null;

    if (!matched && segments.length > 0 && segments[segments.length - 1].matchedTerm === null) {
      segments[segments.length - 1].text += part;
    } else {
      segments.push({ text: part, matchedTerm: matched });
    }
  }
  return segments;
}

/**
 * Fixes English indefinite article ("a" vs "an") grammar after jargon substitution or LLM generation
 * (e.g. "an compact AI model" -> "a compact AI model", "a AI assistant" -> "an AI assistant").
 */
export function fixIndefiniteArticles(input: string): string {
  if (!input) return '';
  let out = input;

  // 1. "an" before consonant-sound words (excluding silent-h words & vowel-sound acronyms like LLM/API/MCP/RTX) -> "a"
  out = out.replace(/\b([Aa])n\s+([A-Za-z][A-Za-z0-9-]*)/g, (full, aChar: string, word: string) => {
    const lower = word.toLowerCase();
    // Silent-h words take "an"
    if (/^(?:hour|hours|hourly|honest|honestly|honor|honors|honorable|heir|heirloom)\b/.test(lower)) {
      return full;
    }
    // Uppercase acronyms pronounced with initial vowel sound (A, E, F, H, I, L, M, N, O, R, S, X) take "an"
    if (/^[AEFHILMNORSX][A-Z0-9-]{1,6}$/.test(word) && !/^(?:UNI|USE|USA|USB|ONE)/.test(word)) {
      return full;
    }
    // "uni...", "use...", "one...", "euro..." start with /ju:/ or /w/ consonant sound -> take "a"
    if (/^(?:uni|use|usu|util|one(?:-|\b)|once\b|euro)/i.test(lower)) {
      return `${aChar} ${word}`;
    }
    // Any word starting with a written consonant letter (b, c, d, f, g, h, j, k, l, m, n, p, q, r, s, t, v, w, x, y, z) -> "a"
    if (/^[bcdfghjklmnpqrstvwxyz]/i.test(word)) {
      return `${aChar} ${word}`;
    }
    return full;
  });

  // 2. "a" before clear vowel-sound words ("a AI", "a organized", "a everyday", "a open", "a outside") -> "an"
  out = out.replace(/\b([Aa])\s+([A-Za-z][A-Za-z0-9-]*)/g, (full, aChar: string, word: string) => {
    const lower = word.toLowerCase();
    // Words starting with vowel letters that actually have consonant /ju:/ or /w/ sounds keep "a"
    if (/^(?:uni|use|usu|util|one(?:-|\b)|once\b|euro|ubiquit|uk\b)/i.test(lower)) {
      return full;
    }
    if (/^(?:ai\b|[aeio][a-z]{2,}|up(?:dat|grad|stream)\w*|un(?:trust|verif|usual|expect|limit|lock|ifi)\w*|under\w*|urgen\w*|hour\w*|honest\w*|honor\w*)/i.test(word)) {
      return `${aChar}n ${word}`;
    }
    return full;
  });

  return out;
}

/**
 * Guarantees 100% zero banned technical acronyms, zero Markdown pipe soup, and clean "a"/"an" grammar in Level 1 text.
 */
export function enforceZeroJargonL1(input: string): string {
  let clean = stripMarkdownTablesAndCodeForPlainProse(input);
  for (const [rx, replacement] of JARGON_REPLACEMENTS) {
    clean = clean.replace(rx, replacement);
  }
  clean = clean
    .replace(/\bai\s+agents?\b/gi, 'digital helpers')
    .replace(/\bagentic\b/gi, 'self-directed')
    .replace(BANNED_L1_TERMS_REGEX, 'digital tools');
  return fixIndefiniteArticles(clean).replace(/\s{2,}/g, ' ').trim();
}

/**
 * Checks whether an LLM-generated Level 1 analogy is a genuine multi-sentence everyday metaphor (>22 words)
 * rather than a telegraphic 6-word truism ("AI agents help solve...").
 */
export function isSubstantiveVividMetaphor(text?: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount < 22) return false;
  if (/^(?:ai\s+agents?|this\s+(?:model|tool|paper|update|system)\s+(?:is|helps|allows|lets))\b/i.test(trimmed)) {
    return false;
  }
  return /\b(think of|imagine|picture|like\s+a|just\s+as|instead\s+of|similar\s+to|when\s+a|suppose)\b/i.test(
    trimmed
  );
}

/**
 * Simplifies raw academic/arXiv/engineering sentences for Level 2 (Plain English Curious Newcomer)
 * so L2 fields never leak Markdown pipe tables, raw checkpoints, or "an compact AI model".
 */
export function simplifyPlainEnglishL2(input: string): string {
  let clean = enforceZeroJargonL1(stripMarkdownTablesAndCodeForPlainProse(input));
  clean = clean
    .replace(/^in this (?:paper|work|study),?\s+we\s+/i, 'Researchers ')
    .replace(/^we\s+(?:propose|introduce|present|demonstrate)\s+/i, 'Introduces ')
    .replace(/\bwe\s+(?:propose|introduce|present)\b/gi, 'researchers introduce')
    .replace(/\bwe\s+(?:evaluate|show|demonstrate)\b/gi, 'testing shows');
  clean = fixIndefiniteArticles(clean);
  return clean.replace(/\s{2,}/g, ' ').trim();
}

export function sanitizeLiteracyPayloadPlainLevels(
  payload: LiteracySpectrumPayload
): LiteracySpectrumPayload {
  return {
    ...payload,
    plainTitle: fixIndefiniteArticles(stripMarkdownTablesAndCodeForPlainProse(payload.plainTitle)),
    plainFullTitle: fixIndefiniteArticles(
      stripMarkdownTablesAndCodeForPlainProse(payload.plainFullTitle)
    ),
    levels: {
      ...payload.levels,
      1: {
        analogy: fixIndefiniteArticles(
          stripMarkdownTablesAndCodeForPlainProse(payload.levels[1].analogy)
        ),
        everydayWhy: fixIndefiniteArticles(
          stripMarkdownTablesAndCodeForPlainProse(payload.levels[1].everydayWhy)
        ),
      },
      2: {
        whatHappened: fixIndefiniteArticles(
          stripMarkdownTablesAndCodeForPlainProse(payload.levels[2].whatHappened)
        ),
        whoBuiltIt: fixIndefiniteArticles(
          stripMarkdownTablesAndCodeForPlainProse(payload.levels[2].whoBuiltIt)
        ),
        problemSolved: fixIndefiniteArticles(
          stripMarkdownTablesAndCodeForPlainProse(payload.levels[2].problemSolved)
        ),
      },
      3: {
        ...payload.levels[3],
        bridgeSummary: stripHtmlMarkupAndEntities(payload.levels[3].bridgeSummary),
      },
      4: {
        ...payload.levels[4],
        roiAndFinOps: stripHtmlMarkupAndEntities(payload.levels[4].roiAndFinOps),
        readinessAndRisk: stripHtmlMarkupAndEntities(payload.levels[4].readinessAndRisk),
        clientAdvice: stripHtmlMarkupAndEntities(payload.levels[4].clientAdvice),
      },
      5: {
        ...payload.levels[5],
        architectureBrief: stripHtmlMarkupAndEntities(payload.levels[5].architectureBrief),
        specsAndCaveats: stripHtmlMarkupAndEntities(payload.levels[5].specsAndCaveats),
        streetConsensus: stripHtmlMarkupAndEntities(payload.levels[5].streetConsensus),
      },
    },
  };
}

export function hasBannedL1Jargon(input: string): boolean {
  BANNED_L1_TERMS_REGEX.lastIndex = 0;
  return BANNED_L1_TERMS_REGEX.test(input);
}

/**
 * Curated Glossary Dictionary for Level 3 (Builder Bridge).
 * Each definition is strictly 1 plain-English sentence teaching the term clearly.
 */
const MASTER_GLOSSARY_BANK: Array<{
  term: string;
  triggers: RegExp[];
  definition: string;
}> = [
  {
    term: 'KV-Cache',
    triggers: [/\bkv[-\s]?cache\b/i, /\bkv[-\s]?transfer\b/i, /\bkv[-\s]?pin/i, /\bvllm\b/i, /\bprefill\b/i],
    definition:
      'KV-Cache is the AI model’s short-term scratchpad memory that stores earlier parts of a conversation so it does not have to re-read every word from scratch.',
  },
  {
    term: 'vLLM',
    triggers: [/\bvllm\b/i, /\bdisaggregat/i, /\bpagedattention\b/i],
    definition:
      'vLLM is the leading open-source serving engine that lets companies run AI models on their own servers for thousands of users at once without wasting chip memory.',
  },
  {
    term: 'Disaggregated Serving',
    triggers: [/\bdisagg/i, /\bprefill[-\s]?decode\b/i, /\brdma\b/i],
    definition:
      'Disaggregated Serving splits heavy document reading onto one group of chips and fast word-by-word replying onto another so big uploads never slow down live chats.',
  },
  {
    term: 'MCP',
    triggers: [/\bmcp\b/i, /model context protocol/i],
    definition:
      'Model Context Protocol (MCP) is a universal plug-and-play standard—like a USB-C port for AI—that lets AI assistants safely read databases, Slack, GitHub, and business tools.',
  },
  {
    term: 'RAG',
    triggers: [/\brag\b/i, /\bretrieval\b/i, /\bpgvector\b/i, /\bvector\b/i],
    definition:
      'Retrieval-Augmented Generation (RAG) lets an AI look up trusted facts from your company’s own documents right before answering instead of guessing from memory.',
  },
  {
    term: 'GraphRAG',
    triggers: [/\bgraphrag\b/i, /\bbi-temporal\b/i, /\bknowledge graph/i],
    definition:
      'GraphRAG organizes company facts as a connected web of people, products, and dates so the AI knows which policy is current and which one expired last year.',
  },
  {
    term: 'MoE',
    triggers: [/\bmoe\b/i, /mixture[-\s]of[-\s]experts/i, /\b671b\b/i, /\ba22b\b/i, /\bmaverick\b/i],
    definition:
      'Mixture-of-Experts (MoE) builds one giant AI brain out of smaller specialist teams and wakes up only the few specialists needed for each question to save massive cost.',
  },
  {
    term: 'Open-Weights',
    triggers: [/open[-\s]?weights/i, /\bollama\b/i, /\bhugging\s?face\b/i, /\bapache-2\.0\b/i, /\bmit[-\s]licens/i, /\blocal\s?llama\b/i],
    definition:
      'Open-Weights means the trained AI brain files are publicly downloadable so organizations can run them privately on their own hardware with zero data leaving the building.',
  },
  {
    term: 'Quantization',
    triggers: [/\bquantiz/i, /\bfp8\b/i, /\bint4\b/i, /\bq4_k_m\b/i, /\bq8_0\b/i],
    definition:
      'Quantization shrinks an AI model’s numbers from high precision to compact numbers so huge models fit onto smaller, cheaper graphics cards with almost identical quality.',
  },
  {
    term: 'VRAM',
    triggers: [/\bvram\b/i, /\bh100\b/i, /\bh200\b/i, /\brtx\b/i, /\b12gb\b/i, /\b24gb\b/i, /\bgpu\b/i],
    definition:
      'VRAM (Video RAM) is the ultra-fast memory soldered directly onto an AI graphics chip—the single biggest bottleneck determining how large an AI model you can run.',
  },
  {
    term: 'Context Window',
    triggers: [/\bcontext\b/i, /\b2m\b/i, /\b1m\b/i, /\b128k\b/i, /\b200k\b/i, /\b400k\b/i],
    definition:
      'A Context Window is how much text, code, or video an AI can hold in its head during a single conversation before older details start dropping out.',
  },
  {
    term: 'TTFT',
    triggers: [/\bttft\b/i, /\blatency\b/i, /\bsub-second\b/i, /\bms\b/i],
    definition:
      'Time-To-First-Token (TTFT) measures the milliseconds between pressing Enter and seeing the AI’s very first word appear on screen.',
  },
  {
    term: 'Speculative Decoding',
    triggers: [/\bspeculative\b/i, /\beagle[-\s]?3\b/i],
    definition:
      'Speculative Decoding uses a tiny, ultra-fast helper model to draft several words ahead while the big model verifies them in one batch, doubling reply speed without losing accuracy.',
  },
  {
    term: 'Prompt Injection',
    triggers: [/prompt[-\s]?injection/i, /\bpoisoning\b/i, /\brug-pull\b/i, /\bjailbreak\b/i, /\bowasp\b/i],
    definition:
      'Prompt Injection is a security attack where hidden instructions tucked inside a webpage, email, or tool trick an AI assistant into leaking data or breaking rules.',
  },
  {
    term: 'Zero-Trust RBAC',
    triggers: [/\brbac\b/i, /\boauth/i, /zero[-\s]?trust/i, /\bpkce\b/i],
    definition:
      'Zero-Trust Role-Based Access Control (RBAC) ensures an AI assistant can only touch the exact files and actions that the logged-in human employee is personally allowed to use.',
  },
  {
    term: 'LoRA',
    triggers: [/\blora\b/i, /fine[-\s]?tun/i, /\badapter/i],
    definition:
      'Low-Rank Adaptation (LoRA) teaches an existing AI model a specialized company skill by training a tiny plug-in layer instead of retraining the entire model from scratch.',
  },
  {
    term: 'Agentic Tool Use',
    triggers: [/\bagentic\b/i, /\bagents?\b/i, /computer[-\s]?use/i, /\btool[-\s]?call/i],
    definition:
      'Agentic Tool Use means the AI does more than chat—it plans multi-step tasks, runs terminal commands, edits files, and calls software tools on your behalf.',
  },
  {
    term: 'FinOps Cascade',
    triggers: [/\bfinops\b/i, /\bcascade\b/i, /\brouter\b/i, /\blitellm\b/i, /\bpricing\b/i],
    definition:
      'A FinOps Cascade uses a lightweight router to send 80% of easy questions to fast, inexpensive AI models and reserves expensive flagship models only for hard problems.',
  },
  {
    term: 'SWE-bench',
    triggers: [/\bswe-bench\b/i, /repo resolution/i, /\bcoding\b/i, /\bcodestral\b/i, /\bclaude[-\s]?code\b/i],
    definition:
      'SWE-bench Verified is the industry’s toughest coding test, grading whether an AI can autonomously fix real GitHub software bugs and pass every unit test.',
  },
];

interface SeedPlainOverride {
  plainTitle: string;
  plainFullTitle: string;
  analogy: string;
  everydayWhy: string;
  whatHappened: string;
  whoBuiltIt: string;
  problemSolved: string;
}

const SEED_PLAIN_OVERRIDES: Record<string, SeedPlainOverride> = {
  'seed-gemini-25-pro': {
    plainTitle: 'Google AI Reads Whole Codebases 4x Cheaper',
    plainFullTitle: 'Google’s New Flagship AI Can Read Thousands of Pages at Once for 75% Less Cost',
    analogy:
      'Imagine a master librarian with a desk big enough to spread out twenty thick encyclopedias at the same time—and once those books are on the desk, asking follow-up questions costs pennies instead of re-shelving them every minute. That is how this upgraded assistant handles giant projects without losing its place.',
    everydayWhy:
      'Apps you use at work and home can now understand entire manuals, videos, and large projects in one go without forgetting earlier details.',
    whatHappened:
      'Google DeepMind launched its flagship reasoning assistant with huge memory capacity and a 75% discount when re-reading saved project files.',
    whoBuiltIt: 'Google DeepMind.',
    problemSolved:
      'Teams no longer have to chop big documents or software projects into tiny, error-prone snippets just to get accurate answers.',
  },
  'seed-deepseek-r2': {
    plainTitle: 'Free Open AI Rivals Tech Giants at 80% Less Cost',
    plainFullTitle: 'Free Downloadable AI Brain Matches Top Paid Assistants for a Fraction of the Bill',
    analogy:
      'Instead of waking up an entire hospital staff of 600 doctors for a simple sprained ankle, this smart clinic wakes up only the three exact specialists you need. Even better, the blueprints are completely free so any organization can run its own private clinic indoors.',
    everydayWhy:
      'Hospitals, banks, and small businesses can run top-tier smart software privately at dramatically lower prices.',
    whatHappened:
      'DeepSeek released a free, open-license AI brain that rivals expensive commercial assistants while using far less memory and computing budget.',
    whoBuiltIt: 'DeepSeek open research lab.',
    problemSolved:
      'Eliminates vendor lock-in and cuts running costs by roughly 80% for organizations that must keep sensitive records strictly in-house.',
  },
  'seed-claude-4-sonnet': {
    plainTitle: 'Anthropic AI Fixes Real Software Bugs 2.4x Faster',
    plainFullTitle: 'Anthropic’s Coding Assistant Autonomously Solves Over Three-Quarters of Real Software Bugs',
    analogy:
      'Think of hiring a careful master electrician who does not just hand you a diagram, but actually opens the breaker box, tests every wire step by step, fixes the fault, and refuses to follow fake sticky-note instructions left by pranksters.',
    everydayWhy:
      'Software teams can modernize aging banking, healthcare, and consumer apps much faster with fewer crashes and security bugs.',
    whatHappened:
      'Anthropic upgraded Claude 4 Sonnet to plan multi-step coding repairs, operate computer interfaces reliably, and resist hidden trick instructions.',
    whoBuiltIt: 'Anthropic.',
    problemSolved:
      'Turns slow, error-prone manual code rewrites into reliable, supervised automation with strong built-in security discipline.',
  },
  'seed-arxiv-latent-verify': {
    plainTitle: 'Built-In Fact-Checker Cuts AI Mistakes by 54%',
    plainFullTitle: 'New Self-Checking Technique Catches Half of AI Action Mistakes Before They Happen',
    analogy:
      'Picture a chef tasting a spoonful of soup right at the stove before sending the bowl out to the dining room, rather than hiring four extra chefs to cook the same dish four times. It catches bad recipes instantly with almost zero wasted effort.',
    everydayWhy:
      'Digital assistants become much less likely to make embarrassing or costly errors when booking, filing, or updating records.',
    whatHappened:
      'Researchers created a tiny built-in self-checker that spots when an AI is about to output a broken command before the mistake ever leaves the system.',
    whoBuiltIt: 'Academic AI safety & systems researchers.',
    problemSolved:
      'Stops automated assistants from sending garbled instructions to company databases without paying four times more to double-check every answer.',
  },
  'seed-gpt-51-reasoning': {
    plainTitle: 'OpenAI Adjusts Thinking Effort Automatically',
    plainFullTitle: 'OpenAI’s New Unified Brain Thinks Fast on Easy Tasks and Deeply on Hard Math',
    analogy:
      'Just like a seasoned driver glides effortlessly on an empty highway but slows down and focuses intensely in a snowstorm, this single brain automatically dials up deep concentration only when a question truly requires it.',
    everydayWhy:
      'You stop waiting ten seconds for simple everyday answers while still getting thorough, spreadsheet-grade accuracy on tough financial questions.',
    whatHappened:
      'OpenAI introduced GPT-5.1 Adaptive, a single system that automatically chooses how much thinking effort each question needs and guarantees clean structured formatting.',
    whoBuiltIt: 'OpenAI (available directly and through Microsoft Azure).',
    problemSolved:
      'Removes the headache of juggling separate "fast" and "smart" AI models while delivering sub-second financial and analytical answers.',
  },
  'seed-mcp-zero-trust': {
    plainTitle: 'Safety Lock Lets AI Use Work Apps Securely',
    plainFullTitle: 'New Security Checkpoint Gives AI Assistants Safe, Audited Visitor Passes to Company Apps',
    analogy:
      'Instead of handing a cleaning crew the master key to every vault in a bank, a hotel front desk prints a personal keycard that opens only the one room they were hired to tidy—and logs every door tap automatically.',
    everydayWhy:
      'Your workplace can finally let helpful digital assistants organize calendars and tickets without risking private payroll or customer files.',
    whatHappened:
      'Open-source engineers released a high-speed security checkpoint that enforces strict per-employee permissions and privacy scrubbing whenever AI assistants connect to internal workplace software.',
    whoBuiltIt: 'Open-source security engineering community.',
    problemSolved:
      'Gives security chiefs the exact permission controls and audit logs required to approve AI assistants inside strict companies.',
  },
  'seed-gemini-25-flash': {
    plainTitle: 'Ultra-Fast Google AI Cuts Cloud Bills by 72%',
    plainFullTitle: 'High-Speed Everyday Google AI Answers Instantly at One-Sixth the Usual Price',
    analogy:
      'Using a massive cargo jet to deliver a pizza across town wastes fuel and money; switching daily deliveries to a nimble electric scooter gets dinner to your door faster for pennies.',
    everydayWhy:
      'Voice assistants and customer support tools reply almost instantaneously without driving up subscription prices.',
    whatHappened:
      'Google launched a high-speed, low-cost version of Gemini 2.5 that handles 85% of everyday business tasks at extreme speed and a fraction of flagship pricing.',
    whoBuiltIt: 'Google DeepMind.',
    problemSolved:
      'Slashes runaway AI cloud bills by two-thirds while keeping voice and chat interactions snappy enough for real human conversation.',
  },
  'seed-eu-ai-act-gpai': {
    plainTitle: 'Europe Clarifies Simple Rules for Business AI',
    plainFullTitle: 'New European Playbook Explains How Companies Can Customize AI Without Heavy Legal Penalties',
    analogy:
      'European road regulators just confirmed that adding custom seat covers and a roof rack to your car does not legally turn you into a car manufacturer—you only follow normal safe-driving rules rather than crash-testing the engine from scratch.',
    everydayWhy:
      'European hospitals, banks, and employers get clear legal green lights to roll out helpful AI tools safely.',
    whatHappened:
      'European regulators published clear enforcement rules separating companies that build giant foundation AI brains from ordinary businesses that simply connect AI to their own documents.',
    whoBuiltIt: 'European Union AI Office & regulatory authorities.',
    problemSolved:
      'Clears up legal confusion that had frozen European AI rollouts and shows teams how to stay in the lighter compliance tier.',
  },
  'seed-qwen3-235b': {
    plainTitle: 'Multilingual Open AI Runs on Half the Hardware',
    plainFullTitle: 'Free Apache-Licensed AI Brain Speaks 119 Languages and Needs Half the Usual Server Equipment',
    analogy:
      'Imagine a fluent translator who speaks over a hundred languages and carries a light switch on their desk—flipping to instant quick-reply mode for casual greetings and deep-study mode only when translating complex legal contracts.',
    everydayWhy:
      'Global customer service and local language tools become dramatically cheaper and sharper across 119 languages.',
    whatHappened:
      'Alibaba’s Qwen team released a free commercial-friendly AI model with a built-in quick-vs-deep thinking switch that runs on half the server hardware of rival giant models.',
    whoBuiltIt: 'Qwen open-source team.',
    problemSolved:
      'Lets companies run world-class multilingual AI on private servers with a clean business license and 50% lower hardware bills.',
  },
  'seed-jpm-claims-roi': {
    plainTitle: 'Insurer Settles Claims in 11 Mins Instead of 6 Days',
    plainFullTitle: 'Major Insurer Pairs Visual AI With Strict Rulebooks to Settle 71% of Claims in 11 Minutes',
    analogy:
      'Think of an experienced photo inspector who measures the dent on a car fender in seconds, then hands those exact measurements to a locked calculator that applies the official insurance rulebook to the penny—never guessing on the payout.',
    everydayWhy:
      'Waiting nearly a week for a routine insurance payout shrinks to eleven minutes while human specialists focus on complex cases.',
    whatHappened:
      'A major insurer proved across 1.8 million real claims that combining AI photo reading with traditional deterministic business rule software safely automates 71% of claims.',
    whoBuiltIt: 'Tier-1 enterprise insurance engineering team.',
    problemSolved:
      'Proves how regulated industries can get massive speedups from AI without ever letting an AI guess on money or legal policy.',
  },
  'seed-llama4-maverick': {
    plainTitle: 'Meta’s Visual AI Reads Charts on Major Clouds',
    plainFullTitle: 'Meta’s New Chart-and-Document AI Arrives Ready-to-Rent on Amazon, Google, and Microsoft Clouds',
    analogy:
      'Instead of buying and maintaining your own printing press just to read illustrated magazines, three neighborhood copy shops now let you walk in and scan complex charts by the page with zero setup.',
    everydayWhy:
      'Businesses can instantly extract answers from messy scanned receipts, slide decks, and charts without setting up dedicated hardware.',
    whatHappened:
      'Meta’s visual-and-text Llama-4 Maverick model launched as an instant pay-as-you-go service on AWS, Google Cloud, and Microsoft Azure.',
    whoBuiltIt: 'Meta AI in partnership with major cloud providers.',
    problemSolved:
      'Lets teams process visual PDFs and charts privately inside their existing cloud accounts with zero server maintenance.',
  },
  'seed-vllm-disagg-prefill': {
    plainTitle: 'AI Servers Now Run Big Conversations 4x Cheaper',
    plainFullTitle: 'New Server Breakthrough Splits Reading and Replying So Giant Uploads Never Lag Live Chats',
    analogy:
      'At a busy coffee shop, if one customer orders catering for fifty people at the single register, everyone wanting a quick espresso gets stuck waiting. Opening a separate catering prep counter in back keeps the express line moving twice as fast with half the staff stress.',
    everydayWhy:
      'Chatbots stay fast and affordable even during peak hours when thousands of people upload huge files at the same time.',
    whatHappened:
      'The open-source vLLM v0.9 server update separates heavy document reading from fast live replying across server chips, doubling capacity and slashing hosting costs.',
    whoBuiltIt: 'The open-source vLLM systems engineering project.',
    problemSolved:
      'Prevents big document uploads from freezing live users and cuts private AI server hardware needs nearly in half.',
  },
  'seed-cert-gcp-agent-arch': {
    plainTitle: 'New Hands-On Exam Proves Real AI Builder Skills',
    plainFullTitle: 'Practical 3-Hour Lab Certification Tests Real AI Safety and Cost Engineering Instead of Trivia',
    analogy:
      'Instead of passing a written multiple-choice quiz about swimming while sitting in a dry classroom, lifeguards now jump into the pool and complete four real rescue drills on the clock.',
    everydayWhy:
      'Organizations hiring AI specialists can tell who has actually built safe, working systems versus who only memorized buzzwords.',
    whatHappened:
      'A new three-hour hands-on lab exam launched that grades architects on building secure, cost-capped multi-assistant systems in live cloud sandboxes.',
    whoBuiltIt: 'Enterprise cloud certification & training division.',
    problemSolved:
      'Gives engineers and consultants a credible, practical badge proving they know how to secure and budget real production AI.',
  },
  'seed-owasp-mcp-poisoning': {
    plainTitle: 'Security Alert: Fake Plug-Ins Can Trick AI Tools',
    plainFullTitle: 'Security Researchers Warn That Unverified AI Plug-Ins Can Hide Invisible Data-Stealing Commands',
    analogy:
      'Imagine downloading a free flashlight app that quietly changes its own instruction manual overnight to tell your phone butler to mail out your house keys. Locking every app’s instruction sheet behind a tamper-proof wax seal stops the trick cold.',
    everydayWhy:
      'Keeping strict safety checks on workplace plug-ins protects your private passwords, emails, and customer records from sneaky leaks.',
    whatHappened:
      'Security researchers demonstrated how untrusted third-party AI plug-ins can hide invisible text instructions that trick coding and workplace assistants into leaking sensitive files.',
    whoBuiltIt: 'OWASP & independent AI red-team security researchers.',
    problemSolved:
      'Shows security teams exactly how to lock and verify approved AI plug-ins before an attacker can tamper with them.',
  },
  'seed-arxiv-graph-memory': {
    plainTitle: 'Date-Aware Memory Stops AI Citing Old Rules',
    plainFullTitle: 'Time-Stamped Memory Webs Stop Workplace AI From Quoting Outdated Last-Year Policies',
    analogy:
      'If you ask a filing clerk for today’s train ticket price, you do not want them handing you a 2023 brochure just because the cover looks similar. Stamping clear "valid from" and "expired on" dates on every folder guarantees you always get today’s active rule.',
    everydayWhy:
      'Customer service and workplace helpdesks stop giving outdated prices or expired company policies by mistake.',
    whatHappened:
      'Researchers built a time-aware memory organizer that tags facts with start and expiration dates, beating standard document search by 38% when company rules change over time.',
    whoBuiltIt: 'Information retrieval & knowledge-systems researchers.',
    problemSolved:
      'Fixes one of business AI’s most annoying habits—confidently quoting last year’s outdated PDF instead of this month’s updated policy.',
  },
  'seed-mistral-large-25': {
    plainTitle: 'European-Hosted AI Keeps Banking Data Inside EU',
    plainFullTitle: 'Mistral Launches Strict European-Only AI Hosting for Banks and Public Agencies',
    analogy:
      'Just like Swiss and German banks keep physical gold bars inside local vaults governed strictly by European law rather than shipping them overseas, this service processes every business question strictly inside Frankfurt and Paris data centers.',
    everydayWhy:
      'European citizens get modern digital banking and public services while their personal records remain protected under strict local privacy laws.',
    whatHappened:
      'Mistral AI launched European-hosted versions of its flagship coding and business assistants with a strict guarantee that zero customer data ever leaves European borders.',
    whoBuiltIt: 'Mistral AI (headquartered in Paris).',
    problemSolved:
      'Unblocks European banks, hospitals, and government agencies that are legally barred from sending citizen data to US-controlled servers.',
  },
  'seed-finops-router-bench': {
    plainTitle: 'Smart Traffic Router Cuts Company AI Bills 64%',
    plainFullTitle: 'Study of 40 Million Workplace Questions Shows Smart Routing Cuts AI Costs by Two-Thirds',
    analogy:
      'A smart hospital triage nurse greets every patient at the front door—sending quick prescription refills to the express counter in two minutes and reserving top surgeons strictly for complex operations, cutting costs dramatically while improving care.',
    everydayWhy:
      'Companies save millions on computing bills and pass faster, more reliable digital tools on to employees and customers.',
    whatHappened:
      'A real-world study across 40 million workplace requests proved that automatically sorting easy questions to fast budget AI brains and hard questions to top brains cuts spending by 64% while slightly improving quality.',
    whoBuiltIt: 'Enterprise AI platform & cost-engineering benchmark consortium.',
    problemSolved:
      'Stops organizations from overpaying sixfold by sending routine everyday lookups to their most expensive AI engine.',
  },
  'seed-iso-42001-kit': {
    plainTitle: 'Automated Safety Recorder Saves 220 Audit Hours',
    plainFullTitle: 'Free Compliance Recorder Automatically Collects AI Safety Proof Like an Airplane Black Box',
    analogy:
      'Instead of asking pilots to write down every altitude change by hand on a clipboard after landing, an airplane’s automatic flight recorder quietly logs every instrument check in real time so safety inspectors can verify everything in minutes.',
    everydayWhy:
      'Software vendors prove their AI tools are safe and fair automatically instead of bogging teams down in months of paperwork.',
    whatHappened:
      'Engineers released version 1.0 of an open-source compliance recorder that automatically gathers safety, fairness, and incident logs for the global ISO 42001 AI safety standard.',
    whoBuiltIt: 'Open-source AI governance & compliance engineering contributors.',
    problemSolved:
      'Saves roughly 220 hours of manual spreadsheet audit work and speeds up security approval with large enterprise buyers.',
  },
  'seed-sovereign-compute-pact': {
    plainTitle: 'New Custom AI Chips Drive 40% Price Drop',
    plainFullTitle: 'Major Power and Custom Chip Deals Push Bulk AI Computing Prices Down Another 40%',
    analogy:
      'When bakeries switch from expensive hand-built ovens to purpose-built bread machines powered by dedicated solar farms, the cost of baking each loaf drops sharply—meaning restaurants should never lock into yesterday’s high bread prices for three years.',
    everydayWhy:
      'Falling computing costs make advanced AI features cheaper and more accessible across everyday apps and services.',
    whatHappened:
      'Major cloud providers committed 2.4 gigawatts of power and next-generation custom silicon chips, driving a 40% price drop for overnight and bulk AI processing.',
    whoBuiltIt: 'Major cloud providers and sovereign chip partners.',
    problemSolved:
      'Lowers bulk processing bills and warns business buyers not to lock into rigid multi-year pricing contracts while costs fall rapidly.',
  },
};

function stripOriginPrefixFromHeadline(rawTitle: string, originName?: string): string {
  let cleaned = rawTitle
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^r\/[A-Za-z0-9_]+:\s*/i, '')
    .replace(/^(?:X\s*[·•-]\s*)?@[A-Za-z0-9_.-]+\s*:\s*/i, '')
    .replace(/^(?:OpenAI News|Google DeepMind|Anthropic News|Meta AI Eng|HF Paper|arXiv)\s*:\s*/i, '')
    .trim();

  if (originName) {
    const escaped = originName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`^${escaped}\\s*[:—-]\\s*`, 'i'), '').trim();
  }
  return cleaned || rawTitle.trim();
}

interface ExtractedSignalFacts {
  cleanHeadline: string;
  leadSentence: string;
  detailSentence: string;
  quantSentence: string;
  workflowSentence: string;
  hasRichBody: boolean;
}

/**
 * Strips any trailing incomplete clause that lacks terminal punctuation (.!?) or ends mid-thought
 * (e.g. "...so it just skipped the part it") due to upstream RSS/Atom character limits.
 */
export function stripTrailingIncompleteClause(rawText: string): string {
  const normalized = (rawText || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const endsWithTerminal = /[.!?]["')\]]*$/.test(normalized);
  const endsWithEllipsis = /(?:\u2026|\.\.\.)\s*$/.test(normalized);
  const endsWithDanglingWord =
    /\b(?:the|a|an|to|of|in|on|for|with|and|or|but|so|that|which|who|it|its|this|these|those|by|from|as|at|into|while|when|if|because|than|part\s+it)[.!?]?$/i.test(
      normalized
    );

  if (endsWithTerminal && !endsWithDanglingWord && !endsWithEllipsis) {
    return normalized;
  }

  // Walk back to the last genuine sentence boundary (. ! ?)
  const boundaryMatches = Array.from(normalized.matchAll(/[.!?]["')\]]*(?=\s+[A-Z0-9"(\[]|$)/g));
  for (let i = boundaryMatches.length - 1; i >= 0; i--) {
    const m = boundaryMatches[i];
    const endIdx = (m.index ?? 0) + m[0].length;
    if (endIdx < normalized.length && endIdx >= 36) {
      const candidate = normalized.slice(0, endIdx).trim();
      if (candidate.length >= 36) return candidate;
    }
  }

  // Complete social/feed statements lacking trailing period (and not ending on a dangling word or ellipsis)
  // are preserved verbatim so comma numbers like "used 31,477 output tokens" are never chopped.
  if (!endsWithDanglingWord && !endsWithEllipsis) {
    return `${normalized}.`;
  }

  // Truncated/ellipsis fragment: strip only trailing non-numeric clause after comma/semicolon/dash
  const cleanedEllipsis = normalized.replace(/(?:\u2026|\.\.\.)\s*$/, '').trim();
  const trimmedClause = cleanedEllipsis
    .replace(/(?:(?<!\d)[,;:]\s+|[—–]\s+)[^.!?]{1,55}$/, '')
    .replace(
      /\s+\b(?:the|a|an|to|of|in|on|for|with|and|or|but|so|that|which|it|by|from|as|at|into|while|when|if|because)\s*$/i,
      ''
    )
    .trim();
  if (!trimmedClause) return '';
  return /[.!?]["')\]]*$/.test(trimmedClause) ? trimmedClause : `${trimmedClause}.`;
}

function extractSignalFacts(sig: SpatialSignal): ExtractedSignalFacts {
  const cleanHeadline = stripOriginPrefixFromHeadline(sig.title, sig.originFeedName);
  const proseSource = stripMarkdownTablesAndCodeForPlainProse(sig.rawAbstract || '');
  const rawBody = stripTrailingIncompleteClause(proseSource);

  const rawSentences = rawBody
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length < 26) return false;
      if (!/[.!?]["')\]]*$/.test(s)) return false;
      const lower = s.toLowerCase();
      if (lower === cleanHeadline.toLowerCase() || lower === `${cleanHeadline.toLowerCase()}.`) {
        return false;
      }
      if (/^(read more|continue reading|click here|subscribe|sign up|live upstream telemetry)/i.test(lower)) {
        return false;
      }
      return true;
    });

  const leadSentence = rawSentences[0] || '';
  const quantRx1 =
    /(?<![\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*%|\s*x|\s*ms|\s*gb|\s*k|\s*m|\s*hours|\s*clinicians|\s*hospitals|\s*users|\s*(?:prompt\s+|output\s+|input\s+|generation\s+)?(?:tokens?\/s|tok\/s|tokens\s+per\s+second|tokens)|[-\s]+token\s+(?:prompt|context)|\s*cents)\b/i;
  const quantRx2 =
    /(?<![\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*%|\s*x|\s*ms|\s*gb|\s*hours|\s*(?:prompt\s+|output\s+|input\s+|generation\s+)?(?:tokens?\/s|tok\/s|tokens\s+per\s+second|tokens)|\s*cents)\b/i;
  const quantSentence =
    rawSentences.find((s, idx) => idx > 0 && quantRx1.test(s)) ||
    rawSentences.find((s) => quantRx2.test(s)) ||
    '';

  const workflowSentence =
    rawSentences.find(
      (s) =>
        s !== leadSentence &&
        /\b(reduc|eliminat|automat|save|streamlin|clinical|patient|hospital|workflow|developer|production|audit|latency|memory|cost|compliance|deploy|integrat|benchmark|evaluat)\w*/i.test(
          s
        )
    ) ||
    rawSentences[1] ||
    '';

  const detailSentence =
    (quantSentence && quantSentence !== leadSentence ? quantSentence : '') ||
    (workflowSentence && workflowSentence !== leadSentence ? workflowSentence : '') ||
    rawSentences[1] ||
    '';

  return {
    cleanHeadline,
    leadSentence,
    detailSentence,
    quantSentence,
    workflowSentence,
    hasRichBody: leadSentence.length >= 40,
  };
}

function resolveBuilderIdentity(sig: SpatialSignal): string {
  const hay = `${sig.originFeedName || ''} ${sig.url} ${sig.title}`.toLowerCase();
  let builder = '';

  if (hay.includes('openai.com') || hay.includes('openai news')) {
    if (/\b(health|care|clinical|hospital|medical|patient)\b/i.test(`${sig.title} ${sig.rawAbstract}`)) {
      builder = 'OpenAI (Healthcare & Enterprise Team)';
    } else if (/\b(codex|cli|agent|sdk|responses)\b/i.test(sig.title)) {
      builder = 'OpenAI (Codex & Developer Platform Team)';
    } else {
      builder = 'OpenAI';
    }
  } else if (hay.includes('deepmind.google') || hay.includes('google deepmind')) {
    builder = 'Google DeepMind Research & Product Team';
  } else if (hay.includes('blog.google') || hay.includes('google ai')) {
    builder = 'Google AI';
  } else if (hay.includes('anthropic')) {
    builder = /\bclaude[- ]code\b/i.test(sig.title)
      ? 'Anthropic (Claude Code Engineering Team)'
      : 'Anthropic';
  } else if (hay.includes('engineering.fb.com') || hay.includes('meta ai')) {
    builder = 'Meta AI Infrastructure & Engineering';
  } else if (hay.includes('mistral.ai')) {
    builder = 'Mistral AI';
  } else if (hay.includes('karpathy')) {
    builder = 'Andrej Karpathy';
  } else if (hay.includes('simonwillison')) {
    builder = 'Simon Willison';
  } else if (hay.includes('oneusefulthing') || hay.includes('mollick')) {
    builder = 'Ethan Mollick (Wharton / One Useful Thing)';
  } else if (hay.includes('latent.space') || hay.includes('swyx')) {
    builder = 'Latent Space (Swyx & Alessio)';
  } else if (hay.includes('interconnects') || hay.includes('natolambert') || hay.includes('nathan lambert')) {
    builder = 'Nathan Lambert (Interconnects / Ai2)';
  } else if (hay.includes('lilianweng')) {
    builder = 'Lilian Weng';
  } else if (sig.url.includes('github.com/')) {
    const ghMatch = sig.url.match(/github\.com\/([^/]+\/[^/?#]+)/i);
    builder = ghMatch?.[1]
      ? `${ghMatch[1]} Open-Source Maintainers`
      : sig.originFeedName || 'GitHub Open-Source Contributors';
  } else if (sig.source === 'arXiv' || sig.url.includes('arxiv.org')) {
    builder = 'Academic & Lab Research Authors (arXiv Preprint)';
  } else if (sig.source === 'HuggingFace' || sig.url.includes('huggingface.co/papers')) {
    builder = 'ML Research Authors (Hugging Face Daily Papers)';
  } else if (sig.source === 'Reddit' || /^r\//i.test(sig.originFeedName || '')) {
    const sub = sig.originFeedName || 'Reddit AI';
    const topAuthor = sig.streetQuotes?.[0]?.author;
    builder =
      topAuthor && topAuthor !== sub
        ? `Community thread in ${sub} (top contributor: u/${topAuthor.replace(/^u\//, '')})`
        : `${sub} Engineering Community`;
  } else if (sig.source === 'HackerNews') {
    try {
      const host = new URL(sig.url).hostname.replace(/^www\./, '');
      builder =
        host && host !== 'news.ycombinator.com'
          ? `Published on ${host} (discussed on Hacker News)`
          : 'Hacker News Engineering Community';
    } catch {
      builder = 'Hacker News Engineering Community';
    }
  } else {
    builder = sig.modelSpecs?.provider || sig.originFeedName || sig.source;
  }

  const extraSources = (sig.sourceProvenance || []).filter(
    (p) => p && !builder.toLowerCase().includes(p.toLowerCase()) && p !== sig.originFeedName
  );
  if (extraSources.length > 0) {
    return `${builder} · Cross-surfaced on ${extraSources.slice(0, 2).join(' + ')}`;
  }
  return builder;
}

function truncateWordBoundaryPlain(text: string, maxChars: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length <= maxChars) return clean;
  const slice = clean.slice(0, maxChars - 1);
  const lastSpace = slice.lastIndexOf(' ');
  const trimmed = lastSpace >= Math.floor((maxChars - 1) * 0.45) ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.replace(/[,;:\-–—(\s]+$/g, '').trim()}…`;
}

function humanizeDynamicPlainTitle(sig: SpatialSignal): { plainTitle: string; plainFullTitle: string } {
  const relMeta = getSignalReleaseMetadata(sig);
  if (relMeta) {
    return {
      plainTitle: relMeta.displayTitle,
      plainFullTitle: relMeta.displayTitle,
    };
  }

  const cleanTitle = stripOriginPrefixFromHeadline(sig.title, sig.originFeedName);
  if (requiresVerbatimPublisherHeadline(sig)) {
    return {
      plainTitle: truncateWordBoundaryPlain(cleanTitle, 112) || cleanTitle,
      plainFullTitle: truncateWordBoundaryPlain(cleanTitle, 220) || cleanTitle,
    };
  }
  const stripped = enforceZeroJargonL1(cleanTitle);

  if (isHedgedOrUnverifiedClaim(sig)) {
    const hedgedHeadline = cleanTitle.trim() || stripped;
    return {
      plainTitle: truncateWordBoundaryPlain(hedgedHeadline, 64),
      plainFullTitle: truncateWordBoundaryPlain(hedgedHeadline, 112),
    };
  }

  const shortPlain = truncateWordBoundaryPlain(stripped, 48);
  const fullPlain = truncateWordBoundaryPlain(stripped, 96);
  return {
    plainTitle: shortPlain || 'Practical AI Update',
    plainFullTitle: fullPlain || truncateWordBoundaryPlain(cleanTitle, 96),
  };
}

function buildDynamicAnalogy(
  sig: SpatialSignal,
  facts: ExtractedSignalFacts
): { analogy: string; everydayWhy: string } {
  const hay = `${sig.title} ${sig.rawAbstract}`.toLowerCase();
  const groundedClause = facts.leadSentence
    ? ` Specifically, ${enforceZeroJargonL1(truncateAtWordBoundary(facts.leadSentence, 300))}`
    : '';

  if (isHedgedOrUnverifiedClaim(sig)) {
    return {
      analogy: enforceZeroJargonL1(
        `Think of an unverified early announcement at a scientific conference — before anyone treats a dramatic claim as settled fact, independent researchers still need to check every step on paper.${groundedClause}`
      ),
      everydayWhy: enforceZeroJargonL1(
        'Unverified claims remain tentative until independent domain experts reproduce or confirm the evidence.'
      ),
    };
  }

  if (isNonToolNewsOrMarketSignal(sig)) {
    return {
      analogy: enforceZeroJargonL1(
        `Think of a major company filing financial or policy paperwork — it shapes budgets, governance, and industry expectations rather than releasing a new software tool.${groundedClause}`
      ),
      everydayWhy: enforceZeroJargonL1(
        'Business, funding, and policy shifts change vendor stability, pricing leverage, and compliance rules even when no new engineering software ships.'
      ),
    };
  }

  if (/\b(healthcare|clinical|hospital|patient|medical|doctor|nurse|care)\b/.test(hay)) {
    return {
      analogy: enforceZeroJargonL1(
        `Picture giving an overworked hospital care team a dedicated chart organizer who prepares patient summaries, referral notes, and follow-up checklists behind the scenes while keeping privacy-protected records locked safely inside the clinic.${groundedClause}`
      ),
      everydayWhy: enforceZeroJargonL1(
        'Doctors, nurses, and care coordinators spend less time buried in administrative paperwork and more time focused directly on patients.'
      ),
    };
  }
  if (/\b(code|coding|developer|repo|git|compiler|ide|debug|software|terminal)\b/.test(hay)) {
    return {
      analogy: enforceZeroJargonL1(
        `Think of a master carpenter having an attentive apprentice who lays out blueprints, measures every board twice, and checks that cabinet doors close cleanly before anything is nailed down.${groundedClause}`
      ),
      everydayWhy: enforceZeroJargonL1(
        'Software teams ship bug fixes and useful new features faster with fewer broken updates.'
      ),
    };
  }
  if (sig.primarySector === 'ECO' || sig.finOps === 'REDUCER') {
    const costSafeWhy = hasLatencyOrThroughputWithoutCost(sig)
      ? 'Digital tools can respond faster when tasks queue less often, though real savings depend on workload patterns.'
      : 'Digital tools respond faster and cost noticeably less to run for everyday users and organizations.';
    return {
      analogy: enforceZeroJargonL1(
        `Think of switching a building from hot, power-hungry halogen bulbs to modern LED lighting—you get the same bright workspace while using a fraction of the electricity.${groundedClause}`
      ),
      everydayWhy: enforceZeroJargonL1(costSafeWhy),
    };
  }
  if (sig.primarySector === 'GOV' || sig.risk === 'HIGH') {
    return {
      analogy: enforceZeroJargonL1(
        `Picture a hospital or airport safety checkpoint with tamper-proof ID badges and a clear visitor logbook before anyone enters restricted rooms.${groundedClause}`
      ),
      everydayWhy: enforceZeroJargonL1(
        'Personal data, private records, and workplace accounts stay protected as automated software takes on bigger tasks.'
      ),
    };
  }
  if (sig.primarySector === 'SCI') {
    return {
      analogy: enforceZeroJargonL1(
        `Imagine a test kitchen testing a new cooking method side-by-side and publishing the exact measurements so every chef can reproduce the improvement reliably.${groundedClause}`
      ),
      everydayWhy: enforceZeroJargonL1(
        'Peer-tested research findings translate into more accurate, dependable everyday software.'
      ),
    };
  }
  return {
    analogy: enforceZeroJargonL1(
      `Imagine having an organized research librarian who reads through long folders of notes in seconds and hands back a clear, structured checklist ready for action.${groundedClause}`
    ),
    everydayWhy: enforceZeroJargonL1(
      facts.detailSentence
        ? truncateAtWordBoundary(facts.detailSentence, 220)
        : 'Routine reading, coordination, and problem-solving work finishes faster with higher consistency.'
    ),
  };
}

export function selectRelevantGlossary(sig: SpatialSignal): GlossaryTerm[] {
  if (!hasTechnicalEngineeringContent(sig) && !isEvaluationQualityStudy(sig)) {
    return [];
  }

  const hay = `${sig.title} ${sig.rawAbstract}`;
  const matched: GlossaryTerm[] = [];

  for (const item of MASTER_GLOSSARY_BANK) {
    if (item.triggers.some((rx) => rx.test(hay))) {
      matched.push({ term: item.term, definition: item.definition });
    }
    if (matched.length >= 5) break;
  }

  return matched.slice(0, 5);
}

/**
 * Generates and caches all 5 AI Literacy Levels + plainTitle + glossary[] synchronously (<0.4ms)
 * so scrubbing 1 -> 5 inside any orb hologram has zero latency and zero loading spinners.
 */
function truncateCleanly(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const sliced = trimmed.slice(0, maxChars);
  const lastPeriod = Math.max(sliced.lastIndexOf('. '), sliced.lastIndexOf('! '), sliced.lastIndexOf('? '));
  if (lastPeriod >= Math.floor(maxChars * 0.45)) {
    return sliced.slice(0, lastPeriod + 1).trim();
  }
  return `${sliced.replace(/\s+\S*$/, '').replace(/[,;:-]+$/, '')}.`;
}

/**
 * Cuts strictly on full sentence boundaries (/\.\s+/) and strips incomplete trailing clauses.
 */
function truncateOnSentenceBoundary(text: string, maxChars: number): string {
  const cleaned = stripTrailingIncompleteClause(text);
  if (!cleaned) return '';
  if (cleaned.length <= maxChars) return cleaned;

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /[.!?]["')\]]*$/.test(s));

  let acc = '';
  for (const sent of sentences) {
    const candidate = acc ? `${acc} ${sent}` : sent;
    if (candidate.length <= maxChars) {
      acc = candidate;
    } else {
      break;
    }
  }
  if (acc.length >= 45) return acc;
  return stripTrailingIncompleteClause(cleaned.slice(0, maxChars));
}

/**
 * Infers real, domain-accurate enterprise stack surfaces from signal content,
 * replacing cryptic internal 3-letter enum badges ("REL Core", "ECO Layer", "GOV", "INN").
 */
export function inferDomainEnterpriseStacks(sig: {
  title: string;
  rawAbstract?: string;
  url?: string;
  primarySector?: string;
  affectedEnterpriseStacks?: string[];
}): string[] {
  const existing = (sig.affectedEnterpriseStacks || []).filter(
    (s) =>
      !/\b(REL|SCI|ARC|INN|GOV|CRT|ECO|MKT)\s+(?:Core|Layer|Pipeline)\b/i.test(s) &&
      !/^(REL|SCI|ARC|INN|GOV|CRT|ECO|MKT)$/i.test(s.trim())
  );
  if (existing.length >= 2) return existing.slice(0, 4);

  const hay = `${sig.title} ${sig.rawAbstract || ''} ${sig.url || ''}`.toLowerCase();
  const stacks: string[] = [];
  const pushUnique = (label: string) => {
    if (!stacks.includes(label) && stacks.length < 4) stacks.push(label);
  };

  if (/\b(diffusion|image|vision|video|flow matching|dual flow|pixel|3d|gaussian splat|multimodal|render|audio|speech|tts)\b/.test(hay)) {
    pushUnique('Computer Vision & Diffusion');
    pushUnique('Multimodal Generation');
  }
  if (/\b(vllm|ollama|sglang|llama\.cpp|kv[-\s]?cache|fp8|int4|quantiz|cuda|triton|kernel|prefill|decode|disagg|serving|throughput)\b/.test(hay)) {
    pushUnique('LLM Serving & vLLM');
    pushUnique('GPU Kernel & Inference Infra');
  }
  if (/\b(mcp|model context protocol|agent|tool[-\s]?use|orchestrat|langgraph|langchain|browser[-\s]?use|computer[-\s]?use)\b/.test(hay)) {
    pushUnique('Agent Tooling / MCP');
    pushUnique('Autonomous Workflow Runtime');
  }
  if (/\b(rag|graphrag|retriev|embedding|pgvector|vector|knowledge graph|rerank|bm25)\b/.test(hay)) {
    pushUnique('RAG & Vector Storage');
  }
  if (/\b(claude[-\s]?code|codex|cursor|swe-bench|compiler|ide|git|repository|refactor|unit test|codegen)\b/.test(hay)) {
    pushUnique('AI Software Engineering & IDE');
  }
  if (/\b(health|clinical|hospital|patient|medical|ehr|hipaa|biotech|protein|radiology)\b/.test(hay)) {
    pushUnique('Clinical & Healthcare AI');
    if (/\bhipaa\b/.test(hay)) {
      pushUnique('HIPAA Privacy & Audit');
    } else {
      pushUnique('Clinical Privacy & Audit');
    }
  }
  if (/\b(security|vulnerab|injection|poison|oauth|rbac|pkce|iso\s*42001|eu ai act|compliance|audit|guardrail|privacy|red[-\s]?team)\b/.test(hay)) {
    pushUnique('AI Governance & Audit');
    pushUnique('Zero-Trust Agent Security');
  }
  if (/\b(rlhf|grpo|dpo|q?lora|peft|fine[-\s]?tun|post[-\s]?train|pretrain|dataset|benchmark|ablation|reasoning|math|theorem)\b/.test(hay)) {
    pushUnique('Post-Training & EvalOps');
  }
  if (/\b(pricing|cost|finops|batch|tpu|asic|h100|h200|b200|silicon|datacenter|gigawatt)\b/.test(hay)) {
    pushUnique('AI FinOps & Compute Routing');
  }

  if (stacks.length === 0) {
    if (sig.primarySector === 'SCI') {
      pushUnique('ML Research & Architecture');
      pushUnique('Model Evaluation & Benchmarks');
    } else if (sig.primarySector === 'GOV') {
      pushUnique('AI Governance & Audit');
      pushUnique('Enterprise Policy Guardrails');
    } else if (sig.primarySector === 'ECO') {
      pushUnique('LLM Serving & FinOps');
      pushUnique('Inference Cost Optimization');
    } else {
      pushUnique('Enterprise AI Application Layer');
      pushUnique('Model Gateway & EvalOps');
    }
  } else if (stacks.length === 1) {
    pushUnique('Model Evaluation & Telemetry');
  }

  return stacks;
}

/**
 * Builds strictly disjoint L5 sections (architectureBrief vs specsAndCaveats) so the same sentence
 * is NEVER duplicated across two L5 blocks, and trailing incomplete fragments are stripped.
 */
function buildDisjointL5Sections(
  sig: SpatialSignal,
  cleanHeadline: string
): { architectureBrief: string; specsAndCaveats: string } {
  const cleanBody = stripTrailingIncompleteClause(sig.rawAbstract || '');
  const completeSentences = cleanBody
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 24 && /[.!?]["')\]]*$/.test(s));

  if (!hasTechnicalEngineeringContent(sig) && !isEvaluationQualityStudy(sig)) {
    const isHedged = isHedgedOrUnverifiedClaim(sig);
    const factualSummary =
      completeSentences.length > 0
        ? truncateOnSentenceBoundary(completeSentences.slice(0, 2).join(' '), 500)
        : stripTrailingIncompleteClause(cleanHeadline);
    const noTechPrefix = 'Source provides no technical specifications or architecture details.';
    const architectureBrief = factualSummary
      ? `${noTechPrefix} ${factualSummary}`
      : noTechPrefix;
    const specsAndCaveats = isHedged
      ? `Unverified claim from ${sig.originFeedName || sig.source} — no reproducible benchmarks, proof artifacts, or technical specifications accompany this post.`
      : `Non-engineering business, policy, or commentary signal (${sig.originFeedName || sig.source}) — no model weights, API specs, latency figures, or code parameters were published.`;
    return { architectureBrief, specsAndCaveats };
  }

  if (sig.modelSpecs) {
    const s = sig.modelSpecs;
    const specStr = `${s.modelFamily} (${s.license}) · $${s.inputCostPer1M.toFixed(2)}/$${s.outputCostPer1M.toFixed(2)} per 1M tok (cached $${s.cachedCostPer1M.toFixed(2)}) · ${s.contextWindowK}K ctx · ${s.ttftMs}ms TTFT · ${s.tokensPerSec} tok/s${
      s.sweBenchVerified > 0 ? ` · SWE-bench Verified ${s.sweBenchVerified}%` : ''
    }.`;
    return {
      architectureBrief:
        truncateOnSentenceBoundary(cleanBody, 620) ||
        stripTrailingIncompleteClause(cleanHeadline),
      specsAndCaveats: specStr,
    };
  }

  const usedNorm = new Set<string>();
  let archSentences: string[] = [];
  let specSentences: string[] = [];

  if (completeSentences.length >= 3) {
    const splitIdx = Math.max(1, Math.ceil(completeSentences.length * 0.55));
    archSentences = completeSentences.slice(0, splitIdx);
    for (const s of archSentences) usedNorm.add(s.toLowerCase());

    const remaining = completeSentences.filter((s) => !usedNorm.has(s.toLowerCase()));
    const metricOrLimitHits = remaining.filter((s) =>
      /(?<![\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s*%|\s*x|\s*ms|\s*gb|\s*b\b|\s*m\b|\s*k\b|\s*(?:prompt\s+|output\s+|input\s+|generation\s+)?(?:tokens?\/s|tok\/s|tokens\s+per\s+second|tokens))|\b(?:fid|psnr|ssim|mmlu|gpqa|swe-bench|dataset|benchmark|fail\w*|limit\w*|skip\w*|caveat|hallucin\w*|error|latency|vram|lora|fp8|int4|release|v\d+\.\d+)\b/i.test(
        s
      )
    );
    specSentences = (metricOrLimitHits.length > 0 ? metricOrLimitHits : remaining).slice(0, 2);
  } else if (completeSentences.length === 2) {
    archSentences = [completeSentences[0]];
    usedNorm.add(completeSentences[0].toLowerCase());
    specSentences = [completeSentences[1]];
  } else if (completeSentences.length === 1) {
    archSentences = [completeSentences[0]];
    usedNorm.add(completeSentences[0].toLowerCase());
    specSentences = [];
  }

  const architectureBrief =
    archSentences.length > 0
      ? truncateOnSentenceBoundary(archSentences.join(' '), 580)
      : stripTrailingIncompleteClause(cleanHeadline);

  let specsAndCaveats = '';
  const allMetrics = extractSourceVerifiedMetrics(sig);
  if (isEvaluationQualityStudy(sig)) {
    const evalSummary =
      allMetrics.length > 0
        ? allMetrics
            .map((m) =>
              m.subject ? `${m.subject} ${m.value} (${m.label})` : `${m.label}: ${m.value}`
            )
            .join(' · ')
        : 'Quality, citation relevance, and grading-criteria evaluation without latency telemetry';
    specsAndCaveats =
      specSentences.length > 0
        ? `${truncateOnSentenceBoundary(specSentences.join(' '), 300)} (${evalSummary}).`
        : `Evaluation methodology (${sig.originFeedName || sig.source}): ${evalSummary}. Open linked study for full task grading rubric.`;
  } else if (specSentences.length > 0) {
    specsAndCaveats = truncateOnSentenceBoundary(specSentences.join(' '), 360);
    const hasPairedCondOrComma = allMetrics.some(
      (m) => Boolean(m.condition) || /\d{1,3},\d{3}/.test(m.value)
    );
    if (hasPairedCondOrComma) {
      const clause = formatMetricsComparisonClause(allMetrics);
      if (clause && allMetrics[0] && !specsAndCaveats.toLowerCase().includes(allMetrics[0].value.toLowerCase())) {
        specsAndCaveats = `${specsAndCaveats.replace(/[.]+$/, '')} (${clause}).`;
      }
    }
  } else {
    const relMeta = getSignalReleaseMetadata(sig);
    if (relMeta) {
      specsAndCaveats = `GitHub ${relMeta.stabilityLabel.toLowerCase()} (${relMeta.owner}/${relMeta.repo} · ${relMeta.versionLabel}). Check release notes upstream for full changelog and breaking-change flags.`;
    } else {
      const isCommunityPost =
        sig.source === 'Reddit' ||
        sig.source === 'HackerNews' ||
        sig.source === 'Bluesky' ||
        sig.source === 'Discord';
      if (isCommunityPost) {
        const threadStats = sig.engagementVelocity?.badgeText
          ? ` (${sig.engagementVelocity.badgeText})`
          : '';
        specsAndCaveats = `Community field report on ${sig.originFeedName || sig.source}${threadStats} — single-run observation without controlled multi-seed benchmark tables; check linked sources for independent reproduction.`;
      } else {
        const domainTag =
          sig.source === 'arXiv'
            ? 'arXiv preprint'
            : sig.source === 'HuggingFace'
            ? 'Hugging Face paper'
            : sig.source === 'GitHub'
            ? 'GitHub open-source repository'
            : sig.originFeedName || sig.source;
        specsAndCaveats = `Source artifact: ${domainTag} (${
          sig.readiness === 'RESEARCH' ? 'Research Preprint' : sig.readiness
        }). Refer to the upstream link for full artifacts and methodology.`;
      }
    }
  }

  return { architectureBrief, specsAndCaveats };
}

function formatMetricsComparisonClause(metrics: VerifiedSourceMetric[]): string {
  if (!metrics || metrics.length === 0) return '';
  const condMetrics = metrics.filter((m) => Boolean(m.condition));
  if (condMetrics.length > 0) {
    const primaryCondition =
      condMetrics.find((m) => m.isFeatured === true)?.condition || condMetrics[0].condition!;
    const matchingCond = condMetrics.filter((m) => m.condition === primaryCondition);
    const feat = matchingCond.find((m) => m.isFeatured === true) || matchingCond[0];
    const base = matchingCond.find((m) => m.isFeatured === false && m !== feat);
    const featPart = feat.subject ? `${feat.subject} ${feat.value}` : feat.value;
    if (base) {
      const basePart = base.subject ? `${base.subject} ${base.value}` : base.value;
      return `At ${primaryCondition}: ${featPart} vs. ${basePart}`;
    }
    return `At ${primaryCondition}: ${featPart}`;
  }

  const topTwo = metrics.slice(0, 2);
  if (topTwo.length === 2) {
    const p1 = topTwo[0].subject ? `${topTwo[0].subject}: ${topTwo[0].value}` : topTwo[0].value;
    const p2 = topTwo[1].subject ? `${topTwo[1].subject}: ${topTwo[1].value}` : topTwo[1].value;
    return `${p1} vs. ${p2}`;
  }
  const single = topTwo[0];
  return single.subject ? `${single.subject}: ${single.value}` : `${single.label}: ${single.value}`;
}

export function buildNoReleaseNotesPayload(
  sig: SpatialSignal
): LiteracySpectrumPayload {
  const relMeta = getSignalReleaseMetadata(sig);
  const displayHeadline = relMeta
    ? `${relMeta.displayTitle} · ${relMeta.stabilityLabel}`
    : stripOriginPrefixFromHeadline(sig.title, sig.originFeedName);
  const shortTitle = relMeta ? relMeta.displayTitle : truncateWordBoundaryPlain(displayHeadline, 48);
  const ownerProject = relMeta ? `${relMeta.owner}/${relMeta.repo}` : sig.originFeedName || sig.source;

  return {
    plainTitle: shortTitle,
    plainFullTitle: displayHeadline,
    levels: {
      1: {
        analogy: `${NO_RELEASE_NOTES_NOTICE}.`,
        everydayWhy: `${displayHeadline} (${ownerProject}) published a new ${
          relMeta ? relMeta.stabilityLabel.toLowerCase() : 'release tag'
        }; open the upstream release link for full details.`,
      },
      2: {
        whatHappened: `${displayHeadline} was published on GitHub (${ownerProject}). ${NO_RELEASE_NOTES_NOTICE}.`,
        whoBuiltIt: ownerProject,
        problemSolved: NO_RELEASE_NOTES_NOTICE,
      },
      3: {
        bridgeSummary: `${displayHeadline} (${ownerProject}). ${NO_RELEASE_NOTES_NOTICE}.`,
      },
      4: {
        roiAndFinOps: `${NO_RELEASE_NOTES_NOTICE}.`,
        readinessAndRisk: relMeta
          ? `${relMeta.stabilityLabel} (${relMeta.isPreRelease ? 'pre-release channel' : 'tagged release'}) — inspect upstream notes before upgrading.`
          : NO_RELEASE_NOTES_NOTICE,
        clientAdvice: `Review the linked upstream release (${shortTitle}) directly before scheduling updates.`,
      },
      5: {
        architectureBrief: `${displayHeadline} (${ownerProject}). ${NO_RELEASE_NOTES_NOTICE}.`,
        specsAndCaveats: NO_RELEASE_NOTES_NOTICE,
        streetConsensus: NO_RELEASE_NOTES_NOTICE,
      },
    },
    glossary: [],
    generatedBy: 'DETERMINISTIC',
  };
}

export function buildDeterministicLiteracyPayload(
  sig: SpatialSignal,
  activeClient: ClientIndustry = 'BANKING'
): LiteracySpectrumPayload {
  if (isReleaseWithoutNotes(sig)) {
    return buildNoReleaseNotesPayload(sig);
  }

  const seedOverride = SEED_PLAIN_OVERRIDES[sig.id];
  const facts = extractSignalFacts(sig);
  const dynamicTitles = seedOverride
    ? { plainTitle: seedOverride.plainTitle, plainFullTitle: seedOverride.plainFullTitle }
    : humanizeDynamicPlainTitle(sig);

  const l1Raw = seedOverride
    ? { analogy: seedOverride.analogy, everydayWhy: seedOverride.everydayWhy }
    : buildDynamicAnalogy(sig, facts);

  // Enforce strict Zero-Jargon rule on L1
  const l1 = {
    analogy: enforceZeroJargonL1(l1Raw.analogy),
    everydayWhy: enforceZeroJargonL1(l1Raw.everydayWhy),
  };

  const resolvedBuilder = seedOverride?.whoBuiltIt || resolveBuilderIdentity(sig);
  const realCommunityQuotes = (sig.streetQuotes || []).filter(
    (q) => !q.id.endsWith('-self-quote') && q.author !== sig.originFeedName
  );

  const usedDetailInWhatHappened = Boolean(
    facts.hasRichBody &&
      facts.detailSentence &&
      `${facts.leadSentence} ${facts.detailSentence}`.length <= 360
  );

  // Concrete, non-tautological L2 grounded in extracted article paragraphs / engineer quotes
  const dynamicWhatHappened = facts.hasRichBody
    ? usedDetailInWhatHappened
      ? truncateCleanly(`${facts.leadSentence} ${facts.detailSentence}`, 360)
      : truncateCleanly(facts.leadSentence, 340)
    : realCommunityQuotes[0]
    ? `Community discussion around "${facts.cleanHeadline}" — top comment (${realCommunityQuotes[0].author}): "${truncateCleanly(realCommunityQuotes[0].text, 220)}"`
    : `${resolvedBuilder} published "${facts.cleanHeadline}". Open the linked third-party source above for the full upstream breakdown.`;

  const isTechnical = hasTechnicalEngineeringContent(sig);
  const isHedged = isHedgedOrUnverifiedClaim(sig);
  const isNonTool = isNonToolNewsOrMarketSignal(sig);
  const relMeta = getSignalReleaseMetadata(sig);

  const dynamicProblemSolved = (() => {
    if (isHedged) {
      return `Explores an unverified claim or open question around "${truncateCleanly(
        facts.cleanHeadline,
        115
      )}" — awaiting independent verification.`;
    }
    if (isNonTool) {
      return facts.detailSentence && !usedDetailInWhatHappened
        ? truncateCleanly(facts.detailSentence, 280)
        : `Shapes vendor governance, funding expectations, or enterprise buying decisions around "${truncateCleanly(
            facts.cleanHeadline,
            100
          )}" rather than shipping a software tool.`;
    }
    if (
      facts.workflowSentence &&
      facts.workflowSentence !== facts.leadSentence &&
      (!usedDetailInWhatHappened || facts.workflowSentence !== facts.detailSentence)
    ) {
      return truncateCleanly(facts.workflowSentence, 300);
    }
    if (
      facts.quantSentence &&
      facts.quantSentence !== facts.leadSentence &&
      (!usedDetailInWhatHappened || facts.quantSentence !== facts.detailSentence)
    ) {
      return truncateCleanly(facts.quantSentence, 300);
    }
    const hay = `${sig.title} ${sig.rawAbstract}`.toLowerCase();
    if (/\b(healthcare|clinical|hospital|patient|medical|care)\b/.test(hay)) {
      return 'Reduces clinical documentation, chart synthesis, and administrative coordination overhead inside governed clinical care workflows.';
    }
    if (/\b(code|coding|repo|git|cli|ide|agent|mcp)\b/.test(hay)) {
      return 'Eliminates manual context switching and bespoke glue scripts across multi-file repositories and external developer tools.';
    }
    if (sig.finOps === 'REDUCER') {
      return 'Cuts inference compute overhead and tail latency on production workloads without sacrificing task accuracy.';
    }
    if (sig.primarySector === 'GOV') {
      return 'Addresses auditability, policy enforcement, and data-boundary risks before automated workflows touch regulated systems.';
    }
    if (sig.source === 'arXiv' || sig.source === 'HuggingFace') {
      return 'Provides reproducible empirical benchmarks and architectural methods that downstream engineering teams can evaluate against current baselines.';
    }
    return facts.detailSentence && !usedDetailInWhatHappened
      ? truncateCleanly(facts.detailSentence, 280)
      : `Addresses practical workflow friction around ${truncateCleanly(facts.cleanHeadline, 95)}.`;
  })();

  const l2 = seedOverride
    ? {
        whatHappened: simplifyPlainEnglishL2(seedOverride.whatHappened),
        whoBuiltIt: simplifyPlainEnglishL2(seedOverride.whoBuiltIt),
        problemSolved: simplifyPlainEnglishL2(seedOverride.problemSolved),
      }
    : {
        whatHappened: simplifyPlainEnglishL2(dynamicWhatHappened),
        whoBuiltIt: simplifyPlainEnglishL2(resolvedBuilder),
        problemSolved: simplifyPlainEnglishL2(dynamicProblemSolved),
      };

  const glossary = selectRelevantGlossary(sig);
  const glossaryMentionList = glossary.map((g) => g.term).join(', ');

  const coreMechanismSummary = facts.hasRichBody
    ? truncateAtWordBoundary(`${facts.leadSentence}${facts.detailSentence ? ` ${facts.detailSentence}` : ''}`, 380)
    : isTechnical
    ? sig.architectBrief.summary
    : `${resolvedBuilder} shared: "${facts.cleanHeadline}".`;

  // Guarantee every glossary term appears verbatim inside L3 bridgeSummary only when technical
  const missingTerms = glossary
    .map((g) => g.term)
    .filter((t) => !coreMechanismSummary.toLowerCase().includes(t.toLowerCase()));

  const l3Bridge = !isTechnical
    ? isHedged
      ? `Unverified claim reported by ${sig.originFeedName || sig.source}: ${coreMechanismSummary} No technical specifications, APIs, or reproducible proofs have been independently confirmed.`
      : `${coreMechanismSummary} Non-technical market/policy update — no developer SDKs, model parameters, or software architecture specs are included in the source.`
    : `${coreMechanismSummary} ` +
      (missingTerms.length > 0
        ? `In stack terms, this connects to ${glossaryMentionList} (${sig.architectBrief.integrationPattern})`
        : `Stack integration: ${sig.architectBrief.integrationPattern}`);

  const scope = classifyEvidenceScope(sig);
  const clientMeta = CLIENT_INDUSTRIES.find((c) => c.id === activeClient) || CLIENT_INDUSTRIES[0];
  const sourceHasCompliance = hasSourceComplianceAssessment(sig);
  const defaultComplianceStatus =
    scope === 'research_paper' || isEvaluationQualityStudy(sig)
      ? COMPLIANCE_NOT_ASSESSED_STUDY
      : COMPLIANCE_NOT_ASSESSED_SOURCE;
  const complianceClause = sourceHasCompliance
    ? 'Compliance: Verification details cited in source — confirm upstream.'
    : `Compliance: ${defaultComplianceStatus}.`;

  const readinessLabel = relMeta
    ? relMeta.isPreRelease
      ? `${relMeta.stabilityLabel} (pre-release channel — test in non-production environments)`
      : 'Stable Release (pin explicit version tags and review upstream changelog)'
    : isHedged
    ? 'Unverified External Report (wait for independent expert verification)'
    : scope === 'discussion_or_personal'
    ? 'Community / Personal Discussion Thread (no software artifact or enterprise rollout implied)'
    : isNonTool
    ? 'Market & Policy Signal (no software artifact to deploy)'
    : scope === 'single_user_experiment'
    ? 'Single-User / Local Hardware Experiment (reproduce locally before team reliance)'
    : sig.readiness === 'RESEARCH'
    ? 'R&D Research Horizon (evaluate in isolated benchmark harness before committing SLAs)'
    : sig.readiness === 'PREVIEW'
    ? 'Public Preview (sandbox & non-critical canary workloads only)'
    : 'General release reported by source';

  const noCostEvidence = hasLatencyOrThroughputWithoutCost(sig);
  const l4 =
    scope === 'discussion_or_personal' && !isHedged
      ? {
          roiAndFinOps: `Personal or community discussion (${sig.originFeedName || sig.source}) — no software ROI, infrastructure cost projection, or technical benchmark applies.`,
          readinessAndRisk: `${readinessLabel} — read the linked thread directly rather than treating it as an engineering or financial specification. ${complianceClause}`,
          clientAdvice: `Read the original discussion directly on ${sig.originFeedName || sig.source} for first-hand human context.`,
        }
      : scope === 'single_user_experiment'
      ? {
          roiAndFinOps: `${facts.leadSentence || facts.cleanHeadline} (Individual benchmark/project — no enterprise unit-cost projection).`,
          readinessAndRisk: `${readinessLabel} · Independent multi-hardware verification not yet established. ${complianceClause}`,
          clientAdvice:
            'If this offline or local workflow matches a need on your team, reproduce the run on target hardware and measure latency and accuracy directly.',
        }
      : !isTechnical
      ? {
          roiAndFinOps: isHedged
            ? `Unverified claim — do not base roadmap, procurement, or budget decisions on unconfirmed reports. ${facts.leadSentence || facts.cleanHeadline}`
            : `${facts.leadSentence || facts.cleanHeadline} (Operational/market development — no direct token-cost or compute telemetry in source).`,
          readinessAndRisk: `${readinessLabel} · ${sig.risk} Governance Attention. ${complianceClause}`,
          clientAdvice: isHedged
            ? `For ${clientMeta.label}: monitor for independent verification before citing or acting on "${truncateWordBoundaryPlain(facts.cleanHeadline, 72)}".`
            : `For ${clientMeta.label}: track vendor, regulatory, and counterparty implications of "${truncateWordBoundaryPlain(facts.cleanHeadline, 72)}" with legal and procurement leads.`,
        }
      : noCostEvidence
      ? {
          roiAndFinOps: `${facts.quantSentence || facts.leadSentence || sig.cSuiteBrief.headlineSoWhat} Latency and throughput gains do not establish end-to-end cost savings — ask: What happens to cost per completed request on your workload?`,
          readinessAndRisk: `${readinessLabel} · ${sig.risk} Governance Attention. ${complianceClause}`,
          clientAdvice:
            'Before assuming infrastructure savings, test on representative traffic and ask: What happens to cost per completed request on your workload?',
        }
      : {
          roiAndFinOps: facts.quantSentence
            ? `${facts.quantSentence} (${sig.architectBrief.latencyAndCostNote})`
            : `${facts.leadSentence || sig.cSuiteBrief.headlineSoWhat} (${sig.architectBrief.latencyAndCostNote})`,
          readinessAndRisk: `${readinessLabel} · ${sig.risk} Governance Attention. ${complianceClause}`,
          clientAdvice:
            sig.cSuiteBrief.industryLens[activeClient] ||
            `For ${clientMeta.label}: evaluate "${truncateAtWordBoundary(facts.cleanHeadline, 68)}" with domain benchmarks before broad adoption.`,
        };

  const disjointL5 = buildDisjointL5Sections(sig, facts.cleanHeadline);

  const topStreetQuotes = realCommunityQuotes
    .slice(0, 3)
    .map((q) => `[${q.originLabel} · ${q.author}, +${q.score}] "${stripTrailingIncompleteClause(q.text)}"`)
    .join(' — ');

  const seedQuotes =
    sig.isDemoSeed && (sig.streetQuotes || []).length > 0
      ? sig.streetQuotes!
          .slice(0, 2)
          .map((q) => `[${q.originLabel} · ${q.author}, +${q.score}] "${q.text}"`)
          .join(' — ')
      : '';

  const upstreamCommentCount = sig.engagementVelocity?.commentsOrReplies ?? 0;
  const honestZeroCommentStatus =
    upstreamCommentCount > 0 && (sig.source === 'Reddit' || sig.source === 'HackerNews')
      ? `Thread has ${upstreamCommentCount} ${
          upstreamCommentCount === 1 ? 'reply' : 'replies'
        } on ${sig.originFeedName || sig.source} — loading top engineer comments...`
      : sig.source === 'arXiv' || sig.source === 'HuggingFace'
      ? 'Awaiting peer replication (newly indexed paper/release)'
      : sig.source === 'GHRelease' || sig.source === 'GitHub'
      ? 'Awaiting community benchmark runs (newly indexed repository release)'
      : isHedged
      ? 'Awaiting independent expert verification (unconfirmed upstream post)'
      : 'Awaiting independent coverage confirmation (newly indexed publication)';

  const l5 = {
    architectureBrief: disjointL5.architectureBrief,
    specsAndCaveats: disjointL5.specsAndCaveats,
    streetConsensus: topStreetQuotes || seedQuotes || honestZeroCommentStatus,
  };

  return enforceEpistemicAndDomainFidelity(
    sig,
    {
      plainTitle: dynamicTitles.plainTitle,
      plainFullTitle: dynamicTitles.plainFullTitle,
      levels: {
        1: l1,
        2: l2,
        3: { bridgeSummary: l3Bridge },
        4: l4,
        5: l5,
      },
      glossary,
      generatedBy: 'DETERMINISTIC',
    },
    activeClient,
    true
  );
}

const HEDGE_MARKER_REGEX =
  /\b(may|might|could|claims?|claimed|purports?|reportedly|allegedly|unverified|unconfirmed|rumou?r(?:ed)?|tentative|awaiting|not (?:yet |independently )?verified|potentially|speculat)\b/i;

const ASSERTIVE_SOLVE_REGEX =
  /\b(solves|solved|proves|proved|proven|confirmed|achieves|achieved|breakthrough)\b/i;

const FABRICATED_TECH_SPEC_REGEX =
  /\b(context window|rag|retrieval[- ]augmented|finops cascade|agentic tool use|tokens?\/s|tok\/s|vram|ttft|kv[- ]cache|quantiz\w*|hyperparameters?|fine[- ]tun\w*|mixture of experts|control(?:ling)? trading volume|inference latency|parameter counts?|benchmark tables?|evaluation scripts?|cuda|triton|q?lora|peft|rlhf)\b/gi;

function preserveUncertaintyInProse(text: string): string {
  const cleaned = (text || '').trim();
  if (!cleaned) return cleaned;

  let out = cleaned
    .replace(/\bAI solves\b/gi, 'Unverified claim suggests AI may have solved')
    .replace(
      /(?<!\b(?:may|might|could)\s+have\s+)\b(?:has|was)\s+been\s+solved\b/gi,
      'may have been solved (unverified)'
    )
    .replace(/\bis\s+solved\b/gi, 'may be solved (unverified)')
    .replace(
      /(?<!\b(?:potentially|possibly|reportedly|allegedly)\s+)\bsolving\s+a\b/gi,
      'potentially addressing a'
    )
    .replace(
      /(?<!\b(?:potentially|possibly|reportedly|allegedly)\s+)\bsolving\b/gi,
      'potentially solving'
    )
    .replace(
      /(?<!\b(?:claims?\s+to|purports?\s+to|may|might|could)\s+)\bsolves\b/gi,
      'claims to solve'
    )
    .replace(
      /(?<!\b(?:may|might|could)\s+have\s+been\s+)(?<!\b(?:may|might|could)\s+have\s+)(?<!\b(?:may|might|could)\s+be\s+)(?<!\b(?:reportedly|allegedly|purportedly|potentially)\s+)\bsolved\b/gi,
      'purportedly solved'
    )
    .replace(/(?<!\b(?:reportedly|allegedly|purportedly)\s+)\bproved\b/gi, 'purportedly proved')
    .replace(/(?<!\b(?:claims?\s+to|purports?\s+to)\s+)\bproves\b/gi, 'claims to prove');

  if (!HEDGE_MARKER_REGEX.test(out)) {
    const lowerLead = out.charAt(0).toLowerCase() + out.slice(1);
    out = `Reportedly (unverified): ${lowerLead}`;
  }
  return out;
}

function hasUnbackedHeadlineNumbersOrSuperlatives(
  headline: string,
  sourceHaystackLower: string
): boolean {
  if (!headline) return false;
  if (/\blargest\s+(?:ipo\s+)?in\s+history\b/i.test(headline) && !sourceHaystackLower.includes('largest')) {
    return true;
  }
  const currencyMatches = headline.match(
    /\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:t|trillion|b|billion|m|million)?/gi
  );
  if (!currencyMatches) return false;
  return currencyMatches.some((amt) => !sourceHaystackLower.includes(amt.toLowerCase()));
}

function hasUnbackedTechSpecs(text: string, sourceHaystackLower: string): boolean {
  const matches = (text || '').match(FABRICATED_TECH_SPEC_REGEX);
  if (!matches) return false;
  return matches.some((m) => !sourceHaystackLower.includes(m.toLowerCase()));
}

function scrubBoilerplateArtifacts(text: string): string {
  let out = stripUiChromeBoilerplate(text || '');
  out = out
    .replace(/,?\s*\bthough\s+there\s+were\s+some\s+loading\s+errors\s+reported\.?/gi, '.')
    .replace(/\b(?:there\s+were\s+)?some\s+loading\s+errors\s+reported\.?/gi, '')
    .replace(/\s+\./g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
  return out;
}

function lockBenchmarkFidelityInText(
  text: string,
  bench: BenchmarkClaimSpec,
  appendCanonicalIfIncomplete: boolean
): string {
  let out = scrubBoilerplateArtifacts(text || '');
  if (!out) {
    return appendCanonicalIfIncomplete ? bench.canonicalSentence : out;
  }

  // Normalize metric phrasing so hyphenated "performance-per-watt" becomes consistent "performance per watt"
  if (bench.metric === 'performance per watt') {
    out = out.replace(/\bperformance[- ]per[- ]watt\b|\bperf[- ]per[- ]watt\b/gi, 'performance per watt');
  }

  const escapedMult = bench.multiplier
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/[x×]/gi, '\\s*[x×]');
  const escapedMetric = bench.metric
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');

  // Remove vague adjective insertion like "4.59x better performance per watt" -> "4.59x performance per watt"
  out = out.replace(
    new RegExp(
      `(${escapedMult})\\s+(?:better|faster|higher|more\\s+efficient|improved)\\s+(${escapedMetric})`,
      'gi'
    ),
    '$1 $2'
  );

  // Replace broadened baselines ("than modern CPUs", "compared to leading chips") with exact baseline
  out = out
    .replace(
      /\b(?:of|than|vs\.?|versus|compared\s+to|compared\s+with|over)\s+(?:a\s+|an\s+|the\s+)?(?:modern|current|leading|traditional|standard|existing)\s+(?:[a-z0-9-]+\s+)?(?:cpus?|chips?|processors?|hardware|systems?)\b/gi,
      `compared to ${bench.baseline}`
    )
    .replace(
      /\b(?:modern|current|leading|traditional|standard|existing)\s+(?:cpus?|chips?|processors?|hardware)\b/gi,
      bench.baseline
    );

  // Rewrite unqualified multiplier claims like "4.59x better" / "4.59× faster"
  out = out.replace(
    new RegExp(
      `(${escapedMult})\\s+(?:better|faster|higher|more\\s+efficient|improvements?|gains?)(?!\\s+(?:in\\s+)?${escapedMetric})`,
      'gi'
    ),
    `${bench.multiplier} ${bench.metric}`
  );

  out = out.replace(/\s+/g, ' ').trim();

  if (appendCanonicalIfIncomplete) {
    const low = out.toLowerCase();
    const hasMetric = low.includes(bench.metric.toLowerCase());
    const baselineCoreTokens = bench.baseline
      .toLowerCase()
      .replace(/\b(a|an|the|core|cpu|cpus|system|systems)\b/g, ' ')
      .split(/[\s,()]+/)
      .filter((t) => t.length >= 4);
    const hasBaseline =
      low.includes(bench.baseline.toLowerCase()) ||
      (baselineCoreTokens.length > 0 && baselineCoreTokens.every((tok) => low.includes(tok)));
    const hasAttribution = low.includes(bench.attribution.toLowerCase());

    if (!hasMetric || !hasBaseline || !hasAttribution) {
      const punct = /[.!?]["')\]]*$/.test(out) ? '' : '.';
      out = `${out}${punct} ${bench.canonicalSentence}`.trim();
    }
  }

  return out;
}

function normalizeQuoteMatchCorpus(text: string): string {
  return stripUiChromeBoilerplate(stripHtmlMarkupAndEntities(text || ''))
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Strips quotation marks around any phrase attributed in prose (`"..."` / `“...”`) that does not
 * appear verbatim in the upstream signal title, body, or ingested comments.
 */
export function enforceVerbatimQuotes(text: string, sourceCorpus: string): string {
  if (!text) return text;
  const normCorpus = normalizeQuoteMatchCorpus(sourceCorpus);
  if (!normCorpus) return text.replace(/[“”"]/g, '');

  const normalizedQuotes = text.replace(/[“”]/g, '"');
  return normalizedQuotes.replace(/"([^"\n]{6,220})"/g, (full, inner: string) => {
    const cleanInner = inner.trim();
    const normInner = normalizeQuoteMatchCorpus(cleanInner);
    if (!normInner || normInner.length < 6) return full;
    if (normCorpus.includes(normInner)) {
      return full;
    }
    return cleanInner;
  });
}

function preserveEntitiesAndUnits(
  text: string,
  frozenEntities: string[],
  sigTitle: string
): string {
  if (!text) return text;
  let out = text.replace(/\bwords\s+per\s+second\b/gi, 'tokens per second');
  out = out.replace(
    /((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:tok\/s|t\/s)\s+(prompt|prefill|input|generation|decode|output)\b/gi,
    '$1 $2 tokens/s'
  );
  out = out.replace(/\b(?:tok\/s|t\/s)\b/gi, 'tokens per second');
  const primaryName = frozenEntities[0] || stripOriginPrefixFromHeadline(sigTitle);
  const secondaryName = frozenEntities[1] || primaryName;
  if (/\bcompact ai model\b/i.test(out)) {
    out = out.replace(/\b([Aa])\s+compact ai model\b/g, () => primaryName);
    out = out.replace(/\bcompact ai model\b/gi, primaryName);
  }
  if (/\bcompact scale\b/i.test(out)) {
    out = out.replace(/\b(?:built\s+)?at\s+a\s+compact scale\b/gi, `built on ${secondaryName}`);
    out = out.replace(/\bcompact scale\b/gi, secondaryName);
  }
  return out;
}

/**
 * Post-synthesis epistemic, non-engineering, UI-chrome, entity/unit, quote, and benchmark-lock fidelity gate
 * applied to BOTH baked LLM payloads and runtime deterministic payloads.
 */
export function enforceEpistemicAndDomainFidelity(
  sig: SpatialSignal,
  payload: LiteracySpectrumPayload,
  activeClient: ClientIndustry = 'BANKING',
  skipDeterministicRecursion = false
): LiteracySpectrumPayload {
  // Gate 0: Never generate or retain fabricated AI synthesis for releases with empty or UI-chrome-only text
  if (isReleaseWithoutNotes(sig)) {
    return buildNoReleaseNotesPayload(sig);
  }

  const isHedged = isHedgedOrUnverifiedClaim(sig);
  const isTechnical = hasTechnicalEngineeringContent(sig);
  const isNonTool = isNonToolNewsOrMarketSignal(sig);
  const relMeta = getSignalReleaseMetadata(sig);
  const bench = extractBenchmarkClaimSpec(sig);
  const scope = classifyEvidenceScope(sig);
  const frozenEntities = extractFrozenEntities(sig);
  const evalMetrics = extractSourceVerifiedMetrics(sig);
  const isEvalStudy = isEvaluationQualityStudy(sig);
  const sourceHayLower = `${sig.title || ''} ${sig.rawAbstract || ''}`.toLowerCase();
  const quoteCorpus = [
    sig.title || '',
    sig.rawAbstract || '',
    ...(sig.streetQuotes || []).map((q) => q.text || ''),
  ].join(' ');

  let plainTitle = scrubBoilerplateArtifacts(payload.plainTitle);
  let plainFullTitle = scrubBoilerplateArtifacts(payload.plainFullTitle);
  let l1 = {
    analogy: scrubBoilerplateArtifacts(payload.levels[1].analogy),
    everydayWhy: scrubBoilerplateArtifacts(payload.levels[1].everydayWhy),
  };
  let l2 = {
    whatHappened: scrubBoilerplateArtifacts(payload.levels[2].whatHappened),
    whoBuiltIt: scrubBoilerplateArtifacts(payload.levels[2].whoBuiltIt),
    problemSolved: scrubBoilerplateArtifacts(payload.levels[2].problemSolved),
  };
  let l3 = {
    bridgeSummary: scrubBoilerplateArtifacts(payload.levels[3].bridgeSummary),
  };
  let l4 = {
    roiAndFinOps: scrubBoilerplateArtifacts(payload.levels[4].roiAndFinOps),
    readinessAndRisk: scrubBoilerplateArtifacts(payload.levels[4].readinessAndRisk),
    clientAdvice: scrubBoilerplateArtifacts(payload.levels[4].clientAdvice),
  };
  let l5 = {
    architectureBrief: scrubBoilerplateArtifacts(payload.levels[5].architectureBrief),
    specsAndCaveats: scrubBoilerplateArtifacts(payload.levels[5].specsAndCaveats),
    streetConsensus: scrubBoilerplateArtifacts(payload.levels[5].streetConsensus),
  };
  let glossary = [...(payload.glossary || [])];

  // Gate 0.6: Never flatten frozen model names (Actuator-7B, Qwen2.5-7B) or technical units (tokens per second)
  plainTitle = preserveEntitiesAndUnits(plainTitle, frozenEntities, sig.title);
  plainFullTitle = preserveEntitiesAndUnits(plainFullTitle, frozenEntities, sig.title);
  const titleEntities = extractFrozenEntities({ title: sig.title, rawAbstract: '' });
  for (const ent of titleEntities) {
    if (!plainTitle.toLowerCase().includes(ent.toLowerCase())) {
      const candidate = humanizeDynamicPlainTitle(sig).plainTitle;
      plainTitle = candidate.toLowerCase().includes(ent.toLowerCase())
        ? candidate
        : truncateAtWordBoundary(stripOriginPrefixFromHeadline(sig.title), 72);
    }
    if (!plainFullTitle.toLowerCase().includes(ent.toLowerCase())) {
      const candidateFull = humanizeDynamicPlainTitle(sig).plainFullTitle;
      plainFullTitle = candidateFull.toLowerCase().includes(ent.toLowerCase())
        ? candidateFull
        : truncateAtWordBoundary(stripOriginPrefixFromHeadline(sig.title), 220);
    }
  }
  l1.analogy = preserveEntitiesAndUnits(l1.analogy, frozenEntities, sig.title);
  l1.everydayWhy = preserveEntitiesAndUnits(l1.everydayWhy, frozenEntities, sig.title);
  l2.whatHappened = preserveEntitiesAndUnits(l2.whatHappened, frozenEntities, sig.title);
  l2.whoBuiltIt = preserveEntitiesAndUnits(l2.whoBuiltIt, frozenEntities, sig.title);
  l2.problemSolved = preserveEntitiesAndUnits(l2.problemSolved, frozenEntities, sig.title);
  l3.bridgeSummary = preserveEntitiesAndUnits(l3.bridgeSummary, frozenEntities, sig.title);
  l4.roiAndFinOps = preserveEntitiesAndUnits(l4.roiAndFinOps, frozenEntities, sig.title);
  l4.readinessAndRisk = preserveEntitiesAndUnits(l4.readinessAndRisk, frozenEntities, sig.title);
  l4.clientAdvice = preserveEntitiesAndUnits(l4.clientAdvice, frozenEntities, sig.title);
  l5.architectureBrief = preserveEntitiesAndUnits(l5.architectureBrief, frozenEntities, sig.title);
  l5.specsAndCaveats = preserveEntitiesAndUnits(l5.specsAndCaveats, frozenEntities, sig.title);

  // Define "token" inside L1 prose if present without altering the unit phrase
  if (/\btokens?\b/i.test(l1.analogy) && !/token\s*=/i.test(l1.analogy)) {
    l1.analogy = `${l1.analogy} (token = a unit of text)`;
  } else if (/\btokens?\b/i.test(l1.everydayWhy) && !/token\s*=/i.test(`${l1.analogy} ${l1.everydayWhy}`)) {
    l1.everydayWhy = `${l1.everydayWhy} (token = a unit of text)`;
  }

  // 1. Preserve GitHub product + full version tag + prerelease markers (never drop -rc2 / -alpha.1 or show GA)
  if (relMeta) {
    const hasProductAndVersion = (txt: string) =>
      txt.toLowerCase().includes(relMeta.productName.toLowerCase()) &&
      txt.toLowerCase().includes(relMeta.versionLabel.toLowerCase());
    if (!hasProductAndVersion(plainTitle)) {
      plainTitle = relMeta.displayTitle;
    }
    if (!hasProductAndVersion(plainFullTitle)) {
      plainFullTitle = relMeta.displayTitle;
    }
    if (relMeta.isPreRelease) {
      l4.readinessAndRisk = (l4.readinessAndRisk || '').replace(
        /\bProduction\s+GA\b/gi,
        `${relMeta.stabilityLabel} (Pre-release)`
      );
      l5.specsAndCaveats = (l5.specsAndCaveats || '').replace(
        /\bProduction\s+GA\b|\bGA release\b/gi,
        relMeta.stabilityLabel
      );
    }
  }

  // 2. Block unbacked currency/valuation superlatives fabricated in headlines
  if (hasUnbackedHeadlineNumbersOrSuperlatives(plainTitle, sourceHayLower)) {
    plainTitle = humanizeDynamicPlainTitle(sig).plainTitle;
  }
  if (hasUnbackedHeadlineNumbersOrSuperlatives(plainFullTitle, sourceHayLower)) {
    plainFullTitle = humanizeDynamicPlainTitle(sig).plainFullTitle;
  }

  // 3. Preserve hedged / unverified epistemic qualifiers across titles + ALL 5 lenses
  if (isHedged) {
    const safeHeadline = humanizeDynamicPlainTitle(sig);
    const titleLostHedge = (txt: string) =>
      !HEDGE_MARKER_REGEX.test(txt) ||
      (ASSERTIVE_SOLVE_REGEX.test(txt) && !/\bmay have\b|\bclaims?\b|\breportedly\b|\bunverified\b/i.test(txt));

    if (titleLostHedge(plainTitle)) {
      plainTitle = safeHeadline.plainTitle;
    }
    if (titleLostHedge(plainFullTitle)) {
      plainFullTitle = safeHeadline.plainFullTitle;
    }

    l1 = {
      analogy: preserveUncertaintyInProse(l1.analogy),
      everydayWhy: preserveUncertaintyInProse(l1.everydayWhy),
    };
    l2 = {
      whatHappened: preserveUncertaintyInProse(l2.whatHappened),
      whoBuiltIt: l2.whoBuiltIt,
      problemSolved: preserveUncertaintyInProse(l2.problemSolved),
    };
    l3 = {
      bridgeSummary: preserveUncertaintyInProse(l3.bridgeSummary),
    };
    l4 = {
      ...l4,
      roiAndFinOps: preserveUncertaintyInProse(l4.roiAndFinOps),
      readinessAndRisk: preserveUncertaintyInProse(l4.readinessAndRisk),
      clientAdvice: preserveUncertaintyInProse(l4.clientAdvice),
    };
    l5 = {
      ...l5,
      architectureBrief: preserveUncertaintyInProse(l5.architectureBrief),
      specsAndCaveats: preserveUncertaintyInProse(l5.specsAndCaveats),
    };
  }

  // 4. Block fabricated technical specs / fake glossary pills on non-engineering stories
  const det = skipDeterministicRecursion
    ? null
    : buildDeterministicLiteracyPayload(sig, activeClient);

  // Gate 0.7: Semantic-Invariant Headline & Legal/Conditional Prose Gate
  const cleanPublisherHeadline =
    stripOriginPrefixFromHeadline(sig.title, sig.originFeedName) || sig.title || '';
  const ptValidation = validateHeadlineMeaningPreserved(sig, plainTitle);
  if (!ptValidation.valid || ptValidation.forceVerbatimPublisherFallback) {
    plainTitle =
      truncateAtWordBoundary(cleanPublisherHeadline, 112) || cleanPublisherHeadline;
  }
  const pftValidation = validateHeadlineMeaningPreserved(sig, plainFullTitle);
  if (!pftValidation.valid || pftValidation.forceVerbatimPublisherFallback) {
    plainFullTitle =
      truncateAtWordBoundary(cleanPublisherHeadline, 220) || cleanPublisherHeadline;
  }

  const legalScopeIssue =
    isLegalOrCourtRulingSignal(sig) &&
    !/\b(?:practicing\s+law|practice\s+of\s+law|disbarred)\b/i.test(sourceHayLower);
  if (legalScopeIssue) {
    const fixCourtScope = (t: string) =>
      t
        .replace(
          /\b(?:barred|banned|suspended)\s+from\s+practicing(?:\s+law)?\b/gi,
          'barred from representing litigants before that court'
        )
        .replace(/\bdisbarred\b/gi, 'barred before that court');
    plainTitle = fixCourtScope(plainTitle);
    plainFullTitle = fixCourtScope(plainFullTitle);
    l1 = { analogy: fixCourtScope(l1.analogy), everydayWhy: fixCourtScope(l1.everydayWhy) };
    l2 = {
      whatHappened: fixCourtScope(l2.whatHappened),
      whoBuiltIt: l2.whoBuiltIt,
      problemSolved: fixCourtScope(l2.problemSolved),
    };
    l3 = { bridgeSummary: fixCourtScope(l3.bridgeSummary) };
    l4 = {
      roiAndFinOps: fixCourtScope(l4.roiAndFinOps),
      readinessAndRisk: fixCourtScope(l4.readinessAndRisk),
      clientAdvice: fixCourtScope(l4.clientAdvice),
    };
    l5 = {
      architectureBrief: fixCourtScope(l5.architectureBrief),
      specsAndCaveats: fixCourtScope(l5.specsAndCaveats),
      streetConsensus: fixCourtScope(l5.streetConsensus),
    };
  }

  if (isConditionalPolicyHeadline(sig) && det) {
    const invertedPolicyRegex =
      /\b(?:block|ban)(?:s|ing)?\s+schools\s+from\s+(?:using\s+)?(?:gemini|ai)\b/i;
    if (invertedPolicyRegex.test(`${l1.analogy} ${l1.everydayWhy}`)) {
      l1 = det.levels[1];
    }
    if (invertedPolicyRegex.test(`${l2.whatHappened} ${l2.problemSolved}`)) {
      l2 = det.levels[2];
    }
    if (invertedPolicyRegex.test(l3.bridgeSummary)) {
      l3 = det.levels[3];
    }
  }

  // Gate 0.8: Summary Prose Actor, Action & Scope Guard (preserve specific court/jurisdiction across L1-L5)
  const applySummaryScopeRepair = (txt: string, detFallback?: string): string => {
    if (!txt) return txt;
    const repaired = repairSummaryProseScope(sig, txt);
    const scopeCheck = validateSummaryProseScope(sig, repaired);
    if (!scopeCheck.valid) {
      const legalInst = extractNamedLegalInstitution(sig);
      if (legalInst && !repaired.toLowerCase().includes(legalInst.toLowerCase())) {
        return repairSummaryProseScope(sig, `${repaired} (Ruling by the ${legalInst}.)`);
      }
      if (detFallback) {
        return repairSummaryProseScope(sig, detFallback);
      }
    }
    return repaired;
  };

  l1 = {
    analogy: applySummaryScopeRepair(l1.analogy, det?.levels[1].analogy),
    everydayWhy: applySummaryScopeRepair(l1.everydayWhy, det?.levels[1].everydayWhy),
  };
  l2 = {
    whatHappened: applySummaryScopeRepair(l2.whatHappened, det?.levels[2].whatHappened),
    whoBuiltIt: l2.whoBuiltIt,
    problemSolved: applySummaryScopeRepair(l2.problemSolved, det?.levels[2].problemSolved),
  };
  l3 = {
    bridgeSummary: applySummaryScopeRepair(l3.bridgeSummary, det?.levels[3].bridgeSummary),
  };
  l4 = {
    roiAndFinOps: applySummaryScopeRepair(l4.roiAndFinOps, det?.levels[4].roiAndFinOps),
    readinessAndRisk: applySummaryScopeRepair(l4.readinessAndRisk, det?.levels[4].readinessAndRisk),
    clientAdvice: applySummaryScopeRepair(l4.clientAdvice, det?.levels[4].clientAdvice),
  };
  l5 = {
    architectureBrief: applySummaryScopeRepair(l5.architectureBrief, det?.levels[5].architectureBrief),
    specsAndCaveats: applySummaryScopeRepair(l5.specsAndCaveats, det?.levels[5].specsAndCaveats),
    streetConsensus: applySummaryScopeRepair(l5.streetConsensus, det?.levels[5].streetConsensus),
  };

  if (!isTechnical) {
    glossary = isNonTool
      ? []
      : glossary.filter((g) => sourceHayLower.includes(g.term.toLowerCase()));

    if (det && hasUnbackedTechSpecs(l3.bridgeSummary, sourceHayLower)) {
      l3 = { bridgeSummary: det.levels[3].bridgeSummary };
    }
    if (det && hasUnbackedTechSpecs(l4.roiAndFinOps, sourceHayLower)) {
      l4.roiAndFinOps = det.levels[4].roiAndFinOps;
    }
    if (det && isNonTool && /\baudit(?:ed)? gateway\b|\bRAG\b|\bContext Window\b/i.test(l4.clientAdvice)) {
      l4.clientAdvice = det.levels[4].clientAdvice;
    }
    if (det && hasUnbackedTechSpecs(l5.architectureBrief, sourceHayLower)) {
      l5.architectureBrief = det.levels[5].architectureBrief;
    }
    if (det && hasUnbackedTechSpecs(l5.specsAndCaveats, sourceHayLower)) {
      l5.specsAndCaveats = det.levels[5].specsAndCaveats;
    }

    const noSpecNote = 'Source provides no technical specifications or architecture details.';
    if (!/no technical specifications or architecture details/i.test(l5.architectureBrief || '')) {
      l5.architectureBrief = l5.architectureBrief
        ? `${noSpecNote} ${l5.architectureBrief}`
        : noSpecNote;
    }
  }

  // Gate 4.5: Evaluation-methodology framing (no synthetic latency/TTFT claims on citation/grading studies)
  if (isEvalStudy && evalMetrics.length > 0 && det) {
    const hasMetricRef = evalMetrics.some((m) =>
      l5.specsAndCaveats.toLowerCase().includes(m.value.replace(/^\+/, '').toLowerCase())
    );
    if (!hasMetricRef) {
      l5.specsAndCaveats = det.levels[5].specsAndCaveats;
    }
  }
  if ((sig.streetQuotes || []).length === 0 && /real community engineer replies/i.test(l5.streetConsensus) && det) {
    l5.streetConsensus = det.levels[5].streetConsensus;
  }

  // Gate 4.6: Proportionate L4 framing (discussion/personal, single-user experiments, and uncosted latency claims)
  if (scope === 'discussion_or_personal' && det) {
    const technicalOrEnterpriseLeak =
      /\b(?:financial[- ]services|banking|finserv|threefold|3x|40[–-]65%|35[–-]65%|audited\s+gateway|soc\s*2|hipaa|finra|basel|target hardware|benchmark\s+harness|reproduce\s+(?:the\s+)?(?:run|test|setup)|production\s+ga|canary\s+behind|unit[- ]cost)\b/i;
    if (technicalOrEnterpriseLeak.test(l4.roiAndFinOps) || technicalOrEnterpriseLeak.test(l4.readinessAndRisk) || technicalOrEnterpriseLeak.test(l4.clientAdvice)) {
      l4 = { ...det.levels[4] };
    }
  }
  if (scope === 'single_user_experiment' && det) {
    const inventedEnterprise =
      /\b(?:financial[- ]services|banking|finserv|threefold|3x|40[–-]65%|35[–-]65%|audited\s+gateway|soc\s*2|hipaa|finra|basel)\b/i;
    if (inventedEnterprise.test(l4.roiAndFinOps) && !inventedEnterprise.test(sourceHayLower)) {
      l4.roiAndFinOps = det.levels[4].roiAndFinOps;
    }
    if (inventedEnterprise.test(l4.readinessAndRisk) && !inventedEnterprise.test(sourceHayLower)) {
      l4.readinessAndRisk = det.levels[4].readinessAndRisk;
    }
    if (inventedEnterprise.test(l4.clientAdvice) && !inventedEnterprise.test(sourceHayLower)) {
      l4.clientAdvice = det.levels[4].clientAdvice;
    }
  }
  if (hasLatencyOrThroughputWithoutCost(sig) && det && scope !== 'discussion_or_personal' && scope !== 'single_user_experiment') {
    const unbackedSavingsRegex =
      /\b(?:cost\s+savings?|lower\s+(?:inference\s+)?costs?|compresses\s+inference\s+run-rate|margin\s+upside|cuts?\s+(?:blended\s+)?(?:token\s+)?spend|cheaper\s+to\s+run|35[–-]65%|40[–-]65%|>75%|<0\.92|sub-second)\b/i;
    if (unbackedSavingsRegex.test(l4.roiAndFinOps) || !l4.roiAndFinOps.toLowerCase().includes('cost per completed request')) {
      l4.roiAndFinOps = det.levels[4].roiAndFinOps;
    }
    if (unbackedSavingsRegex.test(l4.clientAdvice) || !l4.clientAdvice.toLowerCase().includes('cost per completed request')) {
      l4.clientAdvice = det.levels[4].clientAdvice;
    }
  }

  // 5. Quantitative Benchmark Lock: keep exact metric + exact comparison baseline + attribution across ALL 5 lenses
  if (bench) {
    plainTitle = lockBenchmarkFidelityInText(plainTitle, bench, false);
    plainFullTitle = lockBenchmarkFidelityInText(plainFullTitle, bench, false);
    l1 = {
      analogy: lockBenchmarkFidelityInText(l1.analogy, bench, false),
      everydayWhy: lockBenchmarkFidelityInText(l1.everydayWhy, bench, true),
    };
    l2 = {
      whatHappened: lockBenchmarkFidelityInText(l2.whatHappened, bench, true),
      whoBuiltIt: scrubBoilerplateArtifacts(l2.whoBuiltIt),
      problemSolved: lockBenchmarkFidelityInText(l2.problemSolved, bench, false),
    };
    l3 = {
      bridgeSummary: lockBenchmarkFidelityInText(l3.bridgeSummary, bench, true),
    };
    l4 = {
      roiAndFinOps: lockBenchmarkFidelityInText(l4.roiAndFinOps, bench, true),
      readinessAndRisk: lockBenchmarkFidelityInText(l4.readinessAndRisk, bench, false),
      clientAdvice: lockBenchmarkFidelityInText(l4.clientAdvice, bench, false),
    };
    l5 = {
      architectureBrief: lockBenchmarkFidelityInText(l5.architectureBrief, bench, false),
      specsAndCaveats: lockBenchmarkFidelityInText(l5.specsAndCaveats, bench, true),
      streetConsensus: scrubBoilerplateArtifacts(l5.streetConsensus),
    };
  }

  // Gate 6: Strict Verbatim Quote Gate across headlines & all 5 lenses
  plainTitle = enforceVerbatimQuotes(plainTitle, quoteCorpus);
  plainFullTitle = enforceVerbatimQuotes(plainFullTitle, quoteCorpus);
  l1 = {
    analogy: enforceVerbatimQuotes(l1.analogy, quoteCorpus),
    everydayWhy: enforceVerbatimQuotes(l1.everydayWhy, quoteCorpus),
  };
  l2 = {
    whatHappened: enforceVerbatimQuotes(l2.whatHappened, quoteCorpus),
    whoBuiltIt: enforceVerbatimQuotes(l2.whoBuiltIt, quoteCorpus),
    problemSolved: enforceVerbatimQuotes(l2.problemSolved, quoteCorpus),
  };
  l3 = {
    bridgeSummary: enforceVerbatimQuotes(l3.bridgeSummary, quoteCorpus),
  };
  l4 = {
    roiAndFinOps: enforceVerbatimQuotes(l4.roiAndFinOps, quoteCorpus),
    readinessAndRisk: enforceVerbatimQuotes(l4.readinessAndRisk, quoteCorpus),
    clientAdvice: enforceVerbatimQuotes(l4.clientAdvice, quoteCorpus),
  };
  l5 = {
    architectureBrief: enforceVerbatimQuotes(l5.architectureBrief, quoteCorpus),
    specsAndCaveats: enforceVerbatimQuotes(l5.specsAndCaveats, quoteCorpus),
    streetConsensus: enforceVerbatimQuotes(l5.streetConsensus, quoteCorpus),
  };

  // Gate 7: Card-Wide Numeric Grounding Audit across ALL lenses (strip any unbacked %, $, x, ms, or <0.92 claims)
  const numericCorpus = [
    sig.title || '',
    sig.rawAbstract || '',
    ...(sig.streetQuotes || []).map((q) => q.text || ''),
    ...(sig.supportingSources || []).map((s) => s.title || ''),
    ...(sig.isDemoSeed && sig.architectBrief?.latencyAndCostNote
      ? [sig.architectBrief.latencyAndCostNote]
      : []),
  ].join(' ');

  const auditFieldNumbers = (txt: string, fallbackText?: string): string => {
    if (!txt) return txt;
    // Step 7a: Auto-repair truncated fragments of comma-formatted source numbers (e.g., "245" -> "2,245", "31" -> "31,477")
    const repairedStep = repairTruncatedCommaNumbers(txt, numericCorpus).repaired;
    if (findUnbackedNumericTokens(repairedStep, numericCorpus).length === 0) return repairedStep;

    const { cleaned } = stripUnbackedNumericClaims(repairedStep, numericCorpus);
    const cleanedRepaired = repairTruncatedCommaNumbers(cleaned, numericCorpus).repaired;
    if (
      cleanedRepaired.length >= 20 &&
      findUnbackedNumericTokens(cleanedRepaired, numericCorpus).length === 0
    ) {
      return cleanedRepaired;
    }
    if (fallbackText) {
      const fbRepaired = repairTruncatedCommaNumbers(fallbackText, numericCorpus).repaired;
      if (findUnbackedNumericTokens(fbRepaired, numericCorpus).length === 0) {
        return fbRepaired;
      }
    }
    return cleanedRepaired || fallbackText || '';
  };

  plainTitle = auditFieldNumbers(plainTitle, cleanPublisherHeadline);
  plainFullTitle = auditFieldNumbers(plainFullTitle, cleanPublisherHeadline);
  l1 = {
    analogy: auditFieldNumbers(l1.analogy, det?.levels[1].analogy),
    everydayWhy: auditFieldNumbers(l1.everydayWhy, det?.levels[1].everydayWhy),
  };
  l2 = {
    whatHappened: auditFieldNumbers(l2.whatHappened, det?.levels[2].whatHappened),
    whoBuiltIt: l2.whoBuiltIt,
    problemSolved: auditFieldNumbers(l2.problemSolved, det?.levels[2].problemSolved),
  };
  l3 = {
    bridgeSummary: auditFieldNumbers(l3.bridgeSummary, det?.levels[3].bridgeSummary),
  };
  l4 = {
    roiAndFinOps: auditFieldNumbers(l4.roiAndFinOps, det?.levels[4].roiAndFinOps),
    readinessAndRisk: auditFieldNumbers(l4.readinessAndRisk, det?.levels[4].readinessAndRisk),
    clientAdvice: auditFieldNumbers(l4.clientAdvice, det?.levels[4].clientAdvice),
  };
  l5 = {
    architectureBrief: auditFieldNumbers(l5.architectureBrief, det?.levels[5].architectureBrief),
    specsAndCaveats: auditFieldNumbers(l5.specsAndCaveats, det?.levels[5].specsAndCaveats),
    streetConsensus: auditFieldNumbers(l5.streetConsensus, det?.levels[5].streetConsensus),
  };

  // Gate 7c: Preserve paired comma-formatted metrics, exact units, and test conditions across L1-L5
  const hasCommaOrConditionMetrics = evalMetrics.some(
    (m) => Boolean(m.condition) || /\d{1,3},\d{3}/.test(m.value)
  );
  if (hasCommaOrConditionMetrics) {
    const metricsClause = formatMetricsComparisonClause(evalMetrics);
    if (metricsClause) {
      const condMetrics = evalMetrics.filter((m) => Boolean(m.condition));
      const keyMetrics =
        condMetrics.length > 0
          ? (() => {
              const pCond =
                condMetrics.find((m) => m.isFeatured === true)?.condition ||
                condMetrics[0].condition!;
              const subset = condMetrics.filter((m) => m.condition === pCond);
              const f = subset.find((m) => m.isFeatured === true) || subset[0];
              const b = subset.find((m) => m.isFeatured === false && m !== f);
              return [f, ...(b ? [b] : [])];
            })()
          : evalMetrics.slice(0, 2);

      const requiredTokens: string[] = [];
      for (const km of keyMetrics) {
        const numMatch = km.value.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/);
        if (numMatch?.[0]) requiredTokens.push(numMatch[0]);
        if (km.condition) requiredTokens.push(km.condition);
        if (/\bprompt tokens\/s\b/i.test(km.value)) requiredTokens.push('prompt tokens/s');
      }

      const lensHasAllRequired = (combinedLens: string) => {
        const low = combinedLens.toLowerCase();
        return requiredTokens.every((req) => low.includes(req.toLowerCase()));
      };
      const appendClauseIfMissing = (primaryField: string, fullLensText: string): string => {
        if (!primaryField || lensHasAllRequired(fullLensText)) return primaryField;
        const trimmed = primaryField.replace(/[.]+$/, '').trim();
        return `${trimmed} (${metricsClause}).`;
      };

      l1.everydayWhy = appendClauseIfMissing(
        l1.everydayWhy,
        `${l1.analogy} ${l1.everydayWhy}`
      );
      l2.whatHappened = appendClauseIfMissing(
        l2.whatHappened,
        `${l2.whatHappened} ${l2.problemSolved}`
      );
      l3.bridgeSummary = appendClauseIfMissing(l3.bridgeSummary, l3.bridgeSummary);
      l4.roiAndFinOps = appendClauseIfMissing(
        l4.roiAndFinOps,
        `${l4.roiAndFinOps} ${l4.clientAdvice}`
      );
      l5.specsAndCaveats = appendClauseIfMissing(
        l5.specsAndCaveats,
        `${l5.architectureBrief} ${l5.specsAndCaveats}`
      );
    }
  }

  // Gate 8: Zero Unbacked Compliance Claims Audit across ALL lenses (SOC 2, zero-retention, HIPAA, GDPR, enterprise pilot)
  const rawComplianceCorpus = [
    sig.title || '',
    sig.rawAbstract || '',
    ...(sig.streetQuotes || []).map((q) => q.text || ''),
  ].join(' ');
  const defaultComplianceNote =
    scope === 'research_paper' || isEvaluationQualityStudy(sig)
      ? `Compliance: ${COMPLIANCE_NOT_ASSESSED_STUDY}.`
      : `Compliance: ${COMPLIANCE_NOT_ASSESSED_SOURCE}.`;

  const auditComplianceField = (txt: string, fallbackText: string): string => {
    if (!txt) return txt;
    if (findUnbackedComplianceClaims(txt, rawComplianceCorpus).length === 0) return txt;
    return stripUnbackedComplianceClaims(txt, rawComplianceCorpus, fallbackText).cleaned;
  };

  plainTitle = auditComplianceField(plainTitle, cleanPublisherHeadline);
  plainFullTitle = auditComplianceField(plainFullTitle, cleanPublisherHeadline);
  l1 = {
    analogy: auditComplianceField(l1.analogy, det?.levels[1].analogy || ''),
    everydayWhy: auditComplianceField(l1.everydayWhy, det?.levels[1].everydayWhy || ''),
  };
  l2 = {
    whatHappened: auditComplianceField(l2.whatHappened, det?.levels[2].whatHappened || cleanPublisherHeadline),
    whoBuiltIt: l2.whoBuiltIt,
    problemSolved: auditComplianceField(l2.problemSolved, det?.levels[2].problemSolved || ''),
  };
  l3 = {
    bridgeSummary: auditComplianceField(l3.bridgeSummary, det?.levels[3].bridgeSummary || ''),
  };
  l4 = {
    roiAndFinOps: auditComplianceField(l4.roiAndFinOps, det?.levels[4].roiAndFinOps || ''),
    readinessAndRisk: auditComplianceField(
      l4.readinessAndRisk,
      det?.levels[4].readinessAndRisk || defaultComplianceNote
    ),
    clientAdvice: auditComplianceField(
      l4.clientAdvice,
      det?.levels[4].clientAdvice || defaultComplianceNote
    ),
  };
  if (
    !hasSourceComplianceAssessment(sig) &&
    !/not assessed in (?:this study|source)/i.test(l4.readinessAndRisk)
  ) {
    l4.readinessAndRisk = l4.readinessAndRisk
      ? `${l4.readinessAndRisk.replace(/[.]+$/, '')}. ${defaultComplianceNote}`
      : defaultComplianceNote;
  }
  l5 = {
    architectureBrief: auditComplianceField(l5.architectureBrief, det?.levels[5].architectureBrief || ''),
    specsAndCaveats: auditComplianceField(l5.specsAndCaveats, det?.levels[5].specsAndCaveats || ''),
    streetConsensus: auditComplianceField(l5.streetConsensus, det?.levels[5].streetConsensus || ''),
  };

  return {
    ...payload,
    plainTitle,
    plainFullTitle,
    levels: {
      1: l1,
      2: l2,
      3: l3,
      4: l4,
      5: l5,
    },
    glossary,
  };
}
