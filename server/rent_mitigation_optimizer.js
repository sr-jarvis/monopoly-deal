const rules_validator = require("./rules_validator");
const trade_evaluator = require("./trade_evaluator");

const RENT_MITIGATION_CATALOG = Object.freeze([
  {
    tier: 0,
    id: "JUST_SAY_NO_CANCEL",
    title: "Just Say No Counter-Action",
    description: "Cancel incoming rent demand immediately using Just Say No without paying any assets."
  },
  {
    tier: 1,
    id: "LIQUIDATE_BANK_CASH",
    title: "Bank Cash Notes First",
    description: "Pay rent demand using banked money/action notes before touching any property assets."
  },
  {
    tier: 2,
    id: "LIQUIDATE_LOOSE_WILDCARDS",
    title: "Loose Wildcards & Non-Set Properties",
    description: "Surrender flexible wildcards and singleton properties with no set progress."
  },
  {
    tier: 3,
    id: "LIQUIDATE_INCOMPLETE_SET",
    title: "Incomplete Set Properties",
    description: "Surrender properties from partial sets before touching high-value or completed sets."
  },
  {
    tier: 4,
    id: "LIQUIDATE_HIGH_VALUE_PROPERTIES",
    title: "High-Value Incomplete Properties",
    description: "Surrender high-value incomplete set cards ($4M+) when cheaper assets are exhausted."
  },
  {
    tier: 5,
    id: "PROTECT_COMPLETE_SET_LAST_RESORT",
    title: "Break Complete Sets Last Resort",
    description: "Touch completed monopoly sets only if all other assets are exhausted."
  }
]);

function getRentMitigationCatalog() {
  return RENT_MITIGATION_CATALOG;
}

function evaluateRentPaymentImpact(gameState, playerId, settlement = {}) {
  if (!gameState || !gameState.players || !gameState.players[playerId]) {
    throw new Error("Invalid gameState or player ID not found");
  }

  const player = gameState.players[playerId];
  const cardIds = settlement.cardIds || [];
  const propertyCardIds = settlement.propertyCardIds || [];
  const errors = [];

  const allSelectedIds = [...new Set([...cardIds, ...propertyCardIds])];

  let settlementValue = 0;
  let wildcardsUsed = 0;
  let propertiesUsed = 0;
  let breaksCompleteSet = false;
  const setsBroken = [];

  const propertiesObj = player.properties || {};
  const propertyColors = Array.isArray(propertiesObj)
    ? propertiesObj.map(p => p.color)
    : Object.keys(propertiesObj);

  const completedColors = new Set();
  for (const color of propertyColors) {
    if (rules_validator.isCompletePropertySet(gameState, playerId, color)) {
      completedColors.add(color);
    }
  }

  const bankCards = player.bank || [];
  const handCards = player.hand || [];
  const cardMap = new Map();
  for (const c of [...bankCards, ...handCards]) cardMap.set(c.id, { card: c, zone: 'cash' });

  for (const color of propertyColors) {
    const group = Array.isArray(propertiesObj)
      ? (propertiesObj.find(p => p.color === color) || { cards: [] })
      : (propertiesObj[color] || { cards: [] });

    for (const c of (group.cards || [])) {
      cardMap.set(c.id, { card: c, zone: 'property', color });
    }
  }

  for (const id of allSelectedIds) {
    const found = cardMap.get(id);
    if (!found) {
      errors.push(`Card ID ${id} not found in player assets`);
      continue;
    }
    const card = found.card;
    settlementValue += card.value || 0;

    if (found.zone === 'property') {
      propertiesUsed++;
      if (card.type === 'wildcard') wildcardsUsed++;
      if (completedColors.has(found.color)) {
        breaksCompleteSet = true;
        if (!setsBroken.includes(found.color)) {
          setsBroken.push(found.color);
        }
      }
    }
  }

  let strategyType = "NONE";
  if (allSelectedIds.length > 0) {
    if (breaksCompleteSet) {
      strategyType = "SET_BREAK";
    } else if (propertiesUsed > wildcardsUsed) {
      strategyType = "PROPERTY_BREAK";
    } else if (wildcardsUsed > 0) {
      strategyType = "WILDCARD_BREAK";
    } else {
      strategyType = "CASH";
    }
  }

  const impactScore = (breaksCompleteSet ? 100 : 0) + setsBroken.length * 50 + propertiesUsed * 10 + wildcardsUsed * 5;

  return {
    settlementValue,
    cardsSelected: allSelectedIds.length,
    propertiesUsed,
    wildcardsUsed,
    breaksCompleteSet,
    setsBroken,
    strategyType,
    impactScore,
    errors
  };
}

