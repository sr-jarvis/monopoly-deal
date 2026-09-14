const rules_validator = require("./rules_validator");
const game_manager = require("./game_manager");
const { MonopolyBotEngine } = require("./bot_engine");
const combo_planner = require("./combo_planner");
const finisher_planner = require("./finisher_planner");
const discard_optimizer = require("./discard_optimizer");
const dealbreaker_defense = require("./dealbreaker_defense");
const card_effects = require("./card_effects");

const { PHASES, ACTION_TYPES, MAX_PLAYS_PER_TURN, HAND_LIMIT } = rules_validator;

const TURN_PLANNING_TACTICS = {
  AGGRESSIVE_SET_COMPLETE: {
    name: 'AGGRESSIVE_SET_COMPLETE',
    description: 'Prioritizes plays that complete or advance property sets, chasing an imminent or contested win.',
    selectionTrigger: 'finisher_planner reports winsThisTurn, or raceDetection.urgency is IMMEDIATE_THREAT'
  },
  DEFENSIVE_CONSOLIDATION: {
    name: 'DEFENSIVE_CONSOLIDATION',
    description: 'Retains Just Say No and defers set completions flagged by the Deal-Breaker defense engine.',
    selectionTrigger: 'dealbreaker_defense reports vulnerable:true with a RETAIN_JUST_SAY_NO or DEFER_SET_COMPLETION recommendation'
  },
  BALANCED_MONEY_PLAY: {
    name: 'BALANCED_MONEY_PLAY',
    description: "Default posture - bot_engine's BALANCED strategy priority ladder (advance sets, then action cards, then bank).",
    selectionTrigger: 'no elevated endgame-race or Deal-Breaker signal is present'
  },
  DISCARD_PRUNING: {
    name: 'DISCARD_PRUNING',
    description: 'No beneficial plays remain this turn; focus on discarding down to the hand limit before ending turn.',
    selectionTrigger: 'plays are exhausted or no property/action play is legal, and hand exceeds HAND_LIMIT'
  }
};

function getTurnPlanningTacticsCatalog() {
  return TURN_PLANNING_TACTICS;
}

function evaluateTurnContext(gameState, playerId) {
  if (!gameState || !gameState.players || !gameState.players[playerId]) {
    throw new Error("Invalid gameState or player ID not found");
  }
  const turn = gameState.turn;
  const player = gameState.players[playerId];

  const finisherPlan = finisher_planner.planFinisherSequence(gameState, playerId);
  const defense = dealbreaker_defense.recommendDefensiveCounterPlay(gameState, playerId);
  const combo = combo_planner.planMultiTurnCombo(gameState, playerId);

  return {
    playerId,
    phase: turn ? turn.phase : null,
    playsRemaining: turn ? Math.max(0, MAX_PLAYS_PER_TURN - (turn.playsMade || 0)) : MAX_PLAYS_PER_TURN,
    handSize: (player.hand || []).length,
    winsThisTurn: finisherPlan ? finisherPlan.winsThisTurn : false,
    raceUrgency: (finisherPlan && finisherPlan.raceDetection) ? finisherPlan.raceDetection.urgency : 'LOW_THREAT',
    dealBreakerVulnerable: defense ? defense.vulnerable : false,
    dealBreakerRecommendations: (defense && defense.recommendations) ? defense.recommendations : [],
    eligibleComboCount: combo ? combo.evaluatedCount : 0,
    recommendedCombo: combo ? combo.recommendedCombo : null
  };
}

// The charge/utility action cards the solo bot lane plays through
// game_manager.applyAction. Identified by their exact Deck.js titles via
// card_effects constants (never string literals). Standard two-color Rent is
// also in scope, but is matched structurally (card.kind === 'RENT' with exactly
// two colors) rather than by title — see selectRentCardPlay. Everything else —
// Just Say No, all-color Rent, Double The Rent, Sly Deal, Forced Deal, Deal
// Breaker, House, Hotel — stays unreachable from this lane and is banked as
// before.
const IN_SCOPE_ACTION_TITLES = Object.freeze([
  card_effects.PASS_GO_TITLE,
  card_effects.DEAL_BREAKER_TITLE,
  card_effects.SLY_DEAL_TITLE,
  card_effects.FORCED_DEAL_TITLE,
  card_effects.HOUSE_TITLE,
  card_effects.HOTEL_TITLE,
  card_effects.CHARGE_CARD_TITLES.BIRTHDAY,
  card_effects.CHARGE_CARD_TITLES.DEBT_COLLECTOR
]);

