import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  buildDeterministicLiteracyPayload,
  enforceEpistemicAndDomainFidelity,
  NO_RELEASE_NOTES_NOTICE,
} from '../shared/literacyEngine';
import {
  analyzeClusterCoverage,
  extractBenchmarkClaimSpec,
  extractPublisherDisplayName,
  getSignalReleaseMetadata,
  hasTechnicalEngineeringContent,
  inferSupportingLinkRole,
  isHedgedOrUnverifiedClaim,
  isReleaseWithoutNotes,
  parseGitHubReleaseMetadata,
  sanitizeReleaseNotesText,
} from '../shared/provenance';
import { synthesizeRawItemToSpatialSignal } from '../shared/seed72h';
import type { LiteracySpectrumPayload, SpatialSignal, StaticGalaxySnapshot } from '../shared/types';
import { computeSignalMomentumScore, getCleanDisplayHeadline } from '../src/utils/signalRanking';

const nowMs = Date.now();
const SNAPSHOT_PATH = path.resolve(process.cwd(), 'public/data/live-galaxy.json');

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
    },
    false
  );
  return {
    ...base,
    ...overrides,
  };
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
        architectureBrief:
          'Uses a 256K Context Window and RAG retriever over Lean4 axioms.',
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
        architectureBrief:
          'Context Window management routes exchange orderbooks via RAG pipelines.',
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
    assert.ok(!/error while loading|please reload|loading errors reported|sorry,\s*something went wrong|assets 2/i.test(dumped),
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

  const fixedFrostbite = enforceEpistemicAndDomainFidelity(
    frostbiteSig,
    adversarialFrostbiteLlm,
    'BANKING'
  );
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
      assert.ok(/dual-issue,\s*in-order cpu core/i.test(txt), `L${idx + 1} missing baseline "dual-issue, in-order CPU core": ${txt}`);
      assert.ok(/architect labs/i.test(txt), `L${idx + 1} missing attribution "Architect Labs": ${txt}`);
    });
  }
}

function runLiveSnapshotAssertions(): void {
  assert.ok(fs.existsSync(SNAPSHOT_PATH), `Missing baked snapshot at ${SNAPSHOT_PATH}`);
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as StaticGalaxySnapshot;
  assert.equal(snapshot.promptVersion, 'v2.2.1', 'Snapshot must carry promptVersion v2.2.1');
  assert.ok(Array.isArray(snapshot.signals) && snapshot.signals.length > 0, 'Snapshot must contain signals');

  const refNowMs = snapshot.bakedAtMs || Date.now();
  const max7dMs = 7 * 24 * 3600_000;
  const top48hMs = 48 * 3600_000;
  const top72hMs = 72 * 3600_000;

  for (const sig of snapshot.signals) {
    const ageMs = refNowMs - sig.publishedAtMs;
    assert.ok(ageMs >= -3600_000 && ageMs <= max7dMs, `Stale signal >7d: ${sig.id} (${sig.title})`);

    const lit = snapshot.literacyBySignalId[sig.id] || sig.literacy;
    assert.ok(lit, `Missing literacy for ${sig.id}`);

    const serializedSignalAndLit = `${sig.rawAbstract} ${JSON.stringify(lit)}`;
    assert.ok(
      !/error while loading|please reload this page|loading errors reported|sorry,\s*something went wrong/i.test(
        serializedSignalAndLit
      ),
      `Live signal ${sig.id} leaked UI-chrome boilerplate: ${sig.title}`
    );

    if (isReleaseWithoutNotes(sig)) {
      assert.ok(
        lit.levels[2].whatHappened.includes(NO_RELEASE_NOTES_NOTICE),
        `Live no-notes release ${sig.id} must use neutral NO_RELEASE_NOTES_NOTICE`
      );
      assert.equal(lit.glossary.length, 0, `Live no-notes release ${sig.id} must have empty glossary`);
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

  // Freshness gate check for Top 10 Signals Today
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
    `[VERIFY v2.2] PASSED: All fixture assertions + ${snapshot.signals.length} live signals (Top 10 maxWindow=${maxTopAgeMs / 3600_000}h, count48h=${countUnder48h}).`
  );
}

runFixtureAssertions();
runLiveSnapshotAssertions();
