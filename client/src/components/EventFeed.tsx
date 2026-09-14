import React, { useState } from 'react';
import { GameEventPayload } from '@monopoly-deal/shared';

interface EventFeedProps {
  events: GameEventPayload[];
}

export const EventFeed: React.FC<EventFeedProps> = ({ events }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-4 left-4 z-40">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3 py-2 rounded-xl text-xs font-bold shadow-xl flex items-center gap-2 backdrop-blur-md"
        >
          <span>📜</span> Game Log ({events.length})
        </button>
      ) : (
        <div className="bg-slate-800/95 border border-slate-700 rounded-2xl p-4 w-80 shadow-2xl space-y-3 max-h-96 flex flex-col backdrop-blur-md animate-in slide-in-from-bottom-2 duration-150">
          <div className="flex justify-between items-center border-b border-slate-700 pb-2 shrink-0">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <span>📜</span> Game Action Feed
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white text-xs font-bold px-1.5 py-0.5 rounded bg-slate-700/50"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs">
            {events.length === 0 ? (
              <p className="text-slate-500 italic text-center py-4">No events logged yet</p>
            ) : (
              events.map((evt, idx) => (
                <div
                  key={evt.seq || idx}
                  className="p-2 bg-slate-900/80 rounded-lg border border-slate-700/60 text-slate-300 space-y-0.5"
                >
                  <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                    <span className="text-sky-400">#{evt.seq}</span>
                    <span>{new Date(evt.ts).toLocaleTimeString()}</span>
                  </div>
                  <p className="font-medium text-slate-200 leading-snug">{evt.summary}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
