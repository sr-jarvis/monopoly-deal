const rules_validator = require("./rules_validator");
const hand_inference = require("./hand_inference");
const trade_evaluator = require("./trade_evaluator");
const bot_engine = require("./bot_engine");
const { COMPLETE_SET_SIZE } = require("./card_catalog");

const WIN_REQUIRED_SET_COUNT = 3;
const MAX_PLAYS_PER_TURN = 3;

const FINISHER_TACTIC_CATALOG = [
  {
    id: "NATURAL_COMPLETION",
    title: "Direct Set Completion",
    description: "Play a property or wildcard from hand into an incomplete set to reach WIN_REQUIRED_SET_COUNT this turn."
  },
  {
    id: "DEAL_BREAKER_STEAL",
    title: "Deal Breaker Full-Set Acquisition",
    description: "Steal an opponent's already-complete property set outright, instantly satisfying one win condition slot."
  },
  {
    id: "SLY_DEAL_ASSIST",
    title: "Sly Deal Single-Card Assist",
    description: "Steal a single card from an opponent's incomplete set to complete one of the bot's own incomplete sets."
  },
  {
    id: "FORCED_DEAL_SWAP",
    title: "Forced Deal Completing Swap",
    description: "Trade an unneeded property for one that completes a set without touching completed sets."
  }
];

function getFinisherTacticsCatalog() {
  return FINISHER_TACTIC_CATALOG;
}

function normalizePropertySets(playerState) {
  const raw = playerState.properties || {};
  if (Array.isArray(raw)) {
    return raw.map(s => ({
      color: s.color,
      complete: Boolean(s.complete || (s.cards && s.cards.length >= (COMPLETE_SET_SIZE[s.color] || 3))),
      cards: s.cards || []
    }));
  }
  const sets = [];
  for (const color of Object.keys(raw)) {
    const group = raw[color];
    const cards = Array.isArray(group) ? group : (group && group.cards ? group.cards : []);
    const reqSize = COMPLETE_SET_SIZE[color] || 3;
    sets.push({
      color,
      complete: cards.length >= reqSize,
      cards
    });
  }
  return sets;
}

function computeSetsNeededAndCardsNeeded(playerState) {
  const sets = normalizePropertySets(playerState);
  const completeSets = sets.filter(s => s.complete);
  const setsNeeded = Math.max(0, WIN_REQUIRED_SET_COUNT - completeSets.length);

  const incompleteSets = sets.filter(s => !s.complete);
  incompleteSets.sort((a, b) => {
    const remA = (COMPLETE_SET_SIZE[a.color] || 3) - a.cards.length;
    const remB = (COMPLETE_SET_SIZE[b.color] || 3) - b.cards.length;
    return remA - remB;
  });

  let cardsNeeded = 0;
  const targetSets = incompleteSets.slice(0, setsNeeded);
  for (const s of targetSets) {
    const size = COMPLETE_SET_SIZE[s.color] || 3;
    cardsNeeded += Math.max(0, size - s.cards.length);
  }

  const missingSets = setsNeeded - targetSets.length;
  if (missingSets > 0) {
    cardsNeeded += missingSets * 3;
  }

  return { completedCount: completeSets.length, setsNeeded, cardsNeeded };
}

