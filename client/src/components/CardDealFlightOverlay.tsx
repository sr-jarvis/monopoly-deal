/**
 * CardDealFlightOverlay.tsx — Monopoly Deal 3D Card Deal Flight React Portal Overlay.
 *
 * Renders hardware-accelerated 3D flying card ghosts during initial game deals and rematches
 * across 2 to 5 player seats.
 *
 * Features:
 *   - React portal mounted to document.body
 *   - Listens to custom DOM events: md:carddealflight:start, md:carddealflight:land, md:carddealflight:complete
 *   - Single requestAnimationFrame loop driving CSS 3D transforms
 *   - 3D Y-axis card flip (Face-down card back -> Face-up card front for human; remains face-down for opponents)
 *   - Reduced motion fallback (prefers-reduced-motion)
 *   - Watchdog auto-cleanup and portal management
 */

import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  DealCascadePlan,
  DEAL_FLIGHT_EVENTS,
  DEAL_FLIGHT_DEFAULTS,
  buildFlightFrameTransform,
  emitDealLand,
  emitDealComplete,
  playDealLaunchSfx,
  playDealLandSfx,
} from '../utils/cardDealFlightEngine';

export const CardDealFlightOverlay: React.FC = () => {
  const [activePlan, setActivePlan] = useState<DealCascadePlan | null>(null);
  const activePlanRef = useRef<DealCascadePlan | null>(null);
  const planStartTimeRef = useRef<number>(0);
  const landedSetRef = useRef<Set<string>>(new Set());
  const launchedSetRef = useRef<Set<string>>(new Set());
  const animationFrameIdRef = useRef<number | null>(null);
  const ghostElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const watchdogTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Portal container management
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    let root = document.getElementById('md-flight-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'md-flight-root';
      root.style.position = 'fixed';
      root.style.inset = '0';
      root.style.pointerEvents = 'none';
      root.style.zIndex = '9999';
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
      const customEvt = event as CustomEvent<{ runId: string; plan: DealCascadePlan }>;
      const plan = customEvt.detail?.plan;

      if (!plan || plan.flights.length === 0) return;

      // Stop previous run if active
      if (activePlanRef.current) {
        emitDealComplete(activePlanRef.current.runId, {
          dealt: landedSetRef.current.size,
          durationMs: Date.now() - planStartTimeRef.current,
          cancelled: true,
        });
      }

      if (prefersReducedMotion || plan.reducedMotion) {
        // Instant completion for reduced motion
        plan.flights.forEach((flight) => {
          emitDealLand(plan.runId, flight);
        });
        emitDealComplete(plan.runId, {
          dealt: plan.flights.length,
          durationMs: 0,
          cancelled: false,
        });
        playDealLandSfx();
        return;
      }

      activePlanRef.current = plan;
      planStartTimeRef.current = performance.now();
      landedSetRef.current.clear();
      launchedSetRef.current.clear();
      setActivePlan(plan);

      // Set watchdog safety timer
      if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = setTimeout(() => {
        if (activePlanRef.current && activePlanRef.current.runId === plan.runId) {
          plan.flights.forEach((f) => {
            if (!landedSetRef.current.has(f.id)) {
              landedSetRef.current.add(f.id);
              emitDealLand(plan.runId, f);
            }
          });
          emitDealComplete(plan.runId, {
            dealt: plan.flights.length,
            durationMs: plan.totalDurationMs,
            cancelled: true,
          });
          activePlanRef.current = null;
          setActivePlan(null);
        }
      }, plan.totalDurationMs + DEAL_FLIGHT_DEFAULTS.watchdogPaddingMs);
    };

    window.addEventListener(DEAL_FLIGHT_EVENTS.start, handleFlightStart);

    return () => {
      window.removeEventListener(DEAL_FLIGHT_EVENTS.start, handleFlightStart);
    };
  }, [prefersReducedMotion]);

  // Main RAF Loop
  useEffect(() => {
    if (!activePlan || activePlan.flights.length === 0) return;

    const updateFrame = () => {
      const now = performance.now();
      const elapsedTotalMs = now - planStartTimeRef.current;
      const plan = activePlanRef.current;

      if (!plan) return;

      let allLanded = true;

      plan.flights.forEach((flight) => {
        const el = ghostElementsRef.current.get(flight.id);
        const frame = buildFlightFrameTransform(flight, elapsedTotalMs);

        if (elapsedTotalMs >= flight.startAtMs && !launchedSetRef.current.has(flight.id)) {
          launchedSetRef.current.add(flight.id);
          playDealLaunchSfx();
        }

        if (frame.landed) {
          if (!landedSetRef.current.has(flight.id)) {
            landedSetRef.current.add(flight.id);
            emitDealLand(plan.runId, flight);
            playDealLandSfx();
          }
          if (el) el.style.opacity = '0';
        } else {
          allLanded = false;
          if (el) {
            el.style.opacity = String(frame.opacity);
            el.style.transform = frame.transform;
          }
        }
      });

      if (allLanded) {
        if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
        emitDealComplete(plan.runId, {
          dealt: plan.flights.length,
          durationMs: Math.round(now - planStartTimeRef.current),
          cancelled: false,
        });
        activePlanRef.current = null;
        setActivePlan(null);
      } else {
        animationFrameIdRef.current = requestAnimationFrame(updateFrame);
      }
    };

    animationFrameIdRef.current = requestAnimationFrame(updateFrame);

    return () => {
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [activePlan]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
      if (activePlanRef.current) {
        emitDealComplete(activePlanRef.current.runId, {
          dealt: landedSetRef.current.size,
          durationMs: 0,
          cancelled: true,
        });
      }
    };
  }, []);

  if (!portalRoot || !activePlan || activePlan.flights.length === 0) {
    return null;
  }

  const renderFlights = activePlan.flights.slice(0, DEAL_FLIGHT_DEFAULTS.maxFlights);

  return createPortal(
    <div
      className="md-deal-flight-layer"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        perspective: '1000px',
      }}
      aria-hidden="true"
    >
      {renderFlights.map((flight) => (
        <div
          key={flight.id}
          ref={(el) => {
            if (el) ghostElementsRef.current.set(flight.id, el);
            else ghostElementsRef.current.delete(flight.id);
          }}
          className="md-deal-ghost"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '64px',
            height: '92px',
            pointerEvents: 'none',
            opacity: 0,
            willChange: 'transform, opacity',
          }}
        >
          <div
            className="md-deal-ghost__inner"
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '8px',
              position: 'relative',
              transformStyle: 'preserve-3d',
            }}
          >
            {/* Front Card Face */}
            <div
              className="md-deal-ghost__face md-deal-ghost__face--front"
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                boxShadow: '0 8px 16px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(0deg)',
              }}
            >
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  color: '#38bdf8',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                DEAL
              </span>
            </div>

            {/* Back Card Face */}
            <div
              className="md-deal-ghost__face md-deal-ghost__face--back"
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
                boxShadow: '0 8px 16px rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <div
                style={{
                  width: '80%',
                  height: '80%',
                  borderRadius: '4px',
                  border: '1px dashed rgba(99, 102, 241, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span style={{ fontSize: '10px', color: '#818cf8', fontWeight: 700 }}>MD</span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>,
    portalRoot
  );
};
