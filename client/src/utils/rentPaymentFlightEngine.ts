/**
 * Monopoly Deal 3D Rent Charge & Multi-Seat Target Payment Cascade Flight Animation Engine
 * Pure mathematical Bezier trajectory calculator, spatial arc math, multi-seat payment cascade scheduler,
 * speed scaler, hardware-accelerated 3D transform builder, event engine, and WebAudio SFX synchronization hooks.
 */

import { playCardPlay, playCardFlip, playRentPayment, playMoneyBank } from './soundEngine';

export type FlightSpeed = 'slow' | 'normal' | 'fast' | 'turbo';
export type LegPhase = 'charge' | 'payment' | 'settle';
export type PaymentCardKind = 'cash' | 'property' | 'action';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface PaymentCardSpec {
  cardId: string;
  label?: string;
  name?: string;
  value?: number;
  kind?: PaymentCardKind;
  colorHint?: string;
}

export interface FlightLeg {
  legId: string;
  planId: string;
  phase: LegPhase;
  seatId: string;
  seatIndex: number;
  cardIndex: number;
  card: PaymentCardSpec | null;
  from: Point3D;
  to: Point3D;
  control1: Point3D;
  control2: Point3D;
  startDelayMs: number;
  durationMs: number;
  scatterDeg: number;
  flips: boolean;
}

export interface RentPaymentPlan {
  planId: string;
  chargerSeatId: string;
  amountDue: number;
  speed: FlightSpeed;
  legs: FlightLeg[];
  totalDurationMs: number;
  compressed: boolean;
  unresolvedSeats: string[];
}

export interface FlightFrame {
  x: number;
  y: number;
  z: number;
  rotateZ: number;
  rotateY: number;
  scale: number;
  opacity: number;
  progress: number;
  active: boolean;
}

export interface PaymentTargetSpec {
  seatId: string;
  cards: PaymentCardSpec[];
}

export interface ScheduleParams {
  planId?: string;
  chargerSeatId: string;
  amountDue: number;
  payments: PaymentTargetSpec[];
  speed?: FlightSpeed;
  doc?: Document;
}

// Exported Constants
export const PAYMENT_ARC_HEIGHT_PX = 140;
export const PAYMENT_DEPTH_Z_PX = 180;
export const SEAT_BOW_BASE_PX = 40;
export const SEAT_CASCADE_STAGGER_MS = 260;
export const CARD_STAGGER_MS = 110;
export const CHARGE_PULSE_MS = 420;
export const PAYMENT_GAP_MS = 80;
export const BASE_FLIGHT_MS = 760;
export const SETTLE_MS = 240;
export const MIN_FLIGHT_MS = 180;
export const MAX_TOTAL_DURATION_MS = 5200;
export const MAX_CONCURRENT_FLIGHTS = 24;
export const WATCHDOG_GRACE_MS = 2000;
export const SCATTER_RANGE_DEG = 18;

export const SPEED_SCALARS: Record<FlightSpeed, number> = {
  slow: 1.6,
  normal: 1.0,
  fast: 0.62,
  turbo: 0.38,
};

export const RENT_PAYMENT_EVENTS = {
  start: 'md:rentpayment:start',
  charge: 'md:rentpayment:charge',
  land: 'md:rentpayment:land',
  complete: 'md:rentpayment:complete',
  cancel: 'md:rentpayment:cancel',
} as const;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function safeNum(v: number | undefined, fallback = 0): number {
  return v !== undefined && Number.isFinite(v) ? v : fallback;
}

/**
 * Evaluates a 3D cubic Bezier curve at t in [0,1].
 * Bernstein polynomial evaluation preserves exact endpoints.
 */
export function cubicBezier3D(
  p0: Point3D,
  p1: Point3D,
  p2: Point3D,
  p3: Point3D,
  tRaw: number
): Point3D {
  const t = clamp01(tRaw);
  const u = 1 - t;
  const u2 = u * u;
  const u3 = u2 * u;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: safeNum(u3 * p0.x + 3 * u2 * t * p1.x + 3 * u * t2 * p2.x + t3 * p3.x),
    y: safeNum(u3 * p0.y + 3 * u2 * t * p1.y + 3 * u * t2 * p2.y + t3 * p3.y),
    z: safeNum(u3 * p0.z + 3 * u2 * t * p1.z + 3 * u * t2 * p2.z + t3 * p3.z),
  };
}

