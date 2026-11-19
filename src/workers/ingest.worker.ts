/// <reference lib="webworker" />
import { buildDeterministicLiteracyPayload } from '../../shared/literacyEngine';
import {
  buildInitial72hSeed,
  RawUpstreamSignal,
  synthesizeRawItemToSpatialSignal,
} from '../../shared/seed72h';
import {
  computeDivergenceMetrics,
  extractCanonicalEntity,
  mapSourceToNetworkFamily,
  shouldClusterIntoSupernova,
} from '../../shared/supernovaEngine';
import type {
  DefconAnomalyEvent,
  MediaAttachment,
  SpatialSignal,
  StreetQuote,
} from '../../shared/types';

declare const self: DedicatedWorkerGlobalScope;

const shingleIndex = new Map<string, Set<string>>();
const urlIndex = new Map<string, string>();
const knownIds = new Set<string>();
const signalStore = new Map<string, SpatialSignal>();
const entityPrimarySignalId = new Map<string, string>();

// 45-minute sliding window per canonical entity: entityKey -> Map<networkFamily, timestampMs>
const WINDOW_45M_MS = 45 * 60_000;
const entityWindowPlatforms = new Map<string, Map<string, number>>();
const defconCooldownByEntity = new Map<string, number>();

const pendingInboundQueue: SpatialSignal[] = [];
let initialLiveHydrated = false;
let staticSnapshotActive = false;

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '');
}

