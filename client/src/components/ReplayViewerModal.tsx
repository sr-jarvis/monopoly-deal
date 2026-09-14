import React, { useState, useEffect, useRef } from 'react';
import {
  ReplayEvent,
  ReplayAnalysis,
  ReplaySummary,
  fetchRoomReplay,
  fetchReplayAnalysis,
  summarizeReplay,
  formatReplayEventDescription
} from '../utils/replayViewer';

interface ReplayViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  roomCode?: string;
  initialEvents?: ReplayEvent[];
}

export const ReplayViewerModal: React.FC<ReplayViewerModalProps> = ({
  isOpen,
  onClose,
  roomCode: defaultRoomCode = '',
  initialEvents
}) => {
  const [roomInput, setRoomInput] = useState<string>(defaultRoomCode);
  const [activeRoomCode, setActiveRoomCode] = useState<string>(defaultRoomCode);
  const [events, setEvents] = useState<ReplayEvent[]>(initialEvents || []);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<'timeline' | 'blunders' | 'telemetry'>('timeline');
  const [analysis, setAnalysis] = useState<ReplayAnalysis | null>(null);
  const [summary, setSummary] = useState<ReplaySummary | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const autoPlayRef = useRef<NodeJS.Timeout | null>(null);

  // Load replay data on roomCode or modal open
  useEffect(() => {
    if (!isOpen) {
      setIsPlaying(false);
      return;
    }

    if (initialEvents && initialEvents.length > 0) {
      setEvents(initialEvents);
      setCurrentIndex(0);
      setSummary(summarizeReplay(activeRoomCode || 'LOCAL', initialEvents));
      return;
    }

    if (activeRoomCode && activeRoomCode.length === 4) {
      loadReplayData(activeRoomCode);
    }
  }, [isOpen, activeRoomCode, initialEvents]);

  const loadReplayData = async (code: string) => {
    setLoading(true);
    setError(null);
    try {
      const fetchedEvents = await fetchRoomReplay(code);
      if (fetchedEvents.length === 0) {
        setError(`No replay logs found for room code ${code}.`);
        setEvents([]);
      } else {
        setEvents(fetchedEvents);
        setCurrentIndex(0);
        const analysisData = await fetchReplayAnalysis(fetchedEvents);
        setAnalysis(analysisData);
        setSummary(summarizeReplay(code, fetchedEvents, analysisData));
      }
    } catch {
      setError('Failed to fetch replay data.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Auto-Play Timer
  useEffect(() => {
    if (isPlaying && events.length > 0) {
      const intervalMs = Math.max(250, 1000 / speed);
      autoPlayRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= events.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    } else {
      if (autoPlayRef.current) clearInterval(autoPlayRef.current);
    }

    return () => {
      if (autoPlayRef.current) clearInterval(autoPlayRef.current);
    };
  }, [isPlaying, events.length, speed]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        setCurrentIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentIndex((prev) => Math.min(events.length - 1, prev + 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, events.length, onClose]);

  if (!isOpen) return null;

  const currentEvent = events[currentIndex] || null;
  const currentBlunder = analysis?.blunders.find((b) => b.seq === currentEvent?.seq);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomInput.trim().length === 4) {
      setActiveRoomCode(roomInput.trim().toUpperCase());
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Match Replay Viewer"
    >
      <div className="bg-slate-800 border-2 border-slate-700 rounded-3xl p-6 max-w-2xl w-full shadow-2xl space-y-5 animate-in fade-in zoom-in duration-200 text-slate-100">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-700/80 pb-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎬</span>
            <h2 className="text-xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-emerald-400 to-amber-300">
              Match Replay & Telemetry
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition text-xl font-bold"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        {/* Room Code Search (if not fixed) */}
        {!initialEvents && (
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <input
              type="text"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              placeholder="Enter 4-letter Room Code..."
              className="flex-1 px-4 py-2 bg-slate-900 border border-slate-700 rounded-xl text-slate-100 uppercase tracking-widest text-sm font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
              maxLength={4}
            />
            <button
              type="submit"
              disabled={loading || roomInput.trim().length !== 4}
              className="px-5 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition"
            >
              {loading ? 'Loading...' : 'Fetch Replay'}
            </button>
          </form>
        )}

        {error && (
          <div className="p-3 bg-rose-950/80 border border-rose-700/60 rounded-xl text-rose-300 text-xs font-semibold">
            ⚠️ {error}
          </div>
        )}

        {events.length > 0 ? (
          <>
            {/* Active Event Step Highlight Card */}
            <div className="bg-slate-900/90 p-4 rounded-2xl border border-slate-700 shadow-inner space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-slate-400">
                <span className="bg-sky-950/80 text-sky-400 px-2.5 py-0.5 rounded-full border border-sky-800/60">
                  Step {currentIndex + 1} of {events.length}
                </span>
                {currentEvent?.turn !== undefined && (
                  <span className="bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full border border-slate-700">
                    Turn #{currentEvent.turn}
                  </span>
                )}
                <span className="text-slate-400">
                  {currentEvent?.displayName || currentEvent?.playerName || currentEvent?.playerId || 'Player'}
                </span>
              </div>

              <div className="text-sm font-semibold text-slate-200">
                {currentEvent ? formatReplayEventDescription(currentEvent) : 'Select a step.'}
              </div>

              {/* Blunder Warning Banner */}
              {currentBlunder && (
                <div className="p-3 bg-amber-950/80 border border-amber-600/70 rounded-xl text-amber-200 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-amber-400">
                    <span>⚠️ Tactical Blunder Flagged</span>
                    <span className="ml-auto px-1.5 py-0.2 bg-amber-900 border border-amber-500 rounded text-[10px]">
                      {currentBlunder.severity}
                    </span>
                  </div>
                  <p>{currentBlunder.description}</p>
                  {currentBlunder.suggestedAlternative && (
                    <p className="text-emerald-300 font-mono text-[11px] pt-1">
                      💡 Suggested: {currentBlunder.suggestedAlternative}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Timeline Player Scrubber Controls */}
            <div className="space-y-3 bg-slate-900/50 p-4 rounded-2xl border border-slate-700/60">
              <input
                type="range"
                min={0}
                max={events.length - 1}
                value={currentIndex}
                onChange={(e) => setCurrentIndex(Number(e.target.value))}
                className="w-full accent-sky-500 cursor-pointer"
              />

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setCurrentIndex(0)}
                    disabled={currentIndex === 0}
                    className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-bold transition"
                    title="Jump to Start"
                  >
                    ⏮
                  </button>
                  <button
                    onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                    disabled={currentIndex === 0}
                    className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-bold transition"
                    title="Step Backward"
                  >
                    ◀
                  </button>
                  <button
                    onClick={() => setIsPlaying((prev) => !prev)}
                    className="px-4 py-2 bg-gradient-to-r from-sky-600 to-emerald-600 hover:from-sky-500 hover:to-emerald-500 text-white font-black rounded-lg text-xs uppercase tracking-wider transition shadow"
                  >
                    {isPlaying ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button
                    onClick={() => setCurrentIndex((prev) => Math.min(events.length - 1, prev + 1))}
                    disabled={currentIndex === events.length - 1}
                    className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-bold transition"
                    title="Step Forward"
                  >
                    ▶
                  </button>
                  <button
                    onClick={() => setCurrentIndex(events.length - 1)}
                    disabled={currentIndex === events.length - 1}
                    className="p-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded-lg text-xs font-bold transition"
                    title="Jump to End"
                  >
                    ⏭
                  </button>
                </div>

                {/* Speed Multiplier Toggles */}
                <div className="flex items-center gap-1 bg-slate-800 p-1 rounded-lg border border-slate-700 text-xs font-bold">
                  {[1, 2, 4].map((s) => (
                    <button
                      key={s}
                      onClick={() => setSpeed(s)}
                      className={`px-2 py-0.5 rounded transition ${
                        speed === s
                          ? 'bg-sky-600 text-white shadow'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* View Tabs */}
            <div className="flex border-b border-slate-700 text-xs font-bold uppercase tracking-wider">
              <button
                onClick={() => setActiveTab('timeline')}
                className={`flex-1 py-2 text-center transition border-b-2 ${
                  activeTab === 'timeline'
                    ? 'border-sky-400 text-sky-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                📜 Step Log ({events.length})
              </button>
              <button
                onClick={() => setActiveTab('blunders')}
                className={`flex-1 py-2 text-center transition border-b-2 ${
                  activeTab === 'blunders'
                    ? 'border-amber-400 text-amber-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                ⚠️ Blunders ({analysis?.blunderCount || 0})
              </button>
              <button
                onClick={() => setActiveTab('telemetry')}
                className={`flex-1 py-2 text-center transition border-b-2 ${
                  activeTab === 'telemetry'
                    ? 'border-emerald-400 text-emerald-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                📊 Telemetry
              </button>
            </div>

            {/* Tab Contents */}
            <div className="max-h-52 overflow-y-auto pr-1 space-y-2">
              {activeTab === 'timeline' && (
                <div className="space-y-1.5">
                  {events.map((evt, idx) => (
                    <div
                      key={evt.seq || idx}
                      onClick={() => setCurrentIndex(idx)}
                      className={`p-2.5 rounded-xl border text-xs font-medium cursor-pointer transition flex items-center justify-between ${
                        idx === currentIndex
                          ? 'bg-sky-950/80 border-sky-500/80 text-sky-200'
                          : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-900'
                      }`}
                    >
                      <span className="font-bold text-slate-400 w-12">#{idx + 1}</span>
                      <span className="flex-1 truncate">{formatReplayEventDescription(evt)}</span>
                      {analysis?.blunders.some((b) => b.seq === evt.seq) && (
                        <span className="ml-2 px-1.5 py-0.5 bg-amber-900/80 border border-amber-600/70 text-amber-300 rounded text-[10px] font-bold">
                          ⚠️ BLUNDER
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {activeTab === 'blunders' && (
                <div className="space-y-2">
                  {!analysis || analysis.blunders.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-xs font-medium bg-slate-900/40 rounded-xl border border-slate-800">
                      🎉 Clean game! No tactical blunders detected by the bot analysis engine.
                    </div>
                  ) : (
                    analysis.blunders.map((blunder, bIdx) => (
                      <div
                        key={bIdx}
                        onClick={() => {
                          const targetIdx = events.findIndex((e) => e.seq === blunder.seq);
                          if (targetIdx >= 0) setCurrentIndex(targetIdx);
                        }}
                        className="p-3 bg-amber-950/60 border border-amber-700/60 rounded-xl text-xs space-y-1 cursor-pointer hover:bg-amber-950/90 transition"
                      >
                        <div className="flex items-center justify-between text-amber-300 font-bold">
                          <span>Step #{blunder.seq} — {blunder.ruleName}</span>
                          <span className="px-2 py-0.5 bg-amber-900 border border-amber-600 rounded text-[10px]">
                            {blunder.severity}
                          </span>
                        </div>
                        <p className="text-slate-300">{blunder.description}</p>
                        {blunder.suggestedAlternative && (
                          <p className="text-emerald-400 font-mono text-[11px] pt-1">
                            💡 {blunder.suggestedAlternative}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === 'telemetry' && summary && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-700">
                    <div className="text-[11px] text-slate-400 uppercase font-bold">Room Code</div>
                    <div className="text-lg font-black text-sky-400">{summary.roomCode || 'N/A'}</div>
                  </div>
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-700">
                    <div className="text-[11px] text-slate-400 uppercase font-bold">Total Turns</div>
                    <div className="text-lg font-black text-emerald-400">{summary.totalTurns}</div>
                  </div>
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-700">
                    <div className="text-[11px] text-slate-400 uppercase font-bold">Cards Played</div>
                    <div className="text-lg font-black text-amber-400">{summary.cardsPlayedCount}</div>
                  </div>
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-700">
                    <div className="text-[11px] text-slate-400 uppercase font-bold">Banked Money</div>
                    <div className="text-lg font-black text-emerald-300">${summary.moneyBankedTotal}M</div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          !loading && (
            <div className="p-8 text-center text-slate-400 text-xs font-medium bg-slate-900/40 rounded-2xl border border-slate-800">
              Enter a valid 4-letter room code above to inspect match replay logs and tactical telemetry.
            </div>
          )
        )}
      </div>
    </div>
  );
};
