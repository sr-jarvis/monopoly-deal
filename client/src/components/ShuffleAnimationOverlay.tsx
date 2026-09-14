import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  STACK_SIZE,
  cardTransform,
  nextSpeed,
  resolvePhaseDuration,
  shuffleEngine,
  soundEngine,
  type ShufflePhase,
  type ShuffleReason,
  type ShuffleSnapshot,
  type ShuffleSpeed,
} from '../utils/shuffleEngine';

const PHASE_LABEL: Record<ShufflePhase, string> = {
  riffle: 'Riffling',
  fan: 'Fanning',
  cut: 'Cutting',
  dealing: 'Dealing',
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

/** `matchMedia` is absent under SSR and in some test environments. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface ShuffleAnimationOverlayProps {
  /** Force the overlay open regardless of engine state (settings preview). */
  open?: boolean;
  /** Hide the manual re-shuffle button on read-only boards. */
  allowManualTrigger?: boolean;
  /** Fired after the overlay closes, whether by finishing or by dismissal. */
  onClose?: () => void;
}

/**
 * Full-screen 3D shuffle overlay. Mounts once (in `GameBoardView`) and shows
 * itself whenever `shuffleEngine` leaves the `idle` state — no parent has to
 * own visibility state.
 */
export function ShuffleAnimationOverlay({
  open = false,
  allowManualTrigger = true,
  onClose,
}: ShuffleAnimationOverlayProps) {
  const [snapshot, setSnapshot] = useState<ShuffleSnapshot>(() => shuffleEngine.getSnapshot());
  const [muted, setMuted] = useState(() => soundEngine.isMuted());
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  useEffect(() => shuffleEngine.subscribe(setSnapshot), []);

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
    shuffleEngine.cancel();
    onClose?.();
  }, [onClose]);

  // Escape always exits — the overlay is decorative and must never trap a player.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, handleDismiss]);

  const handleSpeed = useCallback(() => {
    shuffleEngine.setSpeed(nextSpeed(shuffleEngine.getSpeed()));
  }, []);

  const handleMute = useCallback(() => {
    setMuted(soundEngine.toggleMuted());
  }, []);

  const handleShuffleAgain = useCallback(() => {
    soundEngine.resume();
    shuffleEngine.start({ reason: 'manual' });
  }, []);

  const phaseDurationMs = phase ? resolvePhaseDuration(phase, speed) : 0;

  /**
   * Per-card peak transforms. The CSS keyframes read these custom properties,
   * so the geometry lives in one tested pure function instead of in the
   * stylesheet.
   */
  const cards = useMemo(() => {
    if (!phase) return [];
    return Array.from({ length: STACK_SIZE }, (_, index) => {
      const peak = cardTransform(phase, index, STACK_SIZE, 1);
      const style: CSSProperties = {
        '--md-shuffle-index': index,
        '--md-shuffle-x': `${peak.x.toFixed(2)}px`,
        '--md-shuffle-y': `${peak.y.toFixed(2)}px`,
        '--md-shuffle-z': `${peak.z.toFixed(2)}px`,
        '--md-shuffle-rot': `${peak.rotate.toFixed(2)}deg`,
        '--md-shuffle-tilt': `${peak.tilt.toFixed(2)}deg`,
        '--md-shuffle-opacity': peak.opacity.toFixed(3),
        '--md-shuffle-duration': `${phaseDurationMs}ms`,
        '--md-shuffle-delay': `${Math.round((index / STACK_SIZE) * phaseDurationMs * 0.25)}ms`,
        zIndex: index,
      } as CSSProperties;
      return { index, style };
    });
  }, [phase, phaseDurationMs]);

  if (!visible) return null;

  const heading = reason ? REASON_LABEL[reason] : 'Shuffling the deck';

  return (
    <div
      className="md-shuffle-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      <div className="md-shuffle-backdrop" onClick={handleDismiss} aria-hidden="true" />

      <div className="md-shuffle-panel">
        <header className="md-shuffle-header">
          <p className="md-shuffle-heading">{heading}</p>
          <p className="md-shuffle-phase" aria-live="polite">
            {phase ? PHASE_LABEL[phase] : 'Ready'}
          </p>
        </header>

        <div className="md-shuffle-stage" data-phase={phase ?? 'idle'}>
          <div className="md-shuffle-stack">
            {cards.map((card) => (
              <div key={card.index} className="md-shuffle-card" style={card.style}>
                <span className="md-shuffle-card-face" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>

        <div
          className="md-shuffle-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(snapshot.progress * 100)}
        >
          <span
            className="md-shuffle-progress-bar"
            style={{ width: `${Math.round(snapshot.progress * 100)}%` }}
          />
        </div>

        <footer className="md-shuffle-controls">
          <button
            type="button"
            className="md-shuffle-btn"
            onClick={handleSpeed}
            aria-label={`Animation speed: ${SPEED_LABEL[speed]}. Click to change.`}
          >
            <span aria-hidden="true">⏩</span> {SPEED_LABEL[speed]}
          </button>

          <button
            type="button"
            className="md-shuffle-btn"
            onClick={handleMute}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute shuffle sounds' : 'Mute shuffle sounds'}
          >
            <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
          </button>

          {allowManualTrigger && (
            <button type="button" className="md-shuffle-btn" onClick={handleShuffleAgain}>
              <span aria-hidden="true">🔀</span> Shuffle again
            </button>
          )}

          <button
            type="button"
            className="md-shuffle-btn md-shuffle-btn--ghost"
            onClick={handleDismiss}
          >
            Skip
          </button>
        </footer>
      </div>
    </div>
  );
}

export default ShuffleAnimationOverlay;
