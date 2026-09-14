/**
 * CardFlightOverlay.tsx — Monopoly Deal 3D Card Flight & Trajectory Arc Overlay.
 *
 * Renders hardware-accelerated 3D flying card ghosts along computed Bezier trajectories
 * during card deal sequences, draw card flight animations, and touch deal gestures.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  CARD_FLIGHT_EVENTS,
  DealFlightConfig,
  CardFlightStartDetail,
  calculateFlightTransform,
  cardFlightEngine,
} from '../utils/cardFlightEngine';
import { playCardPlay, playCardFlip } from '../utils/soundEngine';

export interface CardFlightOverlayProps {
  enabled?: boolean;
}

export const CardFlightOverlay: React.FC<CardFlightOverlayProps> = ({ enabled = true }) => {
  const [activeFlights, setActiveFlights] = useState<DealFlightConfig[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const animFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const handleFlightStart = (e: Event) => {
      playCardPlay();
      const customEv = e as CustomEvent<CardFlightStartDetail>;
      const flights = customEv.detail?.flights || cardFlightEngine.getSnapshot().flights;
      if (flights && flights.length > 0) {
        setActiveFlights(flights);
        startTimeRef.current = performance.now();
      }
    };

    const handleFlightLand = () => {
      playCardFlip();
    };

    const handleFlightComplete = () => {
      setActiveFlights([]);
      setProgressMap({});
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };

    window.addEventListener(CARD_FLIGHT_EVENTS.start, handleFlightStart);
    window.addEventListener(CARD_FLIGHT_EVENTS.land, handleFlightLand);
    window.addEventListener(CARD_FLIGHT_EVENTS.complete, handleFlightComplete);

    return () => {
      window.removeEventListener(CARD_FLIGHT_EVENTS.start, handleFlightStart);
      window.removeEventListener(CARD_FLIGHT_EVENTS.land, handleFlightLand);
      window.removeEventListener(CARD_FLIGHT_EVENTS.complete, handleFlightComplete);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [enabled]);

  useEffect(() => {
    if (activeFlights.length === 0) return;

    const updateProgress = () => {
      const now = performance.now();
      const startTime = startTimeRef.current ?? now;
      const newProgressMap: Record<string, number> = {};

      let hasActive = false;
      activeFlights.forEach((flight) => {
        const elapsed = now - startTime - flight.delayMs;
        const progress = Math.min(1, Math.max(0, elapsed / flight.durationMs));
        newProgressMap[flight.flightId] = progress;
        if (progress < 1) {
          hasActive = true;
        }
      });

      setProgressMap(newProgressMap);

      if (hasActive) {
        animFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    animFrameRef.current = requestAnimationFrame(updateProgress);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [activeFlights]);

  if (!enabled || activeFlights.length === 0) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      style={{ perspective: '1200px' }}
    >
      {activeFlights.map((flight) => {
        const progress = progressMap[flight.flightId] ?? 0;
        if (progress <= 0 || progress >= 1) return null;

        const tf = calculateFlightTransform(
          flight.startPoint,
          flight.endPoint,
          flight.rotateStart,
          flight.rotateEnd,
          flight.flipCount,
          flight.arcHeightPx,
          progress,
        );

        return (
          <div
            key={flight.flightId}
            className="absolute h-28 w-20 rounded-lg border-2 border-amber-300/60 bg-gradient-to-br from-amber-700 via-yellow-900 to-slate-900 shadow-2xl"
            style={{
              left: `${tf.x}%`,
              top: `${tf.y}%`,
              transform: `translate3d(-50%, -50%, ${tf.z}px) rotateZ(${tf.rotateZ}deg) rotateY(${tf.rotateY}deg) scale(${tf.scale})`,
              transformStyle: 'preserve-3d',
              opacity: tf.opacity,
              willChange: 'transform, opacity',
            }}
          >
            <div className="flex h-full w-full items-center justify-center rounded-md border border-amber-400/30 bg-slate-950/40 p-1 text-center font-bold text-amber-200 text-xs">
              <span className="opacity-85">MD</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default CardFlightOverlay;
