const cardCatalogModule = require("./card_catalog");

function roundVal(v) {
  return Math.round(v * 10000) / 10000;
}

function probabilityHoldsAtLeastOne(unseenTotal, unseenCopiesOfCard, handSize) {
  if (unseenTotal <= 0 || handSize <= 0 || unseenCopiesOfCard <= 0) return 0;
  let probNone = 1;
  for (let i = 0; i < handSize && probNone > 0; i++) {
    const remainingTotal = unseenTotal - i;
    const remainingNonMatching = (unseenTotal - unseenCopiesOfCard) - i;
    if (remainingTotal <= 0) break;
    if (remainingNonMatching < 0) { probNone = 0; break; }
    probNone *= remainingNonMatching / remainingTotal;
  }
  return roundVal(1 - probNone);
}

const COUNTER_TACTICS_CATALOG = [
  {
    threatType: "DEAL_BREAKER_RISK",
    counterTactic: "RETAIN_JUST_SAY_NO",
    rationale: "Hold Just Say No in hand to immediately cancel a Deal Breaker set steal attempt."
  },
  {
    threatType: "SLY_DEAL_RISK",
    counterTactic: "COMPLETE_EXPOSED_SET",
    rationale: "Complete partial property sets quickly because Sly Deal cannot steal cards from full sets."
  },
  {
    threatType: "FORCED_DEAL_RISK",
    counterTactic: "AVOID_LOW_VALUE_SWAP_BAIT",
    rationale: "Avoid leaving high-value isolated properties exposed without low-value swap buffer cards."
  },
  {
    threatType: "RENT_ATTACK_RISK",
    counterTactic: "BUILD_BANK_LIQUIDITY_BUFFER",
    rationale: "Deposit cash and action cards in the bank zone so rent charges do not force property surrenders."
  },
  {
    threatType: "SET_COMPLETION_RACE",
    counterTactic: "ACCELERATE_OWN_SET_OR_DENY",
    rationale: "Prioritize playing property cards to complete sets before the opponent or hold denial cards in hand."
  }
];

function getCounterTacticsCatalog() {
  return COUNTER_TACTICS_CATALOG;
}

