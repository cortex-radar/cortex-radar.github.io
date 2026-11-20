/// <reference lib="webworker" />
import {
  ATTRACTOR_COUNT,
  ATTRACTOR_STRIDE,
  HEADER_FLOATS,
  MAX_LIVE_TRAILS,
  NODE_OFFSET,
  TETHER_OFFSET,
  TOTAL_PACKET_FLOATS,
  TRAIL_OFFSET,
  TRAIL_POINTS,
  TRAIL_STRIDE,
} from '../../shared/frameLayout';
import {
  CLIENT_INDUSTRIES,
  ClientIndustry,
  MAX_NODES,
  MAX_TETHERS,
  NODE_STRIDE,
  SECTOR_BY_ID,
  SECTORS,
  SpatialSignal,
  TETHER_STRIDE,
} from '../../shared/types';

declare const self: DedicatedWorkerGlobalScope;

let nodeCount = 0;
const nodeIds: string[] = new Array(MAX_NODES).fill('');
const idToIndex = new Map<string, number>();

const posX = new Float32Array(MAX_NODES);
const posY = new Float32Array(MAX_NODES);
const velX = new Float32Array(MAX_NODES);
const velY = new Float32Array(MAX_NODES);
const massArr = new Float32Array(MAX_NODES);
const baseRadius = new Float32Array(MAX_NODES);
const primarySec = new Uint8Array(MAX_NODES);
const secWeightB = new Int8Array(MAX_NODES).fill(-1);
const secWeightC = new Int8Array(MAX_NODES).fill(-1);
const publishedEpochSec = new Float64Array(MAX_NODES);
const spawnSimSec = new Float32Array(MAX_NODES);
const birthGlow = new Float32Array(MAX_NODES);
const isLiveFlag = new Uint8Array(MAX_NODES);
const isDemoSeedFlag = new Uint8Array(MAX_NODES);
const hiddenBySourceFilter = new Uint8Array(MAX_NODES);
const readinessArr = new Uint8Array(MAX_NODES);
const riskArr = new Uint8Array(MAX_NODES);
const hoverHeat = new Float32Array(MAX_NODES);
const clientRel = new Float32Array(MAX_NODES).fill(1.0);
const isCollider = new Uint8Array(MAX_NODES);
const visAlpha = new Float32Array(MAX_NODES).fill(1.0);
const spotlightAlpha = new Float32Array(MAX_NODES).fill(1.0);
const spotlightMatch = new Uint8Array(MAX_NODES);
const dimByNewFilter = new Uint8Array(MAX_NODES);
let spotlightActive = false;
let spotlightDimLevel = 0.15;

let causalEdgeCount = 0;
const edgeSrc = new Uint16Array(MAX_TETHERS);
const edgeDst = new Uint16Array(MAX_TETHERS);
const edgeSector = new Uint8Array(MAX_TETHERS);
const edgeBaseStrength = new Float32Array(MAX_TETHERS);

let liveTrailNodeCount = 0;
const liveTrailNodeIndices = new Uint16Array(MAX_LIVE_TRAILS);
const trailHistX = new Float32Array(MAX_LIVE_TRAILS * TRAIL_POINTS);
const trailHistY = new Float32Array(MAX_LIVE_TRAILS * TRAIL_POINTS);
let trailSampleTick = 0;

const GRID_CELL = 110;
const GRID_BUCKETS = 256;
const cellHeads = new Int32Array(GRID_BUCKETS);
const nextInCell = new Int32Array(MAX_NODES);

const attrX = new Float32Array(ATTRACTOR_COUNT);
const attrY = new Float32Array(ATTRACTOR_COUNT);
const attrMass = new Float32Array(ATTRACTOR_COUNT);
const attrPulse = new Float32Array(ATTRACTOR_COUNT);

const packetPool: Float32Array[] = [
  new Float32Array(TOTAL_PACKET_FLOATS),
  new Float32Array(TOTAL_PACKET_FLOATS),
  new Float32Array(TOTAL_PACKET_FLOATS),
];

let simTimeSec = 0;
let orbitPhaseRad = 0;
let activeClient: ClientIndustry = 'BANKING';
let showDemoSeed = true;
let selectedNodeIdx = -1;
let hoveredNodeIdx = -1;
let draggedNodeIdx = -1;
let dragWorldX = 0;
let dragWorldY = 0;

let cursorWorldX = 99999;
let cursorWorldY = 99999;
let cursorSpeedWorld = 0;
let cursorActive = false;
let cursorDwellSec = 0;

let baseNowMs = Date.now();
let isTimeWarpPlaying = false;
let timeWarpSpeedMultiplier = 60;
let playheadMs = baseNowMs;
let isPinnedToLive = true;

let pendingShockX = 0;
let pendingShockY = 0;
let pendingShockSector = -1;
let pendingShockMass = 0;

