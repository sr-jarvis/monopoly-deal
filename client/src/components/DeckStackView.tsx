import React, { useEffect, useState, useRef } from 'react';
import type { CSSProperties } from 'react';
import { CardBackView } from './CardBackView';
import {
  SHUFFLE_EVENTS,
  onShuffleEvent,
  cardTransform,
  STACK_SIZE,
  type DealDetail,
} from '../utils/shuffleEngine';
import { recognizeTouchDealSwipe, cardFlightEngine } from '../utils/cardFlightEngine';

export interface DeckStackViewProps {
  remaining: number;
  isDrawPhase: boolean;
  canDraw: boolean;
  onDraw: () => void;
  className?: string;
}

export const DeckStackView: React.FC<DeckStackViewProps> = React.memo(({
  remaining,
  isDrawPhase,
  canDraw,
  onDraw,
  className = ''
}) => {
  const layersCount = Math.min(5, Math.max(1, Math.ceil(remaining / 12)));
  const layerArray = Array.from({ length: layersCount }, (_, i) => i);

  const [flights, setFlights] = useState<DealDetail['flights']>([]);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => {
    return onShuffleEvent<DealDetail>(SHUFFLE_EVENTS.deal, (detail) => {
      setFlights(detail.flights);
      const timer = window.setTimeout(() => setFlights([]), detail.totalDurationMs + 60);
      return () => window.clearTimeout(timer);
    });
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && canDraw) {
      e.preventDefault();
      onDraw();
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: performance.now(),
      };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length === 0) return;
    const touch = e.changedTouches[0];
    const duration = performance.now() - touchStartRef.current.time;
    const gesture = recognizeTouchDealSwipe(
      touchStartRef.current.x,
      touchStartRef.current.y,
      touch.clientX,
      touch.clientY,
      duration,
    );

    touchStartRef.current = null;

    if (gesture.isSwipe && canDraw) {
      cardFlightEngine.launchDealSequence(1, 2);
      onDraw();
    }
  };

  return (
    <div className={`relative flex flex-col items-center select-none ${className}`}>
      {/* Visual Card Stack Depth Layers */}
      <div className="relative w-24 h-36" data-deck-stack="true">
        {layerArray.map((layerIndex) => {
          const offset = (layersCount - 1 - layerIndex) * 2;
          const isTopLayer = layerIndex === layersCount - 1;

          if (!isTopLayer) {
            return (
              <div
                key={layerIndex}
                className="absolute inset-0 transition-transform pointer-events-none"
                style={{
                  transform: `translate3d(-${offset}px, -${offset}px, 0)`,
                  zIndex: layerIndex
                }}
              >
                <CardBackView aria-hidden size="md" />
              </div>
            );
          }

          return (
            <button
              key={layerIndex}
              type="button"
              disabled={!canDraw}
              onClick={onDraw}
              onKeyDown={handleKeyDown}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              aria-label={`Draw pile - ${remaining} cards remaining${isDrawPhase && canDraw ? '. Click to draw' : ''}`}
              className={`
                absolute inset-0 rounded-xl transition-all duration-200 outline-none
                ${isDrawPhase && canDraw ? 'md-deck--pulsing cursor-pointer ring-4 ring-amber-400 z-30 scale-105' : ''}
                ${canDraw ? 'hover:-translate-y-1 hover:shadow-2xl cursor-pointer z-20' : 'opacity-70 cursor-not-allowed'}
              `}
              style={{
                transform: `translate3d(-${offset}px, -${offset}px, 0)`,
                zIndex: layerIndex
              }}
            >
              <CardBackView aria-hidden size="md" />
            </button>
          );
        })}
      </div>

      {/* Deck Remaining Counter Badge */}
      <div className="mt-2.5 px-3 py-1 bg-slate-950/90 border border-slate-700/80 rounded-full shadow-lg flex items-center gap-1.5 z-40">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
        <span className="text-xs font-extrabold text-amber-200 tracking-wider">
          {remaining} DECK
        </span>
      </div>

      {/* Cards Flying Out on Draw / Deal Events */}
      {flights.length > 0 && (
        <div className="absolute inset-0 pointer-events-none z-50">
          {flights.map((flight) => {
            const peak = cardTransform('dealing', flight.cardIndex, STACK_SIZE, 1);
            const style = {
              '--md-shuffle-x': `${peak.x}px`,
              '--md-shuffle-y': `${peak.y}px`,
              '--md-shuffle-z': `${peak.z}px`,
              '--md-shuffle-rot': `${peak.rotate}deg`,
              '--md-shuffle-tilt': `${peak.tilt}deg`,
              '--md-shuffle-opacity': '0',
              '--md-shuffle-duration': `${flight.durationMs}ms`,
              '--md-shuffle-delay': `${flight.delayMs}ms`,
            } as CSSProperties;
            return (
              <div
                key={flight.cardIndex}
                className="absolute inset-0 md-deck-card--dealing rounded-xl"
                style={style}
              >
                <CardBackView aria-hidden size="md" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

DeckStackView.displayName = 'DeckStackView';
