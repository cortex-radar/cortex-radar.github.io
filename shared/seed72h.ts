import {
  buildDeterministicLiteracyPayload,
  inferDomainEnterpriseStacks,
  stripHtmlMarkupAndEntities,
} from './literacyEngine';
import {
  classifyEvidenceScope,
  extractSourceVerifiedMetrics,
  parseGitHubReleaseMetadata,
  sanitizeReleaseNotesText,
  stripUiChromeBoilerplate,
  truncateAtWordBoundary,
} from './provenance';
import {
  computeDivergenceMetrics,
  extractCanonicalEntity,
  mapSourceToNetworkFamily,
  scoreStreetSentiment,
} from './supernovaEngine';
import {
  ClientIndustry,
  FinOpsImpact,
  MediaAttachment,
  ReadinessState,
  RiskLevel,
  SectorId,
  SpatialSignal,
  StreetQuote,
} from './types';

interface SeedBlueprint {
  id: string;
  hoursAgo: number;
  title: string;
  shortLabel: string;
  source: SpatialSignal['source'];
  sourceProvenance: string[];
  url: string;
  primarySector: SectorId;
  secondarySectors: SectorId[];
  mass: number;
  readiness: ReadinessState;
  risk: RiskLevel;
  finOps: FinOpsImpact;
  rawAbstract: string;
  architectSummary: string;
  stackImpact: string[];
  integrationPattern: string;
  latencyAndCostNote: string;
  headlineSoWhat: string;
  talkingPoints: string[];
  affectedEnterpriseStacks: string[];
  causalTargetIds?: string[];
  modelSpecs?: SpatialSignal['modelSpecs'];
}

function buildIndustryLens(
  sector: SectorId,
  shortLabel: string,
  headline: string,
  finOps: FinOpsImpact,
  risk: RiskLevel
): Record<ClientIndustry, string> {
  const costClause =
    finOps === 'REDUCER'
      ? 'compresses inference run-rate by 35–65%'
      : finOps === 'INTENSIVE'
      ? 'requires strict FinOps quota guardrails on multi-turn loops'
      : 'maintains neutral unit token economics';
  const riskClause =
    risk === 'LOW'
      ? 'clears standard SOC2 / zero-retention enterprise posture'
      : risk === 'HIGH'
      ? 'mandates legal & CISO sign-off prior to production cutover'
      : 'requires human-in-the-loop confidence routing (<0.92)';

  return {
    BANKING: `FinServ Advisory (${shortLabel}): ${headline} — ${costClause} while ${riskClause} under SR 11-7 model-risk governance.`,
    HEALTHCARE: `Clinical & Life-Sci (${shortLabel}): ${headline} — pairs with HIPAA BAA zero-retention boundaries; ${riskClause} for clinical decision workflows.`,
    FINOPS: `Platform FinOps (${shortLabel}): ${headline} — ${costClause}; prioritize semantic router tiering to capture immediate margin upside.`,
    RETAIL: `Commerce & CX (${shortLabel}): ${headline} — unlocks sub-second catalog & multimodal shopper conversion while ${costClause}.`,
    PUBLIC: `Sovereign & Public Sector (${shortLabel}): ${headline} — evaluate against FedRAMP / EU AI Act transparency controls; ${riskClause}.`,
    SAAS: `B2B SaaS Product (${shortLabel}): ${headline} — protects >75% AI feature gross margin (${costClause}) across multi-tenant workspaces.`,
  };
}

