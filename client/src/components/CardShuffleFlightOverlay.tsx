import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  STACK_SIZE,
  cardShuffleFlightEngine,
  cardTransform3D,
  nextSpeed,
  type ShufflePhase,
  type ShuffleReason,
  type ShuffleSnapshot,
  type ShuffleSpeed,
} from '../utils/cardShuffleFlightEngine';
import { isMuted, toggleMute, unlockAudio } from '../utils/soundEngine';

const PHASE_LABEL: Record<ShufflePhase, string> = {
  riffle: 'Riffling 3D Stack',
  fan: 'Fanning 3D Arc',
  cut: 'Cutting Deck',
  dealing: 'Dealing Seats',
};

const SPEED_LABEL: Record<ShuffleSpeed, string> = {
  slow: '0.5×',
  normal: '1×',
  fast: '2×',
  turbo: '3×',
};

const REASON_LABEL: Record<ShuffleReason, string> = {
  'game-setup': 'Shuffling for a new game',
  rematch: 'Shuffling for the rematch',
  manual: 'Shuffling the deck',
  draw: 'Dealing cards',
  'deck-recycle': 'Reshuffling the discard pile',
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface CardShuffleFlightOverlayProps {
  open?: boolean;
  allowManualTrigger?: boolean;
  onClose?: () => void;
  className?: string;
}

export const CardShuffleFlightOverlay: React.FC<CardShuffleFlightOverlayProps> = ({
  open = false,
  allowManualTrigger = true,
  onClose,
  className = '',
}) => {
  const [snapshot, setSnapshot] = useState<ShuffleSnapshot>(() =>
    cardShuffleFlightEngine.getSnapshot()
  );
  const [muted, setMuted] = useState(() => isMuted());
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  useEffect(() => cardShuffleFlightEngine.subscribe(setSnapshot), []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  const { phase, speed, reason } = snapshot;
  const visible = open || phase !== null;

  const handleDismiss = useCallback(() => {
    cardShuffleFlightEngine.cancel();
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, handleDismiss]);

  const handleSpeed = useCallback(() => {
    cardShuffleFlightEngine.setSpeed(nextSpeed(cardShuffleFlightEngine.getSpeed()));
  }, []);

  const handleMute = useCallback(() => {
    setMuted(toggleMute());
  }, []);

  const handleShuffleAgain = useCallback(() => {
    unlockAudio();
    cardShuffleFlightEngine.start({ reason: 'manual' });
  }, []);

  const cards = useMemo(() => {
    if (!phase) return [];
    return Array.from({ length: STACK_SIZE }, (_, index) => {
      const transform = cardTransform3D(phase, index, STACK_SIZE, snapshot.progress);
      const style: CSSProperties = {
        transform: `translate3d(${transform.x.toFixed(2)}px, ${transform.y.toFixed(2)}px, ${transform.z.toFixed(2)}px) rotateZ(${transform.rotateZ.toFixed(2)}deg) rotateY(${transform.rotateY.toFixed(2)}deg) scale(${transform.scale.toFixed(3)})`,
        opacity: transform.opacity,
        zIndex: index,
        transition: reducedMotion ? 'none' : 'transform 60ms linear, opacity 60ms linear',
      };
      return { index, style };
    });
  }, [phase, snapshot.progress, reducedMotion]);

  if (!visible) return null;

  const heading = reason ? REASON_LABEL[reason] : 'Shuffling 3D Deck';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md select-none ${className}`}
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-card-shuffle-overlay="true"
    >
      <div className="absolute inset-0" onClick={handleDismiss} aria-hidden="true" />

      <div className="relative z-10 w-full max-w-md bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-6 flex flex-col items-center gap-5">
        <header className="text-center">
          <h3 className="text-lg font-bold text-amber-200 tracking-wide">{heading}</h3>
          <p className="text-xs font-mono text-amber-400/80 mt-1 uppercase tracking-wider" aria-live="polite">
            {phase ? PHASE_LABEL[phase] : 'Ready'}
          </p>
        </header>

        {/* 3D Card Animation Stage */}
        <div
          className="relative w-48 h-56 flex items-center justify-center my-2"
          style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
          data-phase={phase ?? 'idle'}
        >
          <div className="relative w-28 h-40" style={{ transformStyle: 'preserve-3d' }}>
            {cards.map((card) => (
              <div
                key={card.index}
                className="absolute inset-0 bg-gradient-to-br from-amber-600 to-amber-900 border-2 border-amber-300/80 rounded-xl shadow-xl flex items-center justify-center"
                style={card.style}
              >
                <div className="w-20 h-32 border border-amber-400/40 rounded-lg bg-amber-950/40 flex items-center justify-center">
                  <span className="text-2xl font-bold text-amber-200/60">🎩</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Progress Bar */}
        <div
          className="w-full bg-slate-800 h-2 rounded-full overflow-hidden border border-slate-700"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(snapshot.progress * 100)}
        >
          <div
            className="bg-amber-400 h-full transition-all duration-100 ease-out"
            style={{ width: `${Math.round(snapshot.progress * 100)}%` }}
          />
        </div>

        {/* Control Toolbar */}
        <footer className="flex items-center justify-center gap-2 w-full pt-2">
          <button
            type="button"
            onClick={handleSpeed}
            aria-label={`Animation speed: ${SPEED_LABEL[speed]}. Click to change.`}
            className="px-3 py-1.5 text-xs font-mono font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg transition active:scale-95"
          >
            ⏩ {SPEED_LABEL[speed]}
          </button>

          <button
            type="button"
            onClick={handleMute}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute shuffle sounds' : 'Mute shuffle sounds'}
            className="px-3 py-1.5 text-xs font-mono font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-lg transition active:scale-95"
          >
            {muted ? '🔇' : '🔊'}
          </button>

          {allowManualTrigger && (
            <button
              type="button"
              onClick={handleShuffleAgain}
              className="px-3 py-1.5 text-xs font-mono font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-lg transition active:scale-95"
            >
              🔀 Reshuffle
            </button>
          )}

          <button
            type="button"
            onClick={handleDismiss}
            className="px-3 py-1.5 text-xs font-mono text-slate-400 hover:text-slate-200 bg-transparent hover:bg-slate-800 border border-transparent hover:border-slate-700 rounded-lg transition"
          >
            Skip
          </button>
        </footer>
      </div>
    </div>
  );
};
