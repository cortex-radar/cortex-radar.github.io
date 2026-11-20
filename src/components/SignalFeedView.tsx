import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Layers,
  Link2,
  Orbit,
  Search,
  Shield,
  X,
} from 'lucide-react';
import {
  buildDeterministicLiteracyPayload,
  sanitizeLiteracyPayloadPlainLevels,
} from '../../shared/literacyEngine';
import {
  getEventLastUpdatedMs,
  getGroupedSourcesForSignal,
  isPrimarySourceSignal,
} from '../../shared/provenance';
import {
  LITERACY_LEVELS,
  LiteracyLevel,
  SECTOR_BY_ID,
  SECTORS,
  SectorId,
  SpatialSignal,
} from '../../shared/types';
import { buildCortexDeepLinkUrl } from '../utils/deepLink';
import { renderShareCardPngBlob } from '../utils/shareCardCanvas';
import {
  formatRelativeAgeShort,
  getActiveLensTakeaway,
  getCleanDisplayHeadline,
  isRecentSignal12h,
  LENS_SHORT_LABELS,
} from '../utils/signalRanking';
import { InstrumentButton, ObsidianPanel } from './ui/cockpit-primitives';

export interface SignalFeedEntry {
  nodeIndex: number;
  signal: SpatialSignal;
  isNew: boolean;
  momentumScore: number;
}

interface SignalFeedViewProps {
  signals: SignalFeedEntry[];
  totalUnfilteredCount: number;
  selectedNodeIdx: number;
  activeLiteracyLevel: LiteracyLevel;
  onSelectLiteracyLevel: (lvl: LiteracyLevel) => void;
  onSelectSignal: (nodeIndex: number) => void;
  onInspectOnRadar: (nodeIndex: number) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onlyNewFilterActive: boolean;
  newSignalsCount: number;
  onToggleOnlyNewFilter: () => void;
  mutedSectors: ReadonlySet<SectorId>;
  onToggleMuteSector: (sec: SectorId) => void;
  onResetMutedSectors: () => void;
  isMobileViewport: boolean;
  hasSelectedDetailOpen: boolean;
}