const BLUEPRINTS: SeedBlueprint[] = [
  {
    id: 'seed-gemini-25-pro',
    hoursAgo: 70.5,
    title: 'Gemini 2.5 Pro Multimodal Reasoning Engine: 2M Persistent Context & Native Code Execution',
    shortLabel: 'Gemini 2.5 Pro',
    source: 'LabRelease',
    sourceProvenance: ['LabRelease', 'HackerNews', 'HuggingFace'],
    url: 'https://deepmind.google/technologies/gemini/',
    primarySector: 'REL',
    secondarySectors: ['ARC', 'ECO'],
    mass: 4.4,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'REDUCER',
    rawAbstract:
      'Production GA release of Gemini 2.5 Pro featuring native thinking budgets, 2M-token context caching with 75% read discount, multimodal video/PDF ingestion, and deterministic tool-use schemas.',
    architectSummary:
      'Eliminates fragile multi-hop chunking for <2M token repositories and M&A data rooms via pinned context caching.',
    stackImpact: ['Vertex AI', 'Context Cache Router', 'Agentic Tool Orchestration'],
    integrationPattern: 'Pin static repository/corpus prefix in Context Cache; stream delta reasoning tokens.',
    latencyAndCostNote: 'Cached reads drop effective context cost by 75%; 420ms TTFT at medium thinking budget.',
    headlineSoWhat: 'Replaces complex custom RAG pipelines for whole-codebase and legal-corpus reasoning at 1/4th cached cost.',
    talkingPoints: [
      'Consolidate brittle vector-chunking pipelines for corpora under 2M tokens.',
      'Enable dynamic thinking budgets so simple classifications skip deep reasoning cost.',
      'Enterprise-ready via Vertex AI VPC-SC and zero training retention.',
    ],
    affectedEnterpriseStacks: ['Vertex AI', 'LangGraph', 'Enterprise RAG', 'Code Migration Suites'],
    modelSpecs: {
      modelFamily: 'Gemini 2.5 Pro',
      provider: 'Google DeepMind',
      inputCostPer1M: 1.25,
      outputCostPer1M: 10.0,
      cachedCostPer1M: 0.31,
      contextWindowK: 2000,
      ttftMs: 420,
      tokensPerSec: 118,
      license: 'Proprietary',
      sweBenchVerified: 74.2,
      capabilities: {
        reasoning: 96,
        coding: 95,
        agenticToolUse: 94,
        governanceSafety: 93,
        costEfficiency: 84,
      },
    },
  },
  {
    id: 'seed-deepseek-r2',
    hoursAgo: 66.0,
    title: 'DeepSeek-R2 671B MoE Open-Weights Release: Sparse Latent Attention Cuts KV-Cache RAM 68%',
    shortLabel: 'DeepSeek-R2 671B',
    source: 'HuggingFace',
    sourceProvenance: ['HuggingFace', 'GitHub', 'arXiv'],
    url: 'https://huggingface.co/models',
    primarySector: 'REL',
    secondarySectors: ['SCI', 'ECO', 'GOV'],
    mass: 4.2,
    readiness: 'GA',
    risk: 'MODERATE',
    finOps: 'REDUCER',
    rawAbstract:
      'MIT-licensed Mixture-of-Experts architecture activating 37B parameters per token with Multi-Head Latent Attention v2 and FP8 native dispatch kernels.',
    architectSummary:
      'Self-hostable on a single 8xH200 node in FP8; MIT license grants unrestricted on-prem fine-tuning for air-gapped clients.',
    stackImpact: ['vLLM', 'SGLang', 'On-Prem GPU Clusters', 'Sovereign Cloud'],
    integrationPattern: 'Deploy behind private VPC SGLang cluster with Guardrails AI output verifier.',
    latencyAndCostNote: '$0.27/1M input via sovereign hosts or ~$0.19/1M amortized on reserved H200 silicon.',
    headlineSoWhat: 'Brings frontier reasoning to air-gapped sovereign environments at ~80% lower token cost—provided self-hosted governance is enforced.',
    talkingPoints: [
      'MIT license eliminates vendor lock-in for sovereign and defense workloads.',
      'Requires self-hosted VPC deployment (never route sensitive IP to unvetted third-party endpoints).',
      'Shifts build-vs-buy crossover to >80M tokens/day.',
    ],
    affectedEnterpriseStacks: ['vLLM / SGLang', 'Kubernetes GPU Operator', 'Air-Gapped Sovereign AI'],
    causalTargetIds: ['seed-gemini-25-pro'],
    modelSpecs: {
      modelFamily: 'DeepSeek-R2 671B (MoE)',
      provider: 'DeepSeek (MIT Open-Weights)',
      inputCostPer1M: 0.27,
      outputCostPer1M: 1.1,
      cachedCostPer1M: 0.07,
      contextWindowK: 164,
      ttftMs: 540,
      tokensPerSec: 92,
      license: 'MIT',
      sweBenchVerified: 71.8,
      capabilities: {
        reasoning: 94,
        coding: 92,
        agenticToolUse: 86,
        governanceSafety: 74,
        costEfficiency: 98,
      },
    },
  },
  {
    id: 'seed-claude-4-sonnet',
    hoursAgo: 62.5,
    title: 'Claude 4 Sonnet Agentic Coding & Computer-Use Update Hits 76.4% Verified Repo Resolution',
    shortLabel: 'Claude 4 Sonnet',
    source: 'LabRelease',
    sourceProvenance: ['LabRelease', 'HackerNews'],
    url: 'https://www.anthropic.com',
    primarySector: 'REL',
    secondarySectors: ['ARC', 'INN'],
    mass: 4.1,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'NEUTRAL',
    rawAbstract:
      'Enhanced parallel tool execution, interleaved extended thinking inside multi-step bash/editor loops, and tightened prompt-injection resistance on untrusted DOM/repo inputs.',
    architectSummary:
      'Gold-standard worker brain for multi-file legacy code modernization (COBOL/Java -> TypeScript/Go) and autonomous QA agents.',
    stackImpact: ['AWS Bedrock', 'Google Vertex', 'MCP Agent Harnesses', 'CI/CD Code Agents'],
    integrationPattern: 'Pair with Gemini 2.5 Flash / Haiku triage router so Sonnet handles complex synthesis steps.',
    latencyAndCostNote: '$3.00 / $15.00 per 1M tokens; prompt caching cuts multi-turn agent tool loops by up to 82%.',
    headlineSoWhat: 'Accelerates enterprise legacy modernization timelines by 2.4x with industry-leading agentic tool discipline.',
    talkingPoints: [
      'Deploy via AWS Bedrock or Vertex AI to inherit existing cloud enterprise agreements.',
      'Strongest off-the-shelf resistance to indirect prompt injection during browser/tool use.',
      'Mandate prompt-cache breakpoints on system tool schemas to prevent cost bloat.',
    ],
    affectedEnterpriseStacks: ['AWS Bedrock', 'SDLC Automation', 'MCP Servers'],
    causalTargetIds: ['seed-gemini-25-pro'],
    modelSpecs: {
      modelFamily: 'Claude 4 Sonnet',
      provider: 'Anthropic',
      inputCostPer1M: 3.0,
      outputCostPer1M: 15.0,
      cachedCostPer1M: 0.3,
      contextWindowK: 200,
      ttftMs: 390,
      tokensPerSec: 96,
      license: 'Proprietary',
      sweBenchVerified: 76.4,
      capabilities: {
        reasoning: 95,
        coding: 98,
        agenticToolUse: 97,
        governanceSafety: 96,
        costEfficiency: 76,
      },
    },
  },
  {
    id: 'seed-arxiv-latent-verify',
    hoursAgo: 58.0,
    title: 'arXiv: Self-Verifying Latent Critic Heads Cut Agentic Tool-Call Hallucinations by 54%',
    shortLabel: 'Latent Critic Heads',
    source: 'arXiv',
    sourceProvenance: ['arXiv', 'HuggingFace'],
    url: 'https://arxiv.org/list/cs.AI/recent',
    primarySector: 'SCI',
    secondarySectors: ['ARC', 'GOV'],
    mass: 3.3,
    readiness: 'RESEARCH',
    risk: 'LOW',
    finOps: 'REDUCER',
    rawAbstract:
      'Introduces lightweight auxiliary verifier projections over hidden states prior to JSON/SQL token emission, pruning invalid schema hallucinations with <6% FLOP overhead versus 4x cost of Best-of-N.',
    architectSummary:
      'Replaces expensive multi-sample LLM-as-a-Judge retries with single-pass hidden-state verification for open-weights deployments.',
    stackImpact: ['PyTorch / vLLM Plugins', 'Text-to-SQL Engines', 'Regulated Agent Guardrails'],
    integrationPattern: 'Train 18M-param LoRA critic head on domain SQL/API trace logs; gate execution at p > 0.94.',
    latencyAndCostNote: 'Adds only 9ms per tool call while eliminating 75% of downstream retry cascades.',
    headlineSoWhat: 'Gives regulated enterprises a mathematically grounded way to stop AI agents from firing malformed ERP/database mutations.',
    talkingPoints: [
      'Directly addresses audit objections around non-deterministic agent actions.',
      '4x cheaper than running secondary judge models on every transaction.',
      'Expect integration into open-source vLLM guided-decoding engines next quarter.',
    ],
    affectedEnterpriseStacks: ['vLLM', 'Enterprise ERP Agents', 'Text-to-SQL'],
    causalTargetIds: ['seed-deepseek-r2', 'seed-claude-4-sonnet'],
  },
  {
    id: 'seed-gpt-51-reasoning',
    hoursAgo: 54.0,
    title: 'GPT-5.1 Adaptive Reasoning & Structured Outputs v3 Unlocks Sub-Second Financial Modeling',
    shortLabel: 'GPT-5.1 Adaptive',
    source: 'LabRelease',
    sourceProvenance: ['LabRelease', 'HackerNews'],
    url: 'https://openai.com',
    primarySector: 'REL',
    secondarySectors: ['ECO', 'INN'],
    mass: 4.15,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'NEUTRAL',
    rawAbstract:
      'Unified router-free model dynamically allocating reasoning compute per prompt complexity with 100% CFG-constrained schema adherence across 400K context.',
    architectSummary:
      'Simplifies multi-model cascades where engineering teams previously maintained fragile classifier routers.',
    stackImpact: ['Azure OpenAI', 'Financial Extraction Pipelines', 'Structured API Gateways'],
    integrationPattern: 'Use Azure Provisioned Throughput Units (PTUs) with strict reasoning_effort caps per SLA tier.',
    latencyAndCostNote: '$2.00 / $8.00 per 1M tokens; 310ms TTFT on low-effort analytical queries.',
    headlineSoWhat: 'Cuts multi-model orchestration complexity for Azure-committed enterprises while guaranteeing 100% JSON schema compliance.',
    talkingPoints: [
      'Ideal drop-in upgrade for existing Azure OpenAI enterprise footprints.',
      'Enforce explicit max_completion_tokens caps to prevent runaway reasoning bills.',
      'Benchmark head-to-head against Gemini 2.5 Pro on >250K context workloads.',
    ],
    affectedEnterpriseStacks: ['Azure AI Foundry', 'FP&A Copilots', 'Underwriting Engines'],
    causalTargetIds: ['seed-gemini-25-pro', 'seed-claude-4-sonnet'],
    modelSpecs: {
      modelFamily: 'GPT-5.1 Adaptive',
      provider: 'OpenAI / Azure',
      inputCostPer1M: 2.0,
      outputCostPer1M: 8.0,
      cachedCostPer1M: 0.5,
      contextWindowK: 400,
      ttftMs: 310,
      tokensPerSec: 128,
      license: 'Proprietary',
      sweBenchVerified: 74.9,
      capabilities: {
        reasoning: 96,
        coding: 95,
        agenticToolUse: 95,
        governanceSafety: 92,
        costEfficiency: 81,
      },
    },
  },
  {
    id: 'seed-mcp-zero-trust',
    hoursAgo: 49.5,
    title: 'GitHub Breakout: Zero-Trust Enterprise MCP Gateway Adds OAuth2 PKCE, RBAC & SOC2 Lineage',
    shortLabel: 'Zero-Trust MCP Gateway',
    source: 'GitHub',
    sourceProvenance: ['GitHub', 'HackerNews'],
    url: 'https://github.com/modelcontextprotocol',
    primarySector: 'ARC',
    secondarySectors: ['GOV', 'INN'],
    mass: 3.7,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'REDUCER',
    rawAbstract:
      'Apache-2.0 Rust proxy sitting between enterprise AI agents and internal MCP tool servers—enforcing per-user OAuth scopes, PII token redaction, rate limits, and OpenTelemetry audit logs.',
    architectSummary:
      'The missing security plane required by CISOs before allowing agents to read/write Jira, Snowflake, Salesforce, or GitHub.',
    stackImpact: ['Model Context Protocol', 'Envoy / Rust Gateways', 'Okta / Entra ID', 'OpenTelemetry'],
    integrationPattern: 'Deploy as sidecar ingress in Kubernetes; terminate all agent MCP calls through user-scoped JWTs.',
    latencyAndCostNote: 'Sub-1.8ms proxy overhead in Rust; eliminates custom per-connector auth glue.',
    headlineSoWhat: 'Unblocks stalled enterprise agent pilots by giving InfoSec full user-level RBAC and immutable tool-call audit trails.',
    talkingPoints: [
      'Never connect agents to internal APIs via shared service-account keys—enforce user-delegated OAuth.',
      'Cuts connector security review time from 6 weeks to 3 days.',
      'Apache-2.0 open standard prevents orchestration vendor lock-in.',
    ],
    affectedEnterpriseStacks: ['MCP Ecosystem', 'Kubernetes Ingress', 'IAM / Okta / Entra', 'SIEM Audit'],
    causalTargetIds: ['seed-claude-4-sonnet', 'seed-arxiv-latent-verify'],
    modelSpecs: {
      modelFamily: 'Zero-Trust MCP Gateway v2',
      provider: 'OSS (Apache-2.0 Rust)',
      inputCostPer1M: 0.02,
      outputCostPer1M: 0.02,
      cachedCostPer1M: 0.01,
      contextWindowK: 1000,
      ttftMs: 2,
      tokensPerSec: 950,
      license: 'Apache-2.0',
      sweBenchVerified: 0,
      capabilities: {
        reasoning: 40,
        coding: 65,
        agenticToolUse: 99,
        governanceSafety: 99,
        costEfficiency: 99,
      },
    },
  },
  {
    id: 'seed-gemini-25-flash',
    hoursAgo: 46.0,
    title: 'Gemini 2.5 Flash High-Throughput Tier Hits 265 tok/s With Tunable Thinking & $0.15 Input',
    shortLabel: 'Gemini 2.5 Flash',
    source: 'LabRelease',
    sourceProvenance: ['LabRelease', 'HuggingFace'],
    url: 'https://ai.google.dev/',
    primarySector: 'ECO',
    secondarySectors: ['REL', 'ARC'],
    mass: 3.9,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'REDUCER',
    rawAbstract:
      'Pareto-frontier workhorse delivering near-flagship accuracy at $0.15/1M input tokens, 1M context window, and 195ms TTFT for real-time voice/UI agents.',
    architectSummary:
      'Default tier-1 workhorse in semantic routers—absorbs 85% of enterprise production traffic before escalating edge cases.',
    stackImpact: ['Semantic Model Routers', 'Voice/Realtime Copilots', 'High-Volume ETL'],
    integrationPattern: 'Route 85% of classification, extraction, and standard RAG traffic here; escalate <15% to Pro/Sonnet.',
    latencyAndCostNote: '$0.15 input / $0.60 non-thinking output; cuts blended enterprise token spend by ~72%.',
    headlineSoWhat: 'The #1 FinOps lever available today: shifting 80% of routine agent turns to Flash slashes cloud AI bills by two-thirds without hurting UX.',
    talkingPoints: [
      'Audit existing frontier API usage—most enterprises overpay 6x by sending routine extraction to flagship models.',
      '195ms TTFT meets strict <300ms human conversational latency budgets.',
      '1M context window handles multi-document synthesis natively.',
    ],
    affectedEnterpriseStacks: ['LiteLLM / Portkey Routers', 'Customer Support Voice AI', 'Doc Processing'],
    causalTargetIds: ['seed-gemini-25-pro', 'seed-gpt-51-reasoning'],
    modelSpecs: {
      modelFamily: 'Gemini 2.5 Flash',
      provider: 'Google DeepMind',
      inputCostPer1M: 0.15,
      outputCostPer1M: 0.6,
      cachedCostPer1M: 0.04,
      contextWindowK: 1000,
      ttftMs: 195,
      tokensPerSec: 265,
      license: 'Proprietary',
      sweBenchVerified: 63.8,
      capabilities: {
        reasoning: 87,
        coding: 86,
        agenticToolUse: 90,
        governanceSafety: 92,
        costEfficiency: 97,
      },
    },
  },
  {
    id: 'seed-eu-ai-act-gpai',
    hoursAgo: 42.0,
    title: 'EU AI Act GPAI Enforcement Playbook Clarifies Fine-Tuning vs. RAG Deployer Liability',
    shortLabel: 'EU AI Act Playbook',
    source: 'HackerNews',
    sourceProvenance: ['HackerNews'],
    url: 'https://artificialintelligenceact.eu/',
    primarySector: 'GOV',
    secondarySectors: ['INN', 'MKT'],
    mass: 3.6,
    readiness: 'GA',
    risk: 'HIGH',
    finOps: 'NEUTRAL',
    rawAbstract:
      'Finalized compliance matrices specify when downstream enterprise modification crosses compute thresholds into GPAI provider obligations versus standard high-risk deployer duties.',
    architectSummary:
      'Confirms RAG, prompt caching, and lightweight LoRA (<threshold) preserve Deployer status, avoiding full upstream model-provider filings.',
    stackImpact: ['Model Registry Lineage', 'ISO 42001 Audits', 'EU Customer Workloads'],
    integrationPattern: 'Log dataset provenance hashes + red-team eval scores in CI/CD before promoting LoRA adapters.',
    latencyAndCostNote: 'Zero runtime latency impact; avoids up to 3–7% global turnover regulatory exposure.',
    headlineSoWhat: 'Removes legal ambiguity blocking European deployments: stick to RAG + lightweight adapters to avoid heavy GPAI provider liability.',
    talkingPoints: [
      'Brief General Counsel immediately: standard RAG + MCP orchestration keeps your org in the lighter Deployer tier.',
      'High-risk HR, credit-scoring, and medical triage use cases still require conformity assessments and human oversight logs.',
      'Map existing controls to ISO/IEC 42001 to satisfy multi-jurisdiction procurement questionnaires.',
    ],
    affectedEnterpriseStacks: ['MLflow / Weights & Biases Lineage', 'EU Cloud Regions', 'GRC Platforms'],
    causalTargetIds: ['seed-deepseek-r2', 'seed-mcp-zero-trust'],
  },
  {
    id: 'seed-qwen3-235b',
    hoursAgo: 38.0,
    title: 'Qwen3-235B-A22B Apache-2.0 Hybrid Thinking Model Tops Open Multilingual & SQL Benchmarks',
    shortLabel: 'Qwen3-235B-A22B',
    source: 'HuggingFace',
    sourceProvenance: ['HuggingFace', 'GitHub'],
    url: 'https://huggingface.co/Qwen',
    primarySector: 'REL',
    secondarySectors: ['ECO', 'ARC'],
    mass: 3.65,
    readiness: 'GA',
    risk: 'MODERATE',
    finOps: 'REDUCER',
    rawAbstract:
      'Apache-2.0 MoE model activating only 22B parameters per token with native `/think` and `/no_think` mode switching across 119 languages.',
    architectSummary:
      'Fits comfortably on 4xH100 (FP8) with blazing 145 tok/s throughput—prime open-weights alternative for private cloud Kubernetes.',
    stackImpact: ['vLLM', 'TensorRT-LLM', 'Multilingual Global Support', 'Private VPC'],
    integrationPattern: 'Run in private EKS/GKE cluster; use `/no_think` for sub-250ms chat and `/think` for batch analytics.',
    latencyAndCostNote: '22B active params yield ~$0.14/1M effective self-hosted cost at >60% GPU utilization.',
    headlineSoWhat: 'Apache-2.0 workhorse that fits on half the GPUs of 600B+ models while delivering multilingual frontier parity.',
    talkingPoints: [
      'Clean Apache-2.0 license passes Fortune 500 open-source legal review cleanly.',
      'Requires only 4xH100 GPUs, slashing private-cloud reservation capex by 50%.',
      'Built-in `/no_think` switch prevents wasted tokens on simple classifications.',
    ],
    affectedEnterpriseStacks: ['vLLM', 'AWS EKS / GCP GKE GPUs', 'Global ERP Localization'],
    causalTargetIds: ['seed-deepseek-r2', 'seed-gemini-25-flash'],
    modelSpecs: {
      modelFamily: 'Qwen3-235B-A22B',
      provider: 'Qwen (Apache-2.0)',
      inputCostPer1M: 0.18,
      outputCostPer1M: 0.65,
      cachedCostPer1M: 0.05,
      contextWindowK: 128,
      ttftMs: 260,
      tokensPerSec: 145,
      license: 'Apache-2.0',
      sweBenchVerified: 68.4,
      capabilities: {
        reasoning: 91,
        coding: 90,
        agenticToolUse: 89,
        governanceSafety: 80,
        costEfficiency: 96,
      },
    },
  },
  {
    id: 'seed-jpm-claims-roi',
    hoursAgo: 34.0,
    title: 'Tier-1 Insurer Case Study: Hybrid Multimodal + Deterministic Rules Automates 71% of Claims',
    shortLabel: '71% Claims Automation ROI',
    source: 'HackerNews',
    sourceProvenance: ['HackerNews'],
    url: 'https://news.ycombinator.com',
    primarySector: 'INN',
    secondarySectors: ['ECO', 'GOV'],
    mass: 3.45,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'REDUCER',
    rawAbstract:
      'Verified production post-mortem across 1.8M claims: vision-language damage extraction feeds a deterministic Drools policy engine, cutting settlement time from 6.4 days to 11 minutes.',
    architectSummary:
      'Blueprint pattern for regulated industries: use LLMs strictly for unstructured perception, never for final financial math or policy thresholds.',
    stackImpact: ['Multimodal Vision API', 'Deterministic Rule Engines', 'Human Escalation Queues'],
    integrationPattern: 'VLM outputs typed JSON + calibrated confidence -> Deterministic Rules -> Auto-settle if conf >= 0.93.',
    latencyAndCostNote: '$0.038 total AI cost per claim vs. $14.20 manual triage baseline (370x unit ROI).',
    headlineSoWhat: 'The #1 architectural lesson for C-Suites: pairing AI perception with deterministic business rules unlocks regulator approval and 300x+ unit ROI.',
    talkingPoints: [
      'Cite this architecture whenever risk committees push back on AI financial decisioning.',
      'Separating perception (AI) from adjudication (code) guarantees 100% policy auditability.',
      'Achieved payback on full engineering investment in under 11 weeks.',
    ],
    affectedEnterpriseStacks: ['Claims & Underwriting', 'Document AI', 'Drools / OPA Policy Engines'],
    causalTargetIds: ['seed-gemini-25-flash', 'seed-eu-ai-act-gpai'],
  },
  {
    id: 'seed-llama4-maverick',
    hoursAgo: 30.0,
    title: 'Llama-4 Maverick 400B Native Multimodal MoE Lands on Bedrock, Vertex & Azure Serverless',
    shortLabel: 'Llama-4 Maverick',
    source: 'HuggingFace',
    sourceProvenance: ['HuggingFace', 'LabRelease'],
    url: 'https://huggingface.co/meta-llama',
    primarySector: 'REL',
    secondarySectors: ['ARC', 'ECO'],
    mass: 3.8,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'REDUCER',
    rawAbstract:
      'Early-fusion image+text MoE activating 17B active parameters across 128 experts with 1M context window and managed serverless endpoints across all three hyperscalers.',
    architectSummary:
      '17B active parameter footprint makes multimodal document/chart parsing dramatically faster than dense vision models.',
    stackImpact: ['AWS Bedrock Serverless', 'Vertex Model Garden', 'Multimodal RAG'],
    integrationPattern: 'Consume via managed hyperscaler serverless API first; shift to self-hosted FP8 only above 150M tok/day.',
    latencyAndCostNote: '$0.22 / $0.85 per 1M managed serverless tokens; 230ms TTFT.',
    headlineSoWhat: 'Delivers fast, low-cost multimodal chart & PDF intelligence inside existing AWS/GCP VPC boundaries—note custom community license thresholds.',
    talkingPoints: [
      'Zero GPU ops needed thanks to day-one Bedrock and Vertex serverless support.',
      '17B active MoE architecture shines on high-throughput visual PDF/slide ingestion.',
      'Verify >700M MAU license clause only if building consumer-scale platforms.',
    ],
    affectedEnterpriseStacks: ['AWS Bedrock', 'Vertex AI', 'Visual PDF Pipelines'],
    causalTargetIds: ['seed-qwen3-235b', 'seed-jpm-claims-roi'],
    modelSpecs: {
      modelFamily: 'Llama-4 Maverick (17B/400B)',
      provider: 'Meta (Open-Weights)',
      inputCostPer1M: 0.22,
      outputCostPer1M: 0.85,
      cachedCostPer1M: 0.08,
      contextWindowK: 1000,
      ttftMs: 230,
      tokensPerSec: 168,
      license: 'Open-Weights',
      sweBenchVerified: 65.2,
      capabilities: {
        reasoning: 86,
        coding: 85,
        agenticToolUse: 86,
        governanceSafety: 85,
        costEfficiency: 95,
      },
    },
  },
  {
    id: 'seed-vllm-disagg-prefill',
    hoursAgo: 25.5,
    title: 'vLLM v0.9 Disaggregated Prefill-Decode + RDMA KV-Transfer Doubles H100 Goodput at P99 SLA',
    shortLabel: 'vLLM v0.9 Disagg',
    source: 'GitHub',
    sourceProvenance: ['GitHub', 'arXiv'],
    url: 'https://github.com/vllm-project/vllm',
    primarySector: 'ARC',
    secondarySectors: ['ECO', 'SCI'],
    mass: 3.5,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'REDUCER',
    rawAbstract:
      'Production disaggregated serving splits compute-bound prompt prefill nodes from memory-bandwidth-bound token decode nodes over NIXL/NVLink/RDMA, eliminating TTFT spikes under long-context bursts.',
    architectSummary:
      'Cuts GPU cluster sizing by 45% for enterprise teams serving mixed long-prompt RAG + low-latency chat.',
    stackImpact: ['vLLM', 'NVIDIA Dynamo / NIXL', 'Kubernetes RayServe'],
    integrationPattern: 'Allocate 60% prefill / 40% decode pods with KV-cache RDMA pool on InfiniBand/RoCE.',
    latencyAndCostNote: '2.1x higher request capacity within strict <400ms P99 TTFT & <25ms TPOT SLAs.',
    headlineSoWhat: 'Halves private GPU cluster capex for organizations running self-hosted open-weights models at scale.',
    talkingPoints: [
      'Mandatory upgrade before purchasing additional H100/B200 nodes this quarter.',
      'Prevents a single 100K-token PDF upload from stalling 50 concurrent chat users.',
      'Pairs directly with DeepSeek-R2 and Qwen3 MoE deployments.',
    ],
    affectedEnterpriseStacks: ['vLLM', 'NVIDIA GPU Infrastructure', 'Ray / KServe'],
    causalTargetIds: ['seed-deepseek-r2', 'seed-qwen3-235b'],
    modelSpecs: {
      modelFamily: 'vLLM v0.9 Disagg Engine',
      provider: 'vLLM OSS (Apache-2.0)',
      inputCostPer1M: 0.11,
      outputCostPer1M: 0.35,
      cachedCostPer1M: 0.03,
      contextWindowK: 512,
      ttftMs: 145,
      tokensPerSec: 290,
      license: 'Apache-2.0',
      sweBenchVerified: 0,
      capabilities: {
        reasoning: 50,
        coding: 70,
        agenticToolUse: 88,
        governanceSafety: 90,
        costEfficiency: 99,
      },
    },
  },
  {
    id: 'seed-cert-gcp-agent-arch',
    hoursAgo: 21.0,
    title: 'New Hands-On Credential: Enterprise Agentic Systems & MCP Solutions Architect Lab Exam',
    shortLabel: 'Agentic Architect Cert',
    source: 'LabRelease',
    sourceProvenance: ['LabRelease'],
    url: 'https://cloud.google.com/learn/certification',
    primarySector: 'CRT',
    secondarySectors: ['ARC', 'GOV'],
    mass: 3.1,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'NEUTRAL',
    rawAbstract:
      'Performance-based 3-hour practical certification testing live multi-agent orchestration, MCP OAuth security hardening, deterministic eval harnesses, and FinOps token-budget circuit breakers.',
    architectSummary:
      'High-signal advisory credential moving beyond multiple-choice prompt trivia into real distributed systems & governance engineering.',
    stackImpact: ['Consultant Upskilling', 'RFP Technical Credentials', 'Eval Harnesses'],
    integrationPattern: 'Complete 4 sandbox labs: MCP RBAC, Semantic Router FinOps, Trajectory Evals, and Guardrail Circuit Breakers.',
    latencyAndCostNote: '14-hour fast-track prep for practicing cloud architects; high RFP differentiation.',
    headlineSoWhat: 'Sharpest credential right now to prove production agentic & governance mastery on enterprise transformation RFPs.',
    talkingPoints: [
      'Prioritize over legacy foundational GenAI badges when staffing client advisory pods.',
      'Directly validates the exact MCP security and FinOps skills CIOs demand in 2026.',
      'Reusable lab blueprints double as client starter accelerators.',
    ],
    affectedEnterpriseStacks: ['Advisory Practice Readiness', 'Vertex / Bedrock AgentCore', 'EvalOps'],
    causalTargetIds: ['seed-mcp-zero-trust', 'seed-gemini-25-pro'],
  },
  {
    id: 'seed-owasp-mcp-poisoning',
    hoursAgo: 17.5,
    title: 'Security Advisory: Tool-Description Shadowing & Rug-Pull Attacks Across Unpinned MCP Servers',
    shortLabel: 'MCP Tool-Poisoning Alert',
    source: 'GitHub',
    sourceProvenance: ['GitHub', 'HackerNews'],
    url: 'https://owasp.org/www-project-top-10-for-large-language-model-applications/',
    primarySector: 'GOV',
    secondarySectors: ['ARC', 'SCI'],
    mass: 3.55,
    readiness: 'GA',
    risk: 'HIGH',
    finOps: 'NEUTRAL',
    rawAbstract:
      'Red-team research demonstrates how dynamically mutated MCP tool docstrings exfiltrate SSH keys and CRM records via invisible Unicode instructions inside developer and enterprise agent clients.',
    architectSummary:
      'Treat third-party MCP tool metadata as untrusted user input—cryptographically pin tool schemas by SHA-256 hash.',
    stackImpact: ['IDE Coding Agents', 'Enterprise MCP Registries', 'DLP / Egress Firewalls'],
    integrationPattern: 'Enforce private internal MCP registry + SHA-256 tool-manifest pinning + egress allowlists.',
    latencyAndCostNote: 'Immediate CISO action item—zero runtime cost once pinned behind internal gateway.',
    headlineSoWhat: 'Urgent CISO briefing item: block unvetted `npx` third-party MCP servers on developer laptops and enforce signed internal registries.',
    talkingPoints: [
      'Send proactive security memo to client CISOs today—instant trust-builder for an AI consultant.',
      'Pin MCP server digests identically to container supply-chain security (SLSA / Sigstore).',
      'Route all agent tool calls through the Zero-Trust MCP Gateway with egress DLP.',
    ],
    affectedEnterpriseStacks: ['Developer Workstations', 'MCP Gateways', 'Enterprise DLP'],
    causalTargetIds: ['seed-mcp-zero-trust'],
  },
  {
    id: 'seed-arxiv-graph-memory',
    hoursAgo: 13.5,
    title: 'arXiv: Temporal Bi-Temporal Knowledge Graphs Beat Flat Vector RAG by +38% on Enterprise Drift',
    shortLabel: 'Bi-Temporal GraphRAG',
    source: 'arXiv',
    sourceProvenance: ['arXiv', 'GitHub'],
    url: 'https://arxiv.org/list/cs.CL/recent',
    primarySector: 'SCI',
    secondarySectors: ['ARC', 'INN'],
    mass: 3.2,
    readiness: 'PREVIEW',
    risk: 'LOW',
    finOps: 'REDUCER',
    rawAbstract:
      'Combines `valid_from`/`valid_to` bi-temporal entity edges with hybrid BM25+dense retrieval so agents never cite superseded pricing tables, policies, or deprecated APIs.',
    architectSummary:
      'Solves the #1 silent failure mode of enterprise RAG: retrieving last year\'s policy PDF because its cosine similarity is higher.',
    stackImpact: ['Neo4j / FalkorDB / pgvector', 'Enterprise Knowledge Bases', 'Legal & Policy Copilots'],
    integrationPattern: 'Extract temporal validity intervals at ingestion; filter subgraph by `valid_at = NOW()` prior to reranking.',
    latencyAndCostNote: '42ms hybrid graph-vector hop; uses 70% fewer tokens than naive Microsoft-style community GraphRAG.',
    headlineSoWhat: 'Fixes "stale policy hallucinations" in enterprise RAG without blowing up indexing bills.',
    talkingPoints: [
      'Ask every client: "What happens when your RAG bot retrieves 2024 pricing alongside 2026 pricing?"',
      'Bi-temporal edges enforce point-in-time accuracy for audit and compliance queries.',
      'Lightweight ingestion avoids 10x token indexing explosions of older GraphRAG designs.',
    ],
    affectedEnterpriseStacks: ['Postgres + pgvector', 'Graph Databases', 'Policy & Legal RAG'],
    causalTargetIds: ['seed-jpm-claims-roi', 'seed-gemini-25-pro'],
  },
  {
    id: 'seed-mistral-large-25',
    hoursAgo: 10.0,
    title: 'Mistral Codestral & Large 2.5 Sovereign EU Cloud Release With Zero-Egress Frankfurt/Paris SLA',
    shortLabel: 'Mistral Large 2.5 EU',
    source: 'LabRelease',
    sourceProvenance: ['LabRelease', 'HuggingFace'],
    url: 'https://mistral.ai',
    primarySector: 'MKT',
    secondarySectors: ['REL', 'GOV'],
    mass: 3.3,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'NEUTRAL',
    rawAbstract:
      'Sovereign EU-hosted inference and on-prem appliance partnership delivering GDPR/Schrems-II immunity for German, French, and Nordic public-sector & banking institutions.',
    architectSummary:
      'Strong regional sovereign option when European works councils or BaFin regulators prohibit US-parented cloud subprocessors.',
    stackImpact: ['EU Sovereign Cloud', 'On-Premise Appliances', 'Multilingual European Copilots'],
    integrationPattern: 'Add as EU regional failover/sovereign target inside multi-provider LiteLLM gateway.',
    latencyAndCostNote: '$1.80 / $5.40 per 1M tokens; <240ms TTFT inside EU-Central.',
    headlineSoWhat: 'Key geopolitical/sovereign card for European banking and public-sector deals blocked by US Cloud Act concerns.',
    talkingPoints: [
      'Unlocks European public-sector and BaFin-regulated deals stalled on data residency.',
      'Seamless OpenAI-compatible schema makes multi-region routing trivial.',
      'Strong German/French/Spanish idiomatic precision.',
    ],
    affectedEnterpriseStacks: ['EU Sovereign Cloud', 'LiteLLM Multi-Region', 'Banking Copilots'],
    causalTargetIds: ['seed-eu-ai-act-gpai'],
    modelSpecs: {
      modelFamily: 'Mistral Large 2.5 Sovereign',
      provider: 'Mistral AI (EU)',
      inputCostPer1M: 1.8,
      outputCostPer1M: 5.4,
      cachedCostPer1M: 0.4,
      contextWindowK: 256,
      ttftMs: 240,
      tokensPerSec: 132,
      license: 'Proprietary',
      sweBenchVerified: 69.5,
      capabilities: {
        reasoning: 89,
        coding: 92,
        agenticToolUse: 88,
        governanceSafety: 95,
        costEfficiency: 85,
      },
    },
  },
  {
    id: 'seed-finops-router-bench',
    hoursAgo: 6.5,
    title: 'FinOps Benchmark Across 40M Enterprise Prompts: 3-Tier Cascade Cuts Spend 64% With +1.2% Quality',
    shortLabel: '3-Tier FinOps Cascade',
    source: 'HackerNews',
    sourceProvenance: ['HackerNews', 'GitHub'],
    url: 'https://github.com/BerriAI/litellm',
    primarySector: 'ECO',
    secondarySectors: ['ARC', 'INN'],
    mass: 3.6,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'REDUCER',
    rawAbstract:
      'Empirical production telemetry across 18 Fortune 1000 deployments proves a calibrated embedding classifier + Flash/Qwen tier-1 + Sonnet/Pro escalation beats single-flagship routing on both cost and P95 latency.',
    architectSummary:
      'Reference FinOps quick-win engagement: deploy in week 1 of a consulting assignment to self-fund the entire transformation roadmap.',
    stackImpact: ['LiteLLM / Portkey', 'FinOps Dashboards', 'Semantic Complexity Classifiers'],
    integrationPattern: '8ms ModernBERT router -> Tier 1 (Flash / Qwen3) -> Escalate on tool/reasoning complexity -> Tier 2 (Pro / Sonnet).',
    latencyAndCostNote: 'Drops blended enterprise cost from $6.80/1M to $2.42/1M while cutting median latency 48%.',
    headlineSoWhat: 'Your highest-leverage Week-1 consulting play: implement a 3-tier model cascade to cut client AI spend by ~64% and fund new initiatives.',
    talkingPoints: [
      'Lead CFO/CIO conversations with "self-funding AI transformation via FinOps routing."',
      'Eliminates single-provider outage risk via automatic cross-cloud circuit breaking.',
      'Provides per-department cost chargeback tags out of the box.',
    ],
    affectedEnterpriseStacks: ['AI Gateway / FinOps', 'Multi-Cloud Routing', 'CFO Chargeback'],
    causalTargetIds: ['seed-gemini-25-flash', 'seed-claude-4-sonnet', 'seed-qwen3-235b'],
  },
  {
    id: 'seed-iso-42001-kit',
    hoursAgo: 3.8,
    title: 'ISO/IEC 42001 + NIST AI RMF Automated Continuous Compliance Evidence Collector Reaches v1.0',
    shortLabel: 'ISO 42001 Auto-Audit',
    source: 'GitHub',
    sourceProvenance: ['GitHub'],
    url: 'https://www.nist.gov/itl/ai-risk-management-framework',
    primarySector: 'CRT',
    secondarySectors: ['GOV', 'INN'],
    mass: 2.95,
    readiness: 'GA',
    risk: 'LOW',
    finOps: 'REDUCER',
    rawAbstract:
      'Open-source compliance-as-code harness + Lead Auditor prep track automating drift logs, bias evaluations, and incident playbooks mapped directly to ISO 42001 Annex A.',
    architectSummary:
      'Turns manual quarterly spreadsheet audits into continuous CI/CD compliance attestations.',
    stackImpact: ['CI/CD Eval Gates', 'Vanta / Drata GRC', 'ISO 42001 Certification'],
    integrationPattern: 'Wire OpenTelemetry agent spans into automated Annex A evidence buckets on every release.',
    latencyAndCostNote: 'Saves ~220 hours of manual governance audit prep per enterprise engagement.',
    headlineSoWhat: 'Accelerates enterprise vendor security clearance—ISO 42001 is rapidly becoming the "SOC2 of AI" in Fortune 500 procurement.',
    talkingPoints: [
      'Advise B2B SaaS clients to start ISO 42001 readiness now to shorten enterprise sales cycles.',
      'Automating evidence collection from telemetry spans avoids developer friction.',
      'High-value Lead Implementer certification for governance-focused consultants.',
    ],
    affectedEnterpriseStacks: ['GRC / Vanta / Drata', 'CI/CD Pipelines', 'Procurement Security'],
    causalTargetIds: ['seed-eu-ai-act-gpai', 'seed-owasp-mcp-poisoning'],
  },
  {
    id: 'seed-sovereign-compute-pact',
    hoursAgo: 1.6,
    title: 'Hyperscaler & Sovereign Silicon Pact Commits 2.4GW Inference Capacity + Custom ASIC Price Drop',
    shortLabel: '2.4GW ASIC Price Drop',
    source: 'HackerNews',
    sourceProvenance: ['HackerNews'],
    url: 'https://news.ycombinator.com',
    primarySector: 'MKT',
    secondarySectors: ['ECO', 'ARC'],
    mass: 3.25,
    readiness: 'PREVIEW',
    risk: 'LOW',
    finOps: 'REDUCER',
    rawAbstract:
      'Next-gen custom inference ASICs (TPU v6e/v7, Trainium3, Maia) drive another 40% structural step-down in batch & async token pricing for committed enterprise reservations.',
    architectSummary:
      'Advises against locking into 3-year fixed-price GPU/token commits without annual deflationary reset clauses.',
    stackImpact: ['Cloud Commit Contracts', 'Batch Inference Pipelines', 'Multi-Silicon Portability'],
    integrationPattern: 'Negotiate cloud dollar-spend flexibility across regions/models rather than rigid per-model SKU locks.',
    latencyAndCostNote: 'Batch async inference now 50% cheaper than synchronous endpoints for overnight ETL.',
    headlineSoWhat: 'Contract negotiation alert: never sign multi-year AI token commits without price-ratchet protections—unit inference costs fall ~45%/yr.',
    talkingPoints: [
      'Review client cloud commitment renewals immediately to prevent over-committing at today\'s rates.',
      'Move non-interactive document enrichment to 50%-discounted Batch APIs overnight.',
      'Keep inference layers hardware-agnostic via standard OpenAI/MCP interfaces.',
    ],
    affectedEnterpriseStacks: ['Cloud FinOps Procurement', 'Batch Document ETL', 'Cloud Commits'],
    causalTargetIds: ['seed-finops-router-bench', 'seed-vllm-disagg-prefill'],
  },
];

