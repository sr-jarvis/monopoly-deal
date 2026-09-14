/**
 * cardDealFlightEngine.ts — Monopoly Deal 3D Card Deal Flight & Multi-Seat Initial Deal Animation Engine.
 *
 * Pure-math Bezier trajectory calculator, round-robin deal scheduler, 3D transform generator, and event engine.
 * Handles initial game deal and rematch deal animations across 2 to 5 player seats.
 *
 * Features:
 *   - Spatial coordinate mapping from Deck Stack to 2..5 player seat positions.
 *   - 3D quadratic Bezier trajectories with spatial arc elevation (arcHeightPx: 140px).
 *   - 3D Y-axis card flip transitions (180deg face down -> 0deg face up for human seat; 180deg face down for opponent bot seats).
 *   - Round-robin multi-card deal scheduler (5 cards per seat, dealStaggerMs: 140ms with 5-seat compression).
 *   - Hardware-accelerated 3D CSS transform builder (translate3d, rotateZ, rotateY, scale).
 *   - WebAudio SFX synchronization (playCardFlip(), playCardPlay()).
 *   - Custom DOM event bus dispatching (md:carddealflight:start, md:carddealflight:land, md:carddealflight:complete).
 */

import * as sfx from './soundEngine';

/* ---------------------------------- Types --------------------------------- */

export type SeatPosition = 'south' | 'north' | 'east' | 'west' | 'center';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface DealSeatTarget {
  seatId: string;
  seatIndex: number;
  position: SeatPosition;
  isHuman: boolean;
  target: Point3D;
  measured: boolean;
}

export interface DealCardFlight {
  id: string;
  runId: string;
  seatId: string;
  seatIndex: number;
  cardIndex: number;
  dealIndex: number;
  startAtMs: number;
  durationMs: number;
  from: Point3D;
  control: Point3D;
  to: Point3D;
  faceUp: boolean;
  spinDeg: number;
  scaleFrom: number;
  scaleTo: number;
}

export interface DealCascadePlan {
  runId: string;
  seats: DealSeatTarget[];
  flights: DealCardFlight[];
  cardsPerSeat: number;
  dealStaggerMs: number;
  flightDurationMs: number;
  totalDurationMs: number;
  reducedMotion: boolean;
}

export interface DealCascadeOptions {
  seatIds: string[];
  humanSeatId: string;
  cardsPerSeat?: number;
  dealStaggerMs?: number;
  flightDurationMs?: number;
  arcHeightPx?: number;
  reducedMotion?: boolean;
  runId?: string;
  doc?: Document;
}

/* -------------------------------- Constants ------------------------------- */

export const DEAL_FLIGHT_DEFAULTS = {
  cardsPerSeat: 5,
  dealStaggerMs: 140,
  flightDurationMs: 520,
  arcHeightPx: 140,
  arcDepthPx: 70,
  spinDegPerFlight: 24,
  landSettleMs: 120,
  watchdogPaddingMs: 1500,
  maxCascadeMs: 3400,
  maxFlights: 25,
  scaleFrom: 0.82,
  scaleTo: 1,
  flipStart: 0.25,
  flipEnd: 0.8,
} as const;

export const DEAL_FLIGHT_EVENTS = {
  start: 'md:carddealflight:start',
  land: 'md:carddealflight:land',
  complete: 'md:carddealflight:complete',
} as const;

/* ------------------------------- Math Engine ------------------------------ */

export function clamp01(t: number): number {
  if (typeof t !== 'number' || Number.isNaN(t)) return 0;
  return Math.max(0, Math.min(1, t));
}

export function easeOutCubic(t: number): number {
  const p = clamp01(t) - 1;
  return p * p * p + 1;
}

export function easeInOutCubic(t: number): number {
  const clamped = clamp01(t);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

export function calculateBezier3D(p0: Point3D, p1: Point3D, p2: Point3D, t: number): Point3D {
  const u = clamp01(t);
  const oneMinusU = 1 - u;
  const uu = oneMinusU * oneMinusU;
  const u2 = u * u;

  return {
    x: uu * p0.x + 2 * oneMinusU * u * p1.x + u2 * p2.x,
    y: uu * p0.y + 2 * oneMinusU * u * p1.y + u2 * p2.y,
    z: uu * p0.z + 2 * oneMinusU * u * p1.z + u2 * p2.z,
  };
}

export function buildArcControlPoint(from: Point3D, to: Point3D, arcHeightPx: number = DEAL_FLIGHT_DEFAULTS.arcHeightPx): Point3D {
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2 - arcHeightPx,
    z: DEAL_FLIGHT_DEFAULTS.arcDepthPx,
  };
}

