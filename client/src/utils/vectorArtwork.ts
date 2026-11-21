import type { Card, PropertyColor } from '@monopoly-deal/shared';
import manifest from '../../public/assets/vector-cards/manifest.json';

export interface VectorArtwork {
  svg: string;
  png: string;
  topColor?: PropertyColor;
  bottomColor?: PropertyColor;
}

export function propertyRentSummary(color: string, count: number, complete: boolean, house: boolean, hotel: boolean) {
  const face = manifest.faces.find(face => face.kind === 'PROPERTY' && 'color' in face && face.color === color);
  const tiers = (face && 'rentTiers' in face ? face.rentTiers : []) || [];
  const base = count > 0 ? (tiers[Math.min(count, tiers.length) - 1] || 0) : 0;
  return `${count} / ${tiers.length} properties${complete ? ' · complete' : ''} · Rent ${base + (complete ? (house ? 3 : 0) + (hotel ? 4 : 0) : 0)}M`;
}

function knownPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Accept only exact catalog entries, with or without a single root slash.
  const path = value.startsWith('/') ? value : `/${value}`;
  return manifest.faces.some(face => face.png === path) ? path : null;
}

/** Wire image fields never become URLs or markup. Semantic lookup is exact. */
export function resolveVectorArtwork(card: Card): VectorArtwork | null {
  const path = knownPath(card.imageLocation) || knownPath(card.imageUrl);
  const kind = card.kind || card.type;
  const title = card.title || card.name;
  const face = manifest.faces.find(face => path ? face.png === path : (
    face.kind === kind && face.title === title && face.value === card.value &&
    (face.kind !== 'PROPERTY' || ('color' in face && face.color === card.color)) &&
    ((face.kind !== 'WILDCARD' && face.kind !== 'RENT') || (
      Array.isArray(card.colors) && face.colors.length === card.colors.length &&
      new Set(card.colors).size === card.colors.length &&
      face.colors.every(color => card.colors?.some(candidate => candidate === color))
    ))
  ));
  if (!face) return null;
  // Values are build-time, locally generated catalog data, not wire assertions.
  return {
    svg: face.svg,
    png: face.png,
    topColor: 'topColor' in face ? face.topColor as PropertyColor : undefined,
    bottomColor: 'bottomColor' in face ? face.bottomColor as PropertyColor : undefined,
  };
}