function computeClientRelevanceForSector(secIdx: number, ind: ClientIndustry): number {
  const meta = CLIENT_INDUSTRIES.find((c) => c.id === ind);
  if (!meta) return 1.0;
  const secId = SECTORS[secIdx]?.id;
  const rank = meta.prioritySectors.indexOf(secId);
  if (rank === 0) return 1.54;
  if (rank === 1) return 1.34;
  if (rank >= 2) return 1.15;
  return 0.52;
}

function refreshClientRelevanceAll(): void {
  for (let i = 0; i < nodeCount; i++) {
    let rel = computeClientRelevanceForSector(primarySec[i], activeClient);
    if (secWeightB[i] >= 0) {
      rel = Math.max(rel, computeClientRelevanceForSector(secWeightB[i], activeClient) * 0.9);
    }
    clientRel[i] = rel;
  }
}

function updateAttractors(dt: number): void {
  orbitPhaseRad += dt * 0.02;
  const metaInd = CLIENT_INDUSTRIES.find((c) => c.id === activeClient);
  for (let s = 0; s < ATTRACTOR_COUNT; s++) {
    const meta = SECTORS[s];
    const ang = meta.orbitAngleRad + orbitPhaseRad;
    // Priority client sectors physically contract slightly inward toward Core!
    const isTopClientSec = metaInd ? metaInd.prioritySectors.indexOf(meta.id) >= 0 : false;
    const radScale = isTopClientSec ? 0.93 : 1.05;
    const r = meta.orbitRadius * radScale;
    attrX[s] = Math.cos(ang) * r;
    attrY[s] = Math.sin(ang) * (r * 0.7); // Framed cleanly for 16:9 clear-sky band
    attrMass[s] = 0;
    attrPulse[s] = Math.max(0, attrPulse[s] - dt * 1.35);
  }
}

function applyRadialShockwave(cx: number, cy: number, strengthMass: number, secIdx: number): void {
  pendingShockX = cx;
  pendingShockY = cy;
  pendingShockSector = secIdx;
  pendingShockMass = strengthMass;
  if (secIdx >= 0 && secIdx < ATTRACTOR_COUNT) {
    attrPulse[secIdx] = 1.0;
  }

  for (let i = 0; i < nodeCount; i++) {
    if (visAlpha[i] < 0.1) continue;
    const dx = posX[i] - cx;
    const dy = posY[i] - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > 4 && d2 < 160000) {
      const dist = Math.sqrt(d2);
      const impulse = (strengthMass * 1050) / (dist + 55);
      velX[i] += (dx / dist) * impulse;
      velY[i] += (dy / dist) * impulse;
    }
  }
}

