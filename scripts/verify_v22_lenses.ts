import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  buildDeterministicLiteracyPayload,
  enforceEpistemicAndDomainFidelity,
} from '../shared/literacyEngine';
import {
  analyzeClusterCoverage,
  extractPublisherDisplayName,
  getSignalReleaseMetadata,
  hasTechnicalEngineeringContent,
  inferSupportingLinkRole,
  isHedgedOrUnverifiedClaim,
  parseGitHubReleaseMetadata,
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
}

function runLiveSnapshotAssertions(): void {
  assert.ok(fs.existsSync(SNAPSHOT_PATH), `Missing baked snapshot at ${SNAPSHOT_PATH}`);
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as StaticGalaxySnapshot;
  assert.equal(snapshot.promptVersion, 'v2.2', 'Snapshot must carry promptVersion v2.2');
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
