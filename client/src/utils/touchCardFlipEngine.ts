import { Card, PropertyColor } from '@monopoly-deal/shared';
import * as sfx from './soundEngine';

export type CardColorPair = readonly [PropertyColor, PropertyColor];

// Canonical dual-color Wildcard pairs (excluding 10-color rainbow Wildcard)
export const WILDCARD_PAIRS: CardColorPair[] = [
  ['DarkBlue', 'Green'],
  ['LightBlue', 'Brown'],
  ['LightBlue', 'Railroad'],
  ['Green', 'Railroad'],
  ['Utility', 'Railroad'],
  ['Orange', 'Purple'],
  ['Red', 'Yellow']
];

// Canonical dual-color Rent card pairs (excluding All-Color Rent)
export const RENT_PAIRS: CardColorPair[] = [
  ['DarkBlue', 'Green'],
  ['LightBlue', 'Brown'],
  ['Orange', 'Purple'],
  ['Red', 'Yellow'],
  ['Utility', 'Railroad']
];

// Timing & Gesture constants
export const FLIP_DURATION_MS = 600;
export const DOUBLE_TAP_WINDOW_MS = 300;
export const LONG_PRESS_MS = 500;
export const TAP_SLOP_PX = 8;

export function getCardColorPair(card: Card): CardColorPair | null {
  if (!card) return null;

  const cardKind = card.kind || card.type;

  // Explicit dual colors array on card object
  if (Array.isArray(card.colors) && card.colors.length === 2) {
    return [card.colors[0], card.colors[1]] as CardColorPair;
  }

  // Dual colors defined via color + secondaryColor
  const secColor = (card as { secondaryColor?: PropertyColor }).secondaryColor;
  if (card.color && secColor) {
    return [card.color, secColor] as CardColorPair;
  }

  // Lookup by title/name for Wildcard or Rent cards
  const title = card.title || card.name || '';
  if (cardKind === 'WILDCARD') {
    if (title.includes('Dark Blue') && title.includes('Green')) return ['DarkBlue', 'Green'];
    if (title.includes('Light Blue') && title.includes('Brown')) return ['LightBlue', 'Brown'];
    if (title.includes('Light Blue') && title.includes('Railroad')) return ['LightBlue', 'Railroad'];
    if (title.includes('Green') && title.includes('Railroad')) return ['Green', 'Railroad'];
    if (title.includes('Utility') && title.includes('Railroad')) return ['Utility', 'Railroad'];
    if (title.includes('Orange') && title.includes('Purple')) return ['Orange', 'Purple'];
    if (title.includes('Red') && title.includes('Yellow')) return ['Red', 'Yellow'];
  }

  if (cardKind === 'RENT') {
    if (title.includes('Dark Blue') && title.includes('Green')) return ['DarkBlue', 'Green'];
    if (title.includes('Light Blue') && title.includes('Brown')) return ['LightBlue', 'Brown'];
    if (title.includes('Orange') && title.includes('Purple')) return ['Orange', 'Purple'];
    if (title.includes('Red') && title.includes('Yellow')) return ['Red', 'Yellow'];
    if (title.includes('Utility') && title.includes('Railroad')) return ['Utility', 'Railroad'];
  }

  // Fallback match in canonical tables
  if (card.color) {
    const pairList = cardKind === 'WILDCARD' ? WILDCARD_PAIRS : cardKind === 'RENT' ? RENT_PAIRS : [];
    const match = pairList.find(p => p[0] === card.color || p[1] === card.color);
    if (match) return match;
  }

  return null;
}

export function isFlippableCard(card: Card): boolean {
  if (!card) return false;
  const cardKind = card.kind || card.type;
  if (cardKind !== 'WILDCARD' && cardKind !== 'RENT') return false;

  const title = card.title || card.name || '';
  // Exclude 10-color rainbow wildcard and All-Color Rent
  if (title.includes('10 Color') || title.includes('All Color') || title === 'Wild Rent' || card.color === 'ALL') {
    return false;
  }

  return getCardColorPair(card) !== null;
}

export function getOppositeColor(card: Card, currentColor?: PropertyColor): PropertyColor | null {
  const pair = getCardColorPair(card);
  if (!pair) return null;

  const active = currentColor || card.color || pair[0];
  if (active === pair[0]) return pair[1];
  if (active === pair[1]) return pair[0];

  return pair[1];
}

// In-memory Ephemeral Flip State Map
const flipStateMap = new Map<string, boolean>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach(fn => {
    try {
      fn();
    } catch {
      // ignore listener errors
    }
  });
}

export function getFlippedState(cardId: string): boolean {
  if (!cardId) return false;
  return flipStateMap.get(cardId) || false;
}

