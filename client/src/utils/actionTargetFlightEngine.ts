/**
 * actionTargetFlightEngine.ts — Monopoly Deal 3D Action Card Target Flight & Property Steal Engine.
 *
 * Pure-math + event engine for targeted action-card flights:
 *
 *   Property steals (Sly Deal / Forced Deal / Deal Breaker)
 *     phase 1 outbound : actor hand -> target opponent property set
 *     phase 2 attach   : 3D Y-flip in place (action card -> acquired property face)
 *     phase 3 inbound  : target property set -> actor board
 *
 *   Charges (Rent / Debt Collector / It's My Birthday)
 *     phase 1 outbound : actor hand -> each target seat / bank stack (fanned out)
 *     phase 2 pulse    : charge pulse at the target, scale-up + fade
 *
 * Framework-free, side-effect free at import time.
 */

import * as sfx from './soundEngine';

/* ---------------------------------- Types --------------------------------- */

export type SeatPosition = 'south' | 'north' | 'east' | 'west' | 'center';

export type ActionFlightKind =
  | 'sly-deal'
  | 'forced-deal'
  | 'deal-breaker'
  | 'rent'
  | 'debt-collector'
  | 'birthday';

export type FlightPhaseName = 'outbound' | 'attach' | 'inbound' | 'pulse';

export type EasingName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeOutBack';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export type Curve3 = [Point3, Point3, Point3, Point3];

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FlightPhase {
  name: FlightPhaseName;
  /** ms, relative to the ghost's own start */
  startMs: number;
  durationMs: number;
  curve: Curve3;
  easing: EasingName;
  rotateZFrom: number;
  rotateZTo: number;
  rotateYFrom: number;
  rotateYTo: number;
  scaleFrom: number;
  scaleTo: number;
  opacityFrom: number;
  opacityTo: number;
}

export interface FlightGhost {
  id: string;
  kind: ActionFlightKind;
  seat: SeatPosition;
  targetPlayerId: string | null;
  /** face shown during outbound leg (action card) */
  label: string;
  /** face revealed by attach flip (stolen property), steals only */
  acquiredLabel: string | null;
  color: string | null;
  width: number;
  height: number;
  /** ms, relative to plan start (fan-out stagger) */
  startMs: number;
  /** ms at which outbound leg touches down -> land event fires */
  landAtMs: number;
  endMs: number;
  phases: FlightPhase[];
}

export interface FlightFrame {
  x: number;
  y: number;
  z: number;
  rotateZ: number;
  rotateY: number;
  scale: number;
  opacity: number;
  phase: FlightPhaseName;
  phaseProgress: number;
  progress: number;
  face: 'front' | 'back';
  visible: boolean;
  done: boolean;
}

export interface ActionFlightTarget {
  playerId: string | null;
  seat: SeatPosition;
  /** opponent property-set rect (steals) */
  propertySetRect?: RectLike | null;
  /** opponent bank stack rect (charges) */
  bankRect?: RectLike | null;
  /** opponent seat rect, fallback anchor */
  seatRect?: RectLike | null;
  acquiredLabel?: string | null;
}

export interface ActionFlightTiming {
  outboundMs: number;
  attachMs: number;
  inboundMs: number;
  pulseMs: number;
  staggerMs: number;
  watchdogPaddingMs: number;
}

export interface ActionTargetFlightRequest {
  id?: string;
  kind: ActionFlightKind;
  cardId?: string | null;
  label?: string;
  color?: string | null;
  /** the played hand card */
  sourceRect: RectLike;
  /** where stolen property lands; defaults to sourceRect */
  actorRect?: RectLike | null;
  targets: ActionFlightTarget[];
  arcHeightPx?: number;
  reducedMotion?: boolean;
  timing?: Partial<ActionFlightTiming>;
}

export interface ActionFlightPlan {
  id: string;
  kind: ActionFlightKind;
  cardId: string | null;
  label: string;
  reducedMotion: boolean;
  totalDurationMs: number;
  watchdogMs: number;
  ghosts: FlightGhost[];
}

export interface ActionFlightEventDetail {
  plan: ActionFlightPlan;
  ghost?: FlightGhost;
  reason?: 'finished' | 'watchdog' | 'unmounted' | 'reduced-motion' | 'cancelled';
}