function selectOptimalRentSettlement(gameState, playerId, rentAmount) {
  if (!gameState || !gameState.players || !gameState.players[playerId]) {
    throw new Error("Invalid gameState or player ID not found");
  }
  if (typeof rentAmount !== 'number' || rentAmount < 0) {
    throw new Error("rentAmount must be a non-negative number");
  }

  if (rentAmount === 0) {
    return {
      rentAmount: 0,
      paidValue: 0,
      shortfall: 0,
      cardIds: [],
      propertyCardIds: [],
      impact: evaluateRentPaymentImpact(gameState, playerId, { cardIds: [] })
    };
  }

  const payment_optimizer = require("./payment_optimizer");
  const opt = payment_optimizer.optimizeDebtPayment(gameState, playerId, { amountOwed: rentAmount });

  const cardIds = opt.cardIds || [];
  const propertyCardIds = opt.propertyCardIds || [];
  const impact = evaluateRentPaymentImpact(gameState, playerId, { cardIds, propertyCardIds });

  return {
    rentAmount,
    paidValue: opt.settlementValue || 0,
    shortfall: opt.shortfall || 0,
    cardIds,
    propertyCardIds,
    impact
  };
}

function optimizeRentDefense(gameState, payerId, ownerId, propertyColor) {
  if (!gameState || !gameState.players) {
    throw new Error("Invalid gameState");
  }
  if (!gameState.players[payerId] || !gameState.players[ownerId]) {
    throw new Error("Payer or Owner player ID not found in gameState");
  }
  if (payerId === ownerId) {
    throw new Error("Payer and Owner cannot be the same player");
  }

  const rentCalc = rules_validator.calculateRentAmount(gameState, ownerId, propertyColor);
  if (rentCalc.errors && rentCalc.errors.length) {
    throw new Error(rentCalc.errors.join("; "));
  }

  const payer = gameState.players[payerId];
  const hand = payer.hand || [];
  const jsnCard = hand.find(c => c.name === "JUST_SAY_NO" || c.id === "JUST_SAY_NO");

  if (jsnCard && rentCalc.totalRent > 0) {
    return {
      required: true,
      rentAmount: rentCalc.totalRent,
      recommendation: "PLAY_JUST_SAY_NO",
      cardToPlay: jsnCard,
      reason: "Cancel incoming rent demand at zero asset cost using Just Say No",
      settlement: {
        rentAmount: rentCalc.totalRent,
        paidValue: 0,
        shortfall: 0,
        cardIds: [],
        propertyCardIds: [],
        impact: {
          settlementValue: 0,
          cardsSelected: 0,
          propertiesUsed: 0,
          wildcardsUsed: 0,
          breaksCompleteSet: false,
          setsBroken: [],
          strategyType: "JUST_SAY_NO",
          impactScore: 0,
          errors: []
        }
      }
    };
  }

  const settlement = selectOptimalRentSettlement(gameState, payerId, rentCalc.totalRent);

  return {
    required: rentCalc.totalRent > 0,
    rentAmount: rentCalc.totalRent,
    recommendation: rentCalc.totalRent === 0 ? "NO_RENT_DUE" : "PAY_RENT_SETTLEMENT",
    reason: rentCalc.totalRent === 0 ? "No properties owned in requested color" : "Pay rent via minimal-impact asset liquidation",
    settlement
  };
}

module.exports = {
  RENT_MITIGATION_CATALOG,
  getRentMitigationCatalog,
  evaluateRentPaymentImpact,
  selectOptimalRentSettlement,
  optimizeRentDefense
};
