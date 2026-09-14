/**
 * cardDrawFlightEngine.ts — Monopoly Deal 3D Card Draw Flight & Pass Go Multi-Card Cascade Engine.
 *
 * Pure-math + event engine for card draw trajectories and multi-card cascades:
 *
 *   Draw Types:
 *     - 'standard-draw' : 2 cards drawn at turn start (Deck -> Hand)
 *     - 'pass-go-draw'  : 2 cards drawn on Pass Go action card play (Deck -> Hand)
 *     - 'empty-hand-draw': 5 cards drawn when starting turn with 0 cards (Deck -> Hand)
 *     - 'touch-swipe-draw': 1 or 2 cards drawn via direct touch swipe on deck stack
 *
 * Trajectory features:
 *   - 3D Cubic Bezier trajectories with spatial arc elevation (arcHeightPx)
 *   - 3D Y-axis card flips (180deg face down off deck -> 0deg face up in hand)
 *   - Staggered multi-card cascade scheduler (cascadeStaggerMs: 120ms)
 *   - Touch swipe gesture recognizer (>25px drag, >250px/s velocity)
 *   - Custom DOM event bus dispatching (md:carddrawflight:start, md:carddrawflight:land, md:carddrawflight:complete)
 *   - WebAudio SFX synchronization (playCardFlip(), playCardPlay())
 *   - Hardware-accelerated 3D transform formatting (translate3d, rotateZ, rotateY, scale)
 *
 * Framework-free, side-effect free at import time.
 */

import * as sfx from './soundEngine';

/* ---------------------------------- Types --------------------------------- */

export type DrawFlightKind =
  | 'standard-draw'
  | 'pass-go-draw'
  | 'empty-hand-draw'
  | 'touch-swipe-draw';

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export type Curve3D = [Point3D, Point3D, Point3D, Point3D];

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CardDrawFlightConfig {
  id: string;
  kind: DrawFlightKind;
  cardIndex: number;
  totalCards: number;
  label: string;
  color?: string | null;
  startPoint: Point3D;
  endPoint: Point3D;
  curve: Curve3D;
  durationMs: number;
  delayMs: number;
  startMs: number;
  landAtMs: number;
  endMs: number;
  rotateZFrom: number;
  rotateZTo: number;
  rotateYFrom: number;
  rotateYTo: number;
  scaleFrom: number;
  scaleTo: number;
  opacityFrom: number;
  opacityTo: number;
  arcHeightPx: number;
}

export interface DrawFlightFrame {
  x: number;
  y: number;
  z: number;
  rotateZ: number;
  rotateY: number;
  scale: number;
  opacity: number;
}

export interface TouchDrawSwipeGesture {
  isSwipe: boolean;
  direction: 'up' | 'down' | 'left' | 'right' | 'none';
  distancePx: number;
  velocityPxSec: number;
  durationMs: number;
}

export interface DrawFlightStartDetail {
  planId: string;
  kind: DrawFlightKind;
  ghostCount: number;
  totalDurationMs: number;
  ghosts: CardDrawFlightConfig[];
}

export interface DrawFlightLandDetail {
  planId: string;
  ghostId: string;
  cardIndex: number;
  kind: DrawFlightKind;
}

export interface DrawFlightCompleteDetail {
  planId: string;
  kind: DrawFlightKind;
  ghostCount: number;
}

/* ------------------------------- Math Engine ------------------------------ */

/**
 * Evaluate a 3D cubic Bezier curve at parameter t in [0, 1].
 */
export function cubicBezier3(p0: Point3D, p1: Point3D, p2: Point3D, p3: Point3D, t: number): Point3D {
  const u = 1 - Math.max(0, Math.min(1, t));
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    z: uuu * p0.z + 3 * uu * t * p1.z + 3 * u * tt * p2.z + ttt * p3.z,
  };
}

/**
 * Standard cubic ease-out function.
 */
export function easeOutCubic(t: number): number {
  const p = Math.max(0, Math.min(1, t)) - 1;
  return p * p * p + 1;
}

/**
 * Quadratic ease-in function.
 */
export function easeInQuad(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped;
}

/**
 * Linear interpolation between a and b.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Construct control points for 3D card draw arc from deck to hand.
 */