export function setFlippedState(cardId: string, flipped: boolean): boolean {
  if (!cardId) return false;
  const current = getFlippedState(cardId);
  if (current !== flipped) {
    flipStateMap.set(cardId, flipped);
    notifyListeners();
    return true;
  }
  return false;
}

export function toggleCardFlip(card: Card): boolean {
  if (!card || !card.id || !isFlippableCard(card)) return false;

  const current = getFlippedState(card.id);
  const next = !current;
  flipStateMap.set(card.id, next);
  notifyListeners();

  try {
    sfx.playCardFlip();
  } catch {
    // ignore sound errors
  }

  return next;
}

export function getActiveColor(card: Card): PropertyColor {
  if (!card) return 'ALL';
  const primaryColor = card.color || 'ALL';
  if (!isFlippableCard(card)) return primaryColor;

  const isFlipped = getFlippedState(card.id);
  if (!isFlipped) return primaryColor;

  const opposite = getOppositeColor(card, primaryColor);
  return opposite || primaryColor;
}

export function pruneFlipState(validCardIds: string[]): void {
  const validSet = new Set(validCardIds);
  let changed = false;
  for (const cardId of flipStateMap.keys()) {
    if (!validSet.has(cardId)) {
      flipStateMap.delete(cardId);
      changed = true;
    }
  }
  if (changed) notifyListeners();
}

export function resetFlipState(): void {
  if (flipStateMap.size > 0) {
    flipStateMap.clear();
    notifyListeners();
  }
}

export function subscribeFlip(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Pointer Gesture Attachment Helper
interface GestureState {
  startX: number;
  startY: number;
  startTime: number;
  longPressTimer: number | null;
  lastTapTime: number;
  lastTapCardId: string | null;
}

const gestureState: GestureState = {
  startX: 0,
  startY: 0,
  startTime: 0,
  longPressTimer: null,
  lastTapTime: 0,
  lastTapCardId: null
};

export function attachFlipGestures(
  element: HTMLElement,
  card: Card,
  onFlipTriggered?: (flipped: boolean) => void
): () => void {
  if (!element || !card || !isFlippableCard(card)) return () => {};

  const clearLongPress = () => {
    if (gestureState.longPressTimer !== null) {
      window.clearTimeout(gestureState.longPressTimer);
      gestureState.longPressTimer = null;
    }
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    gestureState.startX = e.clientX;
    gestureState.startY = e.clientY;
    gestureState.startTime = Date.now();

    clearLongPress();

    gestureState.longPressTimer = window.setTimeout(() => {
      const flipped = toggleCardFlip(card);
      if (onFlipTriggered) onFlipTriggered(flipped);
      clearLongPress();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (gestureState.longPressTimer === null) return;
    const dx = Math.abs(e.clientX - gestureState.startX);
    const dy = Math.abs(e.clientY - gestureState.startY);
    if (dx > TAP_SLOP_PX || dy > TAP_SLOP_PX) {
      clearLongPress();
    }
  };

  const handlePointerUp = (e: PointerEvent) => {
    clearLongPress();
    const dx = Math.abs(e.clientX - gestureState.startX);
    const dy = Math.abs(e.clientY - gestureState.startY);
    if (dx > TAP_SLOP_PX || dy > TAP_SLOP_PX) return;

    const now = Date.now();
    const isDoubleTap =
      gestureState.lastTapCardId === card.id &&
      now - gestureState.lastTapTime < DOUBLE_TAP_WINDOW_MS;

    if (isDoubleTap) {
      const flipped = toggleCardFlip(card);
      if (onFlipTriggered) onFlipTriggered(flipped);
      gestureState.lastTapTime = 0;
      gestureState.lastTapCardId = null;
    } else {
      gestureState.lastTapTime = now;
      gestureState.lastTapCardId = card.id;
    }
  };

  const handlePointerCancel = () => {
    clearLongPress();
  };

  const handleDragStartEvent = () => {
    clearLongPress();
  };

  element.addEventListener('pointerdown', handlePointerDown, { passive: true });
  element.addEventListener('pointermove', handlePointerMove, { passive: true });
  element.addEventListener('pointerup', handlePointerUp, { passive: true });
  element.addEventListener('pointercancel', handlePointerCancel, { passive: true });
  document.addEventListener('md:drag:start', handleDragStartEvent, { passive: true });

  return () => {
    clearLongPress();
    element.removeEventListener('pointerdown', handlePointerDown);
    element.removeEventListener('pointermove', handlePointerMove);
    element.removeEventListener('pointerup', handlePointerUp);
    element.removeEventListener('pointercancel', handlePointerCancel);
    document.removeEventListener('md:drag:start', handleDragStartEvent);
  };
}
