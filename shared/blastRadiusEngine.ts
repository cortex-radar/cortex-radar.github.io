import {
  classifyEvidenceScope,
  COMPLIANCE_NOT_ASSESSED_SOURCE,
  COMPLIANCE_NOT_ASSESSED_STUDY,
  hasLatencyOrThroughputWithoutCost,
  hasSourceComplianceAssessment,
  isEvaluationQualityStudy,
  isNonToolNewsOrMarketSignal,
  stripUnbackedComplianceClaims,
  stripUnbackedNumericClaims,
} from './provenance';
import {
  BlastOrderConsequence,
  CLIENT_INDUSTRIES,
  ClientIndustry,
  EvidenceScope,
  SectorId,
  SpatialSignal,
} from './types';

const ARCH_TARGETS: Record<SectorId, SectorId> = {
  REL: 'ARC',
  SCI: 'ARC',
  ARC: 'INN',
  INN: 'ARC',
  GOV: 'ARC',
  CRT: 'ARC',
  ECO: 'ARC',
  MKT: 'ARC',
};

const GOV_TARGETS: Record<SectorId, SectorId> = {
  REL: 'GOV',
  SCI: 'GOV',
  ARC: 'GOV',
  INN: 'GOV',
  GOV: 'MKT',
  CRT: 'GOV',
  ECO: 'GOV',
  MKT: 'GOV',
};

const FINOPS_TARGETS: Record<SectorId, SectorId> = {
  REL: 'ECO',
  SCI: 'CRT',
  ARC: 'ECO',
  INN: 'ECO',
  GOV: 'CRT',
  CRT: 'ECO',
  ECO: 'CRT',
  MKT: 'ECO',
};

export interface ProportionateBlastResult {
  mode: 'FULL_30_60_90' | 'PRACTICAL_NEXT_STEP' | 'READ_DISCUSSION';
  scope: EvidenceScope;
  horizons: BlastOrderConsequence[];
}

function sanitizeHorizonNumbers(
  horizon: BlastOrderConsequence,
  signal: SpatialSignal
): BlastOrderConsequence {
  const numCorpus = [
    signal.title || '',
    signal.rawAbstract || '',
    ...(signal.streetQuotes || []).map((q) => q.text || ''),
    ...(signal.supportingSources || []).map((s) => s.title || ''),
  ].join(' ');
  const rawComplianceCorpus = [
    signal.title || '',
    signal.rawAbstract || '',
    ...(signal.streetQuotes || []).map((q) => q.text || ''),
  ].join(' ');
  const compFallback = isEvaluationQualityStudy(signal)
    ? `Compliance: ${COMPLIANCE_NOT_ASSESSED_STUDY}.`
    : `Compliance: ${COMPLIANCE_NOT_ASSESSED_SOURCE}.`;

  const cleanField = (val: string) => {
    const n = stripUnbackedNumericClaims(val, numCorpus).cleaned || val;
    return stripUnbackedComplianceClaims(n, rawComplianceCorpus, compFallback).cleaned;
  };
  return {
    ...horizon,
    title: cleanField(horizon.title),
    consequence: cleanField(horizon.consequence),
    consultantAction: cleanField(horizon.consultantAction),
    kpiMetric: cleanField(horizon.kpiMetric),
  };
}

