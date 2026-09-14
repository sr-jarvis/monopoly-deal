/**
 * cardDiscardFlightEngine.ts — Monopoly Deal 3D Card Discard & Hand Over-Limit Cascade Flight Engine.
 *
 * Pure-math Bezier trajectory calculator, organic scatter angle generator, cascade scheduler, 3D transform builder, and event engine.
 * Handles player hand over-limit discards and card play discard actions across 2 to 5 player seats.
 *
 * Features:
 *   - Spatial coordinate mapping from seat hand containers to Central Discard Pile (data-discard-pile).
 *   - 3D parabolic Bezier curve math (calculateDiscardBezier3D) with arcHeightPx: 120px spatial arc elevation.
 *   - Organic Z-axis scatter angle generator (getDiscardScatterAngle) using FNV-1a hash (-25deg to +25deg).
 *   - Multi-card cascade scheduler (scheduleDiscardCascade) for 1..5 over-limit discarded cards with discardStaggerMs: 120ms and 2500ms cap.
 *   - WebAudio SFX synchronization (playCardPlay(), playCardFlip()).
 *   - Custom DOM event bus dispatching (md:carddiscardflight:start, md:carddiscardflight:land, md:carddiscardflight:complete).
 *   - Hardware-accelerated 3D CSS transforms (translate3d, rotateZ, rotateY, scale).
 */

import * as sfx from './soundEngine';

/* ---------------------------------- Types --------------------------------- */

export type DiscardReason = 'over-limit' | 'play-discard' | 'turn-end';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface FlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiscardFlightFrame {
  x: number;
  y: number;
  z: number;
  rotateZ: number;
  rotateY: number;
  scale: number;
  progress: number;
  opacity: number;
}

export interface DiscardFlightPlan {
  flightId: string;
  cascadeId: string;
  cardId: string;
  cardLabel?: string;
  seatId: string;
  index: number;
  total: number;
  from: FlightRect;
  to: FlightRect;
  delayMs: number;
  durationMs: number;
  arcHeightPx: number;
  scatterDeg: number;
  flipFromDeg: number;
  flipToDeg: number;
  reducedMotion: boolean;
  reason: DiscardReason;
}

export interface DiscardCascadeOptions {
  cardIds: string[];
  seatId: string;
  reason?: DiscardReason;
  faceUpSource?: boolean;
  sourceRects?: FlightRect[];
  discardStaggerMs?: number;
  baseDurationMs?: number;
  arcHeightPx?: number;
  reducedMotion?: boolean;
  cascadeId?: string;
  doc?: Document;
  now?: number;
}

export interface CascadeHandle {
  cascadeId: string;
  plans: DiscardFlightPlan[];
  totalDurationMs: number;
  cancel: () => void;
}

/* -------------------------------- Constants ------------------------------- */

export const DISCARD_FLIGHT_CONFIG = {
  baseDurationMs: 620,
  arcHeightPx: 120,
  discardStaggerMs: 120,
  maxCascadeCards: 5,
  maxCascadeDurationMs: 2500,
  scatterMinDeg: -25,
  scatterMaxDeg: 25,
  launchScale: 1.08,
  landingScale: 0.86,
  settleMs: 140,
  watchdogGraceMs: 800,
} as const;

