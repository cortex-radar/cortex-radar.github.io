import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { computeProportionateBlast } from '../shared/blastRadiusEngine';
import {
  buildDeterministicLiteracyPayload,
  enforceEpistemicAndDomainFidelity,
  hasBannedL1Jargon,
  NO_RELEASE_NOTES_NOTICE,
} from '../shared/literacyEngine';
import {
  analyzeClusterCoverage,
  classifyEvidenceScope,
  classifySupportingLinkRelation,
  COMPLIANCE_NOT_ASSESSED_SOURCE,
  COMPLIANCE_NOT_ASSESSED_STUDY,
  extractBenchmarkClaimSpec,
  extractFrozenEntities,
  extractNamedLegalInstitution,
  extractPublisherDisplayName,
  extractSourceVerifiedMetrics,
  findTruncatedCommaNumbers,
  findUnbackedComplianceClaims,
  findUnbackedNumericTokens,
  getSignalReleaseMetadata,
  hasLatencyOrThroughputWithoutCost,
  hasTechnicalEngineeringContent,
  inferSupportingLinkRole,
  isEligibleForNewBadge,
  isEvaluationQualityStudy,
  isHedgedOrUnverifiedClaim,
  isMetricWarningOrNegationSentence,
  isReleaseWithoutNotes,
  isUpstreamUpdatedSignal,
  parseGitHubReleaseMetadata,
  sanitizeReleaseNotesText,
  stripUiChromeBoilerplate,
  validateHeadlineMeaningPreserved,
  validateSummaryProseScope,
} from '../shared/provenance';
import { shouldClusterIntoSupernova } from '../shared/supernovaEngine';
import { synthesizeRawItemToSpatialSignal } from '../shared/seed72h';
import { generateRssXml } from './bakeStaticGalaxy';
import type {
  LiteracySpectrumPayload,
  SpatialSignal,
  StaticGalaxySnapshot,
  StaticSignalArchive,
} from '../shared/types';
import { computeSignalMomentumScore, getCleanDisplayHeadline } from '../src/utils/signalRanking';

const nowMs = Date.now();
const SNAPSHOT_PATH = path.resolve(process.cwd(), 'public/data/live-galaxy.json');
const ARCHIVE_PATH = path.resolve(process.cwd(), 'public/data/signal-archive.json');
const RSS_PATH = path.resolve(process.cwd(), 'public/rss.xml');

function makeSyntheticSignal(overrides: Partial<SpatialSignal>): SpatialSignal {
  const base = synthesizeRawItemToSpatialSignal(
    {
      id: overrides.id || 'test-signal',
      title: overrides.title || 'Test Signal',
      summary: overrides.rawAbstract || overrides.title || 'Test Signal summary.',
      url: overrides.url || 'https://example.com/post',
      source: overrides.source || 'Bluesky',
      originFeedName: overrides.originFeedName || 'Bluesky',
      publishedAtMs: overrides.publishedAtMs || nowMs - 3 * 3600_000,
      updatedAtMs: overrides.updatedAtMs,
    },
    false
  );
  return {
    ...base,
    ...overrides,
  };
}