// Deterministic Debt Collector target: the opponent with the highest total
// payable assets (bank + property groups). Ties break toward the earlier
// turnOrder seat. No RNG, so the planner simulation and the app.js replay
// always agree. Returns null when the actor has no opponent in the game.
function selectDebtCollectorTarget(state, playerId) {
  const order = (state && state.turnOrder) || [];
  let best = null;
  let bestScore = -Infinity;
  for (const candidateId of order) {
    if (candidateId === playerId) continue;
    const opponent = state.players && state.players[candidateId];
    if (!opponent) continue;
    const score = rules_validator.sumPlayerAssetsValue(opponent);
    if (score > bestScore) {
      bestScore = score;
      best = candidateId;
    }
  }
  return best;
}

// Scans the actor's hand and returns a bounded PLAY_ACTION_CARD action for the
// first in-scope action card, in precedence order:
//   1. Pass Go       — draws extra cards, never parks a charge, so it never
//                      blocks the rest of the turn; played first.
//   2. Its My Birthday — charges every opponent $2M.
//   3. Debt Collector  — charges the richest opponent $5M (skipped when the
//                        target selector finds no opponent).
// Returns null when the hand holds no in-scope action card.
function selectActionCardPlay(state, playerId) {
  const player = state && state.players && state.players[playerId];
  const hand = (player && player.hand) || [];

  const passGo = hand.find(c => card_effects.isPassGoCard(c));
  if (passGo) {
    return {
      type: ACTION_TYPES.PLAY_ACTION_CARD,
      playerId,
      cardId: passGo.id,
      targetZone: 'action',
      actionCardTitle: passGo.title,
      reason: 'Play Pass Go to draw extra cards'
    };
  }

  const dealBreaker = selectDealBreakerPlay(state, playerId);
  if (dealBreaker) return dealBreaker;

  const slyDeal = selectSlyDealPlay(state, playerId);
  if (slyDeal) return slyDeal;

  const forcedDeal = selectForcedDealPlay(state, playerId);
  if (forcedDeal) return forcedDeal;

  const buildingPlay = selectBuildingCardPlay(state, playerId);
  if (buildingPlay) return buildingPlay;

  const birthday = hand.find(c => c && c.title === card_effects.CHARGE_CARD_TITLES.BIRTHDAY);
  if (birthday) {
    return {
      type: ACTION_TYPES.PLAY_ACTION_CARD,
      playerId,
      cardId: birthday.id,
      targetZone: 'action',
      actionCardTitle: birthday.title,
      reason: 'Play Its My Birthday to collect from every opponent'
    };
  }

  const debtCollector = hand.find(c => c && c.title === card_effects.CHARGE_CARD_TITLES.DEBT_COLLECTOR);
  if (debtCollector) {
    const targetPlayerId = selectDebtCollectorTarget(state, playerId);
    if (targetPlayerId) {
      return {
        type: ACTION_TYPES.PLAY_ACTION_CARD,
        playerId,
        cardId: debtCollector.id,
        targetZone: 'action',
        targetPlayerId,
        actionCardTitle: debtCollector.title,
        reason: 'Play Debt Collector against the richest opponent'
      };
    }
  }

  // Lowest precedence: a standard two-color Rent charging every opponent.
  const rentPlay = selectRentCardPlay(state, playerId);
  if (rentPlay) return rentPlay;

  return null;
}

// Sly Deal for the solo-bot lane. Scans the actor's hand for a Sly Deal card
// and checks all opponents' property sets for incomplete sets (cards.length < COMPLETE_SET_SIZE[color]).
// Scores eligible target properties:
//   Tier 3: Completes a set for the bot (bot owns ownCount + 1 === COMPLETE_SET_SIZE[color])
//   Tier 2: Advances a set for the bot (bot owns 1+ cards of color, still short)
//   Tier 1: Denies an opponent property (bot owns 0 cards of color; ranked by card value desc)
// Tie-breaking is total and deterministic: Tier desc -> Rank/ownCount desc -> turnOrder index -> COMPLETE_SET_SIZE key order -> card.id lexicographic.
function selectSlyDealPlay(state, playerId) {
  const player = state && state.players && state.players[playerId];
  if (!player) return null;
  const hand = player.hand || [];

  const slyCard = hand.find(c => card_effects.isSlyDealCard(c));
  if (!slyCard) return null;

  const turnOrder = state.turnOrder || Object.keys(state.players || {});
  const setSizeKeys = Object.keys(rules_validator.COMPLETE_SET_SIZE);

  let best = null;

  for (let oppIdx = 0; oppIdx < turnOrder.length; oppIdx++) {
    const oppId = turnOrder[oppIdx];
    if (oppId === playerId) continue;
    const opp = state.players && state.players[oppId];
    if (!opp || !opp.properties) continue;

    for (let colorIdx = 0; colorIdx < setSizeKeys.length; colorIdx++) {
      const color = setSizeKeys[colorIdx];
      const targetSize = rules_validator.COMPLETE_SET_SIZE[color];
      const group = opp.properties[color];
      if (!group || !Array.isArray(group.cards) || group.cards.length === 0) continue;

      // Sly Deal cannot steal from a complete set
      if (group.cards.length >= targetSize) continue;

      // Check bot's own property count for this color
      const botGroup = player.properties && player.properties[color];
      const botCount = botGroup && Array.isArray(botGroup.cards) ? botGroup.cards.length : 0;

      let tier = 1;
      let score = 0;
      if (botCount + 1 === targetSize) {
        tier = 3; // Completes set for bot
        score = botCount;
      } else if (botCount > 0) {
        tier = 2; // Advances set for bot
        score = botCount;
      } else {
        tier = 1; // Denial
        score = 0;
      }

      for (const card of group.cards) {
        const cardValue = card.value || 0;
        const candidate = {
          tier,
          score,
          cardValue,
          oppIdx,
          colorIdx,
          oppId,
          color,
          card
        };

        if (!best || compareSlyCandidates(candidate, best) > 0) {
          best = candidate;
        }
      }
    }
  }

  if (!best) return null;

  const action = {
    type: ACTION_TYPES.PLAY_ACTION_CARD,
    playerId,
    cardId: slyCard.id,
    targetZone: 'action',
    targetPlayerId: best.oppId,
    targetPropertyColor: best.color,
    targetCardId: best.card.id,
    actionCardTitle: card_effects.SLY_DEAL_TITLE,
    reason: `Play Sly Deal to steal ${best.card.name || best.card.title || best.color} (${best.color}) from ${best.oppId}`
  };

  const errors = rules_validator.validateSlyDealTarget(state, action);
  if (errors && errors.length > 0) return null;

  return action;
}