export const DISCARD_FLIGHT_EVENTS = {
  start: 'md:carddiscardflight:start',
  land: 'md:carddiscardflight:land',
  complete: 'md:carddiscardflight:complete',
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

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

/**
 * Evaluates 3D parabolic Bezier curve point for card discard flight trajectory.
 */
export function calculateDiscardBezier3D(
  from: Point3D,
  to: Point3D,
  t: number,
  arcHeightPx: number = DISCARD_FLIGHT_CONFIG.arcHeightPx
): Point3D {
  const u = clamp01(t);
  if (u === 0) return { x: from.x, y: from.y, z: from.z };
  if (u === 1) return { x: to.x, y: to.y, z: to.z };

  const control: Point3D = {
    x: (from.x + to.x) / 2,
    y: Math.min(from.y, to.y) - arcHeightPx,
    z: arcHeightPx * 0.5,
  };

  const oneMinusU = 1 - u;
  const uu = oneMinusU * oneMinusU;
  const u2 = u * u;

  return {
    x: Math.round((uu * from.x + 2 * oneMinusU * u * control.x + u2 * to.x) * 100) / 100,
    y: Math.round((uu * from.y + 2 * oneMinusU * u * control.y + u2 * to.y) * 100) / 100,
    z: Math.round((uu * from.z + 2 * oneMinusU * u * control.z + u2 * to.z) * 100) / 100,
  };
}

/**
 * Generates a deterministic organic Z-axis scatter angle (-25deg to +25deg) based on card ID.
 */
export function getDiscardScatterAngle(cardId: string): number {
  if (!cardId) return 0;
  const s = String(cardId);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const norm = ((h >>> 0) % 10000) / 9999;
  const angle = DISCARD_FLIGHT_CONFIG.scatterMinDeg + norm * (DISCARD_FLIGHT_CONFIG.scatterMaxDeg - DISCARD_FLIGHT_CONFIG.scatterMinDeg);
  return Math.round(angle * 100) / 100;
}

/**
 * Formats values into clean, 2-decimal-place numbers and prevents -0 string formatting.
 */
function cleanNum(v: number, decimals: number = 2): string {
  const norm = Object.is(v, -0) ? 0 : v;
  return norm.toFixed(decimals);
}

/**
 * Formats a 3D discard flight frame into a hardware-accelerated 3D CSS transform string.
 */
export function frameToTransform(frame: DiscardFlightFrame): string {
  return `translate3d(${cleanNum(frame.x)}px, ${cleanNum(frame.y)}px, ${cleanNum(frame.z)}px) rotateZ(${cleanNum(frame.rotateZ)}deg) rotateY(${cleanNum(frame.rotateY)}deg) scale(${cleanNum(frame.scale, 3)})`;
}

/**
 * Evaluates the 3D frame state for a discard flight plan at a given elapsed time (in ms).
 */
export function evaluateDiscardFrame(
  plan: DiscardFlightPlan,
  elapsedMs: number
): DiscardFlightFrame {
  const p = clamp01((elapsedMs - plan.delayMs) / plan.durationMs);
  const easePos = easeInOutCubic(p);

  const fromPt: Point3D = {
    x: plan.from.x + plan.from.w / 2,
    y: plan.from.y + plan.from.h / 2,
    z: 0,
  };
  const toPt: Point3D = {
    x: plan.to.x + plan.to.w / 2,
    y: plan.to.y + plan.to.h / 2,
    z: 0,
  };

  const pos = calculateDiscardBezier3D(fromPt, toPt, easePos, plan.arcHeightPx);

  const easeRot = easeOutCubic(p);
  const rotateZ = lerp(0, plan.scatterDeg, easeRot);

  const flipEase = clamp01(p / 0.6);
  const rotateY = lerp(plan.flipFromDeg, plan.flipToDeg, easeInOutCubic(flipEase));

  let scale: number = DISCARD_FLIGHT_CONFIG.launchScale;
  if (p < 0.5) {
    scale = lerp(1, DISCARD_FLIGHT_CONFIG.launchScale, p * 2);
  } else {
    scale = lerp(DISCARD_FLIGHT_CONFIG.launchScale, DISCARD_FLIGHT_CONFIG.landingScale, (p - 0.5) * 2);
  }

  let opacity = 1;
  if (p >= 1) {
    const postProgress = clamp01((elapsedMs - plan.delayMs - plan.durationMs) / DISCARD_FLIGHT_CONFIG.settleMs);
    opacity = 1 - postProgress;
  }

  return {
    x: pos.x,
    y: pos.y,
    z: pos.z,
    rotateZ,
    rotateY,
    scale,
    progress: p,
    opacity,
  };
}

/* ----------------------------- DOM Resolvers ------------------------------ */

export function resolveDiscardEndpoints(
  seatId: string,
  cardId?: string,
  doc?: Document
): { from: FlightRect; to: FlightRect } {
  const activeDoc = doc || (typeof document !== 'undefined' ? document : null);
  const defaultRect: FlightRect = {
    x: typeof window !== 'undefined' ? window.innerWidth / 2 - 40 : 300,
    y: typeof window !== 'undefined' ? window.innerHeight - 100 : 500,
    w: 80,
    h: 110,
  };

  if (!activeDoc) {
    return { from: defaultRect, to: defaultRect };
  }

  let fromRect: FlightRect | null = null;

  if (cardId) {
    const cardEl = activeDoc.querySelector(`[data-card-id="${cardId}"]`);
    if (cardEl) {
      const r = cardEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        fromRect = { x: r.left, y: r.top, w: r.width, h: r.height };
      }
    }
  }

  if (!fromRect && seatId) {
    const handContainer = activeDoc.querySelector(`[data-hand-container][data-seat-id="${seatId}"]`);
    if (handContainer) {
      const r = handContainer.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        fromRect = { x: r.left + r.width / 2 - 40, y: r.top + r.height / 2 - 55, w: 80, h: 110 };
      }
    }
  }

  if (!fromRect && seatId) {
    const seatEl = activeDoc.querySelector(`[data-seat-id="${seatId}"]`);
    if (seatEl) {
      const r = seatEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        fromRect = { x: r.left + r.width / 2 - 40, y: r.top + r.height / 2 - 55, w: 80, h: 110 };
      }
    }
  }

  if (!fromRect) {
    fromRect = defaultRect;
  }

  let toRect: FlightRect | null = null;
  const discardPileEl = activeDoc.querySelector('[data-discard-pile]');
  if (discardPileEl) {
    const r = discardPileEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      toRect = { x: r.left, y: r.top, w: r.width, h: r.height };
    }
  }

  if (!toRect) {
    toRect = {
      x: typeof window !== 'undefined' ? window.innerWidth / 2 - 40 : 350,
      y: typeof window !== 'undefined' ? window.innerHeight / 2 - 55 : 250,
      w: 80,
      h: 110,
    };
  }

  return { from: fromRect, to: toRect };
}

