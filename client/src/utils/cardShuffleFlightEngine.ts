/**
 * cardShuffleFlightEngine.ts — 3D Card Shuffle, Cut & Multi-Seat Deck Dealer Flight Animation Engine.
 *
 * Framework-free pure math trajectory calculator, 3D card transform generator,
 * multi-seat flight deal scheduler, speed scaling engine, WebAudio SFX coordinator,
 * and custom DOM event bus for Monopoly Deal React client.
 */

import { playCardPlay, playCardFlip, playCardDraw } from './soundEngine';

/* ---------------------------------- Types --------------------------------- */

export type ShuffleState = 'idle' | 'riffle' | 'fan' | 'cut' | 'dealing';
export type ShufflePhase = Exclude<ShuffleState, 'idle'>;
export type ShuffleSpeed = 'slow' | 'normal' | 'fast' | 'turbo';
export type ShuffleReason =
  | 'game-setup'
  | 'rematch'
  | 'manual'
  | 'draw'
  | 'deck-recycle';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface CardTransform3D {
  x: number;
  y: number;
  z: number;
  rotateZ: number;
  rotateY: number;
  scale: number;
  opacity: number;
}

export interface DealFlight3D {
  cardIndex: number;
  seatIndex: number;
  delayMs: number;
  durationMs: number;
  startPoint: Point3D;
  endPoint: Point3D;
  flip3D: boolean;
}

export interface TimelineSegment {
  phase: ShufflePhase;
  startMs: number;
  durationMs: number;
  endMs: number;
}

export interface ShuffleSnapshot {
  state: ShuffleState;
  phase: ShufflePhase | null;
  speed: ShuffleSpeed;
  reason: ShuffleReason | null;
  progress: number;
  runId: number;
  timeline: TimelineSegment[];
  totalDurationMs: number;
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
  cancelled: boolean;
}

export interface DealDetail3D {
  runId: number;
  cardCount: number;
  seatCount: number;
  flights: DealFlight3D[];
  totalDurationMs: number;
}

/* -------------------------------- Constants ------------------------------- */

export const SHUFFLE_SPEEDS: Readonly<Record<ShuffleSpeed, number>> = Object.freeze({
  slow: 1.6,
  normal: 1.0,
  fast: 0.6,
  turbo: 0.35,
});

export const SHUFFLE_SPEED_ORDER: readonly ShuffleSpeed[] = Object.freeze([
  'slow',
  'normal',
  'fast',
  'turbo',
]);

export const PHASE_BASE_DURATION_MS: Readonly<Record<ShufflePhase, number>> = Object.freeze({
  riffle: 900,
  fan: 700,
  cut: 600,
  dealing: 1200,
});

export const DEFAULT_SEQUENCE: readonly ShufflePhase[] = Object.freeze([
  'riffle',
  'fan',
  'cut',
]);

export const DEAL_SEQUENCE: readonly ShufflePhase[] = Object.freeze([
  'riffle',
  'fan',
  'cut',
  'dealing',
]);

export const STACK_SIZE = 12;

export const SHUFFLE_FLIGHT_EVENTS = Object.freeze({
  start: 'md:cardshuffleflight:start',
  phase: 'md:cardshuffleflight:phase',
  land: 'md:cardshuffleflight:land',
  complete: 'md:cardshuffleflight:complete',
  deal: 'md:cardshuffleflight:deal',
});

const MIN_SPEED_MULTIPLIER = 0.2;
const MAX_SPEED_MULTIPLIER = 3.0;

/* ------------------------------ Pure Helpers ------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function speedMultiplier(speed: ShuffleSpeed): number {
  const raw = SHUFFLE_SPEEDS[speed] ?? SHUFFLE_SPEEDS.normal;
  return clamp(raw, MIN_SPEED_MULTIPLIER, MAX_SPEED_MULTIPLIER);
}

export function nextSpeed(speed: ShuffleSpeed): ShuffleSpeed {
  const index = SHUFFLE_SPEED_ORDER.indexOf(speed);
  return SHUFFLE_SPEED_ORDER[(index + 1) % SHUFFLE_SPEED_ORDER.length];
}

export function resolvePhaseDuration(phase: ShufflePhase, speed: ShuffleSpeed): number {
  return Math.round(PHASE_BASE_DURATION_MS[phase] * speedMultiplier(speed));
}

export function easeInOut(t: number): number {
  const p = clamp(t, 0, 1);
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/**
 * Calculates 3D quadratic Bezier curve point between p0 and p2 with parabolic spatial arc height elevation.
 */
export function calculateShuffleBezier3D(
  p0: Point3D,
  p2: Point3D,
  t: number,
  arcHeightPx: number = 120,
): Point3D {
  const clampedT = clamp(t, 0, 1);
  const midX = (p0.x + p2.x) / 2;
  const midY = (p0.y + p2.y) / 2 - arcHeightPx;
  const midZ = Math.max(p0.z, p2.z) + arcHeightPx * 0.5;

  const p1: Point3D = { x: midX, y: midY, z: midZ };
  const u = 1 - clampedT;

  return {
    x: u * u * p0.x + 2 * u * clampedT * p1.x + clampedT * clampedT * p2.x,
    y: u * u * p0.y + 2 * u * clampedT * p1.y + clampedT * clampedT * p2.y,
    z: u * u * p0.z + 2 * u * clampedT * p1.z + clampedT * clampedT * p2.z,
  };
}

