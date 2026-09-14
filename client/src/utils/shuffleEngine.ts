/**
 * shuffleEngine.ts — Card Shuffle, Deal & Deck Dealer Visual FX Engine.
 *
 * Framework-free core for the Monopoly Deal shuffle overlay. Everything in the
 * top half of this file is pure (no DOM, no timers) so it can be unit tested in
 * plain Node; the stateful `ShuffleEngine` at the bottom wraps that core with
 * scheduling, WebAudio hooks and `CustomEvent` dispatch.
 */

/* ---------------------------------- Types --------------------------------- */

/** Every state the deck can be in. `idle` is the resting state. */
export type ShuffleState = 'idle' | 'riffle' | 'fan' | 'cut' | 'dealing';

/** The animating states — i.e. every `ShuffleState` except `idle`. */
export type ShufflePhase = Exclude<ShuffleState, 'idle'>;

/** User-facing speed presets exposed by the overlay's speed control. */
export type ShuffleSpeed = 'slow' | 'normal' | 'fast' | 'turbo';

/** Why a shuffle was triggered. Surfaced on events for analytics/logging. */
export type ShuffleReason =
  | 'game-setup'
  | 'rematch'
  | 'manual'
  | 'draw'
  | 'deck-recycle';

export interface TimelineSegment {
  phase: ShufflePhase;
  /** Milliseconds from sequence start at which this phase begins. */
  startMs: number;
  durationMs: number;
  /** Milliseconds from sequence start at which this phase ends. */
  endMs: number;
}

export interface ShuffleSnapshot {
  state: ShuffleState;
  phase: ShufflePhase | null;
  speed: ShuffleSpeed;
  reason: ShuffleReason | null;
  /** 0..1 across the whole sequence. */
  progress: number;
  /** Monotonically increasing id, one per `start()` call. */
  runId: number;
  timeline: TimelineSegment[];
  totalDurationMs: number;
}

export interface CardTransform {
  /** Horizontal offset in px, relative to the deck's resting position. */
  x: number;
  /** Vertical offset in px. */
  y: number;
  /** Depth offset in px, drives the 3D stack separation. */
  z: number;
  /** Z-axis rotation in degrees. */
  rotate: number;
  /** Y-axis rotation in degrees — the "card edge catching the light" tilt. */
  tilt: number;
  opacity: number;
}

export interface DealFlight {
  cardIndex: number;
  seatIndex: number;
  delayMs: number;
  durationMs: number;
}

export interface ShuffleStartDetail {
  runId: number;
  reason: ShuffleReason;
  speed: ShuffleSpeed;
  sequence: ShufflePhase[];
  totalDurationMs: number;
}

export interface ShufflePhaseDetail {
  runId: number;
  phase: ShufflePhase;
  index: number;
  durationMs: number;
}

export interface ShuffleEndDetail {
  runId: number;
  reason: ShuffleReason;
  /** True when `cancel()` cut the sequence short. */
  cancelled: boolean;
}

export interface DealDetail {
  runId: number;
  cardCount: number;
  seatCount: number;
  flights: DealFlight[];
  totalDurationMs: number;
}

/* -------------------------------- Constants ------------------------------- */

/** Duration multipliers. Lower is faster. */
export const SHUFFLE_SPEEDS: Readonly<Record<ShuffleSpeed, number>> = Object.freeze({
  slow: 1.6,
  normal: 1,
  fast: 0.6,
  turbo: 0.35,
});

/** Ordered for the overlay's speed cycle button. */
export const SHUFFLE_SPEED_ORDER: readonly ShuffleSpeed[] = Object.freeze([
  'slow',
  'normal',
  'fast',
  'turbo',
]);

/** Base (1x) duration of each phase in milliseconds. */
export const PHASE_BASE_DURATION_MS: Readonly<Record<ShufflePhase, number>> = Object.freeze({
  riffle: 900,
  fan: 700,
  cut: 600,
  dealing: 1200,
});

/** The classic table shuffle: split & riffle, fan out, cut back together. */
export const DEFAULT_SEQUENCE: readonly ShufflePhase[] = Object.freeze([
  'riffle',
  'fan',
  'cut',
]);

/** Shuffle then deal — used at game setup and on rematch. */
export const DEAL_SEQUENCE: readonly ShufflePhase[] = Object.freeze([
  'riffle',
  'fan',
  'cut',
  'dealing',
]);

/** Number of card faces the overlay renders in the stack. */
export const STACK_SIZE = 12;

