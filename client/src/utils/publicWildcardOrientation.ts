import type { Card, PropertyColor } from '@monopoly-deal/shared';

// Printed PNG orientation, verified against all seven assets. Filenames and
// catalog colors are NOT ordered top-first (e.g. LightBlue&Brown is brown-up).
const PRINTED_ENDS: Array<readonly [PropertyColor, PropertyColor]> = [
  ['Green','DarkBlue'], ['Brown','LightBlue'], ['LightBlue','Railroad'],
  ['Green','Railroad'], ['Railroad','Utility'], ['Orange','Purple'], ['Red','Yellow'],
];
export function publicWildcardRotation(card: Card, group?: string): 0 | 180 {
  if (!group || (card.kind || card.type) !== 'WILDCARD' || card.color === 'ALL') return 0;
  const colors = card.colors;
  // ALL/multicolor and incomplete metadata never guess a dual-color orientation.
  if (!colors || colors.length !== 2 || colors.includes('ALL') || colors[0] === colors[1]) return 0;
  const pair = PRINTED_ENDS.find(ends => ends.every(color => colors.includes(color)));
  return pair && group.split('#')[0] === pair[1] ? 180 : 0;
}