/* ----------------------------- Event Dispatch ----------------------------- */

function emitEvent(name: string, detail: unknown) {
  if (typeof window === 'undefined') return;
  try {
    const event = new CustomEvent(name, { detail });
    window.dispatchEvent(event);
  } catch {
    // Fail-safe audio/DOM event catch
  }
}

/* ---------------------------- Cascade Scheduler --------------------------- */

/**
 * Schedules a multi-card discard flight cascade.
 */
export function scheduleDiscardCascade(options: DiscardCascadeOptions): CascadeHandle {
  const {
    cardIds,
    seatId,
    reason = 'over-limit',
    faceUpSource = true,
    sourceRects,
    discardStaggerMs = DISCARD_FLIGHT_CONFIG.discardStaggerMs,
    baseDurationMs = DISCARD_FLIGHT_CONFIG.baseDurationMs,
    arcHeightPx = DISCARD_FLIGHT_CONFIG.arcHeightPx,
    reducedMotion = false,
    cascadeId = `cascade_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    doc,
  } = options;

  const count = cardIds.length;
  if (count === 0) {
    if (typeof Promise !== 'undefined') {
      Promise.resolve().then(() => {
        emitEvent(DISCARD_FLIGHT_EVENTS.complete, {
          cascadeId,
          seatId,
          reason,
          cardIds: [],
          totalDurationMs: 0,
          aborted: false,
        });
      });
    }
    return { cascadeId, plans: [], totalDurationMs: 0, cancel: () => {} };
  }

  const staggeredCount = Math.min(count, DISCARD_FLIGHT_CONFIG.maxCascadeCards);
  const rawTotal = (staggeredCount - 1) * discardStaggerMs + baseDurationMs;
  const compressionFactor = rawTotal <= DISCARD_FLIGHT_CONFIG.maxCascadeDurationMs
    ? 1
    : DISCARD_FLIGHT_CONFIG.maxCascadeDurationMs / rawTotal;

  const actualStagger = Math.floor(discardStaggerMs * compressionFactor);
  const actualDuration = Math.floor(baseDurationMs * compressionFactor);

  const plans: DiscardFlightPlan[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];

  for (let i = 0; i < count; i++) {
    const cardId = cardIds[i];
    const flightId = `${cascadeId}:${i}`;

    let endpoints: { from: FlightRect; to: FlightRect };
    if (sourceRects && sourceRects[i] && sourceRects[i].w > 0) {
      const resolved = resolveDiscardEndpoints(seatId, cardId, doc);
      endpoints = { from: sourceRects[i], to: resolved.to };
    } else {
      endpoints = resolveDiscardEndpoints(seatId, cardId, doc);
    }

    const staggerIdx = Math.min(i, DISCARD_FLIGHT_CONFIG.maxCascadeCards - 1);
    const delayMs = staggerIdx * actualStagger;
    const scatterDeg = getDiscardScatterAngle(cardId);

    const plan: DiscardFlightPlan = {
      flightId,
      cascadeId,
      cardId,
      seatId,
      index: i,
      total: count,
      from: endpoints.from,
      to: endpoints.to,
      delayMs: reducedMotion ? 0 : delayMs,
      durationMs: reducedMotion ? 0 : actualDuration,
      arcHeightPx,
      scatterDeg,
      flipFromDeg: faceUpSource ? 0 : 180,
      flipToDeg: 0,
      reducedMotion,
      reason,
    };

    plans.push(plan);
  }

  const totalDurationMs = reducedMotion
    ? 0
    : Math.min(count - 1, DISCARD_FLIGHT_CONFIG.maxCascadeCards - 1) * actualStagger + actualDuration;

  let isCancelled = false;

  const cancel = () => {
    if (isCancelled) return;
    isCancelled = true;
    timers.forEach((t) => clearTimeout(t));
    emitEvent(DISCARD_FLIGHT_EVENTS.complete, {
      cascadeId,
      seatId,
      reason,
      cardIds,
      totalDurationMs,
      aborted: true,
    });
  };

  if (reducedMotion) {
    plans.forEach((p) => emitEvent(DISCARD_FLIGHT_EVENTS.start, p));
    emitEvent(DISCARD_FLIGHT_EVENTS.complete, {
      cascadeId,
      seatId,
      reason,
      cardIds,
      totalDurationMs: 0,
      aborted: false,
    });
    return { cascadeId, plans, totalDurationMs: 0, cancel };
  }

  // Schedule launch events and SFX
  plans.forEach((plan) => {
    const timer = setTimeout(() => {
      if (isCancelled) return;
      try {
        sfx.playCardPlay();
      } catch {}
      emitEvent(DISCARD_FLIGHT_EVENTS.start, plan);
    }, plan.delayMs);
    timers.push(timer);
  });

  // Schedule cascade completion
  const completeTimer = setTimeout(() => {
    if (isCancelled) return;
    emitEvent(DISCARD_FLIGHT_EVENTS.complete, {
      cascadeId,
      seatId,
      reason,
      cardIds,
      totalDurationMs,
      aborted: false,
    });
  }, totalDurationMs + DISCARD_FLIGHT_CONFIG.settleMs);
  timers.push(completeTimer);

  return { cascadeId, plans, totalDurationMs, cancel };
}
