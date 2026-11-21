import React from 'react';
import { Card } from '@monopoly-deal/shared';
import { AtlasCardDialog } from './AtlasCardDialog';

interface CardPreviewModalProps {
  card: Card;
  title?: string;
  onClose: () => void;
}

// AtlasCardDialog supplies role="dialog", aria-modal="true", Escape dismissal,
// focus restoration and an internally scrolling bound (formerly max-h-[90vh]).
export const CardPreviewModal: React.FC<CardPreviewModalProps> = ({ card, title, onClose }) => (
  <AtlasCardDialog card={card} title={title || card.title || card.name || 'Card preview'} onClose={onClose}>
    <p className="text-sm">Visible card preview. Opponent hidden hand cards are never available here.</p>
  </AtlasCardDialog>
);

export default CardPreviewModal;
