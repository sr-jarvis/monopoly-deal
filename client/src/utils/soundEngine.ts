/**
 * Monopoly Deal WebAudio Sound Engine
 * Synthesizes sound effects using WebAudio API oscillators, gain nodes, and envelopes.
 * Zero external audio dependencies.
 */

const MUTE_KEY = 'md_sound_muted';

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlockBound = false;
let muted = readStoredMute();
const listeners = new Set<(muted: boolean) => void>();
const lastPlayed = new Map<string, number>();

function readStoredMute(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function getAudio(): { ctx: AudioContext; master: GainNode } | null {
  if (muted) return null;
  if (typeof window === 'undefined') return null;

  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35; // Global headroom
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
      return null;
    }
  }

  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }

  return master ? { ctx, master } : null;
}

export function unlockAudio(): void {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;

  const kick = () => {
    getAudio();
  };

  ['pointerdown', 'keydown', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, kick, { once: true, passive: true });
  });
}

export function isMuted(): boolean {
  return muted;
}

export function subscribeMute(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setMuted(next: boolean): void {
  if (next === muted) return;
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* Ignore private mode storage errors */
  }

  if (ctx && master) {
    if (next) {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    } else {
      master.gain.setTargetAtTime(0.35, ctx.currentTime, 0.01);
    }
  }

  listeners.forEach((fn) => fn(muted));
}

export function toggleMute(): boolean {
  setMuted(!muted);
  return muted;
}

function throttle(key: string, ms: number): boolean {
  const now = Date.now();
  const prev = lastPlayed.get(key) || 0;
  if (now - prev < ms) return true;
  lastPlayed.set(key, now);
  return false;
}

interface ToneOptions {
  type?: OscillatorType;
  freq: number;
  glideTo?: number;
  at?: number;
  dur: number;
  gain?: number;
  detune?: number;
}

function playTone(audio: { ctx: AudioContext; master: GainNode }, opts: ToneOptions) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  const t0 = audio.ctx.currentTime + (opts.at || 0);
  const osc = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();

  osc.type = opts.type || 'sine';
  osc.frequency.setValueAtTime(opts.freq, t0);

  if (opts.glideTo) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(opts.glideTo, 1), t0 + opts.dur);
  }

  if (opts.detune) {
    osc.detune.value = opts.detune;
  }

  const peak = opts.gain || 0.4;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);

  osc.connect(g);
  g.connect(audio.master);

  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);

  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
}

interface NoiseOptions {
  at?: number;
  dur: number;
  gain?: number;
  cutoff?: number;
  type?: BiquadFilterType;
}

function playNoise(audio: { ctx: AudioContext; master: GainNode }, opts: NoiseOptions) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  const t0 = audio.ctx.currentTime + (opts.at || 0);
  const bufferSize = audio.ctx.sampleRate * opts.dur;
  const buffer = audio.ctx.createBuffer(1, bufferSize, audio.ctx.sampleRate);
  const output = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  const whiteNoise = audio.ctx.createBufferSource();
  whiteNoise.buffer = buffer;

  const filter = audio.ctx.createBiquadFilter();
  filter.type = opts.type || 'lowpass';
  filter.frequency.setValueAtTime(opts.cutoff || 1000, t0);

  const g = audio.ctx.createGain();
  const peak = opts.gain || 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);

  whiteNoise.connect(filter);
  filter.connect(g);
  g.connect(audio.master);

  whiteNoise.start(t0);
  whiteNoise.stop(t0 + opts.dur + 0.01);

  whiteNoise.onended = () => {
    whiteNoise.disconnect();
    filter.disconnect();
    g.disconnect();
  };
}

// Sound Synthesizers

export function playCardDraw(): void {
  if (throttle('draw', 50)) return;
  const audio = getAudio();
  if (!audio) return;

  // Crisp card slide noise + pop
  playNoise(audio, { at: 0, dur: 0.04, cutoff: 2200, type: 'bandpass', gain: 0.25 });
  playNoise(audio, { at: 0.05, dur: 0.03, cutoff: 2800, type: 'bandpass', gain: 0.2 });
  playTone(audio, { type: 'sine', freq: 1400, glideTo: 900, at: 0.01, dur: 0.04, gain: 0.2 });
}

export function playCardPlay(): void {
  if (throttle('play', 45)) return;
  const audio = getAudio();
  if (!audio) return;

  // Snap thwack
  playNoise(audio, { at: 0, dur: 0.055, cutoff: 1200, gain: 0.35 });
  playTone(audio, { type: 'square', freq: 220, glideTo: 110, at: 0, dur: 0.07, gain: 0.2 });
}

export function playMoneyBank(): void {
  if (throttle('bank', 80)) return;
  const audio = getAudio();
  if (!audio) return;

  // Ascending coin chime: C5 (523Hz), E5 (659Hz), G5 (784Hz), C6 (1047Hz)
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, idx) => {
    playTone(audio, { type: 'triangle', freq, at: idx * 0.06, dur: 0.18, gain: 0.3 });
  });
  playTone(audio, { type: 'sine', freq: 2093, at: 0.22, dur: 0.25, gain: 0.2 });
}

export function playCardFlip(): void {
  if (throttle('flip', 80)) return;
  const audio = getAudio();
  if (!audio) return;

  // Paper whoosh + snap click
  playNoise(audio, { at: 0, dur: 0.08, cutoff: 1800, gain: 0.25 });
  playTone(audio, { type: 'triangle', freq: 780, glideTo: 1200, at: 0.03, dur: 0.05, gain: 0.3 });
}