/* -------------------------------- Constants ------------------------------- */

export const ACTION_TARGET_FLIGHT_EVENTS = Object.freeze({
  start: 'md:actiontargetflight:start',
  land: 'md:actiontargetflight:land',
  complete: 'md:actiontargetflight:complete',
});

export const ACTION_FLIGHT_KINDS: ActionFlightKind[] = Object.freeze([
  'sly-deal',
  'forced-deal',
  'deal-breaker',
  'rent',
  'debt-collector',
  'birthday',
]) as unknown as ActionFlightKind[];

export const PROPERTY_STEAL_KINDS: ActionFlightKind[] = Object.freeze([
  'sly-deal',
  'forced-deal',
  'deal-breaker',
]) as unknown as ActionFlightKind[];

export const CHARGE_KINDS: ActionFlightKind[] = Object.freeze([
  'rent',
  'debt-collector',
  'birthday',
]) as unknown as ActionFlightKind[];

export const DEFAULT_ACTION_FLIGHT_TIMING: ActionFlightTiming = Object.freeze({
  outboundMs: 520,
  attachMs: 360,
  inboundMs: 620,
  pulseMs: 260,
  staggerMs: 90,
  watchdogPaddingMs: 900,
});

export const DEFAULT_ARC_HEIGHT_PX = 160;
export const DEFAULT_CARD_WIDTH = 72;
export const DEFAULT_CARD_HEIGHT = 104;

export const SEAT_VECTORS: Record<SeatPosition, { dx: number; dy: number; tiltDeg: number }> = Object.freeze({
  south: { dx: 0, dy: 1, tiltDeg: 0 },
  north: { dx: 0, dy: -1, tiltDeg: 180 },
  east: { dx: 1, dy: 0, tiltDeg: 90 },
  west: { dx: -1, dy: 0, tiltDeg: -90 },
  center: { dx: 0, dy: 0, tiltDeg: 0 },
});

const KIND_BY_ACTION: Record<string, ActionFlightKind> = Object.freeze({
  SLY_DEAL: 'sly-deal',
  FORCED_DEAL: 'forced-deal',
  DEAL_BREAKER: 'deal-breaker',
  RENT: 'rent',
  MULTICOLOR_RENT: 'rent',
  DOUBLE_THE_RENT: 'rent',
  DEBT_COLLECTOR: 'debt-collector',
  ITS_MY_BIRTHDAY: 'birthday',
  IT_S_MY_BIRTHDAY: 'birthday',
  BIRTHDAY: 'birthday',
});

/* -------------------------------- Pure Math ------------------------------- */

export function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const EASINGS: Record<EasingName, (t: number) => number> = Object.freeze({
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
});

export function ease(name: EasingName, t: number): number {
  const fn = EASINGS[name] || EASINGS.linear;
  return fn(clamp01(t));
}

export function cubicBezier3(curve: Curve3, t: number): Point3 {
  const u = clamp01(t);
  const inv = 1 - u;
  const a = inv * inv * inv;
  const b = 3 * inv * inv * u;
  const c = 3 * inv * u * u;
  const d = u * u * u;
  const [p0, p1, p2, p3] = curve;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    z: a * p0.z + b * p1.z + c * p2.z + d * p3.z,
  };
}

export function cubicBezierTangent3(curve: Curve3, t: number): Point3 {
  const u = clamp01(t);
  const inv = 1 - u;
  const [p0, p1, p2, p3] = curve;
  const a = 3 * inv * inv;
  const b = 6 * inv * u;
  const c = 3 * u * u;
  return {
    x: a * (p1.x - p0.x) + b * (p2.x - p1.x) + c * (p3.x - p2.x),
    y: a * (p1.y - p0.y) + b * (p2.y - p1.y) + c * (p3.y - p2.y),
    z: a * (p1.z - p0.z) + b * (p2.z - p1.z) + c * (p3.z - p2.z),
  };
}

export function rectCenter(rect: RectLike): Point3 {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    z: 0,
  };
}

export function isUsableRect(rect: RectLike | null | undefined): boolean {
  return !!rect && Number.isFinite(rect.left) && Number.isFinite(rect.top);
}