export const SignalFeedView: React.FC<SignalFeedViewProps> = ({
  signals,
  totalUnfilteredCount,
  selectedNodeIdx,
  activeLiteracyLevel,
  onSelectLiteracyLevel,
  onSelectSignal,
  onInspectOnRadar,
  searchQuery,
  onSearchQueryChange,
  onlyNewFilterActive,
  newSignalsCount,
  onToggleOnlyNewFilter,
  mutedSectors,
  onToggleMuteSector,
  onResetMutedSectors,
  isMobileViewport,
  hasSelectedDetailOpen,
}) => {
  const [sortBy, setSortBy] = useState<'RANK' | 'NEWEST'>('RANK');
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [groupedOnly, setGroupedOnly] = useState(false);
  const [expandedEventIds, setExpandedEventIds] = useState<Record<string, boolean>>({});
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pngSavedId, setPngSavedId] = useState<string | null>(null);
  const cardRefs = useRef<Map<number, HTMLElement | null>>(new Map());

  const nowMs = Date.now();

  const displayedSignals = useMemo(() => {
    const filtered = signals.filter(({ signal }) => {
      if (primaryOnly && !isPrimarySourceSignal(signal)) return false;
      if (groupedOnly && getGroupedSourcesForSignal(signal).length < 2) return false;
      return true;
    });

    const sorted = [...filtered];
    if (sortBy === 'NEWEST') {
      sorted.sort((a, b) => (b.signal.publishedAtMs || 0) - (a.signal.publishedAtMs || 0));
    } else {
      sorted.sort((a, b) => b.momentumScore - a.momentumScore);
    }
    return sorted;
  }, [signals, primaryOnly, groupedOnly, sortBy]);

  useEffect(() => {
    if (selectedNodeIdx < 0) return;
    const el = cardRefs.current.get(selectedNodeIdx);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedNodeIdx]);

  return (
    <div
      aria-label="Signal Feed View"
      className={`fixed inset-0 z-[19] overflow-y-auto overscroll-contain bg-[#09090B]/92 backdrop-blur-md pointer-events-auto pt-[116px] md:pt-[92px] 2xl:pt-[58px] pb-[90px] md:pb-8 px-3 md:px-5 transition-all ${
        !isMobileViewport && hasSelectedDetailOpen
          ? 'md:pr-[376px] lg:pr-[436px] xl:pr-[468px]'
          : ''
      }`}
    >
      <div className="max-w-[920px] mx-auto space-y-3">
        {/* Shared Filter, Search & Sort Header Bar */}
        <ObsidianPanel className="p-2.5 md:p-3 border border-white/12 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {/* Shared Search Box synced with Ctrl+K Command Palette */}
            <div className="flex-1 cockpit-well rounded-lg flex items-center gap-2 px-2.5 min-h-[38px]">
              <Search className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              <input
                type="search"
                aria-label="Filter feed and radar signals"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder="Search signals, sources, labs, stacks... (synced with Ctrl+K)"
                className="flex-1 bg-transparent text-[12.5px] font-sans text-zinc-100 placeholder:text-zinc-500 focus:outline-none min-w-0"
              />
              {searchQuery.trim() && (
                <button
                  type="button"
                  onClick={() => onSearchQueryChange('')}
                  aria-label="Clear search filter"
                  className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Sort Toggle & Provenance Quick Filters */}
            <div className="flex flex-wrap items-center gap-1.5 shrink-0 font-mono text-[10px] tabular-nums">
              <div
                role="tablist"
                aria-label="Feed Sort Order"
                className="cockpit-well inline-grid grid-cols-2 p-0.5 rounded-lg"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={sortBy === 'RANK'}
                  onClick={() => setSortBy('RANK')}
                  className={`px-2.5 py-1.5 rounded-[6px] cursor-pointer transition-colors ${
                    sortBy === 'RANK'
                      ? 'bg-zinc-800 text-teal-200 border border-teal-400/35 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                  }`}
                >
                  Top Rank
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sortBy === 'NEWEST'}
                  onClick={() => setSortBy('NEWEST')}
                  className={`px-2.5 py-1.5 rounded-[6px] cursor-pointer transition-colors ${
                    sortBy === 'NEWEST'
                      ? 'bg-zinc-800 text-teal-200 border border-teal-400/35 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                  }`}
                >
                  Newest
                </button>
              </div>

              <button
                type="button"
                onClick={() => setPrimaryOnly((v) => !v)}
                className={`px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                  primaryOnly
                    ? 'bg-emerald-500/16 border-emerald-400/45 text-emerald-200 font-semibold'
                    : 'cockpit-obsidian border-white/10 text-zinc-300 hover:text-white'
                }`}
              >
                Primary Only
              </button>

              <button
                type="button"
                onClick={() => setGroupedOnly((v) => !v)}
                className={`px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                  groupedOnly
                    ? 'bg-teal-500/18 border-teal-400/45 text-teal-200 font-semibold'
                    : 'cockpit-obsidian border-white/10 text-zinc-300 hover:text-white'
                }`}
              >
                Multi-Source
              </button>

              <span className="px-2 py-1 text-zinc-400">
                {displayedSignals.length}/{totalUnfilteredCount}
              </span>
            </div>
          </div>

          {/* Sector Filter Chips + +N New Toggle */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {newSignalsCount > 0 && (
              <button
                type="button"
                onClick={onToggleOnlyNewFilter}
                className={`shrink-0 min-h-[32px] inline-flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-[10px] tabular-nums border cursor-pointer transition-colors ${
                  onlyNewFilterActive
                    ? 'bg-teal-500/22 border-teal-400/60 text-teal-100 font-semibold'
                    : 'cockpit-obsidian border-teal-400/35 text-teal-200'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" />
                <span>+{newSignalsCount} New</span>
              </button>
            )}

            {SECTORS.map((sec) => {
              const isMuted = mutedSectors.has(sec.id);
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => onToggleMuteSector(sec.id)}
                  title={isMuted ? `Unmute ${sec.name}` : `Mute ${sec.name}`}
                  className={`shrink-0 min-h-[32px] inline-flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-[10px] border cursor-pointer transition-all ${
                    isMuted
                      ? 'bg-zinc-950/60 border-white/5 text-zinc-500 line-through opacity-60'
                      : 'cockpit-obsidian border-white/12 text-zinc-200 hover:border-white/25'
                  }`}
                >
                  <span
                    style={{ backgroundColor: isMuted ? '#52525B' : sec.colorHex }}
                    className="h-1.5 w-1.5 rounded-full shrink-0"
                  />
                  <span>{sec.code}</span>
                </button>
              );
            })}

            {mutedSectors.size > 0 && (
              <button
                type="button"
                onClick={onResetMutedSectors}
                className="shrink-0 min-h-[32px] px-2.5 rounded-lg font-mono text-[10px] border border-white/10 text-zinc-400 hover:text-zinc-100 cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </ObsidianPanel>

        {/* Scannable Feed List */}
        {displayedSignals.length === 0 ? (
          <ObsidianPanel className="p-6 text-center space-y-2 border border-white/10">
            <p className="text-xs text-zinc-300">
              No signals match your active search query or sector filters.
            </p>
            {(searchQuery.trim() || primaryOnly || groupedOnly || mutedSectors.size > 0 || onlyNewFilterActive) && (
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {searchQuery.trim() && (
                  <InstrumentButton size="xs" onClick={() => onSearchQueryChange('')}>
                    Clear Search
                  </InstrumentButton>
                )}
                {(primaryOnly || groupedOnly) && (
                  <InstrumentButton
                    size="xs"
                    onClick={() => {
                      setPrimaryOnly(false);
                      setGroupedOnly(false);
                    }}
                  >
                    Show All Sources
                  </InstrumentButton>
                )}
              </div>
            )}
          </ObsidianPanel>
        ) : (
          <div className="space-y-2.5">
            {displayedSignals.map(({ nodeIndex, signal, isNew }, idx) => {
              const sec = SECTOR_BY_ID[signal.primarySector];
              const isSelected = nodeIndex === selectedNodeIdx;
              const isPrimary = isPrimarySourceSignal(signal);
              const groupedSources = getGroupedSourcesForSignal(signal);
              const lastUpdatedMs = getEventLastUpdatedMs(signal);
              const isEventExpanded = Boolean(expandedEventIds[signal.id]);
              const heroMedia = (signal.mediaItems || []).find(
                (m) =>
                  m.type === 'image' &&
                  !m.url.startsWith('data:image/svg+xml') &&
                  !brokenImages[m.url]
              );
              const lit = sanitizeLiteracyPayloadPlainLevels(
                signal.literacy || buildDeterministicLiteracyPayload(signal, 'BANKING')
              );
              const takeaway = getActiveLensTakeaway(signal, lit, activeLiteracyLevel);
              const cleanTitle = getCleanDisplayHeadline(signal, activeLiteracyLevel);
              const origin =
                signal.originFeedName || (signal.isDemoSeed ? '72h Seed' : signal.source);
              const recent12h = isRecentSignal12h(signal, nowMs);
              const ups = signal.engagementVelocity?.likesOrUps ?? 0;

              return (
                <article
                  key={signal.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(nodeIndex, el);
                    else cardRefs.current.delete(nodeIndex);
                  }}
                >
                  <ObsidianPanel
                    onClick={() => onSelectSignal(nodeIndex)}
                    className={`p-3.5 space-y-2.5 border transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-teal-400/65 bg-teal-500/[0.06] shadow-[0_0_24px_rgba(45,212,191,0.12)]'
                        : 'border-white/12 hover:border-white/25'
                    }`}
                  >
                    {/* Header Strip */}
                    <div className="flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <span className="text-zinc-500 font-semibold">#{idx + 1}</span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-white/10 text-zinc-200">
                          <span
                            style={{ backgroundColor: sec.colorHex }}
                            className="h-1.5 w-1.5 rounded-full"
                          />
                          <span>{sec.code}</span>
                        </span>

                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9.5px] font-medium ${
                            isPrimary
                              ? 'bg-emerald-500/12 border-emerald-400/35 text-emerald-200'
                              : 'bg-zinc-900 border-white/10 text-zinc-400'
                          }`}
                        >
                          <Shield className="w-2.5 h-2.5" />
                          <span>{isPrimary ? 'Primary' : 'Commentary'}</span>
                        </span>

                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                            recent12h
                              ? 'bg-teal-500/14 border-teal-400/35 text-teal-200'
                              : 'bg-zinc-900/70 border-white/8 text-zinc-400'
                          }`}
                        >
                          {recent12h && (
                            <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" />
                          )}
                          <span>{formatRelativeAgeShort(signal.publishedAtMs, nowMs)} ago</span>
                        </span>

                        {isNew && (
                          <span className="px-1.5 py-0.5 rounded bg-teal-500/20 border border-teal-400/45 text-teal-200">
                            NEW
                          </span>
                        )}

                        <a
                          href={signal.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-zinc-400 hover:text-teal-200 truncate max-w-[160px]"
                        >
                          <span className="truncate">{origin}</span>
                          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        </a>
                      </div>

                      {ups > 0 && (
                        <span className="inline-flex items-center gap-1 text-teal-300 shrink-0">
                          <Activity className="w-3 h-3" />
                          <span>{ups >= 1000 ? `${(ups / 1000).toFixed(1)}k` : ups}</span>
                        </span>
                      )}
                    </div>

                    {/* Title + Optional Thumbnail */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <h3 className="cockpit-heading text-[15px] font-semibold leading-snug text-zinc-100">
                          {cleanTitle}
                        </h3>
                        <p className="text-[12.5px] text-zinc-300 leading-relaxed line-clamp-2">
                          <span className="font-mono text-[9.5px] uppercase tracking-wider text-teal-300 mr-1.5">
                            {takeaway.label}
                          </span>
                          {takeaway.text}
                        </p>
                      </div>
                      {heroMedia && (
                        <img
                          src={heroMedia.url}
                          alt={cleanTitle}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          onLoad={(e) => {
                            if (
                              e.currentTarget.naturalWidth < 16 ||
                              e.currentTarget.naturalHeight < 16
                            ) {
                              setBrokenImages((prev) => ({ ...prev, [heroMedia.url]: true }));
                            }
                          }}
                          onError={() =>
                            setBrokenImages((prev) => ({ ...prev, [heroMedia.url]: true }))
                          }
                          className="hidden sm:block w-24 h-16 rounded-md object-cover bg-zinc-950 border border-white/10 shrink-0"
                        />
                      )}
                    </div>

                    {/* Grouped Multi-Source Event Strip */}
                    {groupedSources.length >= 2 && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-md bg-teal-500/[0.06] border border-teal-400/25 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedEventIds((prev) => ({
                              ...prev,
                              [signal.id]: !prev[signal.id],
                            }))
                          }
                          aria-expanded={isEventExpanded}
                          className="w-full px-2.5 py-1.5 flex items-center justify-between gap-2 text-left font-mono text-[10px] tabular-nums text-teal-200 hover:bg-teal-500/[0.09] cursor-pointer"
                        >
                          <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                            <Layers className="w-3 h-3 text-teal-400 shrink-0" />
                            <span className="truncate font-medium">
                              One development · {groupedSources.length} sources · Updated{' '}
                              {formatRelativeAgeShort(lastUpdatedMs, nowMs)} ago
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-[9.5px] text-teal-300 shrink-0">
                            <span>{isEventExpanded ? 'Hide' : 'Sources'}</span>
                            {isEventExpanded ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </span>
                        </button>

                        {isEventExpanded && (
                          <div className="divide-y divide-white/6 border-t border-teal-400/20 bg-zinc-950/75">
                            {groupedSources.map((srcItem) => (
                              <a
                                key={srcItem.url}
                                href={srcItem.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center justify-between gap-2 px-2.5 py-1.5 hover:bg-white/[0.03] text-[11px] text-zinc-300"
                              >
                                <span className="inline-flex items-center gap-1.5 min-w-0">
                                  <span
                                    className={`px-1 py-0.2 rounded border font-mono text-[8.5px] shrink-0 ${
                                      srcItem.isPrimary
                                        ? 'bg-emerald-500/12 border-emerald-400/35 text-emerald-200'
                                        : 'bg-zinc-900 border-white/10 text-zinc-400'
                                    }`}
                                  >
                                    {srcItem.isPrimary ? 'Primary' : 'Commentary'}
                                  </span>
                                  <span className="font-mono text-[9.5px] text-zinc-400 shrink-0">
                                    {srcItem.source}
                                  </span>
                                  <span className="truncate">{srcItem.title}</span>
                                </span>
                                <ExternalLink className="w-2.5 h-2.5 shrink-0 text-zinc-500" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Inline Quick Literacy Lens & Actions */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex flex-wrap items-center justify-between gap-2 pt-0.5"
                    >
                      <div className="cockpit-well inline-grid grid-cols-5 p-0.5 rounded-md">
                        {LITERACY_LEVELS.map((lvl) => {
                          const active = activeLiteracyLevel === lvl.level;
                          return (
                            <button
                              key={lvl.level}
                              type="button"
                              onClick={() => onSelectLiteracyLevel(lvl.level)}
                              className={`px-2 py-1 rounded-[4px] font-mono text-[9.5px] tabular-nums cursor-pointer transition-colors ${
                                active
                                  ? 'bg-zinc-800 text-teal-200 border border-teal-400/35 font-semibold'
                                  : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                              }`}
                            >
                              <span className="hidden sm:inline">{LENS_SHORT_LABELS[lvl.level]}</span>
                              <span className="sm:hidden">L{lvl.level}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <InstrumentButton
                          size="xs"
                          variant={isSelected ? 'accent' : 'default'}
                          onClick={() => onSelectSignal(nodeIndex)}
                          className="min-h-[34px] px-2.5"
                        >
                          <span>{isSelected ? 'Inspecting' : 'Evidence'}</span>
                        </InstrumentButton>

                        <InstrumentButton
                          size="xs"
                          onClick={() => onInspectOnRadar(nodeIndex)}
                          className="min-h-[34px] px-2.5"
                        >
                          <Orbit className="w-3 h-3 text-teal-400" />
                          <span>Radar</span>
                        </InstrumentButton>

                        <InstrumentButton
                          size="xs"
                          onClick={() => {
                            const url = buildCortexDeepLinkUrl(signal.id, activeLiteracyLevel);
                            void navigator.clipboard?.writeText(url);
                            setCopiedId(signal.id);
                            setTimeout(
                              () => setCopiedId((p) => (p === signal.id ? null : p)),
                              1800
                            );
                          }}
                          className="min-h-[34px] px-2"
                        >
                          {copiedId === signal.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Link2 className="w-3 h-3 text-teal-400" />
                          )}
                        </InstrumentButton>

                        <InstrumentButton
                          size="xs"
                          onClick={() => {
                            void renderShareCardPngBlob({
                              signal,
                              cleanHeadline: cleanTitle,
                              literacy: lit,
                              activeLevel: activeLiteracyLevel,
                            })
                              .then(({ blob, filename }) => {
                                const objUrl = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = objUrl;
                                a.download = filename;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                setTimeout(() => URL.revokeObjectURL(objUrl), 3500);
                                setPngSavedId(signal.id);
                                setTimeout(
                                  () => setPngSavedId((p) => (p === signal.id ? null : p)),
                                  2000
                                );
                              })
                              .catch(() => {});
                          }}
                          className="min-h-[34px] px-2"
                        >
                          {pngSavedId === signal.id ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Download className="w-3 h-3 text-teal-400" />
                          )}
                        </InstrumentButton>
                      </div>
                    </div>
                  </ObsidianPanel>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