function compareSlyCandidates(a, b) {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.score !== b.score) return a.score - b.score;
  if (a.cardValue !== b.cardValue) return a.cardValue - b.cardValue;
  if (a.oppIdx !== b.oppIdx) return b.oppIdx - a.oppIdx;
  if (a.colorIdx !== b.colorIdx) return b.colorIdx - a.colorIdx;
  return (b.card.id || '').localeCompare(a.card.id || '');
}

// House/Hotel building card play for the solo-bot lane. Scans the actor's hand
// for House and Hotel action cards and checks owned property sets for completeness.
// If a House card is present and an eligible complete set lacks a House, returns a
// House action. If a Hotel card is present and an eligible set has a House but lacks a
// Hotel, returns a Hotel action.
function selectBuildingCardPlay(state, playerId) {
  const player = state && state.players && state.players[playerId];
  if (!player) return null;
  const hand = player.hand || [];
  const properties = player.properties || {};

  const houseCard = hand.find(c => card_effects.isHouseCard(c));
  const hotelCard = hand.find(c => card_effects.isHotelCard(c));
  if (!houseCard && !hotelCard) return null;

  const excluded = card_effects.HOUSE_HOTEL_EXCLUDED_COLORS || ['Railroad', 'Utility'];

  if (houseCard) {
    for (const [color, group] of Object.entries(properties)) {
      if (!group || excluded.includes(color)) continue;
      const targetSize = rules_validator.COMPLETE_SET_SIZE[color];
      if (!targetSize) continue;
      const cardsOwned = Array.isArray(group.cards) ? group.cards.length : 0;
      if (cardsOwned >= targetSize && !group.hasHouse) {
        return {
          type: ACTION_TYPES.PLAY_ACTION_CARD,
          playerId,
          cardId: houseCard.id,
          targetZone: 'action',
          propertyColor: color,
          actionCardTitle: houseCard.title,
          reason: `Add House to complete ${color} set`
        };
      }
    }
  }

  if (hotelCard) {
    for (const [color, group] of Object.entries(properties)) {
      if (!group || excluded.includes(color)) continue;
      const targetSize = rules_validator.COMPLETE_SET_SIZE[color];
      if (!targetSize) continue;
      const cardsOwned = Array.isArray(group.cards) ? group.cards.length : 0;
      if (cardsOwned >= targetSize && group.hasHouse && !group.hasHotel) {
        return {
          type: ACTION_TYPES.PLAY_ACTION_CARD,
          playerId,
          cardId: hotelCard.id,
          targetZone: 'action',
          propertyColor: color,
          actionCardTitle: hotelCard.title,
          reason: `Add Hotel to complete ${color} set with House`
        };
      }
    }
  }

  return null;
}

// Sum of face values of every property card on an opponent's board (bank excluded).
function opponentBoardValue(player) {
  if (!player || !player.properties) return 0;
  return Object.keys(player.properties).reduce((sum, color) => {
    const g = player.properties[color];
    const cards = (g && Array.isArray(g.cards)) ? g.cards : [];
    return sum + cards.reduce((s, c) => s + (c.value || 0), 0);
  }, 0);
}

