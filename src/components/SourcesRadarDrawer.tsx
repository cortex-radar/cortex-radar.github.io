import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  KeyRound,
  LogIn,
  Plus,
  Radar,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  AdapterId,
  AdapterTelemetryStatus,
  SourceCategory,
  SynthesisEngineStatus,
  UpstreamFeedHealth,
} from '../../shared/types';
import {
  CockpitSwitch,
  CockpitTabsList,
  CockpitTabsTrigger,
  InstrumentButton,
  Kbd,
  ObsidianPanel,
} from './ui/cockpit-primitives';

interface SourcesRadarDrawerProps {
  isOpen: boolean;
  showDemoSeed: boolean;
  enabledCategories: Record<Exclude<SourceCategory, 'DEMO_SEED'>, boolean>;
  liveVerifiedCount: number;
  demoSeedCount: number;
  onClose: () => void;
  onToggleDemoSeed: (show: boolean) => void;
  onToggleCategory: (cat: Exclude<SourceCategory, 'DEMO_SEED'>) => void;
  onSourcesUpdated: () => void;
  onSynthesisStatusUpdated?: (synth: SynthesisEngineStatus) => void;
}

const CATEGORY_LABELS: Array<{ id: Exclude<SourceCategory, 'DEMO_SEED'>; label: string }> = [
  { id: 'REDDIT', label: 'Deep Reddit (12 Subs)' },
  { id: 'DISCORD_RELAY', label: 'Discord Announcements' },
  { id: 'X_PLAYWRIGHT', label: 'Local Playwright X' },
  { id: 'VIP_VOICE', label: 'VIP Blogs & Substacks' },
  { id: 'SOCIAL_BLUESKY', label: 'Bluesky Public API' },
  { id: 'AI_LAB', label: 'Official AI Lab Blogs' },
  { id: 'GH_RELEASE', label: 'GitHub Releases & MCP' },
  { id: 'RESEARCH', label: 'arXiv & HF Papers' },
  { id: 'HN_COMMUNITY', label: 'Hacker News Stream' },
];

