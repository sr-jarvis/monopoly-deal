import { create } from 'zustand';
import { GameClientState, RoomState, GameEventPayload, GameOverPayload } from '@monopoly-deal/shared';

interface Toast {
  id: string;
  type: 'error' | 'info' | 'success';
  message: string;
}

interface GameStoreState {
  // Connection & Session
  connected: boolean;
  displayName: string;
  sessionToken: string | null;
  roomCode: string | null;

  // Lobby & Match State
  roomState: RoomState | null;
  gameState: GameClientState | null;
  gameOver: GameOverPayload | null;
  events: GameEventPayload[];

  // Feedback Toasts
  toasts: Toast[];

  // Actions
  setConnected: (connected: boolean) => void;
  setDisplayName: (name: string) => void;
  setSessionToken: (token: string | null) => void;
  setRoomCode: (code: string | null) => void;
  setRoomState: (state: RoomState | null) => void;
  setGameState: (state: GameClientState | null) => void;
  setGameOver: (over: GameOverPayload | null) => void;
  addEvent: (event: GameEventPayload) => void;
  addToast: (message: string, type?: 'error' | 'info' | 'success') => void;
  removeToast: (id: string) => void;
  resetMatch: () => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  connected: false,
  displayName: localStorage.getItem('md_display_name') || '',
  sessionToken: localStorage.getItem('md_session_token') || null,
  roomCode: null,
  roomState: null,
  gameState: null,
  gameOver: null,
  events: [],
  toasts: [],

  setConnected: (connected) => set({ connected }),
  setDisplayName: (displayName) => {
    localStorage.setItem('md_display_name', displayName);
    set({ displayName });
  },
  setSessionToken: (sessionToken) => {
    if (sessionToken) localStorage.setItem('md_session_token', sessionToken);
    else localStorage.removeItem('md_session_token');
    set({ sessionToken });
  },
  setRoomCode: (roomCode) => set({ roomCode }),
  setRoomState: (roomState) =>
    set({
      roomState,
      ...(roomState?.status === 'LOBBY' ? { gameState: null, gameOver: null } : {})
    }),
  setGameState: (gameState) =>
    set({
      gameState,
      ...(gameState === null ? { gameOver: null } : {})
    }),
  setGameOver: (gameOver) => set({ gameOver }),
  addEvent: (event) => set((state) => ({ events: [event, ...state.events].slice(0, 50) })),
  addToast: (message, type = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({ toasts: [...state.toasts, { id, type, message }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  resetMatch: () =>
    set({
      gameState: null,
      roomState: null,
      gameOver: null,
      events: []
    })
}));
