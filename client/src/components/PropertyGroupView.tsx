import React, { useState } from 'react';
import { Card, PropertyColor } from '@monopoly-deal/shared';
import { CardView } from './CardView';
import { getActiveDragPayload, isDropEligible } from '../utils/dragAndDropEngine';

interface PropertyGroupViewProps {
  color: PropertyColor;
  cards: Card[];
  onCardClick?: (card: Card) => void;
  selectedCardId?: string;
  isCompleteSet?: boolean;
  hasHouse?: boolean;
  hasHotel?: boolean;
  onDropCard?: (card: Card, targetColor: PropertyColor) => void;
  isMyTurn?: boolean;
  turnPhase?: 'DRAW' | 'ACTION' | 'DISCARD' | 'COMPLETE' | null;
  playsMade?: number;
}

const COLOR_NAMES: Record<PropertyColor, string> = {
  Brown: 'Brown',
  LightBlue: 'Light Blue',
  Purple: 'Purple',
  Orange: 'Orange',
  Red: 'Red',
  Yellow: 'Yellow',
  Green: 'Green',
  DarkBlue: 'Dark Blue',
  Railroad: 'Railroad',
  Utility: 'Utility',
  ALL: 'Wildcards'
};

const COLOR_HEADER_BG: Record<PropertyColor, string> = {
  Brown: 'bg-amber-900/80 text-amber-200 border-amber-700',
  LightBlue: 'bg-sky-900/80 text-sky-200 border-sky-600',
  Purple: 'bg-purple-900/80 text-purple-200 border-purple-600',
  Orange: 'bg-orange-900/80 text-orange-200 border-orange-600',
  Red: 'bg-red-900/80 text-red-200 border-red-600',
  Yellow: 'bg-yellow-900/80 text-yellow-200 border-yellow-600',
  Green: 'bg-emerald-900/80 text-emerald-200 border-emerald-600',
  DarkBlue: 'bg-blue-900/80 text-blue-200 border-blue-600',
  Railroad: 'bg-slate-900/80 text-slate-200 border-slate-600',
  Utility: 'bg-slate-800/80 text-slate-200 border-slate-500',
  ALL: 'bg-slate-800/80 text-slate-200 border-slate-500'
};

export const PropertyGroupView: React.FC<PropertyGroupViewProps> = ({
  color,
  cards,
  onCardClick,
  selectedCardId,
  isCompleteSet,
  hasHouse,
  hasHotel,
  onDropCard,
  isMyTurn = false,
  turnPhase = 'ACTION',
  playsMade = 0
}) => {
  const [isDragOver, setIsDragOver] = useState(false);

  if (!cards || cards.length === 0) return null;

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const payload = getActiveDragPayload();
    if (!payload) return;

    const eligible = isDropEligible(
      payload,
      { kind: 'PROPERTY', targetColor: color },
      {
        isMyTurn,
        playsMade,
        turnPhase: turnPhase || 'ACTION',
        waitingForPayment: false,
        selfOwesPayment: false
      }
    );

    if (eligible) {
      e.dataTransfer.dropEffect = 'move';
      setIsDragOver(true);
    } else {
      e.dataTransfer.dropEffect = 'none';
    }
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const payload = getActiveDragPayload();
    if (!payload || !onDropCard) return;

    const eligible = isDropEligible(
      payload,
      { kind: 'PROPERTY', targetColor: color },
      {
        isMyTurn,
        playsMade,
        turnPhase: turnPhase || 'ACTION',
        waitingForPayment: false,
        selfOwesPayment: false
      }
    );

    if (eligible) {
      onDropCard(payload.card, color);
    }
  };

  return (
    <div
      data-drop-zone="PROPERTY"
      data-drop-color={color}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex flex-col items-center bg-slate-900/60 border rounded-xl p-2 min-w-[110px] shrink-0 transition-all duration-200 ${
        isDragOver
          ? 'border-emerald-400 ring-2 ring-emerald-400/60 bg-emerald-950/40 scale-105 z-40'
          : 'border-slate-800'
      }`}
    >
      {/* Group Header Badge */}
      <div
        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mb-2 border ${
          COLOR_HEADER_BG[color]
        } ${isCompleteSet ? 'ring-2 ring-amber-400 animate-pulse' : ''}`}
      >
        {COLOR_NAMES[color]} ({cards.length})
      </div>

      {/* Building Badges */}
      {(hasHouse || hasHotel) && (
        <div className="flex gap-1 mb-2">
          {hasHouse && (
            <span
              title={isCompleteSet ? 'House (+$3M rent)' : 'House (no rent bonus — set is incomplete)'}
              className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${
                isCompleteSet
                  ? 'bg-emerald-800/80 text-emerald-100 border-emerald-500/50'
                  : 'bg-slate-800/80 text-slate-400 border-slate-600/50'
              }`}
            >
              🏠 House
            </span>
          )}
          {hasHotel && (
            <span
              title={isCompleteSet ? 'Hotel (+$4M rent)' : 'Hotel (no rent bonus — set is incomplete)'}
              className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${
                isCompleteSet
                  ? 'bg-rose-800/80 text-rose-100 border-rose-500/50'
                  : 'bg-slate-800/80 text-slate-400 border-slate-600/50'
              }`}
            >
              🏨 Hotel
            </span>
          )}
        </div>
      )}

      {/* Vertical Card Stack with Offset Overlap */}
      <div className="relative flex flex-col items-center pb-2">
        {cards.map((card, idx) => (
          <div
            key={card.id || idx}
            style={{ marginTop: idx > 0 ? '-64px' : '0px' }}
            className="transition-transform hover:z-30 hover:-translate-y-2"
          >
            <CardView
              card={card}
              size="sm"
              selected={selectedCardId === card.id}
              onClick={() => onCardClick && onCardClick(card)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
