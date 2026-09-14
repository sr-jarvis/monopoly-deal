import React, { useState } from 'react';
import { Card, PropertyColor } from '@monopoly-deal/shared';
import { CardView } from './CardView';

interface RearrangeWildcardModalProps {
  card: Card;
  currentColor: PropertyColor;
  onClose: () => void;
  onRearrange: (destinationColor: PropertyColor) => void;
}

const humanize = (color: string): string => color.replace(/([a-z])([A-Z])/g, '$1 $2');

export const RearrangeWildcardModal: React.FC<RearrangeWildcardModalProps> = ({
  card,
  currentColor,
  onClose,
  onRearrange
}) => {
  // A wildcard may only be reassigned to a color it is printed with; the
  // multi-colour "Property Wild Card" carries every real colour in `card.colors`.
  // Drop the colour it currently sits in and the non-colour 'ALL' sentinel — the
  // server rejects both anyway.
  const destinationColors: PropertyColor[] = (card.colors || []).filter(
    (color): color is PropertyColor => color !== 'ALL' && color !== currentColor
  );
  const [selected, setSelected] = useState<PropertyColor | ''>('');

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-6 animate-in fade-in zoom-in duration-150">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-black text-slate-100">Rearrange Wildcard</h2>
            <p className="text-xs text-slate-400">
              Move this wildcard out of your {humanize(currentColor)} set. Rearranging is a free
              action and doesn&apos;t use a play.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold px-2 py-0.5 rounded-lg bg-slate-700/50"
          >
            ✕
          </button>
        </div>

        <div className="flex justify-center">
          <CardView card={card} size="lg" />
        </div>

        <div>
          <label className="block text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">
            Move To Color
          </label>
          {destinationColors.length === 0 ? (
            <p className="text-xs text-slate-400">This wildcard has no other eligible color.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {destinationColors.map((col) => (
                <button
                  key={col}
                  onClick={() => setSelected(col)}
                  className={`p-2 rounded-lg text-xs font-bold border transition text-center ${
                    selected === col
                      ? 'bg-amber-600 border-amber-400 text-white shadow-lg'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  {humanize(col)}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          disabled={!selected}
          onClick={() => selected && onRearrange(selected)}
          className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl transition shadow-lg flex items-center justify-center gap-2"
        >
          ↔ Move Wildcard{selected ? ` to ${humanize(selected)}` : ''}
        </button>
      </div>
    </div>
  );
};
