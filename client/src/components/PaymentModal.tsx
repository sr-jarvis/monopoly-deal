import React, { useState } from 'react';
import { Card, PropertyColor } from '@monopoly-deal/shared';
import { CardView } from './CardView';
import { dispatchRentPaymentStart } from '../utils/rentPaymentFlightEngine';

interface PaymentModalProps {
  amountOwed: number;
  bankCards: Card[];
  propertyCards: Record<PropertyColor, Card[]>;
  onPay: (selectedCardIds: string[]) => void;
  mySeatId?: string;
  chargerSeatId?: string;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  amountOwed,
  bankCards,
  propertyCards,
  onPay,
  mySeatId = 'p1',
  chargerSeatId = 'p2',
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Collect all available payment cards (bank + property)
  const allProperties = Object.values(propertyCards).flat();

  const toggleSelectCard = (cardId: string) => {
    setSelectedIds((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
    );
  };

  const getSelectedTotal = () => {
    const selectedBank = bankCards.filter((c) => selectedIds.includes(c.id));
    const selectedProps = allProperties.filter((c) => selectedIds.includes(c.id));
    const bankSum = selectedBank.reduce((sum, c) => sum + (c.value || 0), 0);
    const propSum = selectedProps.reduce((sum, c) => sum + (c.value || 0), 0);
    return bankSum + propSum;
  };

  const currentTotal = getSelectedTotal();
  const totalAssetsValue =
    bankCards.reduce((s, c) => s + (c.value || 0), 0) +
    allProperties.reduce((s, c) => s + (c.value || 0), 0);

  // If player doesn't have enough total assets, they must surrender everything
  const mustPayAll = totalAssetsValue <= amountOwed;
  const isSufficient = currentTotal >= amountOwed || (mustPayAll && currentTotal === totalAssetsValue);

  const handlePay = () => {
    // Collect selected card objects
    const selectedBank = bankCards.filter((c) => selectedIds.includes(c.id));
    const selectedProps = allProperties.filter((c) => selectedIds.includes(c.id));
    const paymentCards = [...selectedBank, ...selectedProps].map((c) => ({
      cardId: c.id,
      label: c.name || `$${c.value}M`,
      name: c.name,
      value: c.value,
      kind: bankCards.some((b) => b.id === c.id) ? ('cash' as const) : ('property' as const),
    }));

    // Dispatch 3D rent payment flight animation
    dispatchRentPaymentStart({
      planId: `pay-${Date.now()}`,
      chargerSeatId,
      amountDue: amountOwed,
      payments: [
        {
          seatId: mySeatId,
          cards: paymentCards,
        },
      ],
    });

    onPay(selectedIds);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-2xl w-full shadow-2xl space-y-6 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-start border-b border-slate-700 pb-3">
          <div>
            <h2 className="text-xl font-black text-rose-400 uppercase tracking-wider flex items-center gap-2">
              <span>💳</span> Payment Required
            </h2>
            <p className="text-xs text-slate-300 mt-1">
              You owe <span className="font-bold text-amber-300">${amountOwed}M</span> in rent or debt demand.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-400 uppercase font-bold">Selected Value</div>
            <div
              className={`text-lg font-black font-mono ${
                isSufficient ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              ${currentTotal}M / ${amountOwed}M
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Bank Cards Section */}
          <div>
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 flex justify-between">
              <span>Bank Cash (${bankCards.reduce((s, c) => s + (c.value || 0), 0)}M)</span>
            </h3>
            {bankCards.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No cash in bank</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {bankCards.map((card) => (
                  <CardView
                    key={card.id}
                    card={card}
                    size="sm"
                    selected={selectedIds.includes(card.id)}
                    onClick={() => toggleSelectCard(card.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Property Cards Section */}
          <div>
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
              Properties (${allProperties.reduce((s, c) => s + (c.value || 0), 0)}M)
            </h3>
            {allProperties.length === 0 ? (
              <p className="text-xs text-slate-500 italic">No properties owned</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {allProperties.map((card) => (
                  <CardView
                    key={card.id}
                    card={card}
                    size="sm"
                    selected={selectedIds.includes(card.id)}
                    onClick={() => toggleSelectCard(card.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-2 border-t border-slate-700 shrink-0">
          <button
            onClick={handlePay}
            disabled={!isSufficient && totalAssetsValue > 0}
            className={`w-full py-3 rounded-xl font-bold uppercase tracking-wider transition ${
              isSufficient || totalAssetsValue === 0
                ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 cursor-pointer shadow-lg shadow-emerald-500/20'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            {mustPayAll
              ? `Surrender All Assets ($${totalAssetsValue}M)`
              : `Submit Payment ($${currentTotal}M)`}
          </button>
        </div>
      </div>
    </div>
  );
};
