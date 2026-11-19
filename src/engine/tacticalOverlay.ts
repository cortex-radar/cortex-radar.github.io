import {
  ATTRACTOR_COUNT,
  ATTRACTOR_STRIDE,
  HEADER_FLOATS,
  NODE_OFFSET,
  TRAIL_OFFSET,
  TRAIL_POINTS,
  TRAIL_STRIDE,
} from '../../shared/frameLayout';
import {
  getZoomBand,
  LiteracyLevel,
  MAX_NODES,
  NODE_STRIDE,
  SECTORS,
  SpatialSignal,
} from '../../shared/types';
import { computeSignalMomentumScore, isRecentSignal12h } from '../utils/signalRanking';

const PLAIN_SECTOR_SUBTITLES: Record<string, string> = {
  REL: 'Major new AI assistants & public launches',
  SCI: 'Lab discoveries making AI smarter & more reliable',
  ARC: 'Tools & servers that connect AI to everyday software',
  INN: 'Real-world company results & time-saving wins',
  GOV: 'Safety rules, privacy shields & legal guardrails',
  CRT: 'Hands-on training & practical skill badges',
  ECO: 'Ways to run AI faster & lower monthly bills',
  MKT: 'Big industry partnerships & hardware shifts',
};

export interface LassoPoint {
  x: number; // screen css px
  y: number;
}

export interface ConstellationArcLink {
  fromIdx: number;
  toIdx: number;
  strength: number;
}

export interface TacticalRenderParams {
  ctx: CanvasRenderingContext2D;
  cssW: number;
  cssH: number;
  dpr: number;
  packet: Float32Array;
  signals: SpatialSignal[];
  camX: number;
  camY: number;
  zoom: number;
  literacyLevel: LiteracyLevel;
  pureLiveMode?: boolean;
  hoverDwellMs?: number;
  seenNodeIds?: ReadonlySet<string>;
  nowMs?: number;
  rightReservedPx?: number;
  spotlightSourceIdx?: number;
  spotlightSectorIdx?: number;
  constellationLinks?: ConstellationArcLink[];
  hasActiveFilter?: boolean;
  mutedSectorIndices?: ReadonlySet<number>;
  selectedNodeIdx: number;
  draggedNodeIdx: number;
  lassoPoints: LassoPoint[];
  lassoCapturedIndices: Set<number>;
}