function buildShingles(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const set = new Set<string>();
  if (tokens.length < 3) {
    for (const t of tokens) set.add(t);
    return set;
  }
  for (let i = 0; i <= tokens.length - 2; i++) {
    set.add(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return set;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const item of a) {
    if (b.has(item)) inter++;
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function registerSignalInIndex(sig: SpatialSignal): void {
  knownIds.add(sig.id);
  signalStore.set(sig.id, sig);
  urlIndex.set(normalizeUrl(sig.url), sig.id);
  shingleIndex.set(sig.id, buildShingles(sig.title));
  if (sig.canonicalEntity && !sig.isDemoSeed) {
    if (!entityPrimarySignalId.has(sig.canonicalEntity)) {
      entityPrimarySignalId.set(sig.canonicalEntity, sig.id);
    }
  }
}

function recordEntityPlatformArrival(
  entityKey: string,
  entityLabel: string,
  networkFamily: string,
  signalId: string,
  divergenceSummary: string,
  extraQuoteNetworks: string[] = []
): void {
  const now = Date.now();
  let platMap = entityWindowPlatforms.get(entityKey);
  if (!platMap) {
    platMap = new Map<string, number>();
    entityWindowPlatforms.set(entityKey, platMap);
  }
  platMap.set(networkFamily, now);
  for (const qNet of extraQuoteNetworks) {
    platMap.set(qNet, now);
  }

  // Prune entries older than 45 minutes
  for (const [net, ts] of platMap.entries()) {
    if (now - ts > WINDOW_45M_MS) {
      platMap.delete(net);
    }
  }

  if (platMap.size >= 3) {
    const lastFired = defconCooldownByEntity.get(entityKey) || 0;
    if (now - lastFired > 180_000) {
      defconCooldownByEntity.set(entityKey, now);
      const anomaly: DefconAnomalyEvent = {
        id: `defcon-${entityKey}-${now}`,
        entityKey,
        entityLabel,
        signalId,
        platforms: Array.from(platMap.keys()),
        detectedAtMs: now,
        divergenceSummary,
      };
      self.postMessage({
        type: 'DEFCON_ANOMALY_DETECTED',
        anomaly,
      });
    }
  }
}

function mergeIntoSupernova(existing: SpatialSignal, incoming: SpatialSignal): void {
  const provSet = new Set([...existing.sourceProvenance, ...incoming.sourceProvenance]);
  existing.sourceProvenance = Array.from(provSet);

  const netSet = new Set([
    ...(existing.networkFamilies || []),
    ...(incoming.networkFamilies || []),
    ...(incoming.streetQuotes || []).map((q) => q.network),
  ]);
  existing.networkFamilies = Array.from(netSet);

  // Merge media: STRICTLY preserve primary signal's own media first (never let sibling banners hijack the hero slot!)
  const existingRealMedia = (existing.mediaItems || []).filter((m) => m.type !== 'chart');
  const mergedMedia: MediaAttachment[] =
    existingRealMedia.length > 0
      ? [...existingRealMedia]
      : [...(existing.mediaItems || []), ...(incoming.mediaItems || []).slice(0, 1)];
  const uniqueMedia: MediaAttachment[] = [];
  const seenUrls = new Set<string>();
  for (const m of mergedMedia) {
    if (!seenUrls.has(m.url)) {
      seenUrls.add(m.url);
      uniqueMedia.push(m);
    }
  }
  uniqueMedia.sort((a, b) => (a.type === 'chart' ? 1 : 0) - (b.type === 'chart' ? 1 : 0));
  existing.mediaItems = uniqueMedia.slice(0, 1);

  // Merge Street Crossfire quotes across X, Reddit, Discord, GitHub, HN
  const mergedQuotes: StreetQuote[] = [
    ...(incoming.streetQuotes || []),
    ...(existing.streetQuotes || []),
  ];
  const uniqueQuotes: StreetQuote[] = [];
  const seenQuoteTxt = new Set<string>();
  for (const q of mergedQuotes) {
    const key = `${q.network}:${q.text.slice(0, 48)}`;
    if (!seenQuoteTxt.has(key)) {
      seenQuoteTxt.add(key);
      uniqueQuotes.push(q);
    }
  }
  existing.streetQuotes = uniqueQuotes.slice(0, 8);

  if (incoming.codeSnippet && !existing.codeSnippet) {
    existing.codeSnippet = incoming.codeSnippet;
  }

  const netCount = existing.networkFamilies.length;
  if (netCount >= 2) {
    existing.isSupernova = true;
    existing.supernovaLevel = netCount >= 3 ? 2 : 1;
    existing.mass = Math.min(5.2, Math.max(existing.mass, 4.1 + netCount * 0.35));
  }

  existing.divergence = computeDivergenceMetrics(
    existing.streetQuotes,
    existing.title,
    existing.rawAbstract
  );
  existing.literacy = buildDeterministicLiteracyPayload(existing);

  self.postMessage({
    type: 'SUPERNOVA_FUSED',
    signal: existing,
  });

  if (existing.canonicalEntity) {
    const entMeta = extractCanonicalEntity(existing.title, existing.rawAbstract, existing.url);
    recordEntityPlatformArrival(
      existing.canonicalEntity,
      entMeta?.label || existing.shortLabel,
      incoming.networkFamilies?.[0] || incoming.source,
      existing.id,
      existing.divergence.summary,
      existing.networkFamilies
    );
  }
}

function deduplicateAndSynthesize(
  raw: RawUpstreamSignal,
  immediateBypass = false
): SpatialSignal | null {
  if (knownIds.has(raw.id)) return null;

  const synthesized = synthesizeRawItemToSpatialSignal(raw, true);
  const normUrl = normalizeUrl(raw.url);

  // 1. Exact URL match -> Provenance + Supernova merge
  const existingByUrlId = urlIndex.get(normUrl);
  if (existingByUrlId) {
    const existing = signalStore.get(existingByUrlId);
    knownIds.add(raw.id);
    if (existing) {
      mergeIntoSupernova(existing, synthesized);
    }
    return null;
  }

  // 2. Cross-Platform Supernova Entity Clustering (when same entity surfaces on a different network!)
  if (synthesized.canonicalEntity) {
    const primaryId = entityPrimarySignalId.get(synthesized.canonicalEntity);
    const existingPrimary = primaryId ? signalStore.get(primaryId) : undefined;
    const incomingNet = synthesized.networkFamilies?.[0] || synthesized.source;

    if (
      existingPrimary &&
      !existingPrimary.isDemoSeed &&
      shouldClusterIntoSupernova(existingPrimary, synthesized) &&
      (!existingPrimary.networkFamilies?.includes(incomingNet) || immediateBypass)
    ) {
      knownIds.add(raw.id);
      mergeIntoSupernova(existingPrimary, synthesized);
      return null;
    }
  }

  // 3. Token-shingle Jaccard near-duplicate check (additionally gated by strict entity coherence!)
  const candidateShingles = buildShingles(raw.title);
  for (const [existingId, existingSet] of shingleIndex.entries()) {
    if (jaccardSimilarity(candidateShingles, existingSet) >= 0.56) {
      const existing = signalStore.get(existingId);
      if (existing && shouldClusterIntoSupernova(existing, synthesized)) {
        knownIds.add(raw.id);
        mergeIntoSupernova(existing, synthesized);
        return null;
      }
    }
  }

  registerSignalInIndex(synthesized);

  if (synthesized.canonicalEntity) {
    const entMeta = extractCanonicalEntity(raw.title, raw.summary, raw.url);
    const quoteNets = (synthesized.streetQuotes || []).map((q) => q.network);
    recordEntityPlatformArrival(
      synthesized.canonicalEntity,
      entMeta?.label || synthesized.shortLabel,
      mapSourceToNetworkFamily(raw.source, raw.originFeedName),
      synthesized.id,
      synthesized.divergence?.summary || 'Cross-platform velocity surge',
      quoteNets
    );

    // Upgrade immediately if incoming signal already carries multi-network crossfire quotes (e.g., crossposted Discord relay)
    const distinctQuoteNets = new Set([
      ...(synthesized.networkFamilies || []),
      ...quoteNets,
    ]);
    if (distinctQuoteNets.size >= 2) {
      synthesized.networkFamilies = Array.from(distinctQuoteNets);
      synthesized.isSupernova = true;
      synthesized.supernovaLevel = distinctQuoteNets.size >= 3 ? 2 : 1;
      synthesized.mass = Math.min(5.2, 4.2 + distinctQuoteNets.size * 0.3);
    }
  }

  return synthesized;
}

// Worker-driven release timer (exempt from background tab RAF freeze!)
setInterval(() => {
  const next = pendingInboundQueue.shift();
  if (next) {
    next.publishedAtMs = Date.now();
    self.postMessage({
      type: 'LIVE_SIGNAL_INBOUND',
      signal: next,
      queueRemaining: pendingInboundQueue.length,
    });
  }
}, 3200);

// Worker-driven background keep-alive delta sync every 48s so unfocused secondary monitors never stall
setInterval(() => {
  void fetchLiveProxyAndFallback();
}, 48_000);

async function fetchLiveProxyAndFallback(): Promise<void> {
  if (staticSnapshotActive) return;
  let gotItems = false;
  try {
    const res = await fetch('/api/live-batch');
    if (res.ok) {
      const json = (await res.json()) as { items?: RawUpstreamSignal[] };
      if (json.items && json.items.length > 0) {
        gotItems = true;
        const fresh: SpatialSignal[] = [];
        for (const item of json.items.slice(0, 56)) {
          const s = deduplicateAndSynthesize(item);
          if (s) fresh.push(s);
        }

        if (fresh.length > 0) {
          if (!initialLiveHydrated) {
            initialLiveHydrated = true;
            const immediate = fresh.slice(0, 24);
            const trickle = fresh.slice(24);
            self.postMessage({
              type: 'LIVE_BATCH_HYDRATED',
              signals: immediate,
            });
            pendingInboundQueue.push(...trickle);
          } else {
            pendingInboundQueue.push(...fresh);
          }
        }
      }
    }
  } catch {
    // Fallback to direct CORS-safe HN Algolia if proxy warming up
  }

  if (!gotItems) {
    try {
      const hnRes = await fetch(
        'https://hn.algolia.com/api/v1/search_by_date?query=LLM%20OR%20MCP%20OR%20vLLM&tags=story&hitsPerPage=8'
      );
      if (hnRes.ok) {
        const data = (await hnRes.json()) as {
          hits?: Array<{
            objectID: string;
            title?: string;
            url?: string;
            points?: number;
            created_at_i?: number;
          }>;
        };
        for (const h of data.hits || []) {
          if (h.title) {
            const s = deduplicateAndSynthesize({
              id: `hn-direct-${h.objectID}`,
              title: h.title,
              summary: `Live Hacker News telemetry (${h.points ?? 25} pts): ${h.title}`,
              url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
              source: 'HackerNews',
              sourceCategory: 'HN_COMMUNITY',
              originFeedName: 'Hacker News',
              publishedAtMs: h.created_at_i ? h.created_at_i * 1000 : Date.now(),
              score: (h.points || 20) + 35,
            });
            if (s) pendingInboundQueue.push(s);
          }
        }
      }
    } catch {
      // Offline graceful fallback
    }
  }
}

let sseConnection: EventSource | null = null;
function connectLiveSSE(): void {
  try {
    sseConnection = new EventSource('/api/stream/live');
    sseConnection.addEventListener('upstream_batch', (ev: MessageEvent) => {
      try {
        const items = JSON.parse(ev.data) as RawUpstreamSignal[];
        for (const item of items) {
          const s = deduplicateAndSynthesize(item);
          if (s) pendingInboundQueue.push(s);
        }
      } catch {
        // Ignore malformed SSE payload
      }
    });

    // Millisecond-live Discord #announcements relay bypasses trickle queue!
    sseConnection.addEventListener('discord_announcement', (ev: MessageEvent) => {
      try {
        const items = JSON.parse(ev.data) as RawUpstreamSignal[];
        for (const item of items) {
          const s = deduplicateAndSynthesize(item, false);
          if (s) {
            s.publishedAtMs = Date.now();
            self.postMessage({
              type: 'LIVE_SIGNAL_INBOUND',
              signal: s,
              queueRemaining: pendingInboundQueue.length,
            });
          }
        }
      } catch {
        // Ignore malformed Discord SSE payload
      }
    });
  } catch {
    // Ignore if SSE unavailable
  }
}

const LIVE_PROBE_POOL: Array<Omit<RawUpstreamSignal, 'id' | 'publishedAtMs'>> = [
  {
    title: 'r/LocalLLaMA: vLLM Eagle-3 FP8 vs Ollama Q8_0 KV-Cache Benchmark on 12GB–24GB GPUs',
    summary:
      'Engineer street verdict verifying real tokens/sec and VRAM ceilings across Qwen3-14B and Llama-4 Scout.',
    url: 'https://www.reddit.com/r/LocalLLaMA/',
    source: 'Reddit',
    sourceCategory: 'REDDIT',
    originFeedName: 'r/LocalLLaMA',
    score: 215,
  },
  {
    title: 'Simon Willison: Testing MCP OAuth Delegation & Structured Tool Schemas in Production',
    summary:
      'Hands-on architectural notes benchmarking latency and token-cache reuse across multi-server Model Context Protocol tool chains.',
    url: 'https://simonwillison.net/',
    source: 'VIPBlog',
    sourceCategory: 'VIP_VOICE',
    originFeedName: 'Simon Willison',
    score: 175,
  },
  {
    title: 'arXiv: Sub-Quadratic Speculative MoE Routing Cuts Multi-Agent Latency 47%',
    summary:
      'Token-tree speculative verification across distributed Mixture-of-Experts shards achieves 310 tok/s with lossless reasoning parity.',
    url: 'https://arxiv.org/list/cs.LG/recent',
    source: 'arXiv',
    sourceCategory: 'RESEARCH',
    originFeedName: 'arXiv cs.LG',
    score: 165,
  },
];
let probeCursor = 0;

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'INIT') {
    const now = Date.now();
    const seed = buildInitial72hSeed(now);
    for (const s of seed) {
      registerSignalInIndex(s);
    }
    self.postMessage({
      type: 'SEED_HYDRATED',
      signals: seed,
      hydratedAtMs: now,
    });
    if (!msg.preferStaticOnly) {
      void fetchLiveProxyAndFallback();
      connectLiveSSE();
    }
  } else if (msg.type === 'HYDRATE_STATIC_SNAPSHOT' && Array.isArray(msg.signals)) {
    staticSnapshotActive = true;
    if (sseConnection) {
      try {
        sseConnection.close();
      } catch {
        // Ignore SSE close errors
      }
      sseConnection = null;
    }
    const freshStatic: SpatialSignal[] = [];
    for (const sig of msg.signals as SpatialSignal[]) {
      if (!sig || !sig.id || knownIds.has(sig.id)) continue;
      registerSignalInIndex(sig);
      freshStatic.push(sig);
    }
    if (freshStatic.length > 0) {
      initialLiveHydrated = true;
      self.postMessage({
        type: 'LIVE_BATCH_HYDRATED',
        signals: freshStatic,
      });
    }
  } else if (msg.type === 'REFRESH_UPSTREAMS') {
    void fetchLiveProxyAndFallback();
  } else if (msg.type === 'TRIGGER_ORBITAL_DROP') {
    const nextQueued = pendingInboundQueue.shift();
    if (nextQueued) {
      nextQueued.publishedAtMs = Date.now();
      self.postMessage({
        type: 'LIVE_SIGNAL_INBOUND',
        signal: nextQueued,
        queueRemaining: pendingInboundQueue.length,
      });
      return;
    }

    const template = LIVE_PROBE_POOL[probeCursor % LIVE_PROBE_POOL.length];
    probeCursor++;
    const now = Date.now();
    const raw: RawUpstreamSignal = {
      ...template,
      id: `live-drop-${now}-${probeCursor}`,
      publishedAtMs: now,
    };
    const sig = synthesizeRawItemToSpatialSignal(raw, true);
    registerSignalInIndex(sig);
    self.postMessage({
      type: 'LIVE_SIGNAL_INBOUND',
      signal: sig,
      queueRemaining: pendingInboundQueue.length,
    });
  }
};
