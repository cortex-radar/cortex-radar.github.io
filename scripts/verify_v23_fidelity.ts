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
  getSignalReleaseMetadata,
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

  assert.equal(hebbiaSig.modelSpecs, undefined, 'Hebbia must have undefined modelSpecs (zero synthetic 320ms / 115 tok/s)');
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
}

function runLiveSnapshotAssertions(): void {
  assert.ok(fs.existsSync(SNAPSHOT_PATH), `Missing baked snapshot at ${SNAPSHOT_PATH}`);
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as StaticGalaxySnapshot;
  assert.equal(snapshot.promptVersion, 'v2.3', 'Snapshot must carry promptVersion v2.3');
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
      const blast = computeProportionateBlast(sig, 'BANKING');
      assert.equal(blast.horizons.length, 1, `Live single-user ${sig.id} must have 1 Practical Next Step`);
      assert.ok(
        !/financial[- ]services|threefold|\b3x\b/i.test(JSON.stringify(blast.horizons)),
        `Live single-user ${sig.id} blast leaked banking/3x template`
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

  assert.ok(
    !/words per second|compact ai model/i.test(rssXml),
    'Live RSS feed leaked words per second or compact AI model'
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
    `[VERIFY v2.3] PASSED: All 9 fixture suites + ${snapshot.signals.length} live signals & RSS (Top 10 maxWindow=${maxTopAgeMs / 3600_000}h, count48h=${countUnder48h}).`
  );
}

runFixtureAssertions();
runLiveSnapshotAssertions();