function buildPracticalNextStepCard(
  signal: SpatialSignal,
  scope: EvidenceScope
): BlastOrderConsequence {
  const hay = `${signal.title || ''} ${signal.rawAbstract || ''}`.toLowerCase();
  const targetSector: SectorId = signal.primarySector || 'ARC';

  if (scope === 'discussion_or_personal') {
    return {
      horizon: 'NEXT',
      orderLabel: 'ORIGINAL DISCUSSION',
      title: 'Read the original discussion',
      targetSector,
      consequence:
        'Personal, career, or community discussion thread — no hardware reproduction, benchmarking, or enterprise rollout steps apply.',
      consultantAction:
        'Read the original discussion directly on the source thread for first-hand replies and context.',
      kpiMetric: 'Scope: Discussion / Personal · Source Thread Only',
      actionUrl: signal.url,
      actionLabel: 'Read the original discussion',
    };
  }

  if (scope === 'single_user_experiment') {
    const isOfflineOrSpeechOrHardware =
      /\b(offline|speech|whisper|audio|voice|rockchip|rk35\d+|orange\s*pi|raspberry\s*pi|cpu|local inference|llamacpp|llama\.cpp|quant|q4)\b/i.test(
        hay
      );
    return {
      horizon: 'NEXT',
      orderLabel: 'PRACTICAL NEXT STEP',
      title: 'Validate on Target Hardware',
      targetSector,
      consequence:
        'Single-user or local hardware test — treat reported numbers as hardware-specific until reproduced on your own environment.',
      consultantAction: isOfflineOrSpeechOrHardware
        ? 'If offline speech or local inference matters to your team, reproduce the test on your target hardware and measure latency and accuracy directly.'
        : 'If this workflow fits an active bottleneck, reproduce the setup on a test machine and measure task accuracy and runtime behavior.',
      kpiMetric: 'Scope: Single-User Experiment · Verify Locally',
    };
  }

  if (scope === 'software_release') {
    return {
      horizon: 'NEXT',
      orderLabel: 'PRACTICAL NEXT STEP',
      title: 'Review Release Diff & Pin Version',
      targetSector,
      consequence:
        'Targeted software release — check breaking-change flags and release notes in non-production testing before bumping pinned dependencies.',
      consultantAction:
        'Inspect upstream changelog entries relevant to your runtime stack and pin the exact version tag in staging first.',
      kpiMetric: `Scope: Software Release · ${signal.readiness}`,
    };
  }

  if (scope === 'research_paper') {
    return {
      horizon: 'NEXT',
      orderLabel: 'PRACTICAL NEXT STEP',
      title: 'Monitor Code & Replication',
      targetSector,
      consequence:
        'Research paper or evaluation preprint — verify whether open weights, evaluation scripts, or independent reproductions are linked before scheduling trials.',
      consultantAction:
        'Check reproducibility artifacts upstream and test the proposed method on an internal baseline dataset if directly relevant.',
      kpiMetric: 'Scope: Research Study · Track Replication',
    };
  }

  return {
    horizon: 'NEXT',
    orderLabel: 'PRACTICAL NEXT STEP',
    title: 'Track Market & Policy Impact',
    targetSector,
    consequence:
      'Market, corporate, or commentary update — no immediate technical integration or platform cutover is required from this item.',
    consultantAction:
      'Note vendor stability or procurement context alongside your existing legal and supplier review cadence.',
    kpiMetric: 'Scope: Market & Policy · Monitor Only',
  };
}

/**
 * Proportionately sizes rollout guidance to evidence scope:
 * - Single-user experiments, point releases, research papers, and routine market updates return ONE concise Practical Next Step.
 * - Only enterprise platform launches or major regulatory shifts render 30/60/90-day enterprise horizons, grounded strictly in source facts.
 */
