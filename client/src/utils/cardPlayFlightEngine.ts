/**
 * cardPlayFlightEngine.ts — Monopoly Deal 3D Card Play & Property/Bank Flight Engine.
 *
 * Framework-free engine calculating 3D parabolic Bezier trajectories, target spatial resolution,
 * 3D spin/flip transforms, sound effect triggers, and custom DOM event dispatching.
 */

import * as sfx from './soundEngine';

/* ---------------------------------- Types --------------------------------- */

export type FlightTargetKind = 'property' | 'bank' | 'discard';

export interface FlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface CardPlayFlightRequest {
  cardId: string;
  playerId: string;
  target: FlightTargetKind;
  sourceRect: FlightRect;
  targetRect: FlightRect;
  cardImage?: string;
  cardLabel?: string;
  colorKey?: string;
  stackIndex?: number;
  durationMs?: number;
  arcHeightPx?: number;
  spinTurns?: number;
  flipY?: boolean;
  reducedMotion?: boolean;
  meta?: Record<string, unknown>;
}

export interface FlightSoundCue {
  launch: string;
  land: string;
  volume: number;
}

export interface FlightPlan {
  id: string;
  cardId: string;
  playerId: string;
  target: FlightTargetKind;
  p0: Point3D;
  c1: Point3D;
  c2: Point3D;
  p3: Point3D;
  durationMs: number;
  settleMs: number;
  arcHeightPx: number;
  rotateZFrom: number;
  rotateZTo: number;
  spinTurns: number;
  rotateYTo: number;
  scaleFrom: number;
  scaleTo: number;
  liftBoost: number;
  sound: FlightSoundCue;
  degenerate: boolean;
  startedAt: number;
  cardImage?: string;
  cardLabel?: string;
  colorKey?: string;
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
  t: number;
}

export interface FlightEngineOptions {
  eventTarget?: EventTarget;
  now?: () => number;
  schedule?: (cb: () => void, ms: number) => unknown;
  cancelScheduled?: (handle: unknown) => void;
  playSound?: (cue: FlightSoundCue, phase: 'launch' | 'land') => void;
}

/* -------------------------------- Constants ------------------------------- */

export const FLIGHT_EVENTS = Object.freeze({
  start: 'md:cardplayflight:start',
  land: 'md:cardplayflight:land',
  complete: 'md:cardplayflight:complete',
} as const);

export const MIN_DURATION_MS = 80;
export const MAX_DURATION_MS = 2000;
export const DEFAULT_DURATION_MS = 520;
export const MAX_ARC_PX = 400;
export const SETTLE_MS = 140;
export const REDUCED_MOTION_DURATION_MS = 120;
export const DEDUPE_WINDOW_MS = 50;

/* -------------------------------- Math ----------------------------------- */

function finiteOr(val: number, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

function easeInOutQuad(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
}

export function rectCenter(r: FlightRect): Point3D {
  const left = finiteOr(r.left, 0);
  const top = finiteOr(r.top, 0);
  const width = finiteOr(r.width, 0);
  const height = finiteOr(r.height, 0);
  return {
    x: left + width * 0.5,
    y: top + height * 0.5,
    z: 0,
  };
}

/** Deterministic pseudo-random float in [0, 1) from cardId hash string */
export function hashToUnit(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 10000) / 10000;
}

export function resolveTargetPoint(
  kind: FlightTargetKind,
  targetRect: FlightRect,
  opts: { stackIndex?: number; cardId?: string } = {}
): Point3D {
  const center = rectCenter(targetRect);
  const stackIndex = finiteOr(opts.stackIndex ?? 0, 0);
  const seed = opts.cardId ?? 'default';
  const jitter = (hashToUnit(seed) - 0.5) * 2;

  if (kind === 'bank') {
    return {
      x: center.x + (stackIndex % 6) * 1.5 + jitter * 4,
      y: center.y + (stackIndex % 6) * 1.5 + jitter * 4,
      z: 0,
    };
  }

  if (kind === 'property') {
    const cardHeight = Math.min(100, targetRect.height || 100);
    const yOffset = stackIndex * 18;
    const targetY = targetRect.top + cardHeight * 0.5 + yOffset;
    return {
      x: center.x + jitter * 3,
      y: clamp(targetY, targetRect.top + 20, targetRect.top + Math.max(80, targetRect.height)),
      z: 0,
    };
  }

  // Discard center
  return {
    x: center.x + jitter * 8,
    y: center.y + jitter * 8,
    z: 0,
  };
}

export function evaluateBezier3(
  p0: Point3D,
  c1: Point3D,
  c2: Point3D,
  p3: Point3D,
  tParam: number
): Point3D {
  const t = clamp(tParam, 0, 1);
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  return {
    x: uuu * p0.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + ttt * p3.y,
    z: uuu * p0.z + 3 * uu * t * c1.z + 3 * u * tt * c2.z + ttt * p3.z,
  };
}

export function scaleFromZ(z: number, perspectivePx: number = 1200): number {
  return clamp(perspectivePx / Math.max(100, perspectivePx - z), 0.5, 3.0);
}