export function buildInitial72hSeed(nowMs: number = Date.now()): SpatialSignal[] {
  return BLUEPRINTS.map((bp): SpatialSignal => ({
    id: bp.id,
    title: bp.title,
    shortLabel: bp.shortLabel,
    source: bp.source,
    sourceCategory: 'DEMO_SEED' as const,
    originFeedName: '72h Demo Seed',
    isDemoSeed: true,
    sourceProvenance: bp.sourceProvenance,
    url: bp.url,
    publishedAtMs: Math.round(nowMs - bp.hoursAgo * 3600_000),
    isLiveInbound: false,
    primarySector: bp.primarySector,
    secondarySectors: bp.secondarySectors,
    mass: bp.mass,
    readiness: bp.readiness,
    risk: bp.risk,
    finOps: bp.finOps,
    rawAbstract: bp.rawAbstract,
    canonicalEntity: extractCanonicalEntity(bp.title, bp.rawAbstract, bp.url)?.key,
    networkFamilies: bp.sourceProvenance.slice(0, 3),
    isSupernova: bp.sourceProvenance.length >= 3,
    supernovaLevel: bp.sourceProvenance.length >= 3 ? 1 : 0,
    mediaItems: [],
    streetQuotes: [
      {
        id: `${bp.id}-q-x`,
        network: 'X',
        originLabel: 'X · Frontier AI Pulse',
        author: '@ai_infra_lead',
        text: `${bp.shortLabel} ${bp.headlineSoWhat}`,
        score: 840,
        sentiment: 'HYPE',
        publishedAtMs: nowMs - Math.round(bp.hoursAgo * 3600_000),
      },
      {
        id: `${bp.id}-q-reddit`,
        network: 'Reddit',
        originLabel: 'r/LocalLLaMA',
        author: 'u/cuda_kernel_eng',
        text: `Verified on production eval harness: ${bp.latencyAndCostNote}`,
        score: 312,
        sentiment: 'VERIFIED',
        publishedAtMs: nowMs - Math.round(bp.hoursAgo * 3600_000) + 600_000,
      },
      {
        id: `${bp.id}-q-discord`,
        network: 'Discord',
        originLabel: '#announcements · AI Infra',
        author: 'core-maintainer',
        text: bp.integrationPattern,
        score: 94,
        sentiment: 'VERIFIED',
        publishedAtMs: nowMs - Math.round(bp.hoursAgo * 3600_000) + 900_000,
      },
    ],
    divergence: computeDivergenceMetrics([], bp.title, bp.rawAbstract),
    engagementVelocity: {
      likesOrUps: Math.round(bp.mass * 280),
      commentsOrReplies: Math.round(bp.mass * 42),
      velocityPerHour: Math.round(bp.mass * 38),
      badgeText: `🔥 ${Math.round(bp.mass * 38)}/hr · ${Math.round(bp.mass * 280)} pts`,
    },
    architectBrief: {
      summary: bp.architectSummary,
      stackImpact: bp.stackImpact,
      integrationPattern: bp.integrationPattern,
      latencyAndCostNote: bp.latencyAndCostNote,
    },
    cSuiteBrief: {
      headlineSoWhat: bp.headlineSoWhat,
      talkingPoints: bp.talkingPoints,
      industryLens: buildIndustryLens(
        bp.primarySector,
        bp.shortLabel,
        bp.headlineSoWhat,
        bp.finOps,
        bp.risk
      ),
    },
    affectedEnterpriseStacks: bp.affectedEnterpriseStacks,
    causalTargetIds: bp.causalTargetIds,
    modelSpecs: undefined,
  })).map((sig) => ({
    ...sig,
    evidenceScope: classifyEvidenceScope(sig),
    verifiedMetrics: extractSourceVerifiedMetrics(sig),
    literacy: buildDeterministicLiteracyPayload(sig),
  }));
}