function stripReticleOriginPrefix(rawTitle: string, origin?: string, source?: string): string {
  let clean = (rawTitle || '').trim();
  for (const cand of [origin, source]) {
    if (!cand) continue;
    const escaped = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\s*(?:\\[)?${escaped}(?:\\])?\\s*[:\\-–—|·]\\s*`, 'i');
    if (re.test(clean)) clean = clean.replace(re, '').trim();
  }
  return clean || rawTitle;
}

function truncateCleanOneLine(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const sub = clean.slice(0, maxChars - 1);
  const lastSpace = sub.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? sub.slice(0, lastSpace) : sub).trim()}…`;
}

export function renderTacticalOverlay(p: TacticalRenderParams): void {
  const {
    ctx,
    cssW,
    cssH,
    dpr,
    packet,
    signals,
    camX,
    camY,
    zoom,
    literacyLevel,
    pureLiveMode = true,
    hoverDwellMs = 0,
    seenNodeIds,
    nowMs = Date.now(),
    rightReservedPx = 16,
    spotlightSourceIdx = -1,
    spotlightSectorIdx = -1,
    constellationLinks = [],
    hasActiveFilter = false,
    mutedSectorIndices,
    selectedNodeIdx,
    draggedNodeIdx,
    lassoPoints,
    lassoCapturedIndices,
  } = p;
  const isPlainMode = literacyLevel <= 2;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const nodeCount = Math.min(MAX_NODES, packet[0] | 0, signals.length);
  const activeTrails = packet[2] | 0;
  const simTime = packet[3];
  const hoveredIdx = packet[5] | 0;
  const collideA = packet[6] | 0;
  const collideB = packet[7] | 0;
  const coreSnapIdx = packet[8] | 0;

  const band = getZoomBand(zoom);
  const halfW = cssW * 0.5;
  const halfH = cssH * 0.5;

  const toScreenX = (wx: number) => (wx - camX) * zoom + halfW;
  const toScreenY = (wy: number) => (wy - camY) * zoom + halfH;

  // =========================================================================
  // 1. CENTRAL SYNTHESIS CORE RETICLE AT WORLD (0, 0)
  // =========================================================================
  const coreSx = toScreenX(0);
  const coreSy = toScreenY(0);
  const coreScreenR = Math.max(28, 92 * zoom);

  if (coreSx > -200 && coreSx < cssW + 200 && coreSy > -200 && coreSy < cssH + 200) {
    const isCoreHot = coreSnapIdx >= 0 || draggedNodeIdx >= 0;
    ctx.save();
    ctx.translate(coreSx, coreSy);

    // Outer dashed rotating magnetic snap ring
    ctx.save();
    ctx.rotate(simTime * (isCoreHot ? 0.85 : 0.22));
    ctx.strokeStyle = isCoreHot ? 'rgba(0, 240, 255, 0.92)' : 'rgba(56, 189, 248, 0.34)';
    ctx.lineWidth = isCoreHot ? 2 : 1.1;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(0, 0, coreScreenR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Inner counter-rotating precision reticle
    ctx.save();
    ctx.rotate(-simTime * 0.35);
    ctx.strokeStyle = isCoreHot ? 'rgba(168, 85, 247, 0.85)' : 'rgba(148, 163, 184, 0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, coreScreenR * 0.58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Core label
    ctx.textAlign = 'center';
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = isCoreHot ? '#00F0FF' : 'rgba(186, 230, 253, 0.78)';
    ctx.fillText(
      coreSnapIdx >= 0 ? '⚡ RELEASE TO FUSE 60s STANDUP' : 'SYNTHESIS CORE',
      0,
      -5
    );
    ctx.font = '500 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.68)';
    ctx.fillText(
      draggedNodeIdx >= 0 ? 'MAGNETIC SNAP ZONE ACTIVE' : 'DROP NODE OR CLICK FOR 60s BRIEF',
      0,
      9
    );
    ctx.restore();
  }

  // =========================================================================
  // 2. LIVE INBOUND ORBITAL ENTRY COMET TRAILS (Distinguishes Live vs Seed!)
  // =========================================================================
  for (let t = 0; t < activeTrails; t++) {
    const off = TRAIL_OFFSET + t * TRAIL_STRIDE;
    const nIdx = packet[off] | 0;
    const sIdx = Math.max(0, Math.min(7, packet[off + 1] | 0));
    const trailAlpha = packet[off + 2];
    if (trailAlpha <= 0.03) continue;

    const secMeta = SECTORS[sIdx];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let k = 0; k < TRAIL_POINTS - 1; k++) {
      const x0 = toScreenX(packet[off + 3 + k * 2]);
      const y0 = toScreenY(packet[off + 3 + k * 2 + 1]);
      const x1 = toScreenX(packet[off + 3 + (k + 1) * 2]);
      const y1 = toScreenY(packet[off + 3 + (k + 1) * 2 + 1]);
      const segFade = (1 - k / TRAIL_POINTS) * trailAlpha;

      ctx.strokeStyle = k < 2 ? `rgba(224, 255, 255, ${segFade * 0.95})` : `${secMeta.colorHex}`;
      ctx.globalAlpha = segFade * 0.82;
      ctx.lineWidth = Math.max(1.2, (1 - k / TRAIL_POINTS) * 5.5 * Math.min(1.5, zoom));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    // Inbound live badge tag near head of comet
    const headX = toScreenX(packet[off + 3]);
    const headY = toScreenY(packet[off + 4]);
    const sig = signals[nIdx];
    if (sig && trailAlpha > 0.25) {
      ctx.globalAlpha = Math.min(1, trailAlpha * 1.3);
      ctx.font = '700 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#5EEAD4';
      ctx.textAlign = 'left';
      const cometLabel = isPlainMode
        ? `☄ NEW UPDATE // ${sig.literacy?.plainTitle || sig.shortLabel}`
        : `☄ LIVE INBOUND // ${sig.source.toUpperCase()}`;
      ctx.fillText(cometLabel, headX + 16, headY - 14);
    }
    ctx.restore();
  }

  // =========================================================================
  // 3. SELF-DOCUMENTING 8-SECTOR GRAVITATIONAL ATTRACTOR BEACONS
  // =========================================================================
  const placedBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const rightSafeLimit = Math.max(240, cssW - rightReservedPx);

  // Reserve Central Synthesis Core reticle label area so pills never collide with center core
  if (coreSx > -200 && coreSx < cssW + 200 && coreSy > -200 && coreSy < cssH + 200) {
    placedBoxes.push({
      x0: coreSx - 105,
      y0: coreSy - 26,
      x1: coreSx + 105,
      y1: coreSy + 26,
    });
  }

  // Reserve 8-sector beacon headers & highlight/dim based on Spotlight or My Radar Muting
  for (let s = 0; s < ATTRACTOR_COUNT; s++) {
    const off = HEADER_FLOATS + s * ATTRACTOR_STRIDE;
    const ax = toScreenX(packet[off]);
    const ay = toScreenY(packet[off + 1]);
    const massSum = packet[off + 2];
    const pulse = packet[off + 3];
    if (ax < -240 || ax > cssW + 240 || ay < -180 || ay > cssH + 180) continue;

    const meta = SECTORS[s];
    const isMutedSec = Boolean(mutedSectorIndices?.has(s));
    const isSpotlightMatchedSec = spotlightSectorIdx < 0 || spotlightSectorIdx === s;
    const secDimMult = isMutedSec ? 0.16 : isSpotlightMatchedSec ? 1.0 : 0.18;

    ctx.save();
    ctx.translate(ax, ay);

    const bSize = Math.max(18, 28 * Math.min(1.3, zoom));
    ctx.strokeStyle = meta.colorHex;
    ctx.globalAlpha = (0.35 + pulse * 0.5) * secDimMult;
    ctx.lineWidth = spotlightSectorIdx === s ? 1.9 : 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, bSize, -0.5, 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, bSize, Math.PI - 0.5, Math.PI + 0.5);
    ctx.stroke();

    ctx.globalAlpha = (band === 'RAW' ? 0.45 : 0.92) * secDimMult;
    ctx.textAlign = 'center';
    ctx.font = '700 10.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = meta.colorHex;
    ctx.fillText(
      isPlainMode ? meta.name.toUpperCase() : `[${meta.code}] ${meta.name.toUpperCase()}`,
      0,
      -bSize - 10
    );

    if (band === 'MACRO' || band === 'CSUITE') {
      ctx.font = '500 9.5px ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(203, 213, 225, 0.66)';
      ctx.fillText(
        isPlainMode
          ? PLAIN_SECTOR_SUBTITLES[meta.code] || meta.subtitle
          : `${meta.subtitle} · ΣM ${massSum.toFixed(1)}`,
        0,
        -bSize + 2
      );
    }
    ctx.restore();

    if (!isMutedSec) {
      placedBoxes.push({
        x0: ax - 92,
        y0: ay - bSize - 22,
        x1: ax + 92,
        y1: ay - bSize + 10,
      });
    }
  }

  // =========================================================================
  // 3B. SUBTLE SONAR RINGS ON RECENT SIGNALS (Last 12 Hours)
  // =========================================================================
  for (let i = 0; i < nodeCount; i++) {
    const off = NODE_OFFSET + i * NODE_STRIDE;
    const vis = packet[off + 15];
    if (vis < 0.35) continue;
    const sig = signals[i];
    if (!sig || !isRecentSignal12h(sig, nowMs)) continue;

    const sx = toScreenX(packet[off]);
    const sy = toScreenY(packet[off + 1]);
    if (sx < -60 || sx > cssW + 60 || sy < -60 || sy > cssH + 60) continue;

    const rScreen = Math.max(5, packet[off + 4] * zoom);
    const secMeta = SECTORS[packet[off + 5] | 0] || SECTORS[0];
    const phase = (simTime * 0.38 + i * 0.19) % 1;
    const ringR = rScreen + 3 + phase * Math.max(15, rScreen * 1.15);
    const alpha = Math.pow(1 - phase, 1.8) * 0.36 * Math.min(1, vis);

    ctx.save();
    ctx.strokeStyle = secMeta.colorHex || '#2DD4BF';
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // =========================================================================
  // 3C. SPOTLIGHT CONSTELLATION ARCS ON HOVER (Orb / Rail Item / Category Pill)
  // =========================================================================
  if (constellationLinks.length > 0) {
    for (let k = 0; k < constellationLinks.length; k++) {
      const link = constellationLinks[k];
      if (
        link.fromIdx < 0 ||
        link.fromIdx >= nodeCount ||
        link.toIdx < 0 ||
        link.toIdx >= nodeCount
      ) {
        continue;
      }
      const fOff = NODE_OFFSET + link.fromIdx * NODE_STRIDE;
      const tOff = NODE_OFFSET + link.toIdx * NODE_STRIDE;
      if (packet[fOff + 15] < 0.25 || packet[tOff + 15] < 0.25) continue;

      const x0 = toScreenX(packet[fOff]);
      const y0 = toScreenY(packet[fOff + 1]);
      const x1 = toScreenX(packet[tOff]);
      const y1 = toScreenY(packet[tOff + 1]);
      const dx = x1 - x0;
      const dy = y1 - y0;
      const curveFactor = (k % 2 === 0 ? 1 : -1) * 0.16;
      const cx = (x0 + x1) * 0.5 - dy * curveFactor;
      const cy = (y0 + y1) * 0.5 + dx * curveFactor;

      const secMeta = SECTORS[packet[fOff + 5] | 0] || SECTORS[0];
      const arcColor = link.strength >= 0.9 ? '#2DD4BF' : secMeta.colorHex || '#38BDF8';

      ctx.save();
      // Soft outer glow pass
      ctx.strokeStyle = arcColor;
      ctx.globalAlpha = 0.18 + link.strength * 0.12;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
      ctx.stroke();

      // Crisp inner vector filament
      ctx.globalAlpha = 0.55 + link.strength * 0.25;
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -simTime * 22;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(cx, cy, x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);

      // Travelling photon pulse along constellation arc
      const pt = (simTime * 0.55 + k * 0.21) % 1;
      const inv = 1 - pt;
      const px = inv * inv * x0 + 2 * inv * pt * cx + pt * pt * x1;
      const py = inv * inv * y0 + 2 * inv * pt * cy + pt * pt * y1;
      ctx.fillStyle = '#E0F2FE';
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Subtle peer ring on linked destination orb
      const rDst = Math.max(7, packet[tOff + 4] * zoom) + 4;
      ctx.strokeStyle = arcColor;
      ctx.globalAlpha = 0.58;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(x1, y1, rDst, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    }
  }

  // =========================================================================
  // 4. MAGNETIC COLLIDER TARGETING VECTORS (When Dragging a Model/Engine Node)
  // =========================================================================
  if (draggedNodeIdx >= 0 && draggedNodeIdx < nodeCount) {
    const dOff = NODE_OFFSET + draggedNodeIdx * NODE_STRIDE;
    const isDragCollider = packet[dOff + 14] > 0.5;
    const dx = toScreenX(packet[dOff]);
    const dy = toScreenY(packet[dOff + 1]);

    if (isDragCollider) {
      for (let j = 0; j < nodeCount; j++) {
        if (j === draggedNodeIdx) continue;
        const jOff = NODE_OFFSET + j * NODE_STRIDE;
        if (packet[jOff + 14] < 0.5 || packet[jOff + 15] < 0.4) continue;
        const jx = toScreenX(packet[jOff]);
        const jy = toScreenY(packet[jOff + 1]);
        const screenDist = Math.hypot(jx - dx, jy - dy);
        if (screenDist < 380) {
          const isLocked = (collideA === draggedNodeIdx && collideB === j) || (collideB === draggedNodeIdx && collideA === j);
          ctx.save();
          ctx.strokeStyle = isLocked ? '#00F0FF' : 'rgba(56, 189, 248, 0.45)';
          ctx.lineWidth = isLocked ? 2.2 : 1.1;
          ctx.setLineDash(isLocked ? [] : [5, 5]);
          ctx.beginPath();
          ctx.moveTo(dx, dy);
          ctx.lineTo(jx, jy);
          ctx.stroke();

          // Target reticle on peer collider
          ctx.beginPath();
          ctx.arc(jx, jy, isLocked ? 24 : 17, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  // =========================================================================
  // 5. COLLISION-AWARE LOD NODE LABELS (Top 6-8 at Default Zoom, Zero Overlap)
  // =========================================================================
  ctx.textBaseline = 'middle';

  const effectiveHoverIdx = spotlightSourceIdx >= 0 ? spotlightSourceIdx : hoveredIdx;
  const isSpotlightedOrFiltered =
    effectiveHoverIdx >= 0 || spotlightSectorIdx >= 0 || hasActiveFilter;
  const maxLabels = isSpotlightedOrFiltered
    ? 12
    : zoom < 0.98
    ? 7
    : Math.min(28, Math.round(7 + (zoom - 0.95) * 14));

  // Sort draw priority: Hovered / Spotlighted -> Captured -> Highest Momentum/Mass first!
  const order: number[] = [];
  for (let i = 0; i < nodeCount; i++) order.push(i);
  order.sort((a, b) => {
    const sigA = signals[a];
    const sigB = signals[b];
    const priA =
      (a === effectiveHoverIdx ? 1000 : 0) +
      (lassoCapturedIndices.has(a) ? 500 : 0) +
      (sigA ? computeSignalMomentumScore(sigA, nowMs) : packet[NODE_OFFSET + a * NODE_STRIDE + 6] * 10);
    const priB =
      (b === effectiveHoverIdx ? 1000 : 0) +
      (lassoCapturedIndices.has(b) ? 500 : 0) +
      (sigB ? computeSignalMomentumScore(sigB, nowMs) : packet[NODE_OFFSET + b * NODE_STRIDE + 6] * 10);
    return priB - priA;
  });

  let drawnLabelsCount = 0;
  for (let ordIdx = 0; ordIdx < order.length; ordIdx++) {
    const i = order[ordIdx];
    const off = NODE_OFFSET + i * NODE_STRIDE;
    const vis = packet[off + 15];
    if (vis < 0.35) continue;

    // Skip canvas text if this node currently has a full Diegetic Light-Table Hologram open
    if (i === selectedNodeIdx || i === collideA || i === collideB) continue;
    if (zoom >= 1.05 && i === effectiveHoverIdx) continue;
    if (i === effectiveHoverIdx && (hoverDwellMs >= 100 || spotlightSourceIdx >= 0) && collideA < 0) {
      continue;
    }

    const wx = packet[off];
    const wy = packet[off + 1];
    const sx = toScreenX(wx);
    const sy = toScreenY(wy);
    if (sx < -60 || sx > rightSafeLimit || sy < 56 || sy > cssH - 96) continue;

    const rScreen = packet[off + 4] * zoom;
    const isLive = packet[off + 8] > 0.5;
    const hover = packet[off + 12];
    const collider = packet[off + 14] > 0.5;
    const captured = lassoCapturedIndices.has(i);

    const sig = signals[i];
    if (!sig) continue;
    const isSeen = Boolean(seenNodeIds?.has(sig.id)) && i !== effectiveHoverIdx && !captured;

    // Captured by Shift+Drag Spatial Lasso bracket
    if (captured) {
      ctx.save();
      ctx.strokeStyle = '#00F0FF';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(sx - rScreen - 8, sy - rScreen - 8, (rScreen + 8) * 2, (rScreen + 8) * 2);
      ctx.restore();
    }

    if (drawnLabelsCount >= maxLabels && i !== effectiveHoverIdx && !captured) continue;

    const secMeta = SECTORS[packet[off + 5] | 0] || SECTORS[0];
    const labelX = sx + Math.max(11, rScreen + 7);

    ctx.font = '600 10.5px ui-sans-serif, system-ui, -apple-system, sans-serif';
    const rawDisplay = isPlainMode
      ? sig.literacy?.plainTitle || sig.shortLabel
      : sig.shortLabel;
    const displayLabel = truncateCleanOneLine(rawDisplay, 28);
    const textPrefix = isLive && !pureLiveMode ? 'LIVE · ' : collider && !isLive ? '◈ ' : '';
    const dotPad = isLive ? 10 : 0;
    const text = `${textPrefix}${displayLabel}`;
    const tw = dotPad + ctx.measureText(text).width;

    const showSubMeta = zoom >= 1.25 && (band === 'CSUITE' || band === 'ARCHITECT');
    const padX = 6;
    const padY = 4;
    const boxX0 = labelX - 5 - padX;
    const boxY0 = sy - 10 - padY;
    const boxX1 = labelX + tw + 9 + padX;
    const boxY1 = sy + (showSubMeta ? 24 : 11) + padY;

    // Strict viewport boundary check (respect top HUD, bottom timeline, & right Signal Rail)
    if (boxX0 < 14 || boxX1 > rightSafeLimit || boxY0 < 54 || boxY1 > cssH - 96) {
      if (i !== effectiveHoverIdx && !captured) continue;
    }

    // Strict Screen-Space 2D AABB Collision Check (zero overlapping pills guaranteed!)
    if (!captured) {
      let overlaps = false;
      for (let b = 0; b < placedBoxes.length; b++) {
        const pb = placedBoxes[b];
        if (boxX0 < pb.x1 && boxX1 > pb.x0 && boxY0 < pb.y1 && boxY1 > pb.y0) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
    }
    placedBoxes.push({ x0: boxX0, y0: boxY0, x1: boxX1, y1: boxY1 });
    drawnLabelsCount++;

    ctx.save();
    const baseAlpha = Math.min(1, vis * (hover > 0.1 ? 1.0 : band === 'MACRO' ? 0.88 : 0.94));
    ctx.globalAlpha = isSeen ? baseAlpha * 0.56 : baseAlpha;

    ctx.fillStyle = isSeen ? 'rgba(9, 9, 11, 0.72)' : 'rgba(9, 9, 11, 0.88)';
    ctx.fillRect(labelX - 4, sy - 9, tw + 8, 18);
    ctx.strokeStyle = isSeen
      ? 'rgba(255, 255, 255, 0.14)'
      : isLive
      ? 'rgba(45, 212, 191, 0.55)'
      : isPlainMode
      ? 'rgba(52, 211, 153, 0.45)'
      : `${secMeta.colorHex}55`;
    ctx.lineWidth = 1;
    ctx.strokeRect(labelX - 4, sy - 9, tw + 8, 18);

    if (isLive) {
      ctx.beginPath();
      ctx.arc(labelX + 3.2, sy, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = isSeen ? '#64748B' : secMeta.colorHex || '#2DD4BF';
      ctx.fill();
    }

    ctx.fillStyle = isSeen ? '#94A3B8' : isPlainMode ? '#ECFDF5' : '#F1F5F9';
    ctx.textAlign = 'left';
    ctx.fillText(text, labelX + dotPad, sy);

    if (showSubMeta) {
      const metaLine = isPlainMode
        ? `${
            sig.readiness === 'GA'
              ? 'READY NOW'
              : sig.readiness === 'PREVIEW'
              ? 'EARLY ACCESS'
              : 'LAB DISCOVERY'
          } · ${sig.finOps === 'REDUCER' ? 'SAVES COST' : 'STANDARD COST'}`
        : `${sig.readiness} · ${sig.risk} RISK · ${
            sig.finOps === 'REDUCER'
              ? '↓OPEX'
              : sig.finOps === 'INTENSIVE'
              ? '↑COMPUTE'
              : '~NEUTRAL'
          }`;
      ctx.font = '600 8.5px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = secMeta.colorHex;
      ctx.fillText(metaLine, labelX, sy + 14);
    }
    ctx.restore();
  }

  // =========================================================================
  // 6. SHIFT + DRAG SPATIAL LASSO POLYGON FIELD
  // =========================================================================
  if (lassoPoints.length > 1) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
    for (let i = 1; i < lassoPoints.length; i++) {
      ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 240, 255, 0.09)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.9)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 4]);
    ctx.stroke();

    const lastPt = lassoPoints[lassoPoints.length - 1];
    ctx.font = '700 10.5px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = '#00F0FF';
    ctx.fillText(
      `LASSO FUSION · ${lassoCapturedIndices.size} SIGNALS LOCKED`,
      lastPt.x + 12,
      lastPt.y - 10
    );
    ctx.restore();
  }

  // =========================================================================
  // 7. ZERO-CLICK HOVER RETICLE (>100ms DWELL OR SIGNAL RAIL FOCUS)
  // =========================================================================
  const reticleIdx = spotlightSourceIdx >= 0 ? spotlightSourceIdx : hoveredIdx;
  const showReticleNow =
    reticleIdx >= 0 &&
    reticleIdx < nodeCount &&
    reticleIdx !== selectedNodeIdx &&
    collideA < 0 &&
    (spotlightSourceIdx >= 0 || (hoverDwellMs >= 100 && zoom < 1.05));

  if (showReticleNow) {
    const hOff = NODE_OFFSET + reticleIdx * NODE_STRIDE;
    const hVis = packet[hOff + 15];
    const hSig = signals[reticleIdx];
    if (hVis >= 0.25 && hSig) {
      const hsx = toScreenX(packet[hOff]);
      const hsy = toScreenY(packet[hOff + 1]);
      const rPx = Math.max(8, packet[hOff + 4] * zoom);
      const secMeta = SECTORS[packet[hOff + 5] | 0] || SECTORS[0];
      const dwellAlpha = spotlightSourceIdx >= 0 ? 1.0 : Math.min(1, (hoverDwellMs - 100) / 90);

      ctx.save();
      ctx.globalAlpha = dwellAlpha;

      // Precision aerospace corner lock brackets around hovered orb
      const br = rPx + 6.5;
      const arm = Math.min(6, Math.max(4, br * 0.42));
      ctx.strokeStyle = secMeta.colorHex || '#2DD4BF';
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      // Top-left
      ctx.moveTo(hsx - br, hsy - br + arm);
      ctx.lineTo(hsx - br, hsy - br);
      ctx.lineTo(hsx - br + arm, hsy - br);
      // Top-right
      ctx.moveTo(hsx + br - arm, hsy - br);
      ctx.lineTo(hsx + br, hsy - br);
      ctx.lineTo(hsx + br, hsy - br + arm);
      // Bottom-left
      ctx.moveTo(hsx - br, hsy + br - arm);
      ctx.lineTo(hsx - br, hsy + br);
      ctx.lineTo(hsx - br + arm, hsy + br);
      // Bottom-right
      ctx.moveTo(hsx + br - arm, hsy + br);
      ctx.lineTo(hsx + br, hsy + br);
      ctx.lineTo(hsx + br, hsy + br - arm);
      ctx.stroke();

      // Prepare text fields: Source Badge + Velocity + [Click · 1–5] + 1-Line Humanized Title
      const originLabel = hSig.originFeedName || (hSig.isDemoSeed ? '72h Seed' : hSig.source);
      const rawVel = hSig.engagementVelocity?.badgeText
        ? hSig.engagementVelocity.badgeText
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, '')
            .replace(/\s+/g, ' ')
            .trim()
        : '';
      const hasRealVel =
        Boolean(rawVel) &&
        ((hSig.engagementVelocity?.likesOrUps ?? 0) > 0 ||
          (hSig.engagementVelocity?.commentsOrReplies ?? 0) > 0 ||
          (hSig.engagementVelocity?.velocityPerHour ?? 0) > 0);
      const velTag = hasRealVel ? rawVel : `${hSig.readiness} · M${hSig.mass.toFixed(1)}`;
      const hintTag = 'Click · 1–5';

      const baseTitle = isPlainMode
        ? hSig.literacy?.plainFullTitle || hSig.title
        : hSig.title;
      const humanizedTitle = truncateCleanOneLine(
        stripReticleOriginPrefix(baseTitle, hSig.originFeedName, hSig.source),
        60
      );

      ctx.font = '600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
      const topLeftText = `${originLabel} · ${velTag}`;
      const topW = 12 + ctx.measureText(topLeftText).width + 14 + ctx.measureText(hintTag).width + 14;

      ctx.font = '600 11.5px ui-sans-serif, system-ui, -apple-system, sans-serif';
      const titleW = ctx.measureText(humanizedTitle).width;

      const cardW = Math.min(
        Math.max(236, Math.ceil(Math.max(topW, titleW) + 22)),
        Math.max(240, rightSafeLimit - 16)
      );
      const cardH = 44;

      // Place to the right of the orb unless near right boundary or Signal Rail
      const rawCardX =
        hsx + br + 12 + cardW <= rightSafeLimit ? hsx + br + 12 : hsx - br - 12 - cardW;
      const cardX = Math.max(16, Math.min(rightSafeLimit - cardW, rawCardX));
      const cardY = Math.max(60, Math.min(cssH - cardH - 54, hsy - cardH * 0.5));

      // Smoked-Obsidian #09090B surface + crisp hairline border
      ctx.fillStyle = 'rgba(9, 9, 11, 0.94)';
      ctx.beginPath();
      ctx.roundRect(cardX, cardY, cardW, cardH, 7);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Left 2.5px sector accent bar
      ctx.fillStyle = secMeta.colorHex || '#2DD4BF';
      ctx.fillRect(cardX, cardY + 5, 2.5, cardH - 10);

      // Row 1: Colored Dot + Origin Badge + Engagement Velocity + [Click · 1–5] Hint Pill
      const row1Y = cardY + 13;
      ctx.beginPath();
      ctx.arc(cardX + 10, row1Y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = hSig.isDemoSeed ? '#FBBF24' : '#2DD4BF';
      ctx.fill();

      ctx.font = '600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#E4E4E7';
      ctx.fillText(originLabel, cardX + 16, row1Y);
      const originW = ctx.measureText(originLabel).width;

      ctx.fillStyle = '#2DD4BF';
      ctx.fillText(` · ${velTag}`, cardX + 16 + originW, row1Y);

      // Right-aligned [Click · 1–5] keycap badge
      const hintW = ctx.measureText(hintTag).width + 10;
      const hintX = cardX + cardW - hintW - 7;
      ctx.fillStyle = 'rgba(39, 39, 42, 0.92)';
      ctx.beginPath();
      ctx.roundRect(hintX, row1Y - 7, hintW, 14, 3.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.stroke();
      ctx.fillStyle = '#A1A1AA';
      ctx.fillText(hintTag, hintX + 5, row1Y);

      // Row 2: 1-Line Humanized Title
      ctx.font = '600 11.5px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#F4F4F5';
      ctx.fillText(humanizedTitle, cardX + 10, cardY + 31);

      ctx.restore();
    }
  }

  ctx.restore();
}
