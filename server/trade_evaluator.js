const card_catalog = require("./card_catalog");
const Deck = require("./models/Deck");

const COMPLETION_BOOST_MULTIPLIERS = {
  COMPLETING_CARD: 3.0,
  PENULTIMATE_CARD: 1.5,
  EARLY_CARD: 1.0,
};

const DENIAL_WEIGHTS = {
  COMPLETES_OPPONENT_SET: 1.0,
  LEAVES_OPPONENT_ONE_AWAY: 0.4,
};

const COMPLETE_SET_SIZE = {
  DarkBlue: 2,
  Brown: 2,
  Utility: 2,
  Green: 3,
  Yellow: 3,
  Red: 3,
  Orange: 3,
  Pink: 3,
  Purple: 3,
  LightBlue: 3,
  Railroad: 4,
};

function getTradeAcceptanceThresholds(opts = {}) {
  const riskProfile = opts.riskProfile || "MODERATE";
  const validProfiles = ["CONSERVATIVE", "MODERATE", "HIGH_RISK"];
  if (opts.riskProfile && !validProfiles.includes(opts.riskProfile)) {
    throw new Error(`Unknown risk profile: ${opts.riskProfile}`);
  }

  if (riskProfile === "HIGH_RISK") {
    return { acceptNetValue: -1, counterNetValue: -3 };
  } else if (riskProfile === "CONSERVATIVE") {
    return { acceptNetValue: 2, counterNetValue: 0 };
  }
  return { acceptNetValue: 0, counterNetValue: -2 };
}

function calculateCardValueMatrix(gameState = null, playerId = null) {
  const catalog = card_catalog.getCardCatalog();
  const matrix = {};

  const allItems = [
    ...(catalog.properties || []).map((c) => ({ id: c.title, name: c.title, type: "property", color: c.color, value: c.value })),
    ...(catalog.wildcards || []).map((c) => ({ id: c.title, name: c.title, type: "wildcard", colors: c.types, value: c.value })),
    ...(catalog.rentCards || []).map((c) => ({ id: c.title, name: c.title, type: "rent", value: c.value })),
    ...(catalog.actionCards || []).map((c) => ({ id: c.title, name: c.title, type: "action", value: c.value })),
    ...(catalog.moneyCards || []).map((c) => ({ id: c.title, name: c.title, type: "money", value: c.value })),
  ];

  for (const card of allItems) {
    const cardId = card.id;
    const baseValue = card.value || 0;
    let setCompletionBoost = 0;
    let monopolyDenialValue = 0;

    if (gameState && playerId && gameState.players && gameState.players[playerId]) {
      const player = gameState.players[playerId];
      if (card.type === "property" || card.type === "wildcard") {
        const colors = card.color ? [card.color] : (card.colors || []);
        let maxBoost = 0;

        for (const col of colors) {
          const req = COMPLETE_SET_SIZE[col] || 3;
          let currentCount = 0;
          if (player.properties && player.properties[col] && player.properties[col].cards) {
            currentCount = player.properties[col].cards.length;
          }
          if (currentCount + 1 >= req) {
            maxBoost = Math.max(maxBoost, baseValue * (COMPLETION_BOOST_MULTIPLIERS.COMPLETING_CARD - 1));
          } else if (currentCount + 2 >= req) {
            maxBoost = Math.max(maxBoost, baseValue * (COMPLETION_BOOST_MULTIPLIERS.PENULTIMATE_CARD - 1));
          }
        }
        setCompletionBoost = maxBoost;

        let maxDenial = 0;
        for (const [oppId, opp] of Object.entries(gameState.players)) {
          if (oppId === playerId) continue;
          for (const col of colors) {
            const req = COMPLETE_SET_SIZE[col] || 3;
            let currentCount = 0;
            if (opp.properties && opp.properties[col] && opp.properties[col].cards) {
              currentCount = opp.properties[col].cards.length;
            }
            if (currentCount + 1 >= req) {
              maxDenial = Math.max(maxDenial, baseValue * DENIAL_WEIGHTS.COMPLETES_OPPONENT_SET);
            } else if (currentCount + 2 >= req) {
              maxDenial = Math.max(maxDenial, baseValue * DENIAL_WEIGHTS.LEAVES_OPPONENT_ONE_AWAY);
            }
          }
        }
        monopolyDenialValue = maxDenial;
      }
    }

    matrix[cardId] = {
      cardId,
      name: card.name,
      type: card.type,
      baseValue,
      setCompletionBoost: Math.round(setCompletionBoost * 10) / 10,
      monopolyDenialValue: Math.round(monopolyDenialValue * 10) / 10,
      strategicValue: Math.round((baseValue + setCompletionBoost + monopolyDenialValue) * 10) / 10,
    };
  }

  return matrix;
}