export function buildFlightPlan(req: CardPlayFlightRequest, nowTime?: number): FlightPlan {
  const now = nowTime ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const id = `flight_${req.cardId}_${Math.floor(now)}`;
  const p0 = rectCenter(req.sourceRect);
  const p3 = resolveTargetPoint(req.target, req.targetRect, {
    stackIndex: req.stackIndex,
    cardId: req.cardId,
  });

  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const dist = Math.hypot(dx, dy);

  const isDegenerate =
    req.sourceRect.width <= 0 ||
    req.sourceRect.height <= 0 ||
    req.targetRect.width <= 0 ||
    req.targetRect.height <= 0;

  const reduced = req.reducedMotion ?? false;
  const defaultDuration = reduced ? REDUCED_MOTION_DURATION_MS : DEFAULT_DURATION_MS;
  const durationMs = clamp(finiteOr(req.durationMs ?? defaultDuration, defaultDuration), MIN_DURATION_MS, MAX_DURATION_MS);

  const rawArc = req.arcHeightPx ?? dist * 0.22;
  const arcHeightPx = reduced ? 0 : clamp(finiteOr(rawArc, 100), 0, MAX_ARC_PX);

  // Derive control points for 3D trajectory
  const c1: Point3D = {
    x: p0.x + dx * 0.25,
    y: p0.y + dy * 0.25 - arcHeightPx,
    z: arcHeightPx * 0.6,
  };

  const c2: Point3D = {
    x: p0.x + dx * 0.72,
    y: p0.y + dy * 0.72 - arcHeightPx * 0.82,
    z: arcHeightPx * 0.35,
  };

  const rotateZFrom = (hashToUnit(req.cardId) - 0.5) * 8;
  const rotateZTo = req.target === 'discard' ? (hashToUnit(req.cardId + '_rot') - 0.5) * 18 : 0;
  const spinTurns = reduced ? 0 : clamp(finiteOr(req.spinTurns ?? (req.target === 'discard' ? 1 : 0.5), 0), -3, 3);

  const sourceHeight = Math.max(1, req.sourceRect.height);
  const targetHeight = Math.max(1, req.targetRect.height);
  const scaleFrom = 1;
  const scaleTo = clamp(targetHeight / sourceHeight, 0.35, 2.5);
  const liftBoost = reduced ? 0 : 0.16;

  return {
    id,
    cardId: req.cardId,
    playerId: req.playerId,
    target: req.target,
    p0,
    c1,
    c2,
    p3,
    durationMs,
    settleMs: SETTLE_MS,
    arcHeightPx,
    rotateZFrom,
    rotateZTo,
    spinTurns,
    rotateYTo: req.flipY ? 180 : 0,
    scaleFrom,
    scaleTo,
    liftBoost,
    sound: { launch: 'card_play', land: 'card_flip', volume: 0.35 },
    degenerate: isDegenerate,
    startedAt: now,
    cardImage: req.cardImage,
    cardLabel: req.cardLabel,
    colorKey: req.colorKey,
  };
}

export function evaluateFlight(plan: FlightPlan, elapsedMs: number): FlightFrame {
  const rawProgress = clamp(elapsedMs / Math.max(1, plan.durationMs), 0, 1);
  const t = easeInOutCubic(rawProgress);

  const point = evaluateBezier3(plan.p0, plan.c1, plan.c2, plan.p3, t);
  const rotateZ = plan.rotateZFrom + (plan.rotateZTo - plan.rotateZFrom + plan.spinTurns * 360) * t;

  const rotateY = plan.rotateYTo > 0 ? plan.rotateYTo * easeInOutQuad(clamp((t - 0.12) / 0.58, 0, 1)) : 0;

  const apexBump = plan.liftBoost * 4 * t * (1 - t);
  const baseScale = lerp(plan.scaleFrom, plan.scaleTo, t);
  const scale = baseScale * (1 + apexBump);
  const opacity = rawProgress >= 0.95 ? lerp(1, 0, (rawProgress - 0.95) / 0.05) : 1;

  return {
    x: point.x,
    y: point.y,
    z: point.z,
    rotateZ,
    rotateY,
    scale,
    opacity,
    progress: rawProgress,
    t,
  };
}

export function frameToTransform(frame: FlightFrame): string {
  const x = finiteOr(frame.x, 0).toFixed(1);
  const y = finiteOr(frame.y, 0).toFixed(1);
  const z = finiteOr(frame.z, 0).toFixed(1);
  const rz = finiteOr(frame.rotateZ, 0).toFixed(1);
  const ry = finiteOr(frame.rotateY, 0).toFixed(1);
  const sc = finiteOr(frame.scale, 1).toFixed(3);

  return `translate3d(${x}px, ${y}px, ${z}px) rotateZ(${rz}deg) rotateY(${ry}deg) scale(${sc})`;
}

/* -------------------------------- Scheduler ------------------------------ */

let currentOptions: FlightEngineOptions = {};
const activePlans = new Map<string, FlightPlan>();
const flightTimers = new Map<string, unknown>();
const lastLaunchTimes = new Map<string, number>();