export interface RawUpstreamSignal {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: SpatialSignal['source'];
  sourceCategory?: Exclude<SpatialSignal['sourceCategory'], undefined | 'DEMO_SEED'>;
  originFeedName?: string;
  publishedAtMs: number;
  updatedAtMs?: number;
  firstSeenAtMs?: number;
  score?: number;
  mediaItems?: MediaAttachment[];
  streetQuotes?: StreetQuote[];
  codeSnippet?: string;
  engagementVelocity?: SpatialSignal['engagementVelocity'];
}

const SECTOR_KEYWORDS: Array<{ sector: SectorId; words: string[] }> = [
  {
    sector: 'GOV',
    words: ['security', 'safety', 'policy', 'regulation', 'act', 'nist', 'iso', 'audit', 'jailbreak', 'injection', 'privacy', 'compliance', 'governance', 'poison', 'attack', 'guardrail'],
  },
  {
    sector: 'ECO',
    words: ['cost', 'price', 'pricing', 'finops', 'token', 'latency', 'throughput', 'benchmark', 'cheap', 'quantiz', 'fp8', 'int4', 'budget', 'efficiency', 'cache'],
  },
  {
    sector: 'CRT',
    words: ['course', 'certification', 'certified', 'curriculum', 'tutorial', 'handbook', 'learn', 'training', 'workshop', 'academy', 'exam'],
  },
  {
    sector: 'ARC',
    words: ['mcp', 'vllm', 'inference', 'kernel', 'cuda', 'triton', 'kubernetes', 'agent', 'framework', 'sdk', 'router', 'gateway', 'rag', 'graph', 'vector', 'engine', 'runtime', 'ollama', 'cursor'],
  },
  {
    sector: 'REL',
    words: ['release', 'launch', 'introducing', 'announcing', 'weights', 'model', 'checkpoint', 'v1', 'v2', 'v3', 'llm', 'multimodal', 'open-source', 'api'],
  },
  {
    sector: 'INN',
    words: ['case study', 'production', 'enterprise', 'healthcare', 'clinical', 'bank', 'finance', 'workflow', 'automation', 'roi', 'customer', 'deployed'],
  },
  {
    sector: 'MKT',
    words: ['funding', 'raises', 'acquires', 'acquisition', 'billion', 'datacenter', 'gpu', 'partnership', 'sovereign', 'valuation', 'alliance'],
  },
  {
    sector: 'SCI',
    words: ['arxiv', 'theorem', 'proof', 'attention', 'transformer', 'diffusion', 'reinforcement', 'rlvr', 'interpretability', 'scaling', 'latent', 'gradient', 'neural'],
  },
];

