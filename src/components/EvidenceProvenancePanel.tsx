import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Layers,
  Shield,
} from 'lucide-react';
import {
  extractVerbatimSourceExcerpt,
  formatUtcTimestamp,
  getEventLastUpdatedMs,
  getGroupedSourcesForSignal,
  getIndependentSourceCount,
  isPrimarySourceSignal,
} from '../../shared/provenance';
import { SpatialSignal } from '../../shared/types';
import { formatRelativeAgeShort } from '../utils/signalRanking';

interface EvidenceProvenancePanelProps {
  signal: SpatialSignal;
  snapshotBakedAtMs?: number | null;
  defaultExpanded?: boolean;
}

export const EvidenceProvenancePanel: React.FC<EvidenceProvenancePanelProps> = ({
  signal,
  snapshotBakedAtMs,
  defaultExpanded = false,
}) => {
  const [sourcesExpanded, setSourcesExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setSourcesExpanded(defaultExpanded);
  }, [signal.id, defaultExpanded]);

  const nowMs = Date.now();
  const isPrimary = isPrimarySourceSignal(signal);
  const groupedSources = getGroupedSourcesForSignal(signal);
  const independentCount = getIndependentSourceCount(signal);
  const isCorroborated = independentCount >= 2;
  const lastUpdatedMs = getEventLastUpdatedMs(signal);
  const verbatimExcerpt = extractVerbatimSourceExcerpt(signal);

  const publishedAgo = formatRelativeAgeShort(signal.publishedAtMs, nowMs);
  const publishedUtc = formatUtcTimestamp(signal.publishedAtMs);
  const snapshotAgo =
    snapshotBakedAtMs && Number.isFinite(snapshotBakedAtMs)
      ? formatRelativeAgeShort(snapshotBakedAtMs, nowMs)
      : null;
  const snapshotUtc =
    snapshotBakedAtMs && Number.isFinite(snapshotBakedAtMs)
      ? formatUtcTimestamp(snapshotBakedAtMs)
      : null;

  return (
    <section
      aria-label="Evidence and Provenance"
      className="cockpit-well rounded-lg border border-white/10 p-2.5 space-y-2"
    >
      {/* Top Status Bar: Source Classification + Honest Verification Note */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 font-mono text-[9.5px] tabular-nums">
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-semibold tracking-wide ${
            isPrimary
              ? 'bg-emerald-500/12 border-emerald-400/35 text-emerald-200'
              : 'bg-zinc-900 border-white/12 text-zinc-300'
          }`}
        >
          <Shield className="w-2.5 h-2.5 shrink-0" />
          <span>{isPrimary ? 'PRIMARY SOURCE' : 'COMMUNITY / COMMENTARY'}</span>
        </span>

        <span
          className={`inline-flex items-center gap-1 text-[9.5px] ${
            isCorroborated ? 'text-teal-300' : 'text-zinc-400'
          }`}
        >
          {isCorroborated ? (
            <>
              <CheckCircle2 className="w-3 h-3 text-teal-400 shrink-0" />
              <span>Corroborated across {independentCount} sources</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-3 h-3 text-amber-400/80 shrink-0" />
              <span>Claim not independently verified — linked to third-party source</span>
            </>
          )}
        </span>
      </div>

      {/* Dual Timestamps: Original Published Time & Snapshot Refresh Time */}
      <div className="flex flex-col gap-1 text-[9.5px] font-mono tabular-nums text-zinc-400">
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-950/70 border border-white/6 min-w-0">
          <Clock className="w-2.5 h-2.5 text-teal-400 shrink-0" />
          <span title={`Original publish timestamp: ${publishedUtc}`}>
            Published <span className="text-zinc-200">{publishedAgo} ago</span> · {publishedUtc}
          </span>
        </div>
        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-950/70 border border-white/6 min-w-0">
          <Clock className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
          <span
            title={snapshotUtc ? `Static snapshot baked at ${snapshotUtc}` : 'Live local feed'}
          >
            {snapshotAgo ? (
              <>
                Snapshot <span className="text-zinc-200">{snapshotAgo} ago</span> · {snapshotUtc}
              </>
            ) : (
              'Live upstream snapshot stream'
            )}
          </span>
        </div>
      </div>

      {/* Grouped Multi-Source Event Strip & Expandable Supporting Coverage */}
      {groupedSources.length >= 2 && (
        <div className="rounded-md bg-teal-500/[0.06] border border-teal-400/25 overflow-hidden">
          <button
            type="button"
            onClick={() => setSourcesExpanded((v) => !v)}
            aria-expanded={sourcesExpanded}
            className="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 text-left font-mono text-[10px] tabular-nums text-teal-200 hover:bg-teal-500/[0.09] transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
              <Layers className="w-3 h-3 text-teal-400 shrink-0" />
              <span className="truncate font-medium">
                One development · {groupedSources.length} sources · Updated{' '}
                {formatRelativeAgeShort(lastUpdatedMs, nowMs)} ago
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-[9.5px] text-teal-300 shrink-0">
              <span>{sourcesExpanded ? 'Hide' : 'Inspect'}</span>
              {sourcesExpanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </span>
          </button>

          {sourcesExpanded && (
            <div className="divide-y divide-white/6 border-t border-teal-400/20 bg-zinc-950/75">
              {groupedSources.map((srcItem) => {
                const age = srcItem.publishedAtMs
                  ? `${formatRelativeAgeShort(srcItem.publishedAtMs, nowMs)} ago`
                  : srcItem.publishedAt
                  ? `${formatRelativeAgeShort(Date.parse(srcItem.publishedAt) || nowMs, nowMs)} ago`
                  : '';
                return (
                  <a
                    key={srcItem.url}
                    href={srcItem.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block px-2.5 py-1.5 hover:bg-white/[0.03] transition-colors space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2 font-mono text-[9.5px] tabular-nums">
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <span
                          className={`px-1 py-0.2 rounded border text-[8.5px] shrink-0 ${
                            srcItem.isPrimary
                              ? 'bg-emerald-500/12 border-emerald-400/35 text-emerald-200'
                              : 'bg-zinc-900 border-white/10 text-zinc-400'
                          }`}
                        >
                          {srcItem.isPrimary ? 'Primary' : 'Commentary'}
                        </span>
                        <span className="text-zinc-200 font-medium truncate">
                          {srcItem.source}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-zinc-500 shrink-0">
                        {age && <span>{age}</span>}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-300 leading-snug line-clamp-2">
                      {srcItem.title}
                    </p>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Fact vs Synthesis Separation: Verbatim Source Headline & Upstream Excerpt */}
      <div className="rounded-md bg-zinc-950/90 border border-white/8 p-2 space-y-1">
        <div className="flex items-center justify-between gap-2 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
          <span>Source Headline / Excerpt</span>
          <span className="text-zinc-400">Verbatim Upstream</span>
        </div>
        <a
          href={signal.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-start gap-1 text-[11.5px] font-medium text-zinc-200 hover:text-teal-200 leading-snug transition-colors"
        >
          <span>{signal.title}</span>
          <ExternalLink className="w-2.5 h-2.5 mt-0.5 shrink-0 text-zinc-500" />
        </a>
        {verbatimExcerpt && (
          <p className="text-[11px] text-zinc-400 leading-[1.45] border-l border-white/15 pl-2">
            “{verbatimExcerpt}”
          </p>
        )}
      </div>
    </section>
  );
};
