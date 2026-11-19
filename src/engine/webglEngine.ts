import {
  ATTRACTOR_COUNT,
  ATTRACTOR_STRIDE,
  HEADER_FLOATS,
  NODE_OFFSET,
  TETHER_OFFSET,
} from '../../shared/frameLayout';
import { MAX_NODES, MAX_TETHERS, NODE_STRIDE, SECTORS, TETHER_STRIDE } from '../../shared/types';

export interface ActiveShockwave {
  x: number;
  y: number;
  birthTimeSec: number;
  sectorIdx: number;
  intensity: number;
}

export interface WebGLDiagnostics {
  initialized: boolean;
  renderer: string;
  glErrorCount: number;
  lastError: string;
  shaderCompileOk: boolean;
  fboComplete: boolean;
  drawCallsLastFrame: number;
}

const MAX_SHOCKWAVES = 12;
const TETHER_SEGMENTS = 20; // 20 quad segments per curved Bezier tether = 42 vertices in TRIANGLE_STRIP

const FULLSCREEN_VERT = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  // Single oversized triangle covering [-1, 1]^2 with zero seam
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FABRIC_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform vec2 u_cam;
uniform float u_zoom;
uniform float u_time;
uniform vec4 u_cursor; // [worldX, worldY, stasisStrength, active]
uniform vec4 u_attractors[8]; // [x, y, massSum, pulseGlow]
uniform vec3 u_sectorColors[8];
uniform vec4 u_shockwaves[12]; // [x, y, ageSec, intensity]
uniform float u_shockSector[12];

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 screenPx = v_uv * u_resolution;
  vec2 centeredPx = vec2(screenPx.x - u_resolution.x * 0.5, (1.0 - v_uv.y) * u_resolution.y - u_resolution.y * 0.5);
  vec2 world = centeredPx / u_zoom + u_cam;

  // Deep orbital cosmos base gradient
  float radialVig = length((v_uv - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0));
  vec3 col = mix(vec3(0.022, 0.048, 0.098), vec3(0.008, 0.016, 0.038), clamp(radialVig * 0.95, 0.0, 1.0));

  // Subtle multi-layer parallax starfield dust
  vec2 starGrid = floor(world * 0.045);
  vec2 starLocal = fract(world * 0.045) - 0.5;
  float h = hash21(starGrid);
  if (h > 0.92) {
    vec2 offset = vec2(fract(h * 17.3) - 0.5, fract(h * 31.7) - 0.5) * 0.6;
    float d = length(starLocal - offset);
    float twinkle = 0.65 + 0.35 * sin(u_time * 2.3 + h * 40.0);
    col += vec3(0.45, 0.72, 1.0) * smoothstep(0.09, 0.0, d) * 0.38 * twinkle;
  }

  // Gravitational Potential Field from 8 Sector Attractors + Central Synthesis Core
  float potential = 0.0;
  vec3 spectralTint = vec3(0.0);
  float tintWeight = 0.001;

  // Central Synthesis Core well at (0, 0)
  float dCore = length(world);
  potential += 18.0 / sqrt(dCore * dCore + 7200.0);
  float coreRing = smoothstep(3.5, 0.0, abs(dCore - 92.0));
  col += vec3(0.0, 0.78, 0.95) * coreRing * (0.20 + 0.08 * sin(u_time * 3.2));

  for (int i = 0; i < 8; i++) {
    vec2 aPos = u_attractors[i].xy;
    float aMass = max(4.0, u_attractors[i].z);
    float pulse = u_attractors[i].w;
    float d = length(world - aPos);
    float well = (aMass * 2.6 + 14.0) / sqrt(d * d + 14500.0);
    potential += well;
    float w = 1.0 / (d * d * 0.00008 + 1.0);
    spectralTint += u_sectorColors[i] * w * (1.0 + pulse * 1.4);
    tintWeight += w;
  }
  spectralTint /= tintWeight;

  // Relativistic Topographic Potential Isolines
  float isoPhase = potential * 26.0 - u_time * 0.12;
  float isoFract = abs(fract(isoPhase) - 0.5) * 2.0;
  float lineAA = fwidth(isoPhase) * 1.5 + 0.015;
  float isoLine = 1.0 - smoothstep(0.0, lineAA, isoFract);
  col += spectralTint * isoLine * 0.16;

  // Subtle Polar Coordinate Tactical Grid around Origin
  float rOrigin = length(world);
  float orbitGuide = smoothstep(2.6 / u_zoom, 0.0, abs(rOrigin - 530.0));
  col += vec3(0.16, 0.38, 0.62) * orbitGuide * 0.24;

  // Cursor Cryogenic Stasis Field Aura
  if (u_cursor.w > 0.5 && u_cursor.z > 0.05) {
    float dc = length(world - u_cursor.xy);
    float stasisShell = smoothstep(215.0, 175.0, dc) * (1.0 - smoothstep(175.0, 0.0, dc) * 0.72);
    float stasisRim = smoothstep(3.5 / u_zoom, 0.0, abs(dc - 195.0));
    col += vec3(0.0, 0.75, 0.95) * (stasisShell * 0.055 + stasisRim * 0.22) * u_cursor.z;
  }

  // Live Expanding Relativistic Shockwave Rings + Aerospace Refractive DEFCON Ripples
  float pxWorld = 1.0 / max(u_zoom, 0.28);
  for (int s = 0; s < 12; s++) {
    float age = u_shockwaves[s].z;
    float inten = u_shockwaves[s].w;
    bool isDefcon = u_shockSector[s] > 50.0;
    float maxAge = isDefcon ? 3.5 : 2.4;
    if (age >= 0.0 && age < maxAge && inten > 0.01) {
      float progress = clamp(age / maxAge, 0.0, 1.0);
      float maxR = isDefcon ? 1720.0 : 540.0;
      float radius = 22.0 + (1.0 - pow(1.0 - progress, 2.35)) * maxR;
      float distFromCenter = length(world - u_shockwaves[s].xy);
      // Smooth exponential decay over 3.5s (never stays bright or loops)
      float env = exp(-3.35 * progress) * (1.0 - progress) * clamp(inten, 0.0, 1.0);

      if (isDefcon) {
        // Razor-thin 1.5px-2.5px refractive gravitational wavefronts with subtle chromatic fringe (capped <= 0.26 so HDR bloom never blows out)
        float halfW1 = 1.95 * pxWorld;
        float halfW2 = 1.55 * pxWorld;
        float halfW3 = 1.35 * pxWorld;
        float ds1 = abs(distFromCenter - radius);
        float ds2 = abs(distFromCenter - radius * 0.88);
        float ds3 = abs(distFromCenter - radius * 0.75);
        float w1 = exp(-(ds1 * ds1) / max(1e-4, halfW1 * halfW1));
        float w2 = exp(-(ds2 * ds2) / max(1e-4, halfW2 * halfW2));
        float w3 = exp(-(ds3 * ds3) / max(1e-4, halfW3 * halfW3));
        vec3 defconRipple =
            vec3(0.98, 0.91, 0.70) * w1 * 0.25
          + vec3(0.18, 0.84, 0.78) * w2 * 0.19
          + vec3(0.96, 0.72, 0.30) * w3 * 0.14;
        col += min(vec3(0.26), defconRipple * env);
      } else {
        float halfW = 1.85 * pxWorld;
        float ds = abs(distFromCenter - radius);
        float wave = exp(-(ds * ds) / max(1e-4, halfW * halfW)) * env;
        int secId = clamp(int(u_shockSector[s] + 0.5), 0, 7);
        vec3 secRipple = mix(u_sectorColors[secId], vec3(0.88, 0.97, 1.0), 0.32) * wave * 0.24;
        col += min(vec3(0.24), secRipple);
      }
    }
  }

  fragColor = vec4(col, 1.0);
}
`;

const TETHER_VERT = `#version 300 es
precision highp float;