export function distance2d(a: Point3, b: Point3): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function buildArcCurve(
  from: Point3,
  to: Point3,
  arcHeightPx: number,
  lateralBiasPx: number = 0,
): Curve3 {
  const lift = Math.max(0, arcHeightPx);
  const c1: Point3 = {
    x: lerp(from.x, to.x, 0.25) + lateralBiasPx * 0.6,
    y: lerp(from.y, to.y, 0.25) - lift,
    z: lift * 0.55,
  };
  const c2: Point3 = {
    x: lerp(from.x, to.x, 0.75) + lateralBiasPx * 0.6,
    y: lerp(from.y, to.y, 0.75) - lift,
    z: lift * 0.55,
  };
  return [{ ...from }, c1, c2, { ...to }];
}

export function holdCurve(at: Point3, liftPx: number = 0): Curve3 {
  const mid: Point3 = { x: at.x, y: at.y - liftPx * 0.35, z: at.z + liftPx };
  return [{ ...at }, mid, mid, { ...at }];
}

export function arcHeightForDistance(distancePx: number, requested?: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) return Math.max(0, requested);
  const scaled = distancePx * 0.28;
  return Math.max(48, Math.min(DEFAULT_ARC_HEIGHT_PX, scaled));
}

/* ----------------         Target Point Resolution        ---------------- */

export function resolveTargetPoint(
  kind: ActionFlightKind,
  target: ActionFlightTarget,
): Point3 | null {
  const order: (RectLike | null | undefined)[] = isPropertyStealKind(kind)
    ? [target.propertySetRect, target.seatRect, target.bankRect]
    : [target.bankRect, target.seatRect, target.propertySetRect];

  for (const rect of order) {
    if (isUsableRect(rect)) return rectCenter(rect as RectLike);
  }
  return null;
}

export function isPropertyStealKind(kind: ActionFlightKind): boolean {
  return PROPERTY_STEAL_KINDS.indexOf(kind) !== -1;
}

export function isChargeKind(kind: ActionFlightKind): boolean {
  return CHARGE_KINDS.indexOf(kind) !== -1;
}

