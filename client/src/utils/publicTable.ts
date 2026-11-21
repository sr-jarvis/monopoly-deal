import { propertyGroupColor } from '@monopoly-deal/shared';

/** Victory needs three distinct colors, not three instances of the same set. */
export function completedColorCount(player: { completedSetColors?: string[]; completedSetGroups?: string[] }): number {
  return new Set((player.completedSetColors ?? player.completedSetGroups ?? []).map(propertyGroupColor)).size;
}
