/**
 * cardFlightEngine.ts — Monopoly Deal Card Flight Trajectory, 3D Spatial Arc & Touch Deal Engine.
 *
 * Framework-free engine that calculates 3D parabolic Bezier flight trajectories, seat coordinates,
 * spin & flip 3D transforms, touch deal swipe gestures, and dispatches custom DOM events.
 */

/* ---------------------------------- Types --------------------------------- */

export type ShuffleSpeed = 'slow' | 'normal' | 'fast' | 'turbo';

export interface FlightPoint3D {
  x: number;
  y: number;
  z: number;
}

export interface SeatCoordinates {
  seatIndex: number;
  name: string;
  xPercent: number;
  yPercent: number;
  angleDeg: number;
}

export interface CardFlightTransform {
  x: number;
  y: number;
  z: number;
  rotateZ: number;
  rotateY: number;
  opacity: number;
  scale: number;
}

export interface DealFlightConfig {
  flightId: string;
  cardIndex: number;
  seatIndex: number;
  startPoint: FlightPoint3D;
  endPoint: FlightPoint3D;
  durationMs: number;
  delayMs: number;
  rotateStart: number;
  rotateEnd: number;
  flipCount: number;
  arcHeightPx: number;
}

export interface TouchSwipeGesture {
  isSwipe: boolean;
  direction: 'up' | 'down' | 'left' | 'right' | 'none';
  distancePx: number;
  velocityPxMs: number;
  velocityPxSec: number;
  targetSeatIndex: number;
}

export interface FlightSnapshot {
  activeCount: number;
  speed: ShuffleSpeed;
  runId: number;
  flights: DealFlightConfig[];
}

export interface CardFlightStartDetail {
  runId: number;
  flightCount: number;
  seatCount: number;
  speed: ShuffleSpeed;
  totalDurationMs: number;
  flights?: DealFlightConfig[];
}

export interface CardFlightLandDetail {
  runId: number;
  flightId: string;
  seatIndex: number;
  cardIndex: number;
}

export interface CardFlightCompleteDetail {
  runId: number;
  totalFlights: number;
  cancelled: boolean;
}

/* -------------------------------- Constants ------------------------------- */

export const SHUFFLE_SPEEDS: Readonly<Record<ShuffleSpeed, number>> = Object.freeze({
  slow: 1.6,
  normal: 1,
  fast: 0.6,
  turbo: 0.35,
});

/** Default seat spatial mapping for 2 to 5 players. */
export const SEAT_PRESETS: Readonly<Record<number, readonly SeatCoordinates[]>> = Object.freeze({
  2: Object.freeze([
    { seatIndex: 0, name: 'South (Human)', xPercent: 50, yPercent: 90, angleDeg: 0 },
    { seatIndex: 1, name: 'North (Opponent)', xPercent: 50, yPercent: 10, angleDeg: 180 },
  ]),
  3: Object.freeze([
    { seatIndex: 0, name: 'South (Human)', xPercent: 50, yPercent: 90, angleDeg: 0 },
    { seatIndex: 1, name: 'North-West (Opponent 1)', xPercent: 20, yPercent: 20, angleDeg: 135 },
    { seatIndex: 2, name: 'North-East (Opponent 2)', xPercent: 80, yPercent: 20, angleDeg: 225 },
  ]),
  4: Object.freeze([
    { seatIndex: 0, name: 'South (Human)', xPercent: 50, yPercent: 90, angleDeg: 0 },
    { seatIndex: 1, name: 'West (Opponent 1)', xPercent: 10, yPercent: 50, angleDeg: 90 },
    { seatIndex: 2, name: 'North (Opponent 2)', xPercent: 50, yPercent: 10, angleDeg: 180 },
    { seatIndex: 3, name: 'East (Opponent 3)', xPercent: 90, yPercent: 50, angleDeg: 270 },
  ]),
  5: Object.freeze([
    { seatIndex: 0, name: 'South (Human)', xPercent: 50, yPercent: 90, angleDeg: 0 },
    { seatIndex: 1, name: 'South-West (Opponent 1)', xPercent: 15, yPercent: 70, angleDeg: 45 },
    { seatIndex: 2, name: 'North-West (Opponent 2)', xPercent: 25, yPercent: 15, angleDeg: 135 },
    { seatIndex: 3, name: 'North-East (Opponent 3)', xPercent: 75, yPercent: 15, angleDeg: 225 },
    { seatIndex: 4, name: 'South-East (Opponent 4)', xPercent: 85, yPercent: 70, angleDeg: 315 },
  ]),
});