/**
 * Calculates 3D card transform for a specific phase, index in stack, and progress (0..1).
 */
export function cardTransform3D(
  phase: ShufflePhase,
  index: number,
  count: number,
  progress: number,
): CardTransform3D {
  const total = Math.max(1, count);
  const clampedIndex = clamp(index, 0, total - 1);
  const ratio = total === 1 ? 0 : clampedIndex / (total - 1);
  const centred = ratio * 2 - 1;
  const eased = easeInOut(progress);
  const arc = Math.sin(clamp(progress, 0, 1) * Math.PI);
  const isTopHalf = clampedIndex >= Math.floor(total / 2);
  const half = isTopHalf ? 1 : -1;

  switch (phase) {
    case 'riffle':
      return {
        x: half * arc * 48,
        y: -arc * 16 - clampedIndex * 0.6,
        z: clampedIndex * 2.5 + arc * 28,
        rotateZ: half * arc * 10,
        rotateY: arc * 28 * half,
        scale: 1 + arc * 0.05,
        opacity: 1,
      };

    case 'fan':
      return {
        x: centred * eased * 100,
        y: -Math.abs(centred) * eased * 20,
        z: clampedIndex * 2.5,
        rotateZ: centred * eased * 36,
        rotateY: centred * eased * 14,
        scale: 1,
        opacity: 1,
      };

    case 'cut':
      return {
        x: half * (1 - eased) * 64,
        y: half * (1 - eased) * -32,
        z: clampedIndex * 2 + (1 - eased) * 32,
        rotateZ: half * (1 - eased) * 14,
        rotateY: 0,
        scale: 1,
        opacity: 1,
      };

    case 'dealing': {
      const stagger = total === 1 ? 0 : clampedIndex / total;
      const local = clamp((eased - stagger) / Math.max(0.0001, 1 - stagger), 0, 1);
      return {
        x: local * 220 * (clampedIndex % 2 === 0 ? 1 : -1),
        y: -local * 160,
        z: clampedIndex * 2 + local * 90,
        rotateZ: local * 180,
        rotateY: local * 45,
        scale: 1 - local * 0.2,
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
 * Builds deal flight plans across 2..5 player seats with 140ms stagger.
 */
export function dealFlightPlan3D(
  cardCount: number,
  seatCount: number,
  speed: ShuffleSpeed,
  startPoint: Point3D = { x: 0, y: 0, z: 0 },
  seatPoints: Point3D[] = [],
): DealFlight3D[] {
  const cards = Math.max(0, Math.floor(cardCount));
  const seats = Math.max(1, Math.floor(seatCount));
  const multiplier = speedMultiplier(speed);
  const durationMs = Math.round(440 * multiplier);
  const stepMs = Math.round(140 * multiplier);

  const flights: DealFlight3D[] = [];
  for (let cardIndex = 0; cardIndex < cards; cardIndex += 1) {
    const seatIndex = cardIndex % seats;
    const defaultEnd: Point3D = {
      x: (seatIndex - (seats - 1) / 2) * 260,
      y: seatIndex === 0 ? 250 : -250,
      z: 10,
    };
    const endPoint = seatPoints[seatIndex] || defaultEnd;
    const isHumanSeat = seatIndex === 0;

    flights.push({
      cardIndex,
      seatIndex,
      delayMs: cardIndex * stepMs,
      durationMs,
      startPoint,
      endPoint,
      flip3D: isHumanSeat,
    });
  }
  return flights;
}

export function dealPlanDuration3D(flights: readonly DealFlight3D[]): number {
  return flights.reduce((max, f) => Math.max(max, f.delayMs + f.durationMs), 0);
}

export function frameToTransform3D(t: CardTransform3D): string {
  return `translate3d(${t.x.toFixed(2)}px, ${t.y.toFixed(2)}px, ${t.z.toFixed(2)}px) rotateZ(${t.rotateZ.toFixed(2)}deg) rotateY(${t.rotateY.toFixed(2)}deg) scale(${t.scale.toFixed(3)})`;
}

/* ----------------             DOM Event Bus             ---------------- */

export function onShuffleFlightEvent<T>(
  eventName: string,
  handler: (detail: T) => void,
  target: EventTarget = typeof window !== 'undefined' ? window : new EventTarget(),
): () => void {
  const listener = (event: Event) => {
    const custom = event as CustomEvent<T>;
    handler(custom.detail);
  };
  target.addEventListener(eventName, listener);
  return () => target.removeEventListener(eventName, listener);
}

/* ----------------               Engine Engine               ---------------- */

export class CardShuffleFlightEngine {
  private state: ShuffleState = 'idle';
  private phase: ShufflePhase | null = null;
  private speed: ShuffleSpeed = 'normal';
  private reason: ShuffleReason | null = null;
  private progress = 0;
  private runId = 0;
  private timeline: TimelineSegment[] = [];
  private totalDurationMs = 0;
  private listeners: Set<(snapshot: ShuffleSnapshot) => void> = new Set();
  private timerId: number | null = null;
  private eventTarget: EventTarget;

  constructor(target?: EventTarget) {
    this.eventTarget = target || (typeof window !== 'undefined' ? window : new EventTarget());
  }

  getSnapshot(): ShuffleSnapshot {
    return {
      state: this.state,
      phase: this.phase,
      speed: this.speed,
      reason: this.reason,
      progress: this.progress,
      runId: this.runId,
      timeline: this.timeline,
      totalDurationMs: this.totalDurationMs,
    };
  }

  getSpeed(): ShuffleSpeed {
    return this.speed;
  }

  setSpeed(speed: ShuffleSpeed): void {
    this.speed = speed;
    this.emitChange();
  }

  subscribe(listener: (snapshot: ShuffleSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private emitChange(): void {
    const snapshot = this.getSnapshot();
    Array.from(this.listeners).forEach((listener) => listener(snapshot));
  }

  private dispatch<T>(eventName: string, detail: T): void {
    if (typeof CustomEvent === 'undefined') return;
    this.eventTarget.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  start(options: { reason?: ShuffleReason; sequence?: readonly ShufflePhase[] } = {}): void {
    this.cancel();

    this.runId += 1;
    this.reason = options.reason || 'manual';
    const sequence = options.sequence || DEFAULT_SEQUENCE;
    this.state = sequence[0] || 'idle';
    this.phase = sequence[0] || null;
    this.progress = 0;

    let cursor = 0;
    this.timeline = sequence.map((p) => {
      const durationMs = resolvePhaseDuration(p, this.speed);
      const seg: TimelineSegment = { phase: p, startMs: cursor, durationMs, endMs: cursor + durationMs };
      cursor += durationMs;
      return seg;
    });
    this.totalDurationMs = cursor;

    this.dispatch<ShuffleStartDetail>(SHUFFLE_FLIGHT_EVENTS.start, {
      runId: this.runId,
      reason: this.reason,
      speed: this.speed,
      sequence: [...sequence],
      totalDurationMs: this.totalDurationMs,
    });

    if (this.phase === 'riffle') playCardPlay();
    else if (this.phase === 'fan') playCardFlip();
    else if (this.phase === 'cut') playCardDraw();

    this.emitChange();

    const startMs = performance.now();
    const currentRunId = this.runId;

    const tick = () => {
      if (this.runId !== currentRunId) return;
      const elapsed = performance.now() - startMs;
      this.progress = clamp(elapsed / Math.max(1, this.totalDurationMs), 0, 1);

      if (elapsed >= this.totalDurationMs) {
        this.finish(false);
        return;
      }

      const activeSeg = this.timeline.find((s) => elapsed >= s.startMs && elapsed < s.endMs);
      if (activeSeg && activeSeg.phase !== this.phase) {
        this.phase = activeSeg.phase;
        this.state = activeSeg.phase;
        this.dispatch<ShufflePhaseDetail>(SHUFFLE_FLIGHT_EVENTS.phase, {
          runId: this.runId,
          phase: activeSeg.phase,
          index: this.timeline.indexOf(activeSeg),
          durationMs: activeSeg.durationMs,
        });

        if (this.phase === 'riffle') playCardPlay();
        else if (this.phase === 'fan') playCardFlip();
        else if (this.phase === 'cut') playCardDraw();
      }

      this.emitChange();
      if (typeof window !== 'undefined') {
        this.timerId = window.requestAnimationFrame(tick);
      }
    };

    if (typeof window !== 'undefined') {
      this.timerId = window.requestAnimationFrame(tick);
    }
  }

  cancel(): void {
    if (this.timerId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(this.timerId);
      this.timerId = null;
    }
    if (this.state !== 'idle') {
      this.finish(true);
    }
  }

  private finish(cancelled: boolean): void {
    const lastReason = this.reason || 'manual';
    this.state = 'idle';
    this.phase = null;
    this.progress = 1;

    this.dispatch<ShuffleEndDetail>(SHUFFLE_FLIGHT_EVENTS.complete, {
      runId: this.runId,
      reason: lastReason,
      cancelled,
    });

    this.emitChange();
  }

  scheduleShuffleDealFlight(seatCount = 2, cardsPerSeat = 5, speed: ShuffleSpeed = this.speed): DealDetail3D {
    const totalCards = seatCount * cardsPerSeat;
    const flights = dealFlightPlan3D(totalCards, seatCount, speed);
    const totalDurationMs = dealPlanDuration3D(flights);

    const detail: DealDetail3D = {
      runId: this.runId,
      cardCount: totalCards,
      seatCount,
      flights,
      totalDurationMs,
    };

    this.dispatch<DealDetail3D>(SHUFFLE_FLIGHT_EVENTS.deal, detail);
    playCardDraw();
    return detail;
  }
}

export const cardShuffleFlightEngine = new CardShuffleFlightEngine();
