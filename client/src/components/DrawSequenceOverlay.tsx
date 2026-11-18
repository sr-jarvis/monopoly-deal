import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { drawPresentation, DrawBatch } from '../utils/drawPresentation';
import { CardBackView } from './CardBackView';
import { CardView } from './CardView';

const Ghost: React.FC<{batch: DrawBatch; index: number; deck: DOMRect; hand: DOMRect}> = ({batch,index,deck,hand}) => {
  const mountedAt = useRef(Date.now()).current;
  const fromX = deck.left + deck.width / 2 - 32;
  const fromY = deck.top + deck.height / 2 - 48;
  return <div data-draw-event={batch.key} data-draw-recipient={batch.playerId} data-draw-face={batch.self ? 'self' : 'back'} className="md-exact-draw-card" style={{left:fromX,top:fromY,'--draw-x':`${hand.left + hand.width * (index+1)/(batch.count+1) - 32 - fromX}px`,'--draw-y':`${hand.top+hand.height/2-48-fromY}px`,animationDelay:`${batch.startAt+index*90-mountedAt}ms`} as React.CSSProperties}>
    {batch.self && batch.cards[index] ? <CardView card={batch.cards[index]} size="sm" interactive3d={false} /> : <CardBackView size="sm" />}
  </div>;
};
const ShuffleGhost: React.FC<{startAt:number;deck:DOMRect}> = ({startAt,deck}) => {
  const mountedAt=useRef(Date.now()).current;
  return <div className="md-match-shuffle" style={{left:deck.left+deck.width/2-32,top:deck.top+deck.height/2-48,animationDelay:`${startAt-mountedAt}ms`}}><CardBackView size="sm" /></div>;
};

/** One renderer for initial and subsequent draws. Absolute event timelines
 * survive rerenders. Read geometry after commit, including the first board mount. */
export const DrawSequenceOverlay: React.FC = () => {
  const plan = useSyncExternalStore(drawPresentation.subscribe, drawPresentation.getSnapshot, drawPresentation.getServerSnapshot);
  const [, tick] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [geometry,setGeometry] = useState<{deck:DOMRect;hands:Map<string,DOMRect>} | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const deck=document.querySelector('[data-deck-stack="true"]')?.getBoundingClientRect();
      const hands=new Map<string,DOMRect>();
      document.querySelectorAll<HTMLElement>('[data-draw-hand]').forEach(el=>hands.set(el.dataset.drawHand!,el.getBoundingClientRect()));
      setGeometry(deck ? {deck,hands} : null);
    };
    measure(); window.addEventListener('resize',measure); window.addEventListener('scroll',measure,true);
    return () => {window.removeEventListener('resize',measure);window.removeEventListener('scroll',measure,true);};
  }, [plan]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const end = Math.max(plan.shuffleAt === null ? 0 : plan.shuffleAt + 700, ...plan.batches.map(b => b.endAt));
    if (end <= Date.now()) return;
    const timer = window.setTimeout(() => tick(n => n + 1), end - Date.now() + 20);
    return () => clearTimeout(timer);
  }, [plan]);
  if (typeof document === 'undefined' || reduced || !geometry) return null;
  const now = Date.now();
  return createPortal(<div className="md-draw-sequence" aria-hidden="true" ref={node => { if (node) node.inert = true; }}>
    {plan.shuffleAt !== null && plan.shuffleAt + 700 > now && <ShuffleGhost key={`shuffle:${plan.shuffleAt}`} startAt={plan.shuffleAt} deck={geometry.deck} />}
    {plan.batches.filter(b => b.endAt > now).flatMap(batch => {
      const hand = geometry.hands.get(batch.playerId);
      if (!hand) return [];
      return Array.from({length:batch.count},(_,i) => <Ghost key={`${batch.key}:${i}`} batch={batch} index={i} deck={geometry.deck} hand={hand} />);
    })}
  </div>,document.body);
};
