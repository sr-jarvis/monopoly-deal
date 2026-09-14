/**
 * Monopoly Deal 3D Just Say No Counter-Shield Flight & Action Neutralization Animation Engine
 * Pure mathematical Bezier trajectory calculator, phase transform generator, multi-seat counter flight scheduler,
 * speed scaler, hardware-accelerated 3D transform builder, and event engine.
 */

import { playCardPlay, playCardFlip, playCounterShield, playActionBlocked } from './soundEngine';

export interface Coord3D {
  x: number;
  y: number;
  z?: number;
}

export interface Frame3D {
  x: number;
  y: number;
  z: number;
  rotateZ: number;
  rotateY: number;
  scale: number;
  opacity: number;
}

export type CounterSpeed = 'slow' | 'normal' | 'fast' | 'turbo';

/** Duration multipliers. Higher = slower playback. */
export const COUNTER_SPEEDS: Record<CounterSpeed, number> = {
  slow: 1.6,
  normal: 1.0,
  fast: 0.6,
  turbo: 0.35,
};

export const COUNTER_FLIGHT_EVENTS = {
  launch: 'md:counterflight:start',
  start: 'md:counterflight:start',
  intercept: 'md:counterflight:intercept',
  neutralize: 'md:counterflight:neutralize',
  complete: 'md:counterflight:complete',
} as const;

export interface CardRef {
  id: string;
  title?: string;
  name?: string;
  type?: string;
}

export interface PhaseInfo {
  name: 'launch' | 'intercept' | 'deflect' | 'neutralize';
  startMs: number;
  endMs: number;
}

export interface SoundCue {
  atMs: number;
  sound: 'cardPlay' | 'cardFlip' | 'counterShield' | 'actionBlocked';
}

export interface CounterFlightPlan {
  id: string;
  speed: CounterSpeed;
  scale: number;
  chainIndex: number;
  reducedMotion: boolean;
  arcHeightPx: number;
  coords: {
    start: Coord3D;
    intercept: Coord3D;
    discard: Coord3D;
  };
  defenderSeat: string;
  attackerSeat: string;
  counterCard: CardRef;
  attackerCard: CardRef;
  phases: PhaseInfo[];
  totalMs: number;
  cues: SoundCue[];
}

export interface CounterFlightParams {
  counterCard: CardRef;
  attackerCard: CardRef;
  startCoord: Coord3D;
  interceptCoord: Coord3D;
  discardCoord: Coord3D;
  defenderSeat: string;
  attackerSeat: string;
  speed?: CounterSpeed;
  chainIndex?: number;
  reducedMotion?: boolean;
  flightId?: string;
}

const PHASE_BASE = {
  launch: 520,
  intercept: 260,
  deflect: 560,
  neutralize: 300,
};

const CHAIN_OVERLAP_MS = 140;
const Z_LIFT_RATIO = 0.6;
const DEFLECT_LATERAL_CLAMP = [24, 140] as const;
const MAX_CONCURRENT_FLIGHTS = 3;
const WATCHDOG_GRACE_MS = 1500;

let warnedNaN = false;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function safeNum(v: number | undefined, fallback = 0): number {
  return v !== undefined && Number.isFinite(v) ? v : fallback;
}

/**
 * Calculates 3D quadratic Bezier curve point for the shield's launch trajectory.
 * B(t) = (1-t)² P0 + 2(1-t)t P1 + t² P2
 * Apex at t=0.5 is midY - arcHeightPx/2
 */
export function calculateShieldBezier3D(
  startCoord: Coord3D,
  interceptCoord: Coord3D,
  tInput: number,
  arcHeightPx = 140
): Coord3D {
  const x0 = safeNum(startCoord.x);
  const y0 = safeNum(startCoord.y);
  const z0 = safeNum(startCoord.z);

  const x2 = safeNum(interceptCoord.x);
  const y2 = safeNum(interceptCoord.y);
  const z2 = safeNum(interceptCoord.z);

  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
    if (!warnedNaN) {
      console.warn('[justSayNoFlightEngine] Non-finite coordinate passed to calculateShieldBezier3D');
      warnedNaN = true;
    }
    return { x: 0, y: 0, z: 0 };
  }

  const t = clamp(tInput, 0, 1);

  // Control point P1
  const p1x = (x0 + x2) / 2;
  const p1y = (y0 + y2) / 2 - arcHeightPx;
  const p1z = (z0 + z2) / 2 + arcHeightPx * Z_LIFT_RATIO;

  const invT = 1 - t;
  const w0 = invT * invT;
  const w1 = 2 * invT * t;
  const w2 = t * t;

  return {
    x: w0 * x0 + w1 * p1x + w2 * x2,
    y: w0 * y0 + w1 * p1y + w2 * y2,
    z: w0 * z0 + w1 * p1z + w2 * z2,
  };
}

