import React, { useRef, useSyncExternalStore } from 'react';
import { MusicPlayerControls } from './MusicPlayerControls';
import * as sfx from '../utils/soundEngine';

export const GameSettings: React.FC<{ onLeaderboard: () => void; onReplay?: () => void }> = ({onLeaderboard,onReplay}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const muted = useSyncExternalStore(sfx.subscribeMute, sfx.isMuted, () => true);
  const close = () => { dialog.current?.close(); opener.current?.focus(); };
  return <>
    <button ref={opener} className="md-settings-trigger" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>Settings</button>
    <dialog ref={dialog} aria-labelledby="md-settings-title" className="md-game-settings" onClose={() => opener.current?.focus()} onClick={event => { if(event.target === event.currentTarget) close(); }}>
      <div className="flex justify-between items-center gap-4">
        <h2 id="md-settings-title" className="font-bold">Game settings</h2>
        <button autoFocus onClick={close} aria-label="Close settings">Close</button>
      </div>
      <button onClick={() => sfx.toggleMute()}>{muted ? 'Unmute Audio' : 'Mute Audio'}</button>
      <div><MusicPlayerControls compact /></div>
      <div id="md-rent-settings" aria-label="Rent animation settings" />
      <button onClick={() => { close(); onLeaderboard(); }}>Leaderboard</button>
      {onReplay && <button onClick={() => { close(); onReplay(); }}>Match replay</button>}
    </dialog>
  </>;
};
