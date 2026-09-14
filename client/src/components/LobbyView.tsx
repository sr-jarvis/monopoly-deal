import React, { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { socketService } from '../net/socket';
import { LeaderboardModal } from './LeaderboardModal';
import { ReplayViewerModal } from './ReplayViewerModal';
import { MusicPlayerControls } from './MusicPlayerControls';
import { CardFlightOverlay } from './CardFlightOverlay';
import { CardDealFlightOverlay } from './CardDealFlightOverlay';
import { CardShuffleFlightOverlay } from './CardShuffleFlightOverlay';
import { cardFlightEngine } from '../utils/cardFlightEngine';
import { scheduleInitialDealCascade, emitDealStart } from '../utils/cardDealFlightEngine';
import { triggerShuffle } from '../utils/shuffleEngine';
import { BOT_DIFFICULTIES } from '@monopoly-deal/shared';

export const LobbyView: React.FC = () => {
  const { displayName, setDisplayName, roomState, connected } = useGameStore();
  const [inputCode, setInputCode] = useState('');
  const [nameInput, setNameInput] = useState(displayName);
  const [botDifficulty, setBotDifficulty] = useState<string>('MEDIUM');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showReplay, setShowReplay] = useState(false);

  useEffect(() => {
    // Read room code from URL query parameter or hash if present
    const urlParams = new URLSearchParams(window.location.search);
    const codeParam = urlParams.get('room') || window.location.hash.replace('#/room/', '');
    if (codeParam && codeParam.length === 4) {
      setInputCode(codeParam.toUpperCase());
    }
  }, []);

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    setDisplayName(nameInput.trim());
    socketService.emit('room:create', { displayName: nameInput.trim() });
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim() || !inputCode.trim()) return;
    setDisplayName(nameInput.trim());
    socketService.emit('room:join', {
      roomCode: inputCode.trim().toUpperCase(),
      displayName: nameInput.trim()
    });
  };

  const handleStartGame = () => {
    triggerShuffle('game-setup');
    const seats = roomState?.seats || [];
    const seatIds = seats.map((s) => s.playerId);
    if (seatIds.length > 0) {
      const plan = scheduleInitialDealCascade({
        seatIds,
        humanSeatId: socketService.getSocket()?.id || seatIds[0],
      });
      if (plan.flights.length > 0) {
        emitDealStart(plan);
      }
    } else {
      cardFlightEngine.launchDealSequence(5, 2);
    }
    socketService.emit('room:start', {});
  };

  const handleAddBot = () => {
    socketService.emit('room:add-bot', { difficulty: botDifficulty });
  };

  const isHost = !!roomState && roomState.hostPlayerId === socketService.getSocket().id;
  const hasBot = !!roomState?.seats.some((seat) => seat.isBot);
  const isFull = !!roomState && roomState.seats.length >= 5;
  const canAddBot = isHost && roomState?.status === 'LOBBY' && !isFull && !hasBot;

  return (
    <div className="max-w-lg mx-auto mt-12 p-6 bg-slate-800/80 backdrop-blur-md rounded-2xl border border-slate-700 shadow-2xl">
      <div className="text-center mb-8">
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-3xl">🏠</span>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-sky-400 via-emerald-400 to-amber-300">
            Monopoly Deal
          </h1>
        </div>
        <p className="text-xs text-slate-400 font-medium">Server-Authoritative PWA Experience</p>

        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 bg-slate-900/60 rounded-full border border-slate-700 text-xs">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`} />
          <span className="text-slate-300 font-medium">
            {connected ? 'Connected to Server' : 'Connecting to Server...'}
          </span>
        </div>

        <div className="mt-3 flex justify-center gap-2 flex-wrap">
          <button
            onClick={() => setShowLeaderboard(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-950/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber-300 transition hover:bg-amber-900/60"
          >
            🏆 Leaderboard
          </button>
          <button
            onClick={() => setShowReplay(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-950/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-sky-300 transition hover:bg-sky-900/60"
          >
            🎬 Match Replay
          </button>
        </div>

        {/* WebAudio Ambient Music Player Bar */}
        <div className="mt-3 flex justify-center">
          <MusicPlayerControls />
        </div>
      </div>

      {!roomState ? (
        <div className="space-y-6">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Player Display Name
            </label>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Enter your name..."
              className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500 font-semibold"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <button
              onClick={handleCreateRoom}
              disabled={!connected || !nameInput.trim()}
              className="w-full py-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold rounded-lg transition shadow-lg shadow-sky-900/40 uppercase tracking-wider text-xs"
            >
              Create Room
            </button>

            <form onSubmit={handleJoinRoom} className="flex gap-2">
              <input
                type="text"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                placeholder="CODE"
                maxLength={4}
                className="w-24 px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 text-center font-mono font-bold uppercase focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="submit"
                disabled={!connected || !nameInput.trim() || inputCode.length !== 4}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-lg transition shadow-lg shadow-emerald-900/40 uppercase tracking-wider text-xs"
              >
                Join
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="p-4 bg-slate-900/90 rounded-xl border border-slate-700/80">
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Room Code</span>
              <span className="font-mono text-xl font-extrabold text-sky-400 bg-sky-950/60 px-3 py-1 rounded-md border border-sky-800">
                {roomState.roomCode}
              </span>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Players in Room ({roomState.seats.length}/5)
              </label>
              <div className="space-y-1.5">
                {roomState.seats.map((seat, idx) => (
                  <div
                    key={seat.playerId || seat.seatIndex}
                    className="flex justify-between items-center p-2.5 bg-slate-800 rounded-lg border border-slate-700 text-xs font-semibold text-slate-200"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 font-mono">#{idx + 1}</span>
                      <span>{seat.displayName}</span>
                      {seat.playerId === roomState.hostPlayerId && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded font-bold">
                          HOST
                        </span>
                      )}
                      {seat.isBot && (
                        <span className="text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/40 px-1.5 py-0.5 rounded font-bold">
                          BOT ({seat.difficulty || 'MEDIUM'})
                        </span>
                      )}
                    </div>
                    {seat.playerId === socketService.getSocket().id && (
                      <span className="text-slate-400 font-normal">( You )</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {isHost && (
            <div className="space-y-3 pt-2">
              {canAddBot && (
                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-700/80 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Bot Difficulty:</span>
                    <select
                      value={botDifficulty}
                      onChange={(e) => setBotDifficulty(e.target.value)}
                      className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 font-bold focus:outline-none focus:ring-2 focus:ring-sky-500"
                    >
                      {BOT_DIFFICULTIES.map((diff) => (
                        <option key={diff} value={diff}>
                          {diff}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={handleAddBot}
                    className="px-3.5 py-2 bg-slate-700 hover:bg-slate-600 text-sky-300 font-bold rounded-lg transition text-xs border border-sky-500/30 uppercase tracking-wider"
                  >
                    + Add Bot Seat
                  </button>
                </div>
              )}

              <button
                onClick={handleStartGame}
                disabled={roomState.seats.length < 2}
                className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold rounded-lg transition shadow-xl shadow-emerald-900/50 uppercase tracking-wider text-sm"
              >
                {roomState.seats.length < 2 ? 'Waiting for 2+ Players...' : 'Start Match Now 🚀'}
              </button>
            </div>
          )}
        </div>
      )}

      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}
      <ReplayViewerModal isOpen={showReplay} onClose={() => setShowReplay(false)} />
      <CardFlightOverlay />
      <CardDealFlightOverlay />
      <CardShuffleFlightOverlay />
    </div>
  );
};