function inferOpponentHand(gameState, opponentPlayerId, observerPlayerId = null) {
  if (!gameState || !gameState.players || !gameState.players[opponentPlayerId]) {
    throw new Error("Invalid or missing opponent player in gameState");
  }

  const opp = gameState.players[opponentPlayerId];
  // Information boundary rule: read ONLY hand.length, never hand contents.
  const handSize = Array.isArray(opp.hand) ? opp.hand.length : 0;

  // Gather visible cards across public domains
  let visibleCards = [];

  // Observer's hand (if observer specified)
  if (observerPlayerId && gameState.players[observerPlayerId] && Array.isArray(gameState.players[observerPlayerId].hand)) {
    visibleCards.push(...gameState.players[observerPlayerId].hand);
  }

  // All players' banks & properties
  Object.keys(gameState.players).forEach(pId => {
    const p = gameState.players[pId];
    if (Array.isArray(p.bank)) {
      visibleCards.push(...p.bank);
    }
    if (p.properties && typeof p.properties === 'object') {
      Object.keys(p.properties).forEach(color => {
        const zone = p.properties[color];
        if (zone && Array.isArray(zone.cards)) {
          visibleCards.push(...zone.cards);
        }
      });
    }
  });

  // Discard pile
  if (Array.isArray(gameState.discardPile)) {
    visibleCards.push(...gameState.discardPile);
  }

  const catalog = cardCatalogModule.getCardCatalog();
  const totalDeckCards = catalog.totalCards || 106;
  const unseenTotal = Math.max(0, totalDeckCards - visibleCards.length);

  // Count visible occurrences of key card titles
  const visibleCounts = {};
  visibleCards.forEach(card => {
    if (card && card.title) {
      visibleCounts[card.title] = (visibleCounts[card.title] || 0) + 1;
    }
  });

  // Key cards analysis
  const keyCards = [
    { title: "Deal Breaker", totalInDeck: 2, threatType: "DEAL_BREAKER_RISK" },
    { title: "Just Say No", totalInDeck: 3, threatType: "JUST_SAY_NO_DEFENSE" },
    { title: "Sly Deal", totalInDeck: 3, threatType: "SLY_DEAL_RISK" },
    { title: "Forced Deal", totalInDeck: 3, threatType: "FORCED_DEAL_RISK" },
    { title: "Debt Collector", totalInDeck: 3, threatType: "RENT_ATTACK_RISK" },
    { title: "Double the Rent", totalInDeck: 2, threatType: "RENT_ATTACK_RISK" }
  ];

  const cardProbabilities = {};
  const inferredThreats = [];

  keyCards.forEach(kc => {
    const seen = visibleCounts[kc.title] || 0;
    const unseenCopies = Math.max(0, kc.totalInDeck - seen);
    const prob = probabilityHoldsAtLeastOne(unseenTotal, unseenCopies, handSize);
    cardProbabilities[kc.title] = {
      totalInDeck: kc.totalInDeck,
      visibleCopies: seen,
      unseenCopies: unseenCopies,
      probabilityHeld: prob
    };

    if (kc.threatType && prob > 0) {
      let severity = "LOW";
      if (prob >= 0.75) severity = "CRITICAL";
      else if (prob >= 0.50) severity = "HIGH";
      else if (prob >= 0.25) severity = "MEDIUM";

      inferredThreats.push({
        threatType: kc.threatType,
        cardTitle: kc.title,
        probabilityHeld: prob,
        severity: severity
      });
    }
  });

  // Check Set Completion Race (board-visible properties 1 card away from full set)
  const setRequirements = {
    brown: 2, dark_blue: 2, green: 3, light_blue: 3,
    orange: 3, pink: 3, railroad: 4, red: 3, utility: 2, yellow: 3
  };

  if (opp.properties && typeof opp.properties === 'object') {
    Object.keys(opp.properties).forEach(color => {
      const zone = opp.properties[color];
      const required = setRequirements[color] || 3;
      if (zone && Array.isArray(zone.cards) && zone.cards.length === required - 1) {
        inferredThreats.push({
          threatType: "SET_COMPLETION_RACE",
          color: color,
          cardsHeldInZone: zone.cards.length,
          requiredForSet: required,
          severity: "HIGH"
        });
      }
    });
  }

  // Estimate card composition
  const estimatedComposition = {
    money: roundVal(handSize * (20 / totalDeckCards)),
    property: roundVal(handSize * (28 / totalDeckCards)),
    action: roundVal(handSize * (34 / totalDeckCards)),
    wildcard: roundVal(handSize * (13 / totalDeckCards)),
    rent: roundVal(handSize * (13 / totalDeckCards))
  };

  return {
    opponentPlayerId,
    handSize,
    unseenPoolSize: unseenTotal,
    estimatedComposition,
    cardProbabilities,
    inferredThreats
  };
}

function evaluateDefensiveMove(hand, inferredThreats) {
  if (!Array.isArray(inferredThreats) || inferredThreats.length === 0) {
    return { recommendedCounters: [], unaddressedThreats: [] };
  }

  const playerHand = Array.isArray(hand) ? hand : [];
  const hasJustSayNo = playerHand.some(c => c && c.title === "Just Say No");

  const severityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const sortedThreats = [...inferredThreats].sort((a, b) => (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0));

  const recommendedCounters = [];
  const unaddressedThreats = [];

  sortedThreats.forEach(threat => {
    const tacticObj = COUNTER_TACTICS_CATALOG.find(t => t.threatType === threat.threatType);
    let actionable = false;

    if (threat.threatType === "DEAL_BREAKER_RISK") {
      actionable = hasJustSayNo;
    } else if (threat.threatType === "SLY_DEAL_RISK" || threat.threatType === "FORCED_DEAL_RISK") {
      actionable = playerHand.some(c => c && (c.type === "property" || c.type === "wildcard"));
    } else if (threat.threatType === "RENT_ATTACK_RISK") {
      actionable = playerHand.some(c => c && c.type === "money");
    } else if (threat.threatType === "SET_COMPLETION_RACE") {
      actionable = playerHand.some(c => c && (c.type === "property" || c.type === "wildcard"));
    }

    if (tacticObj) {
      recommendedCounters.push({
        threatType: threat.threatType,
        counterTactic: tacticObj.counterTactic,
        actionable: actionable,
        reason: tacticObj.rationale,
        threatSeverity: threat.severity
      });
    } else {
      unaddressedThreats.push(threat);
    }
  });

  return {
    recommendedCounters,
    unaddressedThreats
  };
}

module.exports = {
  inferOpponentHand,
  getCounterTacticsCatalog,
  evaluateDefensiveMove,
  probabilityHoldsAtLeastOne
};