export function synthesizeRawItemToSpatialSignal(
  raw: RawUpstreamSignal,
  isLiveInbound: boolean
): SpatialSignal {
  const hay = `${raw.title} ${raw.summary}`.toLowerCase();
  const scored = SECTOR_KEYWORDS.map((entry) => {
    let hits = 0;
    for (const w of entry.words) {
      if (hay.includes(w)) hits += 1;
    }
    if (raw.source === 'arXiv' && entry.sector === 'SCI') hits += 2;
    if ((raw.source === 'GitHub' || raw.source === 'GHRelease') && entry.sector === 'ARC') hits += 1.5;
    if (raw.source === 'HuggingFace' && entry.sector === 'REL') hits += 1.5;
    if (raw.source === 'Discord' && entry.sector === 'REL') hits += 1.2;
    return { sector: entry.sector, hits };
  }).sort((a, b) => b.hits - a.hits);

  const primarySector: SectorId = scored[0].hits > 0 ? scored[0].sector : raw.source === 'arXiv' ? 'SCI' : 'ARC';
  const secondarySectors: SectorId[] = scored
    .slice(1, 3)
    .filter((s) => s.hits > 0)
    .map((s) => s.sector);
  if (secondarySectors.length === 0) {
    secondarySectors.push(primarySector === 'SCI' ? 'ARC' : 'ECO');
  }

  const relMeta =
    raw.source === 'GHRelease' || /github\.com\/[^/\s]+\/[^/\s]+\/releases\/tag\//i.test(raw.url || '')
      ? parseGitHubReleaseMetadata(raw.title, raw.url, raw.originFeedName)
      : null;

  const readiness: ReadinessState =
    raw.source === 'arXiv'
      ? 'RESEARCH'
      : relMeta
      ? relMeta.isPreRelease
        ? 'PREVIEW'
        : 'GA'
      : /\b(preview|beta|alpha|-rc\d*)\b/i.test(hay)
      ? 'PREVIEW'
      : 'GA';

  const risk: RiskLevel =
    primarySector === 'GOV' || hay.includes('vulnerab') || hay.includes('exploit')
      ? 'HIGH'
      : readiness === 'RESEARCH'
      ? 'MODERATE'
      : 'LOW';

  const finOps: FinOpsImpact =
    hay.includes('fast') || hay.includes('efficien') || hay.includes('compress') || hay.includes('cache') || hay.includes('quant') || primarySector === 'ECO'
      ? 'REDUCER'
      : hay.includes('cluster') || hay.includes('frontier')
      ? 'INTENSIVE'
      : 'NEUTRAL';

  const originLabel = raw.originFeedName || raw.source;
  const escapedOrigin = originLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rawDisplayTitle = stripHtmlMarkupAndEntities(raw.title)
    .replace(new RegExp(`^${escapedOrigin}\\s*[:—-]\\s*`, 'i'), '')
    .replace(/^(?:OpenAI News|Google DeepMind|Anthropic News|Meta AI Eng|HF Paper|arXiv)\s*:\s*/i, '')
    .replace(/^r\/[A-Za-z0-9_]+:\s*/i, '')
    .trim();
  const displayTitle = relMeta ? relMeta.displayTitle : rawDisplayTitle;

  const cleanTitle = displayTitle
    .replace(/^\[[^\]]+\]\s*/, '')
    .trim();
  const rawWords = cleanTitle.replace(/[^\w\s.-]/g, ' ').split(/\s+/).filter(Boolean);
  const danglingTail = /^(?:for|of|the|and|with|to|in|on|at|by|from|vs|a|an|is|are|that|about)$/i;
  let labelWords = rawWords.slice(0, 5);
  while (labelWords.length > 2 && danglingTail.test(labelWords[labelWords.length - 1])) {
    labelWords = labelWords.slice(0, -1);
  }
  const joinedLabel = labelWords.join(' ');
  const shortLabel = relMeta
    ? relMeta.displayTitle
    : joinedLabel.length <= 32
    ? joinedLabel || raw.source
    : `${joinedLabel.slice(0, 30).replace(/\s+\S*$/, '')}…`;

  const baseScore = raw.score ?? 80;
  const mass = Math.min(4.2, Math.max(1.6, 1.8 + Math.log10(Math.max(10, baseScore)) * 0.65));

  const rawSummaryClean = relMeta
    ? sanitizeReleaseNotesText(raw.summary, displayTitle).cleanText
    : stripUiChromeBoilerplate(
        stripHtmlMarkupAndEntities(raw.summary)
          .replace(new RegExp(`^${escapedOrigin}\\s*[:—-]\\s*`, 'i'), '')
          .trim()
      );
  const cleanSummary = relMeta
    ? rawSummaryClean.slice(0, 3200)
    : rawSummaryClean.slice(0, 3200) || displayTitle;

  const summarySentences = cleanSummary
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 32 && s.toLowerCase() !== displayTitle.toLowerCase());

  const leadFactSentence = summarySentences[0] || truncateAtWordBoundary(cleanSummary, 220);
  const secondaryFactSentence = summarySentences[1] || '';

  const headlineSoWhat = truncateAtWordBoundary(leadFactSentence, 210);

  const isDiscussionPost =
    /\b(discussion hub|megathread|weekly|daily thread|i think|unpopular opinion|thoughts on|anyone else|question|ask hn|show hn|rant|hiring|who is hiring)\b/i.test(
      cleanTitle
    ) || raw.source === 'Reddit' || raw.source === 'HackerNews' || raw.source === 'Bluesky' || raw.source === 'VIPBlog';

  const inferredCategory: NonNullable<SpatialSignal['sourceCategory']> =
    raw.sourceCategory ||
    (raw.source === 'arXiv' || raw.source === 'HuggingFace'
      ? 'RESEARCH'
      : raw.source === 'Bluesky'
      ? 'SOCIAL_BLUESKY'
      : raw.source === 'VIPBlog'
      ? 'VIP_VOICE'
      : raw.source === 'Reddit'
      ? 'REDDIT'
      : raw.source === 'GHRelease' || raw.source === 'GitHub'
      ? 'GH_RELEASE'
      : raw.source === 'LabRelease'
      ? 'AI_LAB'
      : raw.source === 'XPlaywright'
      ? 'X_PLAYWRIGHT'
      : raw.source === 'Discord'
      ? 'DISCORD_RELAY'
      : raw.source === 'XBridge'
      ? 'X_BRIDGE'
      : 'HN_COMMUNITY');

  const netFamily = mapSourceToNetworkFamily(raw.source, originLabel);
  const entity = extractCanonicalEntity(displayTitle, cleanSummary, raw.url);

  const initialQuotes: StreetQuote[] =
    raw.streetQuotes && raw.streetQuotes.length > 0
      ? raw.streetQuotes
      : [
          {
            id: `${raw.id}-self-quote`,
            network:
              netFamily === 'X'
                ? 'X'
                : netFamily === 'Reddit'
                ? 'Reddit'
                : netFamily === 'Discord'
                ? 'Discord'
                : netFamily === 'GitHub'
                ? 'GitHub'
                : netFamily === 'Bluesky'
                ? 'Bluesky'
                : 'HackerNews',
            originLabel,
            author: originLabel,
            text: truncateAtWordBoundary(leadFactSentence, 240),
            score: Math.round(baseScore),
            sentiment: scoreStreetSentiment(`${displayTitle} ${cleanSummary}`),
            publishedAtMs: raw.publishedAtMs,
            url: raw.url,
          },
        ];

  const divergence = computeDivergenceMetrics(
    initialQuotes,
    displayTitle,
    cleanSummary,
    raw.engagementVelocity
  );

  // Strict Honesty Rule: ONLY preserve real scraped upstream images/videos (zero synthetic SVG tok/s charts)
  const mediaItems: MediaAttachment[] = (raw.mediaItems || []).filter(
    (m) => m.type !== 'chart' && !m.url.startsWith('data:image/svg+xml')
  );

  // Strict Honesty Rule: ONLY surface engagementVelocity when upstream genuinely reports points/likes/stars/comments
  const engagementVelocity = raw.engagementVelocity;

  const built: SpatialSignal = {
    id: raw.id,
    title: truncateAtWordBoundary(displayTitle || raw.title, 220),
    shortLabel,
    source: raw.source,
    sourceCategory: inferredCategory,
    originFeedName: originLabel,
    isDemoSeed: false,
    sourceProvenance: [originLabel],
    networkFamilies: [netFamily],
    canonicalEntity: entity?.key,
    isSupernova: false,
    supernovaLevel: 0,
    divergence,
    mediaItems,
    streetQuotes: initialQuotes,
    codeSnippet: raw.codeSnippet,
    engagementVelocity,
    url: raw.url,
    publishedAtMs: raw.publishedAtMs,
    updatedAtMs: raw.updatedAtMs,
    firstSeenAtMs: raw.firstSeenAtMs,
    isLiveInbound,
    primarySector,
    secondarySectors,
    mass,
    readiness,
    risk,
    finOps,
    rawAbstract: cleanSummary,
    architectBrief: {
      summary: secondaryFactSentence
        ? truncateAtWordBoundary(`${leadFactSentence} ${secondaryFactSentence}`, 320)
        : truncateAtWordBoundary(leadFactSentence, 300),
      stackImpact: [`${primarySector} Pipeline`, 'AI Gateway / Router', 'Observability & EvalOps'],
      integrationPattern:
        readiness === 'RESEARCH'
          ? 'Prototype in isolated R&D harness against domain benchmarks before committing production SLAs.'
          : 'Canary behind enterprise AI gateway with audit logging and domain accuracy assertions.',
      latencyAndCostNote:
        finOps === 'REDUCER'
          ? 'Targets unit-cost and latency reduction on matching enterprise workloads.'
          : 'Validate task completion accuracy and per-workflow unit economics against current baseline.',
    },
    cSuiteBrief: {
      headlineSoWhat,
      talkingPoints: [
        truncateAtWordBoundary(leadFactSentence, 180),
        ...(secondaryFactSentence ? [truncateAtWordBoundary(secondaryFactSentence, 180)] : []),
        `Readiness: ${readiness} (${originLabel}).`,
      ],
      industryLens: buildIndustryLens(primarySector, shortLabel, headlineSoWhat, finOps, risk),
    },
    affectedEnterpriseStacks: inferDomainEnterpriseStacks({
      title: displayTitle || raw.title,
      rawAbstract: cleanSummary,
      url: raw.url,
      primarySector,
    }),
    modelSpecs: undefined,
  };
  built.evidenceScope = classifyEvidenceScope(built);
  built.verifiedMetrics = extractSourceVerifiedMetrics(built);
  built.literacy = buildDeterministicLiteracyPayload(built);
  return built;
}
