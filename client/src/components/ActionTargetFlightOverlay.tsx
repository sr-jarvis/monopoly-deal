import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ACTION_TARGET_FLIGHT_EVENTS,
  emitFlightComplete,
  emitFlightLand,
  frameToTransform,
  isPropertyStealKind,
  playCardFlip,
  prefersReducedMotion,
  sampleGhost,
} from '../utils/actionTargetFlightEngine';
import type {
  ActionFlightEventDetail,
  ActionFlightPlan,
  FlightGhost,
} from '../utils/actionTargetFlightEngine';

const ROOT_ID = 'md-action-target-flight-root';

interface Runtime {
  plan: ActionFlightPlan;
  startedAt: number;
  landed: Set<string>;
  watchdog: ReturnType<typeof setTimeout> | null;
}

function ensureRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ROOT_ID;
    el.setAttribute('aria-hidden', 'true');
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '9000';
    el.style.perspective = '1200px';
    el.style.perspectiveOrigin = '50% 50%';
    document.body.appendChild(el);
  }
  return el;
}

export const ActionTargetFlightOverlay: React.FC = React.memo(() => {
  const [root] = useState<HTMLElement | null>(() => ensureRoot());
  const [plans, setPlans] = useState<ActionFlightPlan[]>([]);
  const runtimesRef = useRef<Map<string, Runtime>>(new Map());
  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const rafRef = useRef<number | null>(null);
  const reducedRef = useRef<boolean>(prefersReducedMotion());

  /* Keep reduced-motion preference live */
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => {
      reducedRef.current = mq.matches;
    };
    onChange();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
  }, []);

  /* Start listener + RAF driver */
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const finish = (planId: string, reason: ActionFlightEventDetail['reason']) => {
      const rt = runtimesRef.current.get(planId);
      if (!rt) return;
      if (rt.watchdog) clearTimeout(rt.watchdog);
      runtimesRef.current.delete(planId);
      nodesRef.current.forEach((_node, key) => {
        if (key.startsWith(`${planId}::`)) nodesRef.current.delete(key);
      });
      setPlans((prev) => prev.filter((p) => p.id !== planId));
      emitFlightComplete(rt.plan, reason);
    };

    const tick = () => {
      rafRef.current = null;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

      runtimesRef.current.forEach((rt, planId) => {
        const elapsed = now - rt.startedAt;
        for (const ghost of rt.plan.ghosts) {
          const node = nodesRef.current.get(`${planId}::${ghost.id}`);
          if (!node) continue;
          const frame = sampleGhost(ghost, elapsed);
          node.style.transform = frameToTransform(frame);
          node.style.opacity = frame.visible ? String(Number(frame.opacity.toFixed(3))) : '0';
          node.style.visibility = frame.visible ? 'visible' : 'hidden';

          if (!rt.landed.has(ghost.id) && elapsed >= ghost.landAtMs) {
            rt.landed.add(ghost.id);
            if (isPropertyStealKind(ghost.kind)) playCardFlip();
            emitFlightLand(rt.plan, ghost);
          }
        }
        if (elapsed >= rt.plan.totalDurationMs) finish(planId, 'finished');
      });

      if (runtimesRef.current.size > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    const onStart = (evt: Event) => {
      const detail = (evt as CustomEvent<ActionFlightEventDetail>).detail;
      const plan = detail && detail.plan;
      if (!plan || !plan.ghosts || plan.ghosts.length === 0) return;

      if (plan.reducedMotion || reducedRef.current) return;
      if (runtimesRef.current.has(plan.id)) return;

      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const watchdog = setTimeout(() => finish(plan.id, 'watchdog'), plan.watchdogMs);
      runtimesRef.current.set(plan.id, { plan, startedAt, landed: new Set(), watchdog });
      setPlans((prev) => [...prev, plan]);

      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
    };

    document.addEventListener(ACTION_TARGET_FLIGHT_EVENTS.start, onStart as EventListener);
    return () => {
      document.removeEventListener(ACTION_TARGET_FLIGHT_EVENTS.start, onStart as EventListener);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      runtimesRef.current.forEach((rt) => {
        if (rt.watchdog) clearTimeout(rt.watchdog);
        emitFlightComplete(rt.plan, 'unmounted');
      });
      runtimesRef.current.clear();
      nodesRef.current.clear();
    };
  }, []);

  if (!root || plans.length === 0) return null;

  return createPortal(
    <>
      {plans.map((plan) =>
        plan.ghosts.map((ghost: FlightGhost) => (
          <div
            key={`${plan.id}::${ghost.id}`}
            ref={(node) => {
              const key = `${plan.id}::${ghost.id}`;
              if (node) nodesRef.current.set(key, node);
              else nodesRef.current.delete(key);
            }}
            className={`md-atf-ghost md-atf-ghost--${ghost.kind}`}
            data-atf-plan={plan.id}
            data-atf-ghost={ghost.id}
            data-atf-seat={ghost.seat}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: `${ghost.width}px`,
              height: `${ghost.height}px`,
              marginLeft: `${-ghost.width / 2}px`,
              marginTop: `${-ghost.height / 2}px`,
              transformStyle: 'preserve-3d',
              transformOrigin: '50% 50%',
              willChange: 'transform, opacity',
              pointerEvents: 'none',
              visibility: 'hidden',
              opacity: 0,
            }}
          >
            <div
              className="md-atf-face md-atf-face--front"
              style={{ ...FACE_STYLE, background: ghost.color || '#1f2a44' }}
            >
              {ghost.label}
            </div>
            <div
              className="md-atf-face md-atf-face--back"
              style={{ ...FACE_STYLE, transform: 'rotateY(180deg)', background: '#0f766e' }}
            >
              {ghost.acquiredLabel || ghost.label}
            </div>
          </div>
        )),
      )}
    </>,
    root,
  );
});

const FACE_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  borderRadius: '8px',
  border: '1px solid rgba(255,255,255,0.35)',
  boxShadow: '0 10px 26px rgba(0,0,0,0.38)',
  color: '#fff',
  fontSize: '11px',
  fontWeight: 700,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: '4px',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

export default ActionTargetFlightOverlay;
