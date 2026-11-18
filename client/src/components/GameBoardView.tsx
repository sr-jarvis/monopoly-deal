import React, { useState, useEffect } from 'react';
import { useGameStore } from '../store/useGameStore';
import { CardView } from './CardView';
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
import { ActionToastBanner } from './ActionToastBanner';
import { HandToolbar } from './HandToolbar';
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
  const { gameState, roomCode, events, gameOver, resetMatch, displayName } = useGameStore();
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [previewCard, setPreviewCard] = useState<Card | null>(null);
  const [rearrangeTarget, setRearrangeTarget] = useState<{ card: Card; color: string } | null>(null);
  const [sortMode, setSortMode] = useState<HandSortMode>(getStoredSortMode);
  const [showPlayableOnly, setShowPlayableOnly] = useState<boolean>(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showReplay, setShowReplay] = useState(false);

  // Drag & Drop Highlight States
  const [isBankDragOver, setIsBankDragOver] = useState(false);
  const [isActionDragOver, setIsActionDragOver] = useState(false);

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
    ? sortedHand.filter(() => isMyTurn && !isDrawPhase && !isDiscardPhase && !waitingForPayment)
    : sortedHand;

  const totalHandValue = calculateTotalHandValue(rawHand);
  const selfBankTotal = gameState.self.bank.reduce((sum, c) => sum + (c.value || 0), 0);
  const playableCount = isMyTurn && !isDrawPhase && !isDiscardPhase && !waitingForPayment ? rawHand.length : 0;

  return (
    <div className="min-h-screen md:h-screen w-full flex flex-col bg-slate-950 text-slate-100 p-2 md:p-4 gap-3 md:gap-4 overflow-x-hidden md:overflow-hidden">
      {/* Top Navigation & Status Bar */}
      <div className="flex flex-wrap gap-3 justify-between items-center bg-slate-900/90 border border-slate-800 px-4 py-2.5 rounded-xl shadow-lg shrink-0">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="text-sm font-black tracking-wider text-amber-400 bg-amber-950/80 border border-amber-500/40 px-2.5 py-0.5 rounded-lg">
            MONOPOLY DEAL
          </div>
          <div className="text-xs text-slate-400 font-mono">
            Room: <span className="font-bold text-slate-200">{roomCode}</span>
          </div>
        </div>

        <GameSettings onLeaderboard={() => setShowLeaderboard(true)} onReplay={gameOver ? () => setShowReplay(true) : undefined} />
      </div>
      <div role="status" aria-label="Turn status" className="md-turn-status">
        <strong>{isMyTurn ? 'YOUR TURN' : `${gameState.opponents.find(o => o.id === gameState.currentTurnPlayerId)?.displayName || 'Opponent'}'s turn`}</strong>
        <span>Actions: {gameState.actionCountRemaining} / 3</span>
        {isMyTurn && !isDrawPhase && !isDiscardPhase && !gameOver && <button onClick={handleEndTurn} disabled={waitingForPayment || selfOwesPayment}>End Turn</button>}
      </div>

      {waitingForPayment && (
        <div role="status" className="border border-amber-500/50 bg-amber-950/70 text-amber-100 rounded-xl px-4 py-3 text-sm font-semibold">
          {waitingForPaymentMessage}
        </div>
      )}

      {/* Main Playfield Grid */}
      <div className="flex-1 grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] gap-3 md:gap-4 min-h-0 min-w-0">
        {/* Opponents Area */}
        <div className="md-opponents bg-slate-800/40 border border-slate-700/60 p-3 rounded-xl">
          {gameState.opponents.map((opp) => (
            <div key={opp.id} data-seat-id={opp.id} className="md-opponent p-3 bg-slate-900/80 rounded-xl border border-slate-700/80 text-xs shadow-md">
              <div className="font-extrabold text-slate-200 flex justify-between mb-2 pb-1 border-b border-slate-800">
                <span className="flex items-center gap-1.5">
                  <span>{opp.displayName}</span>
                  {opp.isBot && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-900/60 text-amber-300 font-mono font-bold border border-amber-700/50">
                      {opp.difficulty || 'MEDIUM'}
                    </span>
                  )}
                </span>
                <span data-draw-hand={opp.id} className="text-sky-400 font-mono">{opp.handCount} in hand</span>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] text-emerald-400 font-bold">
                  💰 Bank: ${opp.bank.reduce((sum, c) => sum + (c.value || 0), 0)}M
                </div>

                {/* Opponent Property Mini Sets */}
                <div className="md-opponent-properties flex gap-2 overflow-x-auto py-1" tabIndex={0} aria-label={`${opp.displayName} property sets`}>
                  {Object.entries(opp.properties).map(([color, cards]) =>
                    cards && (cards.length > 0 || opp.buildings?.[color as PropertyColor]?.houseCard || opp.buildings?.[color as PropertyColor]?.hotelCard) ? (
                      <PropertyGroupView
                        key={color}
                        color={color as PropertyColor}
                        cards={cards}
                        houseCard={opp.buildings?.[color as PropertyColor]?.houseCard}
                        hotelCard={opp.buildings?.[color as PropertyColor]?.hotelCard}
                        isCompleteSet={(opp.completedSetGroups || opp.completedSetColors)?.includes(color)}
                        hasHouse={opp.buildings?.[color as PropertyColor]?.house}
                        hasHotel={opp.buildings?.[color as PropertyColor]?.hotel}
                        onPreviewCard={handleOpponentPublicPreviewCard}
                      />
                    ) : null
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Center Field: Draw Pile, Discard Pile / Action Drop Zone & Property Board */}
        <div className="min-w-0 min-h-[260px] md:min-h-0 flex flex-col md:flex-row justify-between items-center bg-slate-800/20 border border-slate-800 rounded-xl p-4 gap-6 overflow-y-auto">
          {/* Deck Piles & Center Action Drop Zone */}
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

          {/* Self Property Board View */}
          <div className="flex-1 min-w-0 w-full overflow-x-auto">
            <div className="text-[10px] font-bold text-sky-400 uppercase tracking-widest mb-2 flex items-center gap-2">
              <span>Your Property Sets</span>
              <span className="text-slate-500 font-normal text-[9px]">(Drag cards onto set to place)</span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 min-h-[140px] items-start">
              {Object.entries(gameState.self.properties).map(([color, cards]) =>
                cards && (cards.length > 0 || gameState.self.buildings?.[color as PropertyColor]?.houseCard || gameState.self.buildings?.[color as PropertyColor]?.hotelCard) ? (
                  <PropertyGroupView
                    key={color}
                    color={color as PropertyColor}
                    cards={cards}
                    blocked={waitingForPayment || selfOwesPayment || !!gameOver}
                    houseCard={gameState.self.buildings?.[color as PropertyColor]?.houseCard}
                    hotelCard={gameState.self.buildings?.[color as PropertyColor]?.hotelCard}
                    isCompleteSet={(gameState.self.completedSetGroups || gameState.self.completedSetColors)?.includes(color)}
                    hasHouse={gameState.self.buildings?.[color as PropertyColor]?.house}
                    hasHotel={gameState.self.buildings?.[color as PropertyColor]?.hotel}
                    onCardClick={canRearrange ? handleSelfPropertyCardClick(color as PropertyColor) : undefined}
                    onPreviewCard={handlePreviewCard}
                    selectedCardId={rearrangeTarget?.card.id}
                    onDropCard={handleDropPropertyCard}
                    isMyTurn={isMyTurn}
                    turnPhase={gameState.turnPhase}
                    playsMade={3 - gameState.actionCountRemaining}
                  />
                ) : null
              )}
            </div>
          </div>
        </div>

        {/* Self Bottom Bar: Bank & Hand Drawer */}
        <div data-seat-id={gameState.self.id} className="bg-slate-800/90 border border-slate-700 p-4 rounded-xl flex flex-col gap-3 shrink-0">
          <div className="flex flex-wrap gap-2 justify-between items-center">
            <div className="text-xs font-extrabold text-slate-300 uppercase tracking-wider flex flex-wrap items-center gap-3">
              <span>Your Hand ({rawHand.length} cards)</span>

              {/* Bank Drop Zone Target */}
              <div
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
                💰 Bank: ${selfBankTotal}M {isBankDragOver ? '📥 DROP HERE' : '📥 (Drop Zone)'}
              </div>
            </div>

            {waitingForPayment ? (
              <span className="text-[10px] text-amber-300 font-semibold bg-amber-950/80 px-2 py-0.5 rounded border border-amber-700">
                {waitingForPaymentMessage}
              </span>
            ) : isDrawPhase ? (
              <span className="text-[10px] text-sky-400 font-semibold bg-sky-950/80 px-2 py-0.5 rounded border border-sky-800">
                Drawing cards automatically…
              </span>
            ) : isMyTurn && !isDiscardPhase && (
              <span className="text-[10px] text-sky-400 font-semibold bg-sky-950/80 px-2 py-0.5 rounded border border-sky-800">
                Drag card to Bank / Property / Center, or tap card to play
              </span>
            )}
          </div>

          {/* Interactive Hand Organization Toolbar */}
          <HandToolbar
            cardCount={rawHand.length}
            totalValue={totalHandValue}
            sortMode={sortMode}
            onSortChange={handleSortChange}
            showPlayableOnly={showPlayableOnly}
            onTogglePlayableOnly={handleTogglePlayableOnly}
            playableCount={playableCount}
          />

          {/* Inline Hand Cards Container */}
          <div data-draw-hand={gameState.self.id} className="min-w-0 flex gap-2 overflow-x-auto pb-2 pt-1 items-center min-h-[150px] transition-all">
            {displayedHand.length === 0 ? (
              <div className="text-slate-500 text-xs italic py-8 px-4 w-full text-center">
                {showPlayableOnly ? 'No cards in hand are currently playable.' : 'Your hand is empty.'}
              </div>
            ) : (
              displayedHand.map((card, idx) => {

                return (
                  <CardView
                    key={card.id}
                    card={card}
                    onClick={() => handleCardClick(card)}
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
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Action Choice Modal */}
      {previewCard && (
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
        onAccept={() => socketService.emit('game:action', { type: 'ACCEPT_ACTION' })}
        onCounter={(cardId) => socketService.emit('game:action', { type: 'JUST_SAY_NO', cardId })} />}

      {/* Payment Modal */}
      {selfOwesPayment && !pendingResponse && gameState.pendingResolution && (
        <PaymentModal
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
      <EventFeed events={events} />
      <ActionToastBanner />

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
