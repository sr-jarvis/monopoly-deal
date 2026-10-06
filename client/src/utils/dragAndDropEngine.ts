import { Card, PropertyColor } from '@monopoly-deal/shared';
import * as sfx from './soundEngine';

export type DropZoneKind = 'BANK' | 'PROPERTY' | 'ACTION' | 'HAND';

export interface DragCardPayload {
  card: Card;
  sourceIndex: number;
  sourceZone: 'HAND' | 'BANK' | 'PROPERTY';
}

export interface DragEligibilityContext {
  isMyTurn: boolean;
  playsMade: number;
  turnPhase: 'DRAW' | 'ACTION' | 'DISCARD' | 'COMPLETE';
  waitingForPayment: boolean;
  selfOwesPayment: boolean;
}

export interface DropZoneTarget {
  kind: DropZoneKind;
  targetColor?: PropertyColor;
  targetIndex?: number;
}

export type ActionAffordance = 'direct-action' | 'board-upgrade' | 'attach-only' | 'response-only' | 'not-action';

export function getActionAffordance(card: Card): ActionAffordance {
  const kind = (card.kind || card.type || '').toUpperCase();
  const title = card.title || card.name || '';

  if (kind === 'RENT') {
    return 'direct-action';
  }
  if (kind !== 'ACTION') {
    return 'not-action';
  }
  if (title === 'Double The Rent') {
    return 'attach-only';
  }
  if (title === 'Just Say No') {
    return 'response-only';
  }
  if (title === 'House' || title === 'Hotel') {
    return 'board-upgrade';
  }
  return 'direct-action';
}

export function canDropOnCenterAction(card: Card): boolean {
  const affordance = getActionAffordance(card);
  return affordance === 'direct-action' || affordance === 'board-upgrade';
}

export const DRAG_MIME_TYPE = 'application/x-monopoly-deal-card';

/**
 * Checks whether a dragged card is eligible to be dropped onto a target zone.
 */
export function isDropEligible(
  payload: DragCardPayload,
  target: DropZoneTarget,
  ctx: DragEligibilityContext
): boolean {
  // Hand reordering is always allowed regardless of turn state
  if (target.kind === 'HAND') {
    return true;
  }

  // Card play drop zones require active turn during ACTION phase with < 3 plays made
  if (!ctx.isMyTurn) return false;
  if (ctx.turnPhase !== 'ACTION') return false;
  if (ctx.playsMade >= 3) return false;
  if (ctx.waitingForPayment || ctx.selfOwesPayment) return false;

  const card = payload.card;
  const kind = (card.kind || card.type || '').toUpperCase();

  switch (target.kind) {
    case 'BANK': {
      // Money cards or action/rent cards can be banked for monetary value
      return kind === 'MONEY' || kind === 'ACTION' || kind === 'RENT';
    }

    case 'PROPERTY': {
      // Property or wildcard cards can be placed in property sets
      if (kind !== 'PROPERTY' && kind !== 'WILDCARD') return false;

      // If target color is specified, verify wildcard/property compatibility
      if (target.targetColor && target.targetColor !== 'ALL') {
        if (card.color) {
          return card.color === target.targetColor;
        }
        if (card.colors && card.colors.length > 0) {
          return card.colors.includes(target.targetColor);
        }
      }
      return true;
    }

    case 'ACTION': {
      // Only card subtypes that can begin a normal center action should light up the action pile.
      // Double The Rent is attach-only with a Rent card; Just Say No is response-only.
      return canDropOnCenterAction(card);
    }

    default:
      return false;
  }
}

/**
 * Custom Event Dispatcher for Drag & Drop UI Synchronization
 */
export const DRAG_EVENTS = {
  START: 'md:drag:start',
  END: 'md:drag:end',
  OVER: 'md:drag:over',
  DROP: 'md:drag:drop',
} as const;

let activeDragPayload: DragCardPayload | null = null;

export function setActiveDragPayload(payload: DragCardPayload | null): void {
  activeDragPayload = payload;
  if (typeof window !== 'undefined') {
    if (payload) {
      window.dispatchEvent(
        new CustomEvent(DRAG_EVENTS.START, { detail: payload })
      );
      sfx.playCardDraw();
    } else {
      window.dispatchEvent(new CustomEvent(DRAG_EVENTS.END));
    }
  }
}

export function getActiveDragPayload(): DragCardPayload | null {
  return activeDragPayload;
}

/**
 * Formats drag ghost preview badge text based on card properties
 */
export function getDragPreviewLabel(card: Card): string {
  const title = card.title || card.name || 'Card';
  const val = typeof card.value === 'number' ? `$${card.value}M` : '';
  return val ? `${title} (${val})` : title;
}
