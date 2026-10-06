import React, { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { Card, PropertyColor } from '@monopoly-deal/shared';
import { CardBackView } from './CardBackView';
import { setActiveDragPayload, DRAG_MIME_TYPE } from '../utils/dragAndDropEngine';
import {
  isFlippableCard,
  getFlippedState,
  toggleCardFlip,
  attachFlipGestures,
  subscribeFlip,
  getOppositeColor
} from '../utils/touchCardFlipEngine';

export interface CardViewProps {
  card: Card;
  onClick?: () => void;
  onPreview?: () => void;
  selected?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  faceDown?: boolean;
  animation?: 'deal' | 'play' | 'flip' | null;
  dealIndex?: number;
  interactive3d?: boolean;
  onAnimationComplete?: (kind: 'deal' | 'play' | 'flip') => void;
  animationTarget?: { x: number; y: number };
  draggable?: boolean;
  sourceZone?: 'HAND' | 'BANK' | 'PROPERTY';
  index?: number;
  onDragStart?: (card: Card, index: number) => void;
  onDragEnd?: (card: Card) => void;
  onTouchStartCard?: (e: React.TouchEvent<HTMLDivElement>, card: Card, index: number, sourceZone: 'HAND' | 'BANK' | 'PROPERTY') => void;
  onTouchMoveCard?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchEndCard?: (e: React.TouchEvent<HTMLDivElement>) => void;
}

const COLOR_MAP: Record<PropertyColor, string> = {
  Brown: 'bg-amber-950 border-amber-700 text-amber-100',
  LightBlue: 'bg-sky-950 border-sky-500 text-sky-100',
  Purple: 'bg-purple-950 border-purple-500 text-purple-100',
  Orange: 'bg-orange-950 border-orange-500 text-orange-100',
  Red: 'bg-red-950 border-red-500 text-red-100',
  Yellow: 'bg-yellow-950 border-yellow-500 text-yellow-100',
  Green: 'bg-emerald-950 border-emerald-500 text-emerald-100',
  DarkBlue: 'bg-blue-950 border-blue-600 text-blue-100',
  Railroad: 'bg-slate-950 border-slate-600 text-slate-100',
  Utility: 'bg-slate-900 border-slate-500 text-slate-100',
  ALL: 'bg-gradient-to-br from-red-900 via-emerald-900 to-blue-900 text-white border-slate-400'
};

function resolveCardImage(card: Card): string | null {
  if (card.imageLocation) {
    return card.imageLocation.startsWith('/') ? card.imageLocation : `/${card.imageLocation}`;
  }
  if (card.imageUrl) {
    return card.imageUrl.startsWith('/') ? card.imageUrl : `/${card.imageUrl}`;
  }

  const cardName = card.title || card.name || '';
  if (!cardName) return null;

  const cleanName = cardName.replace(/\s+/g, '');
  const cardKind = card.kind || card.type;

  if (cardKind === 'PROPERTY') {
    return `/assets/imgs/property_cards/${cleanName}.png`;
  }
  if (cardKind === 'ACTION') {
    return `/assets/imgs/action_cards/${cleanName}.png`;
  }
  if (cardKind === 'MONEY') {
    return `/assets/imgs/money_cards/${cleanName}.png`;
  }
  if (cardKind === 'RENT') {
    return `/assets/imgs/rent_cards/${cleanName}.png`;
  }
  if (cardKind === 'WILDCARD') {
    return `/assets/imgs/wildcards/${cleanName}.png`;
  }
  return null;
}

export const CardView: React.FC<CardViewProps> = ({
  card,
  onClick,
  onPreview,
  selected,
  disabled,
  size = 'md',
  className = '',
  faceDown = false,
  animation = null,
  dealIndex = 0,
  interactive3d = true,
  onAnimationComplete,
  animationTarget,
  draggable = false,
  sourceZone = 'HAND',
  index = 0,
  onDragStart,
  onDragEnd,
  onTouchStartCard,
  onTouchMoveCard,
  onTouchEndCard
}) => {
  const [imgError, setImgError] = useState(false);
  const [isDraggingThis, setIsDraggingThis] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number>(0);

  const imgUrl = resolveCardImage(card);
  const cardTitle = card.title || card.name || 'Card';

  const sizeClasses = {
    sm: 'w-16 h-24 text-[10px]',
    md: 'w-24 h-36 text-xs',
    lg: 'w-32 h-48 text-sm'
  };

  const colorStyle = card.color ? COLOR_MAP[card.color] : 'bg-slate-800 border-slate-600 text-slate-200';

  const handleClick = () => {
    if (disabled) return;
    if (onClick) onClick();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  const handlePreviewClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!disabled && onPreview) {
      onPreview();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive3d || disabled || rafRef.current) return;
    const el = rootRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;

    rafRef.current = requestAnimationFrame(() => {
      if (el) {
        el.style.setProperty('--tilt-ry', `${(px - 0.5) * 16}deg`);
        el.style.setProperty('--tilt-rx', `${(py - 0.5) * -16}deg`);
        el.style.setProperty('--shine-x', `${px * 100}%`);
        el.style.setProperty('--shine-y', `${py * 100}%`);
      }
      rafRef.current = 0;
    });
  };

  const handlePointerLeave = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const el = rootRef.current;
    if (el) {
      el.style.setProperty('--tilt-rx', '0deg');
      el.style.setProperty('--tilt-ry', '0deg');
    }
  };

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const handleAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (!onAnimationComplete) return;
    const animName = e.animationName;
    if (animName === 'dealCard') {
      onAnimationComplete('deal');
    } else if (animName === 'playCard') {
      onAnimationComplete('play');
    } else if (animName === 'cardFlip') {
      onAnimationComplete('flip');
    }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    setIsDraggingThis(true);
    const payload = { card, sourceIndex: index, sourceZone };
    setActiveDragPayload(payload);
    try {
      e.dataTransfer.setData(DRAG_MIME_TYPE, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
    } catch {
      // Ignore dataTransfer serialization errors in older webviews
    }
    if (onDragStart) onDragStart(card, index);
  };

  const handleDragEnd = () => {
    setIsDraggingThis(false);
    setActiveDragPayload(null);
    if (onDragEnd) onDragEnd(card);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || !isDraggable) return;
    if (onTouchStartCard) {
      onTouchStartCard(e, card, index, sourceZone);
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || !isDraggable) return;
    if (onTouchMoveCard) {
      onTouchMoveCard(e);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (disabled || !isDraggable) return;
    if (onTouchEndCard) {
      onTouchEndCard(e);
    }
  };

  const animationClasses = {
    deal: 'md-card--dealing',
    play: 'md-card--playing',
    flip: 'md-card--flipping'
  };

  const currentAnimClass = animation ? animationClasses[animation] || '' : '';

  const targetStyle: React.CSSProperties = {
    '--deal-index': dealIndex
  } as React.CSSProperties;

  if (animationTarget) {
    (targetStyle as Record<string, string | number>)['--play-to-x'] = `${animationTarget.x}px`;
    (targetStyle as Record<string, string | number>)['--play-to-y'] = `${animationTarget.y}px`;
  }

  const isDraggable = draggable && !disabled;

  const isFlippable = isFlippableCard(card);
  const isFlipped = useSyncExternalStore(
    subscribeFlip,
    () => (card?.id ? getFlippedState(card.id) : false),
    () => false
  );

  useEffect(() => {
    if (!rootRef.current || !isFlippable || disabled) return;
    const cleanup = attachFlipGestures(rootRef.current, card);
    return () => {
      cleanup();
    };
  }, [card, isFlippable, disabled]);

  const activeColor = isFlippable && isFlipped ? (getOppositeColor(card, card.color) || card.color) : card.color;
  const activeColorStyle = activeColor ? COLOR_MAP[activeColor] : colorStyle;

  const handleFlipBadgeClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!disabled && isFlippable) {
      toggleCardFlip(card);
    }
  };

  return (
    <div
      ref={rootRef}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      aria-label={onClick ? `${cardTitle} card` : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onAnimationEnd={handleAnimationEnd}
      draggable={isDraggable}
      onDragStart={isDraggable ? handleDragStart : undefined}
      onDragEnd={isDraggable ? handleDragEnd : undefined}
      onTouchStart={isDraggable ? handleTouchStart : undefined}
      onTouchMove={isDraggable ? handleTouchMove : undefined}
      onTouchEnd={isDraggable ? handleTouchEnd : undefined}
      data-draggable-card={isDraggable ? 'true' : 'false'}
      data-flippable-card={isFlippable ? 'true' : 'false'}
      style={targetStyle}
      className={`
        md-card md-perspective md-card-flip-scene relative aspect-[2/3] rounded-xl border-2 shadow-md transition-all duration-200 select-none
        shrink-0
        ${sizeClasses[size]}
        ${activeColorStyle}
        ${currentAnimClass}
        ${
          disabled
            ? 'opacity-40 grayscale pointer-events-none'
            : isDraggable
            ? 'cursor-grab active:cursor-grabbing'
            : 'cursor-pointer'
        }
        ${
          isDraggingThis ? 'opacity-30 scale-95 md-card-dragging' : ''
        }
        ${
          selected
            ? 'ring-4 ring-sky-400 -translate-y-3 shadow-2xl z-30 scale-105'
            : !disabled
            ? 'hover:-translate-y-1.5 hover:shadow-xl hover:z-20'
            : ''
        }
        ${className}
      `}
    >
      {/* 3D Flipper Container */}
      <div className={`md-card__flipper md-card-flip-inner ${isFlipped ? 'is-flipped' : ''}`} data-face={faceDown ? 'back' : 'front'}>
        {/* Front Face */}
        <div className="md-card__face md-card-face md-card-face--front flex flex-col justify-between overflow-hidden bg-slate-900 rounded-lg">
          {imgUrl && !imgError ? (
            <img
              src={imgUrl}
              alt={cardTitle}
              onError={() => setImgError(true)}
              className="w-full h-full object-contain p-0.5 rounded-lg bg-slate-950"
            />
          ) : (
            <div className="p-2 flex flex-col h-full justify-between">
              {/* Top Value Banner */}
              <div className="flex justify-between items-center font-bold opacity-90">
                <span className="bg-black/60 px-1.5 py-0.5 rounded-full text-emerald-400 border border-emerald-500/30">
                  ${card.value}M
                </span>
                {activeColor && (
                  <span className="text-[10px] font-extrabold uppercase tracking-wider opacity-80">
                    {activeColor}
                  </span>
                )}
              </div>

              {/* Middle Title / Kind */}
              <div className="text-center my-auto">
                <div className="font-extrabold leading-tight tracking-tight drop-shadow-md">
                  {cardTitle}
                </div>
                {card.kind && (
                  <div className="text-[9px] font-mono text-slate-400 uppercase tracking-widest mt-0.5">
                    {card.kind}
                  </div>
                )}
              </div>

              {/* Bottom Card Footer */}
              <div className="text-[9px] text-center font-semibold opacity-75 uppercase tracking-wider">
                {card.colors ? `${card.colors.join(' / ')} Wildcard` : card.actionType || 'Standard'}
              </div>
            </div>
          )}
        </div>

        {/* Back Face */}
        <div className="md-card__face md-card-face md-card-face--back">
          {isFlippable ? (
            <div className="p-2 flex flex-col h-full justify-between bg-slate-950 rounded-lg text-slate-100 border border-amber-400/40">
              <div className="flex justify-between items-center font-bold">
                <span className="bg-black/80 px-1.5 py-0.5 rounded-full text-amber-300 border border-amber-400/40 text-[10px]">
                  FLIPPED
                </span>
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-200">
                  {activeColor}
                </span>
              </div>
              <div className="text-center my-auto">
                <div className="font-extrabold leading-tight text-amber-100">
                  {cardTitle}
                </div>
                <div className="text-[9px] font-mono text-amber-300/80 uppercase tracking-widest mt-0.5">
                  Secondary Color
                </div>
              </div>
              <div className="text-[9px] text-center font-semibold text-amber-400/90 uppercase">
                Tap / Double-tap to Flip
              </div>
            </div>
          ) : (
            <CardBackView size={size} aria-hidden />
          )}
        </div>
      </div>

      {/* Flip Badge Affordance */}
      {isFlippable && !disabled && (
        <button
          type="button"
          onClick={handleFlipBadgeClick}
          aria-label={`Flip card to ${getOppositeColor(card, activeColor)}`}
          title={`Flip card to ${getOppositeColor(card, activeColor)}`}
          className="md-card-flip-badge"
        >
          ⇄
        </button>
      )}

      {/* Preview Affordance */}
      {onPreview && !disabled && (
        <button
          type="button"
          onClick={handlePreviewClick}
          aria-label={`Preview ${cardTitle}`}
          title={`Preview ${cardTitle}`}
          className="absolute right-1 top-1 z-30 rounded-full border border-sky-300/70 bg-slate-950/85 px-1.5 py-0.5 text-[10px] font-black text-sky-100 shadow-lg hover:bg-sky-900 focus:outline-none focus:ring-2 focus:ring-sky-300"
        >
          🔍
        </button>
      )}

      {/* Specular Hover Shine Overlay */}
      <span className="md-card__shine" aria-hidden="true" />
    </div>
  );
};