/**
 * Deterministic FNV-1a hash mapping cardId to a scatter angle in [-SCATTER_RANGE_DEG, +SCATTER_RANGE_DEG].
 */
export function getPaymentScatterAngle(cardId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < cardId.length; i++) {
    hash ^= cardId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const normalized = ((hash >>> 0) % 1000) / 1000; // [0, 1)
  const angle = (normalized * 2 - 1) * SCATTER_RANGE_DEG;
  return Math.round(angle * 10) / 10;
}

/**
 * Builds control points for a 3D parabolic payment arc with multi-seat fanning.
 */
export function buildPaymentArc(
  from: Point3D,
  to: Point3D,
  opts?: { arcHeightPx?: number; depthPx?: number; bowPx?: number }
): [Point3D, Point3D, Point3D, Point3D] {
  const arcH = opts?.arcHeightPx ?? PAYMENT_ARC_HEIGHT_PX;
  const depthZ = opts?.depthPx ?? PAYMENT_DEPTH_Z_PX;
  const bow = opts?.bowPx ?? 0;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);

  let perpX = 0;
  let perpY = 0;
  if (dist > 1) {
    perpX = -dy / dist;
    perpY = dx / dist;
  }

  const p0: Point3D = { x: from.x, y: from.y, z: from.z };
  const p1: Point3D = {
    x: from.x + 0.28 * dx + perpX * bow,
    y: from.y + 0.28 * dy - arcH + perpY * bow,
    z: Math.max(from.z, to.z) + 0.8 * depthZ,
  };
  const p2: Point3D = {
    x: from.x + 0.72 * dx + perpX * (0.5 * bow),
    y: from.y + 0.72 * dy - 0.72 * arcH + perpY * (0.5 * bow),
    z: Math.max(from.z, to.z) + 0.45 * depthZ,
  };
  const p3: Point3D = { x: to.x, y: to.y, z: to.z };

  return [p0, p1, p2, p3];
}

export function scaleAt(t: number): number {
  const clampedT = clamp01(t);
  return safeNum(0.88 + 0.34 * Math.sin(Math.PI * clampedT), 1.0);
}

export function opacityAt(t: number): number {
  const clampedT = clamp01(t);
  if (clampedT < 0.9) return 1.0;
  return safeNum(1.0 - (clampedT - 0.9) / 0.1, 1.0);
}

export function rotateYAt(t: number, flips: boolean): number {
  if (!flips) return 0;
  const clampedT = clamp01(t);
  const flipProgress = clamp01((clampedT - 0.15) / 0.5);
  return safeNum(180 * flipProgress, 0);
}

export function rotateZAt(t: number, scatterDeg: number): number {
  const clampedT = clamp01(t);
  // Ease out cubic
  const ease = 1 - Math.pow(1 - clampedT, 3);
  return safeNum(scatterDeg * ease, 0);
}

/**
 * Samples a flight frame at elapsedMs for a given flight leg.
 */
export function sampleFlightFrame(leg: FlightLeg, elapsedMs: number): FlightFrame {
  const localElapsed = elapsedMs - leg.startDelayMs;
  if (localElapsed < 0) {
    return {
      x: leg.from.x,
      y: leg.from.y,
      z: leg.from.z,
      rotateZ: 0,
      rotateY: 0,
      scale: 0.88,
      opacity: 0,
      progress: 0,
      active: false,
    };
  }

  if (localElapsed >= leg.durationMs) {
    return {
      x: leg.to.x,
      y: leg.to.y,
      z: leg.to.z,
      rotateZ: leg.scatterDeg,
      rotateY: leg.flips ? 180 : 0,
      scale: 1.0,
      opacity: 0,
      progress: 1.0,
      active: false,
    };
  }

  const progress = clamp01(localElapsed / leg.durationMs);
  const pos = cubicBezier3D(leg.from, leg.control1, leg.control2, leg.to, progress);

  return {
    x: pos.x,
    y: pos.y,
    z: pos.z,
    rotateZ: rotateZAt(progress, leg.scatterDeg),
    rotateY: rotateYAt(progress, leg.flips),
    scale: scaleAt(progress),
    opacity: opacityAt(progress),
    progress,
    active: true,
  };
}