export function getFlipAngle(progress: number, faceUp: boolean): number {
  if (!faceUp) return 180;
  const p = clamp01(progress);
  const { flipStart, flipEnd } = DEAL_FLIGHT_DEFAULTS;

  if (p <= flipStart) return 180;
  if (p >= flipEnd) return 0;

  const local = (p - flipStart) / (flipEnd - flipStart);
  return 180 * (1 - easeInOutCubic(local));
}

/* --------------------------- Spatial Resolution --------------------------- */

export function resolveDeckOrigin(doc?: Document): Point3D {
  const targetDoc = doc || (typeof document !== 'undefined' ? document : undefined);
  if (!targetDoc) {
    return { x: 600, y: 400, z: 0 };
  }

  try {
    const el = targetDoc.querySelector('[data-deck-stack]');
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          z: 0,
        };
      }
    }
  } catch {
    /* Fall back to viewport center */
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  return { x: vw / 2, y: vh / 2, z: 0 };
}

export function getSeatPositionOrder(seatCount: number): SeatPosition[] {
  if (seatCount <= 2) return ['south', 'north'];
  if (seatCount === 3) return ['south', 'north', 'east'];
  if (seatCount === 4) return ['south', 'north', 'east', 'west'];
  return ['south', 'north', 'east', 'west', 'center'];
}

export function resolveSeatTargets(
  seatIds: string[],
  humanSeatId: string,
  doc?: Document
): DealSeatTarget[] {
  const targetDoc = doc || (typeof document !== 'undefined' ? document : undefined);
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;

  const uniqueSeatIds = Array.from(new Set(seatIds));
  const validSeats = uniqueSeatIds.slice(0, 5);
  const seatCount = Math.max(2, validSeats.length);
  const positions = getSeatPositionOrder(seatCount);

  return validSeats.map((seatId, index) => {
    const isHuman = seatId === humanSeatId;
    const position = positions[index] || 'center';

    let measured = false;
    let target: Point3D = { x: vw / 2, y: vh / 2, z: 0 };

    if (targetDoc) {
      try {
        const selector = `[data-seat-id="${seatId}"] [data-hand-container], [data-seat-id="${seatId}"]`;
        const el = targetDoc.querySelector(selector);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            target = {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              z: 0,
            };
            measured = true;
          }
        }
      } catch {
        /* Fall back to preset */
      }
    }

    if (!measured) {
      switch (position) {
        case 'south':
          target = { x: vw / 2, y: vh - 120, z: 0 };
          break;
        case 'north':
          target = { x: vw / 2, y: 120, z: 0 };
          break;
        case 'east':
          target = { x: vw - 140, y: vh / 2, z: 0 };
          break;
        case 'west':
          target = { x: 140, y: vh / 2, z: 0 };
          break;
        case 'center':
        default:
          target = { x: vw / 2, y: vh / 2 - 80, z: 0 };
          break;
      }
    }

    return {
      seatId,
      seatIndex: index,
      position,
      isHuman,
      target,
      measured,
    };
  });
}

/* ------------------------- Round-Robin Scheduler ------------------------ */

