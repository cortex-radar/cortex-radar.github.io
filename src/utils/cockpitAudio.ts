import type { LiteracyLevel } from '../../shared/types';

const AUDIO_STORAGE_KEY = 'cortex_cockpit_audio_v6';

class CockpitMicroAudioEngine {
  private ctx: AudioContext | null = null;
  private enabled: boolean;
  private lastTickPerfMs = 0;

  constructor() {
    this.enabled = this.readPersistedState();
  }

  private readPersistedState(): boolean {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      return window.localStorage.getItem(AUDIO_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(next: boolean): boolean {
    this.enabled = next;
    try {
      window.localStorage?.setItem(AUDIO_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Ignore storage quota / privacy mode errors
    }
    if (next) {
      this.playScrubberDetentTick(3);
    }
    return this.enabled;
  }

  public toggle(): boolean {
    return this.setEnabled(!this.enabled);
  }

  /**
   * 4ms precision mechanical detent tick when scrubbing L1 -> L5.
   * Slightly steps resonant center frequency per level (L1 warm -> L5 crisp).
   */
  public playScrubberDetentTick(level: LiteracyLevel = 3): void {
    const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowPerf - this.lastTickPerfMs < 18) return;
    this.lastTickPerfMs = nowPerf;

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t0 = ctx.currentTime;
    const durationSec = 0.0045; // ~4.5ms mechanical micro-click
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    const baseFreq = 1150 + (level - 1) * 240;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq * 1.35, t0);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.55, t0 + durationSec);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(baseFreq, t0);
    filter.Q.setValueAtTime(3.2, t0);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.055, t0 + 0.0008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationSec);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t0);
    osc.stop(t0 + durationSec + 0.002);
  }

  /**
   * Soft, airy dual-harmonic lock chime when focusing a regular galaxy orb.
   */
  public playOrbFocusHarmonicChime(sectorIndex = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t0 = ctx.currentTime;
    const lydianRoots = [523.25, 587.33, 659.25, 739.99, 783.99, 880.0, 987.77, 1046.5];
    const root = lydianRoots[Math.abs(sectorIndex) % lydianRoots.length];

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const gain = ctx.createGain();

    oscA.type = 'sine';
    oscB.type = 'triangle';
    oscA.frequency.setValueAtTime(root, t0);
    oscB.frequency.setValueAtTime(root * 1.498, t0); // Perfect fifth harmonic

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.036, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.19);

    oscA.connect(gain);
    oscB.connect(gain);
    gain.connect(ctx.destination);

    oscA.start(t0);
    oscB.start(t0);
    oscA.stop(t0 + 0.2);
    oscB.stop(t0 + 0.2);
  }

  /**
   * Muted, tactile low-frequency sub-harmonic pulse when focusing a multi-network Supernova.
   */
  public playSupernovaFocusPulse(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const t0 = ctx.currentTime;
    const subOsc = ctx.createOscillator();
    const overtoneOsc = ctx.createOscillator();
    const lowpass = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(68, t0);
    subOsc.frequency.exponentialRampToValueAtTime(41, t0 + 0.34);

    overtoneOsc.type = 'triangle';
    overtoneOsc.frequency.setValueAtTime(136, t0);
    overtoneOsc.frequency.exponentialRampToValueAtTime(82, t0 + 0.32);

    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(210, t0);

    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.085, t0 + 0.028);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.36);

    subOsc.connect(lowpass);
    overtoneOsc.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(ctx.destination);

    subOsc.start(t0);
    overtoneOsc.start(t0);
    subOsc.stop(t0 + 0.38);
    overtoneOsc.stop(t0 + 0.38);
  }
}

export const cockpitAudio = new CockpitMicroAudioEngine();
