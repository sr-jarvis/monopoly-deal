import React from 'react';

export interface CardBackViewProps {
  size?: 'sm' | 'md' | 'lg';
  count?: number;
  className?: string;
  'aria-hidden'?: boolean;
}

export const CardBackView: React.FC<CardBackViewProps> = React.memo(({
  size = 'md',
  count,
  className = '',
  'aria-hidden': ariaHidden
}) => {
  const sizeClasses = {
    sm: 'w-16 h-24 text-xs',
    md: 'w-24 h-36 text-sm',
    lg: 'w-32 h-48 text-base'
  };

  const isDecorative = ariaHidden ?? false;

  return (
    <div
      role={isDecorative ? undefined : 'img'}
      aria-label={isDecorative ? undefined : (count !== undefined ? `${count} cards in hand` : 'Face-down card')}
      aria-hidden={isDecorative ? true : undefined}
      className={`
        relative aspect-[2/3] rounded-xl border-2 border-amber-500/40 shadow-xl
        select-none overflow-hidden flex flex-col items-center justify-between p-2
        md-card-back-metallic shrink-0
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {/* Outer Golden Inset Border */}
      <div className="absolute inset-1 rounded-lg border border-amber-400/30 pointer-events-none flex items-center justify-center">
        {/* Monogram Badge */}
        <div className="w-10 h-10 rounded-full bg-slate-950/80 border-2 border-amber-400/60 shadow-lg flex items-center justify-center">
          <span className="font-extrabold text-amber-300 tracking-tighter drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] text-xs">
            MD
          </span>
        </div>
      </div>

      {/* Top Banner Accent */}
      <div className="w-full flex justify-between items-center z-10 opacity-75">
        <div className="w-2 h-2 rounded-full bg-amber-400/60"></div>
        <div className="text-[9px] font-extrabold tracking-widest uppercase text-amber-200/80">
          DEAL
        </div>
        <div className="w-2 h-2 rounded-full bg-amber-400/60"></div>
      </div>

      {/* Center Count Badge (if specified) */}
      {count !== undefined && (
        <div className="z-10 bg-slate-950/90 border border-amber-400/80 px-2.5 py-0.5 rounded-full shadow-2xl">
          <span className="font-black text-amber-300 text-xs">
            {count}
          </span>
        </div>
      )}

      {/* Bottom Footer Accent */}
      <div className="w-full text-center z-10 opacity-75 text-[8px] font-mono tracking-widest text-amber-300/60 uppercase">
        MONOPOLY
      </div>
    </div>
  );
});

CardBackView.displayName = 'CardBackView';