export function configureFlightEngine(opts: FlightEngineOptions): void {
  currentOptions = { ...opts };
}

function getNow(): number {
  if (currentOptions.now) return currentOptions.now();
  if (typeof performance !== 'undefined') return performance.now();
  return Date.now();
}

function getEventTarget(): EventTarget {
  if (currentOptions.eventTarget) return currentOptions.eventTarget;
  if (typeof window !== 'undefined') return window;
  return new EventTarget();
}

function scheduleTimer(cb: () => void, ms: number): unknown {
  if (currentOptions.schedule) return currentOptions.schedule(cb, ms);
  return setTimeout(cb, ms);
}

function clearTimer(handle: unknown): void {
  if (currentOptions.cancelScheduled) {
    currentOptions.cancelScheduled(handle);
    return;
  }
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function playSoundCue(cue: FlightSoundCue, phase: 'launch' | 'land'): void {
  if (currentOptions.playSound) {
    currentOptions.playSound(cue, phase);
    return;
  }
  if (phase === 'launch') {
    sfx.playCardPlay();
  } else {
    sfx.playCardFlip();
  }
}

export function getActiveFlights(): FlightPlan[] {
  return Array.from(activePlans.values());
}

export function cancelCardFlight(id: string): void {
  const plan = activePlans.get(id);
  if (!plan) return;

  const timer = flightTimers.get(id);
  if (timer) {
    clearTimer(timer);
    flightTimers.delete(id);
  }

  activePlans.delete(id);

  const target = getEventTarget();
  target.dispatchEvent(
    new CustomEvent(FLIGHT_EVENTS.complete, {
      detail: { id: plan.id, cardId: plan.cardId, target: plan.target, cancelled: true },
    })
  );
}

export function cancelAllFlights(reason: string = 'manual'): void {
  if (reason) {
    // Retain reason reference for debugging
  }
  const ids = Array.from(activePlans.keys());
  ids.forEach((id) => cancelCardFlight(id));
}

export function launchCardFlight(
  req: CardPlayFlightRequest,
  opts?: FlightEngineOptions
): { id: string; cancel: () => void } {
  if (opts) {
    configureFlightEngine(opts);
  }
  const now = getNow();
  const lastTime = lastLaunchTimes.get(req.cardId) ?? 0;

  // Deduplicate rapid double launches for the same card
  if (now - lastTime < DEDUPE_WINDOW_MS) {
    const existing = Array.from(activePlans.values()).find((p) => p.cardId === req.cardId);
    if (existing) {
      return {
        id: existing.id,
        cancel: () => cancelCardFlight(existing.id),
      };
    }
  }

  // Cancel prior active flight for the same card
  const prior = Array.from(activePlans.values()).find((p) => p.cardId === req.cardId);
  if (prior) {
    cancelCardFlight(prior.id);
  }

  lastLaunchTimes.set(req.cardId, now);

  const plan = buildFlightPlan(req, now);
  const target = getEventTarget();

  if (plan.degenerate) {
    target.dispatchEvent(new CustomEvent(FLIGHT_EVENTS.start, { detail: { plan } }));
    target.dispatchEvent(
      new CustomEvent(FLIGHT_EVENTS.land, {
        detail: { id: plan.id, cardId: plan.cardId, target: plan.target, point: plan.p3 },
      })
    );
    target.dispatchEvent(
      new CustomEvent(FLIGHT_EVENTS.complete, {
        detail: { id: plan.id, cardId: plan.cardId, target: plan.target, cancelled: false },
      })
    );
    return { id: plan.id, cancel: () => {} };
  }

  activePlans.set(plan.id, plan);

  // Dispatch Start Synchronously
  target.dispatchEvent(new CustomEvent(FLIGHT_EVENTS.start, { detail: { plan } }));
  playSoundCue(plan.sound, 'launch');

  // Schedule Land & Complete
  const timerHandle = scheduleTimer(() => {
    target.dispatchEvent(
      new CustomEvent(FLIGHT_EVENTS.land, {
        detail: { id: plan.id, cardId: plan.cardId, target: plan.target, point: plan.p3 },
      })
    );
    playSoundCue(plan.sound, 'land');

    const completeHandle = scheduleTimer(() => {
      activePlans.delete(plan.id);
      flightTimers.delete(plan.id);
      target.dispatchEvent(
        new CustomEvent(FLIGHT_EVENTS.complete, {
          detail: { id: plan.id, cardId: plan.cardId, target: plan.target, cancelled: false },
        })
      );
    }, plan.settleMs);

    flightTimers.set(plan.id, completeHandle);
  }, plan.durationMs);

  flightTimers.set(plan.id, timerHandle);

  return {
    id: plan.id,
    cancel: () => cancelCardFlight(plan.id),
  };
}

export const cardPlayFlightEngine = {
  configure: configureFlightEngine,
  launchCardFlight,
  cancelCardFlight,
  cancelAllFlights,
  getActiveFlights,
  buildFlightPlan,
  evaluateFlight,
  evaluateBezier3,
  resolveTargetPoint,
  frameToTransform,
  rectCenter,
  hashToUnit,
  scaleFromZ,
};