export function computeProportionateBlast(
  signal: SpatialSignal,
  clientIndustry: ClientIndustry
): ProportionateBlastResult {
  const scope: EvidenceScope = signal.evidenceScope || classifyEvidenceScope(signal);
  const hay = `${signal.title || ''} ${signal.rawAbstract || ''}`;
  const isMajorRegulatoryShift =
    scope === 'market_or_policy' &&
    /\b(eu ai act|compliance deadline|federal rule|enforcement|regulation mandate|executive order)\b/i.test(
      hay
    ) &&
    !isNonToolNewsOrMarketSignal(signal);

  if (scope === 'discussion_or_personal') {
    return {
      mode: 'READ_DISCUSSION',
      scope,
      horizons: [sanitizeHorizonNumbers(buildPracticalNextStepCard(signal, scope), signal)],
    };
  }

  if (scope !== 'enterprise_launch' && !isMajorRegulatoryShift) {
    return {
      mode: 'PRACTICAL_NEXT_STEP',
      scope,
      horizons: [sanitizeHorizonNumbers(buildPracticalNextStepCard(signal, scope), signal)],
    };
  }

  const client =
    CLIENT_INDUSTRIES.find((c) => c.id === clientIndustry) || CLIENT_INDUSTRIES[0];

  const sec30 = ARCH_TARGETS[signal.primarySector] || 'ARC';
  const sec60 = GOV_TARGETS[signal.primarySector] || 'GOV';
  const sec90 = FINOPS_TARGETS[signal.primarySector] || 'ECO';

  const stackTarget = signal.affectedEnterpriseStacks[0] || 'AI Gateway & Eval Pipeline';
  const isEvalStudy =
    /\b(citation|excerpt|relevance|source coverage|grading criteria)\b/i.test(hay);
  const sourceHasCompliance = hasSourceComplianceAssessment(signal);

  const order1: BlastOrderConsequence = {
    horizon: '30D',
    orderLabel: '1ST ORDER · 30d PILOT SCOPING',
    title: `Benchmark ${stackTarget}`,
    targetSector: sec30,
    consequence: `Evaluate ${signal.shortLabel} in an isolated ${client.shortLabel} sandbox harness against your current domain baseline within 30 days.`,
    consultantAction: signal.architectBrief.integrationPattern,
    kpiMetric: isEvalStudy
      ? 'Target: Verify citation precision & task pass criteria'
      : 'Target: Measure accuracy vs. current baseline',
  };

  const order2: BlastOrderConsequence = {
    horizon: '60D',
    orderLabel: '2ND ORDER · 60d GOVERNANCE',
    title: 'Security & Governance Review',
    targetSector: sec60,
    consequence: sourceHasCompliance
      ? `Review source-cited data-handling and security controls with InfoSec before any trial traffic.`
      : `Compliance: ${COMPLIANCE_NOT_ASSESSED_SOURCE} — complete independent InfoSec and privacy review before any trial traffic.`,
    consultantAction:
      'Complete internal security and data-boundary checklist with engineering and governance leads.',
    kpiMetric: sourceHasCompliance
      ? `Risk Posture: ${signal.risk} · Pre-Prod Check`
      : `Compliance: ${COMPLIANCE_NOT_ASSESSED_SOURCE}`,
  };

  const order3: BlastOrderConsequence = {
    horizon: '90D',
    orderLabel: '3RD ORDER · 90d OPERATIONALIZATION',
    title: 'Measured Rollout & Team Enablement',
    targetSector: sec90,
    consequence: hasLatencyOrThroughputWithoutCost(signal)
      ? 'Compare end-to-end cost per completed request, error rates, and maintenance overhead before broader rollout.'
      : 'Compare measured pilot unit economics, error rates, and maintenance overhead against incumbent tooling before full cutover.',
    consultantAction: `Review 90-day pilot telemetry across ${
      signal.affectedEnterpriseStacks.slice(0, 2).join(' & ') || 'core stack'
    } before broader rollout.`,
    kpiMetric: hasLatencyOrThroughputWithoutCost(signal)
      ? 'Ask: What happens to cost per completed request?'
      : 'Gate: Advance only if pilot metrics beat baseline',
  };

  return {
    mode: 'FULL_30_60_90',
    scope,
    horizons: [order1, order2, order3].map((h) => sanitizeHorizonNumbers(h, signal)),
  };
}

export function computeDeterministicBlastRadius(
  signal: SpatialSignal,
  clientIndustry: ClientIndustry
): BlastOrderConsequence[] {
  return computeProportionateBlast(signal, clientIndustry).horizons;
}