function addSignalNode(sig: SpatialSignal, initialPlacement: boolean): void {
  if (idToIndex.has(sig.id) || nodeCount >= MAX_NODES) return;
  const idx = nodeCount++;
  nodeIds[idx] = sig.id;
  idToIndex.set(sig.id, idx);

  const pMeta = SECTOR_BY_ID[sig.primarySector] || SECTORS[0];
  primarySec[idx] = pMeta.index;
  secWeightB[idx] = sig.secondarySectors[0] ? SECTOR_BY_ID[sig.secondarySectors[0]].index : -1;
  secWeightC[idx] = sig.secondarySectors[1] ? SECTOR_BY_ID[sig.secondarySectors[1]].index : -1;

  massArr[idx] = sig.mass;
  const engBoost = Math.min(3.5, Math.log10((sig.engagementVelocity?.likesOrUps ?? 0) + 1) * 1.15);
  baseRadius[idx] = 7.4 + sig.mass * 3.8 + engBoost;
  publishedEpochSec[idx] = sig.publishedAtMs * 0.001;
  spawnSimSec[idx] = simTimeSec;
  isDemoSeedFlag[idx] = sig.isDemoSeed ? 1 : 0;
  readinessArr[idx] = sig.readiness === 'GA' ? 0 : sig.readiness === 'PREVIEW' ? 1 : 2;
  riskArr[idx] = sig.risk === 'LOW' ? 0 : sig.risk === 'MODERATE' ? 1 : 2;
  isCollider[idx] =
    sig.supernovaLevel && sig.supernovaLevel >= 2
      ? 3
      : sig.isSupernova
      ? 2
      : sig.modelSpecs
      ? 1
      : 0;
  clientRel[idx] = computeClientRelevanceForSector(pMeta.index, activeClient);

  const targetAng = pMeta.orbitAngleRad + orbitPhaseRad;
  const targetX = Math.cos(targetAng) * pMeta.orbitRadius;
  const targetY = Math.sin(targetAng) * (pMeta.orbitRadius * 0.7);

  if (initialPlacement) {
    const golden = idx * 2.3999632;
    const spread = 40 + ((idx * 31) % 128);
    let spawnX = targetX + Math.cos(golden) * spread;
    let spawnY = targetY + Math.sin(golden) * spread;

    if (secWeightB[idx] >= 0) {
      const bMeta = SECTORS[secWeightB[idx]];
      const bAng = bMeta.orbitAngleRad + orbitPhaseRad;
      const bx = Math.cos(bAng) * bMeta.orbitRadius;
      const by = Math.sin(bAng) * (bMeta.orbitRadius * 0.7);
      spawnX = spawnX * 0.75 + bx * 0.25;
      spawnY = spawnY * 0.75 + by * 0.25;
    }

    posX[idx] = spawnX;
    posY[idx] = spawnY;
    velX[idx] = -Math.sin(golden) * 5;
    velY[idx] = Math.cos(golden) * 5;
    birthGlow[idx] = sig.isLiveInbound ? 0.55 : 0.0;
    isLiveFlag[idx] = sig.isLiveInbound ? 1 : 0;
    visAlpha[idx] = sig.isDemoSeed && !showDemoSeed ? 0.0 : 1.0;
  } else {
    // Live inbound hyperbolic comet trajectory!
    const entryAngle = targetAng - 0.52;
    const entryDist = 960;
    const sx = Math.cos(entryAngle) * entryDist;
    const sy = Math.sin(entryAngle) * (entryDist * 0.74);
    posX[idx] = sx;
    posY[idx] = sy;

    const dx = targetX - sx;
    const dy = targetY - sy;
    const dist = Math.hypot(dx, dy) || 1;
    velX[idx] = (dx / dist) * 285 - (dy / dist) * 110;
    velY[idx] = (dy / dist) * 285 + (dx / dist) * 110;

    birthGlow[idx] = 1.0;
    isLiveFlag[idx] = 1;
    visAlpha[idx] = 1.0;

    const tSlot = liveTrailNodeCount % MAX_LIVE_TRAILS;
    if (liveTrailNodeCount < MAX_LIVE_TRAILS) liveTrailNodeCount++;
    liveTrailNodeIndices[tSlot] = idx;
    const base = tSlot * TRAIL_POINTS;
    for (let k = 0; k < TRAIL_POINTS; k++) {
      trailHistX[base + k] = sx;
      trailHistY[base + k] = sy;
    }

    applyRadialShockwave(targetX * 0.75, targetY * 0.75, sig.mass, pMeta.index);
  }

  if (sig.causalTargetIds && sig.causalTargetIds.length > 0) {
    for (const targetId of sig.causalTargetIds) {
      const targetIdx = idToIndex.get(targetId);
      if (targetIdx !== undefined && causalEdgeCount < MAX_TETHERS - 32) {
        edgeSrc[causalEdgeCount] = idx;
        edgeDst[causalEdgeCount] = targetIdx;
        edgeSector[causalEdgeCount] = pMeta.index;
        edgeBaseStrength[causalEdgeCount] = 0.58;
        causalEdgeCount++;
      }
    }
  } else if (nodeCount > 3 && causalEdgeCount < MAX_TETHERS - 32) {
    let bestPeer = -1;
    let bestMass = -1;
    for (let j = 0; j < idx; j++) {
      if ((primarySec[j] === primarySec[idx] || primarySec[j] === secWeightB[idx]) && massArr[j] > bestMass) {
        bestMass = massArr[j];
        bestPeer = j;
      }
    }
    if (bestPeer >= 0) {
      edgeSrc[causalEdgeCount] = idx;
      edgeDst[causalEdgeCount] = bestPeer;
      edgeSector[causalEdgeCount] = pMeta.index;
      edgeBaseStrength[causalEdgeCount] = 0.68;
      causalEdgeCount++;
    }
  }
}

