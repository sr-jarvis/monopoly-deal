import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FLIGHT_EVENTS,
  FlightPlan,
  evaluateFlight,
  frameToTransform,
  cancelAllFlights,
} from '../utils/cardPlayFlightEngine';

export interface CardPlayFlightOverlayProps {
  container?: HTMLElement;
  zIndex?: number;
  perspectivePx?: number;
}

interface ActiveGhost {
  plan: FlightPlan;
  isLanding: boolean;
}

export const CardPlayFlightOverlay: React.FC<CardPlayFlightOverlayProps> = React.memo(({
  container,
  zIndex = 900,
  perspectivePx = 1200,
}) => {
  const [ghosts, setGhosts] = useState<ActiveGhost[]>([]);
  const ghostsMapRef = useRef<Map<string, ActiveGhost>>(new Map());
  const elementRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const rafHandleRef = useRef<number | null>(null);

  const targetContainer = container || (typeof document !== 'undefined' ? document.body : null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStart = (e: Event) => {
      const customEvent = e as CustomEvent<{ plan: FlightPlan }>;
      const plan = customEvent.detail?.plan;
      if (!plan || plan.degenerate) return;

      const newGhost: ActiveGhost = { plan, isLanding: false };
      ghostsMapRef.current.set(plan.id, newGhost);
      setGhosts(Array.from(ghostsMapRef.current.values()));
    };

    const handleLand = (e: Event) => {
      const customEvent = e as CustomEvent<{ id: string }>;
      const id = customEvent.detail?.id;
      if (!id) return;

      const existing = ghostsMapRef.current.get(id);
      if (existing) {
        existing.isLanding = true;
        setGhosts(Array.from(ghostsMapRef.current.values()));
      }
    };

    const handleComplete = (e: Event) => {
      const customEvent = e as CustomEvent<{ id: string }>;
      const id = customEvent.detail?.id;
      if (!id) return;

      ghostsMapRef.current.delete(id);
      elementRefs.current.delete(id);
      setGhosts(Array.from(ghostsMapRef.current.values()));
    };

    const handleViewportChange = () => {
      cancelAllFlights('viewport_change');
    };

    window.addEventListener(FLIGHT_EVENTS.start, handleStart);
    window.addEventListener(FLIGHT_EVENTS.land, handleLand);
    window.addEventListener(FLIGHT_EVENTS.complete, handleComplete);
    window.addEventListener('resize', handleViewportChange);

    return () => {
      window.removeEventListener(FLIGHT_EVENTS.start, handleStart);
      window.removeEventListener(FLIGHT_EVENTS.land, handleLand);
      window.removeEventListener(FLIGHT_EVENTS.complete, handleComplete);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, []);

  // RAF animation loop driven directly by performance.now()
  useEffect(() => {
    if (ghosts.length === 0) {
      if (rafHandleRef.current) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
      return;
    }

    const animate = () => {
      const now = performance.now();
      ghostsMapRef.current.forEach((ghost, id) => {
        const el = elementRefs.current.get(id);
        if (!el) return;

        const elapsedMs = now - ghost.plan.startedAt;
        const frame = evaluateFlight(ghost.plan, elapsedMs);

        el.style.transform = frameToTransform(frame);
        el.style.opacity = String(frame.opacity);
      });

      rafHandleRef.current = requestAnimationFrame(animate);
    };

    rafHandleRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafHandleRef.current) {
        cancelAnimationFrame(rafHandleRef.current);
        rafHandleRef.current = null;
      }
    };
  }, [ghosts.length]);

  if (!targetContainer || ghosts.length === 0) return null;

  return createPortal(
    <div
      className="cpf-root fixed inset-0 pointer-events-none select-none"
      style={{
        zIndex,
        perspective: `${perspectivePx}px`,
        transformStyle: 'preserve-3d',
      }}
      aria-hidden="true"
      role="presentation"
    >
      {ghosts.map(({ plan, isLanding }) => (
        <div
          key={plan.id}
          data-flight-id={plan.id}
          data-target={plan.target}
          ref={(el) => {
            if (el) elementRefs.current.set(plan.id, el);
            else elementRefs.current.delete(plan.id);
          }}
          className={`cpf-ghost absolute top-0 left-0 w-24 h-36 rounded-lg shadow-2xl overflow-hidden border border-amber-400/40 bg-slate-900/90 backdrop-blur-sm transition-shadow duration-150 ${
            isLanding ? 'scale-[1.04] shadow-amber-400/60' : ''
          }`}
          style={{
            transformOrigin: '50% 50%',
            backfaceVisibility: 'hidden',
            willChange: isLanding ? 'auto' : 'transform, opacity',
          }}
        >
          {plan.cardImage ? (
            <img
              src={plan.cardImage}
              alt=""
              draggable={false}
              className="w-full h-full object-cover rounded-lg"
            />
          ) : (
            <div className="w-full h-full p-2 flex flex-col justify-between items-center text-center">
              <div
                className="w-full h-3 rounded"
                style={{ backgroundColor: plan.colorKey || '#3b82f6' }}
              />
              <span className="font-mono text-xs font-bold text-amber-200 tracking-wider">
                {plan.cardLabel || plan.cardId.toUpperCase().slice(0, 10)}
              </span>
              <div
                className="w-full h-3 rounded"
                style={{ backgroundColor: plan.colorKey || '#3b82f6' }}
              />
            </div>
          )}
        </div>
      ))}
    </div>,
    targetContainer
  );
});

CardPlayFlightOverlay.displayName = 'CardPlayFlightOverlay';
