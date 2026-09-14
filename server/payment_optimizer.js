const rules_validator = require("./rules_validator");
const trade_evaluator = require("./trade_evaluator");

const {
  isCompletePropertySet,
  DEBT_COLLECTOR_AMOUNT,
  BIRTHDAY_AMOUNT
} = rules_validator;

const PAYMENT_RULES_CATALOG = Object.freeze([
  {
    id: "LIQUIDATE_BANK_CASH_FIRST",
    tier: 1,
    title: "Bank Cash Notes First",
    description: "Pay from already-banked money/action cards before touching hand cash or any property."
  },
  {
    id: "LIQUIDATE_LOOSE_WILDCARDS_SINGLES",
    tier: 2,
    title: "Loose Wildcards & Non-Set Properties Next",
    description: "Give up flexible wildcards and singleton properties with no set investment before touching partial sets."
  },
  {
    id: "LIQUIDATE_INCOMPLETE_SET_PROPERTIES",
    tier: 3,
    title: "Incomplete Set Properties",
    description: "Properties with real partial progress toward a set, given up before high-value or completed-set assets."
  },
  {
    id: "LIQUIDATE_HIGH_VALUE_PROPERTIES",
    tier: 4,
    title: "High-Value Incomplete Properties",
    description: "Expensive incomplete-set properties, liquidated only once cheaper incomplete assets are exhausted."
  },
  {
    id: "PROTECT_COMPLETE_SETS_LAST_RESORT",
    tier: 5,
    title: "Break Complete Sets Only As Last Resort",
    description: "Never touch a completed monopoly unless every other asset combined is still insufficient to cover the debt."
  }
]);

function getPaymentRulesCatalog() {
  return PAYMENT_RULES_CATALOG;
}

function resolveAmountOwed(gameState, debtInput = {}) {
  if (typeof debtInput.amountOwed === 'number') {
    return debtInput.amountOwed;
  }
  const src = debtInput.debtSource;
  if (!src || !src.type) {
    throw new Error("debtInput must provide amountOwed or a debtSource descriptor");
  }
  if (src.type === 'RENT') {
    const rent = rules_validator.calculateRentAmount(gameState, src.toPlayerId, src.propertyColor);
    if (rent.errors && rent.errors.length) {
      throw new Error(rent.errors.join('; '));
    }
    return rent.totalRent;
  }
  if (src.type === 'DEBT_COLLECTOR') return DEBT_COLLECTOR_AMOUNT || 5;
  if (src.type === 'BIRTHDAY') return BIRTHDAY_AMOUNT || 2;
  throw new Error(`Unknown debtSource type: ${src.type}`);
}

function evaluatePaymentCandidates(gameState, playerId) {
  if (!gameState || !gameState.players || !gameState.players[playerId]) {
    throw new Error("Invalid gameState or player ID not found");
  }

  const player = gameState.players[playerId];
  const valueMatrix = trade_evaluator.calculateCardValueMatrix(gameState, playerId);

  const candidates = [];

  // Bank cards (Tier 1)
  const bankCards = player.bank || [];
  for (const card of bankCards) {
    const val = card.value || 0;
    candidates.push({
      cardId: card.id,
      card,
      zone: 'bank',
      kind: card.type || 'money',
      tier: 1,
      tierLabel: "Bank Cash Notes",
      value: val,
      strategicValue: (valueMatrix[card.id] || {}).strategicValue || val
    });
  }

  // Hand money/action cards (Tier 1 - cash equivalent).
  // Real Card model instances (models/MoneyCard.js, models/ActionCard.js) don't set
  // `.type`/`.types` at all - only PropertyCard (`.type` = color) and Wildcard/RentCard
  // (`.types` = color array) do. So "cash-equivalent" is: no property/wildcard marker,
  // and not Just Say No (kept in hand to block, not spent as cash). The literal
  // 'money'/'action' checks are kept too for callers that pass pre-tagged card shapes.
  const handCards = player.hand || [];
  for (const card of handCards) {
    const cardTitle = card.title || card.name || '';
    const isCashEquivalent = card.type === 'money'
      || card.type === 'action'
      || (!card.type && !card.types && cardTitle !== 'Just Say No' && cardTitle !== 'JUST_SAY_NO');
    if (isCashEquivalent) {
      const val = card.value || 0;
      candidates.push({
        cardId: card.id,
        card,
        zone: 'hand',
        kind: card.type,
        tier: 1,
        tierLabel: "Hand Cash Notes",
        value: val,
        strategicValue: (valueMatrix[card.id] || {}).strategicValue || val
      });
    }
  }

  // Board Property & Wildcard cards (Tiers 2 - 5)
  const propertiesObj = player.properties || {};
  const propertyColors = Array.isArray(propertiesObj)
    ? propertiesObj.map(p => p.color)
    : Object.keys(propertiesObj);

  for (const color of propertyColors) {
    const group = Array.isArray(propertiesObj)
      ? (propertiesObj.find(p => p.color === color) || { cards: [] })
      : (propertiesObj[color] || { cards: [] });

    const cards = group.cards || [];
    const isComplete = isCompletePropertySet(gameState, playerId, color);
    const cardCount = cards.length;

    for (const card of cards) {
      let tier = 2;
      let tierLabel = "Loose Wildcards & Non-Set Properties";

      if (isComplete) {
        tier = 5;
        tierLabel = "Complete Monopolies (Last Resort)";
      } else if (cardCount === 1) {
        tier = 2;
        tierLabel = "Singleton Property Cards";
      } else if (card.value >= 4) {
        tier = 4;
        tierLabel = "High-Value Incomplete Properties";
      } else {
        tier = 3;
        tierLabel = "Incomplete Set Properties";
      }

      const val = card.value || 0;
      candidates.push({
        cardId: card.id,
        card,
        zone: 'properties',
        color,
        kind: card.type || 'property',
        tier,
        tierLabel,
        value: val,
        strategicValue: (valueMatrix[card.id] || {}).strategicValue || val
      });
    }
  }

  // Sort candidates by tier ascending, then strategicValue ascending
  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.strategicValue - b.strategicValue;
  });

  const totalLiquidValue = candidates.reduce((sum, c) => sum + c.value, 0);

  return {
    playerId,
    totalLiquidValue,
    candidates
  };
}

