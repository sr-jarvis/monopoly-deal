import React from 'react';
import { HandSortMode } from '../utils/handSorter';

interface HandToolbarProps {
  cardCount: number;
  totalValue: number;
  maxHandSize?: number;
  sortMode: HandSortMode;
  onSortChange: (mode: HandSortMode) => void;
  showPlayableOnly: boolean;
  onTogglePlayableOnly: () => void;
  playableCount?: number;
}

export const HandToolbar: React.FC<HandToolbarProps> = ({
  cardCount,
  totalValue,
  maxHandSize = 7,
  sortMode,
  onSortChange,
  showPlayableOnly,
  onTogglePlayableOnly,
  playableCount
}) => {
  const isOverLimit = cardCount > maxHandSize;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/80 backdrop-blur border border-slate-700/80 px-3 py-2 rounded-xl shadow-inner text-xs font-medium">
      {/* Left: Hand Analytics Badges */}
      <div className="flex items-center gap-2">
        <span
          className={`px-2.5 py-1 rounded-lg border font-bold flex items-center gap-1 shadow-sm transition-all ${
            isOverLimit
              ? 'bg-rose-950/80 text-rose-300 border-rose-600/80 animate-pulse'
              : 'bg-slate-800 text-slate-200 border-slate-700'
          }`}
          title={isOverLimit ? `Hand exceeds ${maxHandSize} cards! Must discard before turn ends.` : 'Current hand card count'}
        >
          <span>🃏</span>
          <span>
            {cardCount} {isOverLimit ? `/ ${maxHandSize} (OVER LIMIT)` : 'Cards'}
          </span>
        </span>

        <span
          className="px-2.5 py-1 rounded-lg border bg-emerald-950/60 text-emerald-300 border-emerald-700/80 font-bold flex items-center gap-1 shadow-sm"
          title="Total cash & asset value of cards in hand"
        >
          <span>💵</span>
          <span>${totalValue}M Value</span>
        </span>
      </div>

      {/* Right: Sort & Filter Controls */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-slate-400 font-semibold text-[11px] uppercase tracking-wider hidden sm:inline mr-1">
          Sort:
        </span>

        {(
          [
            { mode: 'DEFAULT', label: 'Original' },
            { mode: 'TYPE', label: 'Type' },
            { mode: 'VALUE', label: 'Value' },
            { mode: 'COLOR', label: 'Color' }
          ] as const
        ).map(({ mode, label }) => {
          const isActive = sortMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onSortChange(mode)}
              className={`px-2.5 py-1 rounded-lg border transition-all text-xs font-semibold ${
                isActive
                  ? 'bg-blue-600 text-white border-blue-400 shadow-md shadow-blue-500/20'
                  : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {label}
            </button>
          );
        })}

        <div className="h-4 w-px bg-slate-700 mx-1 hidden sm:block" />

        <button
          type="button"
          onClick={onTogglePlayableOnly}
          title="Toggle playable card filter"
          className={`px-2.5 py-1 rounded-lg border transition-all text-xs font-semibold flex items-center gap-1.5 ${
            showPlayableOnly
              ? 'bg-amber-600 text-amber-50 border-amber-400 shadow-md shadow-amber-500/20 ring-1 ring-amber-400/50'
              : 'bg-slate-800/90 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
          }`}
        >
          <span>⚡</span>
          <span>
            Playable {typeof playableCount === 'number' ? `(${playableCount})` : ''}
          </span>
        </button>
      </div>
    </div>
  );
};
