import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Search, VolumeX, X } from 'lucide-react';
import {
  LiteracyLevel,
  SECTOR_BY_ID,
  SectorId,
  SpatialSignal,
} from '../../shared/types';
import {
  computeSignalMomentumScore,
  formatRelativeAgeShort,
  getCleanDisplayHeadline,
} from '../utils/signalRanking';
import { Kbd, ObsidianPanel } from './ui/cockpit-primitives';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  signals: SpatialSignal[];
  mutedSectors: ReadonlySet<SectorId>;
  activeLiteracyLevel: LiteracyLevel;
  onSelectNodeIndex: (nodeIndex: number) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  signals,
  mutedSectors,
  activeLiteracyLevel,
  onSelectNodeIndex,
}) => {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIdx(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const matches = useMemo(() => {
    const nowMs = Date.now();
    const q = query.trim().toLowerCase();
    const indexed = signals.map((signal, nodeIndex) => ({
      nodeIndex,
      signal,
      momentum: computeSignalMomentumScore(signal, nowMs),
    }));

    const filtered = q
      ? indexed.filter(({ signal }) => {
          const secName = SECTOR_BY_ID[signal.primarySector]?.name || '';
          const haystack = [
            signal.title,
            signal.literacy?.plainFullTitle || '',
            signal.rawAbstract,
            signal.originFeedName || '',
            signal.source,
            signal.primarySector,
            secName,
            signal.canonicalEntity || '',
            ...(signal.affectedEnterpriseStacks || []),
          ]
            .join(' ')
            .toLowerCase();
          return haystack.includes(q);
        })
      : indexed;

    filtered.sort((a, b) => b.momentum - a.momentum);
    return filtered.slice(0, 14);
  }, [signals, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  if (!isOpen) return null;

  const commitSelection = (nodeIndex: number) => {
    onSelectNodeIndex(nodeIndex);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search AI Signals Command Palette"
      onClick={onClose}
      className="fixed inset-0 z-50 pointer-events-auto bg-black/72 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-3"
    >
      <ObsidianPanel
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[600px] overflow-hidden border border-white/15 shadow-2xl"
      >
        {/* Search Header */}
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-white/10">
          <Search className="w-4 h-4 text-teal-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((prev) =>
                  matches.length > 0 ? (prev + 1) % matches.length : 0
                );
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx((prev) =>
                  matches.length > 0 ? (prev - 1 + matches.length) % matches.length : 0
                );
              } else if (e.key === 'Enter' && matches[activeIdx]) {
                e.preventDefault();
                commitSelection(matches[activeIdx].nodeIndex);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
            placeholder="Search orbs by headline, source, sector, stack, or keyword..."
            className="flex-1 bg-transparent text-[13px] font-sans text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          <Kbd>ESC</Kbd>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Search"
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[54vh] overflow-y-auto divide-y divide-white/6">
          {matches.length === 0 ? (
            <div className="p-6 text-center font-mono text-xs text-zinc-500">
              No matching signals found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            matches.map((item, idx) => {
              const sec = SECTOR_BY_ID[item.signal.primarySector];
              const isMuted = mutedSectors.has(item.signal.primarySector);
              const selected = idx === activeIdx;
              const headline = getCleanDisplayHeadline(item.signal, activeLiteracyLevel);
              const origin =
                item.signal.originFeedName ||
                (item.signal.isDemoSeed ? '72h Seed' : item.signal.source);

              return (
                <button
                  key={item.signal.id}
                  type="button"
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => commitSelection(item.nodeIndex)}
                  className={`w-full text-left px-3.5 py-2.5 flex items-start justify-between gap-3 transition-colors cursor-pointer ${
                    selected ? 'bg-teal-500/[0.12]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[9.5px] tabular-nums">
                      <span
                        style={{ backgroundColor: sec.colorHex }}
                        className="h-1.5 w-1.5 rounded-full shrink-0"
                      />
                      <span className="text-zinc-300 font-semibold">{sec.code}</span>
                      <span className="text-zinc-500">·</span>
                      <span className="text-zinc-400 truncate max-w-[160px]">{origin}</span>
                      <span className="text-zinc-500">·</span>
                      <span className="text-zinc-400">
                        {formatRelativeAgeShort(item.signal.publishedAtMs)}
                      </span>
                      {isMuted && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-amber-500/15 border border-amber-400/35 text-amber-200">
                          <VolumeX className="w-2.5 h-2.5" />
                          <span>Muted — click to unmute</span>
                        </span>
                      )}
                    </div>
                    <p className="text-[12.5px] font-medium text-zinc-100 leading-snug line-clamp-2">
                      {headline}
                    </p>
                  </div>
                  {selected && (
                    <span className="mt-1 p-1 rounded bg-zinc-900 border border-teal-400/40 text-teal-300 shrink-0">
                      <CornerDownLeft className="w-3 h-3" />
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer Hints */}
        <div className="flex items-center justify-between px-3.5 py-1.5 border-t border-white/8 bg-zinc-950/80 font-mono text-[9.5px] text-zinc-500">
          <div className="flex items-center gap-2">
            <span>↑↓ Navigate</span>
            <span>↵ Fly to Orb</span>
          </div>
          <span>Ctrl+K / /</span>
        </div>
      </ObsidianPanel>
    </div>
  );
};