// Deterministic All-Color Rent victim: the highest-value opponent.
// Precedence: completed-set count desc -> board value desc -> turnOrder asc.
function selectWildRentTarget(state, playerId) {
  const opps = opponentIds(state, playerId);
  let bestId = null;
  let bestKey = null;
  for (let i = 0; i < opps.length; i += 1) {
    const oppId = opps[i];
    const opp = state.players[oppId];
    const key = {
      completed: completedSetCount(state, oppId),
      board: opponentBoardValue(opp),
      order: i
    };
    if (bestId === null || compareWildRentTargets(key, bestKey) < 0) {
      bestId = oppId;
      bestKey = key;
    }
  }
  return bestId;
}

function compareWildRentTargets(a, b) {
  if (a.completed !== b.completed) return b.completed - a.completed;
  if (a.board !== b.board) return b.board - a.board;
  return a.order - b.order;
}

// Among allowedColors, evaluates calculateRentAmount and returns the color yielding
// highest rent total. Ties break lexicographically by color name (localeCompare).
function bestOwnedRentColor(state, playerId, allowedColors) {
  let best = null;
  for (const color of allowedColors) {
    if (!rules_validator.COMPLETE_SET_SIZE[color]) continue;
    const rent = rules_validator.calculateRentAmount(state, playerId, color);
    if (rent.errors && rent.errors.length) continue;
    if (!(rent.totalRent > 0)) continue;
    if (!best
      || rent.totalRent > best.amount
      || (rent.totalRent === best.amount && color.localeCompare(best.color) < 0)) {
      best = { color, amount: rent.totalRent };
    }
  }
  return best;
}

// Comparator for choosing among multiple Rent card candidates.
// Precedence: base rent amount desc -> standard over wild -> color name asc -> card id asc.
function compareRentCandidates(a, b) {
  if (a.amount !== b.amount) return b.amount - a.amount;
  const aWild = a.isWild ? 1 : 0;
  const bWild = b.isWild ? 1 : 0;
  if (aWild !== bWild) return aWild - bWild;
  const colorCmp = a.color.localeCompare(b.color);
  if (colorCmp !== 0) return colorCmp;
  return a.card.id.localeCompare(b.card.id);
}

// Standard two-color Rent & All-Color Rent (Wild Rent) for the solo-bot lane.
// Also attaches Double The Rent when a DTR card is in hand and 2+ plays remain (playsMade <= 1).
function selectRentCardPlay(state, playerId) {
  const player = state && state.players && state.players[playerId];
  if (!player) return null;
  const hand = player.hand || [];
  const playsMade = (state.turn && state.turn.playsMade) || 0;

  const dtrCard = hand.find(c => card_effects.isDoubleTheRentCard(c));
  const canDoubleThisTurn = !!dtrCard && playsMade <= 1;

  let best = null;

  for (const card of hand) {
    if (!card_effects.isRentCard(card)) continue;
    const spec = card_effects.getRentSpec(card);
    if (!spec) continue;

    const isWild = spec.targeting === card_effects.TARGETING.SINGLE_OPPONENT || spec.colors.length > 2;

    const scored = bestOwnedRentColor(state, playerId, spec.colors);
    if (!scored) continue;

    let targetPlayerId;
    if (isWild) {
      targetPlayerId = selectWildRentTarget(state, playerId);
      if (!targetPlayerId) continue;
    }

    const cand = { card, color: scored.color, amount: scored.amount, isWild, targetPlayerId };
    if (!best || compareRentCandidates(cand, best) < 0) best = cand;
  }

  if (!best) return null;

  const attachDtr = canDoubleThisTurn && best.card.id !== dtrCard.id;
  const chargedAmount = attachDtr ? best.amount * 2 : best.amount;

  const action = {
    type: ACTION_TYPES.PLAY_ACTION_CARD,
    playerId,
    cardId: best.card.id,
    targetZone: 'action',
    propertyColor: best.color,
    actionCardTitle: best.card.title
  };

  if (best.isWild) {
    action.targetPlayerId = best.targetPlayerId;
    action.reason = `Play ${best.card.title} (All-Color) to charge ${best.targetPlayerId} for the ${best.color} set ($${chargedAmount}M${attachDtr ? ', doubled with Double The Rent' : ''})`;
  } else {
    action.reason = `Play ${best.card.title} to charge every opponent for the ${best.color} set ($${chargedAmount}M${attachDtr ? ', doubled with Double The Rent' : ''})`;
  }

  if (attachDtr) action.doubleRentCardId = dtrCard.id;
  return action;
}

const COLOR_ORDER = Object.keys(rules_validator.COMPLETE_SET_SIZE);

function groupCards(state, playerId, color) {
  const g = state.players && state.players[playerId] && state.players[playerId].properties && state.players[playerId].properties[color];
  return (g && Array.isArray(g.cards)) ? g.cards : [];
}