/** Custom event names dispatched on the event target (default: `window`). */
export const SHUFFLE_EVENTS = Object.freeze({
  start: 'md:shuffle:start',
  phase: 'md:shuffle:phase',
  end: 'md:shuffle:end',
  deal: 'md:shuffle:deal',
});

const MIN_SPEED_MULTIPLIER = 0.2;
const MAX_SPEED_MULTIPLIER = 3;

/* ------------------------------ Pure helpers ------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Maps a speed preset to a duration multiplier, clamped to a sane range. */
export function speedMultiplier(speed: ShuffleSpeed): number {
  const raw = SHUFFLE_SPEEDS[speed] ?? SHUFFLE_SPEEDS.normal;
  return clamp(raw, MIN_SPEED_MULTIPLIER, MAX_SPEED_MULTIPLIER);
}

/** Next preset in the cycle, wrapping around. Drives the speed button. */
export function nextSpeed(speed: ShuffleSpeed): ShuffleSpeed {
  const index = SHUFFLE_SPEED_ORDER.indexOf(speed);
  return SHUFFLE_SPEED_ORDER[(index + 1) % SHUFFLE_SPEED_ORDER.length];
}

/** Duration of a single phase at the given speed, in whole milliseconds. */
export function resolvePhaseDuration(phase: ShufflePhase, speed: ShuffleSpeed): number {
  return Math.round(PHASE_BASE_DURATION_MS[phase] * speedMultiplier(speed));
}

/** Expands a phase sequence into absolute start/end offsets. */
export function buildTimeline(
  sequence: readonly ShufflePhase[],
  speed: ShuffleSpeed,
): TimelineSegment[] {
  let cursor = 0;
  return sequence.map((phase) => {
    const durationMs = resolvePhaseDuration(phase, speed);
    const segment: TimelineSegment = {
      phase,
      startMs: cursor,
      durationMs,
      endMs: cursor + durationMs,
    };
    cursor += durationMs;
    return segment;
  });
}

/** Total wall-clock length of a sequence at the given speed. */
export function sequenceDuration(
  sequence: readonly ShufflePhase[],
  speed: ShuffleSpeed,
): number {
  return sequence.reduce((total, phase) => total + resolvePhaseDuration(phase, speed), 0);
}

/** The segment active at `elapsedMs`, or `null` once the sequence is over. */
export function segmentAt(
  timeline: readonly TimelineSegment[],
  elapsedMs: number,
): TimelineSegment | null {
  if (elapsedMs < 0) return null;
  for (const segment of timeline) {
    if (elapsedMs < segment.endMs) return segment;
  }
  return null;
}

/** Overall 0..1 progress through a timeline. */
export function timelineProgress(
  timeline: readonly TimelineSegment[],
  elapsedMs: number,
): number {
  const total = timeline.length ? timeline[timeline.length - 1].endMs : 0;
  if (total <= 0) return 1;
  return clamp(elapsedMs / total, 0, 1);
}