function calculateEndgameWinProbability(gameState, playerId) {
  if (!gameState || !gameState.players || !gameState.players[playerId]) {
    throw new Error(`Invalid gameState or player ID not found: ${playerId}`);
  }

  const callingPlayer = gameState.players[playerId];
  const selfMetric = computeSetsNeededAndCardsNeeded(callingPlayer);

  const hand = callingPlayer.hand || [];
  const handFillable = hand.filter(c => c.type === 'PROPERTY' || c.type === 'WILDCARD' || c.type === 'ACTION').length;

  const selfTurnsToWin = Math.ceil(Math.max(0, selfMetric.cardsNeeded - Math.min(handFillable, 2)) / MAX_PLAYS_PER_TURN) + (selfMetric.cardsNeeded > handFillable ? 1 : 0);

  const opponents = [];
  const rawScores = {};
  rawScores[playerId] = 1 / (1 + selfTurnsToWin);

  for (const pid of Object.keys(gameState.players)) {
    if (pid === playerId) continue;

    const opp = gameState.players[pid];
    const oppMetric = computeSetsNeededAndCardsNeeded(opp);

    const inference = hand_inference.inferOpponentHand(gameState, pid, playerId);
    const oppHandSize = typeof inference.handSize === 'number' ? inference.handSize : (opp.hand ? opp.hand.length : 5);
    const estimatedHandFillable = Math.min(2, Math.round(oppHandSize * 0.4));

    const oppTurnsToWin = Math.ceil(Math.max(0, oppMetric.cardsNeeded - estimatedHandFillable) / MAX_PLAYS_PER_TURN) + (oppMetric.cardsNeeded > estimatedHandFillable ? 1 : 0);

    opponents.push({
      playerId: pid,
      estimatedTurnsToWin: oppTurnsToWin,
      confidence: inference.confidence || 'MEDIUM',
      completedSetColors: normalizePropertySets(opp).filter(s => s.complete).map(s => s.color)
    });

    rawScores[pid] = 1 / (1 + oppTurnsToWin);
  }

  const totalRaw = Object.values(rawScores).reduce((a, b) => a + b, 0);
  const winProbability = {};
  for (const pid of Object.keys(rawScores)) {
    winProbability[pid] = Math.round((rawScores[pid] / totalRaw) * 100) / 100;
  }

  let leadingPlayerId = playerId;
  let minTurns = selfTurnsToWin;
  for (const opp of opponents) {
    if (opp.estimatedTurnsToWin < minTurns) {
      minTurns = opp.estimatedTurnsToWin;
      leadingPlayerId = opp.playerId;
    }
  }

  return {
    playerId,
    turnsToWin: selfTurnsToWin,
    opponents,
    winProbability,
    leadingPlayerId,
    evaluatedAt: new Date().toISOString()
  };
}

