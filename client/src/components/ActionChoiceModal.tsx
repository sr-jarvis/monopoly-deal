import React, { useState } from 'react';
import { Card, PropertyColor, PlayerClientView, BuildingState, propertyGroupColor, nextPropertyGroupKey } from '@monopoly-deal/shared';
import { AtlasCardDialog } from './AtlasCardDialog';

interface ActionChoiceModalProps {
  card: Card;
  opponents: PlayerClientView[];
  selfProperties: Record<string, Card[]>;
  selfHand: Card[];
  actionCountRemaining: number;
  selfCompletedSetColors?: string[];
  selfBuildings?: BuildingState;
  onClose: () => void;
  onPlay: (options: {
    targetZone: 'bank' | 'properties' | 'action';
    propertyColor?: string;
    targetPlayerId?: string;
    targetPropertyColor?: string;
    targetCardId?: string;
    offeredCardId?: string;
    offeredPropertyColor?: string;
    requestedCardId?: string;
    requestedPropertyColor?: string;
    doubleRentCardId?: string;
    doubleRentCardIds?: string[];
  }) => void;
}

const PROPERTY_COLORS: PropertyColor[] = [
  'Brown',
  'LightBlue',
  'Purple',
  'Orange',
  'Red',
  'Yellow',
  'Green',
  'DarkBlue',
  'Railroad',
  'Utility'
];