function completedSetCount(state, playerId) {
  const p = state.players && state.players[playerId];
  if (!p) return 0;
  const win = rules_validator.checkWinCondition(p);
  return win && win.completedSetColors ? win.completedSetColors.length : 0;
}

function opponentIds(state, playerId) {
  const order = state.turnOrder || Object.keys(state.players || {});
  return order.filter(id => id !== playerId && state.players && state.players[id]);
}

function setFaceValue(state, playerId, color) {
  return groupCards(state, playerId, color).reduce((s, c) => s + (c.value || 0), 0);
}

function setRentValue(state, ownerId, color) {
  const r = rules_validator.calculateRentAmount(state, ownerId, color);
  return (r && !(r.errors && r.errors.length)) ? (r.totalRent || 0) : 0;
}

function selectDealBreakerPlay(state, playerId) {
  const player = state && state.players && state.players[playerId];
  if (!player) return null;
  const hand = player.hand || [];
  const dbCard = hand.find(c => card_effects.isDealBreakerCard(c));
  if (!dbCard) return null;

  const myCompleted = completedSetCount(state, playerId);
  const candidates = [];
  const opps = opponentIds(state, playerId);

  for (let oppIdx = 0; oppIdx < opps.length; oppIdx++) {
    const oppId = opps[oppIdx];
    for (let colorIdx = 0; colorIdx < COLOR_ORDER.length; colorIdx++) {
      const color = COLOR_ORDER[colorIdx];
      if (!rules_validator.isCompletePropertySet(state, oppId, color)) continue;

      const iAlreadyOwnComplete = rules_validator.isCompletePropertySet(state, playerId, color);
      const netSetGain = iAlreadyOwnComplete ? 0 : 1;
      const winsNow = (myCompleted + netSetGain) >= rules_validator.WIN_REQUIRED_SET_COUNT;

      const action = {
        type: ACTION_TYPES.PLAY_ACTION_CARD,
        playerId,
        cardId: dbCard.id,
        targetZone: 'action',
        targetPlayerId: oppId,
        targetPropertyColor: color
      };

      const errors = rules_validator.validateDealBreakerTarget(state, action);
      if (errors && errors.length > 0) continue;

      candidates.push({
        action,
        winsNow,
        netSetGain,
        rent: setRentValue(state, oppId, color),
        faceValue: setFaceValue(state, oppId, color),
        oppIdx,
        colorIdx
      });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort(compareDealBreaker);
  const best = candidates[0];
  return {
    ...best.action,
    actionCardTitle: dbCard.title,
    reason: `Play Deal Breaker to steal complete ${best.action.targetPropertyColor} set from ${best.action.targetPlayerId}`
  };
}

function compareDealBreaker(a, b) {
  if (a.winsNow !== b.winsNow) return (b.winsNow ? 1 : 0) - (a.winsNow ? 1 : 0);
  if (a.netSetGain !== b.netSetGain) return b.netSetGain - a.netSetGain;
  if (a.rent !== b.rent) return b.rent - a.rent;
  if (a.faceValue !== b.faceValue) return b.faceValue - a.faceValue;
  if (a.oppIdx !== b.oppIdx) return a.oppIdx - b.oppIdx;
  return a.colorIdx - b.colorIdx;
}

function selectForcedDealPlay(state, playerId) {
  const player = state && state.players && state.players[playerId];
  if (!player) return null;
  const hand = player.hand || [];
  const fdCard = hand.find(c => card_effects.isForcedDealCard(c));
  if (!fdCard) return null;

  const myCompleted = completedSetCount(state, playerId);
  const candidates = [];
  const opps = opponentIds(state, playerId);

  for (let offColorIdx = 0; offColorIdx < COLOR_ORDER.length; offColorIdx++) {
    const offColor = COLOR_ORDER[offColorIdx];
    if (rules_validator.isCompletePropertySet(state, playerId, offColor)) continue;
    const offCards = groupCards(state, playerId, offColor);
    if (offCards.length === 0) continue;

    for (let offCardIdx = 0; offCardIdx < offCards.length; offCardIdx++) {
      const offCard = offCards[offCardIdx];

      for (let oppIdx = 0; oppIdx < opps.length; oppIdx++) {
        const oppId = opps[oppIdx];

        for (let reqColorIdx = 0; reqColorIdx < COLOR_ORDER.length; reqColorIdx++) {
          const reqColor = COLOR_ORDER[reqColorIdx];
          if (rules_validator.isCompletePropertySet(state, oppId, reqColor)) continue;
          const reqCards = groupCards(state, oppId, reqColor);
          if (reqCards.length === 0) continue;

          for (let reqCardIdx = 0; reqCardIdx < reqCards.length; reqCardIdx++) {
            const reqCard = reqCards[reqCardIdx];

            const scored = scoreForcedDealSwap(state, playerId, oppId, {
              offColor,
              offCard,
              reqColor,
              reqCard,
              myCompleted
            });
            if (!scored) continue;

            const action = {
              type: ACTION_TYPES.PLAY_ACTION_CARD,
              playerId,
              cardId: fdCard.id,
              targetZone: 'action',
              targetPlayerId: oppId,
              offeredCardId: offCard.id,
              offeredPropertyColor: offColor,
              requestedCardId: reqCard.id,
              requestedPropertyColor: reqColor
            };

            const errors = rules_validator.validateForcedDealTarget(state, action);
            if (errors && errors.length > 0) continue;

            candidates.push({
              action,
              ...scored,
              oppIdx,
              reqColorIdx,
              reqCardId: reqCard.id || '',
              offColorIdx,
              offCardId: offCard.id || ''
            });
          }
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort(compareForcedDeal);
  const best = candidates[0];
  return {
    ...best.action,
    actionCardTitle: fdCard.title,
    reason: `Play Forced Deal to swap ${best.action.offeredPropertyColor} (${best.action.offeredCardId}) for ${best.action.targetPlayerId}'s ${best.action.requestedPropertyColor} (${best.action.requestedCardId})`
  };
}

function scoreForcedDealSwap(state, meId, oppId, { offColor, offCard, reqColor, reqCard, myCompleted }) {
  const reqTargetSize = rules_validator.COMPLETE_SET_SIZE[reqColor];
  const offTargetSize = rules_validator.COMPLETE_SET_SIZE[offColor];

  const myReqCards = groupCards(state, meId, reqColor);
  const myOffCards = groupCards(state, meId, offColor);
  const oppOffCards = groupCards(state, oppId, offColor);
  const oppReqCards = groupCards(state, oppId, reqColor);

  const myReqAfter = myReqCards.length + 1 - (reqColor === offColor ? 1 : 0);
  const myOffAfter = myOffCards.length - 1 + (reqColor === offColor ? 1 : 0);
  const oppOffAfter = oppOffCards.length + 1 - (reqColor === offColor ? 1 : 0);
  const oppReqAfter = oppReqCards.length - 1 + (reqColor === offColor ? 1 : 0);

  // V1 Veto: Never hand an opponent a completed set
  if (oppOffAfter >= offTargetSize) return null;

  // V3 Veto: Same-color swap with no value gain wastes a play
  if (reqColor === offColor && (reqCard.value || 0) <= (offCard.value || 0)) return null;

  const completesMySet = myReqAfter >= reqTargetSize;
  const winsNow = completesMySet && (myCompleted + 1) >= rules_validator.WIN_REQUIRED_SET_COUNT;
  const breaksMyOwnSet = myOffCards.length === offTargetSize - 1;
  const myProgress = myReqAfter / reqTargetSize;
  const denial = oppReqCards.length === reqTargetSize - 1 ? 1 : 0;
  const valueDelta = (reqCard.value || 0) - (offCard.value || 0);

  const reqIsWild = reqCard.kind === 'WILDCARD' || (reqCard.colors && reqCard.colors.length > 1);
  const offIsWild = offCard.kind === 'WILDCARD' || (offCard.colors && offCard.colors.length > 1);
  const wildcardDelta = (reqIsWild ? 1 : 0) - (offIsWild ? 1 : 0);

  return {
    winsNow,
    completesMySet,
    breaksMyOwnSet,
    myProgress,
    denial,
    valueDelta,
    wildcardDelta
  };
}

function compareForcedDeal(a, b) {
  if (a.winsNow !== b.winsNow) return (b.winsNow ? 1 : 0) - (a.winsNow ? 1 : 0);
  if (a.completesMySet !== b.completesMySet) return (b.completesMySet ? 1 : 0) - (a.completesMySet ? 1 : 0);
  if (a.breaksMyOwnSet !== b.breaksMyOwnSet) return (a.breaksMyOwnSet ? 1 : 0) - (b.breaksMyOwnSet ? 1 : 0);
  if (a.myProgress !== b.myProgress) return b.myProgress - a.myProgress;
  if (a.denial !== b.denial) return b.denial - a.denial;
  if (a.valueDelta !== b.valueDelta) return b.valueDelta - a.valueDelta;
  if (a.wildcardDelta !== b.wildcardDelta) return b.wildcardDelta - a.wildcardDelta;
  if (a.oppIdx !== b.oppIdx) return a.oppIdx - b.oppIdx;
  if (a.reqColorIdx !== b.reqColorIdx) return a.reqColorIdx - b.reqColorIdx;
  if (a.reqCardId !== b.reqCardId) return a.reqCardId.localeCompare(b.reqCardId);
  if (a.offColorIdx !== b.offColorIdx) return a.offColorIdx - b.offColorIdx;
  return a.offCardId.localeCompare(b.offCardId);
}

function translateDecisionToAction(decision, playerId) {
  if (decision.action === 'bank') {
    return { type: ACTION_TYPES.PLAY_CARD, playerId, cardId: decision.cardId, targetZone: 'bank' };
  }
  return {
    type: ACTION_TYPES.PLAY_CARD,
    playerId,
    cardId: decision.cardId,
    targetZone: decision.targetZone,
    propertyColor: decision.propertyColor
  };
}

function planTurnActionSequence(gameState, playerId, options = {}) {
  if (!gameState || !gameState.players || !gameState.players[playerId]) {
    throw new Error("Invalid gameState or player ID not found");
  }

  const context = evaluateTurnContext(gameState, playerId);

  let tactic;
  if (options.forceTactic) {
    if (!TURN_PLANNING_TACTICS[options.forceTactic]) {
      throw new Error(`Unknown turn planning tactic: ${options.forceTactic}`);
    }
    tactic = TURN_PLANNING_TACTICS[options.forceTactic];
  } else if (context.winsThisTurn || context.raceUrgency === 'IMMEDIATE_THREAT') {
    tactic = TURN_PLANNING_TACTICS.AGGRESSIVE_SET_COMPLETE;
  } else if (context.dealBreakerVulnerable && context.dealBreakerRecommendations.some(r => r.tacticId === 'RETAIN_JUST_SAY_NO' || r.tacticId === 'DEFER_SET_COMPLETION')) {
    tactic = TURN_PLANNING_TACTICS.DEFENSIVE_CONSOLIDATION;
  } else if (context.playsRemaining === 0 && context.handSize > HAND_LIMIT) {
    tactic = TURN_PLANNING_TACTICS.DISCARD_PRUNING;
  } else {
    tactic = TURN_PLANNING_TACTICS.BALANCED_MONEY_PLAY;
  }

  const strategyName = {
    AGGRESSIVE_SET_COMPLETE: 'AGGRESSIVE',
    DEFENSIVE_CONSOLIDATION: 'DEFENSIVE'
  }[tactic.name] || 'BALANCED';

  const engine = new MonopolyBotEngine(strategyName);
  let simState = JSON.parse(JSON.stringify(gameState));
  const steps = [];
  const maxSteps = options.maxSteps !== undefined ? options.maxSteps : (MAX_PLAYS_PER_TURN + 5);
  let wonGame = false;

  if (simState.turn && simState.turn.phase === PHASES.DRAW) {
    const drawRes = game_manager.applyAction(simState, { type: ACTION_TYPES.DRAW, playerId });
    if (drawRes.legal) {
      simState = drawRes.gameState;
      steps.push({ stepNumber: steps.length + 1, type: 'DRAW' });
    }
  }

  const deferredColors = tactic.name === 'DEFENSIVE_CONSOLIDATION'
    ? context.dealBreakerRecommendations.filter(r => r.tacticId === 'DEFER_SET_COMPLETION').map(r => r.targetColor)
    : [];

  while (steps.length < maxSteps) {
    let decision;
    if (options.difficultyLevel) {
      const handiRes = engine.decideMoveHandicapped(simState, playerId, {
        difficultyLevel: options.difficultyLevel,
        handicapParams: options.handicapParams
      });
      decision = handiRes ? handiRes.decision : null;
    } else {
      decision = engine.evaluateHandAndState(simState, playerId);
    }

    if (!decision) break;

    if (decision.action === 'play' && decision.targetZone === 'properties' && deferredColors.includes(decision.propertyColor)) {
      decision = { action: 'end_turn', reason: `Deferring completion of ${decision.propertyColor} per Deal-Breaker defense recommendation` };
    }

    // Bounded solo-bot action-card lane. Property plays keep priority (set
    // completion is the win condition) and discards are left alone; otherwise,
    // while a normal play is still available this turn, inject the first
    // in-scope action card (Pass Go / Its My Birthday / Debt Collector /
    // standard two-color Rent) ahead of the engine's bank/end-turn decision.
    // game_manager.applyAction is authoritative here — an illegal injection is
    // ignored and the engine's original decision proceeds unchanged.
    const isPropertyPlay = decision.action === 'play' && decision.targetZone === 'properties';
    if (!isPropertyPlay && decision.action !== 'discard'
      && simState.turn && simState.turn.phase === PHASES.ACTION
      && (simState.turn.playsMade || 0) < MAX_PLAYS_PER_TURN) {
      const actionCardPlay = selectActionCardPlay(simState, playerId);
      if (actionCardPlay) {
        const acRes = game_manager.applyAction(simState, actionCardPlay);
        if (acRes.legal) {
          simState = acRes.gameState;
          steps.push({
            stepNumber: steps.length + 1,
            type: 'PLAY_ACTION_CARD',
            cardId: actionCardPlay.cardId,
            actionCardTitle: actionCardPlay.actionCardTitle,
            targetPlayerId: actionCardPlay.targetPlayerId,
            propertyColor: actionCardPlay.propertyColor,
            targetPropertyColor: actionCardPlay.targetPropertyColor,
            targetCardId: actionCardPlay.targetCardId,
            offeredCardId: actionCardPlay.offeredCardId,
            offeredPropertyColor: actionCardPlay.offeredPropertyColor,
            requestedCardId: actionCardPlay.requestedCardId,
            requestedPropertyColor: actionCardPlay.requestedPropertyColor,
            doubleRentCardId: actionCardPlay.doubleRentCardId,
            reason: actionCardPlay.reason
          });
          if (acRes.isWinner) {
            if (acRes.winnerId === playerId) {
              wonGame = true;
              steps.push({ stepNumber: steps.length + 1, type: 'WIN' });
            } else {
              steps.push({ stepNumber: steps.length + 1, type: 'BLOCKED', reason: `Opponent ${acRes.winnerId} won the game` });
            }
            break;
          }
          // A charge parks a pendingCharge and rules_validator then rejects
          // every action but PAY_RENT; nothing else is legal this turn.
          if (simState.pendingCharge) break;
          continue;
        }
        // Illegal — fall through to the engine's original decision untouched.
      }
    }

    if (decision.action === 'discard') {
      const discardPlan = discard_optimizer.optimizeTurnEndDiscards(simState, playerId);
      if (discardPlan && discardPlan.discardCardIds && discardPlan.discardCardIds.length > 0) {
        for (const cardId of discardPlan.discardCardIds) {
          const res = game_manager.applyAction(simState, { type: ACTION_TYPES.DISCARD, playerId, cardId });
          if (!res.legal) break;
          simState = res.gameState;
          steps.push({ stepNumber: steps.length + 1, type: 'DISCARD', cardId });
        }
      }
      const endRes = game_manager.applyAction(simState, { type: ACTION_TYPES.END_TURN, playerId });
      if (endRes.legal) {
        simState = endRes.gameState;
        steps.push({ stepNumber: steps.length + 1, type: 'END_TURN', reason: 'Hand limit satisfied' });
      }
      break;
    }

    if (decision.action === 'end_turn') {
      const res = game_manager.applyAction(simState, { type: ACTION_TYPES.END_TURN, playerId });
      if (res.legal) {
        simState = res.gameState;
        steps.push({ stepNumber: steps.length + 1, type: 'END_TURN', reason: decision.reason || 'Turn ended' });
        if (simState.turn && simState.turn.phase === PHASES.DISCARD && simState.players[playerId].hand.length > HAND_LIMIT) {
          const discardPlan = discard_optimizer.optimizeTurnEndDiscards(simState, playerId);
          for (const cardId of discardPlan.discardCardIds) {
            const dRes = game_manager.applyAction(simState, { type: ACTION_TYPES.DISCARD, playerId, cardId });
            if (!dRes.legal) break;
            simState = dRes.gameState;
            steps.push({ stepNumber: steps.length + 1, type: 'DISCARD', cardId });
          }
        }
      } else {
        steps.push({ stepNumber: steps.length + 1, type: 'BLOCKED', reason: res.reason || 'Unable to end turn' });
      }
      break;
    }

    const validatorAction = translateDecisionToAction(decision, playerId);
    const res = game_manager.applyAction(simState, validatorAction);
    if (!res.legal) {
      steps.push({ stepNumber: steps.length + 1, type: 'BLOCKED', reason: res.reason || 'Illegal play' });
      break;
    }

    simState = res.gameState;
    steps.push({
      stepNumber: steps.length + 1,
      type: decision.action.toUpperCase(),
      cardId: decision.cardId,
      targetZone: decision.targetZone,
      propertyColor: decision.propertyColor,
      reason: decision.reason
    });

    if (res.isWinner) {
      wonGame = true;
      steps.push({ stepNumber: steps.length + 1, type: 'WIN' });
      break;
    }
  }

  return {
    playerId,
    tacticSelected: tactic.name,
    context,
    steps,
    finalHandSize: simState.players[playerId].hand.length,
    wonGame
  };
}

module.exports = {
  TURN_PLANNING_TACTICS,
  getTurnPlanningTacticsCatalog,
  evaluateTurnContext,
  planTurnActionSequence,
  translateDecisionToAction,
  selectActionCardPlay,
  selectDealBreakerPlay,
  selectSlyDealPlay,
  selectForcedDealPlay,
  selectBuildingCardPlay,
  selectRentCardPlay,
  selectDebtCollectorTarget,
  selectWildRentTarget,
  opponentBoardValue,
  bestOwnedRentColor,
  compareRentCandidates
};