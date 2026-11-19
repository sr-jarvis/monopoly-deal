import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MusicPlayerControls } from './MusicPlayerControls';
import * as sfx from '../utils/soundEngine';

import { socketService } from '../net/socket';

type MatchControl = { operation: 'end' | 'restart'; roomCode: string; matchId: string };

export const GameSettings: React.FC<{ onLeaderboard: () => void; onReplay?: () => void; hostMatch?: { roomCode: string; matchId: string } }> = ({onLeaderboard,onReplay,hostMatch}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const controlOpener = useRef<MatchControl['operation'] | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const pendingRef = useRef(false);
  const submittedRef = useRef(false);
  const mounted = useRef(true);
  const [confirmation, setConfirmation] = useState<MatchControl | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const canManage = !!hostMatch;
  const muted = useSyncExternalStore(sfx.subscribeMute, sfx.isMuted, () => true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (confirmation) cancelButton.current?.focus();
    else if (dialog.current?.open) {
      const frame = requestAnimationFrame(() => dialog.current?.querySelector<HTMLButtonElement>(`[data-match-control="${controlOpener.current}"]`)?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [confirmation]);
  const cancel = () => {
    if (pendingRef.current) return;
    setConfirmation(null);
    setError('');

  };
  const close = () => {
    if (pendingRef.current) return;
    setConfirmation(null); setError(''); dialog.current?.close(); opener.current?.focus();
  };
  const openConfirmation = (operation: MatchControl['operation']) => {
    if (pendingRef.current || !canManage || !hostMatch) return;
    controlOpener.current = operation;
    submittedRef.current = false;
    // Snapshot at OPEN: a later match must never be targeted by this confirmation.
    setConfirmation({ operation, ...hostMatch });
    setError('');
  };
  const confirm = () => {
    if (pendingRef.current || submittedRef.current || !confirmation || error) return;
    submittedRef.current = true;
    pendingRef.current = true; setPending(true);
    const socket = socketService.getSocket();
    const finish = (message: string) => {
      pendingRef.current = false;
      if (!mounted.current) return;
      setPending(false);
      if (message) { setError(message); socketService.emit('game:resync'); }
      else { setConfirmation(null); dialog.current?.close(); opener.current?.focus(); }
    };
    if (!socket.connected) { finish('Not connected. Nothing was sent. Close this confirmation and reconnect before trying again.'); return; }
    // volatile prevents a disconnected write being buffered and replayed later.
    socket.volatile.timeout(5000).emit('room:manage', confirmation, (failure: Error | null, response: unknown) => {
      if (failure) { finish('No confirmation received. The match may have changed. Sync requested; close this confirmation and check the room before another action.'); return; }
      if (typeof response !== 'object' || response === null || !('ok' in response) || typeof response.ok !== 'boolean') {
        finish('Unexpected response. The match may have changed. Sync requested; check the room before another action.'); return;
      }
      if (!response.ok) {
        const reason = 'reason' in response && typeof response.reason === 'string' ? response.reason : 'Match control rejected.';
        finish(`${reason} Close this confirmation and check the room.`); return;
      }
      finish('');
    });
  };
  return <>
    <button ref={opener} className="md-settings-trigger" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>Settings</button>
    <dialog ref={dialog} aria-labelledby="md-settings-title" className="md-game-settings" style={{ maxHeight: '90dvh', overflowY: 'auto', maxWidth: 'calc(100vw - 2rem)' }} onCancel={event => { event.preventDefault(); if (confirmation) cancel(); else close(); }} onClose={() => opener.current?.focus()} onClick={event => { if(event.target === event.currentTarget && !confirmation) close(); }}>
      <div className="flex justify-between items-center gap-4">
        <h2 id="md-settings-title" className="font-bold">Game settings</h2>
        <button autoFocus disabled={pending} onClick={close} aria-label="Close settings">Close</button>
      </div>
      {confirmation ? <section aria-labelledby="md-match-control-title" aria-describedby="md-match-control-effect" aria-busy={pending} className="space-y-3">
        <h3 id="md-match-control-title" className="font-bold">{confirmation.operation === 'end' ? 'End match?' : 'Restart match?'}</h3>
        <p id="md-match-control-effect">{confirmation.operation === 'end'
          ? 'This discards all current match progress without declaring a winner and returns everyone to the lobby. All seats stay in this room.'
          : 'This discards all current match progress and immediately shuffles and deals a new match for the same players in this room. This cannot be undone.'}</p>
        <button ref={cancelButton} disabled={pending} onClick={cancel}>Cancel</button>
        <button disabled={pending || !!error} onClick={confirm}>{confirmation.operation === 'end' ? 'Confirm end match' : 'Confirm restart match'}</button>
        {pending && <p role="status">Waiting for server confirmation…</p>}
        {error && <p role="alert">{error}</p>}
      </section> : <>
        <button onClick={() => sfx.toggleMute()}>{muted ? 'Unmute Audio' : 'Mute Audio'}</button>
        <div><MusicPlayerControls compact /></div>
        <div id="md-rent-settings" aria-label="Rent animation settings" />
        <button onClick={() => { close(); onLeaderboard(); }}>Leaderboard</button>
        {onReplay && <button onClick={() => { close(); onReplay(); }}>Match replay</button>}
        {canManage && <div className="flex flex-wrap gap-3" aria-label="Host match controls">
          <button data-match-control="end" onClick={() => openConfirmation('end')}>End match</button>
          <button data-match-control="restart" onClick={() => openConfirmation('restart')}>Restart match</button>
        </div>}
      </>}
    </dialog>
  </>;
};