export function playRentDemand(): void {
  if (throttle('demand', 150)) return;
  const audio = getAudio();
  if (!audio) return;

  // Dissonant low alert pulses
  playTone(audio, { type: 'sawtooth', freq: 110, detune: -18, at: 0, dur: 0.26, gain: 0.3 });
  playTone(audio, { type: 'sawtooth', freq: 110, detune: 18, at: 0, dur: 0.26, gain: 0.3 });
  playTone(audio, { type: 'sawtooth', freq: 110, detune: -18, at: 0.28, dur: 0.26, gain: 0.3 });
}

export function playRentPayment(): void {
  if (throttle('payment', 150)) return;
  const audio = getAudio();
  if (!audio) return;

  // Coin payout sequence
  const pairs = [
    { at: 0, f1: 1318, f2: 1567 },
    { at: 0.06, f1: 1567, f2: 1760 },
    { at: 0.12, f1: 1760, f2: 2093 }
  ];
  pairs.forEach(({ at, f1, f2 }) => {
    playTone(audio, { type: 'sine', freq: f1, at, dur: 0.09, gain: 0.25 });
    playTone(audio, { type: 'sine', freq: f2, at: at + 0.02, dur: 0.09, gain: 0.2 });
  });
}

export function playBuilding(): void {
  if (throttle('building', 100)) return;
  const audio = getAudio();
  if (!audio) return;

  // Solid construction thump
  playNoise(audio, { at: 0, dur: 0.09, cutoff: 800, gain: 0.4 });
  playTone(audio, { type: 'sine', freq: 120, glideTo: 45, at: 0, dur: 0.1, gain: 0.4 });
  playTone(audio, { type: 'square', freq: 440, at: 0.08, dur: 0.04, gain: 0.2 });
}

export function playTurnStart(): void {
  if (throttle('turn', 200)) return;
  const audio = getAudio();
  if (!audio) return;

  // Gentle turn notification chime (880Hz / 1175Hz)
  playTone(audio, { type: 'sine', freq: 880, at: 0, dur: 0.15, gain: 0.2 });
  playTone(audio, { type: 'sine', freq: 1175, at: 0.1, dur: 0.2, gain: 0.25 });
}

export function playWin(): void {
  if (throttle('win', 500)) return;
  const audio = getAudio();
  if (!audio) return;

  // Celebratory victory fanfare: G4 -> C5 -> E5 -> G5 -> C-major chord
  const arpeggio = [392, 523.25, 659.25, 783.99];
  arpeggio.forEach((freq, idx) => {
    playTone(audio, { type: 'triangle', freq, at: idx * 0.1, dur: 0.3, gain: 0.35 });
  });

  // Final sustained C-major chord (C5, E5, G5, C6)
  const chord = [523.25, 659.25, 783.99, 1046.5];
  chord.forEach((freq) => {
    playTone(audio, { type: 'sine', freq, at: 0.45, dur: 0.9, gain: 0.25 });
  });
}

export function playCounterShield(): void {
  if (throttle('shield', 100)) return;
  const audio = getAudio();
  if (!audio) return;

  // Metallic forcefield deflection resonance
  playTone(audio, { type: 'sawtooth', freq: 880, detune: -7, at: 0, dur: 0.18, gain: 0.3 });
  playTone(audio, { type: 'sawtooth', freq: 1320, detune: 7, at: 0, dur: 0.18, gain: 0.25 });
  playNoise(audio, { at: 0, dur: 0.06, cutoff: 3500, type: 'bandpass', gain: 0.35 });
  playTone(audio, { type: 'sine', freq: 1760, glideTo: 2200, at: 0.05, dur: 0.22, gain: 0.25 });
}

export function playActionBlocked(): void {
  if (throttle('blocked', 120)) return;
  const audio = getAudio();
  if (!audio) return;

  // Descending negation thud
  playTone(audio, { type: 'triangle', freq: 320, glideTo: 90, at: 0, dur: 0.32, gain: 0.35 });
  playNoise(audio, { at: 0.02, dur: 0.08, cutoff: 800, gain: 0.3 });
}

export function playToast(): void {
  if (throttle('toast', 100)) return;
  const audio = getAudio();
  if (!audio) return;

  // Soft glass pop
  playTone(audio, { type: 'sine', freq: 1568, at: 0, dur: 0.1, gain: 0.22 });
  playTone(audio, { type: 'sine', freq: 3136, at: 0, dur: 0.06, gain: 0.1 });
}

export function triggerEventSound(summary: string): void {
  const s = summary.toLowerCase();
  if (s.includes('just say no') || s.includes('blocked') || s.includes('countered')) {
    playCounterShield();
  } else if (s.includes('paid') || s.includes('payment')) {
    playRentPayment();
  } else if (s.includes('rent') || s.includes('collector') || s.includes('birthday') || s.includes('owe')) {
    playRentDemand();
  } else if (s.includes('house') || s.includes('hotel') || s.includes('building')) {
    playBuilding();
  } else if (s.includes('bank')) {
    playMoneyBank();
  } else if (s.includes('drew') || s.includes('draw')) {
    playCardDraw();
  } else if (s.includes('played') || s.includes('stole') || s.includes('swapped') || s.includes('rearranged') || s.includes('discarded')) {
    playCardPlay();
  } else {
    playToast();
  }
}