function stepPhysics(dt: number): void {
  const t0 = performance.now();
  simTimeSec += dt;
  trailSampleTick++;

  if (isTimeWarpPlaying) {
    const prevPlayheadSec = playheadMs * 0.001;
    playheadMs += dt * 90_000 * timeWarpSpeedMultiplier;
    const now = Date.now();
    if (playheadMs >= now) {
      playheadMs = now;
      isTimeWarpPlaying = false;
      isPinnedToLive = true;
      self.postMessage({ type: 'TIMEWARP_REACHED_LIVE', playheadMs });
    }
    const newPlayheadSec = playheadMs * 0.001;

    for (let i = 0; i < nodeCount; i++) {
      if ((isDemoSeedFlag[i] === 1 && !showDemoSeed) || hiddenBySourceFilter[i] === 1) continue;
      const pub = publishedEpochSec[i];
      if (pub > prevPlayheadSec && pub <= newPlayheadSec) {
        birthGlow[i] = 1.0;
        applyRadialShockwave(posX[i], posY[i], massArr[i] * 0.8, primarySec[i]);
      }
    }
  } else if (isPinnedToLive) {
    playheadMs = Date.now();
  }

  const playheadSec = playheadMs * 0.001;
  updateAttractors(dt);

  let stasisStrength = 0;
  if (cursorActive) {
    if (cursorSpeedWorld < 480) {
      cursorDwellSec = Math.min(2.0, cursorDwellSec + dt);
      stasisStrength = Math.min(1.0, 0.35 + cursorDwellSec * 1.4);
    } else {
      cursorDwellSec = Math.max(0, cursorDwellSec - dt * 3.0);
      stasisStrength = 0;
    }
  } else {
    cursorDwellSec = 0;
  }

  cellHeads.fill(-1);
  for (let i = 0; i < nodeCount; i++) {
    const quarantined = (isDemoSeedFlag[i] === 1 && !showDemoSeed) || hiddenBySourceFilter[i] === 1;
    const isBorn = !quarantined && publishedEpochSec[i] <= playheadSec;
    const targetVis = isBorn ? 1.0 : 0.0;
    visAlpha[i] += (targetVis - visAlpha[i]) * Math.min(1, dt * 10);

    const targetSpot =
      spotlightActive && spotlightMatch[i] === 0
        ? spotlightDimLevel
        : dimByNewFilter[i] === 1
        ? 0.16
        : 1.0;
    spotlightAlpha[i] += (targetSpot - spotlightAlpha[i]) * Math.min(1, dt * 11);

    if (visAlpha[i] < 0.05) continue;

    attrMass[primarySec[i]] += massArr[i] * clientRel[i] * visAlpha[i];

    const gx = Math.floor(posX[i] / GRID_CELL);
    const gy = Math.floor(posY[i] / GRID_CELL);
    const hash = ((gx * 73856093) ^ (gy * 19349663)) & (GRID_BUCKETS - 1);
    nextInCell[i] = cellHeads[hash];
    cellHeads[hash] = i;
  }

  let bestHover = -1;
  let bestHoverDist = 48;
  let collideA = -1;
  let collideB = -1;
  let coreSnapCandidate = -1;

  for (let i = 0; i < nodeCount; i++) {
    if (visAlpha[i] < 0.2) {
      hoverHeat[i] *= 0.85;
      continue;
    }

    if (birthGlow[i] > 0) {
      birthGlow[i] = Math.max(0, birthGlow[i] - dt * 0.38);
    }

    if (i === draggedNodeIdx) {
      let targetDragX = dragWorldX;
      let targetDragY = dragWorldY;

      const distToCore = Math.hypot(dragWorldX, dragWorldY);
      if (distToCore < 92) {
        coreSnapCandidate = i;
        targetDragX = dragWorldX * 0.32;
        targetDragY = dragWorldY * 0.32;
      } else if (isCollider[i] === 1) {
        let nearestCollider = -1;
        let nearestColDist = 112;
        for (let j = 0; j < nodeCount; j++) {
          if (j === i || visAlpha[j] < 0.4 || isCollider[j] === 0) continue;
          const d = Math.hypot(dragWorldX - posX[j], dragWorldY - posY[j]);
          if (d < nearestColDist) {
            nearestColDist = d;
            nearestCollider = j;
          }
        }
        if (nearestCollider >= 0) {
          collideA = i;
          collideB = nearestCollider;
          const ang = Math.atan2(dragWorldY - posY[nearestCollider], dragWorldX - posX[nearestCollider]);
          targetDragX = posX[nearestCollider] + Math.cos(ang) * 44;
          targetDragY = posY[nearestCollider] + Math.sin(ang) * 44;
          velX[nearestCollider] *= 0.2;
          velY[nearestCollider] *= 0.2;
        }
      }

      posX[i] += (targetDragX - posX[i]) * 0.45;
      posY[i] += (targetDragY - posY[i]) * 0.45;
      velX[i] = 0;
      velY[i] = 0;
      hoverHeat[i] = 1.0;
      continue;
    }

    const pSec = primarySec[i];
    const rel = clientRel[i];
    const effMass = massArr[i] * rel;

    let ax = attrX[pSec];
    let ay = attrY[pSec];
    if (secWeightB[i] >= 0) {
      const bSec = secWeightB[i];
      ax = ax * 0.78 + attrX[bSec] * 0.22;
      ay = ay * 0.78 + attrY[bSec] * 0.22;
    }

    // Physical CLIENT GRAVITY: high-relevance industry signals pull inward toward inner priority ring;
    // low-relevance signals drift outward to outer dim parking orbits!
    const gravityAnchorScale = rel > 1.2 ? 0.86 : rel < 0.7 ? 1.16 : 1.0;
    ax *= gravityAnchorScale;
    ay *= gravityAnchorScale;

    const dxA = ax - posX[i];
    const dyA = ay - posY[i];
    const distA = Math.hypot(dxA, dyA) || 1;

    const shellMultiplier = rel > 1.25 ? 0.62 : rel < 0.7 ? 1.52 : 1.0;
    const preferredShell = Math.max(20, (148 - effMass * 20) * shellMultiplier);
    const pullStrength = 1.35 + rel * 0.55;
    const radialDelta = distA - preferredShell;
    let fx = (dxA / distA) * radialDelta * pullStrength;
    let fy = (dyA / distA) * radialDelta * pullStrength;

    const swirlSpeed = 8.5 / (1 + effMass * 0.35);
    fx += (-dyA / distA) * swirlSpeed;
    fy += (dxA / distA) * swirlSpeed;

    const gx = Math.floor(posX[i] / GRID_CELL);
    const gy = Math.floor(posY[i] / GRID_CELL);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const h = (((gx + ox) * 73856093) ^ ((gy + oy) * 19349663)) & (GRID_BUCKETS - 1);
        let j = cellHeads[h];
        while (j !== -1) {
          if (j !== i) {
            const rx = posX[i] - posX[j];
            const ry = posY[i] - posY[j];
            const d2 = rx * rx + ry * ry;
            const minSep = baseRadius[i] + baseRadius[j] + 42;
            if (d2 > 0.01 && d2 < minSep * minSep) {
              const d = Math.sqrt(d2);
              const push = ((minSep - d) / minSep) * 255;
              fx += (rx / d) * push;
              fy += (ry / d) * push;
            }
          }
          j = nextInCell[j];
        }
      }
    }

    const distOrigin = Math.hypot(posX[i], posY[i]);
    if (distOrigin < 112 && distOrigin > 0.1) {
      const pushCore = ((112 - distOrigin) / 112) * 280;
      fx += (posX[i] / distOrigin) * pushCore;
      fy += (posY[i] / distOrigin) * pushCore;
    }

    const dxC = posX[i] - cursorWorldX;
    const dyC = posY[i] - cursorWorldY;
    const distC = Math.hypot(dxC, dyC);

    if (cursorActive && distC < baseRadius[i] + bestHoverDist) {
      const effDist = Math.max(0, distC - baseRadius[i]);
      if (effDist < bestHoverDist) {
        bestHoverDist = effDist;
        bestHover = i;
      }
    }

    let localDamping = 0.912;
    if (cursorActive && distC < 210) {
      if (stasisStrength > 0.15) {
        const falloff = 1 - distC / 210;
        const freeze = 1 - stasisStrength * falloff * 0.84;
        localDamping *= freeze;
        fx *= freeze;
        fy *= freeze;
      } else if (cursorSpeedWorld >= 520 && effMass < 3.5) {
        const wave = (1 - distC / 210) * 140;
        fx += (dxC / (distC || 1)) * wave;
        fy += (dyC / (distC || 1)) * wave;
      }
    }

    velX[i] = (velX[i] + fx * dt) * localDamping;
    velY[i] = (velY[i] + fy * dt) * localDamping;

    const spd = Math.hypot(velX[i], velY[i]);
    if (spd > 420) {
      velX[i] = (velX[i] / spd) * 420;
      velY[i] = (velY[i] / spd) * 420;
    }

    posX[i] += velX[i] * dt;
    posY[i] += velY[i] * dt;

    const isFocused = i === bestHover || i === selectedNodeIdx || i === collideA || i === collideB;
    const targetHeat = isFocused ? 1.0 : 0.0;
    hoverHeat[i] += (targetHeat - hoverHeat[i]) * Math.min(1, dt * 12);
  }

  hoveredNodeIdx = draggedNodeIdx >= 0 ? draggedNodeIdx : bestHover;

  if (trailSampleTick % 2 === 0) {
    for (let t = 0; t < liveTrailNodeCount; t++) {
      const nIdx = liveTrailNodeIndices[t];
      const base = t * TRAIL_POINTS;
      for (let k = TRAIL_POINTS - 1; k > 0; k--) {
        trailHistX[base + k] = trailHistX[base + k - 1];
        trailHistY[base + k] = trailHistY[base + k - 1];
      }
      trailHistX[base] = posX[nIdx];
      trailHistY[base] = posY[nIdx];
    }
  }

  const stepMs = performance.now() - t0;
  emitFramePacket(stepMs, stasisStrength, collideA, collideB, coreSnapCandidate);
}

