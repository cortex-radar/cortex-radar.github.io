import React, { useState } from 'react';
import {
  Activity,
  Check,
  Compass,
  Download,
  ExternalLink,
  Link2,
} from 'lucide-react';
import {
  buildDeterministicLiteracyPayload,
  sanitizeLiteracyPayloadPlainLevels,
} from '../../shared/literacyEngine';
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

export interface MobileSignalDeckEntry {
  nodeIndex: number;
  signal: SpatialSignal;
  isNew: boolean;
}

interface MobileSignalDeckProps {
  signals: MobileSignalDeckEntry[];
  activeLiteracyLevel: LiteracyLevel;
  onSelectLiteracyLevel: (lvl: LiteracyLevel) => void;
  onInspectOnMap: (nodeIndex: number) => void;
  onlyNewFilterActive: boolean;
  newSignalsCount: number;
  onToggleOnlyNewFilter: () => void;
  mutedSectors: ReadonlySet<SectorId>;
  onToggleMuteSector: (sec: SectorId) => void;
}

export const MobileSignalDeck: React.FC<MobileSignalDeckProps> = ({
  signals,
  activeLiteracyLevel,
  onSelectLiteracyLevel,
  onInspectOnMap,
  onlyNewFilterActive,
  newSignalsCount,
  onToggleOnlyNewFilter,
  mutedSectors,
  onToggleMuteSector,
}) => {
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pngSavedId, setPngSavedId] = useState<string | null>(null);
  const nowMs = Date.now();

  return (
    <div
      aria-label="Mobile Signal Deck"
      className="fixed inset-0 z-20 md:hidden overflow-y-auto overscroll-contain pt-[114px] pb-[88px] px-3 space-y-3 bg-[#09090B]/58 backdrop-blur-md pointer-events-auto"
    >
      {/* My Radar Category Filter Chips + New Delta Toggle */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {newSignalsCount > 0 && (
          <button
            type="button"
            onClick={onToggleOnlyNewFilter}
            className={`shrink-0 min-h-[36px] inline-flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-[10.5px] tabular-nums border cursor-pointer transition-colors ${
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
              className={`shrink-0 min-h-[36px] inline-flex items-center gap-1.5 px-2.5 rounded-lg font-mono text-[10.5px] border cursor-pointer transition-all ${
                isMuted
                  ? 'bg-zinc-950/60 border-white/5 text-zinc-500 line-through opacity-60'
                  : 'cockpit-obsidian border-white/12 text-zinc-200'
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
      </div>

      {/* Vertical Card Feed */}
      {signals.length === 0 ? (
        <ObsidianPanel className="p-5 text-center space-y-2">
          <p className="text-xs text-zinc-300">
            No signals match your active category or new-signal filters.
          </p>
        </ObsidianPanel>
      ) : (
        signals.map(({ nodeIndex, signal, isNew }) => {
          const sec = SECTOR_BY_ID[signal.primarySector];
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
            <ObsidianPanel
              key={signal.id}
              className="p-3.5 space-y-2.5 border border-white/12 shadow-xl"
            >
              {heroMedia && (
                <div className="cockpit-well rounded-lg overflow-hidden">
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
                    className="w-full max-h-40 object-cover bg-zinc-950"
                  />
                </div>
              )}

              {/* Metadata Row */}
              <div className="flex items-center justify-between gap-2 font-mono text-[10px] tabular-nums">
                <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-white/10 text-zinc-200">
                    <span
                      style={{ backgroundColor: sec.colorHex }}
                      className="h-1.5 w-1.5 rounded-full"
                    />
                    <span>{sec.code}</span>
                  </span>

                  {recent12h && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-500/15 border border-teal-400/35 text-teal-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-pulse" />
                      <span>{formatRelativeAgeShort(signal.publishedAtMs, nowMs)}</span>
                    </span>
                  )}

                  {isNew && (
                    <span className="px-1.5 py-0.5 rounded bg-teal-500/20 border border-teal-400/45 text-teal-200">
                      NEW
                    </span>
                  )}

                  <a
                    href={signal.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-zinc-400 hover:text-teal-200 truncate max-w-[140px]"
                  >
                    <span className="truncate">{origin}</span>
                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                  </a>
                </div>

                {ups > 0 && (
                  <span className="inline-flex items-center gap-1 text-teal-300 shrink-0">
                    <Activity className="w-3 h-3" />
                    <span>{ups}</span>
                  </span>
                )}
              </div>

              {/* Title */}
              <h3 className="cockpit-heading text-[15px] font-semibold leading-snug text-zinc-100">
                {cleanTitle}
              </h3>

              {/* Inline 1-5 Literacy Lens Scrubber */}
              <div className="cockpit-well relative grid grid-cols-5 p-0.5 rounded-lg">
                <div
                  aria-hidden="true"
                  style={{
                    width: 'calc((100% - 4px) / 5)',
                    transform: `translate3d(${(activeLiteracyLevel - 1) * 100}%, 0, 0)`,
                  }}
                  className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-[6px] bg-zinc-800/95 border border-teal-400/40 transition-transform duration-150 ease-out"
                />
                {LITERACY_LEVELS.map((lvl) => {
                  const active = activeLiteracyLevel === lvl.level;
                  return (
                    <button
                      key={lvl.level}
                      type="button"
                      onClick={() => onSelectLiteracyLevel(lvl.level)}
                      className={`relative z-10 min-h-[38px] px-1 rounded-[6px] font-mono tabular-nums flex flex-col items-center justify-center leading-tight cursor-pointer ${
                        active ? 'text-zinc-100 font-semibold' : 'text-zinc-500'
                      }`}
                    >
                      <span className={`text-[10px] ${active ? 'text-teal-300' : ''}`}>
                        {lvl.level}
                      </span>
                      <span className="text-[8.5px] tracking-tight">
                        {LENS_SHORT_LABELS[lvl.level]}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Active Lens Body */}
              <div className="cockpit-well rounded-lg p-2.5 space-y-1">
                <span className="font-mono text-[9.5px] uppercase tracking-wider text-teal-300 block">
                  {takeaway.label}
                </span>
                <p className="text-[12.5px] text-zinc-200 leading-relaxed">{takeaway.text}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between gap-1.5 pt-1">
                <InstrumentButton
                  size="xs"
                  variant="accent"
                  onClick={() => onInspectOnMap(nodeIndex)}
                  className="min-h-[42px] px-3"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>3D Map</span>
                </InstrumentButton>

                <div className="flex items-center gap-1.5">
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
                    className="min-h-[42px] px-3"
                  >
                    {copiedId === signal.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="w-3.5 h-3.5 text-teal-400" />
                        <span>Copy Link</span>
                      </>
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
                    className="min-h-[42px] px-3"
                  >
                    {pngSavedId === signal.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Saved</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5 text-teal-400" />
                        <span>PNG</span>
                      </>
                    )}
                  </InstrumentButton>
                </div>
              </div>
            </ObsidianPanel>
          );
        })
      )}
    </div>
  );
};
