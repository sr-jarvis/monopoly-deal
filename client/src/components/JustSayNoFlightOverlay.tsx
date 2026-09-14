import React, { useEffect, useState, useRef } from 'react';
import ReactDOM from 'react-dom';
import {
  CounterFlightPlan,
  CounterSpeed,
  COUNTER_SPEEDS,
  COUNTER_FLIGHT_EVENTS,
  buildLaunchFrame,
  buildDeflectFrame,
  emitPhase,
  cancelAllCounterFlights,
} from '../utils/justSayNoFlightEngine';
import { isMuted, toggleMute } from '../utils/soundEngine';

interface ActiveFlightState {
  plan: CounterFlightPlan;
  t0: number;
}

export const JustSayNoFlightOverlay: React.FC = () => {
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const [speed, setSpeed] = useState<CounterSpeed>('normal');
  const [muted, setMutedState] = useState<boolean>(() => isMuted());
  const [activeFlights, setActiveFlights] = useState<ActiveFlightState[]>([]);
  const [burstCoords, setBurstCoords] = useState<{ x: number; y: number; id: string }[]>([]);
  const [statusAnnouncement, setStatusAnnouncement] = useState<string>('');

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const deflectRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rafIdRef = useRef<number | null>(null);
  const flightsRef = useRef<ActiveFlightState[]>([]);
  flightsRef.current = activeFlights;

  // Lazily mount portal root on document.body
  useEffect(() => {
    let node = document.getElementById('md-counterflight-root');
    if (!node) {
      node = document.createElement('div');
      node.id = 'md-counterflight-root';
      node.style.position = 'fixed';
      node.style.inset = '0';
      node.style.pointerEvents = 'none';
      node.style.zIndex = '99999';
      document.body.appendChild(node);
    }
    setPortalNode(node);

    // Stored speed preference
    try {
      const storedSpeed = localStorage.getItem('md:counterflight:speed') as CounterSpeed;
      if (storedSpeed && COUNTER_SPEEDS[storedSpeed]) {
        setSpeed(storedSpeed);
      }
    } catch {
      /* ignore storage error */
    }

    return () => {
      cancelAllCounterFlights();
    };
  }, []);

  // Listen for counter flight events on window
  useEffect(() => {
    const handleStart = (e: Event) => {
      const customEvt = e as CustomEvent;
      const plan = customEvt.detail?.plan as CounterFlightPlan;
      if (!plan) return;

      const newFlight: ActiveFlightState = { plan, t0: performance.now() };

      setActiveFlights((prev) => {
        if (prev.some((f) => f.plan.id === plan.id)) return prev;
        return [...prev, newFlight];
      });

      const defender = plan.defenderSeat || 'Defender';
      const attacker = plan.attackerSeat || 'Attacker';
      const cardTitle = plan.attackerCard?.title || plan.attackerCard?.name || 'Action';
      setStatusAnnouncement(`${defender} blocked ${attacker}'s ${cardTitle} with Just Say No!`);
    };

    const handleIntercept = (e: Event) => {
      const customEvt = e as CustomEvent;
      const plan = customEvt.detail?.plan as CounterFlightPlan;
      if (!plan) return;

      setBurstCoords((prev) => [
        ...prev.filter((b) => b.id !== plan.id),
        { x: plan.coords.intercept.x, y: plan.coords.intercept.y, id: plan.id },
      ]);

      // Remove shockwave burst after 600ms
      setTimeout(() => {
        setBurstCoords((prev) => prev.filter((b) => b.id !== plan.id));
      }, 600);
    };

    const handleComplete = (e: Event) => {
      const customEvt = e as CustomEvent;
      const flightId = customEvt.detail?.flightId;
      if (!flightId) return;

      setActiveFlights((prev) => prev.filter((f) => f.plan.id !== flightId));
    };

    window.addEventListener(COUNTER_FLIGHT_EVENTS.start, handleStart);
    window.addEventListener(COUNTER_FLIGHT_EVENTS.intercept, handleIntercept);
    window.addEventListener(COUNTER_FLIGHT_EVENTS.complete, handleComplete);

    return () => {
      window.removeEventListener(COUNTER_FLIGHT_EVENTS.start, handleStart);
      window.removeEventListener(COUNTER_FLIGHT_EVENTS.intercept, handleIntercept);
      window.removeEventListener(COUNTER_FLIGHT_EVENTS.complete, handleComplete);
    };
  }, []);

  // RAF animation loop
  useEffect(() => {
    if (activeFlights.length === 0) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      return;
    }

    let lastTick = performance.now();

    const loop = (now: number) => {
      // Backgrounded tab clamp
      if (now - lastTick > 2000) {
        flightsRef.current.forEach((f) => {
          emitPhase(f.plan.id, 'neutralize');
          emitPhase(f.plan.id, 'complete');
        });
        setActiveFlights([]);
        return;
      }
      lastTick = now;

      flightsRef.current.forEach((flightState) => {
        const { plan, t0 } = flightState;
        const elapsed = now - t0;

        const launchPhase = plan.phases.find((p) => p.name === 'launch')!;
        const interceptPhase = plan.phases.find((p) => p.name === 'intercept')!;
        const deflectPhase = plan.phases.find((p) => p.name === 'deflect')!;
        const neutralizePhase = plan.phases.find((p) => p.name === 'neutralize')!;

        const counterEl = cardRefs.current[plan.id];
        const deflectEl = deflectRefs.current[plan.id];

        if (elapsed < launchPhase.endMs) {
          // Launch phase: shield flies to intercept
          const tPhase = elapsed / Math.max(1, launchPhase.endMs);
          const frame = buildLaunchFrame(plan, tPhase);
          if (counterEl) {
            counterEl.style.transform = `translate3d(${frame.x}px, ${frame.y}px, ${frame.z}px) rotateZ(${frame.rotateZ}deg) rotateY(${frame.rotateY}deg) scale(${frame.scale})`;
            counterEl.style.opacity = String(frame.opacity);
          }
        } else if (elapsed < interceptPhase.endMs) {
          // Intercept phase: collision pulse
          emitPhase(plan.id, 'intercept');
          if (counterEl) {
            counterEl.style.transform = `translate3d(${plan.coords.intercept.x}px, ${plan.coords.intercept.y}px, 60px) scale(1.15)`;
          }
        } else if (elapsed < deflectPhase.endMs) {
          // Deflect phase: attacker card ricochets into discard
          emitPhase(plan.id, 'intercept');
          const tPhase = (elapsed - deflectPhase.startMs) / Math.max(1, deflectPhase.endMs - deflectPhase.startMs);
          const frame = buildDeflectFrame(plan, tPhase);
          if (deflectEl) {
            deflectEl.style.transform = `translate3d(${frame.x}px, ${frame.y}px, ${frame.z}px) rotateZ(${frame.rotateZ}deg) rotateY(${frame.rotateY}deg) scale(${frame.scale})`;
            deflectEl.style.opacity = String(frame.opacity);
          }
        } else if (elapsed < neutralizePhase.endMs) {
          // Neutralize phase
          emitPhase(plan.id, 'neutralize');
        } else {
          // Complete
          emitPhase(plan.id, 'complete');
        }
      });

      rafIdRef.current = requestAnimationFrame(loop);
    };

    rafIdRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [activeFlights]);

  const handleSpeedChange = (newSpeed: CounterSpeed) => {
    setSpeed(newSpeed);
    try {
      localStorage.setItem('md:counterflight:speed', newSpeed);
    } catch {
      /* ignore private storage error */
    }
  };

  const handleMuteToggle = () => {
    const nextMuted = toggleMute();
    setMutedState(nextMuted);
  };

  if (!portalNode) return null;

  return ReactDOM.createPortal(
    <div className="md-counterflight-stage" style={{ position: 'relative', width: '100%', height: '100%', perspective: '1200px' }}>
      {/* Screen Reader Live Status Region */}
      <div role="status" aria-live="polite" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {statusAnnouncement}
      </div>

      {/* Floating Speed & Mute Control Pill */}
      {activeFlights.length > 0 && (
        <div
          data-testid="speed-control-pill"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            pointerEvents: 'auto',
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: 24,
            padding: '4px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            zIndex: 100000,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8', letterSpacing: '0.05em' }}>COUNTER SPEED</span>
          {(['slow', 'normal', 'fast', 'turbo'] as CounterSpeed[]).map((s) => (
            <button
              key={s}
              onClick={() => handleSpeedChange(s)}
              style={{
                background: speed === s ? '#0284c7' : 'transparent',
                color: speed === s ? '#ffffff' : '#94a3b8',
                border: 'none',
                borderRadius: 12,
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {s}
            </button>
          ))}
          <button
            onClick={handleMuteToggle}
            style={{
              background: 'transparent',
              color: muted ? '#f43f5e' : '#38bdf8',
              border: 'none',
              fontSize: 12,
              cursor: 'pointer',
              marginLeft: 4,
            }}
            title={muted ? 'Unmute FX' : 'Mute FX'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      )}

      {/* Counter Shield Collision Shockwave Bursts */}
      {burstCoords.map((b) => (
        <div
          key={`burst_${b.id}`}
          className="md-shield-burst"
          style={{
            position: 'absolute',
            left: b.x,
            top: b.y,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            zIndex: 99998,
          }}
        >
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              border: '3px solid #38bdf8',
              boxShadow: '0 0 30px #0284c7, inset 0 0 20px #38bdf8',
              animation: 'mdShieldPulse 0.5s ease-out forwards',
            }}
          />
        </div>
      ))}

      {/* Flying Counter Ghost Cards & Deflected Attacker Cards */}
      {activeFlights.map(({ plan }) => (
        <React.Fragment key={plan.id}>
          {/* Defender's Flying Just Say No Shield Card */}
          <div
            ref={(el) => {
              cardRefs.current[plan.id] = el;
            }}
            aria-hidden="true"
            aria-label="Just Say No Counter Card"
            className="md-counter-ghost"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 90,
              height: 130,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
              border: '2px solid #38bdf8',
              boxShadow: '0 8px 24px rgba(56, 189, 248, 0.4)',
              transformStyle: 'preserve-3d',
              backfaceVisibility: 'hidden',
              willChange: 'transform',
              pointerEvents: 'none',
              zIndex: 99999,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              padding: 6,
            }}
          >
            <div style={{ fontSize: 20 }}>🛡️</div>
            <div style={{ fontSize: 10, fontWeight: 800, textAlign: 'center', color: '#38bdf8', marginTop: 4 }}>JUST SAY NO</div>
            <div style={{ fontSize: 8, color: '#94a3b8', textAlign: 'center', marginTop: 2 }}>CANCEL ACTION</div>
          </div>

          {/* Attacker's Deflected Action Card */}
          <div
            ref={(el) => {
              deflectRefs.current[plan.id] = el;
            }}
            aria-hidden="true"
            className="md-deflect-ghost"
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 90,
              height: 130,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #334155 0%, #0f172a 100%)',
              border: '2px solid #f43f5e',
              boxShadow: '0 8px 24px rgba(244, 63, 94, 0.4)',
              transformStyle: 'preserve-3d',
              backfaceVisibility: 'hidden',
              willChange: 'transform',
              pointerEvents: 'none',
              zIndex: 99997,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              padding: 6,
            }}
          >
            <div style={{ fontSize: 18 }}>🚫</div>
            <div style={{ fontSize: 9, fontWeight: 700, textAlign: 'center', color: '#f43f5e', marginTop: 4 }}>
              {plan.attackerCard?.title || plan.attackerCard?.name || 'ACTION'}
            </div>
            <div style={{ fontSize: 8, color: '#fda4af', textAlign: 'center', marginTop: 2 }}>BLOCKED</div>
          </div>
        </React.Fragment>
      ))}

      {/* Keyframe Animations */}
      <style>{`
        @keyframes mdShieldPulse {
          0% { transform: scale(0.2); opacity: 1; }
          70% { transform: scale(1.8); opacity: 0.8; }
          100% { transform: scale(2.4); opacity: 0; }
        }
      `}</style>
    </div>,
    portalNode
  );
};