export function buildDrawFlightCurve(
  start: Point3D,
  end: Point3D,
  arcHeightPx: number = 140
): Curve3D {
  const midX = (start.x + end.x) / 2;

  // Elevate control points vertically and along Z for 3D arc effect
  const cp1: Point3D = {
    x: lerp(start.x, midX, 0.4),
    y: start.y - arcHeightPx,
    z: start.z + arcHeightPx * 0.8,
  };

  const cp2: Point3D = {
    x: lerp(midX, end.x, 0.6),
    y: end.y - arcHeightPx * 0.5,
    z: end.z + arcHeightPx * 0.4,
  };

  return [start, cp1, cp2, end];
}

/* -------------------------- Gesture Recognizer --------------------------- */

/**
 * Recognize a touch swipe-to-draw gesture on the deck stack.
 */
export function recognizeTouchDrawSwipe(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  durationMs: number,
  distanceThresholdPx: number = 25,
  velocityThresholdPxSec: number = 250
): TouchDrawSwipeGesture {
  const dx = endX - startX;
  const dy = endY - startY;
  const distancePx = Math.sqrt(dx * dx + dy * dy);
  const durSec = Math.max(0.001, durationMs / 1000);
  const velocityPxSec = distancePx / durSec;

  if (distancePx < distanceThresholdPx || velocityPxSec < velocityThresholdPxSec) {
    return {
      isSwipe: false,
      direction: 'none',
      distancePx,
      velocityPxSec,
      durationMs,
    };
  }

  let direction: 'up' | 'down' | 'left' | 'right' | 'none' = 'none';
  if (Math.abs(dx) > Math.abs(dy)) {
    direction = dx > 0 ? 'right' : 'left';
  } else {
    direction = dy > 0 ? 'down' : 'up';
  }

  return {
    isSwipe: true,
    direction,
    distancePx,
    velocityPxSec,
    durationMs,
  };
}

/* --------------------------- Flight Scheduler --------------------------- */

/**
 * Schedule a multi-card cascade draw flight plan.
 */