function emitFramePacket(
  stepMs: number,
  stasisStrength: number,
  collideA: number,
  collideB: number,
  coreSnapCandidate: number
): void {
  const pkt = packetPool.pop();
  if (!pkt) return;

  let visibleNodesNow = 0;

  for (let s = 0; s < ATTRACTOR_COUNT; s++) {
    const off = HEADER_FLOATS + s * ATTRACTOR_STRIDE;
    pkt[off] = attrX[s];
    pkt[off + 1] = attrY[s];
    pkt[off + 2] = attrMass[s];
    pkt[off + 3] = attrPulse[s];
  }

  for (let i = 0; i < nodeCount; i++) {
    const off = NODE_OFFSET + i * NODE_STRIDE;
    if (visAlpha[i] > 0.1) visibleNodesNow++;
    const ageSinceSpawn = simTimeSec - spawnSimSec[i];
    const liveTrailStrength =
      isLiveFlag[i] === 1 ? Math.max(0.42, 1.0 - ageSinceSpawn / 18.0) : 0.0;

    // Orb radius physically swells for high-impact client signals and pulses subtly when < 12h old!
    const clientScale = 0.68 + clientRel[i] * 0.34;
    const ageHrs = Math.max(0, (playheadMs * 0.001 - publishedEpochSec[i]) / 3600);
    const recentPulse = ageHrs <= 12 ? 1 + 0.055 * Math.sin(simTimeSec * 2.8 + i) : 1;

    pkt[off] = posX[i];
    pkt[off + 1] = posY[i];
    pkt[off + 2] = velX[i];
    pkt[off + 3] = velY[i];
    pkt[off + 4] = baseRadius[i] * clientScale * recentPulse * (1 + hoverHeat[i] * 0.22);
    pkt[off + 5] = primarySec[i];
    pkt[off + 6] = massArr[i] * clientRel[i];
    pkt[off + 7] = birthGlow[i];
    pkt[off + 8] = isLiveFlag[i];
    pkt[off + 9] = liveTrailStrength;
    pkt[off + 10] = readinessArr[i];
    pkt[off + 11] = riskArr[i];
    pkt[off + 12] = hoverHeat[i];
    pkt[off + 13] = clientRel[i];
    pkt[off + 14] = isCollider[i];
    pkt[off + 15] = visAlpha[i] * (clientRel[i] < 0.7 ? 0.62 : 1.0) * spotlightAlpha[i];
  }

  let tCount = 0;
  for (let e = 0; e < causalEdgeCount && tCount < MAX_TETHERS; e++) {
    const a = edgeSrc[e];
    const b = edgeDst[e];
    const v = Math.min(visAlpha[a], visAlpha[b]) * Math.min(spotlightAlpha[a], spotlightAlpha[b]);
    if (v < 0.05) continue;

    const isBlastEdge = a === selectedNodeIdx || b === selectedNodeIdx || a === hoveredNodeIdx || b === hoveredNodeIdx;
    const x1 = posX[a];
    const y1 = posY[a];
    const x2 = posX[b];
    const y2 = posY[b];
    const mx = (x1 + x2) * 0.5;
    const my = (y1 + y2) * 0.5;
    const dx = x2 - x1;
    const dy = y2 - y1;

    const off = TETHER_OFFSET + tCount * TETHER_STRIDE;
    pkt[off] = x1;
    pkt[off + 1] = y1;
    pkt[off + 2] = x2;
    pkt[off + 3] = y2;
    pkt[off + 4] = mx - dy * 0.16;
    pkt[off + 5] = my + dx * 0.16;
    pkt[off + 6] = edgeSector[e];
    pkt[off + 7] = isBlastEdge ? 1.0 : edgeBaseStrength[e] * 0.55;
    pkt[off + 8] = (e * 0.77) % 6.283;
    pkt[off + 9] = v;
    tCount++;
  }

  for (let i = 0; i < nodeCount && tCount < MAX_TETHERS; i++) {
    if (visAlpha[i] < 0.1) continue;
    const isSel = i === selectedNodeIdx || i === hoveredNodeIdx;
    const pSec = primarySec[i];

    {
      const off = TETHER_OFFSET + tCount * TETHER_STRIDE;
      const x1 = posX[i];
      const y1 = posY[i];
      const x2 = attrX[pSec];
      const y2 = attrY[pSec];
      pkt[off] = x1;
      pkt[off + 1] = y1;
      pkt[off + 2] = x2;
      pkt[off + 3] = y2;
      pkt[off + 4] = (x1 + x2) * 0.5 + (y2 - y1) * 0.12;
      pkt[off + 5] = (y1 + y2) * 0.5 - (x2 - x1) * 0.12;
      pkt[off + 6] = pSec;
      pkt[off + 7] = isSel ? 0.94 : clientRel[i] > 1.2 ? 0.3 : 0.15;
      pkt[off + 8] = (i * 0.43) % 6.283;
      pkt[off + 9] = visAlpha[i] * spotlightAlpha[i];
      tCount++;
    }

    if ((isSel || massArr[i] >= 3.55) && secWeightB[i] >= 0 && tCount < MAX_TETHERS) {
      const bSec = secWeightB[i];
      const off = TETHER_OFFSET + tCount * TETHER_STRIDE;
      const x1 = posX[i];
      const y1 = posY[i];
      const x2 = attrX[bSec];
      const y2 = attrY[bSec];
      pkt[off] = x1;
      pkt[off + 1] = y1;
      pkt[off + 2] = x2;
      pkt[off + 3] = y2;
      pkt[off + 4] = (x1 + x2) * 0.5 - (y2 - y1) * 0.18;
      pkt[off + 5] = (y1 + y2) * 0.5 + (x2 - x1) * 0.18;
      pkt[off + 6] = bSec;
      pkt[off + 7] = isSel ? 0.96 : 0.28;
      pkt[off + 8] = (i * 1.13) % 6.283;
      pkt[off + 9] = visAlpha[i] * spotlightAlpha[i];
      tCount++;
    }
  }

  let activeTrails = 0;
  for (let t = 0; t < liveTrailNodeCount; t++) {
    const nIdx = liveTrailNodeIndices[t];
    const age = simTimeSec - spawnSimSec[nIdx];
    if (age > 24 || visAlpha[nIdx] < 0.1) continue;
    const off = TRAIL_OFFSET + activeTrails * TRAIL_STRIDE;
    pkt[off] = nIdx;
    pkt[off + 1] = primarySec[nIdx];
    pkt[off + 2] = Math.max(0, 1 - age / 24) * visAlpha[nIdx];
    const base = t * TRAIL_POINTS;
    for (let k = 0; k < TRAIL_POINTS; k++) {
      pkt[off + 3 + k * 2] = trailHistX[base + k];
      pkt[off + 3 + k * 2 + 1] = trailHistY[base + k];
    }
    activeTrails++;
  }

  pkt[0] = nodeCount;
  pkt[1] = tCount;
  pkt[2] = activeTrails;
  pkt[3] = simTimeSec;
  pkt[4] = playheadMs - baseNowMs;
  pkt[5] = hoveredNodeIdx;
  pkt[6] = collideA;
  pkt[7] = collideB;
  pkt[8] = coreSnapCandidate;
  pkt[9] = stepMs;
  pkt[10] = stasisStrength;
  pkt[11] = pendingShockX;
  pkt[12] = pendingShockY;
  pkt[13] = pendingShockSector;
  pkt[14] = pendingShockMass;
  pkt[15] = visibleNodesNow;

  pendingShockSector = -1;
  self.postMessage({ type: 'FRAME', buffer: pkt.buffer }, [pkt.buffer]);
}

