import React, { useEffect, useRef } from 'react';
import { Activity, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import {
  analyzeClusterCoverage,
  formatUtcTimestamp,
  isUpstreamUpdatedSignal,
} from '../../shared/provenance';
import {
  LiteracyLevel,
  SECTOR_BY_ID,
  SpatialSignal,
} from '../../shared/types';
import {
  formatRelativeAgeShort,
  getCleanDisplayHeadline,
  isRecentSignal12h,
} from '../utils/signalRanking';
import { ObsidianPanel } from './ui/cockpit-primitives';

export interface SignalRailEntry {
  nodeIndex: number;
  signal: SpatialSignal;
  momentumScore: number;
  isNew: boolean;
}

interface SignalRailProps {
  isOpen: boolean;
  onToggleOpen: () => void;
  topSignals: SignalRailEntry[];
  selectedNodeIdx: number;
  hoveredNodeIdx: number;
  activeLiteracyLevel: LiteracyLevel;
  onHoverSignal: (nodeIndex: number) => void;
  onSelectSignal: (nodeIndex: number) => void;
}

export const SignalRail: React.FC<SignalRailProps> = ({
  isOpen,
  onToggleOpen,
  topSignals,
  selectedNodeIdx,
  hoveredNodeIdx,
  activeLiteracyLevel,
  onHoverSignal,
  onSelectSignal,
}) => {
  const itemRefs = useRef<Map<number, HTMLButtonElement | null>>(new Map());

  useEffect(() => {
    if (!isOpen || selectedNodeIdx < 0) return;
    const el = itemRefs.current.get(selectedNodeIdx);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedNodeIdx, isOpen]);

  if (!isOpen) {
    return (
      <div className="hidden md:flex fixed top-[64px] right-2.5 z-[25] pointer-events-auto">
        <button
          type="button"
          onClick={onToggleOpen}
          title="Open Top 10 Signals Today Rail"
          className="cockpit-obsidian px-2.5 py-3 rounded-xl border border-white/12 hover:border-teal-400/45 flex flex-col items-center gap-2 text-zinc-300 hover:text-teal-200 transition-colors cursor-pointer shadow-xl"
        >
          <PanelRightOpen className="w-4 h-4 text-teal-400" />
          <span
            style={{ writingMode: 'vertical-rl' }}
            className="font-mono text-[10px] font-semibold tracking-wider uppercase tabular-nums"
          >
            Top {topSignals.length} Signals
          </span>
        </button>
      </div>
    );
  }

  const nowMs = Date.now();

  return (
    <aside
      aria-label="Top 10 Signals Today"
      className="hidden md:flex flex-col fixed top-[58px] bottom-[98px] right-2.5 z-[25] w-[312px] pointer-events-auto"
    >
      <ObsidianPanel className="flex flex-col h-full w-full overflow-hidden border border-white/12 shadow-2xl">
        {/* Header */}
        <div
          title="Top signals from the last 48h (72h fallback if fewer than 10). Headlines and summaries reflect linked third-party sources."
          className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-white/8 shrink-0"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="h-2 w-2 rounded-full bg-teal-400 shrink-0" />
            <span className="font-mono text-[10.5px] font-semibold uppercase tracking-wider text-zinc-100 truncate">
              TOP {Math.min(10, topSignals.length)} SIGNALS TODAY
            </span>
          </div>
          <button
            type="button"
            onClick={onToggleOpen}
            title="Collapse Signal Rail"
            className="p-1 rounded-md hover:bg-zinc-800/80 text-zinc-400 hover:text-zinc-100 cursor-pointer shrink-0"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scrollable Ranked Feed */}
        <div className="flex-1 overflow-y-auto divide-y divide-white/6">
          {topSignals.length === 0 ? (
            <div className="p-4 text-center font-mono text-[11px] text-zinc-500">
              No active signals match current filter.
            </div>
          ) : (
            topSignals.map((item, rankIdx) => {
              const { nodeIndex, signal, isNew } = item;
              const isUpdated = isUpstreamUpdatedSignal(signal);
              const publishedUtc = formatUtcTimestamp(signal.publishedAtMs);
              const updatedUtc = signal.updatedAtMs
                ? formatUtcTimestamp(signal.updatedAtMs)
                : publishedUtc;
              const sec = SECTOR_BY_ID[signal.primarySector];
              const isSelected = nodeIndex === selectedNodeIdx;
              const isHovered = nodeIndex === hoveredNodeIdx;
              const recent12h = isRecentSignal12h(signal, nowMs);
              const ageStr = formatRelativeAgeShort(signal.publishedAtMs, nowMs);
              const headline = getCleanDisplayHeadline(signal, activeLiteracyLevel);
              const origin =
                signal.originFeedName || (signal.isDemoSeed ? '72h Seed' : signal.source);
              const ups = signal.engagementVelocity?.likesOrUps ?? 0;
              const coverage = analyzeClusterCoverage(signal);
              const showGroupPill = coverage.relatedLinkCount >= 2;

              return (
                <button
                  key={signal.id}
                  ref={(el) => {
                    if (el) itemRefs.current.set(nodeIndex, el);
                    else itemRefs.current.delete(nodeIndex);
                  }}
                  type="button"
                  onMouseEnter={() => onHoverSignal(nodeIndex)}
                  onMouseLeave={() => onHoverSignal(-1)}
                  onClick={() => onSelectSignal(nodeIndex)}
                  className={`w-full text-left px-3 py-2.5 transition-colors cursor-pointer space-y-1.5 border-l-2 ${
                    isSelected
                      ? 'bg-teal-500/[0.11] border-l-teal-400'
                      : isHovered
                      ? 'bg-white/[0.04] border-l-teal-300/70'
                      : 'hover:bg-white/[0.03] border-l-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5 font-mono text-[9.5px] tabular-nums">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`font-semibold ${
                          isSelected ? 'text-teal-300' : 'text-zinc-500'
                        }`}
                      >
                        #{rankIdx + 1}
                      </span>
                      <span
                        style={{ backgroundColor: sec.colorHex }}
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                      />
                      <span className="text-zinc-300 font-medium">{sec.code}</span>
                      {showGroupPill && (
                        <span
                          title={coverage.provenanceHeadlineLabel}
                          className="px-1 py-0.2 rounded bg-amber-500/15 border border-amber-400/35 text-amber-200 text-[8.5px]"
                        >
                          {coverage.compactRailLabel}
                        </span>
                      )}
                      {isNew && (
                        <span className="px-1 py-0.2 rounded bg-teal-500/20 border border-teal-400/45 text-teal-200 text-[8.5px]">
                          NEW
                        </span>
                      )}
                      {!isNew && isUpdated && (
                        <span
                          title={`Published ${publishedUtc} · Updated ${updatedUtc}`}
                          className="px-1 py-0.2 rounded bg-amber-500/15 border border-amber-400/35 text-amber-200 text-[8.5px]"
                        >
                          Updated
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 text-zinc-400">
                      {recent12h && (
                        <span
                          title="Published within the last 12 hours"
                          className="inline-block h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse"
                        />
                      )}
                      <span
                        title={
                          isUpdated
                            ? `Published ${publishedUtc} · Updated ${updatedUtc}`
                            : `Published ${publishedUtc}`
                        }
                      >
                        {ageStr}
                      </span>
                    </div>
                  </div>

                  <p className="cockpit-heading text-[12px] font-medium leading-[1.35] text-zinc-100 line-clamp-2">
                    {headline}
                  </p>

                  <div className="flex items-center justify-between gap-2 font-mono text-[9.5px] text-zinc-400 tabular-nums">
                    <span
                      title="Headlines reflect linked third-party sources."
                      className="truncate"
                    >
                      {origin} ·{' '}
                      {coverage.relatedLinkCount >= 2
                        ? coverage.headerBadgeLabel
                        : 'Source-Linked'}
                    </span>
                    {ups > 0 ? (
                      <span className="inline-flex items-center gap-1 text-teal-300 shrink-0">
                        <Activity className="w-2.5 h-2.5" />
                        <span>{ups >= 1000 ? `${(ups / 1000).toFixed(1)}k` : ups}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-zinc-500 shrink-0">
                        <Sparkles className="w-2.5 h-2.5" />
                        <span>M{signal.mass.toFixed(1)}</span>
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ObsidianPanel>
    </aside>
  );
};