export function createCardDrawCascadePlan(
  kind: DrawFlightKind,
  cards: Array<{ label: string; color?: string | null }>,
  deckRect: RectLike,
  handRect: RectLike,
  options: {
    staggerMs?: number;
    flightDurationMs?: number;
    arcHeightPx?: number;
  } = {}
): CardDrawFlightConfig[] {
  const staggerMs = options.staggerMs ?? 120;
  const flightDurationMs = options.flightDurationMs ?? 420;
  const arcHeightPx = options.arcHeightPx ?? 140;

  const planId = `draw-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const totalCards = cards.length;

  const deckCenter: Point3D = {
    x: deckRect.left + deckRect.width / 2,
    y: deckRect.top + deckRect.height / 2,
    z: 0,
  };

  return cards.map((card, idx) => {
    // Calculate target hand position with fan-out spacing
    const handWidthFraction = Math.min(1, (idx + 1) / (totalCards + 1));
    const handX = handRect.left + handRect.width * handWidthFraction;
    const handY = handRect.top + handRect.height / 2;

    const handTarget: Point3D = {
      x: handX,
      y: handY,
      z: 0,
    };

    const curve = buildDrawFlightCurve(deckCenter, handTarget, arcHeightPx);
    const delayMs = idx * staggerMs;
    const startMs = delayMs;
    const landAtMs = startMs + flightDurationMs;
    const endMs = landAtMs;

    return {
      id: `${planId}-ghost-${idx}`,
      kind,
      cardIndex: idx,
      totalCards,
      label: card.label,
      color: card.color ?? null,
      startPoint: deckCenter,
      endPoint: handTarget,
      curve,
      durationMs: flightDurationMs,
      delayMs,
      startMs,
      landAtMs,
      endMs,
      rotateZFrom: (Math.random() - 0.5) * 20,
      rotateZTo: (Math.random() - 0.5) * 8,
      rotateYFrom: 180, // Face down off deck
      rotateYTo: 0,     // Face up in hand
      scaleFrom: 0.85,
      scaleTo: 1.0,
      opacityFrom: 0.9,
      opacityTo: 1.0,
      arcHeightPx,
    };
  });
}

/**
 * Evaluate a single flight ghost frame at elapsed time t (in ms relative to ghost.startMs).
 */
export function evaluateDrawFlightFrame(
  ghost: CardDrawFlightConfig,
  elapsedMs: number
): DrawFlightFrame {
  if (elapsedMs <= 0) {
    return {
      x: ghost.curve[0].x,
      y: ghost.curve[0].y,
      z: ghost.curve[0].z,
      rotateZ: ghost.rotateZFrom,
      rotateY: ghost.rotateYFrom,
      scale: ghost.scaleFrom,
      opacity: ghost.opacityFrom,
    };
  }

  if (elapsedMs >= ghost.durationMs) {
    return {
      x: ghost.curve[3].x,
      y: ghost.curve[3].y,
      z: ghost.curve[3].z,
      rotateZ: ghost.rotateZTo,
      rotateY: ghost.rotateYTo,
      scale: ghost.scaleTo,
      opacity: ghost.opacityTo,
    };
  }

  const rawT = elapsedMs / ghost.durationMs;
  const t = easeOutCubic(rawT);

  const pt = cubicBezier3(ghost.curve[0], ghost.curve[1], ghost.curve[2], ghost.curve[3], t);
  const rotateZ = lerp(ghost.rotateZFrom, ghost.rotateZTo, t);
  const rotateY = lerp(ghost.rotateYFrom, ghost.rotateYTo, t);
  const scale = lerp(ghost.scaleFrom, ghost.scaleTo, t);
  const opacity = lerp(ghost.opacityFrom, ghost.opacityTo, t);

  return {
    x: pt.x,
    y: pt.y,
    z: pt.z,
    rotateZ,
    rotateY,
    scale,
    opacity,
  };
}

/**
 * Format a flight frame into hardware-accelerated 3D CSS transform string.
 */
export function frameToTransform(frame: DrawFlightFrame): string {
  const x = Math.round(frame.x * 10) / 10;
  const y = Math.round(frame.y * 10) / 10;
  const z = Math.round(frame.z * 10) / 10;
  const rz = Math.round(frame.rotateZ * 10) / 10;
  const ry = Math.round(frame.rotateY * 10) / 10;
  const s = Math.round(frame.scale * 100) / 100;

  return `translate3d(${x}px, ${y}px, ${z}px) rotateZ(${rz}deg) rotateY(${ry}deg) scale(${s})`;
}

/* ---------------------------- DOM Event Bus ------------------------------ */

export function dispatchDrawFlightStart(
  planId: string,
  kind: DrawFlightKind,
  ghosts: CardDrawFlightConfig[]
): void {
  if (typeof window === 'undefined') return;

  const totalDurationMs = Math.max(...ghosts.map((g) => g.endMs));
  const detail: DrawFlightStartDetail = {
    planId,
    kind,
    ghostCount: ghosts.length,
    totalDurationMs,
    ghosts,
  };

  // Play sound effect on flight launch
  try {
    sfx.playCardFlip();
  } catch {
    // Ignore audio context errors
  }

  window.dispatchEvent(
    new CustomEvent<DrawFlightStartDetail>('md:carddrawflight:start', { detail })
  );
}

export function dispatchDrawFlightLand(
  planId: string,
  ghostId: string,
  cardIndex: number,
  kind: DrawFlightKind
): void {
  if (typeof window === 'undefined') return;

  const detail: DrawFlightLandDetail = {
    planId,
    ghostId,
    cardIndex,
    kind,
  };

  // Play landing sound effect
  try {
    sfx.playCardPlay();
  } catch {
    // Ignore audio context errors
  }

  window.dispatchEvent(
    new CustomEvent<DrawFlightLandDetail>('md:carddrawflight:land', { detail })
  );
}

export function dispatchDrawFlightComplete(
  planId: string,
  kind: DrawFlightKind,
  ghostCount: number
): void {
  if (typeof window === 'undefined') return;

  const detail: DrawFlightCompleteDetail = {
    planId,
    kind,
    ghostCount,
  };

  window.dispatchEvent(
    new CustomEvent<DrawFlightCompleteDetail>('md:carddrawflight:complete', { detail })
  );
}
