import { useEffect, useRef } from 'react';
import { useGameStore } from './store/useGameStore';
import { socketService } from './net/socket';
import { LobbyView } from './components/LobbyView';
import { GameBoardView } from './components/GameBoardView';
import { RoomState, GameClientState, GameEventPayload, GameOverPayload } from '@monopoly-deal/shared';
import * as sfx from './utils/soundEngine';

export function App() {
  const {
    setConnected,
    gameState,
    setGameState,
    setRoomState,
    setGameOver,
    addEvent,
    addToast,
    toasts
  } = useGameStore();

  const prevTurnPlayerIdRef = useRef<string | null>(null);

  useEffect(() => {
    sfx.unlockAudio();

    const socket = socketService.connect();

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('room:state', (data: RoomState) => {
      setRoomState(data);
    });

    socket.on('game:state', (data: GameClientState) => {
      setGameState(data);
    });

    socket.on('game:event', (data: GameEventPayload) => {
      addEvent(data);
      addToast(data.summary, 'info');
      sfx.triggerEventSound(data.summary);
    });

    socket.on('game:over', (data: GameOverPayload) => {
      setGameOver(data);
      addToast(`Match Finished! Winner declared.`, 'success');
      sfx.playWin();
    });

    socket.on('game:action-rejected', (data: { reason: string }) => {
      addToast(`Action Rejected: ${data.reason}`, 'error');
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('room:state');
      socket.off('game:state');
      socket.off('game:event');
      socket.off('game:over');
      socket.off('game:action-rejected');
    };
  }, []);

  // Play turn start chime when current turn changes to self
  useEffect(() => {
    if (!gameState) {
      prevTurnPlayerIdRef.current = null;
      return;
    }

    const currentTurn = gameState.currentTurnPlayerId;
    if (prevTurnPlayerIdRef.current !== currentTurn) {
      if (currentTurn === gameState.self.id) {
        sfx.playTurnStart();
      }
      prevTurnPlayerIdRef.current = currentTurn;
    }
  }, [gameState?.currentTurnPlayerId, gameState?.self.id]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 relative selection:bg-sky-500 selection:text-white">
      {/* Toast Overlay */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`p-3 rounded-xl border shadow-2xl text-xs font-semibold backdrop-blur-md pointer-events-auto transition-all ${
              toast.type === 'error'
                ? 'bg-rose-950/90 border-rose-600 text-rose-100'
                : toast.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-600 text-emerald-100'
                : 'bg-slate-800/90 border-slate-700 text-slate-200'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {/* Main View Router */}
      {!gameState ? <LobbyView /> : <GameBoardView />}
    </div>
  );
}

export default App;