export const DECK_CENTER_PRESET: SeatCoordinates = Object.freeze({
  seatIndex: 99,
  name: 'Center Deck',
  xPercent: 50,
  yPercent: 50,
  angleDeg: 0,
});

export const CARD_FLIGHT_EVENTS = Object.freeze({
  start: 'md:cardflight:start',
  frame: 'md:cardflight:frame',
  land: 'md:cardflight:land',
  complete: 'md:cardflight:complete',
});

export const BASE_FLIGHT_DURATION_MS = 600;
export const STAGGER_DELAY_MS = 80;

/* ------------------------------ Pure Helpers ------------------------------ */

export function clamp(val: number, min: number, max: number): number {
  if (Number.isNaN(val)) return min;
  return Math.min(max, Math.max(min, val));
}

export function speedMultiplier(speed: ShuffleSpeed): number {
  const raw = SHUFFLE_SPEEDS[speed] ?? SHUFFLE_SPEEDS.normal;
  return clamp(raw, 0.2, 3);
}

/** Evaluates 1D quadratic Bezier curve at progress t (0..1). */
export function quadraticBezier1D(p0: number, p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

/** Evaluates 3D quadratic Bezier curve with elevated arc control point P1. */
export function calculateBezier3D(
  start: FlightPoint3D,
  end: FlightPoint3D,
  arcHeightPx: number,
  t: number,
): FlightPoint3D {
  const clampedT = clamp(t, 0, 1);
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2 - arcHeightPx;
  const midZ = (start.z + end.z) / 2 + arcHeightPx * 0.5;

  return {
    x: quadraticBezier1D(start.x, midX, end.x, clampedT),
    y: quadraticBezier1D(start.y, midY, end.y, clampedT),
    z: quadraticBezier1D(start.z, midZ, end.z, clampedT),
  };
}

/** Calculates 3D transform metrics (position, rotation, flip, opacity) for flight progress t. */
export function calculateFlightTransform(
  start: FlightPoint3D,
  end: FlightPoint3D,
  rotateStart: number,
  rotateEnd: number,
  flipCount: number,
  arcHeightPx: number,
  t: number,
): CardFlightTransform {
  const clampedT = clamp(t, 0, 1);
  const pos = calculateBezier3D(start, end, arcHeightPx, clampedT);
  const rotateZ = rotateStart + (rotateEnd - rotateStart) * clampedT;
  const rotateY = flipCount * 180 * clampedT;

  let opacity = 1;
  if (clampedT < 0.1) {
    opacity = clampedT / 0.1;
  }

  const scale = 1 + Math.sin(clampedT * Math.PI) * 0.15;

  return {
    x: Math.round(pos.x * 100) / 100,
    y: Math.round(pos.y * 100) / 100,
    z: Math.round(pos.z * 100) / 100,
    rotateZ: Math.round(rotateZ * 10) / 10,
    rotateY: Math.round(rotateY * 10) / 10,
    opacity: Math.round(opacity * 100) / 100,
    scale: Math.round(scale * 100) / 100,
  };
}

/** Resolves seat coordinate presets for a player count (2..5). */
export function getSeatPreset(playerCount: number, seatIndex: number): SeatCoordinates {
  const count = clamp(Math.round(playerCount), 2, 5);
  const presets = SEAT_PRESETS[count] ?? SEAT_PRESETS[2];
  const idx = Math.abs(seatIndex) % presets.length;
  return presets[idx];
}

/** Evaluates a touch drag/swipe vector to determine if it constitutes a deal swipe. */
export function recognizeTouchDealSwipe(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  durationMs: number,
  seatCount: number = 2,
): TouchSwipeGesture {
  const dx = endX - startX;
  const dy = endY - startY;
  const distancePx = Math.sqrt(dx * dx + dy * dy);
  const safeDuration = Math.max(1, durationMs);
  const velocityPxMs = distancePx / safeDuration;
  const velocityPxSec = velocityPxMs * 1000;

  const isSwipe = distancePx >= 30 && velocityPxSec >= 300;

  let direction: 'up' | 'down' | 'left' | 'right' | 'none' = 'none';
  let targetSeatIndex = 0;

  if (isSwipe) {
    if (Math.abs(dx) > Math.abs(dy)) {
      direction = dx > 0 ? 'right' : 'left';
      targetSeatIndex = seatCount >= 4 ? (dx > 0 ? 3 : 1) : 1;
    } else {
      direction = dy > 0 ? 'down' : 'up';
      targetSeatIndex = dy < 0 ? 1 : 0;
    }
  }

  return {
    isSwipe,
    direction,
    distancePx: Math.round(distancePx * 10) / 10,
    velocityPxMs: Math.round(velocityPxMs * 1000) / 1000,
    velocityPxSec: Math.round(velocityPxSec * 10) / 10,
    targetSeatIndex,
  };
}

/* ------------------------------- Engine Class ------------------------------ */

export class CardFlightEngine {
  private activeFlights: DealFlightConfig[] = [];
  private speed: ShuffleSpeed = 'normal';
  private runId: number = 0;
  private target: EventTarget;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(target: EventTarget = typeof window !== 'undefined' ? window : new EventTarget()) {
    this.target = target;
  }

  public setSpeed(speed: ShuffleSpeed): void {
    this.speed = speed;
  }

  public getSpeed(): ShuffleSpeed {
    return this.speed;
  }

  public getSnapshot(): FlightSnapshot {
    return {
      activeCount: this.activeFlights.length,
      speed: this.speed,
      runId: this.runId,
      flights: [...this.activeFlights],
    };
  }

  public cancel(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    const wasActive = this.activeFlights.length > 0;
    this.activeFlights = [];

    if (wasActive) {
      const detail: CardFlightCompleteDetail = {
        runId: this.runId,
        totalFlights: 0,
        cancelled: true,
      };
      this.target.dispatchEvent(
        new CustomEvent(CARD_FLIGHT_EVENTS.complete, { detail }),
      );
    }
  }

  public launchDealSequence(
    cardCount: number = 5,
    seatCount: number = 2,
    startPos: FlightPoint3D = { x: 50, y: 50, z: 0 },
    customEndPos?: FlightPoint3D,
  ): number {
    this.cancel();
    this.runId += 1;
    const currentRunId = this.runId;

    const multiplier = speedMultiplier(this.speed);
    const flightDuration = Math.round(BASE_FLIGHT_DURATION_MS * multiplier);
    const staggerDelay = Math.round(STAGGER_DELAY_MS * multiplier);

    const flights: DealFlightConfig[] = [];

    for (let c = 0; c < cardCount; c += 1) {
      for (let s = 0; s < seatCount; s += 1) {
        const seat = getSeatPreset(seatCount, s);
        const endPoint: FlightPoint3D = customEndPos ?? {
          x: seat.xPercent,
          y: seat.yPercent,
          z: 0,
        };

        const index = c * seatCount + s;
        const delayMs = index * staggerDelay;

        flights.push({
          flightId: `flight-${currentRunId}-${index}`,
          cardIndex: c,
          seatIndex: s,
          startPoint: { ...startPos },
          endPoint,
          durationMs: flightDuration,
          delayMs,
          rotateStart: 0,
          rotateEnd: seat.angleDeg,
          flipCount: 1,
          arcHeightPx: 120,
        });
      }
    }

    this.activeFlights = flights;
    const totalDurationMs =
      flights.length > 0
        ? Math.max(...flights.map((f) => f.delayMs + f.durationMs))
        : 0;

    const startDetail: CardFlightStartDetail = {
      runId: currentRunId,
      flightCount: flights.length,
      seatCount,
      speed: this.speed,
      totalDurationMs,
      flights: [...flights],
    };
    this.target.dispatchEvent(
      new CustomEvent(CARD_FLIGHT_EVENTS.start, { detail: startDetail }),
    );

    flights.forEach((flight) => {
      const landTimer = setTimeout(() => {
        if (this.runId !== currentRunId) return;
        const landDetail: CardFlightLandDetail = {
          runId: currentRunId,
          flightId: flight.flightId,
          seatIndex: flight.seatIndex,
          cardIndex: flight.cardIndex,
        };
        this.target.dispatchEvent(
          new CustomEvent(CARD_FLIGHT_EVENTS.land, { detail: landDetail }),
        );
      }, flight.delayMs + flight.durationMs);

      this.timers.push(landTimer);
    });

    const completeTimer = setTimeout(() => {
      if (this.runId !== currentRunId) return;
      this.activeFlights = [];
      const completeDetail: CardFlightCompleteDetail = {
        runId: currentRunId,
        totalFlights: flights.length,
        cancelled: false,
      };
      this.target.dispatchEvent(
        new CustomEvent(CARD_FLIGHT_EVENTS.complete, { detail: completeDetail }),
      );
    }, totalDurationMs);

    this.timers.push(completeTimer);

    return totalDurationMs;
  }

  public launchFlight(
    startPos: FlightPoint3D = { x: 50, y: 50, z: 0 },
    endPos: FlightPoint3D = { x: 50, y: 90, z: 0 },
    seatIndex: number = 0,
    durationMs: number = BASE_FLIGHT_DURATION_MS,
  ): number {
    this.cancel();
    this.runId += 1;
    const currentRunId = this.runId;

    const flight: DealFlightConfig = {
      flightId: `flight-${currentRunId}-0`,
      cardIndex: 0,
      seatIndex,
      startPoint: { ...startPos },
      endPoint: { ...endPos },
      durationMs,
      delayMs: 0,
      rotateStart: 0,
      rotateEnd: 0,
      flipCount: 1,
      arcHeightPx: 120,
    };

    this.activeFlights = [flight];
    const startDetail: CardFlightStartDetail = {
      runId: currentRunId,
      flightCount: 1,
      seatCount: 1,
      speed: this.speed,
      totalDurationMs: durationMs,
      flights: [flight],
    };

    this.target.dispatchEvent(
      new CustomEvent(CARD_FLIGHT_EVENTS.start, { detail: startDetail }),
    );

    const landTimer = setTimeout(() => {
      if (this.runId !== currentRunId) return;
      const landDetail: CardFlightLandDetail = {
        runId: currentRunId,
        flightId: flight.flightId,
        seatIndex,
        cardIndex: 0,
      };
      this.target.dispatchEvent(
        new CustomEvent(CARD_FLIGHT_EVENTS.land, { detail: landDetail }),
      );
    }, durationMs);

    this.timers.push(landTimer);

    const completeTimer = setTimeout(() => {
      if (this.runId !== currentRunId) return;
      this.activeFlights = [];
      const completeDetail: CardFlightCompleteDetail = {
        runId: currentRunId,
        totalFlights: 1,
        cancelled: false,
      };
      this.target.dispatchEvent(
        new CustomEvent(CARD_FLIGHT_EVENTS.complete, { detail: completeDetail }),
      );
    }, durationMs);

    this.timers.push(completeTimer);

    return durationMs;
  }
}

export const cardFlightEngine = new CardFlightEngine();