export const ActionChoiceModal: React.FC<ActionChoiceModalProps> = ({
  card,
  opponents,
  selfProperties,
  selfHand,
  actionCountRemaining,
  selfCompletedSetColors,
  selfBuildings,
  onClose,
  onPlay
}) => {
  const [selectedTargetPlayer, setSelectedTargetPlayer] = useState<string>(
    opponents.length > 0 ? opponents[0].id : ''
  );
  const [selectedColor, setSelectedColor] = useState<string>(
    card.color || (card.colors || []).find((color): color is PropertyColor => color !== 'ALL') || 'Green'
  );
  const [selectedTargetCardId, setSelectedTargetCardId] = useState<string>('');
  // Forced Deal: the actor's own property offered up in the swap. The requested
  // (target-owned) property reuses `selectedTargetCardId`, which is already
  // cleared whenever the target opponent changes.
  const [selectedOfferedCardId, setSelectedOfferedCardId] = useState<string>('');
  const [selectedTargetSetColor, setSelectedTargetSetColor] = useState<string>('');

  // Server ActionCard instances don't carry a reliable `type` field (only
  // PropertyCard sets one, to a color) - classify by exact title instead.
  const SUPPORTED_ACTION_TITLES = ['Debt Collector', 'Its My Birthday', 'Sly Deal', 'Forced Deal', 'Deal Breaker', 'Pass Go'];
  const TARGETED_ACTION_TITLES = ['Debt Collector', 'Sly Deal', 'Forced Deal', 'Deal Breaker'];
  const title = card.title || card.name || '';
  const isTargetedAction = TARGETED_ACTION_TITLES.includes(title);
  const isSlyDeal = title === 'Sly Deal';
  const isForcedDeal = title === 'Forced Deal';
  const isDealBreaker = title === 'Deal Breaker';
  const isHouse = title === 'House';
  const isHotel = title === 'Hotel';
  const isDoubleTheRent = title === 'Double The Rent';

  // Double The Rent is only ever playable folded into a Rent action: it needs a
  // separate DTR card in hand and at least 2 plays left (it costs both).
  const doubleRentCard = (selfHand || []).find((c) => (c.title || c.name) === 'Double The Rent');
  const canDoubleRent = !!doubleRentCard && actionCountRemaining >= 2;
  const [useDoubleRent, setUseDoubleRent] = useState<boolean>(false);
  const [useTwoDoublers, setUseTwoDoublers] = useState(false);
  const doublers = selfHand.filter(c => (c.title || c.name) === 'Double The Rent');
  const canUseTwoDoublers = doublers.length >= 2 && actionCountRemaining >= 3;

  // A House may only be added onto a complete set the player owns that isn't a
  // Railroad/Utility set and doesn't already carry a House. A Hotel needs the
  // same, plus an existing House and no existing Hotel. Trust the
  // server-computed `completedSetColors` and additive `buildings` state.
  const BUILDING_EXCLUDED_COLORS: PropertyColor[] = ['Railroad', 'Utility'];
  const houseEligibleColors: string[] = (selfCompletedSetColors || []).filter(
    (color) => !BUILDING_EXCLUDED_COLORS.includes(propertyGroupColor(color)) && !selfBuildings?.[color]?.house
  );
  const hotelEligibleColors: string[] = (selfCompletedSetColors || []).filter(
    (color) =>
      !BUILDING_EXCLUDED_COLORS.includes(propertyGroupColor(color)) &&
      selfBuildings?.[color]?.house &&
      !selfBuildings?.[color]?.hotel
  );
  const [selectedHouseColor, setSelectedHouseColor] = useState<string>('');
  const [selectedHotelColor, setSelectedHotelColor] = useState<string>('');

  // An opponent is a legal Sly Deal / Forced Deal target only if they own at
  // least one property card sitting in a set that isn't already complete -
  // trusting the server-computed `completedSetColors` rather than re-deriving
  // set sizes on the client.
  const isOpponentStealable = (opp: PlayerClientView): boolean => {
    const completed = opp.completedSetGroups || opp.completedSetColors || [];
    return Object.entries(opp.properties || {}).some(
      ([color, cards]) => (cards?.length || 0) > 0 && !completed.includes(color as PropertyColor)
    );
  };

  const isOpponentSetStealable = (opp: PlayerClientView): boolean =>
    (opp.completedSetGroups || opp.completedSetColors || []).length > 0;

  const collectIncompleteProps = (
    properties: Record<string, Card[]> | undefined,
    completed: string[]
  ): { cardId: string; color: string; card: Card }[] =>
    Object.entries(properties || {}).flatMap(([color, cards]) => {
      if (completed.includes(color as PropertyColor)) return [];
      return (cards || []).map((c) => ({ cardId: c.id, color: color as PropertyColor, card: c }));
    });

  const targetOpponent = opponents.find((opp) => opp.id === selectedTargetPlayer);
  // Cards eligible to steal (Sly Deal) or to request (Forced Deal) from the
  // currently selected target - excludes any complete set.
  const stealableCards: { cardId: string; color: string; card: Card }[] =
    (isSlyDeal || isForcedDeal) && targetOpponent
      ? collectIncompleteProps(targetOpponent.properties, targetOpponent.completedSetGroups || targetOpponent.completedSetColors || [])
      : [];
  const selectedSteal = stealableCards.find((c) => c.cardId === selectedTargetCardId);

  // Forced Deal: the actor's own properties that may be offered - excludes any
  // complete set of their own.
  const offerableCards: { cardId: string; color: string; card: Card }[] = isForcedDeal
    ? collectIncompleteProps(selfProperties, selfCompletedSetColors || [])
    : [];
  const selectedOffer = offerableCards.find((c) => c.cardId === selectedOfferedCardId);
  const stealableSets: { color: string; cards: Card[] }[] = isDealBreaker && targetOpponent
    ? (targetOpponent.completedSetGroups || targetOpponent.completedSetColors || []).map((color) => ({
        color,
        cards: targetOpponent.properties?.[color] || []
      }))
    : [];

  const cardKind = card.kind || card.type;
  const isProperty = cardKind === 'PROPERTY';
  const isWildcard = cardKind === 'WILDCARD';
  const isSupportedAction = cardKind === 'ACTION' && SUPPORTED_ACTION_TITLES.includes(title);
  const isRent = cardKind === 'RENT';
  const isWildRent = isRent && (card.colors?.length || 0) > 2;
  const selectableColors = isWildcard && Array.isArray(card.colors) && card.colors.length > 0
    ? card.colors.filter((color): color is PropertyColor => color !== 'ALL')
    : PROPERTY_COLORS;
  const rentColors = Array.isArray(card.colors)
    ? card.colors.filter((color): color is PropertyColor => color !== 'ALL')
    : [];
  const rentGroups = Object.keys(selfProperties).filter(key => rentColors.includes(propertyGroupColor(key)));
  const selectedRentColor = rentGroups.includes(selectedColor) ? selectedColor : rentGroups[0];
  const placementColor = isWildcard ? propertyGroupColor(selectedColor) : card.color;
  const placementGroups = placementColor ? [...new Set([placementColor, ...Object.keys(selfProperties).filter(key => propertyGroupColor(key) === placementColor), nextPropertyGroupKey(selfProperties, placementColor)])] : [];
  const selectedPlacementGroup = placementGroups.includes(selectedColor) ? selectedColor : placementGroups[0];

  return (
    <AtlasCardDialog card={card} title="Play Card Action" onClose={onClose}>

        {/* Target Player Selector (For targeted action cards) */}
        {(isTargetedAction || isWildRent) && opponents.length > 0 && (
          <div>
            <label className="block text-xs font-bold text-sky-400 uppercase tracking-wider mb-2">
              Select Target Opponent
            </label>
            <div className="grid grid-cols-2 gap-2">
              {opponents.map((opp) => {
                const disabled = isDealBreaker
                  ? !isOpponentSetStealable(opp)
                  : (isSlyDeal || isForcedDeal) && !isOpponentStealable(opp);
                return (
                  <button
                    key={opp.id}
                    aria-pressed={selectedTargetPlayer === opp.id}
                    disabled={disabled}
                    onClick={() => {
                      setSelectedTargetPlayer(opp.id);
                      setSelectedTargetCardId('');
                      setSelectedTargetSetColor('');
                    }}
                    className={`p-2.5 rounded-lg text-xs font-bold border transition text-left flex justify-between items-center ${
                      selectedTargetPlayer === opp.id
                        ? 'bg-sky-600 border-sky-400 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                    } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <span>{opp.displayName}</span>
                    <span className="text-[10px] opacity-75">{opp.handCount} cards</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sly Deal Property Picker */}
        {isSlyDeal && selectedTargetPlayer && (
          <div>
            <label className="block text-xs font-bold text-rose-400 uppercase tracking-wider mb-2">
              Select Property to Steal
            </label>
            {stealableCards.length === 0 ? (
              <p className="text-xs text-slate-400">This opponent has no stealable properties.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {stealableCards.map(({ cardId, color, card: stealCard }) => (
                  <button
                    key={cardId}
                    onClick={() => setSelectedTargetCardId(cardId)}
                    aria-pressed={selectedTargetCardId === cardId}
                    className={`p-2 rounded-lg text-xs font-bold border transition text-left ${
                      selectedTargetCardId === cardId
                        ? 'bg-rose-600 border-rose-400 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {stealCard.title || stealCard.name} ({color.replace(/([a-z])([A-Z])/g, '$1 $2')})
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Forced Deal — Property to Request from the target */}
        {isForcedDeal && selectedTargetPlayer && (
          <div>
            <label className="block text-xs font-bold text-rose-400 uppercase tracking-wider mb-2">
              Property to Take
            </label>
            {stealableCards.length === 0 ? (
              <p className="text-xs text-slate-400">This opponent has no properties outside a complete set.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {stealableCards.map(({ cardId, color, card: reqCard }) => (
                  <button
                    key={cardId}
                    onClick={() => setSelectedTargetCardId(cardId)}
                    aria-pressed={selectedTargetCardId === cardId}
                    className={`p-2 rounded-lg text-xs font-bold border transition text-left ${
                      selectedTargetCardId === cardId
                        ? 'bg-rose-600 border-rose-400 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {reqCard.title || reqCard.name} ({color.replace(/([a-z])([A-Z])/g, '$1 $2')})
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Forced Deal — Your Property to Offer */}
        {isForcedDeal && (
          <div>
            <label className="block text-xs font-bold text-sky-400 uppercase tracking-wider mb-2">
              Your Property to Give
            </label>
            {offerableCards.length === 0 ? (
              <p className="text-xs text-slate-400">You have no property outside a complete set to offer.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {offerableCards.map(({ cardId, color, card: offerCard }) => (
                  <button
                    key={cardId}
                    onClick={() => setSelectedOfferedCardId(cardId)}
                    aria-pressed={selectedOfferedCardId === cardId}
                    className={`p-2 rounded-lg text-xs font-bold border transition text-left ${
                      selectedOfferedCardId === cardId
                        ? 'bg-sky-600 border-sky-400 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {offerCard.title || offerCard.name} ({color.replace(/([a-z])([A-Z])/g, '$1 $2')})
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isDealBreaker && selectedTargetPlayer && (
          <div>
            <label className="block text-xs font-bold text-rose-400 uppercase tracking-wider mb-2">
              Complete Property Set to Steal
            </label>
            {stealableSets.length === 0 ? (
              <p className="text-xs text-slate-400">This opponent has no complete property sets.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {stealableSets.map(({ color, cards }) => (
                  <button
                    key={color}
                    onClick={() => setSelectedTargetSetColor(color)}
                    aria-pressed={selectedTargetSetColor === color}
                    className={`p-2 rounded-lg text-xs font-bold border transition text-left ${
                      selectedTargetSetColor === color
                        ? 'bg-rose-600 border-rose-400 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {color.replace(/([a-z])([A-Z])/g, '$1 $2')} ({cards.length} cards)
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Wildcard Color Picker */}
        {isWildcard && (
          <div>
            <label className="block text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">
              Select Set Color
            </label>
            <div className="grid grid-cols-2 gap-2">
              {selectableColors.map((col) => (
                <button
                  key={col}
                  onClick={() => setSelectedColor(col)}
                  aria-pressed={selectedColor === col}
                  className={`p-2 rounded-lg text-xs font-bold border transition text-center ${
                    selectedColor === col
                      ? 'bg-amber-600 border-amber-400 text-white shadow-lg'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {col.replace(/([a-z])([A-Z])/g, '$1 $2')}
                </button>
              ))}
            </div>
          </div>
        )}

        {(isProperty || isWildcard) && <label className="block text-xs text-sky-300">Property set
          <select aria-label="Property set" value={selectedPlacementGroup} onChange={e => setSelectedColor(e.target.value)} className="block bg-slate-900 p-2 w-full">
            {placementGroups.map(key => <option key={key} value={key}>{key}{!selfProperties[key] ? ' (new set)' : ''}</option>)}
          </select>
        </label>}

        {isRent && (
          <div>
            <label className="block text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">Charge Rent On</label>
            <div className="grid grid-cols-2 gap-2">
              {rentGroups.map((color) => {
                const ownedCount = (selfProperties[color] || []).length;
                const disabled = ownedCount === 0;
                return (
                  <button
                    key={color}
                    disabled={disabled}
                    onClick={() => setSelectedColor(color)}
                    aria-pressed={selectedRentColor === color}
                    className={`p-2 rounded-lg text-xs font-bold border transition text-center ${selectedRentColor === color ? 'bg-amber-600 border-amber-400 text-white shadow-lg' : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {color.replace(/([a-z])([A-Z])/g, '$1 $2')} ({ownedCount})
                  </button>
                );
              })}
            </div>

            <label
              className={`mt-3 flex items-center gap-2 text-xs font-bold ${
                canDoubleRent ? 'text-purple-300 cursor-pointer' : 'text-slate-500 cursor-not-allowed'
              }`}
            >
              <input
                type="checkbox"
                disabled={!canDoubleRent}
                checked={useDoubleRent && canDoubleRent}
                onChange={(e) => setUseDoubleRent(e.target.checked)}
              />
              Double The Rent (uses 2 of your 3 plays)
            </label>
            {canUseTwoDoublers && useDoubleRent && <label className="flex gap-2 text-xs text-purple-300"><input type="checkbox" checked={useTwoDoublers} onChange={e => setUseTwoDoublers(e.target.checked)} />Use both Double The Rent cards (4× rent, all 3 plays)</label>}
            {!canDoubleRent && (
              <p className="text-[11px] text-slate-400 mt-1">
                {!doubleRentCard
                  ? 'No Double The Rent card in your hand.'
                  : 'Needs at least 2 plays remaining this turn.'}
              </p>
            )}
            {canDoubleRent && useDoubleRent && (
              <p className="text-[11px] text-purple-300 mt-1">Rent charged will be doubled.</p>
            )}
          </div>
        )}

        {isHouse && (
          <div>
            <label className="block text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2">
              Add House To Complete Set
            </label>
            {houseEligibleColors.length === 0 ? (
              <p className="text-xs text-slate-400">
                You have no complete set eligible for a House (Railroad and Utility sets can't take one,
                and a set can only hold one House).
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {houseEligibleColors.map((color) => (
                  <button
                    key={color}
                    onClick={() => setSelectedHouseColor(color)}
                    aria-pressed={selectedHouseColor === color}
                    className={`p-2 rounded-lg text-xs font-bold border transition text-center ${
                      selectedHouseColor === color
                        ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {color.replace(/([a-z])([A-Z])/g, '$1 $2')}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isHotel && (
          <div>
            <label className="block text-xs font-bold text-rose-400 uppercase tracking-wider mb-2">
              Add Hotel To Complete Set
            </label>
            {hotelEligibleColors.length === 0 ? (
              <p className="text-xs text-slate-400">
                No complete set can take a Hotel yet. A Hotel can only go on a complete set that
                already has a House (and doesn't already have a Hotel); Railroad and Utility sets
                can't take one.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {hotelEligibleColors.map((color) => (
                  <button
                    key={color}
                    onClick={() => setSelectedHotelColor(color)}
                    aria-pressed={selectedHotelColor === color}
                    className={`p-2 rounded-lg text-xs font-bold border transition text-center ${
                      selectedHotelColor === color
                        ? 'bg-rose-600 border-rose-400 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    {color.replace(/([a-z])([A-Z])/g, '$1 $2')}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Play Action Buttons */}
        <div className="space-y-3 pt-2">
          {/* Property cards never enter the bank (E3113). */}
          {!isProperty && !isWildcard && <button
            onClick={() => onPlay({ targetZone: 'bank' })}
            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition shadow-lg flex items-center justify-center gap-2"
          >
            💰 Deposit in Bank (${card.value}M Cash)
          </button>}

          {/* Play as Property / Action */}
          {isProperty || isWildcard ? (
            <button
              onClick={() =>
                onPlay({
                  targetZone: 'properties',
                  propertyColor: selectedPlacementGroup
                })
              }
              className="w-full py-3 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl transition shadow-lg flex items-center justify-center gap-2"
            >
              🏠 Place on Property Board ({isWildcard ? selectedColor : card.color || 'Property'})
            </button>
          ) : isRent ? (
            <button
              disabled={!selectedRentColor || (selfProperties[selectedRentColor] || []).length === 0 || (isWildRent && !selectedTargetPlayer)}
              onClick={() => onPlay({
                targetZone: 'action',
                propertyColor: selectedRentColor,
                targetPlayerId: isWildRent ? selectedTargetPlayer : undefined,
                ...(canDoubleRent && useDoubleRent && doubleRentCard ? (useTwoDoublers && canUseTwoDoublers ? {doubleRentCardIds: doublers.slice(0,2).map(c => c.id)} : {doubleRentCardId: doubleRentCard.id}) : {})
              })}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold rounded-xl transition shadow-lg flex items-center justify-center gap-2"
            >
              ⚡ Charge Rent ({selectedRentColor || 'Choose a color'})
            </button>
          ) : isHouse ? (
            <button
              disabled={!selectedHouseColor || !houseEligibleColors.includes(selectedHouseColor)}
              onClick={() => selectedHouseColor && onPlay({ targetZone: 'action', propertyColor: selectedHouseColor })}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition shadow-lg flex items-center justify-center gap-2"
            >
              🏠 Add House ({selectedHouseColor ? selectedHouseColor.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Choose a set'})
            </button>
          ) : isHotel ? (
            <button
              disabled={!selectedHotelColor || !hotelEligibleColors.includes(selectedHotelColor)}
              onClick={() => selectedHotelColor && onPlay({ targetZone: 'action', propertyColor: selectedHotelColor })}
              className="w-full py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition shadow-lg flex items-center justify-center gap-2"
            >
              🏨 Add Hotel ({selectedHotelColor ? selectedHotelColor.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Choose a set'})
            </button>
          ) : isDoubleTheRent ? (
            <button
              disabled
              className="w-full py-3 bg-slate-700 text-slate-300 font-bold rounded-xl transition shadow-lg flex flex-col items-center justify-center gap-1 opacity-80 cursor-not-allowed"
              title="Double The Rent is played from inside the Rent card dialog"
            >
              <span>⚠️ Play with a Rent card</span>
              <span className="text-[10px] font-normal">
                Open a Rent card and tick “Double The Rent” there — it can’t be played on its own.
              </span>
            </button>
          ) : isSupportedAction ? (
            <button
              disabled={
                (isSlyDeal && (!selectedTargetPlayer || !selectedTargetCardId)) ||
                (isForcedDeal && (!selectedTargetPlayer || !selectedTargetCardId || !selectedOfferedCardId)) ||
                (isDealBreaker && (!selectedTargetPlayer || !selectedTargetSetColor))
              }
              onClick={() =>
                isForcedDeal
                  ? onPlay({
                      targetZone: 'action',
                      targetPlayerId: selectedTargetPlayer,
                      requestedCardId: selectedTargetCardId,
                      requestedPropertyColor: selectedSteal?.color,
                      offeredCardId: selectedOfferedCardId,
                      offeredPropertyColor: selectedOffer?.color
                    })
                  : onPlay({
                      targetZone: 'action',
                      targetPlayerId: isTargetedAction ? selectedTargetPlayer : undefined,
                      targetPropertyColor: isSlyDeal
                        ? selectedSteal?.color
                        : isDealBreaker
                          ? selectedTargetSetColor || undefined
                          : undefined,
                      targetCardId: isSlyDeal ? selectedTargetCardId : undefined
                    })
              }
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition shadow-lg flex items-center justify-center gap-2"
            >
              ⚡ Execute Action ({card.title || card.name})
            </button>
          ) : cardKind === 'ACTION' ? (
            <button
              disabled
              className="w-full py-3 bg-slate-700 text-slate-300 font-bold rounded-xl transition shadow-lg flex items-center justify-center gap-2 opacity-70 cursor-not-allowed"
              title={title === 'Just Say No' ? 'Use the response dialog when an action is played against you' : 'Unsupported action'}
            >
              {title === 'Just Say No' ? 'Use when responding to an action' : `Unsupported action (${title})`}
            </button>
          ) : cardKind === 'MONEY' ? null : (
            <button
              disabled
              className="w-full py-3 bg-slate-700 text-slate-300 font-bold rounded-xl transition shadow-lg flex items-center justify-center gap-2 opacity-70 cursor-not-allowed"
            >
              ⚠️ Cannot play this card type yet ({card.title || card.name})
            </button>
          )}
        </div>
    </AtlasCardDialog>
  );
};
