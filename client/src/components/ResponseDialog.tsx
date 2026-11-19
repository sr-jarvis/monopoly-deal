import React, { useEffect, useRef } from 'react';
import { Card, PendingActionResponse } from '@monopoly-deal/shared';

interface Props {
  settings?: React.ReactNode;
  response: PendingActionResponse;
  selfId: string;
  hand: Card[];
  onAccept: () => void;
  onCounter: (cardId: string) => void;
}

/** Only the nominated responder acts; all other seats see a waiting status. */
export const ResponseDialog: React.FC<Props> = ({ response, selfId, hand, onAccept, onCounter, settings }) => {
  const acceptRef = useRef<HTMLButtonElement>(null);
  const canRespond = response.eligibleResponderIds.includes(selfId);
  useEffect(() => { if (canRespond) acceptRef.current?.focus(); }, [canRespond, response.responseCount]);
  if (!canRespond) return (
    <div role="status" className="border border-amber-500 rounded-xl p-3 bg-amber-950 text-amber-100">
      Waiting for a response to {response.sourceTitle}. {response.cancelled ? 'The action is currently cancelled; a counter may restore it.' : 'The action has not resolved yet.'}
    </div>
  );
  const counters = hand.filter(card => card.kind === 'ACTION' && card.title === 'Just Say No');
  return (
    <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4">
      <section onKeyDown={event => {
        // Native Settings owns keyboard containment while its top-layer dialog
        // is open. Do not pull focus back into the underlying response.
        if (event.key !== 'Tab' || (event.target instanceof HTMLElement && event.target.closest('dialog[open]'))) return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.getClientRects().length > 0);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }} role="dialog" aria-modal="true" aria-labelledby="response-title" className="bg-slate-800 border border-amber-500 rounded-2xl p-6 max-w-md space-y-4">
        {settings}
        <h2 id="response-title" className="text-xl font-bold">Respond to {response.sourceTitle}</h2>
        <p>{response.cancelled ? 'Just Say No cancelled this action. Counter it to restore the action, or pass to confirm cancellation.' : 'Accept this action, or play a held Just Say No to cancel it. The other player may counter.'}</p>
        <p className="text-sm text-slate-300">Responses do not use any of your three plays. Targeted properties stay in place and payments wait until this response is resolved.</p>
        <button ref={acceptRef} onClick={onAccept} className="w-full rounded-lg p-3 bg-emerald-700 font-bold">{response.cancelled ? 'Pass — keep cancellation' : 'Accept action'}</button>
        {counters.map(card => <button key={card.id} onClick={() => onCounter(card.id)} className="w-full rounded-lg p-3 bg-rose-700 font-bold">Play Just Say No (${card.value}M card)</button>)}
        {!counters.length && <p className="text-sm text-slate-400">You have no Just Say No in hand.</p>}
      </section>
    </div>
  );
};
