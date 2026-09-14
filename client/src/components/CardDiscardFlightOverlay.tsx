/**
 * CardDiscardFlightOverlay.tsx — Monopoly Deal 3D Card Discard Flight React Portal Overlay.
 *
 * Renders hardware-accelerated 3D flying card ghosts during player hand over-limit discards and card play discard actions.
 *
 * Features:
 *   - React portal mounted to document.body (div#md-discard-flight-root)
 *   - Listens to custom DOM events: md:carddiscardflight:start, md:carddiscardflight:land, md:carddiscardflight:complete
 *   - Single requestAnimationFrame loop driving CSS 3D transforms (translate3d, rotateZ, rotateY, scale)
 *   - Organic Z-axis scatter rotation (-25deg to +25deg) on central discard pile landing
 *   - 3D Y-axis card flip / back-face visibility rendering
 *   - Reduced motion fallback (prefers-reduced-motion)
 *   - Watchdog auto-cleanup and portal management
 */

import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DiscardFlightPlan,
  DISCARD_FLIGHT_EVENTS,
  DISCARD_FLIGHT_CONFIG,
  evaluateDiscardFrame,
  frameToTransform,
} from '../utils/cardDiscardFlightEngine';
import * as sfx from '../utils/soundEngine';

export const CardDiscardFlightOverlay: React.FC = () => {
  const [activeFlight, setActiveFlight] = useState<DiscardFlightPlan | null>(null);
  const activeFlightRef = useRef<DiscardFlightPlan | null>(null);
  const startTimeRef = useRef<number>(0);
  const animationFrameIdRef = useRef<number | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const watchdogTimerRef = useRef<NodeJS.Timeout | null>(null);
  const landedRef = useRef<boolean>(false);

  // Portal container management
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let root = document.getElementById('md-discard-flight-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'md-discard-flight-root';
      root.style.position = 'fixed';
      root.style.inset = '0';
      root.style.pointerEvents = 'none';
      root.style.zIndex = '9998';
      root.style.perspective = '1000px';
      root.setAttribute('aria-hidden', 'true');
      document.body.appendChild(root);
    }
    setPortalRoot(root);
  }, []);

  // Check reduced motion preference
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFlightStart = (event: Event) => {
      const customEvt = event as CustomEvent<DiscardFlightPlan>;
      const plan = customEvt.detail;

      if (!plan) return;

      if (prefersReducedMotion || plan.reducedMotion) {
        try {
          sfx.playCardFlip();
        } catch {}
        return;
      }

      activeFlightRef.current = plan;
      startTimeRef.current = performance.now();
      landedRef.current = false;
      setActiveFlight(plan);

      // Set watchdog safety timer
      if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = setTimeout(() => {
        if (activeFlightRef.current && activeFlightRef.current.flightId === plan.flightId) {
          activeFlightRef.current = null;
          setActiveFlight(null);
        }
      }, plan.durationMs + DISCARD_FLIGHT_CONFIG.settleMs + DISCARD_FLIGHT_CONFIG.watchdogGraceMs);
    };

    window.addEventListener(DISCARD_FLIGHT_EVENTS.start, handleFlightStart);

    return () => {
      window.removeEventListener(DISCARD_FLIGHT_EVENTS.start, handleFlightStart);
      if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
    };
  }, [prefersReducedMotion]);

  // RequestAnimationFrame loop
  useEffect(() => {
    if (!activeFlight) return;

    const tick = (now: number) => {
      const plan = activeFlightRef.current;
      if (!plan) return;

      const elapsedMs = now - startTimeRef.current;
      const frame = evaluateDiscardFrame(plan, elapsedMs);

      if (ghostRef.current) {
        ghostRef.current.style.transform = frameToTransform(frame);
        ghostRef.current.style.opacity = String(frame.opacity);
      }

      if (frame.progress >= 1 && !landedRef.current) {
        landedRef.current = true;
        try {
          sfx.playCardFlip();
        } catch {}

        const landEvt = new CustomEvent(DISCARD_FLIGHT_EVENTS.land, {
          detail: {
            flightId: plan.flightId,
            cascadeId: plan.cascadeId,
            cardId: plan.cardId,
            seatId: plan.seatId,
            index: plan.index,
            total: plan.total,
            scatterDeg: plan.scatterDeg,
            at: { x: plan.to.x + plan.to.w / 2, y: plan.to.y + plan.to.h / 2 },
          },
        });
        window.dispatchEvent(landEvt);
      }

      if (elapsedMs < plan.durationMs + DISCARD_FLIGHT_CONFIG.settleMs) {
        animationFrameIdRef.current = requestAnimationFrame(tick);
      } else {
        activeFlightRef.current = null;
        setActiveFlight(null);
      }
    };

    animationFrameIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [activeFlight]);

  if (!portalRoot || !activeFlight) {
    return null;
  }

  const initialFrame = evaluateDiscardFrame(activeFlight, 0);

  return createPortal(
    <div
      ref={ghostRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${activeFlight.from.w}px`,
        height: `${activeFlight.from.h}px`,
        transform: frameToTransform(initialFrame),
        transformStyle: 'preserve-3d',
        backfaceVisibility: 'hidden',
        willChange: 'transform, opacity',
        pointerEvents: 'none',
      }}
    >
      <div className="relative w-full h-full rounded-lg border-2 border-slate-600 bg-slate-800 shadow-2xl overflow-hidden flex flex-col justify-between p-2 select-none">
        <div className="text-xs font-black text-amber-400 tracking-wider">DISCARD</div>
        <div className="text-center text-lg font-extrabold text-slate-100">🎴</div>
        <div className="text-[10px] text-right text-slate-400 font-mono">MONOPOLY</div>
      </div>
    </div>,
    portalRoot
  );
};

export default CardDiscardFlightOverlay;