let isSimulationPaused = false;

setInterval(() => {
  if (isSimulationPaused) return;
  stepPhysics(1 / 60);
}, 1000 / 60);

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'SET_PAUSED': {
      const nextPaused = Boolean(msg.paused);
      isSimulationPaused = nextPaused;
      if (!nextPaused) {
        stepPhysics(1 / 60);
      }
      break;
    }
    case 'RETURN_BUFFER': {
      if (msg.buffer instanceof ArrayBuffer) {
        packetPool.push(new Float32Array(msg.buffer));
      }
      break;
    }
    case 'HYDRATE_SEED': {
      baseNowMs = msg.baseNowMs || Date.now();
      playheadMs = baseNowMs;
      updateAttractors(0);
      const signals = msg.signals as SpatialSignal[];
      for (const s of signals) {
        addSignalNode(s, true);
      }
      if (isSimulationPaused) {
        stepPhysics(1 / 60);
      }
      self.postMessage({ type: 'BASE_EPOCH_SYNC', baseNowMs });
      break;
    }
    case 'HYDRATE_LIVE_BATCH': {
      const signals = msg.signals as SpatialSignal[];
      for (const s of signals) {
        addSignalNode(s, true);
      }
      if (isSimulationPaused) {
        stepPhysics(1 / 60);
      }
      break;
    }
    case 'ADD_LIVE_SIGNAL': {
      const s = msg.signal as SpatialSignal;
      addSignalNode(s, false);
      break;
    }
    case 'SET_SHOW_DEMO_SEED': {
      showDemoSeed = Boolean(msg.show);
      break;
    }
    case 'SET_HIDDEN_SIGNAL_IDS': {
      const hiddenSet = new Set<string>((msg.ids as string[]) || []);
      for (let i = 0; i < nodeCount; i++) {
        hiddenBySourceFilter[i] = hiddenSet.has(nodeIds[i]) ? 1 : 0;
      }
      break;
    }
    case 'SET_DIMMED_SIGNAL_IDS': {
      const dimSet = new Set<string>((msg.ids as string[]) || []);
      for (let i = 0; i < nodeCount; i++) {
        dimByNewFilter[i] = dimSet.has(nodeIds[i]) ? 1 : 0;
      }
      break;
    }
    case 'SET_SPOTLIGHT': {
      spotlightActive = Boolean(msg.active);
      spotlightDimLevel =
        typeof msg.dimLevel === 'number' ? Math.max(0.05, Math.min(1, msg.dimLevel)) : 0.15;
      spotlightMatch.fill(0);
      if (spotlightActive && Array.isArray(msg.matchingIndices)) {
        for (const mIdx of msg.matchingIndices as number[]) {
          if (mIdx >= 0 && mIdx < MAX_NODES) {
            spotlightMatch[mIdx] = 1;
          }
        }
      }
      break;
    }
    case 'BOOST_MASS': {
      const idx = idToIndex.get(msg.id as string);
      if (idx !== undefined) {
        massArr[idx] = Math.min(5.2, massArr[idx] + 0.35);
        baseRadius[idx] = 8.2 + massArr[idx] * 4.2;
        birthGlow[idx] = 0.85;
      }
      break;
    }
    case 'UPGRADE_SUPERNOVA': {
      const idx = idToIndex.get(msg.id as string);
      if (idx !== undefined) {
        const level = Number(msg.supernovaLevel || 1);
        massArr[idx] = Math.min(5.4, Math.max(massArr[idx], Number(msg.mass || 4.8)));
        baseRadius[idx] = 8.5 + massArr[idx] * 4.4;
        isCollider[idx] = level >= 2 ? 3 : 2;
        birthGlow[idx] = 1.0;
        applyRadialShockwave(posX[idx], posY[idx], 4.8, primarySec[idx]);
      }
      break;
    }
    case 'TRIGGER_DEFCON_WAVE': {
      const idx = msg.signalId ? idToIndex.get(msg.signalId as string) : undefined;
      const cx = idx !== undefined ? posX[idx] : 0;
      const cy = idx !== undefined ? posY[idx] : 0;
      for (let s = 0; s < ATTRACTOR_COUNT; s++) {
        attrPulse[s] = 1.0;
      }
      // Sector code 99 triggers the full-viewport Seismic DEFCON Gravitational Wave in FABRIC_FRAG!
      applyRadialShockwave(cx, cy, 9.5, 99);
      break;
    }
    case 'POINTER_MOVE': {
      cursorWorldX = msg.worldX;
      cursorWorldY = msg.worldY;
      cursorSpeedWorld = msg.speedWorld;
      cursorActive = msg.active;
      if (draggedNodeIdx >= 0) {
        dragWorldX = msg.worldX;
        dragWorldY = msg.worldY;
      }
      break;
    }
    case 'DRAG_START': {
      draggedNodeIdx = msg.nodeIndex;
      dragWorldX = msg.worldX;
      dragWorldY = msg.worldY;
      break;
    }
    case 'DRAG_END': {
      if (draggedNodeIdx >= 0) {
        const distCore = Math.hypot(dragWorldX, dragWorldY);
        if (distCore < 92) {
          applyRadialShockwave(0, 0, 4.2, primarySec[draggedNodeIdx]);
          self.postMessage({
            type: 'CORE_DROP_FUSED',
            nodeIndex: draggedNodeIdx,
          });
        }
      }
      draggedNodeIdx = -1;
      break;
    }
    case 'SELECT_NODE': {
      selectedNodeIdx = msg.nodeIndex;
      if (selectedNodeIdx >= 0 && selectedNodeIdx < nodeCount) {
        applyRadialShockwave(posX[selectedNodeIdx], posY[selectedNodeIdx], 2.4, primarySec[selectedNodeIdx]);
      }
      break;
    }
    case 'TRIGGER_BLAST_WAVE': {
      const nIdx = msg.nodeIndex as number;
      const targetSectors = (msg.targetSectors as number[]) || [];
      if (nIdx >= 0 && nIdx < nodeCount) {
        const sx = posX[nIdx];
        const sy = posY[nIdx];
        applyRadialShockwave(sx, sy, 4.2, primarySec[nIdx]);
        targetSectors.forEach((secIdx, step) => {
          setTimeout(() => {
            if (secIdx >= 0 && secIdx < ATTRACTOR_COUNT) {
              applyRadialShockwave(attrX[secIdx], attrY[secIdx], 3.4, secIdx);
            }
          }, (step + 1) * 210);
        });
      }
      break;
    }
    case 'FOCUS_SECTOR_PULSE': {
      const sIdx = msg.sectorIndex as number;
      if (sIdx >= 0 && sIdx < ATTRACTOR_COUNT) {
        applyRadialShockwave(attrX[sIdx], attrY[sIdx], 3.5, sIdx);
      }
      break;
    }
    case 'SET_CLIENT_INDUSTRY': {
      activeClient = msg.industry as ClientIndustry;
      refreshClientRelevanceAll();
      const indMeta = CLIENT_INDUSTRIES.find((c) => c.id === activeClient);
      const leadSec = indMeta ? SECTOR_BY_ID[indMeta.prioritySectors[0]].index : 0;
      applyRadialShockwave(0, 0, 2.8, leadSec);
      break;
    }
    case 'SCRUB_TIMEWARP': {
      isPinnedToLive = false;
      isTimeWarpPlaying = false;
      playheadMs = msg.playheadMs;
      break;
    }
    case 'TOGGLE_TIMEWARP_PLAY': {
      if (msg.playing) {
        if (Date.now() - playheadMs < 2 * 3600_000) {
          playheadMs = Date.now() - 72 * 3600_000;
        }
        isPinnedToLive = false;
        isTimeWarpPlaying = true;
        timeWarpSpeedMultiplier = msg.speedMultiplier || 60;
      } else {
        isTimeWarpPlaying = false;
      }
      break;
    }
    case 'SNAP_TO_LIVE': {
      isTimeWarpPlaying = false;
      isPinnedToLive = true;
      playheadMs = Date.now();
      break;
    }
    case 'LASSO_FUSION_PULSE': {
      applyRadialShockwave(msg.cx || 0, msg.cy || 0, 4.0, 0);
      break;
    }
  }
};
