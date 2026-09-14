import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/useGameStore';
import { GameEventPayload } from '@monopoly-deal/shared';

export const ActionToastBanner: React.FC = () => {
  const events = useGameStore((state) => state.events);
  const [activeEvent, setActiveEvent] = useState<GameEventPayload | null>(null);
  const lastSeenSeq = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!events || events.length === 0) return;
    const latest = events[0];
    if (!latest) return;

    // Initialize lastSeenSeq on first mount without triggering initial historical toast
    if (lastSeenSeq.current === null) {
      lastSeenSeq.current = latest.seq;
      return;
    }

    // Only show toast when a genuinely newer event sequence arrives
    if (latest.seq > lastSeenSeq.current) {
      lastSeenSeq.current = latest.seq;
      setActiveEvent(latest);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        setActiveEvent(null);
      }, 3500);
    }
  }, [events]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!activeEvent) return null;

  const getEventBadge = (summary: string, action: string) => {
    const text = (summary + ' ' + action).toLowerCase();

    if (text.includes('rematch') || text.includes('lobby')) {
      return {
        icon: '🔄',
        label: 'REMATCH',
        style: 'border-sky-500/60 bg-sky-950/90 text-sky-200 shadow-sky-950/50',
        badgeBg: 'bg-sky-900/80 text-sky-300 border-sky-700/60'
      };
    }
    if (
      text.includes('debt collector') ||
      text.includes('pass go') ||
      text.includes('birthday') ||
      text.includes('sly deal') ||
      text.includes('forced deal') ||
      text.includes('deal breaker') ||
      text.includes('just say no') ||
      text.includes('action card') ||
      text.includes('play_action_card')
    ) {
      return {
        icon: '⚡',
        label: 'ACTION CARD',
        style: 'border-amber-500/60 bg-amber-950/90 text-amber-100 shadow-amber-950/50',
        badgeBg: 'bg-amber-900/80 text-amber-300 border-amber-700/60'
      };
    }
    if (
      text.includes('rent') ||
      text.includes('paid') ||
      text.includes('pay') ||
      text.includes('payment') ||
      text.includes('double the rent')
    ) {
      return {
        icon: '💰',
        label: 'RENT / PAYMENT',
        style: 'border-emerald-500/60 bg-emerald-950/90 text-emerald-100 shadow-emerald-950/50',
        badgeBg: 'bg-emerald-900/80 text-emerald-300 border-emerald-700/60'
      };
    }
    if (text.includes('house') || text.includes('hotel') || text.includes('building')) {
      return {
        icon: '🏠',
        label: 'BUILDING',
        style: 'border-purple-500/60 bg-purple-950/90 text-purple-100 shadow-purple-950/50',
        badgeBg: 'bg-purple-900/80 text-purple-300 border-purple-700/60'
      };
    }
    if (
      text.includes('rearrange') ||
      text.includes('property') ||
      text.includes('stole') ||
      text.includes('wildcard')
    ) {
      return {
        icon: '🃏',
        label: 'PROPERTY ACTION',
        style: 'border-cyan-500/60 bg-cyan-950/90 text-cyan-100 shadow-cyan-950/50',
        badgeBg: 'bg-cyan-900/80 text-cyan-300 border-cyan-700/60'
      };
    }

    return {
      icon: '📜',
      label: 'GAME EVENT',
      style: 'border-slate-600/60 bg-slate-900/90 text-slate-200 shadow-slate-950/50',
      badgeBg: 'bg-slate-800 text-slate-300 border-slate-700'
    };
  };

  const badge = getEventBadge(activeEvent.summary, activeEvent.action || '');

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-20 left-1/2 -translate-x-1/2 z-30 w-[92%] sm:w-auto max-w-lg pointer-events-auto"
    >
      <div
        className={`flex items-center gap-3 p-3.5 rounded-2xl border backdrop-blur-md shadow-2xl transition-all duration-200 animate-in slide-in-from-top-2 ${badge.style}`}
      >
        <div className="text-xl shrink-0 leading-none">{badge.icon}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className={`text-[9px] font-mono font-extrabold px-1.5 py-0.5 rounded border uppercase tracking-widest ${badge.badgeBg}`}
            >
              {badge.label}
            </span>
            <span className="text-[10px] font-mono text-slate-400">#{activeEvent.seq}</span>
          </div>
          <p className="text-xs sm:text-sm font-bold leading-snug tracking-wide text-slate-100 truncate sm:whitespace-normal">
            {activeEvent.summary}
          </p>
        </div>

        <button
          onClick={() => setActiveEvent(null)}
          className="text-slate-400 hover:text-white text-xs font-bold p-1 rounded-lg bg-slate-800/60 hover:bg-slate-700/80 transition shrink-0"
          aria-label="Dismiss toast"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
