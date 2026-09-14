const rules_validator = require("./rules_validator");
const trade_evaluator = require("./trade_evaluator");
const { MonopolyBotEngine } = require("./bot_engine");
const { HAND_LIMIT } = rules_validator;

const DISCARD_RULES_CATALOG = Object.freeze([
  {
    id: "PREFER_LOW_VALUE_MONEY_DISCARD",
    tier: 1,
    title: "Discard Lowest-Denomination Money First",
    description: "Money cards provide liquidity without property set value; discard smallest denominations first."
  },
  {
    id: "PREFER_UNPLAYABLE_ACTION_DISCARD",
    tier: 2,
    title: "Discard Dead-Weight Action Cards Before Property",
    description: "Action cards that are unplayable or redundant cost nothing to shed relative to property cards."
  },
  {
    id: "DEPRIORITIZE_NONCONTRIBUTING_PROPERTY",
    tier: 3,
    title: "Deprioritize Non-Contributing Property/Wildcard",
    description: "Properties or wildcards not advancing set completion are shed before set-completing properties."
  },
  {
    id: "PROTECT_SET_COMPLETING_PROPERTY",
    tier: 4,
    title: "Protect Set-Completing Property/Wildcard Cards",
    description: "Properties and wildcards actively building or completing sets are protected against early discard."
  },
  {
    id: "PROTECT_JUST_SAY_NO",
    tier: 5,
    title: "Never Discard Just Say No Unless Forced",
    description: "Just Say No counter-cards are essential defensive assets and are only discarded as a last resort."
  }
]);

function getDiscardRulesCatalog() {
  return DISCARD_RULES_CATALOG;
}

function evaluateDiscardCandidates(gameState, playerId) {
  if (!gameState || !gameState.players || !gameState.players[playerId]) {
    throw new Error("Invalid gameState or player ID not found");
  }

  const player = gameState.players[playerId];
  const hand = Array.isArray(player.hand) ? player.hand : [];
  const engine = new MonopolyBotEngine();
  const matrix = trade_evaluator.calculateCardValueMatrix(gameState, playerId);

  const candidates = hand.map((card) => {
    const cardId = card.id;
    let kind = engine.classifyCard(card); // 'money', 'property', 'wildcard', 'action', 'rent'
    if (card.type === "MONEY" || card.kind === "MONEY" || card.type === "money" || card.kind === "money") kind = "money";
    if (card.type === "ACTION" || card.kind === "ACTION" || card.type === "action" || card.kind === "action") kind = "action";
    if (card.type === "PROPERTY" || card.kind === "PROPERTY" || card.type === "property" || card.kind === "property") kind = "property";

    const valInfo = matrix[cardId] || { strategicValue: card.value || 0, setCompletionBoost: 0 };
    const title = card.title || "";

    let tier = 3;
    let tierLabel = "NONCONTRIBUTING_PROPERTY";
    let reason = "Non-contributing property/wildcard card";

    if (kind === "money") {
      tier = 1;
      tierLabel = "MONEY";
      reason = `Liquidity money card ($${card.value || 0}M)`;
    } else if (kind === "action") {
      if (title === "Just Say No") {
        tier = 5;
        tierLabel = "JUST_SAY_NO";
        reason = "Defensive Just Say No counter-card";
      } else {
        tier = 2;
        tierLabel = "ACTION_CARD";
        reason = `Action card '${title}'`;
      }
    } else if (kind === "property" || kind === "wildcard") {
      if (valInfo.setCompletionBoost > 0) {
        tier = 4;
        tierLabel = "PROTECTED_PROPERTY";
        reason = `Property/wildcard advancing set completion (boost ${valInfo.setCompletionBoost})`;
      } else {
        tier = 3;
        tierLabel = "NONCONTRIBUTING_PROPERTY";
        reason = `Property/wildcard with no active set boost`;
      }
    }

    const strategicVal = typeof valInfo.strategicValue === "number" ? valInfo.strategicValue : (card.value || 0);

    return {
      cardId,
      card,
      kind,
      tier,
      tierLabel,
      strategicValue: strategicVal,
      reason
    };
  });

  // Sort candidates ascending by tier first, then by strategicValue
  candidates.sort((a, b) => {
    if (a.tier !== b.tier) {
      return a.tier - b.tier;
    }
    return a.strategicValue - b.strategicValue;
  });

  return {
    playerId,
    handSize: hand.length,
    handLimit: HAND_LIMIT,
    candidates
  };
}

function optimizeTurnEndDiscards(gameState, playerId) {
  const { candidates, handSize } = evaluateDiscardCandidates(gameState, playerId);
  const excessCount = Math.max(0, handSize - HAND_LIMIT);

  if (excessCount === 0) {
    return {
      playerId,
      required: false,
      excessCount: 0,
      discardCardIds: [],
      discardSequence: [],
      postDiscardHandSize: handSize,
      candidatesConsidered: candidates.length,
      reason: `Hand is within the ${HAND_LIMIT}-card limit; no discard required.`
    };
  }

  const picks = candidates.slice(0, excessCount);
  const discardSequence = picks.map((p, i) => ({
    stepNumber: i + 1,
    cardId: p.cardId,
    tier: p.tier,
    tierLabel: p.tierLabel,
    reason: p.reason
  }));

  return {
    playerId,
    required: true,
    excessCount,
    discardCardIds: picks.map((p) => p.cardId),
    discardSequence,
    postDiscardHandSize: HAND_LIMIT,
    candidatesConsidered: candidates.length,
    reason: `Selected ${excessCount} optimal discard candidates to meet ${HAND_LIMIT}-card hand limit.`
  };
}

module.exports = {
  DISCARD_RULES_CATALOG,
  getDiscardRulesCatalog,
  evaluateDiscardCandidates,
  optimizeTurnEndDiscards
};
