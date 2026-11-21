import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { computeProportionateBlast } from '../shared/blastRadiusEngine';
import {
  buildDeterministicLiteracyPayload,
  enforceEpistemicAndDomainFidelity,
  NO_RELEASE_NOTES_NOTICE,
} from '../shared/literacyEngine';
import {
  analyzeClusterCoverage,
  classifyEvidenceScope,
  extractBenchmarkClaimSpec,
  extractFrozenEntities,
  extractPublisherDisplayName,
  extractSourceVerifiedMetrics,
  findUnbackedNumericTokens,
  getSignalReleaseMetadata,
  hasLatencyOrThroughputWithoutCost,
  hasTechnicalEngineeringContent,
  inferSupportingLinkRole,
  isEligibleForNewBadge,
  isEvaluationQualityStudy,
  isHedgedOrUnverifiedClaim,
  isReleaseWithoutNotes,
  isUpstreamUpdatedSignal,
  parseGitHubReleaseMetadata,
  sanitizeReleaseNotesText,
  stripUiChromeBoilerplate,
  validateHeadlineMeaningPreserved,
} from '../shared/provenance';
import { synthesizeRawItemToSpatialSignal } from '../shared/seed72h';
import { generateRssXml } from './bakeStaticGalaxy';
import type { LiteracySpectrumPayload, SpatialSignal, StaticGalaxySnapshot } from '../shared/types';
import { computeSignalMomentumScore, getCleanDisplayHeadline } from '../src/utils/signalRanking';

const nowMs = Date.now();
const SNAPSHOT_PATH = path.resolve(process.cwd(), 'public/data/live-galaxy.json');
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
    'Ask HN unemployment post must classify as discussion_or_personal (not single_user_experiment)'
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
}

function runLiveSnapshotAssertions(): void {
  assert.ok(fs.existsSync(SNAPSHOT_PATH), `Missing baked snapshot at ${SNAPSHOT_PATH}`);
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as StaticGalaxySnapshot;
  assert.equal(snapshot.promptVersion, 'v2.4', 'Snapshot must carry promptVersion v2.4');
  assert.ok(Array.isArray(snapshot.signals) && snapshot.signals.length > 0, 'Snapshot must contain signals');
  assert.ok(fs.existsSync(RSS_PATH), `Missing RSS output at ${RSS_PATH}`);
  const rssXml = fs.readFileSync(RSS_PATH, 'utf8');

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

    // Card-wide numeric grounding audit across ALL literacy fields & Blast
    const corpus = buildNumericAuditCorpus(sig);
    for (const field of collectLiteracyFields(lit)) {
      const unbacked = findUnbackedNumericTokens(field, corpus);
      assert.deepEqual(
        unbacked,
        [],
        `Live signal ${sig.id} contains unbacked number(s) [${unbacked.join(', ')}] in field: ${field}`
      );
    }

    const blast = computeProportionateBlast(sig, 'BANKING');
    for (const h of blast.horizons) {
      for (const hField of [h.title, h.consequence, h.consultantAction, h.kpiMetric]) {
        const unbacked = findUnbackedNumericTokens(hField, corpus);
        assert.deepEqual(
          unbacked,
          [],
          `Live signal ${sig.id} Blast card contains unbacked number(s): ${hField}`
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
  }

  // Specific regression assertions on live targets if currently in snapshot window
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
    !/words per second|compact ai model|block(?:s|ing)?\s+schools\s+from\s+(?:using\s+)?gemini|barred from practicing|35[–-]65%/i.test(
      rssXml
    ),
    'Live RSS feed leaked prohibited pattern'
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
    `[VERIFY v2.4] PASSED: All 13 fixture suites + ${snapshot.signals.length} live signals & RSS (Top 10 maxWindow=${maxTopAgeMs / 3600_000}h, count48h=${countUnder48h}).`
  );
}

runFixtureAssertions();
runLiveSnapshotAssertions();
