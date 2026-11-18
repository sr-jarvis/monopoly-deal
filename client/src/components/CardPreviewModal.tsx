import React, { useEffect, useRef } from 'react';
import { Card } from '@monopoly-deal/shared';
import { CardView } from './CardView';

interface CardPreviewModalProps {
  card: Card;
  title?: string;
  onClose: () => void;
}

export const CardPreviewModal: React.FC<CardPreviewModalProps> = ({ card, title, onClose }) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const cardTitle = title || card.title || card.name || 'Card preview';

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[120] flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-preview-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-[min(92vw,30rem)] max-h-[90vh] overflow-y-auto rounded-2xl border border-sky-400/40 bg-slate-950 p-4 shadow-2xl shadow-sky-950/60">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="card-preview-title" className="text-lg font-black text-sky-100 leading-tight">
              {cardTitle}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Visible card preview. Opponent hidden hand cards are never available here.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-600 bg-slate-900 px-3 py-1 text-sm font-bold text-slate-100 hover:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-300"
            aria-label="Close card preview"
          >
            ✕
          </button>
        </div>

        <div className="flex justify-center py-2">
          <CardView card={card} size="lg" interactive3d={false} className="w-[min(68vw,16rem)] h-auto max-h-[72vh]" />
        </div>
      </div>
    </div>
  );
};

export default CardPreviewModal;