/**
 * Calculates 3D deflection trajectory for the attacker's card bouncing off the shield into discard.
 * Sideways and receding curve (negative z).
 */
export function calculateDeflectionArc3D(
  interceptCoord: Coord3D,
  discardCoord: Coord3D,
  tInput: number
): Coord3D {
  const x0 = safeNum(interceptCoord.x);
  const y0 = safeNum(interceptCoord.y);
  const z0 = safeNum(interceptCoord.z);

  const x2 = safeNum(discardCoord.x);
  const y2 = safeNum(discardCoord.y);
  const z2 = safeNum(discardCoord.z);

  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x2) || !Number.isFinite(y2)) {
    return { x: 0, y: 0, z: 0 };
  }

  const t = clamp(tInput, 0, 1);

  const dx = x2 - x0;
  const dy = y2 - y0;
  const dist = Math.hypot(dx, dy);

  if (dist < 0.001) {
    // Degenerate same-point fallback: straight lerp
    return {
      x: x0 + (x2 - x0) * t,
      y: y0 + (y2 - y0) * t,
      z: z0 + (z2 - z0) * t,
    };
  }

  // Perpendicular vector for lateral offset
  const perpX = -dy / dist;
  const perpY = dx / dist;
  const lat = clamp(dist * 0.28, DEFLECT_LATERAL_CLAMP[0], DEFLECT_LATERAL_CLAMP[1]);

  const midX = (x0 + x2) / 2;
  const midY = (y0 + y2) / 2;
  const midZ = (z0 + z2) / 2;

  const p1x = midX + perpX * lat;
  const p1y = midY + perpY * lat - dist * 0.18;
  const p1z = midZ - dist * 0.2; // Negative z = receding away from viewer

  const invT = 1 - t;
  const w0 = invT * invT;
  const w1 = 2 * invT * t;
  const w2 = t * t;

  return {
    x: w0 * x0 + w1 * p1x + w2 * x2,
    y: w0 * y0 + w1 * p1y + w2 * y2,
    z: w0 * z0 + w1 * p1z + w2 * z2,
  };
}

/**
 * Formats hardware-accelerated 3D CSS transform string with precise rounding.
 * Property order: translate3d -> rotateZ -> rotateY -> scale
 */