// Instanced attributes from tether buffer (stride = 10 floats)
layout(location = 0) in vec4 a_ends;     // [x1, y1, x2, y2]
layout(location = 1) in vec2 a_ctrl;     // [cx, cy]
layout(location = 2) in vec4 a_meta;     // [sectorIdx, strength, phase, visibleAlpha]

uniform vec2 u_resolution;
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec3 u_sectorColors[8];

out float v_t;
out float v_side;
out float v_strength;
out float v_phase;
out float v_alpha;
out vec3 v_color;

vec2 evalBezier(vec2 p0, vec2 c, vec2 p1, float t) {
  float inv = 1.0 - t;
  return inv * inv * p0 + 2.0 * inv * t * c + t * t * p1;
}

void main() {
  int segIdx = gl_VertexID >> 1;
  float side = (gl_VertexID & 1) == 0 ? -1.0 : 1.0;
  float t = float(segIdx) / float(${TETHER_SEGMENTS});

  vec2 p = evalBezier(a_ends.xy, a_ctrl, a_ends.zw, t);
  float dt = 0.02;
  vec2 pNext = evalBezier(a_ends.xy, a_ctrl, a_ends.zw, min(1.0, t + dt));
  vec2 dir = normalize(pNext - p + vec2(1e-4, 0.0));
  vec2 normal = vec2(-dir.y, dir.x);

  float widthWorld = mix(2.2, 5.2, a_meta.y) / max(u_zoom, 0.35);
  vec2 worldPos = p + normal * side * widthWorld;

  vec2 screenPx = (worldPos - u_cam) * u_zoom + u_resolution * 0.5;
  vec2 ndc = vec2(
    (screenPx.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (screenPx.y / u_resolution.y) * 2.0
  );

  int sIdx = clamp(int(a_meta.x + 0.5), 0, 7);
  v_color = u_sectorColors[sIdx];
  v_t = t;
  v_side = side;
  v_strength = a_meta.y;
  v_phase = a_meta.z;
  v_alpha = a_meta.w;

  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

const TETHER_FRAG = `#version 300 es
precision highp float;
in float v_t;
in float v_side;
in float v_strength;
in float v_phase;
in float v_alpha;
in vec3 v_color;
out vec4 fragColor;

uniform float u_time;

void main() {
  if (v_alpha < 0.02) discard;
  float coreProfile = exp(-v_side * v_side * 3.6);
  // Travelling directional photon packets along causal filament
  float wave = pow(0.5 + 0.5 * sin(v_t * 16.0 - u_time * 4.2 + v_phase), 5.0);
  float endFade = sin(v_t * 3.14159265);
  float energy = coreProfile * (0.28 + wave * 0.85) * v_strength * (0.35 + 0.65 * endFade) * v_alpha;
  vec3 col = mix(v_color, vec3(0.95, 0.99, 1.0), wave * 0.5);
  fragColor = vec4(col * energy, energy);
}
`;

const NODE_VERT = `#version 300 es
precision highp float;

// Instanced attributes from node buffer (stride = 16 floats = 4 vec4s)
layout(location = 0) in vec4 a_posVel;   // [x, y, vx, vy]
layout(location = 1) in vec4 a_core;     // [radius, sectorIdx, mass, birthGlow]
layout(location = 2) in vec4 a_flags;    // [isLiveInbound, trailStrength, readinessCode, riskCode]
layout(location = 3) in vec4 a_interact; // [hoverHeat, clientRel, isCollider, visibleAlpha]

uniform vec2 u_resolution;
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec3 u_sectorColors[8];

out vec2 v_quad;
out vec3 v_color;
out vec4 v_core;
out vec4 v_flags;
out vec4 v_interact;

void main() {
  vec2 corner = vec2((gl_VertexID & 1) == 0 ? -1.0 : 1.0, (gl_VertexID & 2) == 0 ? -1.0 : 1.0);
  v_quad = corner;

  // Expand quad generously for glow corona + JWST collider spikes + Supernova multi-ring corona
  float superBoost = a_interact.z > 1.5 ? 0.95 : 0.0;
  float haloScale = 2.6 + superBoost + a_core.w * 0.9 + a_interact.x * 0.45;
  vec2 worldPos = a_posVel.xy + corner * a_core.x * haloScale;

  vec2 screenPx = (worldPos - u_cam) * u_zoom + u_resolution * 0.5;
  vec2 ndc = vec2(
    (screenPx.x / u_resolution.x) * 2.0 - 1.0,
    1.0 - (screenPx.y / u_resolution.y) * 2.0
  );

  int sIdx = clamp(int(a_core.y + 0.5), 0, 7);
  v_color = u_sectorColors[sIdx];
  v_core = a_core;
  v_flags = a_flags;
  v_interact = a_interact;

  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

const NODE_FRAG = `#version 300 es
precision highp float;

in vec2 v_quad;
in vec3 v_color;
in vec4 v_core;     // [radius, sectorIdx, mass, birthGlow]
in vec4 v_flags;    // [isLiveInbound, trailStrength, readinessCode, riskCode]
in vec4 v_interact; // [hoverHeat, clientRel, isCollider, visibleAlpha]
out vec4 fragColor;

uniform float u_time;

void main() {
  float visAlpha = v_interact.w;
  if (visAlpha < 0.02) discard;

  float superBoost = v_interact.z > 1.5 ? 0.95 : 0.0;
  float haloScale = 2.6 + superBoost + v_core.w * 0.9 + v_interact.x * 0.45;
  vec2 p = v_quad * haloScale; // p in [-haloScale, haloScale]; core body radius = 1.0
  float r = length(p);
  float ang = atan(p.y, p.x);

  // 1. Relativistic incandescent core + corona
  float innerCore = exp(-r * r * 5.2);
  float corona = exp(-r * 1.65) * 0.62;
  float lumBoost = (0.75 + v_interact.y * 0.35) * (1.0 + v_core.w * 0.9 + v_interact.x * 0.45);

  vec3 col = mix(v_color, vec3(1.0, 0.99, 1.0), clamp(innerCore * 1.15, 0.0, 1.0)) * (innerCore * 1.35 + corona);

  // 2. Enterprise Production Readiness Orbital Ring at r = 0.92
  float readiness = v_flags.z;
  float ringDist = abs(r - 0.95);
  float ringBand = smoothstep(0.11, 0.015, ringDist);
  if (readiness < 0.5) {
    // GA: Crisp solid orbital ring
    col += v_color * ringBand * 0.85;
  } else if (readiness < 1.5) {
    // PREVIEW: Rotating 6-arc harmonic ring
    float dash = smoothstep(-0.1, 0.25, sin(ang * 6.0 - u_time * 2.4));
    col += mix(v_color, vec3(1.0, 0.82, 0.3), 0.35) * ringBand * dash * 0.9;
  } else {
    // RESEARCH: Dual quantum interference halo
    float qRing2 = smoothstep(0.09, 0.01, abs(r - 1.18));
    float shimmer = 0.55 + 0.45 * sin(ang * 10.0 + u_time * 3.5);
    col += v_color * (ringBand * 0.55 + qRing2 * shimmer * 0.65);
  }

  // 3. Governance / Security High-Risk Crimson Corona Prominence
  if (v_flags.w > 1.5) {
    float riskFlare = smoothstep(0.14, 0.01, abs(r - 1.28)) * (0.5 + 0.5 * sin(ang * 4.0 + u_time * 4.5));
    col += vec3(1.0, 0.24, 0.38) * riskFlare * 0.85;
  }

  // 4. JWST 4-Point Axial Diffraction Spikes for Collider-Capable Model/Engine Nodes!
  if (v_interact.z > 0.5) {
    float spikeX = exp(-abs(p.y) * 14.0) * exp(-abs(p.x) * 1.15);
    float spikeY = exp(-abs(p.x) * 14.0) * exp(-abs(p.y) * 1.15);
    col += mix(v_color, vec3(0.92, 0.98, 1.0), 0.6) * (spikeX + spikeY) * (0.58 + v_interact.x * 0.5);
  }

  // 5. Live Inbound Orbital Drop Twin-Beacon Halo (distinguishes live drops from 72h seed!)
  if (v_flags.x > 0.5) {
    float livePulseR = 1.38 + 0.22 * fract(u_time * 0.85);
    float liveBeacon = smoothstep(0.12, 0.01, abs(r - livePulseR)) * (1.0 - fract(u_time * 0.85));
    float innerLive = smoothstep(0.09, 0.01, abs(r - 1.35));
    col += vec3(0.25, 1.0, 0.92) * (liveBeacon * 1.25 + innerLive * 0.55 * v_flags.y);
  }

  // 6. Cross-Platform SUPERNOVA Multi-Ring Accretion Corona + 8-Ray Starburst Flare!
  if (v_interact.z > 1.5) {
    bool isDefconSupernova = v_interact.z > 2.5;
    float outerAccretion = smoothstep(0.13, 0.012, abs(r - 1.72)) * (0.65 + 0.35 * sin(ang * 8.0 - u_time * 3.8));
    float innerAccretion = smoothstep(0.10, 0.01, abs(r - 1.44)) * (0.7 + 0.3 * cos(ang * 5.0 + u_time * 4.2));
    vec2 rotP = vec2(p.x * 0.7071 - p.y * 0.7071, p.x * 0.7071 + p.y * 0.7071);
    float diagSpikes = (exp(-abs(rotP.y) * 16.0) * exp(-abs(rotP.x) * 1.05) + exp(-abs(rotP.x) * 16.0) * exp(-abs(rotP.y) * 1.05));
    vec3 novaTint = isDefconSupernova ? vec3(1.0, 0.84, 0.28) : vec3(0.45, 0.96, 1.0);
    col += novaTint * (outerAccretion * 1.35 + innerAccretion * 0.95 + diagSpikes * 0.72);
  }

  // 7. Hover / Selection Magnetic Lock Ring
  if (v_interact.x > 0.05) {
    float selRing = smoothstep(0.09, 0.01, abs(r - 1.52));
    col += vec3(0.92, 0.98, 1.0) * selRing * v_interact.x * 0.95;
  }

  col *= lumBoost * visAlpha;
  float alpha = clamp((innerCore + corona + ringBand * 0.6) * visAlpha, 0.0, 1.0);
  if (col.r + col.g + col.b < 0.006) discard;

  fragColor = vec4(col, alpha);
}
`;

const BLOOM_BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2 u_texelStep;
uniform float u_threshold;

void main() {
  vec3 sum = vec3(0.0);
  float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);

  vec3 c0 = texture(u_tex, v_uv).rgb;
  if (u_threshold > 0.0) {
    float l0 = max(max(c0.r, c0.g), c0.b);
    c0 *= smoothstep(u_threshold, u_threshold + 0.45, l0);
  }
  sum += c0 * weights[0];

  for (int i = 1; i < 5; i++) {
    vec2 off = u_texelStep * float(i) * 1.65;
    vec3 cp = texture(u_tex, v_uv + off).rgb;
    vec3 cn = texture(u_tex, v_uv - off).rgb;
    if (u_threshold > 0.0) {
      float lp = max(max(cp.r, cp.g), cp.b);
      float ln = max(max(cn.r, cn.g), cn.b);
      cp *= smoothstep(u_threshold, u_threshold + 0.45, lp);
      cn *= smoothstep(u_threshold, u_threshold + 0.45, ln);
    }
    sum += (cp + cn) * weights[i];
  }

  fragColor = vec4(sum, 1.0);
}
`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_sceneTex;
uniform sampler2D u_bloomTex;

vec3 acesFilm(vec3 x) {
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec3 scene = texture(u_sceneTex, v_uv).rgb;
  vec3 bloom = texture(u_bloomTex, v_uv).rgb;
  vec3 combined = scene + bloom * 0.82;
  vec3 mapped = acesFilm(combined * 1.08);
  // Gamma-friendly crisp contrast
  mapped = pow(mapped, vec3(0.95));
  fragColor = vec4(mapped, 1.0);
}
`;

interface FboTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export class SpatialWebGLEngine {
  private gl: WebGL2RenderingContext;
  private width = 1;
  private height = 1;
  private dpr = 1;

  private emptyVao: WebGLVertexArrayObject;
  private tetherVao: WebGLVertexArrayObject;
  private nodeVao: WebGLVertexArrayObject;
  private tetherVbo: WebGLBuffer;
  private nodeVbo: WebGLBuffer;

  private fabricProg: WebGLProgram;
  private tetherProg: WebGLProgram;
  private nodeProg: WebGLProgram;
  private blurProg: WebGLProgram;
  private compProg: WebGLProgram;

  private sceneFbo: FboTarget | null = null;
  private bloomFboA: FboTarget | null = null;
  private bloomFboB: FboTarget | null = null;

  private sectorColorFlat = new Float32Array(24);
  private shockwaveUniforms = new Float32Array(MAX_SHOCKWAVES * 4);
  private shockSectorUniforms = new Float32Array(MAX_SHOCKWAVES);
  private shockwaves: ActiveShockwave[] = [];

  public diagnostics: WebGLDiagnostics = {
    initialized: false,
    renderer: 'unknown',
    glErrorCount: 0,
    lastError: 'NONE',
    shaderCompileOk: true,
    fboComplete: false,
    drawCallsLastFrame: 0,
  };

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true, // Ensures crisp DevTools screenshots & instant compositing
    });
    if (!gl) {
      throw new Error('WebGL2 unavailable on this browser/GPU.');
    }
    this.gl = gl;

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.diagnostics.renderer = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));

    SECTORS.forEach((s, i) => {
      this.sectorColorFlat[i * 3] = s.rgb[0];
      this.sectorColorFlat[i * 3 + 1] = s.rgb[1];
      this.sectorColorFlat[i * 3 + 2] = s.rgb[2];
    });

    this.fabricProg = this.createProgram(FULLSCREEN_VERT, FABRIC_FRAG, 'fabric');
    this.tetherProg = this.createProgram(TETHER_VERT, TETHER_FRAG, 'tether');
    this.nodeProg = this.createProgram(NODE_VERT, NODE_FRAG, 'node');
    this.blurProg = this.createProgram(FULLSCREEN_VERT, BLOOM_BLUR_FRAG, 'bloomBlur');
    this.compProg = this.createProgram(FULLSCREEN_VERT, COMPOSITE_FRAG, 'composite');

    this.emptyVao = gl.createVertexArray()!;

    // Setup Instanced Tether VAO (stride = 10 floats = 40 bytes)
    this.tetherVao = gl.createVertexArray()!;
    this.tetherVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.tetherVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tetherVbo);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_TETHERS * TETHER_STRIDE * 4, gl.DYNAMIC_DRAW);

    const tBytes = TETHER_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, tBytes, 0);
    gl.vertexAttribDivisor(0, 1);

    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, tBytes, 16);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, tBytes, 24);
    gl.vertexAttribDivisor(2, 1);

    // Setup Instanced Node VAO (stride = 16 floats = 64 bytes)
    this.nodeVao = gl.createVertexArray()!;
    this.nodeVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.nodeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeVbo);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_NODES * NODE_STRIDE * 4, gl.DYNAMIC_DRAW);

    const nBytes = NODE_STRIDE * 4;
    for (let loc = 0; loc < 4; loc++) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, nBytes, loc * 16);
      gl.vertexAttribDivisor(loc, 1);
    }

    gl.bindVertexArray(null);

    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
    this.checkGlErrors('init');
    this.diagnostics.initialized = true;
  }

  private compileShader(type: number, src: string, label: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || 'Unknown shader compile error';
      this.diagnostics.shaderCompileOk = false;
      this.diagnostics.lastError = `${label}: ${log}`;
      console.error(`[WebGL2 Shader Error // ${label}]`, log);
      throw new Error(log);
    }
    return sh;
  }

  private createProgram(vsSrc: string, fsSrc: string, label: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vsSrc, `${label}.vert`);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc, `${label}.frag`);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) || 'Unknown program link error';
      this.diagnostics.shaderCompileOk = false;
      this.diagnostics.lastError = `${label} link: ${log}`;
      console.error(`[WebGL2 Link Error // ${label}]`, log);
      throw new Error(log);
    }
    return prog;
  }

  private createFbo(w: number, h: number): FboTarget {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    this.diagnostics.fboComplete = status === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { fbo, tex, w, h };
  }

  private destroyFbo(target: FboTarget | null): void {
    if (!target) return;
    this.gl.deleteFramebuffer(target.fbo);
    this.gl.deleteTexture(target.tex);
  }

  public resize(cssW: number, cssH: number): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.floor(cssW * this.dpr));
    const h = Math.max(2, Math.floor(cssH * this.dpr));
    if (w === this.width && h === this.height && this.sceneFbo) return;

    this.width = w;
    this.height = h;
    const canvas = this.gl.canvas as HTMLCanvasElement;
    canvas.width = w;
    canvas.height = h;

    this.destroyFbo(this.sceneFbo);
    this.destroyFbo(this.bloomFboA);
    this.destroyFbo(this.bloomFboB);

    const bw = Math.max(2, Math.floor(w * 0.5));
    const bh = Math.max(2, Math.floor(h * 0.5));
    this.sceneFbo = this.createFbo(w, h);
    this.bloomFboA = this.createFbo(bw, bh);
    this.bloomFboB = this.createFbo(bw, bh);
  }

  public addShockwave(x: number, y: number, sectorIdx: number, intensity: number, simTimeSec: number): void {
    this.shockwaves.unshift({ x, y, birthTimeSec: simTimeSec, sectorIdx, intensity });
    if (this.shockwaves.length > MAX_SHOCKWAVES) {
      this.shockwaves.length = MAX_SHOCKWAVES;
    }
  }

  public checkGlErrors(stage: string): void {
    const err = this.gl.getError();
    if (err !== this.gl.NO_ERROR) {
      this.diagnostics.glErrorCount++;
      this.diagnostics.lastError = `${stage}:0x${err.toString(16)}`;
    }
  }

  public renderFrame(
    packet: Float32Array,
    camX: number,
    camY: number,
    zoom: number,
    cursorWorldX: number,
    cursorWorldY: number,
    cursorActive: boolean
  ): void {
    const gl = this.gl;
    if (!this.sceneFbo || !this.bloomFboA || !this.bloomFboB) return;

    const nodeCount = Math.min(MAX_NODES, packet[0] | 0);
    const tetherCount = Math.min(MAX_TETHERS, packet[1] | 0);
    const simTimeSec = packet[3];
    const stasisStrength = packet[10];
    const shockSec = packet[13];

    if (shockSec >= 0) {
      // Consume immediately so high-refresh monitors (120Hz/144Hz) never spawn duplicate rings from one worker packet
      packet[13] = -1;
      const clampedInten = shockSec > 50 ? 1.0 : Math.min(1.0, Math.max(0.45, packet[14] * 0.25));
      this.addShockwave(packet[11], packet[12], shockSec, clampedInten, simTimeSec);
    }

    // Update shockwave uniform arrays (zero allocations)
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const sw = this.shockwaves[i];
      if (sw) {
        const age = simTimeSec - sw.birthTimeSec;
        const maxAge = sw.sectorIdx > 50 ? 3.5 : 2.4;
        this.shockwaveUniforms[i * 4] = sw.x;
        this.shockwaveUniforms[i * 4 + 1] = sw.y;
        this.shockwaveUniforms[i * 4 + 2] = age;
        this.shockwaveUniforms[i * 4 + 3] = age >= 0 && age < maxAge ? sw.intensity : 0;
        this.shockSectorUniforms[i] = sw.sectorIdx;
      } else {
        this.shockwaveUniforms[i * 4 + 2] = 99.0;
        this.shockwaveUniforms[i * 4 + 3] = 0.0;
        this.shockSectorUniforms[i] = 0;
      }
    }

    const effZoom = zoom * this.dpr;
    let draws = 0;

    // =========================================================================
    // PASS 1: Render Spacetime Fabric + Instanced Tethers + Instanced Nodes -> sceneFbo
    // =========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo.fbo);
    gl.viewport(0, 0, this.sceneFbo.w, this.sceneFbo.h);
    gl.disable(gl.BLEND);

    // 1A: Spacetime Potential Fabric
    gl.useProgram(this.fabricProg);
    gl.uniform2f(gl.getUniformLocation(this.fabricProg, 'u_resolution'), this.width, this.height);
    gl.uniform2f(gl.getUniformLocation(this.fabricProg, 'u_cam'), camX, camY);
    gl.uniform1f(gl.getUniformLocation(this.fabricProg, 'u_zoom'), effZoom);
    gl.uniform1f(gl.getUniformLocation(this.fabricProg, 'u_time'), simTimeSec);
    gl.uniform4f(
      gl.getUniformLocation(this.fabricProg, 'u_cursor'),
      cursorWorldX,
      cursorWorldY,
      stasisStrength,
      cursorActive ? 1.0 : 0.0
    );
    gl.uniform4fv(
      gl.getUniformLocation(this.fabricProg, 'u_attractors'),
      packet.subarray(HEADER_FLOATS, HEADER_FLOATS + ATTRACTOR_COUNT * ATTRACTOR_STRIDE)
    );
    gl.uniform3fv(gl.getUniformLocation(this.fabricProg, 'u_sectorColors'), this.sectorColorFlat);
    gl.uniform4fv(gl.getUniformLocation(this.fabricProg, 'u_shockwaves'), this.shockwaveUniforms);
    gl.uniform1fv(gl.getUniformLocation(this.fabricProg, 'u_shockSector'), this.shockSectorUniforms);

    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    draws++;

    // Enable Additive Energy Blending for Tethers & Relativistic Nodes
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    // 1B: Instanced Quadratic Bezier Causal Filaments
    if (tetherCount > 0) {
      gl.useProgram(this.tetherProg);
      gl.uniform2f(gl.getUniformLocation(this.tetherProg, 'u_resolution'), this.width, this.height);
      gl.uniform2f(gl.getUniformLocation(this.tetherProg, 'u_cam'), camX, camY);
      gl.uniform1f(gl.getUniformLocation(this.tetherProg, 'u_zoom'), effZoom);
      gl.uniform1f(gl.getUniformLocation(this.tetherProg, 'u_time'), simTimeSec);
      gl.uniform3fv(gl.getUniformLocation(this.tetherProg, 'u_sectorColors'), this.sectorColorFlat);

      gl.bindVertexArray(this.tetherVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tetherVbo);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        packet.subarray(TETHER_OFFSET, TETHER_OFFSET + tetherCount * TETHER_STRIDE)
      );
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (TETHER_SEGMENTS + 1) * 2, tetherCount);
      draws++;
    }

    // 1C: Instanced Relativistic Signal Mass Nodes
    if (nodeCount > 0) {
      gl.useProgram(this.nodeProg);
      gl.uniform2f(gl.getUniformLocation(this.nodeProg, 'u_resolution'), this.width, this.height);
      gl.uniform2f(gl.getUniformLocation(this.nodeProg, 'u_cam'), camX, camY);
      gl.uniform1f(gl.getUniformLocation(this.nodeProg, 'u_zoom'), effZoom);
      gl.uniform1f(gl.getUniformLocation(this.nodeProg, 'u_time'), simTimeSec);
      gl.uniform3fv(gl.getUniformLocation(this.nodeProg, 'u_sectorColors'), this.sectorColorFlat);

      gl.bindVertexArray(this.nodeVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.nodeVbo);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        packet.subarray(NODE_OFFSET, NODE_OFFSET + nodeCount * NODE_STRIDE)
      );
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nodeCount);
      draws++;
    }

    // =========================================================================
    // PASS 2: Half-Resolution Separable HDR Bloom (Horizontal + Vertical)
    // =========================================================================
    gl.disable(gl.BLEND);
    gl.useProgram(this.blurProg);
    gl.bindVertexArray(this.emptyVao);

    // Horizontal + Bright Threshold
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFboA.fbo);
    gl.viewport(0, 0, this.bloomFboA.w, this.bloomFboA.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFbo.tex);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, 'u_tex'), 0);
    gl.uniform2f(gl.getUniformLocation(this.blurProg, 'u_texelStep'), 1.0 / this.bloomFboA.w, 0.0);
    gl.uniform1f(gl.getUniformLocation(this.blurProg, 'u_threshold'), 0.42);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    draws++;

    // Vertical Blur
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFboB.fbo);
    gl.viewport(0, 0, this.bloomFboB.w, this.bloomFboB.h);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomFboA.tex);
    gl.uniform2f(gl.getUniformLocation(this.blurProg, 'u_texelStep'), 0.0, 1.0 / this.bloomFboB.h);
    gl.uniform1f(gl.getUniformLocation(this.blurProg, 'u_threshold'), 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    draws++;

    // =========================================================================
    // PASS 3: ACES Filmic Composite to Screen Backbuffer
    // =========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.compProg);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFbo.tex);
    gl.uniform1i(gl.getUniformLocation(this.compProg, 'u_sceneTex'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomFboB.tex);
    gl.uniform1i(gl.getUniformLocation(this.compProg, 'u_bloomTex'), 1);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    draws++;

    gl.bindVertexArray(null);
    this.diagnostics.drawCallsLastFrame = draws;
  }

  public dispose(): void {
    const gl = this.gl;
    this.destroyFbo(this.sceneFbo);
    this.destroyFbo(this.bloomFboA);
    this.destroyFbo(this.bloomFboB);
    gl.deleteBuffer(this.tetherVbo);
    gl.deleteBuffer(this.nodeVbo);
    gl.deleteVertexArray(this.emptyVao);
    gl.deleteVertexArray(this.tetherVao);
    gl.deleteVertexArray(this.nodeVao);
    gl.deleteProgram(this.fabricProg);
    gl.deleteProgram(this.tetherProg);
    gl.deleteProgram(this.nodeProg);
    gl.deleteProgram(this.blurProg);
    gl.deleteProgram(this.compProg);
  }
}