export function scheduleInitialDealCascade(options: DealCascadeOptions): DealCascadePlan {
  const runId = options.runId || `deal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const seatIds = Array.from(new Set(options.seatIds || []));
  const humanSeatId = options.humanSeatId || '';

  if (seatIds.length === 0) {
    return {
      runId,
      seats: [],
      flights: [],
      cardsPerSeat: 0,
      dealStaggerMs: 0,
      flightDurationMs: 0,
      totalDurationMs: 0,
      reducedMotion: Boolean(options.reducedMotion),
    };
  }

  const cardsPerSeat = Math.max(1, Math.min(10, options.cardsPerSeat || DEAL_FLIGHT_DEFAULTS.cardsPerSeat));
  const flightDurationMs = Math.max(100, options.flightDurationMs || DEAL_FLIGHT_DEFAULTS.flightDurationMs);
  const arcHeightPx = options.arcHeightPx || DEAL_FLIGHT_DEFAULTS.arcHeightPx;
  const reducedMotion = Boolean(options.reducedMotion);

  const seats = resolveSeatTargets(seatIds, humanSeatId, options.doc);
  const seatCount = seats.length;
  const flightCount = seatCount * cardsPerSeat;

  let dealStaggerMs = reducedMotion ? 0 : Math.max(10, options.dealStaggerMs || DEAL_FLIGHT_DEFAULTS.dealStaggerMs);

  // Apply 5-seat stagger compression if total duration would exceed maxCascadeMs
  if (!reducedMotion && flightCount > 1) {
    const rawDuration = (flightCount - 1) * dealStaggerMs + flightDurationMs + DEAL_FLIGHT_DEFAULTS.landSettleMs;
    if (rawDuration > DEAL_FLIGHT_DEFAULTS.maxCascadeMs) {
      const allowedSpan = DEAL_FLIGHT_DEFAULTS.maxCascadeMs - flightDurationMs - DEAL_FLIGHT_DEFAULTS.landSettleMs;
      dealStaggerMs = Math.max(20, Math.floor(allowedSpan / (flightCount - 1)));
    }
  }

  const from = resolveDeckOrigin(options.doc);
  const flights: DealCardFlight[] = [];

  if (!reducedMotion) {
    for (let round = 0; round < cardsPerSeat; round++) {
      for (let sIdx = 0; sIdx < seatCount; sIdx++) {
        const seat = seats[sIdx];
        const dealIndex = round * seatCount + sIdx;
        const startAtMs = dealIndex * dealStaggerMs;
        const spinDeg = (sIdx % 2 === 0 ? 1 : -1) * DEAL_FLIGHT_DEFAULTS.spinDegPerFlight * (1 + round * 0.15);
        const faceUp = seat.isHuman;

        const control = buildArcControlPoint(from, seat.target, arcHeightPx);

        flights.push({
          id: `${runId}:${seat.seatId}:${round}`,
          runId,
          seatId: seat.seatId,
          seatIndex: sIdx,
          cardIndex: round,
          dealIndex,
          startAtMs,
          durationMs: flightDurationMs,
          from,
          control,
          to: seat.target,
          faceUp,
          spinDeg,
          scaleFrom: DEAL_FLIGHT_DEFAULTS.scaleFrom,
          scaleTo: DEAL_FLIGHT_DEFAULTS.scaleTo,
        });
      }
    }
  } else {
    // Generate 0-duration flights for reduced motion
    for (let round = 0; round < cardsPerSeat; round++) {
      for (let sIdx = 0; sIdx < seatCount; sIdx++) {
        const seat = seats[sIdx];
        const dealIndex = round * seatCount + sIdx;
        flights.push({
          id: `${runId}:${seat.seatId}:${round}`,
          runId,
          seatId: seat.seatId,
          seatIndex: sIdx,
          cardIndex: round,
          dealIndex,
          startAtMs: 0,
          durationMs: 0,
          from,
          control: from,
          to: seat.target,
          faceUp: seat.isHuman,
          spinDeg: 0,
          scaleFrom: 1,
          scaleTo: 1,
        });
      }
    }
  }

  const effectiveFlightDuration = reducedMotion ? 0 : flightDurationMs;
  const lastFlightStart = flights.length > 0 ? flights[flights.length - 1].startAtMs : 0;
  const totalDurationMs = reducedMotion ? 0 : lastFlightStart + effectiveFlightDuration + DEAL_FLIGHT_DEFAULTS.landSettleMs;

  return {
    runId,
    seats,
    flights,
    cardsPerSeat,
    dealStaggerMs,
    flightDurationMs: effectiveFlightDuration,
    totalDurationMs,
    reducedMotion,
  };
}

/* --------------------------- 3D Transform Builder ------------------------- */

export function buildCardTransform(input: {
  x: number;
  y: number;
  z?: number;
  rotateZ?: number;
  rotateY?: number;
  scale?: number;
}): string {
  const x = Number.isFinite(input.x) ? input.x : 0;
  const y = Number.isFinite(input.y) ? input.y : 0;
  const z = Number.isFinite(input.z) ? input.z! : 0;
  const rotateZ = Number.isFinite(input.rotateZ) ? input.rotateZ! : 0;
  const rotateY = Number.isFinite(input.rotateY) ? input.rotateY! : 0;
  const scale = Number.isFinite(input.scale) ? input.scale! : 1;

  return `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px) rotateZ(${rotateZ.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale(${scale.toFixed(2)})`;
}

export function buildFlightFrameTransform(
  flight: DealCardFlight,
  elapsedMs: number
): {
  transform: string;
  opacity: number;
  landed: boolean;
  progress: number;
} {
  if (elapsedMs < flight.startAtMs) {
    return {
      transform: buildCardTransform({
        x: flight.from.x,
        y: flight.from.y,
        z: flight.from.z,
        rotateZ: 0,
        rotateY: flight.faceUp ? 180 : 180,
        scale: flight.scaleFrom,
      }),
      opacity: 0,
      landed: false,
      progress: 0,
    };
  }

  const localMs = elapsedMs - flight.startAtMs;
  if (flight.durationMs <= 0 || localMs >= flight.durationMs) {
    return {
      transform: buildCardTransform({
        x: flight.to.x,
        y: flight.to.y,
        z: flight.to.z,
        rotateZ: 0,
        rotateY: getFlipAngle(1, flight.faceUp),
        scale: flight.scaleTo,
      }),
      opacity: 0,
      landed: true,
      progress: 1,
    };
  }

  const progress = clamp01(localMs / flight.durationMs);
  const eased = easeOutCubic(progress);

  const pos = calculateBezier3D(flight.from, flight.control, flight.to, eased);
  const rotateY = getFlipAngle(progress, flight.faceUp);
  const rotateZ = flight.spinDeg * (1 - progress);
  const scale = flight.scaleFrom + (flight.scaleTo - flight.scaleFrom) * progress;

  let opacity = 1;
  if (progress < 0.08) {
    opacity = progress / 0.08;
  } else if (progress > 0.88) {
    opacity = (1 - progress) / 0.12;
  }

  return {
    transform: buildCardTransform({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      rotateZ,
      rotateY,
      scale,
    }),
    opacity,
    landed: false,
    progress,
  };
}

/* -------------------------- Event & SFX Dispatch -------------------------- */

export function dispatchDealFlightEvent<T>(
  name: string,
  detail: T,
  target?: EventTarget
): boolean {
  if (typeof window === 'undefined' && !target) return false;
  const evtTarget = target || window;

  try {
    const CustomEventCtor =
      typeof CustomEvent === 'function'
        ? CustomEvent
        : (evtTarget as unknown as { CustomEvent?: typeof CustomEvent }).CustomEvent;
    if (!CustomEventCtor) return false;

    const event = new CustomEventCtor(name, {
      detail,
      bubbles: true,
      cancelable: true,
    });
    return evtTarget.dispatchEvent(event);
  } catch {
    return false;
  }
}

export function emitDealStart(plan: DealCascadePlan): void {
  dispatchDealFlightEvent(DEAL_FLIGHT_EVENTS.start, { runId: plan.runId, plan });
}

export function emitDealLand(runId: string, flight: DealCardFlight): void {
  dispatchDealFlightEvent(DEAL_FLIGHT_EVENTS.land, {
    runId,
    flightId: flight.id,
    seatId: flight.seatId,
    seatIndex: flight.seatIndex,
    cardIndex: flight.cardIndex,
    dealIndex: flight.dealIndex,
    faceUp: flight.faceUp,
  });
}

export function emitDealComplete(
  runId: string,
  summary: { dealt: number; durationMs: number; cancelled: boolean }
): void {
  dispatchDealFlightEvent(DEAL_FLIGHT_EVENTS.complete, {
    runId,
    ...summary,
  });
}

let lastLaunchSfxMs = 0;
let lastLandSfxMs = 0;

export function playDealLaunchSfx(): void {
  const now = Date.now();
  if (now - lastLaunchSfxMs < 60) return;
  lastLaunchSfxMs = now;

  try {
    const sfxRecord = sfx as unknown as Record<string, (() => void) | undefined>;
    if (typeof sfxRecord.playCardFlip === 'function') {
      sfxRecord.playCardFlip();
    } else if (typeof sfx.playCardDraw === 'function') {
      sfx.playCardDraw();
    }
  } catch {
    /* Ignore audio context suspension */
  }
}

export function playDealLandSfx(): void {
  const now = Date.now();
  if (now - lastLandSfxMs < 60) return;
  lastLandSfxMs = now;

  try {
    if (typeof sfx.playCardPlay === 'function') {
      sfx.playCardPlay();
    }
  } catch {
    /* Ignore audio context suspension */
  }
}