function locateCard(player, cardId) {
  if (!player) return null;
  if (player.hand) {
    const found = player.hand.find((c) => c.id === cardId || c.name === cardId || c.title === cardId);
    if (found) return found;
  }
  if (player.bank) {
    const found = player.bank.find((c) => c.id === cardId || c.name === cardId || c.title === cardId);
    if (found) return found;
  }
  if (player.properties) {
    for (const group of Object.values(player.properties)) {
      if (group && group.cards) {
        const found = group.cards.find((c) => c.id === cardId || c.name === cardId || c.title === cardId);
        if (found) return found;
      }
    }
  }
  return null;
}

function evaluateTradeOffer(gameState, params = {}) {
  const {
    proposingPlayerId,
    respondingPlayerId,
    offeredCardIds = [],
    requestedCardIds = [],
    riskProfile = "MODERATE",
  } = params;

  if (!proposingPlayerId || !respondingPlayerId) {
    throw new Error("Must provide both proposingPlayerId and respondingPlayerId");
  }
  if (!Array.isArray(offeredCardIds) || offeredCardIds.length === 0) {
    throw new Error("offeredCardIds must be a non-empty array");
  }
  if (!Array.isArray(requestedCardIds) || requestedCardIds.length === 0) {
    throw new Error("requestedCardIds must be a non-empty array");
  }
  if (!gameState || !gameState.players || !gameState.players[proposingPlayerId] || !gameState.players[respondingPlayerId]) {
    throw new Error("Invalid gameState or player IDs not found");
  }

  const proposer = gameState.players[proposingPlayerId];
  const responder = gameState.players[respondingPlayerId];

  const matrix = calculateCardValueMatrix(gameState, respondingPlayerId);

  const offeredBreakdown = [];
  let offeredValue = 0;
  for (const cardId of offeredCardIds) {
    const card = locateCard(proposer, cardId);
    if (!card) {
      throw new Error(`Offered card id '${cardId}' not found in proposer's zones`);
    }
    const key = card.id || card.name || card.title;
    const valObj = matrix[key] || { strategicValue: card.value || 0 };
    const stratVal = valObj.strategicValue !== undefined ? valObj.strategicValue : (card.value || 0);
    offeredValue += stratVal;
    offeredBreakdown.push({ cardId: key, name: card.name || card.title || key, strategicValue: stratVal });
  }

  const requestedBreakdown = [];
  let requestedValue = 0;
  for (const cardId of requestedCardIds) {
    const card = locateCard(responder, cardId);
    if (!card) {
      throw new Error(`Requested card id '${cardId}' not found in responder's zones`);
    }
    const key = card.id || card.name || card.title;
    const valObj = matrix[key] || { strategicValue: card.value || 0 };
    const stratVal = valObj.strategicValue !== undefined ? valObj.strategicValue : (card.value || 0);
    requestedValue += stratVal;
    requestedBreakdown.push({ cardId: key, name: card.name || card.title || key, strategicValue: stratVal });
  }

  offeredValue = Math.round(offeredValue * 10) / 10;
  requestedValue = Math.round(requestedValue * 10) / 10;
  const netValueToResponder = Math.round((offeredValue - requestedValue) * 10) / 10;

  const thresholds = getTradeAcceptanceThresholds({ riskProfile });

  let recommendation = "REJECT";
  if (netValueToResponder >= thresholds.acceptNetValue) {
    recommendation = "ACCEPT";
  } else if (netValueToResponder >= thresholds.counterNetValue) {
    recommendation = "COUNTER";
  }

  return {
    proposingPlayerId,
    respondingPlayerId,
    offeredValue,
    requestedValue,
    netValueToResponder,
    recommendation,
    thresholdsApplied: thresholds,
    offeredBreakdown,
    requestedBreakdown,
  };
}

module.exports = {
  calculateCardValueMatrix,
  getTradeAcceptanceThresholds,
  evaluateTradeOffer,
};
