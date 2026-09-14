import React, { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import {
  FlightSpeed,
  RentPaymentPlan,
  RENT_PAYMENT_EVENTS,
  scheduleRentPaymentCascade,
  sampleFlightFrame,
  frameToTransform,
  WATCHDOG_GRACE_MS,
  createSfxScheduler,
} from '../utils/rentPaymentFlightEngine';

export interface RentPaymentFlightOverlayProps {
  speed?: FlightSpeed;
  onComplete?: (planId: string) => void;
}

const SPEED_OPTIONS: FlightSpeed[] = ['slow', 'normal', 'fast', 'turbo'];
const ROOT_ID = 'md-rentpayment-root';

function ensureRoot(): HTMLElement {
  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.pointerEvents = 'none';
    root.style.zIndex = '9000';
    root.style.perspective = '1000px';
    document.body.appendChild(root);
  }
  return root;
}

export const RentPaymentFlightOverlay: React.FC<RentPaymentFlightOverlayProps> = ({
  speed: defaultSpeed = 'normal',
  onComplete,
}) => {
  const [speed, setSpeed] = useState<FlightSpeed>(() => {
    try {
      const stored = localStorage.getItem('md:rentpayment:speed');
      if (stored && SPEED_OPTIONS.includes(stored as FlightSpeed)) {
        return stored as FlightSpeed;
      }
    } catch {
      /* ignore storage errors */
    }
    return defaultSpeed;
  });

  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('md:rentpayment:muted') === '1';
    } catch {
      return false;
    }
  });

  const [activePlan, setActivePlan] = useState<RentPaymentPlan | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');

  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const watchdogRef = useRef<NodeJS.Timeout | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const trailRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const sfxSchedulerRef = useRef(createSfxScheduler({ muted }));
  const dedupePlanIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    sfxSchedulerRef.current.setMuted(muted);
    try {
      localStorage.setItem('md:rentpayment:muted', muted ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [muted]);

  useEffect(() => {
    try {
      localStorage.setItem('md:rentpayment:speed', speed);
    } catch {
      /* ignore */
    }
  }, [speed]);

  // Handle incoming start & cancel events
  useEffect(() => {
    const handleStart = (evt: Event) => {
      const customEvt = evt as CustomEvent;
      const detail = customEvt.detail;
      if (!detail || !detail.chargerSeatId) return;

      const planId = detail.planId || `rentpay-${Date.now()}`;
      if (dedupePlanIds.current.has(planId)) return;
      dedupePlanIds.current.add(planId);

      // Clean up dedupe ids after 10s
      setTimeout(() => dedupePlanIds.current.delete(planId), 10000);

      // Reduced motion check
      const prefersReduced =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const plan = scheduleRentPaymentCascade({
        planId,
        chargerSeatId: detail.chargerSeatId,
        amountDue: detail.amountDue || 0,
        payments: detail.payments || [],
        speed,
      });

      if (prefersReduced) {
        setAnnouncement(`Rent payment of ${plan.amountDue}M completed.`);
        if (onComplete) onComplete(plan.planId);
        return;
      }

      setAnnouncement(`Seat ${plan.chargerSeatId} collecting rent payment of ${plan.amountDue}M.`);
      setActivePlan(plan);
      startTimeRef.current = performance.now();
      sfxSchedulerRef.current.run(plan);

      // Arm safety watchdog
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      watchdogRef.current = setTimeout(() => {
        finishPlan(plan.planId, 'watchdog');
      }, plan.totalDurationMs + WATCHDOG_GRACE_MS);
    };

    const handleCancel = (evt: Event) => {
      const customEvt = evt as CustomEvent;
      if (activePlan && customEvt.detail && customEvt.detail.planId === activePlan.planId) {
        finishPlan(activePlan.planId, 'cancelled');
      }
    };

    window.addEventListener(RENT_PAYMENT_EVENTS.start, handleStart);
    window.addEventListener(RENT_PAYMENT_EVENTS.cancel, handleCancel);

    return () => {
      window.removeEventListener(RENT_PAYMENT_EVENTS.start, handleStart);
      window.removeEventListener(RENT_PAYMENT_EVENTS.cancel, handleCancel);
    };
  }, [activePlan, speed, onComplete]);

  // Main RAF Loop for 3D card transforms
  useEffect(() => {
    if (!activePlan) return;

    const tick = (now: number) => {
      const elapsedMs = now - startTimeRef.current;
      sfxSchedulerRef.current.tick(elapsedMs, activePlan);

      let allComplete = true;

      activePlan.legs.forEach((leg) => {
        const frame = sampleFlightFrame(leg, elapsedMs);
        const cardEl = cardRefs.current.get(leg.legId);
        const trailEl = trailRefs.current.get(leg.legId);

        if (frame.active) {
          allComplete = false;
          if (cardEl) {
            cardEl.style.display = 'block';
            cardEl.style.transform = frameToTransform(frame);
            cardEl.style.opacity = frame.opacity.toString();
          }
          if (trailEl && speed !== 'turbo') {
            trailEl.style.display = 'block';
            trailEl.style.transform = `translate3d(${frame.x.toFixed(2)}px, ${frame.y.toFixed(2)}px, ${(
              frame.z * 0.5
            ).toFixed(2)}px) scale(${(frame.scale * 0.6).toFixed(3)})`;
            trailEl.style.opacity = (frame.opacity * 0.5).toString();
          }
        } else {
          if (cardEl) {
            cardEl.style.display = 'none';
          }
          if (trailEl) {
            trailEl.style.display = 'none';
          }
        }
      });

      if (elapsedMs < activePlan.totalDurationMs && !allComplete) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        finishPlan(activePlan.planId, 'finished');
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [activePlan]);

  const finishPlan = (planId: string, reason: string) => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    sfxSchedulerRef.current.cancel();

    // Dispatch completion custom event
    const completeEvt = new CustomEvent(RENT_PAYMENT_EVENTS.complete, {
      detail: { planId, reason },
      bubbles: true,
    });
    window.dispatchEvent(completeEvt);

    setActivePlan(null);
    if (onComplete) onComplete(planId);
  };

  if (typeof document === 'undefined') return null;
  const root = ensureRoot();

  return ReactDOM.createPortal(
    <div className="md-rentpayment-overlay-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Accessibility Announcement */}
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      {/* Active Flight Layers */}
      {activePlan && (
        <div className="md-payment-layer" style={{ transformStyle: 'preserve-3d', width: '100%', height: '100%' }}>
          {activePlan.legs.map((leg) => (
            <React.Fragment key={leg.legId}>
              {/* Flying Card Node */}
              <div
                ref={(el) => {
                  if (el) cardRefs.current.set(leg.legId, el);
                  else cardRefs.current.delete(leg.legId);
                }}
                className="md-payment-card"
                data-leg-id={leg.legId}
                style={{
                  position: 'fixed',
                  left: 0,
                  top: 0,
                  width: '64px',
                  height: '88px',
                  display: 'none',
                  willChange: 'transform, opacity',
                  backfaceVisibility: 'hidden',
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: '6px',
                    background:
                      leg.phase === 'charge'
                        ? 'linear-gradient(135deg, #ef4444, #b91c1c)'
                        : 'linear-gradient(135deg, #f59e0b, #d97706)',
                    border: '2px solid rgba(255,255,255,0.8)',
                    boxShadow: '0 8px 20px rgba(0,0,0,0.4), 0 0 15px rgba(245,158,11,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontWeight: 'bold',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                  }}
                >
                  {leg.phase === 'charge' ? '⚡ DEMAND' : leg.card?.name || leg.card?.label || `$${leg.card?.value || 1}M`}
                </div>
              </div>

              {/* Sparkle Particle Trail Node */}
              <div
                ref={(el) => {
                  if (el) trailRefs.current.set(leg.legId, el);
                  else trailRefs.current.delete(leg.legId);
                }}
                className="md-payment-trail"
                style={{
                  position: 'fixed',
                  left: 0,
                  top: 0,
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(251,191,36,0.9) 0%, rgba(245,158,11,0) 70%)',
                  filter: 'blur(2px)',
                  display: 'none',
                  pointerEvents: 'none',
                }}
              />
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Speed & Mute HUD Pill */}
      <div
        className="md-payment-hud"
        style={{
          position: 'fixed',
          bottom: '16px',
          right: '16px',
          pointerEvents: 'auto',
          zIndex: 9001,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(245, 158, 11, 0.4)',
          borderRadius: '20px',
          padding: '4px 12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
      >
        <span style={{ fontSize: '11px', color: '#fbbf24', fontWeight: 600, textTransform: 'uppercase' }}>
          3D Rent
        </span>
        <div role="radiogroup" aria-label="Flight Speed" style={{ display: 'flex', gap: '4px' }}>
          {SPEED_OPTIONS.map((sp) => (
            <button
              key={sp}
              type="button"
              role="radio"
              aria-checked={speed === sp}
              onClick={() => setSpeed(sp)}
              style={{
                background: speed === sp ? '#f59e0b' : 'transparent',
                color: speed === sp ? '#0f172a' : '#94a3b8',
                border: 'none',
                borderRadius: '12px',
                padding: '2px 8px',
                fontSize: '10px',
                fontWeight: 'bold',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {sp}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setMuted(!muted)}
          title={muted ? 'Unmute Audio' : 'Mute Audio'}
          style={{
            background: 'transparent',
            border: 'none',
            color: muted ? '#ef4444' : '#10b981',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '2px 4px',
          }}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </div>
    </div>,
    root
  );
};

export default RentPaymentFlightOverlay;
