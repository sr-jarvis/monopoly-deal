import { io, Socket } from 'socket.io-client';

class SocketService {
  private socket: Socket | null = null;

  connect() {
    if (this.socket) return this.socket;

    // Same-origin connection (proxied by Vite in dev/preview, or Nginx in prod)
    console.log('[Socket] Connecting via same-origin proxy');

    this.socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('[Socket] Connected with ID:', this.socket?.id);
    });

    this.socket.on('disconnect', (reason) => {
      console.warn('[Socket] Disconnected:', reason);
    });

    return this.socket;
  }

  getSocket() {
    if (!this.socket) {
      return this.connect();
    }
    return this.socket;
  }

  emit(event: string, data?: unknown) {
    this.getSocket().emit(event, data);
  }

  on(event: string, callback: (...args: unknown[]) => void) {
    this.getSocket().on(event, callback);
  }

  off(event: string, callback?: (...args: unknown[]) => void) {
    this.getSocket().off(event, callback);
  }
}

export const socketService = new SocketService();
