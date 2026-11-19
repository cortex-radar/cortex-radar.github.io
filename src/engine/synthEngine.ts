import { SECTORS } from '../../shared/types';

export class SpatialAudioSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  public enabled = false;

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) return null;
      this.ctx = new AudioCtor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.16;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public toggle(): boolean {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.ensureContext();
      this.playCalibrationChord();
    }
    return this.enabled;
  }

  public playSectorPing(sectorIdx: number, panNorm = 0): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const freq = SECTORS[sectorIdx]?.harmonicFreqHz || 440;

    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const panner = ctx.createStereoPanner();
    const env = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.498, now + 0.28); // Fifth shimmer

    sub.type = 'triangle';
    sub.frequency.setValueAtTime(freq * 0.5, now);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(480, now + 0.45);

    panner.pan.setValueAtTime(Math.max(-0.9, Math.min(0.9, panNorm)), now);

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.32, now + 0.018);
    env.gain.exponentialRampToValueAtTime(0.0008, now + 0.48);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(env);
    env.connect(panner);
    panner.connect(this.masterGain);

    osc.start(now);
    sub.start(now);
    osc.stop(now + 0.5);
    sub.stop(now + 0.5);
  }

  public playHoverStasisTick(panNorm = 0): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const pan = ctx.createStereoPanner();
    const env = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(980, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.045);

    pan.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, panNorm)), now);

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.09, now + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0008, now + 0.055);

    osc.connect(env);
    env.connect(pan);
    pan.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.06);
  }

  public playFusionReactorChord(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const chord = [261.63, 392.0, 493.88, 587.33]; // Cmaj9 Lydian cosmic lock
    for (const f of chord) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now);

      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.14, now + 0.04);
      env.gain.exponentialRampToValueAtTime(0.0008, now + 0.75);

      osc.connect(env);
      env.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.78);
    }
  }

  public playSeismicDefconSonar(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;

    // 1. Deep Sub-Bass Seismic Gravitational Drop (52Hz -> 27.5Hz LFE)
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(54, now);
    sub.frequency.exponentialRampToValueAtTime(27.5, now + 1.35);

    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.65, now + 0.06);
    subGain.gain.exponentialRampToValueAtTime(0.0008, now + 1.45);

    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 1.5);

    // 2. Dual Crystalline Submarine DEFCON Sonar Pings
    for (const [offsetSec, freq] of [
      [0.02, 880],
      [0.34, 1174.66],
    ] as const) {
      const ping = ctx.createOscillator();
      const pingEnv = ctx.createGain();
      ping.type = 'sine';
      ping.frequency.setValueAtTime(freq, now + offsetSec);
      ping.frequency.exponentialRampToValueAtTime(freq * 0.96, now + offsetSec + 0.55);

      pingEnv.gain.setValueAtTime(0.0001, now + offsetSec);
      pingEnv.gain.linearRampToValueAtTime(0.24, now + offsetSec + 0.015);
      pingEnv.gain.exponentialRampToValueAtTime(0.0008, now + offsetSec + 0.65);

      ping.connect(pingEnv);
      pingEnv.connect(this.masterGain);
      ping.start(now + offsetSec);
      ping.stop(now + offsetSec + 0.68);
    }
  }

  private playCalibrationChord(): void {
    this.playSectorPing(0, -0.3);
    setTimeout(() => this.playSectorPing(2, 0.3), 90);
  }
}
