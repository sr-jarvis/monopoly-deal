import React, { useState } from 'react';
import { Card } from '@monopoly-deal/shared';
import { CardView } from './CardView';
import { scheduleDiscardCascade } from '../utils/cardDiscardFlightEngine';

interface DiscardModalProps {
  hand: Card[];
  onDiscard: (discardCardIds: string[]) => void;
}

export const DiscardModal: React.FC<DiscardModalProps> = ({ hand, onDiscard }) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const cardsToDiscardCount = hand.length - 7;

  const toggleSelectCard = (cardId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(cardId)) {
        return prev.filter((id) => id !== cardId);
      }
      if (prev.length < cardsToDiscardCount) {
        return [...prev, cardId];
      }
      return prev;
    });
  };

  const isComplete = selectedIds.length === cardsToDiscardCount;

  const handleConfirmDiscard = () => {
    if (!isComplete) return;
    try {
      scheduleDiscardCascade({
        cardIds: selectedIds,
        seatId: 'self',
        reason: 'over-limit',
      });
    } catch {
      // Fail-safe animation call
    }
    onDiscard(selectedIds);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-xl w-full shadow-2xl space-y-6">
        <div className="flex justify-between items-start border-b border-slate-700 pb-3">
          <div>
            <h2 className="text-xl font-black text-amber-400 uppercase tracking-wider flex items-center gap-2">
              <span>🃏</span> Discard Required
            </h2>
            <p className="text-xs text-slate-300 mt-1">
              Your turn is ending with {hand.length} cards. Maximum allowed hand size is 7.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-400 uppercase font-bold">Selected</div>
            <div
              className={`text-lg font-black font-mono ${
                isComplete ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {selectedIds.length} / {cardsToDiscardCount}
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Select <span className="font-bold text-amber-300">{cardsToDiscardCount}</span> card(s) to discard to the central discard pile:
        </p>

        <div className="flex gap-2 overflow-x-auto pb-4 pt-1">
          {hand.map((card) => (
            <CardView
              key={card.id}
              card={card}
              size="md"
              selected={selectedIds.includes(card.id)}
              onClick={() => toggleSelectCard(card.id)}
            />
          ))}
        </div>

        <button
          onClick={handleConfirmDiscard}
          disabled={!isComplete}
          className="w-full py-3.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-extrabold rounded-xl transition shadow-lg uppercase tracking-wider text-sm"
        >
          Discard {selectedIds.length} Card(s) & End Turn
        </button>
      </div>
    </div>
  );
};