function normalizeForQuoteCheck(text: string): string {
  return stripUiChromeBoilerplate(
    (text || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&quot;|&#34;|&ldquo;|&rdquo;/gi, '"')
      .replace(/&apos;|&#39;|&rsquo;|&lsquo;/gi, "'")
      .replace(/&amp;/gi, '&')
  )
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function assertAllQuotesVerbatim(fields: string[], corpus: string, label: string): void {
  const normCorpus = normalizeForQuoteCheck(corpus);
  for (const field of fields) {
    const normalizedQuotes = (field || '').replace(/[“”]/g, '"');
    let match: RegExpExecArray | null;
    const quoteRegex = /"([^"\n]{6,220})"/g;
    while ((match = quoteRegex.exec(normalizedQuotes)) !== null) {
      const innerNorm = normalizeForQuoteCheck(match[1]);
      if (innerNorm.length < 6) continue;
      assert.ok(
        normCorpus.includes(innerNorm),
        `${label} contains non-verbatim quoted phrase: "${match[1]}"`
      );
    }
  }
}

function collectLiteracyFields(lit: LiteracySpectrumPayload): string[] {
  return [
    lit.plainTitle,
    lit.plainFullTitle,
    lit.levels[1].analogy,
    lit.levels[1].everydayWhy,
    lit.levels[2].whatHappened,
    lit.levels[2].whoBuiltIt,
    lit.levels[2].problemSolved,
    lit.levels[3].bridgeSummary,
    lit.levels[4].roiAndFinOps,
    lit.levels[4].readinessAndRisk,
    lit.levels[4].clientAdvice,
    lit.levels[5].architectureBrief,
    lit.levels[5].specsAndCaveats,
    lit.levels[5].streetConsensus,
  ];
}

function buildNumericAuditCorpus(sig: SpatialSignal): string {
  return [
    sig.title || '',
    sig.rawAbstract || '',
    ...(sig.streetQuotes || []).map((q) => q.text || ''),
    ...(sig.supportingSources || []).map((s) => s.title || ''),
    ...(sig.isDemoSeed && sig.architectBrief?.latencyAndCostNote
      ? [sig.architectBrief.latencyAndCostNote]
      : []),
  ].join(' ');
}

function buildRawComplianceCorpus(sig: SpatialSignal): string {
  return [
    sig.title || '',
    sig.rawAbstract || '',
    ...(sig.streetQuotes || []).map((q) => q.text || ''),
  ].join(' ');
}

function runFixtureAssertions(): void {
  // 1. Riemann Hypothesis hedged claim (adversarial settled-fact LLM output + deterministic)
  const riemannSig = makeSyntheticSignal({
    id: 'bsky-riemann-test',
    title: 'Riemann Hypothesis may have been solved with AI, awaiting expert review',
    primarySector: 'SCI',
    source: 'Bluesky',
    originFeedName: 'Bluesky (@emollick.bsky.social)',
    url: 'https://bsky.app/profile/emollick.bsky.social/post/3n2qvqp4fts2e',
    rawAbstract:
      'Wait: someone posted a manuscript claiming the Riemann Hypothesis may have been solved using an AI assistant. Mathematicians have not yet verified the claim.',
  });

  assert.equal(isHedgedOrUnverifiedClaim(riemannSig), true, 'Riemann signal must detect hedged claim');
  assert.equal(hasTechnicalEngineeringContent(riemannSig), false, 'Riemann social post has no tech specs');

  const adversarialRiemannLlm: LiteracySpectrumPayload = {
    plainTitle: 'AI solves Riemann Hypothesis',
    plainFullTitle: 'AI solves Riemann Hypothesis',
    levels: {
      1: {
        analogy:
          'Imagine solving a long-standing math mystery that stumped scholars for centuries, giving researchers a finished proof.',
        everydayWhy: 'Solving mathematical proofs improves everyday reasoning tools.',
      },
      2: {
        whatHappened: 'An AI model solved the Riemann Hypothesis in mathematics.',
        whoBuiltIt: 'Researchers using AI',
        problemSolved: 'Solves a century-old prime number problem.',
      },
      3: {
        bridgeSummary:
          'The proof pipeline combines Context Window, RAG, and FinOps Cascade for symbolic math.',
      },
      4: {
        roiAndFinOps: 'Automated theorem solving cuts R&D validation cycles dramatically.',
        readinessAndRisk: 'Production GA for math workloads under regulatory oversight.',
        clientAdvice: 'Validate theorem outputs behind an audited gateway.',
      },
      5: {
        architectureBrief: 'Uses a 256K Context Window and RAG retriever over Lean4 axioms.',
        specsAndCaveats: 'Achieved 100% proof pass rate in benchmarks.',
        streetConsensus: 'Awaiting peer replication (newly indexed publication)',
      },
    },
    glossary: [{ term: 'Context Window', definition: 'Working memory.' }],
    generatedBy: 'OLLAMA',
  };

  const fixedRiemann = enforceEpistemicAndDomainFidelity(riemannSig, adversarialRiemannLlm, 'BANKING');
  const detRiemann = buildDeterministicLiteracyPayload(riemannSig, 'BANKING');

  for (const payload of [fixedRiemann, detRiemann]) {
    assert.ok(!/may have been may have/i.test(JSON.stringify(payload)), 'Must not chain double hedges');
    assert.ok(!/\bAI solves\b/i.test(payload.plainTitle), `plainTitle lost hedge: ${payload.plainTitle}`);
    assert.ok(
      /\b(may|claims?|reportedly|unverified)\b/i.test(payload.plainFullTitle),
      `plainFullTitle must retain hedge: ${payload.plainFullTitle}`
    );
    const allTexts = [
      payload.levels[1].analogy,
      payload.levels[1].everydayWhy,
      payload.levels[2].whatHappened,
      payload.levels[2].problemSolved,
      payload.levels[3].bridgeSummary,
      payload.levels[4].roiAndFinOps,
      payload.levels[5].architectureBrief,
    ];
    for (const txt of allTexts) {
      assert.ok(
        /\b(may|might|could|claims?|claimed|purports?|reportedly|unverified|unconfirmed|tentative|awaiting|potentially)\b/i.test(
          txt
        ),
        `Level text lost epistemic uncertainty: ${txt}`
      );
      assert.ok(!/\bsolving a\b/i.test(txt), `Must not assert "solving a": ${txt}`);
      assert.ok(!/\bcontext window\b|\bfinops cascade\b|\brag\b/i.test(txt), `Must not fabricate tech specs: ${txt}`);
    }
    assert.ok(
      /Source provides no technical specifications or architecture details/i.test(
        payload.levels[5].architectureBrief
      ),
      'L5 architectureBrief must explicitly report missing technical specs'
    );
  }

  // 2. Anthropic IPO non-engineering market/policy cluster + deduplication
  const ipoSig = makeSyntheticSignal({
    id: 'lab-anthropic-ipo-close',
    title: 'Anthropic closes initial public offering on Nasdaq',
    primarySector: 'MKT',
    source: 'LabRelease',
    sourceCategory: 'AI_LAB',
    originFeedName: 'Anthropic News',
    url: 'https://www.anthropic.com/news/ipo-close',
    rawAbstract:
      'Anthropic announced the closing of its initial public offering of Class A common stock. No model weights, API updates, or engineering specs were announced.',
    supportingSources: [
      {
        source: 'Anthropic News',
        title: 'Anthropic closes initial public offering',
        url: 'https://www.anthropic.com/news/ipo-close',
        publishedAt: new Date(nowMs - 4 * 3600_000).toISOString(),
        publishedAtMs: nowMs - 4 * 3600_000,
        isPrimary: true,
      },
      {
        source: 'Anthropic News',
        title: 'Anthropic announces pricing of initial public offering',
        url: 'https://www.anthropic.com/news/ipo-pricing',
        publishedAt: new Date(nowMs - 8 * 3600_000).toISOString(),
        publishedAtMs: nowMs - 8 * 3600_000,
        isPrimary: true,
      },
      {
        source: 'HN · theguardian.com',
        title: 'Why the Anthropic IPO could test market appetite for AI stocks',
        url: 'https://www.theguardian.com/technology/anthropic-ipo-market-test',
        publishedAt: new Date(nowMs - 2 * 3600_000).toISOString(),
        publishedAtMs: nowMs - 2 * 3600_000,
        isPrimary: false,
      },
      {
        source: 'HN · techpolicy.press',
        title: 'Regulators weigh antitrust questions after Anthropic IPO filing',
        url: 'https://www.techpolicy.press/anthropic-ipo-antitrust',
        publishedAt: new Date(nowMs - 5 * 3600_000).toISOString(),
        publishedAtMs: nowMs - 5 * 3600_000,
        isPrimary: false,
      },
      {
        source: 'VIP · Swyx · Latent Space',
        title: 'Weekly AI roundup: Anthropic IPO and hyperscaler capex',
        url: 'https://www.latent.space/p/anthropic-ipo-commentary',
        publishedAt: new Date(nowMs - 1 * 3600_000).toISOString(),
        publishedAtMs: nowMs - 1 * 3600_000,
        isPrimary: false,
      },
    ],
  });

  assert.equal(hasTechnicalEngineeringContent(ipoSig), false, 'Anthropic IPO must not classify as technical');
  const adversarialIpoLlm: LiteracySpectrumPayload = {
    plainTitle: 'Anthropic goes public',
    plainFullTitle: 'Anthropic closes initial public offering',
    levels: {
      1: {
        analogy:
          'Imagine a large organization ringing a ceremonial bell as ownership shares begin trading publicly.',
        everydayWhy: 'Public company filings make vendor finances more transparent to customers.',
      },
      2: {
        whatHappened: 'Anthropic closed its initial public offering of common shares.',
        whoBuiltIt: 'Anthropic',
        problemSolved: 'Establishes public equity liquidity and capital disclosures.',
      },
      3: {
        bridgeSummary:
          'The IPO leverages Context Window to control trading volume, RAG for external data, and FinOps Cascade.',
      },
      4: {
        roiAndFinOps: 'FinOps Cascade cuts token latency across financial trading desks.',
        readinessAndRisk: 'Production GA for corporate workloads.',
        clientAdvice: 'Deploy behind an audited gateway.',
      },
      5: {
        architectureBrief: 'Context Window management routes exchange orderbooks via RAG pipelines.',
        specsAndCaveats: 'Refer to the upstream link for full hyperparameter tables and evaluation scripts.',
        streetConsensus: 'Active commentary on Latent Space.',
      },
    },
    glossary: [{ term: 'Context Window', definition: 'Fake' }],
    generatedBy: 'OLLAMA',
  };

  const fixedIpo = enforceEpistemicAndDomainFidelity(ipoSig, adversarialIpoLlm, 'BANKING');
  assert.equal(fixedIpo.glossary.length, 0, 'IPO story must have 0 invented tech glossary pills');
  assert.ok(
    !/context window|finops cascade|control trading volume|\brag\b|hyperparameter tables/i.test(
      `${fixedIpo.levels[3].bridgeSummary} ${fixedIpo.levels[4].roiAndFinOps} ${fixedIpo.levels[5].architectureBrief} ${fixedIpo.levels[5].specsAndCaveats}`
    ),
    'IPO lenses must strip fabricated technical specs'
  );
  assert.ok(
    /Source provides no technical specifications or architecture details/i.test(
      fixedIpo.levels[5].architectureBrief
    ),
    'IPO L5 architectureBrief must state no technical specs exist'
  );

  const ipoCoverage = analyzeClusterCoverage(ipoSig);
  assert.equal(ipoCoverage.relatedLinkCount, 5);
  assert.equal(ipoCoverage.independentPublisherCount, 4, 'Two anthropic.com links deduplicate to 1 publisher');
  assert.equal(ipoCoverage.hasIndependentCorroboration, false, 'Mixed PR + commentary must not claim corroboration');
  assert.equal(ipoCoverage.provenanceHeadlineLabel, '5 related links');
  const ipoRoles = ipoCoverage.groupedLinks.map((l, idx) => ({
    pub: extractPublisherDisplayName(l),
    role: inferSupportingLinkRole(l, idx === 0),
  }));
  assert.ok(ipoRoles.some((r) => r.role === 'Closing'));
  assert.ok(ipoRoles.some((r) => r.role === 'Pricing'));
  assert.ok(ipoRoles.some((r) => r.role === 'Market reaction'));
  assert.ok(ipoRoles.some((r) => r.role === 'Commentary'));

  // 3. GitHub Release naming, prerelease suffix, non-GA badge & release-history clustering
  const ollamaRel = parseGitHubReleaseMetadata(
    'v0.40.17',
    'https://github.com/ollama/ollama/releases/tag/v0.40.17-rc2',
    'GH Release · ollama'
  );
  assert.ok(ollamaRel);
  assert.equal(ollamaRel.displayTitle, 'Ollama v0.40.17-rc2');
  assert.equal(ollamaRel.stabilityLabel, 'Release candidate');
  assert.equal(ollamaRel.isPreRelease, true);

  const codexRel = parseGitHubReleaseMetadata(
    '0.173.0-alpha.1',
    'https://github.com/openai/codex/releases/tag/rust-v0.173.0-alpha.1',
    'GH Release · openai/codex'
  );
  assert.ok(codexRel);
  assert.equal(codexRel.displayTitle, 'OpenAI Codex v0.173.0-alpha.1');
  assert.equal(codexRel.stabilityLabel, 'Alpha');
  assert.equal(codexRel.isPreRelease, true);

  const claudeRel = parseGitHubReleaseMetadata(
    'v2.1.329',
    'https://github.com/anthropics/claude-code/releases/tag/v2.1.329',
    'GH Release · anthropics/claude-code'
  );
  assert.ok(claudeRel);
  assert.equal(claudeRel.displayTitle, 'Claude Code v2.1.329');
  assert.equal(claudeRel.stabilityLabel, 'Stable release');
  assert.equal(claudeRel.isPreRelease, false);

  const synthOllama = synthesizeRawItemToSpatialSignal(
    {
      id: 'ghrel-ollama-rc2-test',
      title: 'v0.40.17',
      summary: 'Release candidate v0.40.17-rc2 fixes local model runner edge cases.',
      url: 'https://github.com/ollama/ollama/releases/tag/v0.40.17-rc2',
      source: 'GHRelease',
      sourceCategory: 'GH_RELEASE',
      originFeedName: 'GH Release · ollama',
      publishedAtMs: nowMs - 2 * 3600_000,
    },
    false
  );
  assert.equal(synthOllama.title, 'Ollama v0.40.17-rc2');
  assert.equal(synthOllama.modelSpecs, undefined, 'GitHub Release must have zero synthetic modelSpecs');
  assert.notEqual(synthOllama.readiness, 'GA', 'Pre-release must never get GA readiness');
  assert.equal(getCleanDisplayHeadline(synthOllama, 1), 'Ollama v0.40.17-rc2');
  assert.equal(getCleanDisplayHeadline(synthOllama, 5), 'Ollama v0.40.17-rc2');

  const releaseClusterSig = makeSyntheticSignal({
    ...synthOllama,
    supportingSources: [
      {
        source: 'GH Release · ollama',
        title: 'Ollama v0.40.17-rc2',
        url: 'https://github.com/ollama/ollama/releases/tag/v0.40.17-rc2',
        publishedAt: new Date(nowMs - 2 * 3600_000).toISOString(),
        publishedAtMs: nowMs - 2 * 3600_000,
        isPrimary: true,
      },
      {
        source: 'GH Release · ollama',
        title: 'Ollama v0.40.17-rc1',
        url: 'https://github.com/ollama/ollama/releases/tag/v0.40.17-rc1',
        publishedAt: new Date(nowMs - 10 * 3600_000).toISOString(),
        publishedAtMs: nowMs - 10 * 3600_000,
        isPrimary: true,
      },
    ],
  });
  const relCoverage = analyzeClusterCoverage(releaseClusterSig);
  assert.equal(relCoverage.independentPublisherCount, 1);
  assert.equal(relCoverage.relatedLinkCount, 2);
  assert.equal(relCoverage.hasIndependentCorroboration, false);
  assert.equal(relCoverage.provenanceHeadlineLabel, '2 related links · Release history');

  // 4. Ollama UI-Chrome Boilerplate Fixture
  const pollutedOllamaSig = makeSyntheticSignal({
    id: 'ghrel-ollama-polluted-test',
    title: 'Ollama v0.40.17-rc3',
    source: 'GHRelease',
    sourceCategory: 'GH_RELEASE',
    originFeedName: 'ollama Release',
    readiness: 'PREVIEW',
    url: 'https://github.com/ollama/ollama/releases/tag/v0.40.17-rc3',
    rawAbstract:
      'Get up and running with Kimi, GLM, MiniMax, DeepSeek, gpt-oss, Qwen, Gemma and other models. - Release v0.40.17-rc3 · ollama/ollama Choose a tag to compare Sorry, something went wrong. Filter Loading Sorry, something went wrong. Uh oh! There was an error while loading. Please reload this page. Assets 2 Loading',
  });

  const sanOllama = sanitizeReleaseNotesText(pollutedOllamaSig.rawAbstract, pollutedOllamaSig.title);
  assert.equal(sanOllama.hadBoilerplate, true, 'Must detect GitHub page-shell boilerplate');
  assert.equal(sanOllama.isEmptyOrUseless, true, 'Boilerplate-only release must flag isEmptyOrUseless');
  assert.equal(sanOllama.cleanText, '', 'Boilerplate must be completely stripped');
  assert.equal(isReleaseWithoutNotes(pollutedOllamaSig), true, 'Polluted release must be treated as no-notes');

  const adversarialOllamaLlm: LiteracySpectrumPayload = {
    plainTitle: 'Ollama Update',
    plainFullTitle: 'Ollama v0.40.17-rc3',
    levels: {
      1: {
        analogy: 'Imagine a kitchen prep line mixing models.',
        everydayWhy: 'Adds Inkling 2 Mini though there were some loading errors reported.',
      },
      2: {
        whatHappened:
          'Release v0.40.17-rc3 adds Assets 2 Loading, though there were some loading errors reported.',
        whoBuiltIt: 'Ollama',
        problemSolved: 'Please reload this page.',
      },
      3: { bridgeSummary: 'Uses Open-Weights and Context Window despite loading errors reported.' },
      4: {
        roiAndFinOps: 'Reduces costs despite loading errors.',
        readinessAndRisk: 'Production GA ready today.',
        clientAdvice: 'Deploy immediately.',
      },
      5: {
        architectureBrief: 'There was an error while loading.',
        specsAndCaveats: 'Assets 2 Loading.',
        streetConsensus: 'Awaiting peer replication',
      },
    },
    glossary: [{ term: 'Context Window', definition: 'Fake' }],
    generatedBy: 'OLLAMA',
  };

  const fixedPollutedOllama = enforceEpistemicAndDomainFidelity(
    pollutedOllamaSig,
    adversarialOllamaLlm,
    'BANKING'
  );
  const detPollutedOllama = buildDeterministicLiteracyPayload(pollutedOllamaSig, 'BANKING');
  for (const p of [fixedPollutedOllama, detPollutedOllama]) {
    const dumped = JSON.stringify(p);
    assert.ok(
      !/error while loading|please reload|loading errors reported|sorry,\s*something went wrong|assets 2/i.test(
        dumped
      ),
      `Polluted release payload leaked boilerplate or fake errors: ${dumped}`
    );
    assert.equal(p.glossary.length, 0, 'No-notes release must have empty glossary');
    assert.ok(
      p.levels[2].whatHappened.includes(NO_RELEASE_NOTES_NOTICE),
      `Expected neutral no-notes fallback message, got: ${p.levels[2].whatHappened}`
    );
  }

  // 5. Frostbite Quantitative Benchmark Lock Fixture (Metric + Baseline + Attribution across ALL 5 lenses)
  const frostbiteSig = makeSyntheticSignal({
    id: 'hn-frostbite-bench-test',
    title: 'Frostbite: A new CPU architecture discovered, designed and verified by AI',
    source: 'HackerNews',
    sourceCategory: 'HN_COMMUNITY',
    originFeedName: 'HN · architectlabs.com',
    primarySector: 'ARC',
    url: 'https://architectlabs.com/blog/frostbite',
    rawAbstract:
      'Frostbite is a general-purpose CPU built around interaction nets, discovered, designed, and verified end-to-end by our AI systems, reaching 4.59× the performance per watt of a dual-issue, in-order CPU core.',
  });

  assert.equal(hasTechnicalEngineeringContent(frostbiteSig), true, 'Frostbite CPU signal must classify as technical');
  const benchSpec = extractBenchmarkClaimSpec(frostbiteSig);
  assert.ok(benchSpec, 'Frostbite signal must extract quantitative BenchmarkClaimSpec');
  assert.equal(benchSpec.metric, 'performance per watt');
  assert.ok(benchSpec.baseline.toLowerCase().includes('dual-issue, in-order cpu core'));
  assert.equal(benchSpec.attribution, 'Architect Labs');

  const adversarialFrostbiteLlm: LiteracySpectrumPayload = {
    plainTitle: 'Frostbite CPU is 4.59x better than modern CPUs',
    plainFullTitle: 'AI designs Frostbite CPU achieving 4.59x better efficiency than modern CPUs',
    levels: {
      1: {
        analogy:
          'Imagine a kitchen prep line that works 4.59x better than modern CPUs in every restaurant.',
        everydayWhy: 'Electronics run cooler.',
      },
      2: {
        whatHappened:
          'AI systems designed a new CPU called Frostbite, achieving 4.59x better performance-per-watt than modern CPUs.',
        whoBuiltIt: 'Architect Labs',
        problemSolved: 'Beats modern CPUs cleanly.',
      },
      3: {
        bridgeSummary:
          'Frostbite uses interaction nets to run 4.59x faster vs leading chips with zero compromises.',
      },
      4: {
        roiAndFinOps: 'Data centers gain 4.59x better efficiency over traditional CPUs.',
        readinessAndRisk: 'Early research silicon compared to current hardware.',
        clientAdvice: 'Monitor hardware availability.',
      },
      5: {
        architectureBrief: 'General-purpose CPU built around interaction nets verified end-to-end.',
        specsAndCaveats: 'Reportedly 4.59x better than modern CPUs in internal benchmarks.',
        streetConsensus: 'Awaiting independent silicon tape-out verification.',
      },
    },
    glossary: [],
    generatedBy: 'OLLAMA',
  };

  const fixedFrostbite = enforceEpistemicAndDomainFidelity(frostbiteSig, adversarialFrostbiteLlm, 'BANKING');
  const detFrostbite = buildDeterministicLiteracyPayload(frostbiteSig, 'BANKING');

  for (const p of [fixedFrostbite, detFrostbite]) {
    const headlineDump = `${p.plainTitle} ${p.plainFullTitle}`;
    assert.ok(!/modern cpus|leading chips/i.test(headlineDump), `Headline broadened baseline: ${headlineDump}`);
    assert.ok(!/4\.59\s*[x×]\s*better\b/i.test(headlineDump), `Headline used unqualified 4.59x better: ${headlineDump}`);

    const lensBlocks = [
      `${p.levels[1].analogy} ${p.levels[1].everydayWhy}`,
      `${p.levels[2].whatHappened} ${p.levels[2].problemSolved}`,
      p.levels[3].bridgeSummary,
      `${p.levels[4].roiAndFinOps} ${p.levels[4].readinessAndRisk} ${p.levels[4].clientAdvice}`,
      `${p.levels[5].architectureBrief} ${p.levels[5].specsAndCaveats}`,
    ];
    lensBlocks.forEach((txt, idx) => {
      assert.ok(!/modern cpus|leading chips|traditional cpus/i.test(txt), `L${idx + 1} broadened baseline: ${txt}`);
      assert.ok(!/4\.59\s*[x×]\s*better\b/i.test(txt), `L${idx + 1} used unqualified 4.59x better: ${txt}`);
      assert.ok(/performance per watt/i.test(txt), `L${idx + 1} missing exact metric "performance per watt": ${txt}`);
      assert.ok(
        /dual-issue,\s*in-order cpu core/i.test(txt),
        `L${idx + 1} missing baseline "dual-issue, in-order CPU core": ${txt}`
      );
      assert.ok(/architect labs/i.test(txt), `L${idx + 1} missing attribution "Architect Labs": ${txt}`);
    });
  }

  // 6. v2.3 Fixture: Hebbia / GPT-6 Astra (zero synthetic modelSpecs + verifiedMetrics + eval study framing)
  const hebbiaRawAbstract =
    'Hebbia sees improvements in financial research workflows using GPT-6 Astra. It scored 13.6 percentage points above the best alternative tested on citing the required types of sources, while 99.5% of the excerpts it cited were relevant to the question.';
  const hebbiaSig = makeSyntheticSignal({
    id: 'lab-openai-hebbia-test',
    title: 'Hebbia sees improvements in financial research with GPT-6 Astra',
    source: 'LabRelease',
    sourceCategory: 'AI_LAB',
    originFeedName: 'OpenAI News',
    primarySector: 'ECO',
    url: 'https://openai.com/index/hebbia',
    rawAbstract: hebbiaRawAbstract,
  });

  assert.equal(hebbiaSig.modelSpecs, undefined, 'Hebbia must have undefined modelSpecs');
  assert.equal(isEvaluationQualityStudy(hebbiaSig), true, 'Hebbia must classify as evaluation quality study');
  const hebbiaMetrics = extractSourceVerifiedMetrics(hebbiaSig);
  assert.ok(hebbiaMetrics.some((m) => m.value === '99.5%'), 'Expected 99.5% verified metric');
  assert.ok(
    hebbiaMetrics.some((m) => m.value.includes('13.6 percentage points')),
    'Expected +13.6 percentage points verified metric'
  );
  for (const vm of hebbiaMetrics) {
    assert.ok(
      hebbiaRawAbstract.includes(vm.quote),
      `Metric quote must appear verbatim in rawAbstract: ${vm.quote}`
    );
  }

  const adversarialHebbiaLlm: LiteracySpectrumPayload = {
    plainTitle: 'Hebbia uses GPT-6 Astra for research',
    plainFullTitle: 'Hebbia sees improvements in financial research with GPT-6 Astra',
    levels: {
      1: {
        analogy: 'Imagine a librarian checking cited passages carefully.',
        everydayWhy: 'Better source checks cut manual verification.',
      },
      2: {
        whatHappened: 'Hebbia tested GPT-6 Astra on citation relevance and source coverage.',
        whoBuiltIt: 'Hebbia and OpenAI',
        problemSolved: 'Improved retrieval accuracy on financial documents.',
      },
      3: {
        bridgeSummary: 'Citation grading checks retrieved excerpts against question criteria.',
      },
      4: {
        roiAndFinOps: 'Improves analyst review efficiency by citing relevant excerpts.',
        readinessAndRisk: 'Evaluated on internal diligence tasks.',
        clientAdvice: 'Verify source citation rules against your compliance checklist.',
      },
      5: {
        architectureBrief: 'Evaluates GPT-6 Astra citation coverage and excerpt relevance.',
        specsAndCaveats: 'Runs at 320ms TTFT and 115 tok/s for $0.65 per million tokens.',
        streetConsensus: 'Single-source vendor case study.',
      },
    },
    glossary: [],
    generatedBy: 'OLLAMA',
  };

  const fixedHebbia = enforceEpistemicAndDomainFidelity(hebbiaSig, adversarialHebbiaLlm, 'BANKING');
  const detHebbia = buildDeterministicLiteracyPayload(hebbiaSig, 'BANKING');
  for (const p of [fixedHebbia, detHebbia]) {
    const dumped = JSON.stringify(p);
    assert.ok(
      !/320\s*ms|115\s*tok\/s|\$0\.65|\$2\.20/i.test(dumped),
      `Hebbia leaked synthetic telemetry: ${dumped}`
    );
    assert.ok(
      /99\.5%|13\.6 percentage points/i.test(p.levels[5].specsAndCaveats),
      `Hebbia L5 specsAndCaveats must cite extracted evaluation metrics, got: ${p.levels[5].specsAndCaveats}`
    );
  }

  // 7. v2.3 Fixture: Rockchip RK3588 single-user experiment (unit lock + quote integrity + proportionate blast)
  const rockAbstract =
    'I built an offline voice assistant on Rockchip RK3588 achieving 51.8-58.3 tokens per second locally on CPU cores. "Measured end-to-end on RK3588 CPU cores."';
  const rockSig = makeSyntheticSignal({
    id: 'reddit-rockchip-rk3588-test',
    title: 'I built an offline speech stack on Rockchip RK3588 at 51.8-58.3 tok/s',
    source: 'Reddit',
    sourceCategory: 'REDDIT',
    originFeedName: 'Reddit (r/LocalLLaMA)',
    primarySector: 'ARC',
    url: 'https://www.reddit.com/r/LocalLLaMA/comments/example/rockchip_rk3588/',
    rawAbstract: rockAbstract,
  });

  assert.equal(classifyEvidenceScope(rockSig), 'single_user_experiment');
  const adversarialRockLlm: LiteracySpectrumPayload = {
    plainTitle: 'Offline speech helper on Rockchip RK3588',
    plainFullTitle: 'Offline voice assistant runs on Rockchip RK3588 at 51.8-58.3 tok/s',
    levels: {
      1: {
        analogy:
          'Imagine a pocket notepad speaking back at 51.8-58.3 words per second without internet access.',
        everydayWhy: 'Works offline for private notes at 51.8-58.3 words per second.',
      },
      2: {
        whatHappened:
          'A developer ran an offline speech assistant on Rockchip RK3588 hitting 51.8-58.3 words per second, acting as "a 3D modeling partner for edge tinkerers".',
        whoBuiltIt: 'Independent developer on Reddit',
        problemSolved: 'Delivers offline voice transcription without cloud APIs.',
      },
      3: {
        bridgeSummary: 'Local pipeline reaches 51.8-58.3 tok/s across RK3588 CPU cores.',
      },
      4: {
        roiAndFinOps:
          'Across financial-services teams, deploying behind an audited gateway yields a threefold cost reduction at 51.8-58.3 tok/s.',
        readinessAndRisk: 'Production GA for regulated banking workloads.',
        clientAdvice: 'Mandate SOC2 gateway rollout for banking desks.',
      },
      5: {
        architectureBrief: 'Quantized local inference on RK3588 CPU cores.',
        specsAndCaveats:
          'Achieved 51.8-58.3 words per second ("Measured end-to-end on RK3588 CPU cores.") with "unmatched enterprise SLA throughput".',
        streetConsensus: 'Community hardware benchmark shared on Reddit.',
      },
    },
    glossary: [],
    generatedBy: 'OLLAMA',
  };

  const fixedRock = enforceEpistemicAndDomainFidelity(rockSig, adversarialRockLlm, 'BANKING');
  const detRock = buildDeterministicLiteracyPayload(rockSig, 'BANKING');

  for (const p of [fixedRock, detRock]) {
    const dumped = JSON.stringify(p);
    assert.ok(!/words per second/i.test(dumped), `Must never convert tok/s to words per second: ${dumped}`);
    assert.ok(/token\s*=\s*a unit of text/i.test(`${p.levels[1].analogy} ${p.levels[1].everydayWhy}`), 'L1 must define token = a unit of text');
    assert.ok(!/"a 3D modeling partner for edge tinkerers"/i.test(dumped), 'Fake quote in L2 must strip quotes');
    assert.ok(!/"unmatched enterprise SLA throughput"/i.test(dumped), 'Fake quote in L5 must strip quotes');
    assert.ok(
      !/financial[- ]services|threefold|banking|audited gateway/i.test(JSON.stringify(p.levels[4])),
      `Single-user experiment L4 leaked unrelated enterprise framing: ${JSON.stringify(p.levels[4])}`
    );
  }
  assert.ok(
    fixedRock.levels[5].specsAndCaveats.includes('"Measured end-to-end on RK3588 CPU cores."'),
    'Verbatim quote in source must preserve quotation marks'
  );
  assert.ok(/tokens per second/i.test(fixedRock.levels[1].analogy), 'L1 must preserve tokens per second');
  assert.ok(/tokens per second/i.test(fixedRock.levels[2].whatHappened), 'L2 must preserve tokens per second');
  assert.ok(/tokens per second/i.test(fixedRock.levels[3].bridgeSummary), 'L3 must preserve tokens per second');
  assert.ok(/tokens per second/i.test(fixedRock.levels[5].specsAndCaveats), 'L5 must preserve tokens per second');

  const inklingTokSig = makeSyntheticSignal({
    id: 'rd-inkling-toks-test',
    title: 'Inkling 2 Mini IQ4_NL on RTX 5060 Ti 16GB, 44 tok/s',
    source: 'Reddit',
    sourceCategory: 'REDDIT',
    originFeedName: 'r/LocalLLaMA',
    primarySector: 'ARC',
    url: 'https://www.reddit.com/r/LocalLLaMA/comments/example/inkling/',
    rawAbstract: 'Benchmarked at 44 tok/s on RTX 5060 Ti 16GB.',
  });
  const detInkling = buildDeterministicLiteracyPayload(inklingTokSig, 'BANKING');
  assert.ok(
    detInkling.plainFullTitle.includes('44 tokens per second'),
    `Plain headline must retain 44 tokens per second from 44 tok/s: ${detInkling.plainFullTitle}`
  );

  const rockBlast = computeProportionateBlast(rockSig, 'BANKING');
  assert.equal(rockBlast.mode, 'PRACTICAL_NEXT_STEP');
  assert.equal(rockBlast.horizons.length, 1, 'Single-user experiment must emit exactly 1 Practical Next Step card');
  assert.equal(rockBlast.horizons[0].horizon, 'NEXT');
  assert.ok(
    !/financial[- ]services|banking|threefold|3x/i.test(JSON.stringify(rockBlast.horizons)),
    `Single-user Practical Next Step leaked banking/3x template: ${JSON.stringify(rockBlast.horizons)}`
  );

  // 8. v2.3 Fixture: Actuator-7B & Qwen2.5-7B entity freeze across L1-L5 & RSS
  const actuatorSig = makeSyntheticSignal({
    id: 'hf-actuator-qwen-test',
    title: 'Actuator-7B fine-tunes Qwen2.5-7B for robotics tool control',
    source: 'HuggingFace',
    sourceCategory: 'RESEARCH',
    originFeedName: 'HuggingFace Daily Papers',
    primarySector: 'INN',
    url: 'https://huggingface.co/papers/2611.99999',
    rawAbstract:
      'Actuator-7B builds on Qwen2.5-7B weights for reliable robotics tool calling and local execution.',
  });

  const entities = extractFrozenEntities(actuatorSig);
  assert.ok(entities.includes('Actuator-7B'), `Missing Actuator-7B in ${JSON.stringify(entities)}`);
  assert.ok(entities.includes('Qwen2.5-7B'), `Missing Qwen2.5-7B in ${JSON.stringify(entities)}`);
  assert.ok(
    entities.every((e) => !/\s+(fine|builds|on|is|a)\b/i.test(e)),
    `Frozen entity regex captured trailing prose words: ${JSON.stringify(entities)}`
  );

  const adversarialActuatorLlm: LiteracySpectrumPayload = {
    plainTitle: 'compact AI model updated',
    plainFullTitle: 'compact AI model fine-tunes compact scale for robotics control',
    levels: {
      1: {
        analogy: 'A compact AI model built at a compact scale learns robot arm commands.',
        everydayWhy: 'Robots follow instructions without crashing.',
      },
      2: {
        whatHappened: 'Researchers trained compact AI model over Qwen2.5-7B for tool invocation.',
        whoBuiltIt: 'Open researchers',
        problemSolved: 'Reduces invalid robot tool arguments.',
      },
      3: {
        bridgeSummary: 'Uses compact AI model over Qwen2.5-7B weights.',
      },
      4: {
        roiAndFinOps: 'Cuts hardware trial loops during robotics R&D.',
        readinessAndRisk: 'Research checkpoint requiring sandbox verification.',
        clientAdvice: 'Test in simulation prior to physical actuation.',
      },
      5: {
        architectureBrief: 'Actuator-7B fine-tunes Qwen2.5-7B for robotics tool control.',
        specsAndCaveats: 'Inspect HuggingFace repository for dataset details.',
        streetConsensus: 'Research paper release.',
      },
    },
    glossary: [],
    generatedBy: 'OLLAMA',
  };

  const fixedActuator = enforceEpistemicAndDomainFidelity(actuatorSig, adversarialActuatorLlm, 'BANKING');
  const detActuator = buildDeterministicLiteracyPayload(actuatorSig, 'BANKING');
  for (const p of [fixedActuator, detActuator]) {
    const dumped = JSON.stringify(p);
    assert.ok(!/compact ai model|compact scale/i.test(dumped), `Entity flattened to filler phrase: ${dumped}`);
    assert.ok(p.plainFullTitle.includes('Actuator-7B'), `plainFullTitle lost Actuator-7B: ${p.plainFullTitle}`);
    assert.ok(p.plainFullTitle.includes('Qwen2.5-7B'), `plainFullTitle lost Qwen2.5-7B: ${p.plainFullTitle}`);
    assert.ok(p.plainTitle.includes('Actuator-7B'), `plainTitle lost Actuator-7B: ${p.plainTitle}`);
    assert.ok(p.levels[1].analogy.includes('Actuator-7B'), `L1 analogy lost Actuator-7B: ${p.levels[1].analogy}`);
    assert.ok(p.levels[2].whatHappened.includes('Actuator-7B'), `L2 lost Actuator-7B: ${p.levels[2].whatHappened}`);
  }
  const rssActXml = generateRssXml([actuatorSig], nowMs);
  assert.ok(rssActXml.includes('Actuator-7B'), 'RSS feed dropped Actuator-7B');
  assert.ok(rssActXml.includes('Qwen2.5-7B'), 'RSS feed dropped Qwen2.5-7B');
  assert.ok(!/compact ai model/i.test(rssActXml), 'RSS feed contained flattened compact AI model');

  // 9. v2.3 Fixture: Ollama v0.40.17 timestamp split (published 11d ago, updated 2h ago)
  const ollamaUpdatedSig = makeSyntheticSignal({
    id: 'ghrel-ollama-updated-split-test',
    title: 'Ollama v0.40.17',
    source: 'GHRelease',
    sourceCategory: 'GH_RELEASE',
    originFeedName: 'GH Release · ollama',
    url: 'https://github.com/ollama/ollama/releases/tag/v0.40.17',
    rawAbstract: 'Fixes memory cleanup in model runner.',
    publishedAtMs: nowMs - 11 * 24 * 3600_000,
    updatedAtMs: nowMs - 2 * 3600_000,
  });

  assert.equal(isUpstreamUpdatedSignal(ollamaUpdatedSig), true, 'Must classify 11d publish + 2h update as upstream updated');
  assert.equal(
    isEligibleForNewBadge(ollamaUpdatedSig, nowMs - 24 * 3600_000, nowMs),
    false,
    'Updated older release must never receive NEW badge'
  );
  assert.ok(
    nowMs - ollamaUpdatedSig.publishedAtMs > 72 * 3600_000,
    'Updated 11d release must fail strict 72h publishedAtMs Top 10 gate'
  );

  // 10. v2.4 Fixture: Schools Conditional Headline Invariant
  const schoolsSigA = makeSyntheticSignal({
    id: 'hn-schools-conditional-test',
    title: 'Schools that disable Gemini lose access to Google Search',
    source: 'HackerNews',
    sourceCategory: 'HN_COMMUNITY',
    originFeedName: 'HN · motherjones.com',
    primarySector: 'GOV',
    url: 'https://www.motherjones.com/politics/2026/11/schools-gemini-search-test/',
    rawAbstract:
      'A policy would block schools that disable Gemini AI tools from access to Google Search next year.',
  });
  const schoolsSigB = makeSyntheticSignal({
    id: 'hn-schools-motherjones-test',
    title: "Google workers tell their employer not to punish schools that don't want AI",
    source: 'HackerNews',
    sourceCategory: 'HN_COMMUNITY',
    originFeedName: 'HN · motherjones.com',
    primarySector: 'GOV',
    url: 'https://www.motherjones.com/politics/2026/11/google-alphabet-union-school-ai-protest-gemini-workers-petition/',
    rawAbstract:
      'Hundreds of workers at Google are pushing senior leadership to retract a policy that would block schools who turn off its Gemini AI tools from access to the company’s search engine starting next year.',
  });

  for (const [label, sSig] of [
    ['SchoolsA', schoolsSigA],
    ['SchoolsB', schoolsSigB],
  ] as const) {
    const invertedLlm: LiteracySpectrumPayload = {
      plainTitle: 'Google blocks schools from using Gemini',
      plainFullTitle: 'Google workers push against policy blocking schools from using Gemini AI',
      levels: {
        1: {
          analogy: 'Imagine blocking schools from using Gemini on classroom laptops.',
          everydayWhy: 'Schools have to negotiate AI subscriptions.',
        },
        2: {
          whatHappened: 'Google is blocking schools from using Gemini AI tools.',
          whoBuiltIt: 'Google',
          problemSolved: 'Resolves school access policy disputes.',
        },
        3: { bridgeSummary: 'Covers workspace admin policy toggles.' },
        4: {
          roiAndFinOps: 'Impacts public education procurement contracts.',
          readinessAndRisk: 'Policy governance item under review.',
          clientAdvice: 'Track educational product terms before renewal.',
        },
        5: {
          architectureBrief: 'Policy petition over classroom tool bundling.',
          specsAndCaveats: 'No model specs.',
          streetConsensus: 'Active discussion.',
        },
      },
      glossary: [],
      generatedBy: 'OLLAMA',
    };

    const badCheck = validateHeadlineMeaningPreserved(sSig, invertedLlm.plainFullTitle);
    assert.equal(badCheck.valid, false, `${label}: inverted headline must fail validation`);

    const fixed = enforceEpistemicAndDomainFidelity(sSig, invertedLlm, 'BANKING');
    const det = buildDeterministicLiteracyPayload(sSig, 'BANKING');
    const rssXml = generateRssXml([{ ...sSig, literacy: fixed }], nowMs);

    for (const p of [fixed, det]) {
      assert.ok(
        !/block(?:s|ing)?\s+schools\s+from\s+(?:using\s+)?gemini/i.test(
          `${p.plainTitle} ${p.plainFullTitle} ${p.levels[1].analogy} ${p.levels[2].whatHappened}`
        ),
        `${label}: inverted Gemini-block claim survived: ${JSON.stringify(p)}`
      );
      const checkTitle = validateHeadlineMeaningPreserved(sSig, p.plainFullTitle);
      assert.equal(checkTitle.valid, true, `${label}: final plainFullTitle must validate cleanly`);
    }
    assert.ok(
      !/block(?:s|ing)?\s+schools\s+from\s+(?:using\s+)?gemini/i.test(rssXml),
      `${label}: RSS feed leaked inverted Gemini-block headline`
    );
    assert.ok(
      rssXml.includes(sSig.title.replace('&', '&amp;')) ||
        rssXml.includes(sSig.title.replace("'", '&apos;')),
      `${label}: RSS feed did not preserve verbatim publisher headline`
    );
  }
  const fixedSchoolsA = enforceEpistemicAndDomainFidelity(
    schoolsSigA,
    buildDeterministicLiteracyPayload(schoolsSigA, 'BANKING'),
    'BANKING'
  );
  assert.ok(
    fixedSchoolsA.plainFullTitle.includes('Google Search'),
    `SchoolsA Plain headline must preserve lost Google Search target: ${fixedSchoolsA.plainFullTitle}`
  );

  // 11. v2.4 Fixture: Court / Jurisdictional Scope Invariant
  const courtSig = makeSyntheticSignal({
    id: 'hn-court-scope-test',
    title: 'European rights court bars Romanian lawyer for 2 years over AI citations',
    source: 'HackerNews',
    sourceCategory: 'HN_COMMUNITY',
    originFeedName: 'HN · echr.coe.int',
    primarySector: 'GOV',
    url: 'https://www.echr.coe.int/w/romanian-lawyer-barred-test',
    rawAbstract:
      'Romanian lawyer barred for two years from representing or otherwise assisting litigants before the Court over unverified AI-generated citations.',
  });

  const broadenedCourtLlm: LiteracySpectrumPayload = {
    plainTitle: 'Lawyer barred from practicing for 2 years',
    plainFullTitle: 'Romanian lawyer barred from practicing law for two years over AI citations',
    levels: {
      1: {
        analogy: 'Imagine a lawyer being barred from practicing law for two years over bad citations.',
        everydayWhy: 'Legal filings require verified citations.',
      },
      2: {
        whatHappened: 'A Romanian lawyer was barred from practicing law for two years.',
        whoBuiltIt: 'European Court of Human Rights',
        problemSolved: 'Protects judicial proceedings from fabricated legal authorities.',
      },
      3: { bridgeSummary: 'Highlights citation verification governance.' },
      4: {
        roiAndFinOps: 'Legal teams face disciplinary risk for unchecked filings.',
        readinessAndRisk: 'Court governance ruling.',
        clientAdvice: 'Audit legal citations before court submission.',
      },
      5: {
        architectureBrief: 'Judicial disciplinary decision.',
        specsAndCaveats: 'No software artifacts.',
        streetConsensus: 'Discussed on HN.',
      },
    },
    glossary: [],
    generatedBy: 'OLLAMA',
  };

  assert.equal(
    validateHeadlineMeaningPreserved(courtSig, broadenedCourtLlm.plainFullTitle).valid,
    false,
    'Broadened practicing-law ban must fail validation'
  );
  const fixedCourt = enforceEpistemicAndDomainFidelity(courtSig, broadenedCourtLlm, 'BANKING');
  const rssCourt = generateRssXml([{ ...courtSig, literacy: fixedCourt }], nowMs);
  assert.ok(
    !/barred from practicing(?:\s+law)?/i.test(JSON.stringify(fixedCourt)),
    `Court signal broadened ban to practicing law: ${JSON.stringify(fixedCourt)}`
  );
  assert.equal(
    fixedCourt.plainFullTitle,
    'European rights court bars Romanian lawyer for 2 years over AI citations'
  );
  assert.ok(rssCourt.includes('European rights court bars Romanian lawyer for 2 years over AI citations'));
  assert.ok(!/barred from practicing/i.test(rssCourt));

  // 12. v2.4 Fixture: TideCache Range & Card-Wide Business Grounding
  const tideAbstract =
    'Hybrid architectures have become mainstream among open-weight language models. Implemented in SGLang and evaluated on GB300 and GH200 across seven model/platform configurations, TideCache completes up to 2.04x as many agent turns, reduces overall P50 per-token latency by 20--59%, and improves agent P50 TTFT by 1.40--3.05x compared with SGLang with HiCache.';
  const tideSig = makeSyntheticSignal({
    id: 'arxiv-tidecache-v24-test',
    title: 'TideCache: Efficient Hybrid LLM Serving with Transparent Cache Management and Layer-Wise Streaming',
    source: 'arXiv',
    sourceCategory: 'RESEARCH',
    originFeedName: 'arXiv cs.LG',
    primarySector: 'ARC',
    readiness: 'RESEARCH',
    finOps: 'REDUCER',
    url: 'https://arxiv.org/abs/2611.26619v1',
    rawAbstract: tideAbstract,
  });

  const tideMetrics = extractSourceVerifiedMetrics(tideSig);
  const pctMetric = tideMetrics.find((m) => m.value === '20–59%');
  assert.ok(pctMetric, `Expected full range 20–59% in verifiedMetrics, got: ${JSON.stringify(tideMetrics)}`);
  assert.ok(
    !tideMetrics.some((m) => m.value === '59%'),
    `Must NOT emit truncated bare 59% when source states 20--59%: ${JSON.stringify(tideMetrics)}`
  );
  assert.ok(
    pctMetric.context && /SGLang with HiCache/i.test(pctMetric.context),
    `Expected comparison baseline SGLang with HiCache in metric context, got: ${pctMetric.context}`
  );
  assert.ok(
    tideMetrics.some((m) => m.value === '1.40–3.05x'),
    `Expected full speedup range 1.40–3.05x in verifiedMetrics, got: ${JSON.stringify(tideMetrics)}`
  );
  assert.equal(hasLatencyOrThroughputWithoutCost(tideSig), true);

  const adversarialTideLlm: LiteracySpectrumPayload = {
    plainTitle: 'TideCache Cuts AI Serving Latency',
    plainFullTitle: 'TideCache cuts per-token latency by 20–59% over SGLang HiCache',
    levels: {
      1: {
        analogy: 'Think of preloading ingredients so serving waits 35–65% less at busy tables.',
        everydayWhy: 'Faster responses cut cloud bills by 40% immediately.',
      },
      2: {
        whatHappened: 'TideCache reduces P50 per-token latency by 20–59% vs SGLang with HiCache.',
        whoBuiltIt: 'arXiv authors',
        problemSolved: 'Improves agent turn completion on hybrid models.',
      },
      3: {
        bridgeSummary: 'Uses CPU-GPU KV Cache streaming to achieve $0.14 per million token cost.',
      },
      4: {
        roiAndFinOps: 'Compresses inference run-rate by 35–65% with lower inference costs across workloads.',
        readinessAndRisk: 'Requires confidence routing (<0.92) for >75% gross margin.',
        clientAdvice: 'Deploy to capture 35–65% cost savings immediately.',
      },
      5: {
        architectureBrief: 'Transparent Cache Pool + Cache Streamer + Request Scheduler evaluated on GB300 and GH200.',
        specsAndCaveats: 'Reduces P50 per-token latency by 20–59% compared with SGLang with HiCache.',
        streetConsensus: 'Awaiting peer replication (newly indexed paper/release)',
      },
    },
    glossary: [],
    generatedBy: 'OLLAMA',
  };

  const fixedTide = enforceEpistemicAndDomainFidelity(tideSig, adversarialTideLlm, 'BANKING');
  const detTide = buildDeterministicLiteracyPayload(tideSig, 'BANKING');
  const tideCorpus = buildNumericAuditCorpus(tideSig);
  const tideBlast = computeProportionateBlast(tideSig, 'BANKING');

  for (const p of [fixedTide, detTide]) {
    const dumped = JSON.stringify(p);
    assert.ok(!/35[–-]65%|<0\.92|>75%|40%|\$0\.14/i.test(dumped), `TideCache leaked unbacked number: ${dumped}`);
    for (const f of collectLiteracyFields(p)) {
      const unbacked = findUnbackedNumericTokens(f, tideCorpus);
      assert.deepEqual(unbacked, [], `TideCache field contains unbacked numbers: ${f}`);
    }
    assert.ok(
      p.levels[4].roiAndFinOps.includes('What happens to cost per completed request on your workload?'),
      `TideCache L4 must ask grounded cost question, got: ${p.levels[4].roiAndFinOps}`
    );
  }
  assert.ok(
    !/35[–-]65%|<0\.92|>75%/i.test(JSON.stringify(tideBlast)),
    `TideCache Blast leaked synthetic numbers: ${JSON.stringify(tideBlast)}`
  );

  // 13. v2.4 Fixture: HN Career-Advice Discussion / Personal Scope
  const careerSig = makeSyntheticSignal({
    id: 'hn-career-v24-test',
    title: 'Ask HN: I have been unemployed for 2y. 15 years of experience, US. What to do?',
    source: 'HackerNews',
    sourceCategory: 'HN_COMMUNITY',
    originFeedName: 'HN Frontpage',
    primarySector: 'GOV',
    url: 'https://news.ycombinator.com/item?id=50583761',
    rawAbstract:
      'I am a senior software engineer in the US with 15y of experience. I have been unemployed for 2y and maybe have 4-5 months left to support my household. What should I do?',
  });

  assert.equal(
    classifyEvidenceScope(careerSig),
    'discussion_or_personal',
    'Ask HN unemployment post must classify as discussion_or_personal'
  );
  const careerBlast = computeProportionateBlast(careerSig, 'BANKING');
  assert.equal(careerBlast.mode, 'READ_DISCUSSION');
  assert.equal(careerBlast.horizons.length, 1);
  assert.equal(careerBlast.horizons[0].title, 'Read the original discussion');
  assert.equal(careerBlast.horizons[0].actionUrl, careerSig.url);
  assert.ok(
    !/target hardware|reproduce the test|latency and accuracy|financial[- ]services|\b3x\b/i.test(
      JSON.stringify(careerBlast)
    ),
    `Career thread leaked hardware/enterprise advice: ${JSON.stringify(careerBlast)}`
  );

  const adversarialCareerLlm: LiteracySpectrumPayload = {
    plainTitle: 'Senior Engineer Job Search',
    plainFullTitle: 'Ask HN: Senior software engineer seeks career advice after 2 years unemployed',
    levels: {
      1: {
        analogy: 'Imagine asking peers at a local meetup for advice on switching careers.',
        everydayWhy: 'Career gaps affect experienced workers across industries.',
      },
      2: {
        whatHappened: 'A senior engineer on Hacker News asked the community for career direction after two years unemployed.',
        whoBuiltIt: 'Hacker News community poster',
        problemSolved: 'Seeks practical advice on navigating long job searches.',
      },
      3: {
        bridgeSummary: 'Community discussion thread with career reflections and peer suggestions.',
      },
      4: {
        roiAndFinOps: 'Reproduce the setup on target hardware to validate throughput at 35–65% lower cost.',
        readinessAndRisk: 'Deploy behind an audited gateway under SR 11-7 oversight.',
        clientAdvice: 'Test on a benchmark harness before production cutover.',
      },
      5: {
        architectureBrief: 'Source provides no technical specifications or architecture details. Community career thread.',
        specsAndCaveats: 'Personal discussion thread without code or benchmarks.',
        streetConsensus: 'Ask HN discussion thread.',
      },
    },
    glossary: [],
    generatedBy: 'OLLAMA',
  };

  const fixedCareer = enforceEpistemicAndDomainFidelity(careerSig, adversarialCareerLlm, 'BANKING');
  const detCareer = buildDeterministicLiteracyPayload(careerSig, 'BANKING');
  for (const p of [fixedCareer, detCareer]) {
    assert.ok(
      !/target hardware|benchmark harness|audited gateway|35[–-]65%|reproduce the/i.test(
        JSON.stringify(p.levels[4])
      ),
      `Career thread L4 leaked hardware/enterprise template: ${JSON.stringify(p.levels[4])}`
    );
  }

  // 14. v2.5 Fixture: Squoosh Bench Compliance & Paired Metrics (UX-1 84.0% vs Qwen3 Next 61.6%)
  const squooshAbstract =
    'Experimentation teams must decide which proposed website changes to test with live traffic. We screened 412 historical website A/B tests and evaluated four systems on the 318 that ran longer than 21 days. Squoosh UX-1, a model fine-tuned on human browsing data, simulated 1,000 shoppers per arm and correctly classified 267 of 318 outcomes (84.0%, 95% Wilson interval 79.5-87.6%, treating experiments as independent). Qwen3 Next 80B, the strongest general-purpose configuration on outcome accuracy, correctly classified 196 of 318 (61.6%). UX-1 favored the variant in 126 experiments. In the live tests, 118 of those variants won (93.7%), four lost, and four had inconclusive results.';
  const squooshSig = makeSyntheticSignal({
    id: 'hf-2611.25200-test',
    title: 'Squoosh Bench: Evaluating UX-1 on 318 Historical Website A/B Tests',
    source: 'HuggingFace',
    sourceCategory: 'RESEARCH',
    originFeedName: 'Hugging Face Daily Papers',
    primarySector: 'SCI',
    url: 'https://huggingface.co/papers/2611.25200',
    rawAbstract: squooshAbstract,
  });

  assert.equal(squooshSig.readiness, 'RESEARCH', 'HuggingFace paper must carry RESEARCH readiness (not GA)');
  const squooshMetrics = extractSourceVerifiedMetrics(squooshSig);
  assert.ok(squooshMetrics.length >= 2, `Expected paired featured + baseline metrics, got: ${JSON.stringify(squooshMetrics)}`);
  assert.equal(squooshMetrics[0].subject, 'UX-1', `Featured metric must come first: ${JSON.stringify(squooshMetrics)}`);
  assert.equal(squooshMetrics[0].value, '84.0%', `Featured metric must be 84.0%: ${JSON.stringify(squooshMetrics[0])}`);
  assert.equal(squooshMetrics[0].isFeatured, true);
  assert.ok(
    squooshMetrics.some((m) => m.subject === 'Qwen3 Next 80B' && m.value === '61.6%' && m.isFeatured === false),
    `Expected baseline metric Qwen3 Next 80B 61.6%, got: ${JSON.stringify(squooshMetrics)}`
  );
  assert.ok(
    !squooshMetrics.some((m) => m.value === '95%' || m.value === '79.5–87.6%'),
    `Wilson confidence interval must NOT appear as standalone metric pill: ${JSON.stringify(squooshMetrics)}`
  );

  const adversarialSquooshLlm: LiteracySpectrumPayload = {
    plainTitle: 'Squoosh Bench UX-1 Tests',
    plainFullTitle: 'Squoosh Bench: Evaluating UX-1 on 318 Historical Website A/B Tests',
    levels: {
      1: {
        analogy: 'Imagine testing website layouts with simulated shoppers before going live.',
        everydayWhy: 'Teams pick better web page designs faster.',
      },
      2: {
        whatHappened: 'UX-1 correctly classified 84.0% of A/B test outcomes compared to 61.6% for Qwen3 Next 80B.',
        whoBuiltIt: 'Squoosh Bench Authors',
        problemSolved: 'Helps experimentation teams prioritize A/B tests.',
      },
      3: {
        bridgeSummary: 'Uses fine-tuned UX-1 simulation models across historical tests.',
      },
      4: {
        roiAndFinOps: 'Evaluates simulated A/B outcome prediction.',
        readinessAndRisk:
          'Production GA (ready for an enterprise pilot) while clears standard SOC 2 and zero-retention HIPAA GDPR posture.',
        clientAdvice: 'Deploy behind a zero-retention SOC 2 gateway ready for an enterprise pilot.',
      },
      5: {
        architectureBrief: 'Compares UX-1 against Qwen3 Next 80B on 318 website A/B experiments.',
        specsAndCaveats: 'SOC 2 certified; Qwen3 Next 80B achieved 61.6% accuracy.',
        streetConsensus: 'Awaiting peer replication (newly indexed paper/release)',
      },
    },
    glossary: [],
    generatedBy: 'OLLAMA',
  };

  const fixedSquoosh = enforceEpistemicAndDomainFidelity(squooshSig, adversarialSquooshLlm, 'BANKING');
  const detSquoosh = buildDeterministicLiteracyPayload(squooshSig, 'BANKING');
  const squooshBlast = computeProportionateBlast(squooshSig, 'BANKING');
  const rawSquooshCorpus = buildRawComplianceCorpus(squooshSig);

  for (const p of [fixedSquoosh, detSquoosh]) {
    const dumped = JSON.stringify(p);
    assert.ok(
      !/\bsoc\s*2\b|\bzero[- ]retention\b|\bhipaa\b|\bgdpr\b|ready for (?:an |governed )?enterprise pilot|enterprise[- ]ready/i.test(
        dumped
      ),
      `Squoosh Bench leaked unbacked compliance claim: ${dumped}`
    );
    assert.ok(
      p.levels[4].readinessAndRisk.includes(COMPLIANCE_NOT_ASSESSED_STUDY),
      `Squoosh L4 readinessAndRisk must state "${COMPLIANCE_NOT_ASSESSED_STUDY}", got: ${p.levels[4].readinessAndRisk}`
    );
    for (const f of collectLiteracyFields(p)) {
      assert.deepEqual(findUnbackedComplianceClaims(f, rawSquooshCorpus), []);
    }
  }
  assert.ok(
    detSquoosh.levels[5].specsAndCaveats.includes('UX-1') &&
      detSquoosh.levels[5].specsAndCaveats.includes('84.0%') &&
      detSquoosh.levels[5].specsAndCaveats.includes('61.6%'),
    `Squoosh L5 must pair UX-1 84.0% with baseline 61.6%: ${detSquoosh.levels[5].specsAndCaveats}`
  );
  assert.equal(
    findUnbackedComplianceClaims(JSON.stringify(squooshBlast), rawSquooshCorpus).length,
    0,
    `Squoosh Blast leaked unbacked compliance claim: ${JSON.stringify(squooshBlast)}`
  );

  // 15. v2.5 Fixture: ECtHR Summary Scope Invariant (named institution preserved in summary prose)
  const ecthrSig = makeSyntheticSignal({
    id: 'hn-ecthr-v25-test',
    title: 'European rights court bars Romanian lawyer for 2 years over AI citations',
    source: 'HackerNews',
    sourceCategory: 'HN_COMMUNITY',
    originFeedName: 'HN · echr.coe.int',
    primarySector: 'GOV',
    url: 'https://www.echr.coe.int/w/romanian-lawyer-barred-for-two-years-from-representing-applicants-before-the-court-over-unverified-ai-generated-citations',
    rawAbstract:
      'On 13 November 2026 the President of the Court decided to exclude a Romanian lawyer from representing or otherwise assisting litigants before the Court, for a period of two years, over unverified AI-generated citations.',
  });

  assert.equal(extractNamedLegalInstitution(ecthrSig), 'European Court of Human Rights');
  const adversarialEcthrLlm: LiteracySpectrumPayload = {
    plainTitle: 'European rights court bars Romanian lawyer for 2 years over AI citations',
    plainFullTitle: 'European rights court bars Romanian lawyer for 2 years over AI citations',
    levels: {
      1: {
        analogy: 'Imagine a lawyer being barred from practicing law after relying on fake case citations.',
        everydayWhy: 'Legal filings depend on genuine references.',
      },
      2: {
        whatHappened:
          'A Romanian lawyer was barred from representing clients in court for two years after submitting AI-generated citations with numerous errors.',
        whoBuiltIt: 'Romanian lawyer',
        problemSolved: 'Highlights risks of unverified AI citations in court.',
      },
      3: {
        bridgeSummary: "The court's decision highlights citation validation requirements.",
      },
      4: {
        roiAndFinOps: 'Legal teams face disciplinary risk for unchecked AI drafts.',
        readinessAndRisk: 'Compliance posture requires independent internal legal review.',
        clientAdvice: 'Audit legal citations before court filings.',
      },
      5: {
        architectureBrief: 'Source provides no technical specifications or architecture details.',
        specsAndCaveats: 'No software benchmarks reported.',
        streetConsensus: 'Discussed on Hacker News.',
      },
    },
    glossary: [],
    generatedBy: 'OLLAMA',
  };

  assert.equal(
    validateSummaryProseScope(ecthrSig, adversarialEcthrLlm.levels[2].whatHappened).valid,
    false,
    'Vague "representing clients in court" summary must fail validateSummaryProseScope'
  );
  const fixedEcthr = enforceEpistemicAndDomainFidelity(ecthrSig, adversarialEcthrLlm, 'BANKING');
  const detEcthr = buildDeterministicLiteracyPayload(ecthrSig, 'BANKING');
  for (const p of [fixedEcthr, detEcthr]) {
    assert.ok(
      /European Court of Human Rights/i.test(p.levels[2].whatHappened),
      `L2 whatHappened must preserve European Court of Human Rights: ${p.levels[2].whatHappened}`
    );
    assert.ok(
      !/representing clients in court|barred from practicing/i.test(JSON.stringify(p)),
      `Summary leaked flattened court/practice phrase: ${JSON.stringify(p)}`
    );
    assert.equal(
      validateSummaryProseScope(ecthrSig, p.levels[2].whatHappened).valid,
      true,
      `Repaired L2 summary must pass validateSummaryProseScope: ${p.levels[2].whatHappened}`
    );
  }

  // 16. Inkling Comma-Number Benchmark Fixture (prose + live Reddit markdown table, condition, subject & unit)
  const inklingProseSig = makeSyntheticSignal({
    id: 'rd-inkling-comma-prose-v251',
    title: 'Inkling-2-Mini LexiEngine vs llama.cpp benchmark',
    source: 'Reddit',
    sourceCategory: 'REDDIT',
    originFeedName: 'r/LocalLLaMA',
    url: 'https://old.reddit.com/r/LocalLLaMA/comments/test1/inkling_lexiengine/',
    rawAbstract:
      'At a 4,096-token prompt, LexiEngine hits 2,245 prompt tokens/s vs. llama.cpp at 425 tokens/s.',
  });
  const proseNumCorpus = buildNumericAuditCorpus(inklingProseSig);
  assert.ok(
    findUnbackedNumericTokens('LexiEngine hits 245 prompt tokens/s', proseNumCorpus).length > 0,
    'Partial digit 245 must be rejected as UNBACKED when source only contains 2,245'
  );
  assert.deepEqual(
    findTruncatedCommaNumbers('LexiEngine hits 245 prompt tokens/s', proseNumCorpus),
    [{ truncated: '245', sourceNumber: '2,245' }],
    'findTruncatedCommaNumbers must catch 245 -> 2,245'
  );
  const proseMetrics = extractSourceVerifiedMetrics(inklingProseSig);
  assert.ok(
    proseMetrics.some(
      (m) =>
        m.subject === 'LexiEngine' &&
        m.value === '2,245 prompt tokens/s' &&
        m.condition === '4,096-token prompt' &&
        m.isFeatured === true
    ),
    `Expected featured LexiEngine 2,245 prompt tokens/s · 4,096-token prompt, got: ${JSON.stringify(proseMetrics)}`
  );
  assert.ok(
    proseMetrics.some(
      (m) =>
        m.subject === 'llama.cpp' &&
        m.value === '425 tokens/s' &&
        m.condition === '4,096-token prompt' &&
        m.isFeatured === false
    ),
    `Expected paired llama.cpp 425 tokens/s baseline, got: ${JSON.stringify(proseMetrics)}`
  );
  assert.ok(!proseMetrics.some((m) => /(?<![\d.,])245(?!\d)(?![.,]\d)/.test(m.value)), 'Metrics must never emit truncated 245');

  const corruptedInklingLlm: LiteracySpectrumPayload = {
    plainTitle: 'LexiEngine hits 245 tok/s',
    plainFullTitle: 'LexiEngine hits 245 prompt tokens/s vs llama.cpp',
    levels: {
      1: {
        analogy: 'Imagine a fast warehouse crew where LexiEngine moves 245 tokens per second.',
        everydayWhy: 'Faster local answering improves responsiveness.',
      },
      2: {
        whatHappened: 'LexiEngine hits 245 prompt tokens/s on local hardware.',
        whoBuiltIt: 'r/LocalLLaMA author',
        problemSolved: 'Speeds up prompt processing.',
      },
      3: {
        bridgeSummary: 'LexiEngine reaches 245 prompt tokens/s compared to llama.cpp.',
      },
      4: {
        roiAndFinOps: 'LexiEngine processes 245 prompt tokens/s locally.',
        readinessAndRisk: 'Single-user local hardware experiment.',
        clientAdvice: 'Reproduce on target hardware before deployment.',
      },
      5: {
        architectureBrief: 'Tested LexiEngine reaching 245 prompt tokens/s.',
        specsAndCaveats: 'Peak 245 prompt tokens/s reported.',
        streetConsensus: 'r/LocalLLaMA thread.',
      },
    },
    glossary: [],
    generatedBy: 'OLLAMA',
  };
  const fixedInkling = enforceEpistemicAndDomainFidelity(inklingProseSig, corruptedInklingLlm, 'BANKING');
  const detInklingBench = buildDeterministicLiteracyPayload(inklingProseSig, 'BANKING');
  for (const payload of [fixedInkling, detInklingBench]) {
    const lensBlocks = [
      `${payload.levels[1].analogy} ${payload.levels[1].everydayWhy}`,
      `${payload.levels[2].whatHappened} ${payload.levels[2].problemSolved}`,
      payload.levels[3].bridgeSummary,
      `${payload.levels[4].roiAndFinOps} ${payload.levels[4].clientAdvice}`,
      `${payload.levels[5].architectureBrief} ${payload.levels[5].specsAndCaveats}`,
    ];
    lensBlocks.forEach((txt, idx) => {
      assert.ok(txt.includes('2,245'), `Inkling L${idx + 1} must preserve 2,245: ${txt}`);
      assert.ok(txt.includes('425'), `Inkling L${idx + 1} must preserve baseline 425: ${txt}`);
      assert.ok(/prompt tokens\/s/i.test(txt), `Inkling L${idx + 1} must preserve prompt tokens/s: ${txt}`);
      assert.ok(txt.includes('4,096-token prompt'), `Inkling L${idx + 1} must preserve 4,096-token prompt: ${txt}`);
      assert.ok(!/(?<![\d.,])245(?!\d)(?![.,]\d)/.test(txt), `Inkling L${idx + 1} leaked truncated 245: ${txt}`);
    });
  }

  const inklingMarkdownSig = makeSyntheticSignal({
    id: 'rd-street-1y2cr57-sim',
    title: 'Inkling-2-Mini at 524k context on a single RX 7900 XTX vs llama.cpp',
    source: 'Reddit',
    sourceCategory: 'REDDIT',
    originFeedName: 'r/LocalLLaMA',
    url: 'https://old.reddit.com/r/LocalLLaMA/comments/1y2cr57/inkling/',
    rawAbstract:
      'Both engines ran that same file.** **BENCHMARKS, LexiEngine vs llama.cpp b12600, same card, same file** **4,096 token prompt** **LexiEngine: 2,245 tok/s prompt, 52.4 tok/s generation** **llama.cpp: 425 tok/s prompt, 25.4 tok/s generation** **16,384 token prompt** **LexiEngine: 2,148 tok/s prompt, 50.9 tok/s generation** **llama.cpp: 397 tok/s prompt, 25.0 tok/s generation**',
  });
  const mdMetrics = extractSourceVerifiedMetrics(inklingMarkdownSig);
  assert.ok(
    mdMetrics.length >= 2 &&
      mdMetrics[0].subject === 'LexiEngine' &&
      mdMetrics[0].value === '2,245 prompt tokens/s' &&
      mdMetrics[0].condition === '4,096-token prompt' &&
      mdMetrics[0].isFeatured === true,
    `Markdown Inkling must lead with LexiEngine · 2,245 prompt tokens/s · 4,096-token prompt, got: ${JSON.stringify(mdMetrics)}`
  );
  assert.ok(
    mdMetrics.some((m) => m.subject === 'llama.cpp' && m.value === '425 prompt tokens/s' && m.condition === '4,096-token prompt'),
    `Markdown Inkling must pair llama.cpp 425 prompt tokens/s baseline, got: ${JSON.stringify(mdMetrics)}`
  );
  assert.ok(!mdMetrics.some((m) => /(?<![\d.,])245(?!\d)(?![.,]\d)/.test(m.value)), 'Markdown Inkling must never emit 245');

  // 17. Gemini Effort Comparison Fixture (5,311 vs 31,477 output tokens)
  const geminiEffortSig = makeSyntheticSignal({
    id: 'bsky-gemini-effort-v251',
    title:
      'Gemini 4 tip: the difference between Gemini 4 Hydrogen on "high" thinking effort and that same model on "xhigh" is VERY significant Here\'s…',
    source: 'Bluesky',
    sourceCategory: 'SOCIAL_BLUESKY',
    originFeedName: 'Bluesky · @simonwillison',
    url: 'https://bsky.app/profile/simonwillison.net/post/3n2tsb6pguk27',
    rawAbstract:
      'Gemini 4 tip: the difference between Gemini 4 Hydrogen on "high" thinking effort and that same model on "xhigh" is VERY significant Here\'s the high v.s. the xhigh pelican - high cost 3.99 cents and used 5,311 output tokens, xhigh cost 23.61 cents and used 31,477 output tokens',
  });
  const geminiCorpus = buildNumericAuditCorpus(geminiEffortSig);
  assert.ok(
    findUnbackedNumericTokens("on 'xhigh' effort level it used 31 tokens", geminiCorpus).length > 0,
    'Partial digit 31 must be flagged as UNBACKED when source only contains 31,477'
  );
  assert.deepEqual(
    findTruncatedCommaNumbers("used 31 tokens and 5,311 output tokens", geminiCorpus),
    [{ truncated: '31', sourceNumber: '31,477' }],
    'findTruncatedCommaNumbers must map truncated 31 -> 31,477'
  );
  const geminiMetrics = extractSourceVerifiedMetrics(geminiEffortSig);
  assert.ok(
    geminiMetrics.some((m) => m.subject === 'high' && m.value === '5,311 output tokens'),
    `Gemini effort metrics must attribute 5,311 output tokens to high, got: ${JSON.stringify(geminiMetrics)}`
  );
  assert.ok(
    geminiMetrics.some((m) => m.subject === 'xhigh' && m.value === '31,477 output tokens'),
    `Gemini effort metrics must attribute 31,477 output tokens to xhigh, got: ${JSON.stringify(geminiMetrics)}`
  );
  const corruptedGeminiLlm: LiteracySpectrumPayload = {
    plainTitle: 'Gemini 4 Hydrogen high vs xhigh effort',
    plainFullTitle: 'Gemini 4 Hydrogen thinking effort comparison',
    levels: {
      1: {
        analogy:
          'Imagine asking a researcher for a quick note at 5,311 output tokens versus a deeper review at 31 output tokens.',
        everydayWhy: 'Higher thinking effort changes response length and cost.',
      },
      2: {
        whatHappened:
          "Gemini 4 Hydrogen on 'high' effort used 5,311 output tokens and cost 3.99 cents, while on 'xhigh' effort it used 31 tokens and cost 23.61 cents.",
        whoBuiltIt: 'Simon Willison on Bluesky',
        problemSolved: 'Compares token usage across reasoning settings.',
      },
      3: {
        bridgeSummary: 'High effort used 5,311 output tokens whereas xhigh used 31 tokens.',
      },
      4: {
        roiAndFinOps: 'High used 5,311 output tokens vs xhigh at 31 tokens (23.61 cents).',
        readinessAndRisk: 'Observed social benchmark.',
        clientAdvice: 'Monitor output token spend across thinking modes.',
      },
      5: {
        architectureBrief: 'Evaluates Gemini 4 Hydrogen across high (5,311 tokens) and xhigh (31 tokens).',
        specsAndCaveats: 'high: 5,311 tokens; xhigh: 31 tokens.',
        streetConsensus: 'Bluesky thread.',
      },
    },
    glossary: [],
    generatedBy: 'OLLAMA',
  };
  const fixedGemini = enforceEpistemicAndDomainFidelity(geminiEffortSig, corruptedGeminiLlm, 'BANKING');
  const detGemini = buildDeterministicLiteracyPayload(geminiEffortSig, 'BANKING');
  for (const payload of [fixedGemini, detGemini]) {
    const lensBlocks = [
      `${payload.levels[1].analogy} ${payload.levels[1].everydayWhy}`,
      `${payload.levels[2].whatHappened} ${payload.levels[2].problemSolved}`,
      payload.levels[3].bridgeSummary,
      `${payload.levels[4].roiAndFinOps} ${payload.levels[4].clientAdvice}`,
      `${payload.levels[5].architectureBrief} ${payload.levels[5].specsAndCaveats}`,
    ];
    lensBlocks.forEach((txt, idx) => {
      assert.ok(txt.includes('5,311'), `Gemini effort L${idx + 1} must preserve 5,311: ${txt}`);
      assert.ok(txt.includes('31,477'), `Gemini effort L${idx + 1} must preserve 31,477: ${txt}`);
      assert.ok(!/(?<![\d.,])31(?!\d)(?![.,]\d)/.test(txt), `Gemini effort L${idx + 1} leaked truncated 31: ${txt}`);
    });
  }

  // 18. Hebbia Cross-Domain / Cross-Version Clustering Isolation Fixture
  const hebbiaBase = {
    title: 'Hebbia sees improvements in financial research with GPT-6 Astra',
    url: 'https://openai.com/business/customer-stories/hebbia',
    originFeedName: 'OpenAI News',
  };
  const bskyThreeJs = {
    title:
      'Here\'s GPT-6.2 Astra and GPT-6.2 Sol for "Make a three js animation where yonkers stands up as a big mech (cool stand up motion) and…',
    url: 'https://bsky.app/profile/simonwillison.net/post/3n2k4j57tg22m',
    originFeedName: 'Bluesky · @simonwillison',
  };
  const bskySameVersionThreeJs = {
    title: 'Testing GPT-6 Astra on a three.js mech animation scene',
    url: 'https://bsky.app/profile/someone/post/123',
    originFeedName: 'Bluesky',
  };
  const hebbiaHnFollowup = {
    title: 'Hebbia financial research evaluation using GPT-6 Astra',
    url: 'https://news.ycombinator.com/item?id=999999',
    originFeedName: 'Hacker News',
  };
  assert.equal(
    shouldClusterIntoSupernova(hebbiaBase, bskyThreeJs),
    false,
    'Hebbia GPT-6 Astra evaluation must NEVER cluster with Bluesky GPT-6.2 Three.js animation'
  );
  assert.equal(
    shouldClusterIntoSupernova(hebbiaBase, bskySameVersionThreeJs),
    false,
    'Hebbia financial research must NEVER cluster with unrelated Three.js animation even on GPT-6 Astra'
  );
  assert.equal(
    shouldClusterIntoSupernova(hebbiaBase, hebbiaHnFollowup),
    true,
    'Hebbia story sharing both GPT-6 Astra and financial research subject should still cluster'
  );
  assert.equal(
    shouldClusterIntoSupernova(
      {
        title: 'Claude Code v2.1.330',
        url: 'https://github.com/anthropics/claude-code/releases/tag/v2.1.330',
      },
      {
        title: 'I built kvdiff (MIT): a local proxy across Codex, Claude Code, and local LLMs',
        url: 'https://old.reddit.com/r/ChatGPTCoding/comments/abc/kvdiff/',
      }
    ),
    false,
    'Claude Code GitHub release must not cluster unrelated third-party proxy builds'
  );
  assert.equal(
    shouldClusterIntoSupernova(
      {
        title: 'Introducing Gemini 4 Neon',
        url: 'https://deepmind.google/blog/introducing-gemini-4-neon/',
      },
      {
        title: 'Gemini 4 Neon coded a ski simulator based on real Mont Blanc terrain.',
        url: 'https://x.com/GoogleDeepMind/status/123',
      }
    ),
    true,
    'Official Gemini 4 Neon launch must still cluster official launch showcase'
  );

  const hebbiaWithContaminatedLink = makeSyntheticSignal({
    id: 'lab-hebbia-isolation-test',
    ...hebbiaBase,
    source: 'LabRelease',
    sourceCategory: 'AI_LAB',
    rawAbstract:
      'Hebbia tested GPT-6 Astra in financial research workflows. It scored 13.6 percentage points above the best alternative tested on citing the required types of sources, while 99.5% of the excerpts it cited were relevant to the question.',
    supportingSources: [
      {
        source: 'OpenAI News',
        title: hebbiaBase.title,
        url: hebbiaBase.url,
        publishedAt: new Date(nowMs - 2 * 3600_000).toISOString(),
        publishedAtMs: nowMs - 2 * 3600_000,
        isPrimary: true,
      },
      {
        source: 'Bluesky · @simonwillison',
        title: bskyThreeJs.title,
        url: bskyThreeJs.url,
        publishedAt: new Date(nowMs - 48 * 3600_000).toISOString(),
        publishedAtMs: nowMs - 48 * 3600_000,
        isPrimary: false,
      },
    ],
  });
  assert.equal(
    classifySupportingLinkRelation(hebbiaWithContaminatedLink, hebbiaWithContaminatedLink.supportingSources![1]),
    'related_reading',
    'Unrelated Bluesky Three.js post must be quarantined as related_reading'
  );
  const hebbiaCov = analyzeClusterCoverage(hebbiaWithContaminatedLink);
  assert.equal(hebbiaCov.sameEventLinks.length, 1, 'Hebbia same-event evidence must stay single-source');
  assert.equal(hebbiaCov.relatedReadingLinks.length, 1, 'Hebbia unrelated link separates into relatedReadingLinks');
  assert.equal(hebbiaCov.hasIndependentCorroboration, false);

  // 19. Hierarchos-Native Scoped Metric & Author Caveat Fixture
  const hierarchosReleaseSig = makeSyntheticSignal({
    id: 'rd-hierarchos-19a-v252',
    title: 'Hierarchos-Native v0.2.5 achieves up to 27% faster GPU matrix multiplication',
    source: 'Reddit',
    sourceCategory: 'REDDIT',
    originFeedName: 'r/singularity',
    url: 'https://www.reddit.com/r/singularity/comments/19a/hierarchos/',
    rawAbstract:
      'Hierarchos-Native v0.2.5 updates the FP16 WMMA kernel (P3) and achieves up to 27% faster GPU matrix multiplication in the tested workloads. Do not interpret 27% as a speedup for an entire training run; this benchmark only applies to isolated per-dispatch GPU matrix multiplication.',
  });

  const hierarchosLiveStyleSig = makeSyntheticSignal({
    id: 'rd-hierarchos-19b-v252',
    title: 'Hierarchos-Native v0.2.5 is finally out! P3 WMMA update',
    source: 'Reddit',
    sourceCategory: 'REDDIT',
    originFeedName: 'r/singularity',
    url: 'https://www.reddit.com/r/singularity/comments/1y2epi4/hierarchosnative/',
    rawAbstract:
      "the P3 update improves the Full FP16 WMMA kernel cooperative multiplication. the measured improvements against the preserved Main kernel baseline passed across all four protected workloads independently, including the lower bounds of their confidence intervals. the largest measured improvement was around 27%. just to clarify, these are per-dispatch GPU GEMM measurements, not end-to-end training speedups. i don't want to imply that an entire training run is suddenly 27% faster when that isn't what was measured.",
  });

  for (const hSig of [hierarchosReleaseSig, hierarchosLiveStyleSig]) {
    const hMetrics = extractSourceVerifiedMetrics(hSig);
    const pctBadges = hMetrics.filter((m) => m.value.includes('27%'));
    assert.equal(
      pctBadges.length,
      1,
      `Hierarchos ${hSig.id} must emit strictly ONE deduplicated 27% metric pill, got: ${JSON.stringify(hMetrics)}`
    );
    const badge = pctBadges[0];
    assert.ok(
      badge.value.includes('Up to 27%') && /GPU matrix multiplication/i.test(badge.label),
      `Badge must preserve "Up to 27%" and "GPU matrix multiplication", got: ${badge.value} · ${badge.label}`
    );
    assert.ok(
      !(badge.value === '27%' && badge.label === 'Reported faster'),
      'Badge must never regress to vague "27% · Reported faster"'
    );
    assert.ok(
      !/^improvement$/i.test(badge.subject || ''),
      `Metric subject must not be generic noun "improvement": ${badge.subject}`
    );
    assert.equal(
      isMetricWarningOrNegationSentence(badge.quote),
      false,
      `Positive badge quote must bind to claim passage, NOT warning sentence: ${badge.quote}`
    );
    assert.ok(
      badge.caveat && badge.caveat.length > 15 && isMetricWarningOrNegationSentence(badge.caveat),
      `Badge must attach author warning as verbatim caveat: ${JSON.stringify(badge)}`
    );

    const adversarialHierarchosLlm: LiteracySpectrumPayload = {
      plainTitle: 'Hierarchos-Native speeds up training',
      plainFullTitle: 'Hierarchos-Native v0.2.5 makes entire training runs 27% faster',
      levels: {
        1: {
          analogy:
            'Imagine upgrading a highway engine so an entire training run is 27% faster from start to finish.',
          everydayWhy: 'Speeds up an entire training run by 27%.',
        },
        2: {
          whatHappened: 'Hierarchos-Native v0.2.5 achieves a 27% speedup for an entire training run.',
          whoBuiltIt: 'Hierarchos author',
          problemSolved: 'Makes entire training runs 27% faster.',
        },
        3: {
          bridgeSummary: 'P3 WMMA makes end-to-end training runs 27% faster.',
        },
        4: {
          roiAndFinOps: 'Delivers 27% faster end-to-end training across workloads.',
          readinessAndRisk: 'Single-User / Local Hardware Experiment.',
          clientAdvice: 'Deploy for full training speedups.',
        },
        5: {
          architectureBrief: 'P3 kernel makes an entire training run 27% faster.',
          specsAndCaveats: '27% · Reported faster.',
          streetConsensus: 'r/singularity thread.',
        },
      },
      glossary: [],
      generatedBy: 'OLLAMA',
    };

    const fixedH = enforceEpistemicAndDomainFidelity(hSig, adversarialHierarchosLlm, 'BANKING');
    const detH = buildDeterministicLiteracyPayload(hSig, 'BANKING');

    for (const payload of [fixedH, detH]) {
      assert.equal(
        hasBannedL1Jargon(`${payload.levels[1].analogy} ${payload.levels[1].everydayWhy}`),
        false,
        `Hierarchos L1 must remain free of banned technical acronyms: ${JSON.stringify(payload.levels[1])}`
      );

      const overbroadRx =
        /(?:(?:makes?|speeds?\s+up)\s+(?:an?\s+)?(?:entire|whole|full|end[- ]to[- ]end)\s+training(?:\s+run)?s?(?:\s+by)?\s+(?:up\s+to\s+)?27%|(?:entire|whole|full|end[- ]to[- ]end)\s+training(?:\s+run)?s?\s+(?:is|are|runs?)\s+(?:suddenly\s+)?(?:up\s+to\s+)?27%\s+faster|27%\s+(?:faster|speedup)\s+(?:for|on|across)\s+(?:an?\s+)?(?:entire|whole|full|end[- ]to[- ]end)\s+training(?:\s+run)?)/i;
      const explicitNegationRx =
        /\b(?:don['’]t\s+want\s+to\s+imply|do\s+not\s+want\s+to\s+imply|do\s+not\s+interpret|don['’]t\s+interpret|isn['’]t\s+what\s+was\s+measured|not\s+(?:a|an)\s+(?:overall\s+)?(?:speedup|end[- ]to[- ]end)|not\s+end[- ]to[- ]end|never\s+(?:a\s+)?speedup|rather\s+than)\b/i;

      for (const f of collectLiteracyFields(payload)) {
        for (const sent of f.split(/(?<=[.!?])\s+/)) {
          if (overbroadRx.test(sent)) {
            assert.ok(
              explicitNegationRx.test(sent),
              `Hierarchos summary must NEVER claim an unhedged 27% speedup for an entire training run: ${sent}`
            );
          }
        }
      }

      const lensTexts = [
        `${payload.levels[1].analogy} ${payload.levels[1].everydayWhy}`,
        `${payload.levels[2].whatHappened} ${payload.levels[2].problemSolved}`,
        payload.levels[3].bridgeSummary,
        `${payload.levels[4].roiAndFinOps} ${payload.levels[4].clientAdvice}`,
        `${payload.levels[5].architectureBrief} ${payload.levels[5].specsAndCaveats}`,
      ];
      lensTexts.forEach((txt, idx) => {
        assert.ok(
          /\b(?:matrix\s+multiplication|tested\s+workloads?|per[- ]dispatch|gpu\s+gemm|\bgemm\b)\b/i.test(txt),
          `Hierarchos L${idx + 1} must retain narrow workload scope: ${txt}`
        );
        assert.ok(
          /\b(?:caveat|not\s+(?:measured\s+as\s+)?an?\s+(?:end[- ]to[- ]end|overall)|not\s+end[- ]to[- ]end|rather\s+than\s+an?\s+overall|only\s+applies\s+to|per[- ]dispatch)\b/i.test(
            txt
          ),
          `Hierarchos L${idx + 1} must preserve author caveat: ${txt}`
        );
      });
    }
  }

  // Warning-only sentence without positive benchmark claim must emit zero "Reported faster" badges
  const warningOnlySig = makeSyntheticSignal({
    id: 'rd-hierarchos-warning-only-v252',
    title: 'Author clarification on training benchmark',
    source: 'Reddit',
    sourceCategory: 'REDDIT',
    rawAbstract:
      'Do not interpret 27% as a speedup for an entire training run when that is not what was measured.',
  });
  const warnOnlyMetrics = extractSourceVerifiedMetrics(warningOnlySig);
  assert.equal(
    warnOnlyMetrics.filter((m) => m.value.includes('27%') || /reported faster/i.test(m.label)).length,
    0,
    `Warning-only sentence must emit 0 positive/Reported faster badges, got: ${JSON.stringify(warnOnlyMetrics)}`
  );
}

function runLiveSnapshotAndArchiveAssertions(): void {
  assert.ok(fs.existsSync(SNAPSHOT_PATH), `Missing baked snapshot at ${SNAPSHOT_PATH}`);
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as StaticGalaxySnapshot;
  assert.equal(snapshot.promptVersion, 'v2.5.2', 'Snapshot must carry promptVersion v2.5.2');
  assert.ok(Array.isArray(snapshot.signals) && snapshot.signals.length > 0, 'Snapshot must contain signals');
  assert.ok(fs.existsSync(RSS_PATH), `Missing RSS output at ${RSS_PATH}`);
  const rssXml = fs.readFileSync(RSS_PATH, 'utf8');

  assert.ok(fs.existsSync(ARCHIVE_PATH), `Missing durable permalink archive at ${ARCHIVE_PATH}`);
  const archive = JSON.parse(fs.readFileSync(ARCHIVE_PATH, 'utf8')) as StaticSignalArchive;
  assert.equal(archive.version, 1);
  assert.ok(Array.isArray(archive.entries) && archive.entries.length > 0, 'Signal archive must contain entries');
  assert.equal(archive.count, archive.entries.length);
  assert.ok(archive.entries.length <= 2000, 'Archive must stay capped at <= 2000 entries');
  const seenArchiveIds = new Set<string>();
  const positiveMetricRx = /(?:faster|speedup|improvement|reduction|higher|gain|percentage)/i;
  const badSubjectRx =
    /^(?:and|or|but|the|a|an|for|with|from|to|in|on|at|by|of|as|is|are|was|were|it|they|its|improvement|improvements|speedup|speedups|gain|gains|reduction|reductions|accuracy|latency|throughput|performance|result|results)$/i;
  for (const entry of archive.entries) {
    assert.ok(entry.id && entry.title && entry.url, `Invalid archive entry: ${JSON.stringify(entry)}`);
    assert.ok(!seenArchiveIds.has(entry.id), `Duplicate archive ID: ${entry.id}`);
    seenArchiveIds.add(entry.id);
    for (const vm of entry.verifiedMetrics || []) {
      assert.ok(
        !vm.subject || !badSubjectRx.test(vm.subject.trim()),
        `Archived signal ${entry.id} verifiedMetrics leaked bad subject "${vm.subject}"`
      );
      if (positiveMetricRx.test(`${vm.value} ${vm.label}`)) {
        assert.equal(
          isMetricWarningOrNegationSentence(vm.quote),
          false,
          `Archived signal ${entry.id} positive metric pill bound to author warning/negation quote: ${vm.quote}`
        );
      }
    }
  }

  const refNowMs = snapshot.bakedAtMs || Date.now();
  const max7dMs = 7 * 24 * 3600_000;
  const max30dMs = 30 * 24 * 3600_000;
  const top48hMs = 48 * 3600_000;
  const top72hMs = 72 * 3600_000;

  for (const sig of snapshot.signals) {
    assert.equal(sig.modelSpecs, undefined, `Live signal ${sig.id} still carries synthetic modelSpecs`);

    const ageMs = refNowMs - sig.publishedAtMs;
    const updatedRecently =
      isUpstreamUpdatedSignal(sig) &&
      typeof sig.updatedAtMs === 'number' &&
      refNowMs - sig.updatedAtMs <= top48hMs &&
      ageMs <= max30dMs;
    assert.ok(
      ageMs >= -3600_000 && (ageMs <= max7dMs || updatedRecently),
      `Stale signal >7d without recent upstream update: ${sig.id} (${sig.title})`
    );

    const lit = snapshot.literacyBySignalId[sig.id] || sig.literacy;
    assert.ok(lit, `Missing literacy for ${sig.id}`);

    const serializedSignalAndLit = `${sig.rawAbstract} ${JSON.stringify(lit)}`;
    assert.ok(
      !/error while loading|please reload this page|loading errors reported|sorry,\s*something went wrong|words per second|compact ai model/i.test(
        serializedSignalAndLit
      ),
      `Live signal ${sig.id} leaked boilerplate or flattened jargon/unit: ${sig.title}`
    );

    // Semantic-invariant headline validation (cond/legal fidelity)
    const ptCheck = validateHeadlineMeaningPreserved(sig, lit.plainTitle);
    assert.ok(
      ptCheck.valid && !ptCheck.forceVerbatimPublisherFallback,
      `Live signal ${sig.id} plainTitle failed meaning check (${ptCheck.reason}): ${lit.plainTitle}`
    );
    const pftCheck = validateHeadlineMeaningPreserved(sig, lit.plainFullTitle);
    assert.ok(
      pftCheck.valid && !pftCheck.forceVerbatimPublisherFallback,
      `Live signal ${sig.id} plainFullTitle failed meaning check (${pftCheck.reason}): ${lit.plainFullTitle}`
    );

    // Summary prose scope validation across legal/conditional stories
    const sumScopeCheck = validateSummaryProseScope(sig, lit.levels[2].whatHappened);
    assert.ok(
      sumScopeCheck.valid,
      `Live signal ${sig.id} L2 summary failed scope guard (${sumScopeCheck.reason}): ${lit.levels[2].whatHappened}`
    );

    // Card-wide numeric grounding, comma-truncation guard AND zero unbacked compliance audit across ALL L1-L5 fields & Blast
    const numCorpus = buildNumericAuditCorpus(sig);
    const rawPrimaryCorpus = `${sig.title || ''} ${sig.rawAbstract || ''}`;
    const compCorpus = buildRawComplianceCorpus(sig);
    for (const vm of sig.verifiedMetrics || []) {
      assert.ok(
        !vm.subject || !badSubjectRx.test(vm.subject.trim()),
        `Live signal ${sig.id} verifiedMetrics leaked bad subject "${vm.subject}" on ${vm.value}`
      );
      if (positiveMetricRx.test(`${vm.value} ${vm.label}`)) {
        assert.equal(
          isMetricWarningOrNegationSentence(vm.quote),
          false,
          `Live signal ${sig.id} positive metric pill bound to author warning/negation quote: ${vm.quote}`
        );
      }
      const pillTxt = [vm.subject, vm.value, vm.condition].filter(Boolean).join(' ');
      const pillTruncs = findTruncatedCommaNumbers(pillTxt, rawPrimaryCorpus);
      assert.deepEqual(
        pillTruncs,
        [],
        `Live signal ${sig.id} verifiedMetrics pill contains truncated comma number: ${JSON.stringify(pillTruncs)} in ${pillTxt}`
      );
    }
    for (const field of collectLiteracyFields(lit)) {
      const truncHits = findTruncatedCommaNumbers(field, numCorpus);
      assert.deepEqual(
        truncHits,
        [],
        `Live signal ${sig.id} contains truncated comma number(s) ${JSON.stringify(truncHits)} in field: ${field}`
      );
      const unbackedNums = findUnbackedNumericTokens(field, numCorpus);
      assert.deepEqual(
        unbackedNums,
        [],
        `Live signal ${sig.id} contains unbacked number(s) [${unbackedNums.join(', ')}] in field: ${field}`
      );
      const unbackedComp = findUnbackedComplianceClaims(field, compCorpus);
      assert.deepEqual(
        unbackedComp,
        [],
        `Live signal ${sig.id} contains unbacked compliance claim(s) [${unbackedComp.join(', ')}] in field: ${field}`
      );
    }

    const blast = computeProportionateBlast(sig, 'BANKING');
    for (const h of blast.horizons) {
      for (const hField of [h.title, h.consequence, h.consultantAction, h.kpiMetric]) {
        assert.deepEqual(
          findUnbackedNumericTokens(hField, numCorpus),
          [],
          `Live signal ${sig.id} Blast card contains unbacked number(s): ${hField}`
        );
        assert.deepEqual(
          findUnbackedComplianceClaims(hField, compCorpus),
          [],
          `Live signal ${sig.id} Blast card contains unbacked compliance claim(s): ${hField}`
        );
      }
    }

    const quoteCorpus = [
      sig.title || '',
      sig.rawAbstract || '',
      ...(sig.streetQuotes || []).map((q) => q.text || ''),
    ].join(' ');
    assertAllQuotesVerbatim(
      [
        lit.plainTitle,
        lit.plainFullTitle,
        lit.levels[1].analogy,
        lit.levels[1].everydayWhy,
        lit.levels[2].whatHappened,
        lit.levels[2].problemSolved,
        lit.levels[3].bridgeSummary,
        lit.levels[4].roiAndFinOps,
        lit.levels[4].readinessAndRisk,
        lit.levels[4].clientAdvice,
        lit.levels[5].architectureBrief,
        lit.levels[5].specsAndCaveats,
        lit.levels[5].streetConsensus,
      ],
      quoteCorpus,
      `Live signal ${sig.id}`
    );

    if (isReleaseWithoutNotes(sig)) {
      assert.ok(
        lit.levels[2].whatHappened.includes(NO_RELEASE_NOTES_NOTICE),
        `Live no-notes release ${sig.id} must use neutral NO_RELEASE_NOTES_NOTICE`
      );
      assert.equal(lit.glossary.length, 0, `Live no-notes release ${sig.id} must have empty glossary`);
    }

    if (classifyEvidenceScope(sig) === 'single_user_experiment') {
      assert.equal(blast.horizons.length, 1, `Live single-user ${sig.id} must have 1 Practical Next Step`);
      assert.ok(
        !/financial[- ]services|threefold|\b3x\b/i.test(JSON.stringify(blast.horizons)),
        `Live single-user ${sig.id} blast leaked banking/3x template`
      );
    }

    if (classifyEvidenceScope(sig) === 'discussion_or_personal') {
      assert.equal(blast.mode, 'READ_DISCUSSION');
      assert.equal(blast.horizons.length, 1);
      assert.equal(blast.horizons[0].title, 'Read the original discussion');
      assert.ok(
        !/reproduce the test|target hardware|30d pilot/i.test(JSON.stringify(lit.levels[4])),
        `Live discussion signal ${sig.id} leaked hardware/enterprise L4 text`
      );
    }

    const liveBench = extractBenchmarkClaimSpec(sig);
    if (liveBench) {
      const liveLensBlocks = [
        `${lit.levels[1].analogy} ${lit.levels[1].everydayWhy}`,
        `${lit.levels[2].whatHappened}`,
        lit.levels[3].bridgeSummary,
        `${lit.levels[4].roiAndFinOps}`,
        `${lit.levels[5].architectureBrief} ${lit.levels[5].specsAndCaveats}`,
      ];
      liveLensBlocks.forEach((txt, idx) => {
        assert.ok(!/modern cpus|leading chips/i.test(txt), `Live signal ${sig.id} L${idx + 1} broadened baseline: ${txt}`);
        assert.ok(
          txt.toLowerCase().includes(liveBench.metric.toLowerCase()),
          `Live signal ${sig.id} L${idx + 1} missing metric ${liveBench.metric}`
        );
        assert.ok(
          txt.toLowerCase().includes(liveBench.attribution.toLowerCase()),
          `Live signal ${sig.id} L${idx + 1} missing attribution ${liveBench.attribution}`
        );
      });
    }

    if (isHedgedOrUnverifiedClaim(sig)) {
      const checkedFields = [
        lit.plainFullTitle,
        lit.levels[1].analogy,
        lit.levels[2].whatHappened,
        lit.levels[3].bridgeSummary,
        lit.levels[5].architectureBrief,
      ];
      for (const f of checkedFields) {
        assert.ok(
          /\b(may|might|could|claims?|claimed|purports?|reportedly|allegedly|unverified|unconfirmed|tentative|awaiting|potentially)\b/i.test(
            f
          ),
          `Live hedged signal ${sig.id} lost uncertainty in field: ${f}`
        );
      }
    }

    if (isEvaluationQualityStudy(sig)) {
      assert.ok(
        !/Non-engineering business, policy, or commentary signal/i.test(
          lit.levels[5].specsAndCaveats
        ),
        `Live evaluation study ${sig.id} fell back to non-engineering L5 caveats: ${lit.levels[5].specsAndCaveats}`
      );
    }

    if (!hasTechnicalEngineeringContent(sig)) {
      assert.ok(
        /Source provides no technical specifications or architecture details/i.test(
          lit.levels[5].architectureBrief
        ),
        `Live non-technical signal ${sig.id} missing no-specs disclosure in L5`
      );
      assert.ok(
        !/control trading volume|finops cascade|context window/i.test(lit.levels[3].bridgeSummary),
        `Live non-technical signal ${sig.id} has fabricated L3 tech jargon: ${lit.levels[3].bridgeSummary}`
      );
    }

    const relMeta = getSignalReleaseMetadata(sig);
    if (relMeta) {
      assert.ok(
        sig.title.toLowerCase().includes(relMeta.productName.toLowerCase()),
        `Live release ${sig.id} missing product name: ${sig.title}`
      );
      assert.ok(
        sig.title.toLowerCase().includes(relMeta.versionLabel.toLowerCase()),
        `Live release ${sig.id} missing full version: ${sig.title}`
      );
      if (relMeta.isPreRelease) {
        assert.notEqual(sig.readiness, 'GA', `Pre-release ${sig.id} must not be marked GA`);
      }
    }

    const cov = analyzeClusterCoverage(sig);
    if (!cov.hasIndependentCorroboration) {
      assert.ok(
        !/corroborated/i.test(cov.provenanceHeadlineLabel),
        `Non-corroborated cluster ${sig.id} claimed corroboration: ${cov.provenanceHeadlineLabel}`
      );
    }
    for (const sameLink of cov.sameEventLinks) {
      if (sameLink.url !== sig.url) {
        assert.ok(
          shouldClusterIntoSupernova(sig, sameLink),
          `Live signal ${sig.id} same-event link failed strict cluster guard: ${sameLink.title}`
        );
      }
    }
  }

  // Specific assertions on live Inkling / Gemini effort / Hebbia / Squoosh Bench / ECtHR / TideCache / Ask HN targets when in snapshot window
  const liveHierarchos = snapshot.signals.find((s) => s.id === 'rd-street-1y2epi4');
  if (liveHierarchos) {
    const hMetrics = liveHierarchos.verifiedMetrics || [];
    const h27 = hMetrics.filter((m) => m.value.includes('27%'));
    assert.equal(h27.length, 1, `Live Hierarchos must deduplicate into one 27% pill, got: ${JSON.stringify(hMetrics)}`);
    assert.ok(
      h27[0].value.includes('Up to 27%') && /GPU matrix multiplication/i.test(h27[0].label),
      `Live Hierarchos pill must preserve Up to 27% + GPU matrix multiplication: ${JSON.stringify(h27[0])}`
    );
    assert.equal(isMetricWarningOrNegationSentence(h27[0].quote), false);
    assert.ok(Boolean(h27[0].caveat), 'Live Hierarchos pill must include verbatim author caveat');
    const hLit = snapshot.literacyBySignalId[liveHierarchos.id];
    const hOverbroadRx =
      /(?:(?:makes?|speeds?\s+up)\s+(?:an?\s+)?(?:entire|whole|full|end[- ]to[- ]end)\s+training(?:\s+run)?s?(?:\s+by)?\s+(?:up\s+to\s+)?27%|(?:entire|whole|full|end[- ]to[- ]end)\s+training(?:\s+run)?s?\s+(?:is|are|runs?)\s+(?:suddenly\s+)?(?:up\s+to\s+)?27%\s+faster|27%\s+(?:faster|speedup)\s+(?:for|on|across)\s+(?:an?\s+)?(?:entire|whole|full|end[- ]to[- ]end)\s+training(?:\s+run)?)/i;
    const hNegRx =
      /\b(?:don['’]t\s+want\s+to\s+imply|do\s+not\s+want\s+to\s+imply|do\s+not\s+interpret|don['’]t\s+interpret|isn['’]t\s+what\s+was\s+measured|not\s+(?:a|an)\s+(?:overall\s+)?(?:speedup|end[- ]to[- ]end)|not\s+end[- ]to[- ]end|never\s+(?:a\s+)?speedup|rather\s+than)\b/i;
    for (const f of collectLiteracyFields(hLit)) {
      for (const sent of f.split(/(?<=[.!?])\s+/)) {
        if (hOverbroadRx.test(sent)) {
          assert.ok(
            hNegRx.test(sent),
            `Live Hierarchos L1-L5 claimed end-to-end training 27% speedup without negation: ${sent}`
          );
        }
      }
    }
  }

  const liveInklingBench = snapshot.signals.find((s) => s.id === 'rd-street-1y2cr57');
  if (liveInklingBench) {
    const iMetrics = liveInklingBench.verifiedMetrics || [];
    assert.ok(
      iMetrics.some((m) => m.value.includes('2,245') && m.condition === '4,096-token prompt'),
      `Live Inkling benchmark must extract 2,245 with 4,096-token prompt, got: ${JSON.stringify(iMetrics)}`
    );
    assert.ok(
      !iMetrics.some((m) => /(?<![\d.,])245(?!\d)(?![.,]\d)/.test(m.value)),
      `Live Inkling metrics must never emit truncated 245`
    );
    const iLit = snapshot.literacyBySignalId[liveInklingBench.id];
    const iDump = JSON.stringify(iLit.levels);
    assert.ok(iDump.includes('2,245'), 'Live Inkling literacy must preserve 2,245');
    assert.ok(iDump.includes('4,096-token prompt'), 'Live Inkling literacy must preserve 4,096-token prompt');
    assert.ok(!/(?<![\d.,])245(?!\d)(?![.,]\d)/.test(iDump), 'Live Inkling literacy must never contain truncated 245');
  }

  const liveGeminiEffort = snapshot.signals.find((s) => s.id === 'bsky-simonwillison.net-3n2tsb6pguk27');
  if (liveGeminiEffort) {
    const gLit = snapshot.literacyBySignalId[liveGeminiEffort.id];
    const gDump = JSON.stringify(gLit.levels);
    assert.ok(gDump.includes('5,311') && gDump.includes('31,477'), 'Live Gemini effort must preserve 5,311 and 31,477');
    assert.ok(!/(?<![\d.,])31(?!\d)(?![.,]\d)/.test(gDump), 'Live Gemini effort must never contain truncated 31');
  }

  const liveHebbia = snapshot.signals.find((s) => s.id === 'lab-openai-naicombusinesscustomer-storieshebbia');
  if (liveHebbia) {
    const hCov = analyzeClusterCoverage(liveHebbia);
    assert.ok(
      !hCov.sameEventLinks.some((s) => /three\.?js|bsky\.app|yonkers/i.test(`${s.title} ${s.url}`)),
      `Live Hebbia same-event links must not include unrelated Bluesky Three.js post: ${JSON.stringify(hCov.sameEventLinks)}`
    );
  }
  const liveSquoosh = snapshot.signals.find((s) => s.id === 'hf-2611.25200');
  if (liveSquoosh) {
    const metrics = liveSquoosh.verifiedMetrics || [];
    assert.ok(
      metrics.length >= 2 && metrics[0].subject === 'UX-1' && metrics[0].value === '84.0%',
      `Live Squoosh Bench must order UX-1 84.0% first, got: ${JSON.stringify(metrics)}`
    );
    assert.ok(
      metrics.some((m) => m.subject === 'Qwen3 Next 80B' && m.value === '61.6%'),
      `Live Squoosh Bench must pair baseline Qwen3 Next 80B 61.6%, got: ${JSON.stringify(metrics)}`
    );
    const sLit = snapshot.literacyBySignalId[liveSquoosh.id];
    assert.ok(
      sLit.levels[4].readinessAndRisk.includes(COMPLIANCE_NOT_ASSESSED_STUDY),
      `Live Squoosh L4 must report "${COMPLIANCE_NOT_ASSESSED_STUDY}"`
    );
  }

  const liveEcthr = snapshot.signals.find((s) => s.id === 'hn-50579237');
  if (liveEcthr) {
    const eLit = snapshot.literacyBySignalId[liveEcthr.id];
    assert.ok(
      /European Court of Human Rights/i.test(eLit.levels[2].whatHappened),
      `Live ECtHR L2 summary must name European Court of Human Rights: ${eLit.levels[2].whatHappened}`
    );
    assert.ok(
      !/representing clients in court|barred from practicing/i.test(JSON.stringify(eLit)),
      'Live ECtHR summary leaked generic court/practice wording'
    );
  }

  const liveTide = snapshot.signals.find((s) => s.id === 'arxiv-httparxivorgabs261126619v1');
  if (liveTide) {
    assert.ok(
      (liveTide.verifiedMetrics || []).some((m) => m.value === '20–59%'),
      `Live TideCache must capture full range 20–59%, got: ${JSON.stringify(liveTide.verifiedMetrics)}`
    );
    assert.ok(
      !(liveTide.verifiedMetrics || []).some((m) => m.value === '59%'),
      'Live TideCache must not emit truncated 59%'
    );
  }

  const liveAskHn = snapshot.signals.find((s) => s.id === 'hn-50583761');
  if (liveAskHn) {
    assert.equal(liveAskHn.evidenceScope, 'discussion_or_personal');
    assert.equal(computeProportionateBlast(liveAskHn, 'BANKING').horizons[0].title, 'Read the original discussion');
  }

  assert.ok(
    !/words per second|compact ai model|block(?:s|ing)?\s+schools\s+from\s+(?:using\s+)?gemini|barred from practicing|35[–-]65%|SOC\s*2|zero[- ]retention/i.test(
      rssXml
    ),
    `Live RSS feed leaked prohibited phrase (words per second / compact AI model / compliance / inverted headline)`
  );

  // Freshness gate check for Top 10 Signals Today strictly by publishedAtMs
  const countUnder48h = snapshot.signals.filter(
    (s) => refNowMs - s.publishedAtMs <= top48hMs
  ).length;
  const maxTopAgeMs = countUnder48h >= 10 ? top48hMs : top72hMs;
  const top10 = snapshot.signals
    .filter((s) => refNowMs - s.publishedAtMs <= maxTopAgeMs)
    .sort((a, b) => computeSignalMomentumScore(b, refNowMs) - computeSignalMomentumScore(a, refNowMs))
    .slice(0, 10);
  assert.ok(top10.length > 0, 'Top 10 rail must not be empty');
  for (const s of top10) {
    assert.ok(
      refNowMs - s.publishedAtMs <= maxTopAgeMs,
      `Top 10 signal exceeded ${maxTopAgeMs / 3600_000}h freshness gate: ${s.id}`
    );
  }

  console.log(
    `[VERIFY v2.5.2] PASSED: All 19 fixture suites + ${snapshot.signals.length} live signals, ${archive.count} archived entries & RSS (Top 10 maxWindow=${maxTopAgeMs / 3600_000}h, count48h=${countUnder48h}).`
  );
}

runFixtureAssertions();
runLiveSnapshotAndArchiveAssertions();
