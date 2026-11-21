import React, { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../store/useGameStore';
import { CardView } from './CardView';
import { completedColorCount } from '../utils/publicTable';
import { AtlasHandPanel } from './AtlasHandPanel';
import { PropertyGroupView } from './PropertyGroupView';
import { ActionChoiceModal } from './ActionChoiceModal';
import { RearrangeWildcardModal } from './RearrangeWildcardModal';
import { CardPreviewModal } from './CardPreviewModal';
import { PaymentModal } from './PaymentModal';
import { ResponseDialog } from './ResponseDialog';
import { DiscardModal } from './DiscardModal';
import { WinModal } from './WinModal';
import { LeaderboardModal } from './LeaderboardModal';
import { ReplayViewerModal } from './ReplayViewerModal';
import { CardPlayFlightOverlay } from './CardPlayFlightOverlay';
import { ActionTargetFlightOverlay } from './ActionTargetFlightOverlay';
import { CardDiscardFlightOverlay } from './CardDiscardFlightOverlay';
import { JustSayNoFlightOverlay } from './JustSayNoFlightOverlay';
import { RentPaymentFlightOverlay } from './RentPaymentFlightOverlay';
import { DrawSequenceOverlay } from './DrawSequenceOverlay';
import { launchActionTargetFlight, kindFromActionCard, SeatPosition } from '../utils/actionTargetFlightEngine';
import { GameSettings } from './GameSettings';
import { EventFeed } from './EventFeed';
import { DeckStackView } from './DeckStackView';
import { socketService } from '../net/socket';
import { Card, PropertyColor } from '@monopoly-deal/shared';
import * as sfx from '../utils/soundEngine';
import {
  HandSortMode,
  getStoredSortMode,
  setStoredSortMode,
  calculateTotalHandValue,
  sortCards
} from '../utils/handSorter';
import { getActiveDragPayload, isDropEligible, DRAG_EVENTS, DragCardPayload, DropZoneTarget } from '../utils/dragAndDropEngine';
import { handleTouchStart, handleTouchMove, handleTouchEnd } from '../utils/touchDragEngine';

export const GameBoardView: React.FC = () => {
  const { gameState, roomState, roomCode, events, gameOver, resetMatch, displayName } = useGameStore();
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [previewCard, setPreviewCard] = useState<Card | null>(null);
  const [rearrangeTarget, setRearrangeTarget] = useState<{ card: Card; color: string } | null>(null);
  const [sortMode, setSortMode] = useState<HandSortMode>(getStoredSortMode);
  const [showPlayableOnly, setShowPlayableOnly] = useState<boolean>(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showReplay, setShowReplay] = useState(false);

  const [panel, setPanel] = useState<'hand' | 'players' | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const tableRef = useRef<HTMLElement>(null);
  const bottomRef = useRef<HTMLElement>(null);
  const previousPanel = useRef<typeof panel>(null);
  useEffect(() => {
    const viewport = typeof document === 'undefined' ? null : document.querySelector('meta[name="viewport"]');
    viewport?.setAttribute('content', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
  }, []);
  useEffect(() => {
    if (!activeCard && !previewCard && !rearrangeTarget) return;
    const closeCard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (previewCard) setPreviewCard(null);
      else if (activeCard) setActiveCard(null);
      else setRearrangeTarget(null);
    };
    document.addEventListener('keydown', closeCard, true);
    return () => document.removeEventListener('keydown', closeCard, true);
  }, [activeCard, previewCard, rearrangeTarget]);
  useEffect(() => {
    if (tableRef.current) tableRef.current.inert = !!panel;
    if (bottomRef.current) bottomRef.current.inert = !!panel;
    if (!panel && previousPanel.current) {
      const selector = previousPanel.current === 'hand' ? '.atlas-primary' : '.atlas-table-nav button';
      document.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
    }
    previousPanel.current = panel;
  }, [panel]);

  // Drag & Drop Highlight States
  const [isBankDragOver, setIsBankDragOver] = useState(false);
  const [isActionDragOver, setIsActionDragOver] = useState(false);

  useEffect(() => {
    setActiveCard(null);
    setPreviewCard(null);
    setPanel(null);
    setSelectedPlayerId(null);
    setRearrangeTarget(null);
    setShowReplay(false);
    setIsBankDragOver(false);
    setIsActionDragOver(false);
  }, [gameState?.matchId]);

  useEffect(() => {
    if (!gameState || !activeCard) return;
    if (gameState.currentTurnPlayerId !== gameState.self.id || gameState.turnPhase !== 'ACTION' ||
        gameState.pendingActionResolution || gameState.pendingCharge || gameOver ||
        gameState.actionCountRemaining <= 0 || !gameState.self.hand.some(card => card.id === activeCard.id)) {
      setActiveCard(null);
    }
  }, [gameState, activeCard, gameOver]);

  const mandatoryGameplay = !!gameState && (!!gameOver ||
    !!gameState.pendingActionResolution?.eligibleResponderIds.includes(gameState.self.id) ||
    gameState.pendingResolution?.targetPlayerId === gameState.self.id ||
    (gameState.currentTurnPlayerId === gameState.self.id && gameState.turnPhase === 'DISCARD'));
  useEffect(() => {
    if (!mandatoryGameplay) return;
    setPreviewCard(null); setActiveCard(null); setRearrangeTarget(null); setPanel(null);
  }, [mandatoryGameplay]);

  if (!gameState) return null;

  const handleSortChange = (mode: HandSortMode) => {
    setSortMode(mode);
    setStoredSortMode(mode);
  };

  const handleTogglePlayableOnly = () => {
    setShowPlayableOnly((prev) => !prev);
  };

  const isMyTurn = gameState.currentTurnPlayerId === gameState.self.id;
  const isDrawPhase = isMyTurn && gameState.turnPhase === 'DRAW';
  const isDiscardPhase = isMyTurn && gameState.turnPhase === 'DISCARD';
  const pendingResponse = gameState.pendingActionResolution;
  const pendingCharge = gameState.pendingCharge;
  const selfOwesPayment =
    gameState.pendingResolution?.targetPlayerId === gameState.self.id;
  const waitingForPayment = !!pendingResponse || (!!pendingCharge && !selfOwesPayment);
  const waitingDebtors = pendingCharge?.debtors
    .map(({ playerId, amountOwed }) => {
      const player = gameState.opponents.find((opponent) => opponent.id === playerId);
      return `${player?.displayName || playerId} ($${amountOwed}M)`;
    })
    .join(', ');
  const waitingForPaymentMessage = pendingResponse ? `Waiting for response to ${pendingResponse.sourceTitle}.` : pendingCharge
    ? `Waiting for ${waitingDebtors} to pay ${pendingCharge.sourceTitle}.`
    : '';

  const canRearrange = !pendingCharge && !pendingResponse && !gameOver && isMyTurn && ['DRAW', 'ACTION', 'DISCARD'].includes(gameState.turnPhase || '');
  const canPlay = isMyTurn && !isDrawPhase && !isDiscardPhase && !waitingForPayment && !selfOwesPayment && !gameOver && gameState.actionCountRemaining > 0;

  const handleCardClick = (card: Card) => {
    if (!isMyTurn || isDrawPhase || isDiscardPhase || waitingForPayment || selfOwesPayment || gameOver || gameState.actionCountRemaining <= 0) return;
    setActiveCard(card);
  };

  const handlePreviewCard = (card: Card) => {
    setPreviewCard(card);
  };

  // opponent public property cards are previewable; opponent hidden hand counts stay redacted and are never passed here.
  const handleOpponentPublicPreviewCard = (card: Card) => {
    handlePreviewCard(card);
  };

  const handleSelfPropertyCardClick = (color: string) => (card: Card) => {
    if (!canRearrange) return;
    if ((card.kind || card.type) !== 'WILDCARD') return;
    setRearrangeTarget({ card, color });
  };

  const handleRearrange = (destinationColor: string) => {
    if (!rearrangeTarget) return;
    socketService.emit('game:action', {
      type: 'REARRANGE',
      cardId: rearrangeTarget.card.id,
      propertyColor: destinationColor
    });
    setRearrangeTarget(null);
  };

  const handleExecutePlay = (options: {
    targetZone: 'bank' | 'properties' | 'action';
    propertyColor?: string;
    targetPlayerId?: string;
    targetPropertyColor?: string;
    targetCardId?: string;
    offeredCardId?: string;
    offeredPropertyColor?: string;
    requestedCardId?: string;
    requestedPropertyColor?: string;
    doubleRentCardId?: string;
    doubleRentCardIds?: string[];
  }) => {
    if (!activeCard || waitingForPayment || selfOwesPayment || gameOver || gameState.actionCountRemaining <= 0) return;

    socketService.emit('game:action', {
      type: options.targetZone === 'action' ? 'PLAY_ACTION_CARD' : 'PLAY_CARD',
      cardId: activeCard.id,
      targetZone: options.targetZone,
      propertyColor: options.propertyColor,
      targetPlayerId: options.targetPlayerId,
      targetPropertyColor: options.targetPropertyColor,
      targetCardId: options.targetCardId,
      offeredCardId: options.offeredCardId,
      offeredPropertyColor: options.offeredPropertyColor,
      requestedCardId: options.requestedCardId,
      requestedPropertyColor: options.requestedPropertyColor,
      doubleRentCardId: options.doubleRentCardId,
      doubleRentCardIds: options.doubleRentCardIds
    });

    sfx.playCardPlay();
    setActiveCard(null);
  };

  const processPayloadDropToBank = (payload: DragCardPayload) => {
    setIsBankDragOver(false);
    if (!payload || waitingForPayment) return;

    const eligible = isDropEligible(
      payload,
      { kind: 'BANK' },
      {
        isMyTurn,
        playsMade: 3 - gameState.actionCountRemaining,
        turnPhase: gameState.turnPhase || 'ACTION',
        waitingForPayment,
        selfOwesPayment
      }
    );

    if (eligible) {
      socketService.emit('game:action', {
        type: 'PLAY_CARD',
        cardId: payload.card.id,
        targetZone: 'bank'
      });
      sfx.playCardPlay();
    }
  };

  const handleDropToBank = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const payload = getActiveDragPayload();
    if (payload) processPayloadDropToBank(payload);
  };

  const processPayloadDropToCenterAction = (payload: DragCardPayload) => {
    setIsActionDragOver(false);
    if (!payload || waitingForPayment) return;

    const eligible = isDropEligible(
      payload,
      { kind: 'ACTION' },
      {
        isMyTurn,
        playsMade: 3 - gameState.actionCountRemaining,
        turnPhase: gameState.turnPhase || 'ACTION',
        waitingForPayment,
        selfOwesPayment
      }
    );

    if (eligible) {
      setActiveCard(payload.card);
      sfx.playCardPlay();
    }
  };

  const handleDropToCenterAction = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const payload = getActiveDragPayload();
    if (payload) processPayloadDropToCenterAction(payload);
  };

  const handleDropPropertyCard = (card: Card, targetColor: string) => {
    if (waitingForPayment || selfOwesPayment || gameOver || !isMyTurn || gameState.turnPhase !== 'ACTION' || gameState.actionCountRemaining <= 0) return;

    socketService.emit('game:action', {
      type: 'PLAY_CARD',
      cardId: card.id,
      targetZone: 'properties',
      propertyColor: targetColor
    });
    sfx.playCardPlay();
  };

  useEffect(() => {
    const handleCustomTouchDrop = (e: Event) => {
      const customEvent = e as CustomEvent<{ payload: DragCardPayload; target: DropZoneTarget }>;
      if (!customEvent.detail) return;
      const { payload, target } = customEvent.detail;
      if (target.kind === 'BANK') {
        processPayloadDropToBank(payload);
      } else if (target.kind === 'ACTION') {
        processPayloadDropToCenterAction(payload);
      } else if (target.kind === 'PROPERTY' && target.targetColor) {
        handleDropPropertyCard(payload.card, target.targetColor);
      }
    };

    window.addEventListener(DRAG_EVENTS.DROP, handleCustomTouchDrop);
    return () => {
      window.removeEventListener(DRAG_EVENTS.DROP, handleCustomTouchDrop);
    };
  }, [isMyTurn, gameState.actionCountRemaining, gameState.turnPhase, waitingForPayment, selfOwesPayment]);

  const launchTargetedActionFlight = (actionName: string, cardId: string, targets: Array<{ playerId: string; seat?: string }>) => {
    const kind = kindFromActionCard(actionName);
    if (!kind) return;
    const sourceEl = typeof document !== 'undefined' ? document.querySelector(`[data-hand-card-id="${cardId}"]`) : null;
    if (!sourceEl) return;
    const r = sourceEl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const sourceRect = { left: r.left, top: r.top, width: r.width, height: r.height };

    const flightTargets = targets.map((t) => {
      const seatEl = typeof document !== 'undefined' ? document.querySelector(`[data-seat-player-id="${t.playerId}"]`) : null;
      const seatR = seatEl ? seatEl.getBoundingClientRect() : null;
      const seatRect = seatR && seatR.width > 0 ? { left: seatR.left, top: seatR.top, width: seatR.width, height: seatR.height } : null;

      const propEl = typeof document !== 'undefined' ? document.querySelector(`[data-property-set^="${t.playerId}:"]`) : null;
      const propR = propEl ? propEl.getBoundingClientRect() : null;
      const propertySetRect = propR && propR.width > 0 ? { left: propR.left, top: propR.top, width: propR.width, height: propR.height } : null;

      const bankEl = typeof document !== 'undefined' ? document.querySelector(`[data-bank-stack="${t.playerId}"]`) : null;
      const bankR = bankEl ? bankEl.getBoundingClientRect() : null;
      const bankRect = bankR && bankR.width > 0 ? { left: bankR.left, top: bankR.top, width: bankR.width, height: bankR.height } : null;

      return {
        playerId: t.playerId,
        seat: (t.seat as SeatPosition) || 'center',
        propertySetRect,
        bankRect,
        seatRect,
      };
    });

    launchActionTargetFlight({
      kind,
      cardId,
      label: actionName,
      sourceRect,
      targets: flightTargets,
    });
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleTrigger = (e: Event) => {
      const customEvent = e as CustomEvent<{ actionName: string; cardId: string; targets: Array<{ playerId: string; seat?: SeatPosition }> }>;
      if (customEvent.detail) {
        launchTargetedActionFlight(customEvent.detail.actionName, customEvent.detail.cardId, customEvent.detail.targets);
      }
    };
    window.addEventListener('md:actiontargetflight:trigger', handleTrigger);
    return () => {
      window.removeEventListener('md:actiontargetflight:trigger', handleTrigger);
    };
  }, []);

  const handleEndTurn = () => {
    if (!isMyTurn || isDiscardPhase || waitingForPayment) return;
    socketService.emit('game:action', { type: 'END_TURN' });
  };

  const handleDiscard = (cardIds: string[]) => {
    if (!isDiscardPhase || waitingForPayment) return;
    for (const cardId of cardIds) socketService.emit('game:action', { type: 'DISCARD', cardId });
  };

  const rawHand = gameState.self.hand || [];
  const sortedHand = sortCards(rawHand, sortMode);
  const displayedHand = showPlayableOnly
    ? sortedHand.filter(() => canPlay)
    : sortedHand;

  const totalHandValue = calculateTotalHandValue(rawHand);
  const selfBankTotal = gameState.self.bank.reduce((sum, c) => sum + (c.value || 0), 0);
  const playableCount = canPlay ? rawHand.length : 0;

  const hostMatch = gameState.matchId && roomState && roomState.roomCode === gameState.roomCode && roomState.hostPlayerId === gameState.self.id && ['IN_PROGRESS', 'FINISHED'].includes(roomState.status)
    ? { roomCode: gameState.roomCode, matchId: gameState.matchId } : undefined;
  const settingsDialog = pendingResponse?.eligibleResponderIds.includes(gameState.self.id) ? 'response'
    : gameOver ? 'win' : isDiscardPhase ? 'discard' : selfOwesPayment && !pendingResponse ? 'payment' : null;
  const publicPlayers = [{ ...gameState.self, displayName: displayName || 'You', isBot: false, handCount: rawHand.length }, ...gameState.opponents];
  const selectedPlayer = publicPlayers.find(player => player.id === selectedPlayerId) || publicPlayers[0];
  const turnLabel = isMyTurn ? 'Your turn' : `${gameState.opponents.find(player => player.id === gameState.currentTurnPlayerId)?.displayName || 'Opponent'}’s turn`;
  const settings = <GameSettings onLeaderboard={() => setShowLeaderboard(true)} onReplay={gameOver ? () => setShowReplay(true) : undefined} hostMatch={hostMatch} />;

  return (
    <div className="atlas-app">
      <header className="atlas-brand">
        <div><small>MONOPOLY DEAL · {roomCode}</small><h1>Pocket <span>Atlas</span></h1></div>
        {!(hostMatch && settingsDialog) && settings}
      </header>
      <div role="status" aria-label="Turn status" className="atlas-turn">
        <span className="atlas-turn-dot" aria-hidden="true" />
        <strong>{turnLabel}</strong>
        <span className="atlas-actions">{gameState.actionCountRemaining} / 3 actions left</span>
      </div>
      <main ref={tableRef} className="atlas-workspace" aria-label="Public table">
        <div className="atlas-table-nav"><span className="atlas-eyebrow">THE TABLE</span>
          <button type="button" onClick={() => setPanel('players')} aria-expanded={panel === 'players'} aria-haspopup="dialog">Players · {publicPlayers.length} / {selectedPlayer.id === gameState.self.id ? 'You' : selectedPlayer.displayName}</button>
        </div>
        <h2 className="atlas-table-heading">{selectedPlayer.id === gameState.self.id ? 'Your public table' : `${selectedPlayer.displayName}’s public table`}</h2>
        {/* All seats remain measurable even while another public table is selected. */}
        <div className="atlas-seat-rail" aria-label="Public player summaries">
          {publicPlayers.map(player => <div key={player.id} data-seat-id={player.id} data-seat-player-id={player.id} className={`atlas-seat ${selectedPlayer.id === player.id ? 'atlas-seat-selected' : ''}`}>
            <strong>{player.id === gameState.self.id ? 'You' : player.displayName}{player.isBot ? ' · Bot' : ''}</strong>
            <span data-draw-hand={player.id}>{player.id === gameState.self.id ? rawHand.length : 'handCount' in player ? player.handCount : 0} {player.id === gameState.self.id ? 'in hand' : 'hidden cards'}</span>
            <span data-bank-stack={player.id}>{player.bank.reduce((sum, card) => sum + (card.value || 0), 0)}M bank</span>
            <span>{completedColorCount(player)} / 3 sets{gameState.currentTurnPlayerId === player.id ? ' · Playing' : ''}</span>
            {Object.keys(player.properties).map(color => <span key={color} className="atlas-geometry-anchor" data-property-set={selectedPlayer.id !== player.id ? `${player.id}:${color}` : undefined} aria-hidden="true" />)}
          </div>)}
        </div>
        <div className="atlas-summary">
          <div><b>{completedColorCount(selectedPlayer)} / 3</b><small>complete sets</small></div>
          <div><b>{selectedPlayer.bank.reduce((sum, card) => sum + (card.value || 0), 0)}M</b><small>bank · {selectedPlayer.bank.length} cards</small></div>
          <div><b>{selectedPlayer.id === gameState.self.id ? rawHand.length : 'handCount' in selectedPlayer ? selectedPlayer.handCount : 0}</b><small>{selectedPlayer.id === gameState.self.id ? 'your hand' : 'hidden hand'}</small></div>
        </div>
        <div className="atlas-groups">
          {Object.entries(selectedPlayer.properties).map(([color, cards]) =>
            cards && (cards.length > 0 || selectedPlayer.buildings?.[color as PropertyColor]?.houseCard || selectedPlayer.buildings?.[color as PropertyColor]?.hotelCard) ?
              <div key={`${selectedPlayer.id}:${color}`} data-property-set={`${selectedPlayer.id}:${color}`}>
                <PropertyGroupView color={color} cards={cards}
                  blocked={selectedPlayer.id !== gameState.self.id || waitingForPayment || selfOwesPayment || !!gameOver}
                  houseCard={selectedPlayer.buildings?.[color as PropertyColor]?.houseCard}
                  hotelCard={selectedPlayer.buildings?.[color as PropertyColor]?.hotelCard}
                  hasHouse={selectedPlayer.buildings?.[color as PropertyColor]?.house}
                  hasHotel={selectedPlayer.buildings?.[color as PropertyColor]?.hotel}
                  isCompleteSet={(selectedPlayer.completedSetGroups || selectedPlayer.completedSetColors)?.includes(color)}
                  onPreviewCard={selectedPlayer.id === gameState.self.id ? handlePreviewCard : handleOpponentPublicPreviewCard}
                  onCardClick={selectedPlayer.id === gameState.self.id && canRearrange ? handleSelfPropertyCardClick(color) : undefined}
                  selectedCardId={rearrangeTarget?.card.id}
                  onDropCard={selectedPlayer.id === gameState.self.id ? handleDropPropertyCard : undefined}
                  isMyTurn={selectedPlayer.id === gameState.self.id && isMyTurn}
                  turnPhase={gameState.turnPhase} playsMade={3 - gameState.actionCountRemaining} />
              </div> : null)}
        </div>
        {!Object.values(selectedPlayer.properties).some(cards => cards && cards.length > 0) && <div className="atlas-empty">A little room to build.<small>Played properties will appear here.</small></div>}
        <section className="atlas-bank"><div className="atlas-section-heading"><h3>Bank</h3><small>Public cards · tap to inspect</small></div>
          <div className="atlas-bank-cards">{selectedPlayer.bank.map(card => <button key={card.id} onClick={() => handlePreviewCard(card)} aria-label={`Preview bank card ${card.title || card.name || card.kind}, ${card.value}M`}>{card.value}M</button>)}
            {selectedPlayer.bank.length === 0 && <p>No cards banked yet.</p>}</div>
        </section>
        <section className="atlas-deck-details" aria-label="Deck and discard"><h3>Deck &amp; discard</h3>
          <div
            data-drop-zone="ACTION"
            onDragOver={(e) => {
              e.preventDefault();
              const payload = getActiveDragPayload();
              if (
                payload &&
                isDropEligible(
                  payload,
                  { kind: 'ACTION' },
                  {
                    isMyTurn,
                    playsMade: 3 - gameState.actionCountRemaining,
                    turnPhase: gameState.turnPhase || 'ACTION',
                    waitingForPayment,
                    selfOwesPayment
                  }
                )
              ) {
                e.dataTransfer.dropEffect = 'move';
                setIsActionDragOver(true);
              }
            }}
            onDragLeave={() => setIsActionDragOver(false)}
            onDrop={handleDropToCenterAction}
            className={`flex items-center gap-3 sm:gap-6 shrink-0 p-1 sm:p-3 rounded-xl border transition-all duration-200 ${
              isActionDragOver
                ? 'border-amber-400 ring-2 ring-amber-400/60 bg-amber-950/40 scale-105 z-30'
                : 'border-transparent'
            }`}
          >
            <DeckStackView
              remaining={gameState.drawPileCount}
              isDrawPhase={isDrawPhase}
              canDraw={false}
              onDraw={() => { /* Server draws automatically. */ }}
            />
            <div className="text-center" data-discard-pile="true">
              <div className="w-24 h-36 bg-slate-900 border-2 border-dashed border-slate-700 rounded-xl flex flex-col items-center justify-center text-slate-500 font-bold p-2 shadow-inner">
                <span className="text-[10px] uppercase text-slate-600 tracking-wider">Discard / Action</span>
                <span className="text-xl text-slate-400 font-extrabold mt-1">{gameState.discardPileCount}</span>
                <span className="text-[9px] font-mono text-amber-400/80 mt-2">Drop Action</span>
              </div>
            </div>
          </div>

        </section>
        <div className="atlas-log"><EventFeed events={events} /></div>
      </main>
      <footer className="atlas-bottom" ref={bottomRef}>
        <p role="status">{waitingForPayment ? waitingForPaymentMessage : selfOwesPayment ? 'Choose public assets to settle your payment.' : gameOver ? 'Match complete.' : isDiscardPhase ? 'Discard down to seven cards.' : isDrawPhase ? 'Drawing cards automatically…' : isMyTurn ? 'Your turn. Choose a card; nothing plays until you confirm.' : `${turnLabel}. You can inspect any public card.`}</p>
        <div className="atlas-bottom-controls">
          <button type="button" className="atlas-primary" aria-haspopup="dialog" aria-expanded={panel === 'hand'} onClick={() => setPanel('hand')}>My Hand · {rawHand.length}</button>
          {isMyTurn && !isDrawPhase && !isDiscardPhase && !gameOver ? <button onClick={handleEndTurn} disabled={waitingForPayment || selfOwesPayment}>End Turn</button> : <span className="atlas-phase">{gameOver ? 'Finished' : gameState.turnPhase?.toLowerCase()}</span>}
        </div>

      </footer>
      {panel && <AtlasHandPanel title={panel === 'hand' ? `My Hand · ${rawHand.length}` : 'Around the table'} status={`${turnLabel} · ${gameState.actionCountRemaining}/3 actions left`} onClose={() => { if (activeCard) setActiveCard(null); else if (previewCard) setPreviewCard(null); else if (rearrangeTarget) setRearrangeTarget(null); else setPanel(null); }} suspended={!!activeCard || !!previewCard || !!rearrangeTarget || !!settingsDialog}>
        {panel === 'players' ? <>
          <p className="atlas-panel-note">Choose a public table. Opponent hands stay private.</p>
          <div className="atlas-player-list">{publicPlayers.map(player => <button key={player.id} className={player.id === selectedPlayer.id ? 'atlas-player-choice atlas-chosen' : 'atlas-player-choice'} onClick={() => { setSelectedPlayerId(player.id); setPanel(null); }}>
            <span className="atlas-avatar" aria-hidden="true">{player.displayName.slice(0, 1)}</span><span><b>{player.id === gameState.self.id ? 'You' : player.displayName}</b><small>{completedColorCount(player)} sets · {player.bank.reduce((sum, card) => sum + (card.value || 0), 0)}M bank · {player.id === gameState.self.id ? rawHand.length : 'handCount' in player ? player.handCount : 0} {player.id === gameState.self.id ? 'in hand' : 'hidden cards'}</small></span><span>{player.id === selectedPlayer.id ? 'Viewing' : 'View →'}</span>
          </button>)}</div>
        </> : <>
          <p className="atlas-panel-note">{canPlay ? 'Tap a card to choose how to play it. Confirm before spending an action.' : 'Tap a card to inspect it. Playing is unavailable right now.'}</p>
        <div className="atlas-bank-drop">              <div
                data-drop-zone="BANK"
                onDragOver={(e) => {
                  e.preventDefault();
                  const payload = getActiveDragPayload();
                  if (
                    payload &&
                    isDropEligible(
                      payload,
                      { kind: 'BANK' },
                      {
                        isMyTurn,
                        playsMade: 3 - gameState.actionCountRemaining,
                        turnPhase: gameState.turnPhase || 'ACTION',
                        waitingForPayment,
                        selfOwesPayment
                      }
                    )
                  ) {
                    e.dataTransfer.dropEffect = 'move';
                    setIsBankDragOver(true);
                  }
                }}
                onDragLeave={() => setIsBankDragOver(false)}
                onDrop={handleDropToBank}
                className={`text-emerald-400 bg-emerald-950/80 px-3 py-1 rounded-full border text-[11px] font-bold transition-all duration-200 ${
                  isBankDragOver
                    ? 'border-emerald-400 ring-2 ring-emerald-400 bg-emerald-900 scale-110 z-40'
                    : 'border-emerald-500/30'
                }`}
                title="Drag money or action cards here to deposit into bank"
              >
                Bank · {selfBankTotal}M · {isBankDragOver ? 'Drop to bank' : 'Drag sideways, then here to bank'}
              </div>
</div>
          {/* Interactive Hand Organization Toolbar */}
          <div className="atlas-hand-tools">
            <label>Sort <select aria-label="Sort hand" value={sortMode} onChange={event => handleSortChange(event.target.value as HandSortMode)}>
              <option value="DEFAULT">Original order</option><option value="TYPE">Card type</option><option value="VALUE">Value</option><option value="COLOR">Color</option>
            </select></label>
            <button type="button" aria-pressed={showPlayableOnly} onClick={handleTogglePlayableOnly}>{showPlayableOnly ? 'Playable only' : 'All cards'} · {playableCount}</button>
          </div>
          <p className="atlas-hand-value">{rawHand.length} cards · {totalHandValue}M total value{rawHand.length > 7 ? ' · Discard to 7 at turn end' : ''}</p>

          {/* Inline Hand Cards Container */}
          <div data-hand-container data-seat-id={gameState.self.id} className="atlas-hand-grid">
            {displayedHand.length === 0 ? (
              <div className="text-slate-500 text-xs italic py-8 px-4 w-full text-center">
                {showPlayableOnly ? 'No cards in hand are currently playable.' : 'Your hand is empty.'}
              </div>
            ) : (
              displayedHand.map((card, idx) => {

                return (
                  <div key={card.id} className="atlas-hand-card" data-hand-card-id={card.id}>
                  <CardView
                    card={card}
                    onClick={() => canPlay ? handleCardClick(card) : handlePreviewCard(card)}
                    onPreview={() => handlePreviewCard(card)}
                    selected={activeCard?.id === card.id}
                    draggable={isMyTurn && !isDrawPhase && !isDiscardPhase && !waitingForPayment && !selfOwesPayment && !gameOver && gameState.actionCountRemaining > 0}
                    sourceZone="HAND"
                    index={idx}
                    onTouchStartCard={(e, c, i, sz) => handleTouchStart(e, c, i, sz)}
                    onTouchMoveCard={(e) => handleTouchMove(e, {
                      isMyTurn,
                      playsMade: 3 - gameState.actionCountRemaining,
                      turnPhase: gameState.turnPhase || 'ACTION',
                      waitingForPayment,
                      selfOwesPayment
                    })}
                    onTouchEndCard={(e) => handleTouchEnd(e, (payload, target) => {
                      if (target.kind === 'BANK') processPayloadDropToBank(payload);
                      else if (target.kind === 'ACTION') processPayloadDropToCenterAction(payload);
                      else if (target.kind === 'PROPERTY' && target.targetColor) handleDropPropertyCard(payload.card, target.targetColor);
                    })}
                  />
                  <div className="atlas-card-caption"><strong>{card.title || card.name}</strong><small>{card.kind || card.type} · {card.value}M</small></div>
                  </div>
                );
              })
            )}
          </div>

        </>}
      </AtlasHandPanel>}

      {/* Action Choice Modal */}
      {previewCard && !settingsDialog && (
        <CardPreviewModal
          card={previewCard}
          onClose={() => setPreviewCard(null)}
        />
      )}

      {/* Action Choice Modal */}
      {activeCard && !pendingResponse && !pendingCharge && !gameOver && (
        <ActionChoiceModal
          card={activeCard}
          opponents={gameState.opponents}
          selfProperties={gameState.self.properties}
          selfHand={gameState.self.hand}
          actionCountRemaining={gameState.actionCountRemaining}
          selfCompletedSetColors={gameState.self.completedSetGroups || gameState.self.completedSetColors}
          selfBuildings={gameState.self.buildings}
          onClose={() => setActiveCard(null)}
          onPlay={handleExecutePlay}
        />
      )}

      {/* Rearrange Wildcard Modal */}
      {rearrangeTarget && canRearrange && (
        <RearrangeWildcardModal
          card={rearrangeTarget.card}
          currentColor={rearrangeTarget.color}
          properties={gameState.self.properties}
          onClose={() => setRearrangeTarget(null)}
          onRearrange={handleRearrange}
        />
      )}

      {pendingResponse && <ResponseDialog response={pendingResponse} selfId={gameState.self.id} hand={gameState.self.hand}
        settings={hostMatch && settingsDialog === 'response' ? settings : undefined}
        onAccept={() => socketService.emit('game:action', { type: 'ACCEPT_ACTION' })}
        onCounter={(cardId) => socketService.emit('game:action', { type: 'JUST_SAY_NO', cardId })} />}

      {/* Payment Modal */}
      {selfOwesPayment && !pendingResponse && gameState.pendingResolution && (
        <PaymentModal
          key={gameState.matchId}
          settings={hostMatch && settingsDialog === 'payment' ? settings : undefined}
          amountOwed={gameState.pendingResolution.amountOwed || 0}
          bankCards={gameState.self.bank}
          propertyCards={gameState.self.properties}
          buildings={gameState.self.buildings}
          mySeatId={gameState.self.id}
          chargerSeatId={gameState.pendingResolution.fromPlayerId || gameState.opponents[0]?.id || 'p2'}
          onPay={(assetIds) => {
            sfx.playRentPayment();
            socketService.emit('game:action', {
              type: 'PAY_RENT',
              paymentCardIds: assetIds
            });
          }}
        />
      )}

      {/* Discard Modal */}
      {isDiscardPhase && (
        <DiscardModal
          key={gameState.matchId}
          settings={hostMatch && settingsDialog === 'discard' ? settings : undefined}
          hand={gameState.self.hand}
          onDiscard={(cardIds) => {
            sfx.playCardPlay();
            handleDiscard(cardIds);
          }}
        />
      )}

      {/* Win Modal */}
      {gameOver && (
        <WinModal
          settings={hostMatch && settingsDialog === 'win' ? settings : undefined}
          gameOver={gameOver}
          selfId={gameState.self.id}
          opponents={gameState.opponents}
          selfDisplayName={displayName}
          onRematch={() => {
            sfx.playToast();
            socketService.emit('room:rematch', { roomCode });
          }}
          onLeaveRoom={() => {
            socketService.emit('room:leave');
            resetMatch();
          }}
        />
      )}

      {/* Live Event Feed & Toast Banner Overlays */}

      {/* Current action/response is retained in the status strip and public event log. */}

      {/* Tournament Leaderboard Modal */}
      {showLeaderboard && <LeaderboardModal onClose={() => setShowLeaderboard(false)} />}

      {/* Match Replay Viewer Modal */}
      {showReplay && gameOver && (
        <ReplayViewerModal
          isOpen={showReplay}
          onClose={() => setShowReplay(false)}
          roomCode={roomCode || undefined}
        />
      )}

      {/* Fullscreen 3D Card Shuffle & Deal Visual FX Overlay */}
      <DrawSequenceOverlay />
      <JustSayNoFlightOverlay />
      <RentPaymentFlightOverlay />
      <CardPlayFlightOverlay />
      <ActionTargetFlightOverlay />
      <CardDiscardFlightOverlay />
    </div>
  );
};
