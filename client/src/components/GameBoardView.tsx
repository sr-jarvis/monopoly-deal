import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { useGameStore } from '../store/useGameStore';
import { CardView } from './CardView';
import { PropertyGroupView } from './PropertyGroupView';
import { ActionChoiceModal } from './ActionChoiceModal';
import { RearrangeWildcardModal } from './RearrangeWildcardModal';
import { PaymentModal } from './PaymentModal';
import { DiscardModal } from './DiscardModal';
import { WinModal } from './WinModal';
import { LeaderboardModal } from './LeaderboardModal';
import { ReplayViewerModal } from './ReplayViewerModal';
import { MusicPlayerControls } from './MusicPlayerControls';
import { ShuffleAnimationOverlay } from './ShuffleAnimationOverlay';
import { CardFlightOverlay } from './CardFlightOverlay';
import { CardPlayFlightOverlay } from './CardPlayFlightOverlay';
import { ActionTargetFlightOverlay } from './ActionTargetFlightOverlay';
import { CardDrawFlightOverlay } from './CardDrawFlightOverlay';
import { CardDealFlightOverlay } from './CardDealFlightOverlay';
import { CardDiscardFlightOverlay } from './CardDiscardFlightOverlay';
import { CardShuffleFlightOverlay } from './CardShuffleFlightOverlay';
import { JustSayNoFlightOverlay } from './JustSayNoFlightOverlay';
import { RentPaymentFlightOverlay } from './RentPaymentFlightOverlay';
import { createCardDrawCascadePlan, dispatchDrawFlightStart } from '../utils/cardDrawFlightEngine';
import { scheduleInitialDealCascade, emitDealStart } from '../utils/cardDealFlightEngine';
import { cardFlightEngine } from '../utils/cardFlightEngine';
import { launchActionTargetFlight, kindFromActionCard, SeatPosition } from '../utils/actionTargetFlightEngine';
import { triggerShuffle } from '../utils/shuffleEngine';
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
  const [rearrangeTarget, setRearrangeTarget] = useState<{ card: Card; color: PropertyColor } | null>(null);
  const [sortMode, setSortMode] = useState<HandSortMode>(getStoredSortMode);
  const [showPlayableOnly, setShowPlayableOnly] = useState<boolean>(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showReplay, setShowReplay] = useState(false);

  // Drag & Drop Highlight States
  const [isBankDragOver, setIsBankDragOver] = useState(false);
  const [isActionDragOver, setIsActionDragOver] = useState(false);

  // Animation Orchestration State
  const [dealingIds, setDealingIds] = useState<Map<string, number>>(new Map());
  const seenHandIds = useRef<Set<string>>(new Set());

  const muted = useSyncExternalStore(sfx.subscribeMute, sfx.isMuted, () => true);

  // Detect and stagger deal animations when new cards enter hand
  useEffect(() => {
    if (!gameState) return;
    const currentHand = gameState.self.hand || [];
    const incoming = currentHand.filter((card) => !seenHandIds.current.has(card.id));

    if (incoming.length > 0) {
      const newDealingMap = new Map<string, number>();
      incoming.forEach((card, idx) => {
        newDealingMap.set(card.id, idx);
      });
      setDealingIds(newDealingMap);

      // Background tab timeout safety fallback to ensure dealingIds clear
      const timeoutMs = 420 + incoming.length * 70 + 150;
      const timer = setTimeout(() => {
        setDealingIds(new Map());
      }, timeoutMs);

      seenHandIds.current = new Set(currentHand.map((c) => c.id));
      return () => clearTimeout(timer);
    }

    seenHandIds.current = new Set(currentHand.map((c) => c.id));
  }, [gameState?.self.hand]);

  // Initial Game Deal Animation Trigger
  const dealStartedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!gameState) return;
    const matchKey = `${roomCode || 'game'}:${gameState.turnPhase || 'start'}:${gameState.self.hand?.length || 0}`;
    if (dealStartedRef.current.has(matchKey)) return;

    if (gameState.self.hand && gameState.self.hand.length >= 5) {
      dealStartedRef.current.add(matchKey);
      const seatIds = [gameState.self.id, ...gameState.opponents.map((op) => op.id)];
      const plan = scheduleInitialDealCascade({
        seatIds,
        humanSeatId: gameState.self.id,
      });
      if (plan.flights.length > 0) {
        emitDealStart(plan);
      }
    }
  }, [gameState, roomCode]);

  if (!gameState) return null;

  const handleToggleMute = () => {
    const isNowMuted = sfx.toggleMute();
    if (!isNowMuted) {
      sfx.playToast();
    }
  };

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
  const pendingCharge = gameState.pendingCharge;
  const selfOwesPayment =
    gameState.pendingResolution?.targetPlayerId === gameState.self.id;
  const waitingForPayment = !!pendingCharge && !selfOwesPayment;
  const waitingDebtors = pendingCharge?.debtors
    .map(({ playerId, amountOwed }) => {
      const player = gameState.opponents.find((opponent) => opponent.id === playerId);
      return `${player?.displayName || playerId} ($${amountOwed}M)`;
    })
    .join(', ');
  const waitingForPaymentMessage = pendingCharge
    ? `Waiting for ${waitingDebtors} to pay ${pendingCharge.sourceTitle}.`
    : '';

  const canRearrange = !pendingCharge && isMyTurn && (gameState.turnPhase === 'ACTION' || gameState.turnPhase === 'DISCARD');

  const handleCardClick = (card: Card) => {
    if (!isMyTurn || isDrawPhase || isDiscardPhase || waitingForPayment) return;
    setActiveCard(card);
  };

  const handleSelfPropertyCardClick = (color: PropertyColor) => (card: Card) => {
    if (!canRearrange) return;
    if ((card.kind || card.type) !== 'WILDCARD') return;
    setRearrangeTarget({ card, color });
  };

  const handleRearrange = (destinationColor: PropertyColor) => {
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
    propertyColor?: PropertyColor;
    targetPlayerId?: string;
    targetPropertyColor?: PropertyColor;
    targetCardId?: string;
    offeredCardId?: string;
    offeredPropertyColor?: PropertyColor;
    requestedCardId?: string;
    requestedPropertyColor?: PropertyColor;
    doubleRentCardId?: string;
  }) => {
    if (!activeCard || waitingForPayment) return;

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
      doubleRentCardId: options.doubleRentCardId
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

  const handleDropPropertyCard = (card: Card, targetColor: PropertyColor) => {
    if (waitingForPayment) return;

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

  const handleDraw = () => {
    if (!isDrawPhase || waitingForPayment) return;
    sfx.playCardDraw();

    // Trigger 3D Card Draw Flight Cascade animation
    try {
      const deckEl = document.querySelector('[data-deck-stack="true"]');
      const handEl = document.querySelector('.md-hand-container') || document.querySelector('[data-hand-container="true"]');
      if (deckEl && handEl) {
        const deckRect = deckEl.getBoundingClientRect();
        const handRect = handEl.getBoundingClientRect();
        const drawCount = gameState?.drawCount || 2;
        const cardsToDraw = Array.from({ length: drawCount }, (_, i) => ({
          label: `CARD ${i + 1}`,
          color: null,
        }));
        const ghosts = createCardDrawCascadePlan('standard-draw', cardsToDraw, deckRect, handRect);
        dispatchDrawFlightStart(`draw-${Date.now()}`, 'standard-draw', ghosts);
      }
    } catch {
      // Non-blocking animation calculation fallback
    }

    const seatCount = (gameState.opponents?.length || 0) + 1;
    cardFlightEngine.launchDealSequence(2, seatCount);
    socketService.emit('game:action', { type: 'DRAW' });
  };

  const handleEndTurn = () => {
    if (!isMyTurn || isDiscardPhase || waitingForPayment) return;
    socketService.emit('game:action', { type: 'END_TURN' });
  };

  const handleDiscard = (cardIds: string[]) => {
    if (!isDiscardPhase || waitingForPayment) return;
    socketService.emit('game:action', {
      type: 'DISCARD',
      cardIds
    });
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
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 p-4 gap-4 overflow-hidden">
      {/* Top Navigation & Status Bar */}
      <div className="flex justify-between items-center bg-slate-900/90 border border-slate-800 px-4 py-2.5 rounded-xl shadow-lg shrink-0">
        <div className="flex items-center gap-3">
          <div className="text-sm font-black tracking-wider text-amber-400 bg-amber-950/80 border border-amber-500/40 px-2.5 py-0.5 rounded-lg">
            MONOPOLY DEAL
          </div>
          <div className="text-xs text-slate-400 font-mono">
            Room: <span className="font-bold text-slate-200">{roomCode}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowLeaderboard(true)}
            aria-label="Open tournament leaderboard"
            title="Tournament Leaderboard & League Standings"
            className="rounded-lg border border-amber-500/40 bg-amber-950/60 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-amber-300 transition hover:bg-amber-900/60"
          >
            🏆 Leaderboard
          </button>

          <button
            onClick={() => setShowReplay(true)}
            aria-label="Open match replay viewer"
            title="Match Replay & Tactical Telemetry"
            className="rounded-lg border border-sky-500/40 bg-sky-950/60 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-sky-300 transition hover:bg-sky-900/60"
          >
            🎬 Replay
          </button>

          <button
            onClick={() => triggerShuffle('manual')}
            aria-label="Shuffle draw deck"
            title="Shuffle Draw Deck Visual FX"
            className="rounded-lg border border-purple-500/40 bg-purple-950/60 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider text-purple-300 transition hover:bg-purple-900/60"
          >
            🔀 Shuffle
          </button>

          {/* Mute Toggle Button */}
          <button
            onClick={handleToggleMute}
            aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition"
            title={muted ? 'Unmute Sound Effects' : 'Mute Sound Effects'}
          >
            {muted ? '🔇' : '🔊'}
          </button>

          {/* WebAudio Music Controls */}
          <MusicPlayerControls compact />

          <div className="text-xs font-bold px-3 py-1 rounded-full bg-slate-800 border border-slate-700">
            {isMyTurn ? (
              <span className="text-emerald-400 animate-pulse">YOUR TURN</span>
            ) : (
              <span className="text-slate-400">
                {gameState.opponents.find((o) => o.id === gameState.currentTurnPlayerId)?.displayName || 'OPPONENT'}'S TURN
              </span>
            )}
          </div>

          <div className="text-xs text-slate-400">
            Actions remaining: <span className="font-bold text-slate-200">{gameState.actionCountRemaining}</span> / 3
          </div>
        </div>

        <div>
          {isDrawPhase ? (
            <button
              onClick={handleDraw}
              disabled={waitingForPayment}
              title={waitingForPayment ? waitingForPaymentMessage : undefined}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-lg transition text-xs shadow-md shadow-sky-900/40 uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50"
            >
              Draw {gameState.drawCount} Cards
            </button>
          ) : isMyTurn && !isDiscardPhase && (
            <button
              onClick={handleEndTurn}
              disabled={waitingForPayment}
              title={waitingForPayment ? waitingForPaymentMessage : undefined}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg transition text-xs shadow-md shadow-rose-900/40 uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50"
            >
              End Turn
            </button>
          )}
        </div>
      </div>

      {waitingForPayment && (
        <div role="status" className="border border-amber-500/50 bg-amber-950/70 text-amber-100 rounded-xl px-4 py-3 text-sm font-semibold">
          {waitingForPaymentMessage}
        </div>
      )}

      {/* Main Playfield Grid */}
      <div className="flex-1 grid grid-rows-[auto_1fr_auto] gap-4 min-h-0">
        {/* Opponents Area */}
        <div className="bg-slate-800/40 border border-slate-700/60 p-3 rounded-xl overflow-x-auto flex gap-4 items-center shrink-0">
          {gameState.opponents.map((opp) => (
            <div key={opp.id} data-seat-id={opp.id} className="min-w-[220px] p-3 bg-slate-900/80 rounded-xl border border-slate-700/80 text-xs shadow-md">
              <div className="font-extrabold text-slate-200 flex justify-between mb-2 pb-1 border-b border-slate-800">
                <span className="flex items-center gap-1.5">
                  <span>{opp.displayName}</span>
                  {opp.isBot && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-900/60 text-amber-300 font-mono font-bold border border-amber-700/50">
                      {opp.difficulty || 'MEDIUM'}
                    </span>
                  )}
                </span>
                <span className="text-sky-400 font-mono">{opp.handCount} in hand</span>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] text-emerald-400 font-bold">
                  💰 Bank: ${opp.bank.reduce((sum, c) => sum + (c.value || 0), 0)}M
                </div>

                {/* Opponent Property Mini Sets */}
                <div className="flex gap-2 overflow-x-auto py-1">
                  {Object.entries(opp.properties).map(([color, cards]) =>
                    cards && cards.length > 0 ? (
                      <PropertyGroupView
                        key={color}
                        color={color as PropertyColor}
                        cards={cards}
                        isCompleteSet={opp.completedSetColors?.includes(color as PropertyColor)}
                        hasHouse={opp.buildings?.[color as PropertyColor]?.house}
                        hasHotel={opp.buildings?.[color as PropertyColor]?.hotel}
                      />
                    ) : null
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Center Field: Draw Pile, Discard Pile / Action Drop Zone & Property Board */}
        <div className="flex flex-col md:flex-row justify-between items-center bg-slate-800/20 border border-slate-800 rounded-xl p-4 gap-6 overflow-y-auto">
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
            className={`flex items-center gap-6 shrink-0 p-3 rounded-xl border transition-all duration-200 ${
              isActionDragOver
                ? 'border-amber-400 ring-2 ring-amber-400/60 bg-amber-950/40 scale-105 z-30'
                : 'border-transparent'
            }`}
          >
            <DeckStackView
              remaining={gameState.drawPileCount}
              isDrawPhase={isDrawPhase}
              canDraw={!waitingForPayment && isDrawPhase}
              onDraw={handleDraw}
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
          <div className="flex-1 w-full overflow-x-auto">
            <div className="text-[10px] font-bold text-sky-400 uppercase tracking-widest mb-2 flex items-center gap-2">
              <span>Your Property Sets</span>
              <span className="text-slate-500 font-normal text-[9px]">(Drag cards onto set to place)</span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-2 min-h-[140px] items-start">
              {Object.entries(gameState.self.properties).map(([color, cards]) =>
                cards && cards.length > 0 ? (
                  <PropertyGroupView
                    key={color}
                    color={color as PropertyColor}
                    cards={cards}
                    isCompleteSet={gameState.self.completedSetColors?.includes(color as PropertyColor)}
                    hasHouse={gameState.self.buildings?.[color as PropertyColor]?.house}
                    hasHotel={gameState.self.buildings?.[color as PropertyColor]?.hotel}
                    onCardClick={canRearrange ? handleSelfPropertyCardClick(color as PropertyColor) : undefined}
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
          <div className="flex justify-between items-center">
            <div className="text-xs font-extrabold text-slate-300 uppercase tracking-wider flex items-center gap-3">
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
                Draw {gameState.drawCount} card{gameState.drawCount === 1 ? '' : 's'} to begin
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
          <div className="flex gap-2 overflow-x-auto pb-2 pt-1 items-center min-h-[150px] transition-all">
            {displayedHand.length === 0 ? (
              <div className="text-slate-500 text-xs italic py-8 px-4 w-full text-center">
                {showPlayableOnly ? 'No cards in hand are currently playable.' : 'Your hand is empty.'}
              </div>
            ) : (
              displayedHand.map((card, idx) => {
                const isDealing = dealingIds.has(card.id);
                const dealIdx = dealingIds.get(card.id) ?? 0;

                return (
                  <CardView
                    key={card.id}
                    card={card}
                    onClick={() => handleCardClick(card)}
                    selected={activeCard?.id === card.id}
                    animation={isDealing ? 'deal' : null}
                    dealIndex={dealIdx}
                    draggable={isMyTurn && !isDrawPhase && !isDiscardPhase && !waitingForPayment}
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
                    onAnimationComplete={(kind) => {
                      if (kind === 'deal') {
                        setDealingIds((prev) => {
                          const next = new Map(prev);
                          next.delete(card.id);
                          return next;
                        });
                      }
                    }}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Action Choice Modal */}
      {activeCard && (
        <ActionChoiceModal
          card={activeCard}
          opponents={gameState.opponents}
          selfProperties={gameState.self.properties}
          selfHand={gameState.self.hand}
          actionCountRemaining={gameState.actionCountRemaining}
          selfCompletedSetColors={gameState.self.completedSetColors}
          selfBuildings={gameState.self.buildings}
          onClose={() => setActiveCard(null)}
          onPlay={handleExecutePlay}
        />
      )}

      {/* Rearrange Wildcard Modal */}
      {rearrangeTarget && (
        <RearrangeWildcardModal
          card={rearrangeTarget.card}
          currentColor={rearrangeTarget.color}
          onClose={() => setRearrangeTarget(null)}
          onRearrange={handleRearrange}
        />
      )}

      {/* Payment Modal */}
      {selfOwesPayment && gameState.pendingResolution && (
        <PaymentModal
          amountOwed={gameState.pendingResolution.amountOwed || 0}
          bankCards={gameState.self.bank}
          propertyCards={gameState.self.properties}
          mySeatId={gameState.self.id}
          chargerSeatId={gameState.pendingResolution.fromPlayerId || gameState.opponents[0]?.id || 'p2'}
          onPay={(assetIds) => {
            sfx.playRentPayment();
            socketService.emit('game:action', {
              type: 'PAY_RENT',
              assetIds
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
            resetMatch();
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
      {showReplay && (
        <ReplayViewerModal
          isOpen={showReplay}
          onClose={() => setShowReplay(false)}
          roomCode={roomCode || undefined}
        />
      )}

      {/* Fullscreen 3D Card Shuffle & Deal Visual FX Overlay */}
      <ShuffleAnimationOverlay />
      <CardShuffleFlightOverlay />
      <JustSayNoFlightOverlay />
      <RentPaymentFlightOverlay />
      <CardFlightOverlay />
      <CardPlayFlightOverlay />
      <ActionTargetFlightOverlay />
      <CardDrawFlightOverlay />
      <CardDealFlightOverlay />
      <CardDiscardFlightOverlay />
    </div>
  );
};