/**
 * Formats a 3D frame into hardware-accelerated CSS transform string.
 */
export function frameToTransform(f: FlightFrame): string {
  const x = safeNum(f.x).toFixed(2);
  const y = safeNum(f.y).toFixed(2);
  const z = safeNum(f.z).toFixed(2);
  const rZ = safeNum(f.rotateZ).toFixed(2);
  const rY = safeNum(f.rotateY).toFixed(2);
  const sc = safeNum(f.scale).toFixed(3);

  return `translate3d(${x}px, ${y}px, ${z}px) rotateZ(${rZ}deg) rotateY(${rY}deg) scale(${sc})`;
}

/**
 * Resolves spatial DOM coordinates for a seat or zone.
 */
export function resolveSeatAnchor(
  seatId: string,
  zone: 'bank' | 'properties' | 'hand' | 'seat',
  doc: Document = typeof document !== 'undefined' ? document : (null as unknown as Document)
): { point: Point3D; rect: DOMRect | null; resolved: boolean } {
  if (!doc) {
    return { point: { x: 400, y: 300, z: 0 }, rect: null, resolved: false };
  }

  const selectors = [
    `[data-md-seat="${seatId}"] [data-md-zone="${zone}"]`,
    `[data-md-seat="${seatId}"] [data-md-zone="bank"]`,
    `[data-md-seat="${seatId}"]`,
    `[data-seat-id="${seatId}"]`,
  ];

  for (const selector of selectors) {
    const el = doc.querySelector(selector);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          point: {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            z: 0,
          },
          rect,
          resolved: true,
        };
      }
    }
  }

  // Viewport center fallback
  const vw = doc.documentElement?.clientWidth || 800;
  const vh = doc.documentElement?.clientHeight || 600;
  return {
    point: { x: vw / 2, y: vh / 2, z: 0 },
    rect: null,
    resolved: false,
  };
}

/**
 * Schedules a multi-seat rent payment flight plan with parabolic arcs, staggers, and duration caps.
 */