export function kindFromActionCard(action: string | null | undefined): ActionFlightKind | null {
  if (!action) return null;
  const key = String(action).trim().toUpperCase().replace(/[\s'-]+/g, '_');
  return KIND_BY_ACTION[key] || null;
}

export function fanOutBias(index: number, count: number, spreadPx: number = 44): number {
  if (count <= 1) return 0;
  return (index - (count - 1) / 2) * spreadPx;
}

/* -------------------------------- Scheduler ------------------------------- */

let flightSeq = 0;

function nextId(prefix: string): string {
  flightSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${flightSeq}`;
}

function phase(
  name: FlightPhaseName,
  startMs: number,
  durationMs: number,
  curve: Curve3,
  easing: EasingName,
  spin: { rz: [number, number]; ry: [number, number]; sc: [number, number]; op: [number, number] },
): FlightPhase {
  return {
    name,
    startMs,
    durationMs: Math.max(0, durationMs),
    curve,
    easing,
    rotateZFrom: spin.rz[0],
    rotateZTo: spin.rz[1],
    rotateYFrom: spin.ry[0],
    rotateYTo: spin.ry[1],
    scaleFrom: spin.sc[0],
    scaleTo: spin.sc[1],
    opacityFrom: spin.op[0],
    opacityTo: spin.op[1],
  };
}

export function planActionTargetFlight(
  request: ActionTargetFlightRequest,
): ActionFlightPlan | null {
  if (!request || ACTION_FLIGHT_KINDS.indexOf(request.kind) === -1) {
    throw new TypeError(`planActionTargetFlight: unknown kind "${request && request.kind}"`);
  }
  if (!isUsableRect(request.sourceRect)) return null;

  const targets = (request.targets || []).filter((t) => !!resolveTargetPoint(request.kind, t));
  if (targets.length === 0) return null;

  const reduced = request.reducedMotion === true;
  const timing: ActionFlightTiming = {
    ...DEFAULT_ACTION_FLIGHT_TIMING,
    ...(request.timing || {}),
  };
  const scale = reduced ? 0 : 1;

  const source = rectCenter(request.sourceRect);
  const actorRect = isUsableRect(request.actorRect) ? (request.actorRect as RectLike) : request.sourceRect;
  const actorPoint = rectCenter(actorRect);
  const steal = isPropertyStealKind(request.kind);

  const width = request.sourceRect.width > 0 ? request.sourceRect.width : DEFAULT_CARD_WIDTH;
  const height = request.sourceRect.height > 0 ? request.sourceRect.height : DEFAULT_CARD_HEIGHT;

  const ghosts: FlightGhost[] = targets.map((target, index) => {
    const dest = resolveTargetPoint(request.kind, target) as Point3;
    const seat = SEAT_VECTORS[target.seat] ? target.seat : 'center';
    const tilt = SEAT_VECTORS[seat].tiltDeg;
    const bias = fanOutBias(index, targets.length);
    const arc = arcHeightForDistance(distance2d(source, dest), request.arcHeightPx);

    const startMs = reduced ? 0 : index * timing.staggerMs;
    const phases: FlightPhase[] = [];
    let cursor = 0;

    // Phase 1: outbound (actor hand -> target)
    const outboundMs = timing.outboundMs * scale;
    phases.push(
      phase('outbound', cursor, outboundMs, buildArcCurve(source, dest, arc, bias), 'easeInOutCubic', {
        rz: [0, tilt * 0.25 + (steal ? 0 : 180)],
        ry: [0, 0],
        sc: [1, steal ? 1.08 : 0.94],
        op: [1, 1],
      }),
    );
    cursor += outboundMs;
    const landAtMs = startMs + cursor;

    if (steal) {
      // Phase 2: attach — 3D flip in place, action face -> acquired property face
      const attachMs = timing.attachMs * scale;
      phases.push(
        phase('attach', cursor, attachMs, holdCurve(dest, arc * 0.18), 'easeOutCubic', {
          rz: [tilt * 0.25, tilt * 0.25],
          ry: [0, 180],
          sc: [1.08, 1.16],
          op: [1, 1],
        }),
      );
      cursor += attachMs;

      // Phase 3: inbound (target property set -> actor board)
      const inboundMs = timing.inboundMs * scale;
      phases.push(
        phase(
          'inbound',
          cursor,
          inboundMs,
          buildArcCurve(dest, actorPoint, arc * 0.85, -bias),
          'easeInOutCubic',
          {
            rz: [tilt * 0.25, 0],
            ry: [180, 180],
            sc: [1.16, 0.92],
            op: [1, 0.92],
          },
        ),
      );
      cursor += inboundMs;
    } else {
      // Phase 2: charge pulse at target seat
      const pulseMs = timing.pulseMs * scale;
      phases.push(
        phase('pulse', cursor, pulseMs, holdCurve(dest, 0), 'easeOutBack', {
          rz: [tilt * 0.25 + 180, tilt * 0.25 + 180],
          ry: [0, 0],
          sc: [0.94, 1.42],
          op: [1, 0],
        }),
      );
      cursor += pulseMs;
    }

    return {
      id: `${request.id || 'atf'}-g${index}`,
      kind: request.kind,
      seat,
      targetPlayerId: target.playerId || null,
      label: request.label || 'Action',
      acquiredLabel: steal ? target.acquiredLabel || 'Property' : null,
      color: request.color || null,
      width,
      height,
      startMs,
      landAtMs,
      endMs: startMs + cursor,
      phases,
    };
  });

  const totalDurationMs = ghosts.reduce((max, g) => Math.max(max, g.endMs), 0);

  return {
    id: request.id || nextId('atf'),
    kind: request.kind,
    cardId: request.cardId || null,
    label: request.label || 'Action',
    reducedMotion: reduced,
    totalDurationMs,
    watchdogMs: totalDurationMs + timing.watchdogPaddingMs,
    ghosts,
  };
}

export function sampleGhost(ghost: FlightGhost, elapsedMs: number): FlightFrame {
  const phases = ghost.phases;
  const first = phases[0];
  const last = phases[phases.length - 1];
  const local = elapsedMs - ghost.startMs;

  if (local < 0) return frameAt(ghost, first, 0, false, false);
  if (local >= ghost.endMs - ghost.startMs) return frameAt(ghost, last, 1, false, true);

  let active = last;
  let t = 1;
  for (const p of phases) {
    if (p.durationMs <= 0) continue;
    if (local < p.startMs + p.durationMs) {
      active = p;
      t = (local - p.startMs) / p.durationMs;
      break;
    }
  }
  return frameAt(ghost, active, clamp01(t), true, false);
}

export function samplePlan(plan: ActionFlightPlan, elapsedMs: number): FlightFrame[] {
  return plan.ghosts.map((g) => sampleGhost(g, elapsedMs));
}

function frameAt(
  ghost: FlightGhost,
  p: FlightPhase,
  rawT: number,
  visible: boolean,
  done: boolean,
): FlightFrame {
  const t = clamp01(rawT);
  const e = ease(p.easing, t);
  const point = cubicBezier3(p.curve, e);
  const rotateY = lerp(p.rotateYFrom, p.rotateYTo, e);
  const span = Math.max(1, ghost.endMs - ghost.startMs);
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    rotateZ: lerp(p.rotateZFrom, p.rotateZTo, e),
    rotateY,
    scale: lerp(p.scaleFrom, p.scaleTo, e),
    opacity: lerp(p.opacityFrom, p.opacityTo, e),
    phase: p.name,
    phaseProgress: t,
    progress: clamp01((p.startMs + t * p.durationMs) / span),
    face: rotateY >= 90 ? 'back' : 'front',
    visible,
    done,
  };
}

/* ----------------          CSS Formatting         ---------------- */

function fmt(n: number): string {
  const safe = Number.isFinite(n) ? n : 0;
  return String(Number(safe.toFixed(2)));
}

export function frameToTransform(frame: FlightFrame): string {
  return (
    `translate3d(${fmt(frame.x)}px, ${fmt(frame.y)}px, ${fmt(frame.z)}px) ` +
    `rotateZ(${fmt(frame.rotateZ)}deg) ` +
    `rotateY(${fmt(frame.rotateY)}deg) ` +
    `scale(${fmt(frame.scale)})`
  );
}

/* ----------------                 Event Bus               ---------------- */

export function dispatchFlightEvent(
  type: string,
  plan: ActionFlightPlan,
  ghost?: FlightGhost,
  reason?: ActionFlightEventDetail['reason'],
): boolean {
  if (typeof document === 'undefined' || !document.dispatchEvent) return false;
  const detail: ActionFlightEventDetail = { plan, ghost, reason };
  let event: CustomEvent<ActionFlightEventDetail>;
  if (typeof CustomEvent === 'function') {
    event = new CustomEvent<ActionFlightEventDetail>(type, { detail, bubbles: true });
  } else {
    event = { type, detail } as unknown as CustomEvent<ActionFlightEventDetail>;
  }
  return document.dispatchEvent(event);
}

export function emitFlightStart(plan: ActionFlightPlan): void {
  dispatchFlightEvent(ACTION_TARGET_FLIGHT_EVENTS.start, plan);
}

export function emitFlightLand(plan: ActionFlightPlan, ghost: FlightGhost): void {
  dispatchFlightEvent(ACTION_TARGET_FLIGHT_EVENTS.land, plan, ghost);
}

export function emitFlightComplete(
  plan: ActionFlightPlan,
  reason: ActionFlightEventDetail['reason'] = 'finished',
): void {
  dispatchFlightEvent(ACTION_TARGET_FLIGHT_EVENTS.complete, plan, undefined, reason);
}

export function launchActionTargetFlight(
  request: ActionTargetFlightRequest,
): ActionFlightPlan | null {
  const plan = planActionTargetFlight(request);
  if (!plan) return null;

  playCardPlay();
  emitFlightStart(plan);

  if (plan.reducedMotion) {
    plan.ghosts.forEach((ghost) => emitFlightLand(plan, ghost));
    emitFlightComplete(plan, 'reduced-motion');
  }

  return plan;
}

export function onActionFlightEvent<T = ActionFlightEventDetail>(
  type: string,
  handler: (detail: T) => void,
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  const listener = (event: Event) => {
    const custom = event as CustomEvent<T>;
    if (custom && custom.detail) handler(custom.detail);
  };
  document.addEventListener(type, listener);
  return () => document.removeEventListener(type, listener);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function playCardPlay(): void {
  try {
    sfx.playCardPlay();
  } catch {
    /* sound trigger failure is non-fatal */
  }
}

export function playCardFlip(): void {
  try {
    sfx.playCardFlip();
  } catch {
    /* sound trigger failure is non-fatal */
  }
}
