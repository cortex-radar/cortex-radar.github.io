import {
  BlastOrderConsequence,
  CLIENT_INDUSTRIES,
  ClientIndustry,
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

export function computeDeterministicBlastRadius(
  signal: SpatialSignal,
  clientIndustry: ClientIndustry
): [BlastOrderConsequence, BlastOrderConsequence, BlastOrderConsequence] {
  const client =
    CLIENT_INDUSTRIES.find((c) => c.id === clientIndustry) || CLIENT_INDUSTRIES[0];
  const regAnchor = client.regulatoryFocus.split(',')[0];

  const sec30 = ARCH_TARGETS[signal.primarySector] || 'ARC';
  const sec60 = GOV_TARGETS[signal.primarySector] || 'GOV';
  const sec90 = FINOPS_TARGETS[signal.primarySector] || 'ECO';

  const stackTarget = signal.affectedEnterpriseStacks[0] || 'AI Gateway & Agent Mesh';

  const order1: BlastOrderConsequence = {
    horizon: '30D',
    orderLabel: '1ST ORDER · 30d ARCHITECTURE',
    title: `Re-wire ${stackTarget}`,
    targetSector: sec30,
    consequence:
      signal.readiness === 'GA'
        ? `${signal.shortLabel} invalidates static ${client.shortLabel} single-model routing; shadow-test behind LiteLLM/MCP ingress within 30 days.`
        : `Prototype ${signal.shortLabel} in isolated R&D harness; decouple ${stackTarget} interfaces now so Q2 cutover requires zero rewrite.`,
    consultantAction: signal.architectBrief.integrationPattern,
    kpiMetric:
      signal.finOps === 'REDUCER'
        ? 'Target: -35% P95 TTFT & simplified RAG topology'
        : 'Target: Zero regression on domain eval harness',
  };

  const order2: BlastOrderConsequence = {
    horizon: '60D',
    orderLabel: '2ND ORDER · 60d GOVERNANCE & RISK',
    title: `${regAnchor} Gate`,
    targetSector: sec60,
    consequence:
      signal.risk === 'HIGH'
        ? `High secondary exposure for ${client.label}: ${signal.shortLabel} triggers mandatory CISO threat-modeling, egress DLP rules, and human-oversight logs.`
        : `Update ${client.shortLabel} model-inventory lineage & red-team regression suites to certify ${signal.shortLabel} under ${regAnchor}.`,
    consultantAction: `Deliver 1-page ${regAnchor} Architecture Control Matrix to CISO & Legal before scaling traffic >10%.`,
    kpiMetric: `Risk Posture: ${signal.risk} → Certified Audit-Ready`,
  };

  const order3: BlastOrderConsequence = {
    horizon: '90D',
    orderLabel: '3RD ORDER · 90d FINOPS & SKILLS',
    title:
      signal.finOps === 'REDUCER'
        ? 'Unit Economics Step-Down & Cert Shift'
        : 'FinOps Quota Guardrails & Upskilling',
    targetSector: sec90,
    consequence:
      signal.finOps === 'REDUCER'
        ? `Compounds into 40–65% ${client.shortLabel} token opex compression over 90 days, shifting build-vs-buy crossover and freeing budget for agentic workflows.`
        : `Unchecked multi-turn adoption across ${client.shortLabel} pods risks 3x token spend drift; pair rollout with semantic tiering and architect upskilling.`,
    consultantAction: `Run 90-day FinOps unit-cost review + upskill client platform pod on ${
      signal.affectedEnterpriseStacks.slice(0, 2).join(' & ') || 'Agentic EvalOps'
    }.`,
    kpiMetric:
      signal.finOps === 'REDUCER'
        ? 'FinOps Delta: -48% blended $/1K tasks'
        : 'FinOps Guardrail: Cap reasoning budget/turn',
  };

  return [order1, order2, order3];
}
