import React, { useState } from 'react';
import { Archive, ArrowLeft, Clock, ExternalLink } from 'lucide-react';
import { formatUtcTimestamp } from '../../shared/provenance';
import type { ArchivedSignalEntry, VerifiedSourceMetric } from '../../shared/types';
import { formatRelativeAgeShort } from '../utils/signalRanking';
import { InstrumentButton, ObsidianPanel } from './ui/cockpit-primitives';

export type ArchivedPermalinkState =
  | { status: 'IDLE' }
  | { status: 'LOADING'; requestedId: string }
  | { status: 'ARCHIVED'; requestedId: string; entry: ArchivedSignalEntry }
  | { status: 'NOT_FOUND'; requestedId: string };

interface ArchivedPermalinkCardProps {
  state: ArchivedPermalinkState;
  isMobileViewport: boolean;
  onBrowseLiveSignals: () => void;
}

export const ArchivedPermalinkCard: React.FC<ArchivedPermalinkCardProps> = ({
  state,
  isMobileViewport,
  onBrowseLiveSignals,
}) => {
  const [selectedMetric, setSelectedMetric] = useState<VerifiedSourceMetric | null>(null);

  if (state.status === 'IDLE') return null;

  const nowMs = Date.now();

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Archived Signal Permalink"
      className="fixed inset-x-0 bottom-0 top-[104px] md:inset-0 md:top-0 z-[27] flex items-center justify-center p-3 md:p-6 pointer-events-none"
    >
      <ObsidianPanel className="pointer-events-auto w-full max-w-[540px] max-h-[calc(100dvh-124px)] overflow-y-auto rounded-xl border border-amber-400/35 p-4 md:p-5 space-y-3.5 shadow-2xl">
        {state.status === 'LOADING' && (
          <div className="space-y-2 font-mono text-xs text-zinc-300">
            <div className="inline-flex items-center gap-2 text-teal-300">
              <Archive className="w-4 h-4 animate-pulse" />
              <span>Checking archived signal permalink...</span>
            </div>
            <p className="text-[11px] text-zinc-400 break-all">ID: {state.requestedId}</p>
          </div>
        )}

        {state.status === 'ARCHIVED' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] tabular-nums">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/40 text-amber-200 font-semibold">
                <Archive className="w-3 h-3 shrink-0" />
                <span>Archived Permalink</span>
              </span>
              <span className="text-zinc-400 truncate max-w-[220px]">
                {state.entry.originFeedName || state.entry.source}
              </span>
            </div>

            <div className="rounded-lg bg-amber-500/[0.07] border border-amber-400/25 px-3 py-2 font-mono text-[11px] text-amber-100">
              This story has left the live 7-day feed
            </div>

            <h2 className="cockpit-heading text-base md:text-lg font-semibold text-zinc-100 leading-snug">
              {state.entry.title}
            </h2>

            <div className="flex flex-col gap-1 text-[10px] font-mono tabular-nums text-zinc-400">
              <div className="inline-flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-teal-400 shrink-0" />
                <span>
                  Published{' '}
                  <span className="text-zinc-200">
                    {formatRelativeAgeShort(state.entry.publishedAtMs, nowMs)} ago
                  </span>{' '}
                  · {formatUtcTimestamp(state.entry.publishedAtMs)}
                </span>
              </div>
              <div className="inline-flex items-center gap-1.5 text-zinc-500">
                <Archive className="w-3 h-3 shrink-0" />
                <span>Archived {formatUtcTimestamp(state.entry.archivedAtMs)}</span>
              </div>
            </div>

            {state.entry.verbatimExcerpt && (
              <div className="cockpit-well rounded-lg p-2.5 space-y-1">
                <span className="font-mono text-[9.5px] uppercase tracking-wider text-zinc-400 block">
                  Source Excerpt
                </span>
                <p className="text-[12px] text-zinc-200 leading-[1.5]">
                  {state.entry.verbatimExcerpt}
                </p>
              </div>
            )}

            {state.entry.verifiedMetrics && state.entry.verifiedMetrics.length > 0 && (
              <div className="cockpit-well rounded-lg p-2.5 space-y-2 font-mono text-[10px] tabular-nums">
                <span className="text-[9.5px] uppercase tracking-wider text-zinc-400 block">
                  Source-Backed Metrics · Tap to Verify
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {state.entry.verifiedMetrics.map((vm, idx) => {
                    const active =
                      selectedMetric?.value === vm.value &&
                      selectedMetric?.label === vm.label &&
                      (selectedMetric?.subject || '') === (vm.subject || '') &&
                      (selectedMetric?.condition || '') === (vm.condition || '');
                    const displayValue = [vm.subject, vm.value, vm.condition]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <button
                        key={`${vm.subject || ''}-${vm.value}-${vm.condition || ''}-${vm.label}-${idx}`}
                        type="button"
                        onClick={() =>
                          setSelectedMetric((prev) =>
                            prev?.value === vm.value &&
                            prev?.label === vm.label &&
                            (prev?.subject || '') === (vm.subject || '') &&
                            (prev?.condition || '') === (vm.condition || '')
                              ? null
                              : vm
                          )
                        }
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-teal-500/20 border-teal-400/70 text-teal-100'
                            : 'bg-zinc-900/90 border-white/12 text-zinc-200 hover:border-teal-400/45'
                        }`}
                      >
                        <span className="text-teal-300 font-semibold whitespace-nowrap">
                          {displayValue}
                        </span>
                        <span
                          className={`text-zinc-400 text-[9.5px] ${
                            vm.caveat
                              ? 'max-w-[290px] whitespace-normal leading-snug'
                              : 'truncate max-w-[165px]'
                          }`}
                        >
                          {vm.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {selectedMetric && (
                  <div className="space-y-1.5">
                    <blockquote className="font-sans text-[11.5px] text-zinc-200 leading-[1.45] border-l-2 border-teal-400/50 pl-2">
                      &ldquo;{selectedMetric.quote}&rdquo;
                    </blockquote>
                    {selectedMetric.caveat && (
                      <div
                        role="note"
                        aria-label="Author warning / caveat"
                        className="rounded border border-amber-400/35 bg-amber-500/[0.08] px-2 py-1.5 space-y-0.5"
                      >
                        <div className="font-mono text-[9px] uppercase tracking-wider font-semibold text-amber-300">
                          Author warning / caveat
                        </div>
                        <p className="font-sans text-[11px] text-amber-100/95 leading-[1.45]">
                          &ldquo;{selectedMetric.caveat}&rdquo;
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
              <a
                href={state.entry.url}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-teal-500/18 hover:bg-teal-500/28 border border-teal-400/50 font-mono text-[11px] font-semibold text-teal-100 transition-colors ${
                  isMobileViewport ? 'min-h-[42px]' : ''
                }`}
              >
                <span>Open Original Source</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              </a>

              <InstrumentButton
                size="xs"
                className={isMobileViewport ? 'min-h-[42px] px-3' : 'px-3 py-1.5'}
                onClick={onBrowseLiveSignals}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Browse Live Signals</span>
              </InstrumentButton>
            </div>
          </>
        )}

        {state.status === 'NOT_FOUND' && (
          <>
            <div className="flex items-center gap-2 font-mono text-[10.5px] text-amber-300">
              <Archive className="w-3.5 h-3.5 shrink-0" />
              <span>Expired Signal Link</span>
            </div>
            <h2 className="cockpit-heading text-base font-semibold text-zinc-100 leading-snug">
              This shared story link is no longer in the live 7-day feed
            </h2>
            <p className="text-[12px] text-zinc-400 leading-[1.5]">
              Requested signal ID <code className="font-mono text-zinc-300">{state.requestedId}</code>{' '}
              has rotated past both the active 7-day radar and the local static snapshot archive.
            </p>
            <div className="pt-2 border-t border-white/10 flex justify-end">
              <InstrumentButton
                size="xs"
                variant="accent"
                className={isMobileViewport ? 'min-h-[42px] px-3' : 'px-3 py-1.5'}
                onClick={onBrowseLiveSignals}
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Return to Live Feed</span>
              </InstrumentButton>
            </div>
          </>
        )}
      </ObsidianPanel>
    </div>
  );
};