function evaluateFinisherTactics(gameState, playerId) {
  if (!gameState || !gameState.players || !gameState.players[playerId]) {
    throw new Error(`Invalid gameState or player ID not found: ${playerId}`);
  }

  const player = gameState.players[playerId];
  const hand = player.hand || [];
  const sets = normalizePropertySets(player);
  const completeCount = sets.filter(s => s.complete).length;
  const neededToWin = Math.max(0, WIN_REQUIRED_SET_COUNT - completeCount);

  const tactics = [];
  let bestImmediateWin = null;

  // 1. NATURAL_COMPLETION
  const naturalTargets = [];
  for (const card of hand) {
    if (card.type === 'PROPERTY' || card.type === 'WILDCARD') {
      const targetColor = card.color || (card.colors ? card.colors[0] : null);
      if (targetColor) {
        const existingSet = sets.find(s => s.color === targetColor);
        const currentCount = existingSet ? existingSet.cards.length : 0;
        const required = COMPLETE_SET_SIZE[targetColor] || 3;
        if (currentCount + 1 === required) {
          naturalTargets.push({ cardId: card.id, color: targetColor });
        }
      }
    }
  }
  const naturalEligible = naturalTargets.length > 0;
  const naturalWins = naturalEligible && neededToWin === 1;
  if (naturalWins) bestImmediateWin = "NATURAL_COMPLETION";

  tactics.push({
    id: "NATURAL_COMPLETION",
    eligible: naturalEligible,
    winsImmediately: naturalWins,
    targets: naturalTargets,
    reason: naturalEligible ? `Found ${naturalTargets.length} hand cards completing a set.` : "No hand cards immediately complete a property set."
  });

  // 2. DEAL_BREAKER_STEAL
  const dealBreakerCards = hand.filter(c => c.name === 'Deal Breaker' || c.id === 'action_deal_breaker');
  const dbTargets = [];
  if (dealBreakerCards.length > 0) {
    for (const oppId of Object.keys(gameState.players)) {
      if (oppId === playerId) continue;
      const opp = gameState.players[oppId];
      const oppCompleteSets = normalizePropertySets(opp).filter(s => s.complete);
      for (const set of oppCompleteSets) {
        const errors = rules_validator.validateDealBreakerTarget(gameState, {
          playerId,
          targetPlayerId: oppId,
          targetPropertyColor: set.color
        });
        if (!errors || errors.length === 0) {
          dbTargets.push({ targetPlayerId: oppId, targetPropertyColor: set.color, strategicValue: 15 });
        }
      }
    }
  }
  const dbEligible = dbTargets.length > 0;
  const dbWins = dbEligible && neededToWin === 1;
  if (dbWins && !bestImmediateWin) bestImmediateWin = "DEAL_BREAKER_STEAL";

  tactics.push({
    id: "DEAL_BREAKER_STEAL",
    eligible: dbEligible,
    winsImmediately: dbWins,
    targets: dbTargets,
    reason: dbEligible ? `Found ${dbTargets.length} complete opponent sets targetable by Deal Breaker.` : "No Deal Breaker held or no complete opponent sets available."
  });

  // 3. SLY_DEAL_ASSIST
  const slyCards = hand.filter(c => c.name === 'Sly Deal' || c.id === 'action_sly_deal');
  const slyTargets = [];
  if (slyCards.length > 0) {
    for (const oppId of Object.keys(gameState.players)) {
      if (oppId === playerId) continue;
      const opp = gameState.players[oppId];
      const oppIncompleteSets = normalizePropertySets(opp).filter(s => !s.complete && s.cards.length > 0);
      for (const set of oppIncompleteSets) {
        const mySet = sets.find(s => s.color === set.color);
        const myCount = mySet ? mySet.cards.length : 0;
        const required = COMPLETE_SET_SIZE[set.color] || 3;
        if (myCount + 1 === required) {
          const targetCard = set.cards[0];
          const errors = rules_validator.validateSlyDealTarget(gameState, {
            playerId,
            targetPlayerId: oppId,
            targetPropertyColor: set.color,
            targetCardId: targetCard.id || targetCard.name
          });
          if (!errors || errors.length === 0) {
            slyTargets.push({ targetPlayerId: oppId, targetPropertyColor: set.color, cardId: targetCard.id || targetCard.name });
          }
        }
      }
    }
  }
  const slyEligible = slyTargets.length > 0;
  const slyWins = slyEligible && neededToWin === 1;
  if (slyWins && !bestImmediateWin) bestImmediateWin = "SLY_DEAL_ASSIST";

  tactics.push({
    id: "SLY_DEAL_ASSIST",
    eligible: slyEligible,
    winsImmediately: slyWins,
    targets: slyTargets,
    reason: slyEligible ? `Found ${slyTargets.length} Sly Deal targets completing a set.` : "No Sly Deal held or no matching opponent incomplete sets."
  });

  // 4. FORCED_DEAL_SWAP
  const forcedCards = hand.filter(c => c.name === 'Forced Deal' || c.id === 'action_forced_deal');
  const forcedTargets = [];
  if (forcedCards.length > 0) {
    const myIncompleteSets = sets.filter(s => !s.complete && s.cards.length > 0);
    if (myIncompleteSets.length > 0) {
      const myOfferSet = myIncompleteSets[0];
      const offerCard = myOfferSet.cards[0];
      for (const oppId of Object.keys(gameState.players)) {
        if (oppId === playerId) continue;
        const opp = gameState.players[oppId];
        const oppIncompleteSets = normalizePropertySets(opp).filter(s => !s.complete && s.cards.length > 0);
        for (const set of oppIncompleteSets) {
          const mySet = sets.find(s => s.color === set.color);
          const myCount = mySet ? mySet.cards.length : 0;
          const required = COMPLETE_SET_SIZE[set.color] || 3;
          if (myCount + 1 === required) {
            const errors = rules_validator.validateForcedDealTarget(gameState, {
              playerId,
              targetPlayerId: oppId,
              offeredCardId: offerCard.id || offerCard.name,
              offeredPropertyColor: myOfferSet.color,
              requestedCardId: set.cards[0].id || set.cards[0].name,
              requestedPropertyColor: set.color
            });
            if (!errors || errors.length === 0) {
              forcedTargets.push({ targetPlayerId: oppId, targetPropertyColor: set.color, offerCardId: offerCard.id || offerCard.name, wantCardId: set.cards[0].id || set.cards[0].name });
            }
          }
        }
      }
    }
  }
  const forcedEligible = forcedTargets.length > 0;
  const forcedWins = forcedEligible && neededToWin === 1;
  if (forcedWins && !bestImmediateWin) bestImmediateWin = "FORCED_DEAL_SWAP";

  tactics.push({
    id: "FORCED_DEAL_SWAP",
    eligible: forcedEligible,
    winsImmediately: forcedWins,
    targets: forcedTargets,
    reason: forcedEligible ? `Found ${forcedTargets.length} Forced Deal swaps completing a set.` : "No Forced Deal held or no valid incomplete set swap pairs."
  });

  return {
    playerId,
    tactics,
    bestImmediateWin
  };
}

