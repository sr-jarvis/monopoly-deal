import React, { useState } from 'react';
import { GameOverPayload, PlayerClientView } from '@monopoly-deal/shared';
import { ReplayViewerModal } from './ReplayViewerModal';

interface WinModalProps {
  gameOver: GameOverPayload;
  selfId: string;
  opponents: PlayerClientView[];
  selfDisplayName: string;
  onRematch: () => void;
  onLeaveRoom: () => void;
}

export const WinModal: React.FC<WinModalProps> = ({
  gameOver,
  selfId,
  opponents,
  selfDisplayName,
  onRematch,
  onLeaveRoom
}) => {
  const [showReplay, setShowReplay] = useState(false);
  const isWinner = gameOver.winnerId === selfId;
  const winnerName = isWinner
    ? selfDisplayName
    : opponents.find((o) => o.id === gameOver.winnerId)?.displayName || 'Opponent';

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-800 border-2 border-slate-700 rounded-3xl p-8 max-w-lg w-full text-center shadow-2xl space-y-6 animate-in fade-in zoom-in duration-200">
        <div className="text-6xl animate-bounce">
          {isWinner ? '🏆' : '👑'}
        </div>

        <div>
          <h1
            className={`text-3xl font-black uppercase tracking-wider ${
              isWinner
                ? 'text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 drop-shadow'
                : 'text-slate-200'
            }`}
          >
            {isWinner ? 'Victory!' : 'Game Over'}
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            {isWinner
              ? 'Congratulations! You built 3 complete property sets!'
              : `${winnerName} has won the match with ${gameOver.sets || 3} complete sets!`}
          </p>
        </div>

        <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-700 space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400">Winner</span>
            <span className="font-bold text-amber-400">{winnerName}</span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-400">Completed Sets</span>
            <span className="font-bold text-emerald-400">{gameOver.sets || 3} Sets</span>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <button
            onClick={() => setShowReplay(true)}
            className="w-full py-2.5 bg-sky-950/80 hover:bg-sky-900 text-sky-300 font-bold rounded-xl transition uppercase tracking-wider text-xs border border-sky-600/60"
          >
            🎬 Match Replay & Telemetry
          </button>
          <button
            onClick={onRematch}
            className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-sky-600 hover:from-emerald-500 hover:to-sky-500 text-white font-extrabold rounded-xl transition shadow-xl shadow-emerald-950/50 uppercase tracking-wider text-sm"
          >
            Rematch / Return to Lobby
          </button>
          <button
            onClick={onLeaveRoom}
            className="w-full py-2.5 bg-slate-700/80 hover:bg-slate-600 text-slate-300 font-bold rounded-xl transition uppercase tracking-wider text-xs border border-slate-600/60"
          >
            Leave Room
          </button>
        </div>

        {showReplay && (
          <ReplayViewerModal
            isOpen={showReplay}
            onClose={() => setShowReplay(false)}
          />
        )}
      </div>
    </div>
  );
};