export function frameToTransform3D(frame: Frame3D): string {
  const norm = (v: number, dp: number) => {
    if (!Number.isFinite(v)) return 0;
    const factor = Math.pow(10, dp);
    const rounded = Math.round(v * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  const x = norm(frame.x, 2);
  const y = norm(frame.y, 2);
  const z = norm(frame.z, 2);
  const rz = norm(frame.rotateZ, 2);
  const ry = norm(frame.rotateY, 2);
  const s = norm(frame.scale, 3);

  return `translate3d(${x}px, ${y}px, ${z}px) rotateZ(${rz}deg) rotateY(${ry}deg) scale(${s})`;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function buildLaunchFrame(plan: CounterFlightPlan, tPhase: number): Frame3D {
  const t = clamp(tPhase, 0, 1);
  const pos = calculateShieldBezier3D(plan.coords.start, plan.coords.intercept, t, plan.arcHeightPx);
  const posZ = pos.z ?? 0;

  const dx = plan.coords.intercept.x - plan.coords.start.x;
  const tiltSign = Math.sign(dx) || 1;

  // rotateY sweeps 0 -> 180 over first 60% of launch phase for flip reveal
  const flipProgress = clamp(t / 0.6, 0, 1);
  const rotateY = flipProgress * 180;

  // rotateZ tilts toward direction of travel
  const rotateZ = tiltSign * 18 * easeInOutQuad(t);

  // scale mirrors z lift
  const zLift = posZ / Math.max(1, plan.arcHeightPx);
  const scale = 1.0 + 0.18 * zLift;

  return {
    x: pos.x,
    y: pos.y,
    z: posZ,
    rotateZ,
    rotateY,
    scale,
    opacity: 1.0,
  };
}

export function buildDeflectFrame(plan: CounterFlightPlan, tPhase: number): Frame3D {
  const t = clamp(tPhase, 0, 1);
  const pos = calculateDeflectionArc3D(plan.coords.intercept, plan.coords.discard, t);
  const posZ = pos.z ?? 0;

  // Tumbles backwards
  const rotateZ = -140 * easeOutCubic(t);
  const rotateY = 180 + 90 * t;
  const scale = 1.0 - 0.28 * t;
  const opacity = 1.0 - 0.65 * t;

  return {
    x: pos.x,
    y: pos.y,
    z: posZ,
    rotateZ,
    rotateY,
    scale,
    opacity,
  };
}

// Active flight registry and event tracking
const activeFlights = new Map<string, CounterFlightPlan>();
const emittedPhases = new Map<string, Set<string>>();
const watchdogTimers = new Map<string, NodeJS.Timeout>();

export function dispatchCounterFlightEvent(
  type: string,
  detail: Record<string, unknown>,
  target: EventTarget = typeof window !== 'undefined' ? window : ({} as EventTarget)
): boolean {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined' || !target || typeof target.dispatchEvent !== 'function') {
    return false;
  }

  try {
    const evt = new CustomEvent(type, { detail, bubbles: true });
    return target.dispatchEvent(evt);
  } catch {
    return false;
  }
}

export function emitPhase(flightId: string, phase: 'launch' | 'intercept' | 'neutralize' | 'complete'): boolean {
  let phaseSet = emittedPhases.get(flightId);
  if (!phaseSet) {
    phaseSet = new Set();
    emittedPhases.set(flightId, phaseSet);
  }

  if (phaseSet.has(phase)) return false; // Idempotent guard
  phaseSet.add(phase);

  const plan = activeFlights.get(flightId);
  const eventName = COUNTER_FLIGHT_EVENTS[phase];

  const detail = {
    flightId,
    chainIndex: plan?.chainIndex ?? 0,
    phase,
    plan,
    defenderSeat: plan?.defenderSeat ?? '',
    attackerSeat: plan?.attackerSeat ?? '',
    counterCard: plan?.counterCard,
    attackerCard: plan?.attackerCard,
  };

  dispatchCounterFlightEvent(eventName, detail);

  // Play corresponding WebAudio sound effect
  if (plan && !plan.reducedMotion) {
    if (phase === 'launch') {
      playCardPlay();
      playCardFlip();
    } else if (phase === 'intercept') {
      playCounterShield();
    } else if (phase === 'neutralize') {
      playActionBlocked();
    }
  }

  if (phase === 'complete') {
    cleanupFlight(flightId);
  }

  return true;
}

function cleanupFlight(flightId: string) {
  activeFlights.delete(flightId);
  emittedPhases.delete(flightId);
  const timer = watchdogTimers.get(flightId);
  if (timer) {
    clearTimeout(timer);
    watchdogTimers.delete(flightId);
  }
}

export function scheduleCounterFlight(params: CounterFlightParams): { plan: CounterFlightPlan; cancel: () => void } {
  const speed = params.speed || 'normal';
  const speedScale = COUNTER_SPEEDS[speed] || 1.0;
  const flightId = params.flightId || `jsn_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const reducedMotion = Boolean(params.reducedMotion);

  const launchMs = Math.round(PHASE_BASE.launch * speedScale);
  const interceptMs = Math.round(PHASE_BASE.intercept * speedScale);
  const deflectMs = Math.round(PHASE_BASE.deflect * speedScale);
  const neutralizeMs = Math.round(PHASE_BASE.neutralize * speedScale);

  const phases: PhaseInfo[] = [
    { name: 'launch', startMs: 0, endMs: launchMs },
    { name: 'intercept', startMs: launchMs, endMs: launchMs + interceptMs },
    { name: 'deflect', startMs: launchMs + interceptMs, endMs: launchMs + interceptMs + deflectMs },
    { name: 'neutralize', startMs: launchMs + interceptMs + deflectMs, endMs: launchMs + interceptMs + deflectMs + neutralizeMs },
  ];

  const totalMs = launchMs + interceptMs + deflectMs + neutralizeMs;

  const cues: SoundCue[] = [
    { atMs: 0, sound: 'cardPlay' },
    { atMs: Math.round(launchMs * 0.5), sound: 'cardFlip' },
    { atMs: launchMs, sound: 'counterShield' },
    { atMs: launchMs + interceptMs + deflectMs, sound: 'actionBlocked' },
  ];

  const plan: CounterFlightPlan = {
    id: flightId,
    speed,
    scale: speedScale,
    chainIndex: params.chainIndex || 0,
    reducedMotion,
    arcHeightPx: 140,
    coords: {
      start: params.startCoord,
      intercept: params.interceptCoord,
      discard: params.discardCoord,
    },
    defenderSeat: params.defenderSeat,
    attackerSeat: params.attackerSeat,
    counterCard: params.counterCard,
    attackerCard: params.attackerCard,
    phases,
    totalMs,
    cues,
  };

  activeFlights.set(flightId, plan);

  // Engine-side watchdog timer
  const watchdog = setTimeout(() => {
    emitPhase(flightId, 'launch');
    emitPhase(flightId, 'intercept');
    emitPhase(flightId, 'neutralize');
    emitPhase(flightId, 'complete');
  }, totalMs + WATCHDOG_GRACE_MS);

  watchdogTimers.set(flightId, watchdog);

  // Dispatch launch event synchronously
  emitPhase(flightId, 'launch');

  return {
    plan,
    cancel: () => cleanupFlight(flightId),
  };
}

export function scheduleCounterFlightChain(
  links: CounterFlightParams[],
  opts: { speed?: CounterSpeed; reducedMotion?: boolean } = {}
): CounterFlightPlan[] {
  const boundedLinks = links.slice(0, MAX_CONCURRENT_FLIGHTS);
  const plans: CounterFlightPlan[] = [];

  let accumulatedMs = 0;

  boundedLinks.forEach((link, idx) => {
    const speed = opts.speed || link.speed || 'normal';
    const speedScale = COUNTER_SPEEDS[speed] || 1.0;
    const overlap = Math.round(CHAIN_OVERLAP_MS * speedScale);

    const delayMs = idx === 0 ? 0 : Math.max(0, accumulatedMs - overlap);

    if (delayMs === 0) {
      const res = scheduleCounterFlight({ ...link, speed, chainIndex: idx, reducedMotion: opts.reducedMotion });
      plans.push(res.plan);
      accumulatedMs = res.plan.totalMs;
    } else {
      setTimeout(() => {
        scheduleCounterFlight({ ...link, speed, chainIndex: idx, reducedMotion: opts.reducedMotion });
      }, delayMs);

      // Create synthetic plan preview for return array
      const launchMs = Math.round(PHASE_BASE.launch * speedScale);
      const totalMs = Math.round((PHASE_BASE.launch + PHASE_BASE.intercept + PHASE_BASE.deflect + PHASE_BASE.neutralize) * speedScale);
      accumulatedMs += totalMs - overlap;

      plans.push({
        id: link.flightId || `jsn_chain_${idx}_${Date.now()}`,
        speed,
        scale: speedScale,
        chainIndex: idx,
        reducedMotion: Boolean(opts.reducedMotion),
        arcHeightPx: 140,
        coords: { start: link.startCoord, intercept: link.interceptCoord, discard: link.discardCoord },
        defenderSeat: link.defenderSeat,
        attackerSeat: link.attackerSeat,
        counterCard: link.counterCard,
        attackerCard: link.attackerCard,
        phases: [{ name: 'launch', startMs: 0, endMs: launchMs }],
        totalMs,
        cues: [],
      });
    }
  });

  return plans;
}

export function cancelCounterFlight(id: string): void {
  cleanupFlight(id);
}

export function cancelAllCounterFlights(): void {
  for (const id of Array.from(activeFlights.keys())) {
    cleanupFlight(id);
  }
}

export function getActiveCounterFlights(): CounterFlightPlan[] {
  return Array.from(activeFlights.values());
}
