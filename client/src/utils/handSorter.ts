import { Card, PropertyColor } from '@monopoly-deal/shared';

export type HandSortMode = 'DEFAULT' | 'TYPE' | 'VALUE' | 'COLOR';

const STORAGE_KEY = 'md_hand_sort_mode';

export function getStoredSortMode(): HandSortMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'TYPE' || saved === 'VALUE' || saved === 'COLOR' || saved === 'DEFAULT') {
      return saved;
    }
  } catch {
    // Ignore localStorage access errors
  }
  return 'DEFAULT';
}

export function setStoredSortMode(mode: HandSortMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore localStorage access errors
  }
}

export function calculateTotalHandValue(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + (card.value || 0), 0);
}

export function getCardKind(card: Card): string {
  const k = card.kind || card.type || '';
  if (k === 'WILDCARD') return 'WILDCARD';
  if (k === 'PROPERTY') return 'PROPERTY';
  if (k === 'ACTION') return 'ACTION';
  if (k === 'RENT') return 'RENT';
  if (k === 'MONEY') return 'MONEY';

  if (card.colors && card.colors.length > 0) return 'WILDCARD';
  if (card.color) return 'PROPERTY';
  if (card.title?.toLowerCase().includes('rent')) return 'RENT';
  if (typeof card.value === 'number' && !card.title && !card.name) return 'MONEY';
  return 'ACTION';
}

const KIND_PRIORITY: Record<string, number> = {
  WILDCARD: 1,
  PROPERTY: 2,
  ACTION: 3,
  RENT: 4,
  MONEY: 5
};

const COLOR_ORDER: PropertyColor[] = [
  'Brown',
  'DarkBlue',
  'Green',
  'LightBlue',
  'Orange',
  'Purple',
  'Railroad',
  'Red',
  'Utility',
  'Yellow',
  'ALL'
];

export function getCardPrimaryColor(card: Card): string {
  if (card.color) return card.color;
  if (card.colors && card.colors.length > 0) return card.colors[0];
  return 'Z_OTHER';
}

export function sortCards(cards: Card[], mode: HandSortMode): Card[] {
  if (mode === 'DEFAULT') return [...cards];

  const sorted = [...cards];

  if (mode === 'TYPE') {
    sorted.sort((a, b) => {
      const kindA = getCardKind(a);
      const kindB = getCardKind(b);
      const prioA = KIND_PRIORITY[kindA] || 99;
      const prioB = KIND_PRIORITY[kindB] || 99;
      if (prioA !== prioB) return prioA - prioB;
      return (b.value || 0) - (a.value || 0);
    });
  } else if (mode === 'VALUE') {
    sorted.sort((a, b) => {
      const valA = a.value || 0;
      const valB = b.value || 0;
      if (valA !== valB) return valB - valA;
      const titleA = a.title || a.name || '';
      const titleB = b.title || b.name || '';
      return titleA.localeCompare(titleB);
    });
  } else if (mode === 'COLOR') {
    sorted.sort((a, b) => {
      const colA = getCardPrimaryColor(a);
      const colB = getCardPrimaryColor(b);
      const idxA = COLOR_ORDER.indexOf(colA as PropertyColor);
      const idxB = COLOR_ORDER.indexOf(colB as PropertyColor);
      const rankA = idxA >= 0 ? idxA : 99;
      const rankB = idxB >= 0 ? idxB : 99;
      if (rankA !== rankB) return rankA - rankB;
      return (b.value || 0) - (a.value || 0);
    });
  }

  return sorted;
}
