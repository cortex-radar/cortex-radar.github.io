import { MAX_NODES, MAX_TETHERS, NODE_STRIDE, SECTORS, TETHER_STRIDE } from './types';

// Single contiguous Float32Array packet layout for zero-copy Worker <-> Main transfer
export const HEADER_FLOATS = 16;
// [0] nodeCount
// [1] tetherCount
// [2] liveTrailCount
// [3] simTimeSec
// [4] playheadEpochSec (divided by 1000 cleanly or offset from baseEpochMs)
// [5] hoveredNodeIdx (-1 if none)
// [6] collideNodeA (-1 if none)
// [7] collideNodeB (-1 if none)
// [8] coreSnapHoverIdx (-1 if none)
// [9] workerStepDurationMs
// [10] cursorStasisStrength (0..1)
// [11] latestShockwaveX
// [12] latestShockwaveY
// [13] latestShockwaveSector (-1 if none this frame)
// [14] latestShockwaveMass
// [15] activeVisibleNodeCount

export const ATTRACTOR_STRIDE = 4; // [x, y, massSum, pulseGlow]
export const ATTRACTOR_COUNT = SECTORS.length; // 8
export const ATTRACTOR_FLOATS = ATTRACTOR_COUNT * ATTRACTOR_STRIDE; // 32

export const NODE_OFFSET = HEADER_FLOATS + ATTRACTOR_FLOATS; // 48
export const NODE_FLOATS = MAX_NODES * NODE_STRIDE; // 512 * 16 = 8192

export const TETHER_OFFSET = NODE_OFFSET + NODE_FLOATS; // 8240
export const TETHER_FLOATS = MAX_TETHERS * TETHER_STRIDE; // 1024 * 10 = 10240

// Live inbound comet trails: up to 32 active inbound trails, each [nodeIdx, sectorIdx, alpha, x0,y0 ... x11,y11] = 27 floats
export const MAX_LIVE_TRAILS = 32;
export const TRAIL_POINTS = 12;
export const TRAIL_STRIDE = 3 + TRAIL_POINTS * 2; // 27
export const TRAIL_OFFSET = TETHER_OFFSET + TETHER_FLOATS; // 18480
export const TRAIL_FLOATS = MAX_LIVE_TRAILS * TRAIL_STRIDE; // 864

export const TOTAL_PACKET_FLOATS = TRAIL_OFFSET + TRAIL_FLOATS; // 19344 floats (~77.3 KB)
