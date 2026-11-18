import type { Card, DrawEvent, GameClientState } from '@monopoly-deal/shared';

export interface DrawBatch extends DrawEvent {
  key: string;
  matchId: string;
  self: boolean;
  cards: Card[];
  startAt: number;
  endAt: number;
}
export interface DrawPresentation { batches: DrawBatch[]; shuffleAt: number | null }
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
const STORAGE_KEY = 'md:draw-watermarks:v1';
const MAX_MATCH_SEATS = 24;
const FLIGHT_MS = 420;
const STAGGER_MS = 90;
export const EMPTY_PRESENTATION: DrawPresentation = { batches: [], shuffleAt: null };

/** Server events are the only admission boundary. Persist before publishing so
 * StrictMode, remounts and duplicate snapshots cannot launch a second sequence.
 * A fresh connection without a witnessed lobby suppresses historical events.
 */
export class DrawOrchestrator {
  private marks = new Map<string, number>();
  private initialized = new Set<string>();
  private reconnecting = false;
  private timeline = 0;
  private matchId = '';
  constructor(private storage?: StorageLike) {
    try {
      const entries: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(entries)) for (const entry of entries.slice(-MAX_MATCH_SEATS)) {
        if (Array.isArray(entry) && typeof entry[0] === 'string' && Number.isSafeInteger(entry[1]) && entry[1] >= 0) this.marks.set(entry[0], entry[1]);
      }
    } catch { /* Disabled or corrupt storage: in-memory dedupe still works. */ }
  }
  disconnect() { this.reconnecting = true; this.timeline = 0; }
  consume(state: GameClientState, options: { startup?: boolean; reducedMotion?: boolean; now: number }): DrawPresentation {
    if (!state.matchId || !Array.isArray(state.drawEvents)) return EMPTY_PRESENTATION;
    const key = JSON.stringify([state.matchId, state.self.id]);
    const first = !this.initialized.has(key);
    const known = this.marks.has(key);
    const baselineOnly = this.reconnecting || (first && (known || !options.startup));
    this.reconnecting = false;
    this.initialized.add(key);
    // Bound all session state, not only the persisted representation.
    if (this.initialized.size > MAX_MATCH_SEATS) this.initialized.delete(this.initialized.values().next().value!);
    if (this.matchId !== state.matchId) { this.matchId = state.matchId; this.timeline = options.now; }
    let watermark = this.marks.get(key) ?? 0;
    const seats = new Set([state.self.id, ...state.opponents.map(p => p.id)]);
    const events = state.drawEvents.filter(e => Number.isSafeInteger(e.id) && e.id > watermark && Number.isInteger(e.count) && e.count >= 0 && e.count <= 5 && seats.has(e.playerId) && (e.kind === 'INITIAL' || e.kind === 'DRAW')).sort((a,b) => a.id-b.id);
    const fresh: DrawEvent[] = [];
    for (const event of events) {
      if (event.id <= watermark) continue;
      watermark = event.id;
      fresh.push(event);
    }
    this.marks.delete(key); this.marks.set(key, watermark);
    while (this.marks.size > MAX_MATCH_SEATS) this.marks.delete(this.marks.keys().next().value!);
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.marks])); } catch { /* Storage quota/privacy mode. */ }
    if (baselineOnly || options.reducedMotion) { this.timeline = options.now; return EMPTY_PRESENTATION; }
    if (!fresh.length) return EMPTY_PRESENTATION;
    const shuffleAt = first && !known && fresh.some(e => e.kind === 'INITIAL') ? Math.max(options.now, this.timeline) : null;
    this.timeline = Math.max(this.timeline, options.now) + (shuffleAt === null ? 0 : 700);
    const batches = fresh.filter(e => e.count > 0).map(event => {
      const startAt = this.timeline;
      const endAt = startAt + FLIGHT_MS + (event.count - 1) * STAGGER_MS;
      this.timeline = endAt + 60;
      return { ...event, key: `${state.matchId}:${event.id}`, matchId: state.matchId, self: event.playerId === state.self.id,
        cards: event.playerId === state.self.id ? (event.kind === 'INITIAL' ? state.self.hand.slice(0,event.count) : state.self.hand.slice(-event.count)) : [], startAt, endAt };
    });
    return { batches, shuffleAt };
  }
}

let orchestrator: DrawOrchestrator | undefined;
let snapshot = EMPTY_PRESENTATION;
let startup = false;
const listeners = new Set<() => void>();
export const drawPresentation = {
  witnessLobby() { startup = true; },
  disconnect() { startup = false; orchestrator?.disconnect(); snapshot = EMPTY_PRESENTATION; listeners.forEach(fn => fn()); },
  receive(state: GameClientState) {
    if (!orchestrator) {
      let storage: StorageLike | undefined;
      try { storage = window.sessionStorage; } catch { /* private browsing */ }
      orchestrator = new DrawOrchestrator(storage);
    }
    const now = Date.now();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = orchestrator.consume(state, { startup, reducedMotion, now });
    startup = false;
    const retained = reducedMotion ? [] : snapshot.batches.filter(b => b.matchId === state.matchId && b.endAt > now);
    snapshot = { batches: [...retained, ...next.batches], shuffleAt: reducedMotion ? null : next.shuffleAt ?? (snapshot.shuffleAt !== null && snapshot.shuffleAt + 700 > now ? snapshot.shuffleAt : null) };
    listeners.forEach(fn => fn());
  },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  getSnapshot: () => snapshot,
  getServerSnapshot: () => EMPTY_PRESENTATION,
};