function planFinisherSequence(gameState, playerId) {
  if (!gameState || !gameState.players || !gameState.players[playerId]) {
    throw new Error(`Invalid gameState or player ID not found: ${playerId}`);
  }

  const winProb = calculateEndgameWinProbability(gameState, playerId);
  const tacticsResult = evaluateFinisherTactics(gameState, playerId);

  const raceOpponents = winProb.opponents.map(opp => {
    let raceStatus = "TIED";
    if (opp.estimatedTurnsToWin < winProb.turnsToWin) {
      raceStatus = "TRAILING";
    } else if (opp.estimatedTurnsToWin > winProb.turnsToWin) {
      raceStatus = "LEADING";
    }
    return { playerId: opp.playerId, raceStatus, estimatedTurnsToWin: opp.estimatedTurnsToWin };
  });

  const hasImmediateThreat = raceOpponents.some(o => o.raceStatus === "TRAILING");
  const urgency = hasImmediateThreat ? "IMMEDIATE_THREAT" : "STANDARD";

  const recommendedSequence = [];
  let winsThisTurn = false;

  if (tacticsResult.bestImmediateWin) {
    winsThisTurn = true;
    const winningTactic = tacticsResult.tactics.find(t => t.id === tacticsResult.bestImmediateWin);
    const target = winningTactic.targets[0] || {};
    recommendedSequence.push({
      stepNumber: 1,
      tacticId: tacticsResult.bestImmediateWin,
      targetPlayerId: target.targetPlayerId || null,
      targetPropertyColor: target.targetPropertyColor || target.color || null,
      resultingSetsCompleted: 3,
      reason: `Immediate winning move via ${tacticsResult.bestImmediateWin}`
    });
  } else {
    const eligibleTactics = tacticsResult.tactics.filter(t => t.eligible);
    let step = 1;
    for (const t of eligibleTactics) {
      if (step > MAX_PLAYS_PER_TURN) break;
      const target = t.targets[0] || {};
      recommendedSequence.push({
        stepNumber: step,
        tacticId: t.id,
        targetPlayerId: target.targetPlayerId || null,
        targetPropertyColor: target.targetPropertyColor || target.color || null,
        resultingSetsCompleted: 1,
        reason: t.reason
      });
      step++;
    }

    if (recommendedSequence.length === 0) {
      recommendedSequence.push({
        stepNumber: 1,
        tacticId: "SINGLE_MOVE_FALLBACK",
        targetPlayerId: null,
        targetPropertyColor: null,
        resultingSetsCompleted: 0,
        reason: "No finisher tactics eligible; falling back to standard move decision."
      });
    }
  }

  return {
    playerId,
    winProbability: winProb,
    raceDetection: { opponents: raceOpponents, urgency },
    recommendedSequence,
    winsThisTurn,
    evaluatedTacticCount: tacticsResult.tactics.length
  };
}

module.exports = {
  FINISHER_TACTIC_CATALOG,
  getFinisherTacticsCatalog,
  normalizePropertySets,
  calculateEndgameWinProbability,
  evaluateFinisherTactics,
  planFinisherSequence
};
