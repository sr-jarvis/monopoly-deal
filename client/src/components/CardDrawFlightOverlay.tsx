/**
 * CardDrawFlightOverlay.tsx — Monopoly Deal 3D Card Draw Flight React Portal Overlay.
 *
 * Renders hardware-accelerated 3D flying card ghosts during turn draws, Pass Go actions,
 * and touch swipe-to-draw gestures.
 *
 * Features:
 *   - React portal mounted to document.body
 *   - Listens to custom DOM events: md:carddrawflight:start, md:carddrawflight:land, md:carddrawflight:complete
 *   - Single requestAnimationFrame loop driving CSS 3D transforms
 *   - 3D Y-axis card flip (Face-down card back -> Face-up card front)
 *   - Reduced motion fallback (prefers-reduced-motion)
 *   - Watchdog auto-cleanup
 */

import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  CardDrawFlightConfig,
  DrawFlightStartDetail,
  evaluateDrawFlightFrame,
  frameToTransform,
  dispatchDrawFlightLand,
  dispatchDrawFlightComplete,
} from '../utils/cardDrawFlightEngine';

export const CardDrawFlightOverlay: React.FC = () => {
  const [activeGhosts, setActiveGhosts] = useState<CardDrawFlightConfig[]>([]);
  const activeGhostsRef = useRef<CardDrawFlightConfig[]>([]);
  const planStartTimeRef = useRef<number>(0);
  const landedSetRef = useRef<Set<string>>(new Set());
  const animationFrameIdRef = useRef<number | null>(null);
  const ghostElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Check reduced motion preference
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFlightStart = (event: Event) => {
      const customEvt = event as CustomEvent<DrawFlightStartDetail>;
      const { ghosts } = customEvt.detail;

      if (!ghosts || ghosts.length === 0) return;

      if (prefersReducedMotion) {
        // Skip flight animation for reduced motion
        ghosts.forEach((ghost) => {
          dispatchDrawFlightLand(ghost.id.split('-ghost-')[0], ghost.id, ghost.cardIndex, ghost.kind);
        });
        dispatchDrawFlightComplete(
          ghosts[0].id.split('-ghost-')[0],
          ghosts[0].kind,
          ghosts.length
        );
        return;
      }

      activeGhostsRef.current = ghosts;
      planStartTimeRef.current = performance.now();
      landedSetRef.current.clear();
      setActiveGhosts(ghosts);
    };

    window.addEventListener('md:carddrawflight:start', handleFlightStart);

    return () => {
      window.removeEventListener('md:carddrawflight:start', handleFlightStart);
    };
  }, [prefersReducedMotion]);

  // Main RAF Loop
  useEffect(() => {
    if (activeGhosts.length === 0) return;

    const updateFrame = () => {
      const now = performance.now();
      const elapsedTotalMs = now - planStartTimeRef.current;
      const ghosts = activeGhostsRef.current;

      let allComplete = true;

      ghosts.forEach((ghost) => {
        const ghostElapsed = elapsedTotalMs - ghost.startMs;
        const el = ghostElementsRef.current.get(ghost.id);

        if (ghostElapsed < 0) {
          allComplete = false;
          if (el) el.style.opacity = '0';
          return;
        }

        if (ghostElapsed >= ghost.durationMs) {
          if (!landedSetRef.current.has(ghost.id)) {
            landedSetRef.current.add(ghost.id);
            const planId = ghost.id.split('-ghost-')[0];
            dispatchDrawFlightLand(planId, ghost.id, ghost.cardIndex, ghost.kind);
          }
          if (el) el.style.opacity = '0';
          return;
        }

        allComplete = false;
        const frame = evaluateDrawFlightFrame(ghost, ghostElapsed);

        if (el) {
          el.style.opacity = String(frame.opacity);
          el.style.transform = frameToTransform(frame);
        }
      });

      if (allComplete) {
        if (ghosts.length > 0) {
          const planId = ghosts[0].id.split('-ghost-')[0];
          dispatchDrawFlightComplete(planId, ghosts[0].kind, ghosts.length);
        }
        activeGhostsRef.current = [];
        setActiveGhosts([]);
        return;
      }

      animationFrameIdRef.current = requestAnimationFrame(updateFrame);
    };

    animationFrameIdRef.current = requestAnimationFrame(updateFrame);

    return () => {
      if (animationFrameIdRef.current !== null) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [activeGhosts]);

  if (activeGhosts.length === 0 || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      tabIndex={-1}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 99999,
        perspective: '1000px',
        overflow: 'hidden',
      }}
    >
      {activeGhosts.map((ghost) => (
        <div
          key={ghost.id}
          ref={(el) => {
            if (el) ghostElementsRef.current.set(ghost.id, el);
            else ghostElementsRef.current.delete(ghost.id);
          }}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '64px',
            height: '92px',
            transformStyle: 'preserve-3d',
            willChange: 'transform, opacity',
            opacity: 0,
          }}
        >
          {/* Card Back (Shown during initial flight out of deck) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              border: '2px solid #38bdf8',
              boxShadow: '0 8px 16px rgba(0,0,0,0.4), 0 0 12px rgba(56,189,248,0.3)',
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: '10px', color: '#38bdf8', fontWeight: 'bold' }}>
              MONOPOLY
            </span>
          </div>

          {/* Card Front (Revealed in 3D as card lands in hand) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '8px',
              background: ghost.color
                ? `linear-gradient(135deg, ${ghost.color} 0%, #0f172a 100%)`
                : 'linear-gradient(135deg, #334155 0%, #1e293b 100%)',
              border: '2px solid #f1f5f9',
              boxShadow: '0 12px 24px rgba(0,0,0,0.5), 0 0 16px rgba(255,255,255,0.2)',
              backfaceVisibility: 'hidden',
              transform: 'rotateY(0deg)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
            }}
          >
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: '#ffffff',
                textAlign: 'center',
                lineHeight: '1.2',
                wordBreak: 'break-word',
              }}
            >
              {ghost.label}
            </span>
          </div>
        </div>
      ))}
    </div>,
    document.body
  );
};