/** Ease-in-out cubic — the motion curve shared by every phase. */
export function easeInOut(t: number): number {
  const p = clamp(t, 0, 1);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/**
 * Per-card transform for a phase at a given progress. Pure geometry — the
 * overlay feeds the result straight into inline CSS custom properties, and the
 * keyframes interpolate toward it.
 *
 * @param index 0-based position in the rendered stack (0 = bottom card).
 * @param count Total cards rendered in the stack.
 * @param progress 0..1 through the phase.
 */
export function cardTransform(
  phase: ShufflePhase,
  index: number,
  count: number,
  progress: number,
): CardTransform {
  const total = Math.max(1, count);
  const clampedIndex = clamp(index, 0, total - 1);
  /** 0..1 position within the stack. */
  const ratio = total === 1 ? 0 : clampedIndex / (total - 1);
  /** -1..1, centred on the middle of the stack. */
  const centred = ratio * 2 - 1;
  const eased = easeInOut(progress);
  /** Rises 0 -> 1 -> 0 across the phase, for "out and back" motions. */
  const arc = Math.sin(clamp(progress, 0, 1) * Math.PI);
  /** Top half of the deck lifts away, bottom half stays put. */
  const isTopHalf = clampedIndex >= Math.floor(total / 2);
  const half = isTopHalf ? 1 : -1;

  switch (phase) {
    case 'riffle':
      return {
        x: half * arc * 46,
        y: -arc * 14 - clampedIndex * 0.5,
        z: clampedIndex * 2 + arc * 24,
        rotate: half * arc * 9,
        tilt: arc * 26 * half,
        opacity: 1,
      };

    case 'fan':
      return {
        x: centred * eased * 96,
        y: -Math.abs(centred) * eased * 18,
        z: clampedIndex * 2.4,
        rotate: centred * eased * 34,
        tilt: centred * eased * 12,
        opacity: 1,
      };

    case 'cut':
      return {
        x: half * (1 - eased) * 62,
        y: half * (1 - eased) * -30,
        z: clampedIndex * 2 + (1 - eased) * 30,
        rotate: half * (1 - eased) * 12,
        tilt: 0,
        opacity: 1,
      };

    case 'dealing': {
      /** Cards leave one at a time, bottom of the stack first. */
      const stagger = total === 1 ? 0 : clampedIndex / total;
      const local = clamp((eased - stagger) / Math.max(0.0001, 1 - stagger), 0, 1);
      return {
        x: local * 210 * (clampedIndex % 2 === 0 ? 1 : -1),
        y: -local * 150,
        z: clampedIndex * 2 + local * 80,
        rotate: local * 180,
        tilt: local * 40,
        opacity: 1 - local,
      };
    }

    default: {
      const exhaustive: never = phase;
      throw new Error(`Unknown shuffle phase: ${String(exhaustive)}`);
    }
  }
}

/**
 * Schedules `cardCount` cards out to `seatCount` seats, dealing one card per
 * seat in rotation the way a human dealer does.
 */
export function dealFlightPlan(
  cardCount: number,
  seatCount: number,
  speed: ShuffleSpeed,
): DealFlight[] {
  const cards = Math.max(0, Math.floor(cardCount));
  const seats = Math.max(1, Math.floor(seatCount));
  const multiplier = speedMultiplier(speed);
  const durationMs = Math.round(420 * multiplier);
  const stepMs = Math.round(110 * multiplier);

  const flights: DealFlight[] = [];
  for (let cardIndex = 0; cardIndex < cards; cardIndex += 1) {
    flights.push({
      cardIndex,
      seatIndex: cardIndex % seats,
      delayMs: cardIndex * stepMs,
      durationMs,
    });
  }
  return flights;
}

/** Wall-clock length of a deal, including the last card's flight time. */
export function dealPlanDuration(flights: readonly DealFlight[]): number {
  return flights.reduce((max, f) => Math.max(max, f.delayMs + f.durationMs), 0);
}

/* --------------------------- WebAudio sound hooks -------------------------- */

type AudioContextCtor = new () => AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * Synthesised shuffle SFX — filtered noise bursts, so there are no audio assets
 * to ship and nothing to preload. Every method is a no-op when WebAudio is
 * unavailable (SSR, jsdom, older browsers) or when muted.
 */
export class SoundEngine {
  private context: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private volume = 0.35;

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  toggleMuted(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
  }

  /** Browsers require a user gesture before audio starts; call from onClick. */
  resume(): void {
    const context = this.ensureContext();
    if (context && context.state === 'suspended') {
      void context.resume();
    }
  }

  /** The dense flutter of two halves springing together. */
  riffle(speed: ShuffleSpeed = 'normal'): void {
    const multiplier = speedMultiplier(speed);
    for (let i = 0; i < 14; i += 1) {
      this.burst({
        at: i * 0.045 * multiplier,
        duration: 0.05,
        frequency: 1800 + Math.random() * 900,
        gain: 0.55,
      });
    }
  }

  /** A single airy sweep as the deck spreads. */
  fan(speed: ShuffleSpeed = 'normal'): void {
    this.burst({ at: 0, duration: 0.32 * speedMultiplier(speed), frequency: 2600, gain: 0.4 });
  }

  /** One firm slap of the two halves landing. */
  cut(speed: ShuffleSpeed = 'normal'): void {
    this.burst({ at: 0, duration: 0.14 * speedMultiplier(speed), frequency: 700, gain: 0.9 });
  }

  /** A short whip per card leaving the deck. */
  deal(speed: ShuffleSpeed = 'normal'): void {
    this.burst({ at: 0, duration: 0.09 * speedMultiplier(speed), frequency: 3200, gain: 0.5 });
  }

  /** Releases the AudioContext. Call from an unmount effect. */
  dispose(): void {
    if (this.context) {
      void this.context.close();
      this.context = null;
      this.noiseBuffer = null;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor = resolveAudioContextCtor();
    if (!Ctor) return null;
    try {
      this.context = new Ctor();
    } catch {
      this.context = null;
    }
    return this.context;
  }

  private ensureNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(context.sampleRate * 0.5);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      channel[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private burst(options: {
    at: number;
    duration: number;
    frequency: number;
    gain: number;
  }): void {
    if (this.muted) return;
    const context = this.ensureContext();
    if (!context) return;

    const startAt = context.currentTime + options.at;
    const source = context.createBufferSource();
    source.buffer = this.ensureNoiseBuffer(context);

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = options.frequency;
    filter.Q.value = 0.8;

    const amp = context.createGain();
    const peak = clamp(options.gain * this.volume, 0, 1);
    amp.gain.setValueAtTime(0.0001, startAt);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), startAt + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, startAt + options.duration);

    source.connect(filter);
    filter.connect(amp);
    amp.connect(context.destination);
    source.start(startAt);
    source.stop(startAt + options.duration + 0.02);
  }
}

/** Shared singleton used by the overlay and the deck views. */
export const soundEngine = new SoundEngine();

/* --------------------------------- Engine --------------------------------- */

export interface ShuffleEngineOptions {
  /** Where `CustomEvent`s are dispatched. Defaults to `window`. */
  eventTarget?: EventTarget | null;
  /** Injectable for tests. Defaults to `globalThis.setTimeout`. */
  scheduler?: (handler: () => void, timeoutMs: number) => number;
  cancelScheduled?: (handle: number) => void;
  sound?: SoundEngine;
  speed?: ShuffleSpeed;
}

export interface StartOptions {
  reason?: ShuffleReason;
  sequence?: readonly ShufflePhase[];
  speed?: ShuffleSpeed;
}

type Listener = (snapshot: ShuffleSnapshot) => void;

function resolveEventTarget(explicit?: EventTarget | null): EventTarget | null {
  if (explicit !== undefined) return explicit;
  return typeof window === 'undefined' ? null : window;
}

/**
 * Drives the shuffle state machine: advances phases on a timer, plays the
 * matching SFX, notifies React subscribers and dispatches DOM `CustomEvent`s so
 * non-React listeners (analytics, the deck view) can react too.
 */
export class ShuffleEngine {
  private state: ShuffleState = 'idle';
  private speed: ShuffleSpeed;
  private reason: ShuffleReason | null = null;
  private timeline: TimelineSegment[] = [];
  private segmentIndex = -1;
  private runId = 0;
  private handle: number | null = null;
  private listeners = new Set<Listener>();

  private readonly eventTarget: EventTarget | null;
  private readonly schedule: (handler: () => void, timeoutMs: number) => number;
  private readonly cancelScheduled: (handle: number) => void;
  private readonly sound: SoundEngine;

  constructor(options: ShuffleEngineOptions = {}) {
    this.eventTarget = resolveEventTarget(options.eventTarget);
    this.schedule =
      options.scheduler ??
      ((handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number);
    this.cancelScheduled = options.cancelScheduled ?? ((h) => globalThis.clearTimeout(h));
    this.sound = options.sound ?? soundEngine;
    this.speed = options.speed ?? 'normal';
  }

  /* ---- reads ---- */

  getState(): ShuffleState {
    return this.state;
  }

  getSpeed(): ShuffleSpeed {
    return this.speed;
  }

  isAnimating(): boolean {
    return this.state !== 'idle';
  }

  getSnapshot(): ShuffleSnapshot {
    const segment = this.segmentIndex >= 0 ? this.timeline[this.segmentIndex] : undefined;
    const total = this.timeline.length ? this.timeline[this.timeline.length - 1].endMs : 0;
    const progress =
      total > 0 && segment
        ? clamp(segment.endMs / total, 0, 1)
        : this.state === 'idle'
          ? 1
          : 0;
    return {
      state: this.state,
      phase: this.state === 'idle' ? null : this.state,
      speed: this.speed,
      reason: this.reason,
      progress,
      runId: this.runId,
      timeline: this.timeline,
      totalDurationMs: total,
    };
  }

  /* ---- writes ---- */

  /**
   * Changes the speed preset. Taking effect mid-run would desync the CSS
   * animations already in flight, so a running sequence keeps its old timing.
   */
  setSpeed(speed: ShuffleSpeed): void {
    if (this.speed === speed) return;
    this.speed = speed;
    this.emit();
  }

  /**
   * Starts a shuffle. A call while one is already running restarts it, so the
   * "Shuffle Deck" button stays responsive when mashed.
   *
   * @returns the run id, or `null` if the sequence was empty.
   */
  start(options: StartOptions = {}): number | null {
    const sequence = [...(options.sequence ?? DEFAULT_SEQUENCE)];
    if (sequence.length === 0) return null;

    if (this.state !== 'idle') {
      this.stop(true);
    }
    if (options.speed) {
      this.speed = options.speed;
    }

    this.runId += 1;
    this.reason = options.reason ?? 'manual';
    this.timeline = buildTimeline(sequence, this.speed);
    this.segmentIndex = -1;

    this.dispatch<ShuffleStartDetail>(SHUFFLE_EVENTS.start, {
      runId: this.runId,
      reason: this.reason,
      speed: this.speed,
      sequence,
      totalDurationMs: sequenceDuration(sequence, this.speed),
    });

    this.advance();
    return this.runId;
  }

  /** Convenience wrapper: shuffle, then deal. Used at setup and on rematch. */
  startDeal(reason: ShuffleReason = 'game-setup', speed?: ShuffleSpeed): number | null {
    return this.start({ reason, sequence: DEAL_SEQUENCE, speed });
  }

  /** Aborts the running sequence and returns the deck to `idle`. */
  cancel(): void {
    if (this.state === 'idle') return;
    this.stop(true);
  }

  /**
   * Announces a deal without running the full shuffle — the deck view listens
   * for this to fly cards out on draw.
   */
  deal(cardCount: number, seatCount = 1): DealDetail {
    const flights = dealFlightPlan(cardCount, seatCount, this.speed);
    const detail: DealDetail = {
      runId: this.runId,
      cardCount: flights.length,
      seatCount: Math.max(1, Math.floor(seatCount)),
      flights,
      totalDurationMs: dealPlanDuration(flights),
    };
    this.sound.deal(this.speed);
    this.dispatch(SHUFFLE_EVENTS.deal, detail);
    return detail;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Clears timers and listeners. Call on teardown. */
  destroy(): void {
    this.stop(true);
    this.listeners.clear();
  }

  /* ---- internals ---- */

  private advance(): void {
    this.segmentIndex += 1;
    const segment = this.timeline[this.segmentIndex];

    if (!segment) {
      this.stop(false);
      return;
    }

    this.state = segment.phase;
    this.playPhaseSound(segment.phase);
    this.dispatch<ShufflePhaseDetail>(SHUFFLE_EVENTS.phase, {
      runId: this.runId,
      phase: segment.phase,
      index: this.segmentIndex,
      durationMs: segment.durationMs,
    });
    this.emit();

    this.handle = this.schedule(() => {
      this.handle = null;
      this.advance();
    }, segment.durationMs);
  }

  private stop(cancelled: boolean): void {
    if (this.handle !== null) {
      this.cancelScheduled(this.handle);
      this.handle = null;
    }
    const reason = this.reason;
    const runId = this.runId;

    this.state = 'idle';
    this.segmentIndex = -1;
    this.reason = null;

    if (reason !== null) {
      this.dispatch<ShuffleEndDetail>(SHUFFLE_EVENTS.end, { runId, reason, cancelled });
    }
    this.emit();
  }

  private playPhaseSound(phase: ShufflePhase): void {
    switch (phase) {
      case 'riffle':
        this.sound.riffle(this.speed);
        break;
      case 'fan':
        this.sound.fan(this.speed);
        break;
      case 'cut':
        this.sound.cut(this.speed);
        break;
      case 'dealing':
        this.sound.deal(this.speed);
        break;
    }
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private dispatch<T>(name: string, detail: T): void {
    if (!this.eventTarget || typeof CustomEvent === 'undefined') return;
    this.eventTarget.dispatchEvent(new CustomEvent<T>(name, { detail }));
  }
}

/** Shared engine instance — the overlay and every view talk to this one. */
export const shuffleEngine = new ShuffleEngine();

/* --------------------- Imperative helpers for view code -------------------- */

/** Kicks off a shuffle from anywhere (buttons, socket handlers, effects). */
export function triggerShuffle(reason: ShuffleReason, speed?: ShuffleSpeed): number | null {
  soundEngine.resume();
  const sequence =
    reason === 'game-setup' || reason === 'rematch' ? DEAL_SEQUENCE : DEFAULT_SEQUENCE;
  return shuffleEngine.start({ reason, sequence, speed });
}

/** Announces a draw so `DeckStackView` can fly the cards out. */
export function triggerDeal(cardCount: number, seatCount = 1): DealDetail {
  return shuffleEngine.deal(cardCount, seatCount);
}

/** Typed `addEventListener` wrapper. Returns an unsubscribe function. */
export function onShuffleEvent<T>(
  name: string,
  handler: (detail: T) => void,
  target: EventTarget | null = typeof window === 'undefined' ? null : window,
): () => void {
  if (!target) return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<T>).detail);
  target.addEventListener(name, listener);
  return () => target.removeEventListener(name, listener);
}