export function scheduleRentPaymentCascade(params: ScheduleParams): RentPaymentPlan {
  const doc = params.doc || (typeof document !== 'undefined' ? document : (null as unknown as Document));
  const planId = params.planId || `rentpay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const speed = params.speed || 'normal';
  const speedScalar = SPEED_SCALARS[speed] || 1.0;

  const chargerAnchor = resolveSeatAnchor(params.chargerSeatId, 'bank', doc);
  const unresolvedSeats: string[] = [];
  if (!chargerAnchor.resolved) {
    unresolvedSeats.push(params.chargerSeatId);
  }

  const legs: FlightLeg[] = [];
  let maxEndTimeMs = 0;

  params.payments.forEach((target, seatIndex) => {
    const targetSeatAnchor = resolveSeatAnchor(target.seatId, 'seat', doc);
    const targetBankAnchor = resolveSeatAnchor(target.seatId, 'bank', doc);
    if (!targetSeatAnchor.resolved) {
      unresolvedSeats.push(target.seatId);
    }

    const seatStartMs = seatIndex * SEAT_CASCADE_STAGGER_MS;
    const chargeEndMs = seatStartMs + CHARGE_PULSE_MS;

    // Fanning bow for multi-seat separation
    const bowSign = seatIndex % 2 === 0 ? 1 : -1;
    const bowPx = SEAT_BOW_BASE_PX * Math.ceil((seatIndex + 1) / 2) * bowSign;

    // 1. Charge pulse leg from charger to target seat
    const [c0, c1, c2, c3] = buildPaymentArc(chargerAnchor.point, targetSeatAnchor.point, {
      arcHeightPx: PAYMENT_ARC_HEIGHT_PX * 0.8,
      bowPx: bowPx * 0.5,
    });

    const chargeLegId = `${planId}:${target.seatId}:charge:0`;
    legs.push({
      legId: chargeLegId,
      planId,
      phase: 'charge',
      seatId: target.seatId,
      seatIndex,
      cardIndex: 0,
      card: null,
      from: c0,
      to: c3,
      control1: c1,
      control2: c2,
      startDelayMs: seatStartMs * speedScalar,
      durationMs: CHARGE_PULSE_MS * speedScalar,
      scatterDeg: 0,
      flips: false,
    });

    // 2. Payment card legs from target bank to charger bank
    target.cards.forEach((card, cardIndex) => {
      const cardStartMs = chargeEndMs + PAYMENT_GAP_MS + cardIndex * CARD_STAGGER_MS;
      const baseFlightMs = BASE_FLIGHT_MS;
      const legStartMs = cardStartMs * speedScalar;
      const legDurationMs = baseFlightMs * speedScalar;

      const [p0, p1, p2, p3] = buildPaymentArc(targetBankAnchor.point, chargerAnchor.point, {
        arcHeightPx: PAYMENT_ARC_HEIGHT_PX,
        bowPx,
      });

      const legId = `${planId}:${target.seatId}:payment:${cardIndex}:${card.cardId}`;
      const scatterDeg = getPaymentScatterAngle(card.cardId);
      const flips = card.kind === 'cash' || !card.kind;

      legs.push({
        legId,
        planId,
        phase: 'payment',
        seatId: target.seatId,
        seatIndex,
        cardIndex,
        card,
        from: p0,
        to: p3,
        control1: p1,
        control2: p2,
        startDelayMs: legStartMs,
        durationMs: legDurationMs,
        scatterDeg,
        flips,
      });

      const legEndMs = legStartMs + legDurationMs;
      if (legEndMs > maxEndTimeMs) {
        maxEndTimeMs = legEndMs;
      }
    });
  });

  // Calculate uncompressed raw duration
  let rawDurationMs = maxEndTimeMs + SETTLE_MS * speedScalar;
  let compressed = false;

  // Compression check if total duration exceeds MAX_TOTAL_DURATION_MS
  if (rawDurationMs > MAX_TOTAL_DURATION_MS) {
    compressed = true;
    const compressionFactor = MAX_TOTAL_DURATION_MS / rawDurationMs;

    legs.forEach((leg) => {
      leg.startDelayMs = Math.round(leg.startDelayMs * compressionFactor);
      leg.durationMs = Math.max(MIN_FLIGHT_MS, Math.round(leg.durationMs * compressionFactor));
    });

    // Recalculate true total duration after clamping
    let newMaxEnd = 0;
    legs.forEach((leg) => {
      const end = leg.startDelayMs + leg.durationMs;
      if (end > newMaxEnd) newMaxEnd = end;
    });
    rawDurationMs = newMaxEnd + Math.max(80, Math.round(SETTLE_MS * compressionFactor));
  }

  // Cap max concurrent flight legs
  if (legs.length > MAX_CONCURRENT_FLIGHTS) {
    legs.splice(MAX_CONCURRENT_FLIGHTS);
  }

  // Stable sort by startDelayMs asc
  legs.sort((a, b) => {
    if (a.startDelayMs !== b.startDelayMs) return a.startDelayMs - b.startDelayMs;
    if (a.seatIndex !== b.seatIndex) return a.seatIndex - b.seatIndex;
    return a.cardIndex - b.cardIndex;
  });

  return {
    planId,
    chargerSeatId: params.chargerSeatId,
    amountDue: params.amountDue,
    speed,
    legs,
    totalDurationMs: Math.round(rawDurationMs),
    compressed,
    unresolvedSeats: Array.from(new Set(unresolvedSeats)),
  };
}

/**
 * Custom event helper functions.
 */
export function dispatchRentPaymentStart(
  detail: {
    planId?: string;
    chargerSeatId: string;
    amountDue: number;
    payments: PaymentTargetSpec[];
    speed?: FlightSpeed;
  },
  target: EventTarget = typeof window !== 'undefined' ? window : (null as unknown as EventTarget)
): void {
  if (!target) return;
  const evt = new CustomEvent(RENT_PAYMENT_EVENTS.start, {
    detail,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(evt);
}

export function dispatchRentPaymentCancel(
  detail: { planId: string; reason?: string },
  target: EventTarget = typeof window !== 'undefined' ? window : (null as unknown as EventTarget)
): void {
  if (!target) return;
  const evt = new CustomEvent(RENT_PAYMENT_EVENTS.cancel, {
    detail,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(evt);
}

export function onRentPaymentStart(
  handler: (evt: CustomEvent) => void,
  target: EventTarget = typeof window !== 'undefined' ? window : (null as unknown as EventTarget)
): () => void {
  if (!target) return () => {};
  const listener = (e: Event) => handler(e as CustomEvent);
  target.addEventListener(RENT_PAYMENT_EVENTS.start, listener);
  return () => target.removeEventListener(RENT_PAYMENT_EVENTS.start, listener);
}

export function onRentPaymentCancel(
  handler: (evt: CustomEvent) => void,
  target: EventTarget = typeof window !== 'undefined' ? window : (null as unknown as EventTarget)
): () => void {
  if (!target) return () => {};
  const listener = (e: Event) => handler(e as CustomEvent);
  target.addEventListener(RENT_PAYMENT_EVENTS.cancel, listener);
  return () => target.removeEventListener(RENT_PAYMENT_EVENTS.cancel, listener);
}

/**
 * Builds WebAudio SFX cue sheet for a given flight plan.
 */
export interface SoundCueSheetItem {
  atMs: number;
  sound: 'playCardPlay' | 'playCardFlip' | 'playCoins' | 'playPaymentComplete';
}

export function buildSfxCueSheet(plan: RentPaymentPlan): SoundCueSheetItem[] {
  const cues: SoundCueSheetItem[] = [];
  let lastCoinMs = -100;

  plan.legs.forEach((leg) => {
    if (leg.phase === 'charge') {
      cues.push({ atMs: Math.round(leg.startDelayMs), sound: 'playCardPlay' });
    } else if (leg.phase === 'payment') {
      if (leg.flips) {
        cues.push({ atMs: Math.round(leg.startDelayMs + leg.durationMs * 0.15), sound: 'playCardFlip' });
      }
      const landMs = Math.round(leg.startDelayMs + leg.durationMs);
      if (landMs - lastCoinMs >= 90) {
        cues.push({ atMs: landMs, sound: 'playCoins' });
        lastCoinMs = landMs;
      }
    }
  });

  cues.push({ atMs: Math.round(plan.totalDurationMs), sound: 'playPaymentComplete' });
  cues.sort((a, b) => a.atMs - b.atMs);
  return cues;
}

/**
 * Creates WebAudio SFX scheduler for running a flight plan.
 */
export function createSfxScheduler(opts?: { muted?: boolean }) {
  let isMuted = opts?.muted ?? false;
  let playedSet = new Set<number>();

  return {
    setMuted(muted: boolean) {
      isMuted = muted;
    },
    run(plan: RentPaymentPlan) {
      if (isMuted) return;
      const cueSheet = buildSfxCueSheet(plan);
      playedSet = new Set<number>();

      cueSheet.forEach((cue, idx) => {
        setTimeout(() => {
          if (isMuted || playedSet.has(idx)) return;
          playedSet.add(idx);
          if (cue.sound === 'playCardPlay') playCardPlay();
          else if (cue.sound === 'playCardFlip') playCardFlip();
          else if (cue.sound === 'playCoins') playRentPayment();
          else if (cue.sound === 'playPaymentComplete') playMoneyBank();
        }, cue.atMs);
      });
    },
    tick(elapsedMs: number, plan: RentPaymentPlan) {
      if (isMuted) return;
      const cueSheet = buildSfxCueSheet(plan);
      cueSheet.forEach((cue, idx) => {
        if (!playedSet.has(idx) && elapsedMs >= cue.atMs) {
          playedSet.add(idx);
          if (cue.sound === 'playCardPlay') playCardPlay();
          else if (cue.sound === 'playCardFlip') playCardFlip();
          else if (cue.sound === 'playCoins') playRentPayment();
          else if (cue.sound === 'playPaymentComplete') playMoneyBank();
        }
      });
    },
    cancel() {
      playedSet.clear();
    },
  };
}