function selectMinimalOverpaySubset(tierCards, remainingOwed) {
  const totalTierVal = tierCards.reduce((sum, c) => sum + c.value, 0);
  if (totalTierVal < remainingOwed) {
    return null; // Tier total alone cannot cover remaining debt
  }

  // Subset sum DP to find smallest targetSum >= remainingOwed achievable
  let achievable = { 0: [] };

  for (const card of tierCards) {
    const nextAchievable = { ...achievable };
    for (const [sumStr, list] of Object.entries(achievable)) {
      const sum = parseInt(sumStr, 10);
      const newSum = sum + card.value;
      if (!nextAchievable[newSum] || nextAchievable[newSum].length > list.length + 1) {
        nextAchievable[newSum] = [...list, card];
      }
    }
    achievable = nextAchievable;
  }

  // Find minimum sum >= remainingOwed
  const validSums = Object.keys(achievable)
    .map(Number)
    .filter(s => s >= remainingOwed)
    .sort((a, b) => a - b);

  if (validSums.length > 0) {
    const bestSum = validSums[0];
    return {
      cards: achievable[bestSum],
      sum: bestSum
    };
  }

  return { cards: tierCards, sum: totalTierVal };
}

function optimizeDebtPayment(gameState, playerId, debtInput = {}) {
  const amountOwed = resolveAmountOwed(gameState, debtInput);
  if (amountOwed <= 0) {
    return {
      playerId,
      amountOwed: 0,
      required: false,
      cardIds: [],
      propertyCardIds: [],
      settlementValue: 0,
      overpayment: 0,
      shortfall: 0,
      tiersUsed: [],
      setsBroken: []
    };
  }

  const { candidates, totalLiquidValue } = evaluatePaymentCandidates(gameState, playerId);

  if (totalLiquidValue < amountOwed) {
    // Liquidate everything available
    const cardIds = candidates.filter(c => c.zone !== 'properties').map(c => c.cardId);
    const propertyCardIds = candidates.filter(c => c.zone === 'properties').map(c => c.cardId);
    const setsBroken = [...new Set(candidates.filter(c => c.tier === 5).map(c => c.color))];
    const tiersUsed = [...new Set(candidates.map(c => c.tier))].sort((a, b) => a - b);

    return {
      playerId,
      amountOwed,
      required: true,
      cardIds,
      propertyCardIds,
      settlementValue: totalLiquidValue,
      overpayment: 0,
      shortfall: amountOwed - totalLiquidValue,
      tiersUsed,
      setsBroken
    };
  }

  // Group candidates by tier
  const byTier = {};
  for (const c of candidates) {
    byTier[c.tier] = byTier[c.tier] || [];
    byTier[c.tier].push(c);
  }

  let remaining = amountOwed;
  const picked = [];
  const tiersUsedSet = new Set();

  for (const tier of [1, 2, 3, 4, 5]) {
    if (remaining <= 0) break;
    const tierCards = byTier[tier] || [];
    if (tierCards.length === 0) continue;

    const subset = selectMinimalOverpaySubset(tierCards, remaining);
    if (subset) {
      picked.push(...subset.cards);
      tiersUsedSet.add(tier);
      remaining = 0;
      break;
    }

    // Whole tier insufficient alone, take all of it and move to next tier
    picked.push(...tierCards);
    const tierVal = tierCards.reduce((s, c) => s + c.value, 0);
    remaining -= tierVal;
    tiersUsedSet.add(tier);
  }

  const cardIds = picked.filter(c => c.zone !== 'properties').map(c => c.cardId);
  const propertyCardIds = picked.filter(c => c.zone === 'properties').map(c => c.cardId);
  const settlementValue = picked.reduce((s, c) => s + c.value, 0);
  const setsBroken = [...new Set(picked.filter(c => c.tier === 5).map(c => c.color))];
  const tiersUsed = [...tiersUsedSet].sort((a, b) => a - b);

  return {
    playerId,
    amountOwed,
    required: true,
    cardIds,
    propertyCardIds,
    settlementValue,
    overpayment: Math.max(0, settlementValue - amountOwed),
    shortfall: Math.max(0, amountOwed - settlementValue),
    tiersUsed,
    setsBroken
  };
}

module.exports = {
  PAYMENT_RULES_CATALOG,
  getPaymentRulesCatalog,
  evaluatePaymentCandidates,
  optimizeDebtPayment
};
