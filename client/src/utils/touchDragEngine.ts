import { Card, PropertyColor } from '@monopoly-deal/shared';
import {
  DragCardPayload,
  DropZoneKind,
  DropZoneTarget,
  isDropEligible,
  setActiveDragPayload,
  DRAG_EVENTS,
  getDragPreviewLabel
} from './dragAndDropEngine';
import * as sfx from './soundEngine';

export interface TouchDragState {
  touchId: number | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDragActive: boolean;
  payload: DragCardPayload | null;
  hoveredElement: HTMLElement | null;
  hoveredTarget: DropZoneTarget | null;
}

const TOUCH_DRAG_THRESHOLD_PX = 8;
const GHOST_ELEMENT_ID = 'md-touch-drag-ghost';

let touchState: TouchDragState = {
  touchId: null,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  isDragActive: false,
  payload: null,
  hoveredElement: null,
  hoveredTarget: null
};

export function getTouchDragState(): TouchDragState {
  return { ...touchState };
}

/**
 * Creates or updates floating touch preview ghost
 */
function updateTouchGhost(card: Card, x: number, y: number): void {
  if (typeof document === 'undefined') return;

  let ghost = document.getElementById(GHOST_ELEMENT_ID);
  if (!ghost) {
    ghost = document.createElement('div');
    ghost.id = GHOST_ELEMENT_ID;
    ghost.className =
      'fixed z-50 pointer-events-none px-3 py-2 bg-slate-900/90 border-2 border-amber-400 text-amber-200 rounded-xl shadow-2xl backdrop-blur-md text-xs font-bold flex items-center gap-2 transform -translate-x-1/2 -translate-y-1/2 -rotate-3 scale-105 transition-transform animate-in fade-in duration-100';
    document.body.appendChild(ghost);
  }

  const label = getDragPreviewLabel(card);
  ghost.textContent = `🃏 ${label}`;
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
}

/**
 * Removes touch ghost element from DOM
 */
function removeTouchGhost(): void {
  if (typeof document === 'undefined') return;
  const ghost = document.getElementById(GHOST_ELEMENT_ID);
  if (ghost) {
    ghost.remove();
  }
}

/**
 * Resolves drop zone target from a DOM element using data attributes
 */
export function resolveDropTarget(el: HTMLElement | null): { element: HTMLElement; target: DropZoneTarget } | null {
  if (!el || typeof el.closest !== 'function') return null;

  const dropEl = el.closest('[data-drop-zone]') as HTMLElement | null;
  if (!dropEl) return null;

  const kind = dropEl.getAttribute('data-drop-zone') as DropZoneKind | null;
  if (!kind) return null;

  const targetColor = (dropEl.getAttribute('data-drop-color') as PropertyColor | null) || undefined;

  return {
    element: dropEl,
    target: { kind, targetColor }
  };
}

/**
 * Handles touch start event on a draggable card
 */
export function handleTouchStart(
  e: React.TouchEvent<HTMLElement>,
  card: Card,
  index: number,
  sourceZone: 'HAND' | 'BANK' | 'PROPERTY' = 'HAND'
): void {
  if (e.touches.length === 0) return;
  const touch = e.touches[0];

  touchState = {
    touchId: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    currentX: touch.clientX,
    currentY: touch.clientY,
    isDragActive: false,
    payload: { card, sourceIndex: index, sourceZone },
    hoveredElement: null,
    hoveredTarget: null
  };
}

/**
 * Handles touch move event
 */
export function handleTouchMove(
  e: React.TouchEvent<HTMLElement>,
  eligibilityCtx: {
    isMyTurn: boolean;
    playsMade: number;
    turnPhase: 'DRAW' | 'ACTION' | 'DISCARD' | 'COMPLETE';
    waitingForPayment: boolean;
    selfOwesPayment: boolean;
  }
): void {
  if (touchState.touchId === null || !touchState.payload) return;

  const touch = Array.from(e.changedTouches).find(t => t.identifier === touchState.touchId);
  if (!touch) return;

  touchState.currentX = touch.clientX;
  touchState.currentY = touch.clientY;

  const dx = touchState.currentX - touchState.startX;
  const dy = touchState.currentY - touchState.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (!touchState.isDragActive && dist >= TOUCH_DRAG_THRESHOLD_PX) {
    touchState.isDragActive = true;
    setActiveDragPayload(touchState.payload);
    sfx.playCardDraw();
  }

  if (touchState.isDragActive) {
    if (e.cancelable) {
      e.preventDefault();
    }

    updateTouchGhost(touchState.payload.card, touchState.currentX, touchState.currentY);

    if (typeof document !== 'undefined') {
      const topEl = document.elementFromPoint(touchState.currentX, touchState.currentY) as HTMLElement | null;
      const resolved = resolveDropTarget(topEl);

      // Clear existing highlight if target changed
      if (touchState.hoveredElement && touchState.hoveredElement !== resolved?.element) {
        touchState.hoveredElement.classList.remove('md-touch-drop-hover');
      }

      if (resolved) {
        const eligible = isDropEligible(touchState.payload, resolved.target, eligibilityCtx);
        if (eligible) {
          touchState.hoveredElement = resolved.element;
          touchState.hoveredTarget = resolved.target;
          resolved.element.classList.add('md-touch-drop-hover');
        } else {
          touchState.hoveredElement = null;
          touchState.hoveredTarget = null;
        }
      } else {
        touchState.hoveredElement = null;
        touchState.hoveredTarget = null;
      }
    }
  }
}

/**
 * Handles touch end event
 */
export function handleTouchEnd(
  e: React.TouchEvent<HTMLElement>,
  onDropCallback?: (payload: DragCardPayload, target: DropZoneTarget) => void
): void {
  if (touchState.isDragActive && touchState.payload && touchState.hoveredTarget) {
    if (onDropCallback) {
      onDropCallback(touchState.payload, touchState.hoveredTarget);
      sfx.playCardPlay();
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(DRAG_EVENTS.DROP, {
          detail: { payload: touchState.payload, target: touchState.hoveredTarget }
        })
      );
    }
  }

  if (touchState.hoveredElement) {
    touchState.hoveredElement.classList.remove('md-touch-drop-hover');
  }

  removeTouchGhost();
  setActiveDragPayload(null);

  touchState = {
    touchId: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    isDragActive: false,
    payload: null,
    hoveredElement: null,
    hoveredTarget: null
  };
}
