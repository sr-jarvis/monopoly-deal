import React, { useState } from 'react';
import { Card, propertyGroupColor, nextPropertyGroupKey } from '@monopoly-deal/shared';
import { AtlasCardDialog } from './AtlasCardDialog';

interface RearrangeWildcardModalProps {
  card: Card;
  currentColor: string;
  properties?: Record<string, Card[]>;
  onClose: () => void;
  onRearrange: (destinationColor: string) => void;
}

const humanize = (color: string): string => color.replace(/([a-z])([A-Z])/g, '$1 $2');

export const RearrangeWildcardModal: React.FC<RearrangeWildcardModalProps> = ({
  card,
  currentColor,
  properties = {},
  onClose,
  onRearrange
}) => {
  // A wildcard may only be reassigned to a color it is printed with; the
  // multi-colour "Property Wild Card" carries every real colour in `card.colors`.
  // Drop the colour it currently sits in and the non-colour 'ALL' sentinel — the
  // server rejects both anyway.
  const destinationColors = [...new Set((card.colors || []).filter(color => color !== 'ALL').flatMap(color => [color, ...Object.keys(properties).filter(key => propertyGroupColor(key) === color), nextPropertyGroupKey(properties, color)]))].filter(key => key !== currentColor);
  const [selected, setSelected] = useState<string>('');

  return (
    <AtlasCardDialog card={card} title="Rearrange Wildcard" onClose={onClose}>
      <p className="text-sm">
        Move this wildcard out of your {humanize(currentColor)} set. Rearranging is a free
        action and doesn&apos;t use a play.
      </p>

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
                  aria-pressed={selected === col}
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
    </AtlasCardDialog>
  );
};