export const SourcesRadarDrawer: React.FC<SourcesRadarDrawerProps> = ({
  isOpen,
  showDemoSeed,
  enabledCategories,
  liveVerifiedCount,
  demoSeedCount,
  onClose,
  onToggleDemoSeed,
  onToggleCategory,
  onSourcesUpdated,
  onSynthesisStatusUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'SWITCHBOARD' | 'FEEDS'>('SWITCHBOARD');
  const [adapters, setAdapters] = useState<AdapterTelemetryStatus[]>([]);
  const [sources, setSources] = useState<UpstreamFeedHealth[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Runtime credential inputs (persisted locally to .env.local via 127.0.0.1:3001)
  const [xAuthToken, setXAuthToken] = useState('');
  const [xCt0, setXCt0] = useState('');
  const [xPwQuery, setXPwQuery] = useState(
    '(vllm OR ollama OR "open weights" OR benchmark OR release OR MCP) min_faves:100 -filter:replies'
  );
  const [xListIds, setXListIds] = useState('');

  const [discordBotToken, setDiscordBotToken] = useState('');
  const [discordGuildId, setDiscordGuildId] = useState('');

  // Custom RSS / Bluesky / Subreddit inputs
  const [customKind, setCustomKind] = useState<'RSS' | 'BLUESKY' | 'REDDIT'>('RSS');
  const [customValue, setCustomValue] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [xBridgeUrl, setXBridgeUrl] = useState('https://nitter.jaydenha.uk');
  const [xBridgeHandle, setXBridgeHandle] = useState('karpathy');

  const loadAllTelemetry = async () => {
    try {
      const [adapRes, srcRes] = await Promise.all([
        fetch('/api/adapters/status'),
        fetch('/api/sources'),
      ]);
      if (adapRes.ok) {
        const adapData = (await adapRes.json()) as {
          adapters?: AdapterTelemetryStatus[];
          synthesis?: SynthesisEngineStatus;
        };
        if (adapData.adapters) setAdapters(adapData.adapters);
        if (adapData.synthesis && onSynthesisStatusUpdated) {
          onSynthesisStatusUpdated(adapData.synthesis);
        }
      }
      if (srcRes.ok) {
        const srcData = (await srcRes.json()) as {
          sources?: UpstreamFeedHealth[];
          xBridgeBaseUrl?: string;
          xBridgeHandle?: string;
        };
        if (srcData.sources) setSources(srcData.sources);
        if (srcData.xBridgeBaseUrl) setXBridgeUrl(srcData.xBridgeBaseUrl);
        if (srcData.xBridgeHandle) setXBridgeHandle(srcData.xBridgeHandle);
      }
    } catch {
      // Ignore transient network hiccup
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void loadAllTelemetry();
    const timer = setInterval(() => {
      void loadAllTelemetry();
    }, 4500);
    return () => clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleAdapter = async (adapterId: AdapterId, nextEnabled: boolean) => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/adapters/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId, enabled: nextEnabled }),
      });
      const data = (await res.json()) as { adapters?: AdapterTelemetryStatus[]; error?: string };
      if (data.adapters) setAdapters(data.adapters);
      setStatusMsg(data.error || `Adapter ${adapterId} ${nextEnabled ? 'enabled' : 'paused'}.`);
      onSourcesUpdated();
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAdapterCredentials = async (
    adapterId: AdapterId,
    payload: Record<string, unknown>
  ) => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/adapters/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId, enabled: true, ...payload }),
      });
      const data = (await res.json()) as { adapters?: AdapterTelemetryStatus[]; error?: string };
      if (data.adapters) setAdapters(data.adapters);
      if (data.error) {
        setStatusMsg(data.error);
      } else {
        setStatusMsg(`Saved ${adapterId} credentials to local .env.local & activated adapter.`);
        setXAuthToken('');
        setXCt0('');
        setDiscordBotToken('');
        onSourcesUpdated();
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBenchmarkAdapter = async (adapterId: AdapterId) => {
    setLoading(true);
    setStatusMsg(`Running live poll on ${adapterId}...`);
    try {
      const res = await fetch('/api/adapters/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adapterId }),
      });
      const data = (await res.json()) as {
        fetchedCount?: number;
        elapsedMs?: number;
        adapters?: AdapterTelemetryStatus[];
        error?: string;
      };
      if (data.adapters) setAdapters(data.adapters);
      setStatusMsg(
        data.error ||
          `${adapterId} fetched ${data.fetchedCount ?? 0} signals in ${data.elapsedMs ?? 0}ms.`
      );
      onSourcesUpdated();
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPlaywrightLogin = async () => {
    setLoading(true);
    setStatusMsg('Opening local Playwright X login window (.cortex-x-profile)...');
    try {
      const res = await fetch('/api/adapters/x-playwright/login-window', { method: 'POST' });
      const data = (await res.json()) as {
        message?: string;
        adapters?: AdapterTelemetryStatus[];
      };
      if (data.adapters) setAdapters(data.adapters);
      setStatusMsg(data.message || 'Playwright login window completed.');
      onSourcesUpdated();
    } finally {
      setLoading(false);
    }
  };

  const handleFireDiscordTestRelay = async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/ingest/discord-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulatePreset: true }),
      });
      const data = (await res.json()) as {
        adapters?: AdapterTelemetryStatus[];
        signal?: { title?: string };
      };
      if (data.adapters) setAdapters(data.adapters);
      setStatusMsg(
        `Relayed live over SSE /api/stream/live: "${
          data.signal?.title?.slice(0, 68) || 'Discord Announcement'
        }"`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleForceSweep = async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      await fetch('/api/sources/refresh', { method: 'POST' });
      await loadAllTelemetry();
      onSourcesUpdated();
      setStatusMsg('Completed parallel sweep across Deep Reddit (12 subs) + 29 $0 feeds.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customValue.trim()) return;
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/sources/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: customKind,
          value: customValue.trim(),
          label: customLabel.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatusMsg(json.error || 'Failed to add source');
      } else {
        setCustomValue('');
        setCustomLabel('');
        await loadAllTelemetry();
        onSourcesUpdated();
        setStatusMsg('Added custom source & ingested live items.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveXBridge = async () => {
    setLoading(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/sources/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'X_BRIDGE',
          xBaseUrl: xBridgeUrl.trim(),
          xHandle: xBridgeHandle.trim(),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatusMsg(json.error || 'Invalid X-Bridge URL');
      } else {
        await loadAllTelemetry();
        onSourcesUpdated();
        setStatusMsg('Updated X-RSS Bridge slot (2.5s fast-fail active).');
      }
    } finally {
      setLoading(false);
    }
  };

  const stateBadgeStyle = (state: AdapterTelemetryStatus['state']) => {
    if (state === 'ACTIVE') return 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300';
    if (state === 'READY_FOR_CREDENTIALS')
      return 'bg-zinc-900 border-white/10 text-zinc-400';
    if (state === 'CONNECTING') return 'bg-amber-500/15 border-amber-400/40 text-amber-300';
    if (state === 'ERROR') return 'bg-rose-500/15 border-rose-400/40 text-rose-300';
    return 'bg-zinc-900 border-white/8 text-zinc-500';
  };

  const getAdapter = (id: AdapterId) => adapters.find((a) => a.id === id);
  const onlineCount = sources.filter((s) => s.status === 'ONLINE').length;

  return (
    <ObsidianPanel className="fixed right-2.5 top-13 bottom-14 w-[448px] max-w-[95vw] z-40 pointer-events-auto rounded-xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/8">
        <div className="flex items-center gap-2 min-w-0">
          <Radar className="w-4 h-4 text-teal-400 shrink-0" />
          <div className="min-w-0">
            <div className="cockpit-heading font-sans text-xs font-semibold text-zinc-100">
              MULTI-ADAPTER FIREHOSE
            </div>
            <div className="font-mono text-[10px] text-zinc-400 tabular-nums truncate">
              SSE <span className="text-teal-300">/api/stream/live</span> · {liveVerifiedCount} Live
              Signals · {onlineCount}/{sources.length} Feeds
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <InstrumentButton size="xs" onClick={() => void handleForceSweep()} disabled={loading}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Sweep</span>
          </InstrumentButton>
          <InstrumentButton
            size="icon"
            variant="ghost"
            onClick={onClose}
            title="Close Drawer (Esc)"
            className="h-6 w-6"
          >
            <X className="w-3.5 h-3.5" />
          </InstrumentButton>
        </div>
      </div>

      {/* Accessible shadcn-ui Tabs */}
      <div className="px-3.5 py-2 border-b border-white/8 flex items-center justify-between gap-2">
        <CockpitTabsList className="grid-cols-2 flex-1">
          <CockpitTabsTrigger
            selected={activeTab === 'SWITCHBOARD'}
            onClick={() => setActiveTab('SWITCHBOARD')}
          >
            $0 Switchboard (3)
          </CockpitTabsTrigger>
          <CockpitTabsTrigger
            selected={activeTab === 'FEEDS'}
            onClick={() => setActiveTab('FEEDS')}
          >
            Upstream Streams ({sources.length})
          </CockpitTabsTrigger>
        </CockpitTabsList>
        <Kbd>ESC</Kbd>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs">
        {statusMsg && (
          <div className="cockpit-well px-3 py-2 rounded-lg border-teal-400/30 font-mono text-[10.5px] text-teal-200 leading-snug">
            {statusMsg}
          </div>
        )}

        {/* 72h Demo Seed Quarantine Switch */}
        <div className="cockpit-well p-2.5 rounded-lg flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium text-zinc-100">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              <span>100% PURE LIVE FILTER</span>
            </div>
            <div className="font-mono text-[10px] text-zinc-400 tabular-nums mt-0.5">
              {showDemoSeed
                ? `${demoSeedCount} historical seed + ${liveVerifiedCount} verified live`
                : `Active: ${liveVerifiedCount} verified live signals only`}
            </div>
          </div>
          <CockpitSwitch
            checked={!showDemoSeed}
            onCheckedChange={(pureLive) => onToggleDemoSeed(!pureLive)}
            label="Toggle Pure Live Signal Filter"
          />
        </div>

        {activeTab === 'SWITCHBOARD' && (
          <div className="space-y-3">
            {/* Tabular Zero-Billing Adapter Telemetry Table */}
            <div className="cockpit-well rounded-lg overflow-hidden">
              <div className="px-2.5 py-1.5 border-b border-white/6 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-wider text-zinc-400">
                <span className="inline-flex items-center gap-1">
                  <Activity className="w-3 h-3 text-teal-400" /> Adapter Telemetry
                </span>
                <span className="text-zinc-500">$0 Zero-Billing · .env.local</span>
              </div>
              <div className="divide-y divide-white/6 font-mono text-[10.5px] tabular-nums">
                {(['reddit_street', 'discord_relay', 'x_playwright'] as const).map((id) => {
                  const a = getAdapter(id);
                  const label =
                    id === 'reddit_street'
                      ? 'Deep Reddit (12 Subs)'
                      : id === 'discord_relay'
                      ? 'Discord #announcements'
                      : 'Local Playwright X';
                  return (
                    <div
                      key={id}
                      className="px-2.5 py-1.5 grid grid-cols-[1fr_auto_auto] items-center gap-3"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                            a?.state === 'ACTIVE' ? 'bg-emerald-400' : 'bg-zinc-600'
                          }`}
                        />
                        <span className="text-zinc-200 truncate">{label}</span>
                      </div>
                      <span className="text-zinc-400 text-right">
                        {a?.avgLatencyMs ? `${a.avgLatencyMs}ms` : '—'} · {a?.mediaCount ?? 0} media
                      </span>
                      <span className="text-teal-300 font-semibold text-right min-w-[52px]">
                        {a?.signalsFetched ?? 0} sig
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 1. DEEP REDDIT STREET VERDICT ENGINE ($0 ZERO-KEY) */}
            {(() => {
              const rd = getAdapter('reddit_street');
              return (
                <div className="cockpit-well p-3 rounded-lg space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="cockpit-heading font-sans text-xs font-semibold text-zinc-100">
                          Deep Reddit Street Verdict
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-zinc-900 border border-white/10 font-mono text-[9px] text-teal-300">
                          $0 ZERO-KEY
                        </span>
                        {rd && (
                          <span
                            className={`px-1.5 py-0.2 rounded border font-mono text-[9px] ${stateBadgeStyle(
                              rd.state
                            )}`}
                          >
                            {rd.state}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                        12 subreddits (`LocalLLaMA`, `singularity`, `ClaudeAI`, `cursor`, `AI_Agents`,
                        `ollama`...) + top-5 engineer comments.
                      </p>
                    </div>
                    <CockpitSwitch
                      checked={rd?.enabled ?? true}
                      onCheckedChange={(next) => void handleToggleAdapter('reddit_street', next)}
                      label="Toggle Deep Reddit Adapter"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 tabular-nums pt-1.5 border-t border-white/6">
                    <span>
                      {rd?.signalsFetched ?? 0} signals · {rd?.avgLatencyMs ?? 0}ms avg ·{' '}
                      {rd?.mediaCount ?? 0} media
                    </span>
                    <InstrumentButton
                      size="xs"
                      onClick={() => void handleBenchmarkAdapter('reddit_street')}
                      disabled={loading}
                    >
                      <Zap className="w-3 h-3 text-teal-400" />
                      <span>Poll Now</span>
                    </InstrumentButton>
                  </div>
                  {rd?.lastError && (
                    <div className="text-[10px] font-mono text-amber-300">{rd.lastError}</div>
                  )}
                </div>
              );
            })()}

            {/* 2. DISCORD LIVE ANNOUNCEMENT RELAY */}
            {(() => {
              const dc = getAdapter('discord_relay');
              return (
                <div className="cockpit-well p-3 rounded-lg space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="cockpit-heading font-sans text-xs font-semibold text-zinc-100">
                          Discord Announcements Relay
                        </span>
                        {dc && (
                          <span
                            className={`px-1.5 py-0.2 rounded border font-mono text-[9px] ${stateBadgeStyle(
                              dc.state
                            )}`}
                          >
                            {dc.state}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                        `discord.js` Gateway WebSocket + millisecond SSE `/api/stream/live` relay.
                      </p>
                    </div>
                    <CockpitSwitch
                      checked={dc?.enabled ?? false}
                      onCheckedChange={(next) => void handleToggleAdapter('discord_relay', next)}
                      label="Toggle Discord Relay Adapter"
                    />
                  </div>

                  <InstrumentButton
                    variant="accent"
                    onClick={() => void handleFireDiscordTestRelay()}
                    disabled={loading}
                    className="w-full justify-center"
                  >
                    <Send className="w-3 h-3" />
                    <span>Trigger Instant Test Discord Announcement Relay</span>
                  </InstrumentButton>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="space-y-1">
                      <label className="block font-mono text-[9.5px] uppercase tracking-wider text-zinc-500">
                        Bot Token
                      </label>
                      <input
                        type="password"
                        value={discordBotToken}
                        onChange={(e) => setDiscordBotToken(e.target.value)}
                        placeholder="DISCORD_BOT_TOKEN"
                        className="w-full h-7 px-2 rounded-md bg-zinc-950 border border-white/10 font-mono text-[10.5px] text-zinc-100 focus:outline-none focus:border-teal-400/70"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block font-mono text-[9.5px] uppercase tracking-wider text-zinc-500">
                        Guild ID (Opt)
                      </label>
                      <input
                        value={discordGuildId}
                        onChange={(e) => setDiscordGuildId(e.target.value)}
                        placeholder="All joined guilds"
                        className="w-full h-7 px-2 rounded-md bg-zinc-950 border border-white/10 font-mono text-[10.5px] text-zinc-100 focus:outline-none focus:border-teal-400/70"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                    <span className="truncate">{dc?.credentialSummary}</span>
                    <InstrumentButton
                      size="xs"
                      onClick={() =>
                        void handleSaveAdapterCredentials('discord_relay', {
                          discordBotToken: discordBotToken || undefined,
                          discordGuildId,
                        })
                      }
                    >
                      Save Bot
                    </InstrumentButton>
                  </div>
                  {dc?.lastError && (
                    <div className="text-[10px] font-mono text-rose-300">{dc.lastError}</div>
                  )}
                </div>
              );
            })()}

            {/* 3. LOCAL PLAYWRIGHT SESSION SCRAPER ($0) */}
            {(() => {
              const xA = getAdapter('x_playwright');
              return (
                <div className="cockpit-well p-3 rounded-lg space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="cockpit-heading font-sans text-xs font-semibold text-zinc-100">
                          Local Playwright X Scraper
                        </span>
                        <span className="px-1.5 py-0.2 rounded bg-zinc-900 border border-white/10 font-mono text-[9px] text-zinc-300">
                          $0 LOCAL
                        </span>
                        {xA && (
                          <span
                            className={`px-1.5 py-0.2 rounded border font-mono text-[9px] ${stateBadgeStyle(
                              xA.state
                            )}`}
                          >
                            {xA.state}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-0.5 leading-snug">
                        Scrapes X AI Lists + `min_faves:100` search on safe jittered intervals.
                      </p>
                    </div>
                    <CockpitSwitch
                      checked={xA?.enabled ?? false}
                      onCheckedChange={(next) => void handleToggleAdapter('x_playwright', next)}
                      label="Toggle Playwright X Scraper"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="space-y-1">
                      <label className="block font-mono text-[9.5px] uppercase tracking-wider text-zinc-500">
                        auth_token
                      </label>
                      <input
                        type="password"
                        value={xAuthToken}
                        onChange={(e) => setXAuthToken(e.target.value)}
                        placeholder="Session cookie"
                        className="w-full h-7 px-2 rounded-md bg-zinc-950 border border-white/10 font-mono text-[10.5px] text-zinc-100 focus:outline-none focus:border-teal-400/70"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block font-mono text-[9.5px] uppercase tracking-wider text-zinc-500">
                        ct0
                      </label>
                      <input
                        type="password"
                        value={xCt0}
                        onChange={(e) => setXCt0(e.target.value)}
                        placeholder="CSRF cookie"
                        className="w-full h-7 px-2 rounded-md bg-zinc-950 border border-white/10 font-mono text-[10.5px] text-zinc-100 focus:outline-none focus:border-teal-400/70"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block font-mono text-[9.5px] uppercase tracking-wider text-zinc-500">
                      Operator Query & Optional List IDs
                    </label>
                    <input
                      value={xPwQuery}
                      onChange={(e) => setXPwQuery(e.target.value)}
                      placeholder="X high-signal search query..."
                      className="w-full h-7 px-2 rounded-md bg-zinc-950 border border-white/10 font-mono text-[10px] text-zinc-300 focus:outline-none focus:border-teal-400/70"
                    />
                    <input
                      value={xListIds}
                      onChange={(e) => setXListIds(e.target.value)}
                      placeholder="Optional X List IDs (comma-separated)"
                      className="w-full h-7 px-2 mt-1 rounded-md bg-zinc-950 border border-white/10 font-mono text-[10px] text-zinc-300 focus:outline-none focus:border-teal-400/70"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-white/6">
                    <InstrumentButton
                      size="xs"
                      onClick={() => void handleOpenPlaywrightLogin()}
                      disabled={loading}
                    >
                      <LogIn className="w-3 h-3 text-teal-400" />
                      <span>1-Click Login</span>
                    </InstrumentButton>
                    <div className="flex items-center gap-1">
                      <InstrumentButton
                        size="xs"
                        onClick={() => void handleBenchmarkAdapter('x_playwright')}
                        disabled={loading}
                      >
                        Scrape Now
                      </InstrumentButton>
                      <InstrumentButton
                        size="xs"
                        variant="accent"
                        onClick={() =>
                          void handleSaveAdapterCredentials('x_playwright', {
                            xAuthToken: xAuthToken || undefined,
                            xCt0: xCt0 || undefined,
                            xPlaywrightQuery: xPwQuery,
                            xListIds,
                          })
                        }
                      >
                        <KeyRound className="w-3 h-3" />
                        <span>Save</span>
                      </InstrumentButton>
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-zinc-500 tabular-nums">
                    {xA?.credentialSummary} · Media scraped: {xA?.mediaCount ?? 0}
                  </div>
                  {xA?.lastError && (
                    <div className="text-[10px] font-mono text-rose-300">{xA.lastError}</div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === 'FEEDS' && (
          <div className="space-y-3">
            {/* Source Category Filter Switches */}
            <div className="cockpit-well p-2.5 rounded-lg space-y-2">
              <div className="font-mono text-[9.5px] uppercase tracking-wider text-zinc-400">
                Active Stream Category Filters
              </div>
              <div className="flex flex-wrap gap-1">
                {CATEGORY_LABELS.map((cat) => {
                  const on = enabledCategories[cat.id];
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => onToggleCategory(cat.id)}
                      className={`px-2 py-1 rounded-[5px] font-mono text-[10px] border transition-colors cursor-pointer ${
                        on
                          ? 'bg-zinc-800 border-teal-400/35 text-zinc-100'
                          : 'bg-zinc-950 border-white/6 text-zinc-500 line-through'
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Add Custom RSS / Bluesky / Subreddit */}
            <form
              onSubmit={(e) => void handleAddCustom(e)}
              className="cockpit-well p-2.5 rounded-lg space-y-2"
            >
              <div className="font-mono text-[9.5px] uppercase tracking-wider text-zinc-400">
                Add Custom RSS, Bluesky Handle, or Subreddit
              </div>
              <div className="flex gap-1.5">
                <select
                  value={customKind}
                  onChange={(e) => setCustomKind(e.target.value as 'RSS' | 'BLUESKY' | 'REDDIT')}
                  className="h-7 px-2 rounded-md bg-zinc-950 border border-white/10 font-mono text-[10.5px] text-zinc-200"
                >
                  <option value="RSS">RSS / Atom</option>
                  <option value="BLUESKY">Bluesky</option>
                  <option value="REDDIT">Reddit</option>
                </select>
                <input
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  placeholder={
                    customKind === 'BLUESKY'
                      ? 'karpathy.bsky.social'
                      : customKind === 'REDDIT'
                      ? 'r/LocalLLaMA'
                      : 'https://example.com/feed.xml'
                  }
                  className="flex-1 h-7 px-2 rounded-md bg-zinc-950 border border-white/10 font-mono text-[11px] text-zinc-100 focus:outline-none focus:border-teal-400/70"
                />
              </div>
              <div className="flex gap-1.5">
                <input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Display label (optional)"
                  className="flex-1 h-7 px-2 rounded-md bg-zinc-950 border border-white/10 font-mono text-[11px] text-zinc-100 focus:outline-none focus:border-teal-400/70"
                />
                <InstrumentButton type="submit" variant="accent" disabled={loading}>
                  <Plus className="w-3 h-3" />
                  <span>Add</span>
                </InstrumentButton>
              </div>
            </form>

            {/* Optional Fast-Fail X-RSS / RSS-Bridge Slot */}
            <div className="cockpit-well p-2.5 rounded-lg space-y-1.5">
              <div className="font-mono text-[9.5px] uppercase tracking-wider text-zinc-400">
                Optional X-RSS Bridge Endpoint (2.5s Fast-Fail)
              </div>
              <div className="flex gap-1.5">
                <input
                  value={xBridgeUrl}
                  onChange={(e) => setXBridgeUrl(e.target.value)}
                  placeholder="https://nitter.jaydenha.uk"
                  className="flex-1 h-7 px-2 rounded-md bg-zinc-950 border border-white/10 font-mono text-[10.5px] text-zinc-100"
                />
                <input
                  value={xBridgeHandle}
                  onChange={(e) => setXBridgeHandle(e.target.value)}
                  placeholder="karpathy"
                  className="w-24 h-7 px-2 rounded-md bg-zinc-950 border border-white/10 font-mono text-[10.5px] text-zinc-100"
                />
                <InstrumentButton size="sm" onClick={() => void handleSaveXBridge()}>
                  Save
                </InstrumentButton>
              </div>
            </div>

            {/* Tabular Upstream Feed Health Rows */}
            <div className="cockpit-well rounded-lg overflow-hidden">
              <div className="px-2.5 py-1.5 border-b border-white/6 grid grid-cols-[1fr_64px_56px] gap-2 font-mono text-[9.5px] uppercase tracking-wider text-zinc-500">
                <span>Upstream Stream (2500ms Cap)</span>
                <span className="text-right">Latency</span>
                <span className="text-right">Count</span>
              </div>
              <div className="divide-y divide-white/6">
                {sources.map((src) => (
                  <div
                    key={src.id}
                    className="px-2.5 py-1.5 grid grid-cols-[1fr_64px_56px] items-center gap-2 hover:bg-white/[0.02]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {src.status === 'ONLINE' ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-3 h-3 text-amber-400/80 shrink-0" />
                        )}
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11.5px] font-medium text-zinc-200 hover:text-teal-300 truncate"
                        >
                          {src.name}
                        </a>
                      </div>
                      {src.errorHint && (
                        <div className="text-[9.5px] font-mono text-zinc-500 pl-4.5 truncate">
                          {src.errorHint}
                        </div>
                      )}
                    </div>
                    <span
                      className={`font-mono text-[10.5px] tabular-nums text-right ${
                        src.status === 'ONLINE' ? 'text-zinc-300' : 'text-amber-300/90'
                      }`}
                    >
                      {src.latencyMs}ms
                    </span>
                    <span className="font-mono text-[10.5px] tabular-nums text-right text-teal-300">
                      {src.itemCount} sig
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </ObsidianPanel>
  );
};
