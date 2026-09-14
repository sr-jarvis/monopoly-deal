const rules_validator = require("./rules_validator");
const hand_inference = require("./hand_inference");

const { isCompletePropertySet, calculateRentAmount } = rules_validator;

const THREAT_MITIGATION_CATALOG = Object.freeze([
  {
    id: "RETAIN_JUST_SAY_NO",
    appliesWhen: "COMPLETE_SET_EXISTS_AND_JSN_HELD",
    title: "Hold Just Say No In Reserve",
    description: "Keep at least one Just Say No unplayed and unbanked to cancel an incoming Deal Breaker against a completed set."
  },
  {
    id: "DEFER_SET_COMPLETION",
    appliesWhen: "ONE_CARD_FROM_COMPLETION_UNDER_THREAT",
    title: "Defer Completing An Exposed Set",
    description: "Delay playing the final card of a set when Deal Breaker risk is high and no Just Say No is available — Deal Breaker cannot legally target an incomplete set."
  },
  {
    id: "ACCELERATE_WIN_RACE",
    appliesWhen: "VULNERABLE_NO_JSN",
    title: "Race To Win Before Exposure Is Exploited",
    description: "With no Just Say No available, prioritize completing remaining needed sets rather than leaving a completed monopoly exposed indefinitely."
  },
  {
    id: "PRIORITIZE_JSN_ACQUISITION",
    appliesWhen: "VULNERABLE_NO_JSN",
    title: "Retain Future Just Say No Draws",
    description: "Informational only: keep any Just Say No drawn in future turns unbanked while a complete set remains exposed."
  }
]);

function getThreatMitigationCatalog() {
  return THREAT_MITIGATION_CATALOG;
}

function calculateSetExposureRiskScores(gameState, playerId) {
  if (!gameState || !gameState.players || !gameState.players[playerId]) {
    throw new Error("Invalid gameState or player ID not found");
  }

  const player = gameState.players[playerId];
  const setExposure = [];

  const PROPERTY_COLORS = [
    "DarkBlue", "Brown", "Green", "LightBlue", "Orange", "Pink", "Railroad", "Utility", "Red", "Yellow"
  ];

  // Derive probability any opponent holds Deal Breaker
  let probabilityAnyOpponentHoldsDealBreaker = 0.0;
  const opponentIds = Object.keys(gameState.players).filter(id => id !== playerId);

  if (opponentIds.length > 0) {
    let unheldProduct = 1.0;
    opponentIds.forEach(oppId => {
      try {
        const inf = hand_inference.inferOpponentHand(gameState, oppId, playerId);
        const dbProb = inf.cardProbabilities["Deal Breaker"]
          ? inf.cardProbabilities["Deal Breaker"].probabilityHeld
          : 0.1;
        unheldProduct *= (1 - dbProb);
      } catch (err) {
        unheldProduct *= (1 - 0.1);
      }
    });
    probabilityAnyOpponentHoldsDealBreaker = Math.round((1 - unheldProduct) * 100) / 100;
  }

  PROPERTY_COLORS.forEach(color => {
    let complete = false;
    try {
      complete = isCompletePropertySet(gameState, playerId, color);
    } catch (e) {
      complete = false;
    }

    if (complete) {
      let setFaceValue = 0;
      if (player.properties && player.properties[color] && Array.isArray(player.properties[color].cards)) {
        setFaceValue = player.properties[color].cards.reduce((sum, c) => sum + (c.value || 0), 0);
      } else if (Array.isArray(player.properties)) {
        const group = player.properties.find(g => g.color === color);
        if (group && Array.isArray(group.cards)) {
          setFaceValue = group.cards.reduce((sum, c) => sum + (c.value || 0), 0);
        }
      }

      let rentGen = 0;
      try {
        const rentObj = calculateRentAmount(gameState, playerId, color);
        rentGen = rentObj ? (rentObj.totalRent || rentObj.baseRent || 0) : 0;
      } catch (e) {
        rentGen = 0;
      }

      const impact = setFaceValue + rentGen;
      const exposureRiskScore = Math.round(impact * probabilityAnyOpponentHoldsDealBreaker * 100) / 100;

      setExposure.push({
        color,
        setFaceValue,
        rentGenerationValue: rentGen,
        impact,
        probabilityAnyOpponentHoldsDealBreaker,
        exposureRiskScore
      });
    }
  });

  setExposure.sort((a, b) => b.exposureRiskScore - a.exposureRiskScore);

  const overallExposureScore = setExposure.reduce((sum, s) => sum + s.exposureRiskScore, 0);

  return {
    playerId,
    setExposure,
    overallExposureScore: Math.round(overallExposureScore * 100) / 100,
    mostVulnerableSet: setExposure.length > 0 ? setExposure[0].color : null
  };
}

function assessDealBreakerVulnerability(gameState, playerId) {
  const scores = calculateSetExposureRiskScores(gameState, playerId);
  const player = gameState.players[playerId];

  const vulnerable = scores.setExposure.length > 0;
  const opponentIds = Object.keys(gameState.players).filter(id => id !== playerId);

  const perOpponentThreats = opponentIds.map(oppId => {
    let probabilityHeld = 0.1;
    try {
      const inf = hand_inference.inferOpponentHand(gameState, oppId, playerId);
      if (inf.cardProbabilities["Deal Breaker"]) {
        probabilityHeld = inf.cardProbabilities["Deal Breaker"].probabilityHeld;
      }
    } catch (e) {
      probabilityHeld = 0.1;
    }

    let severity = "LOW";
    if (probabilityHeld >= 0.75) severity = "CRITICAL";
    else if (probabilityHeld >= 0.50) severity = "HIGH";
    else if (probabilityHeld >= 0.25) severity = "MEDIUM";

    return {
      opponentPlayerId: oppId,
      probabilityHeld,
      severity
    };
  });

  const hasJustSayNoInHand = (player.hand || []).some(
    c => c && (c.title === "Just Say No" || c.name === "Just Say No" || c.type === "action" && c.actionType === "just_say_no")
  );

  const SET_SIZES = {
    DarkBlue: 2, Utility: 2, Brown: 2,
    Green: 3, LightBlue: 3, Orange: 3, Pink: 3, Red: 3, Yellow: 3, Railroad: 4
  };

  const nearCompleteSets = [];
  Object.keys(SET_SIZES).forEach(color => {
    let cardsInColor = 0;
    if (player.properties && player.properties[color] && Array.isArray(player.properties[color].cards)) {
      cardsInColor = player.properties[color].cards.length;
    } else if (Array.isArray(player.properties)) {
      const grp = player.properties.find(g => g.color === color);
      if (grp && Array.isArray(grp.cards)) cardsInColor = grp.cards.length;
    }

    const reqSize = SET_SIZES[color];
    if (cardsInColor === reqSize - 1) {
      nearCompleteSets.push({
        color,
        cardsHeld: cardsInColor,
        required: reqSize,
        currentlySafe: true,
        reason: "Incomplete sets are immune to Deal Breaker"
      });
    }
  });

  return {
    playerId,
    vulnerable,
    completeSetCount: scores.setExposure.length,
    overallExposureScore: scores.overallExposureScore,
    setExposure: scores.setExposure,
    perOpponentThreats,
    nearCompleteSets,
    hasJustSayNoInHand
  };
}

function recommendDefensiveCounterPlay(gameState, playerId) {
  const assessment = assessDealBreakerVulnerability(gameState, playerId);
  const recommendations = [];

  const maxSeverity = assessment.perOpponentThreats.reduce((max, opp) => {
    const ranks = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    return ranks[opp.severity] > ranks[max] ? opp.severity : max;
  }, "LOW");

  if (assessment.vulnerable && assessment.hasJustSayNoInHand) {
    recommendations.push({
      tacticId: "RETAIN_JUST_SAY_NO",
      targetColor: assessment.setExposure[0] ? assessment.setExposure[0].color : null,
      actionable: true,
      urgency: maxSeverity,
      reason: "Complete set exposed to Deal Breaker; retain Just Say No in hand as defensive counter."
    });
  }

  if (assessment.vulnerable && !assessment.hasJustSayNoInHand) {
    recommendations.push({
      tacticId: "ACCELERATE_WIN_RACE",
      targetColor: assessment.setExposure[0] ? assessment.setExposure[0].color : null,
      actionable: true,
      urgency: maxSeverity,
      reason: "Exposed complete set with no Just Say No protection; prioritize completing remaining sets to win."
    });
    recommendations.push({
      tacticId: "PRIORITIZE_JSN_ACQUISITION",
      targetColor: null,
      actionable: false,
      urgency: "MEDIUM",
      reason: "Keep future Just Say No draws in hand rather than banking them."
    });
  }

  const highThreatExists = assessment.perOpponentThreats.some(opp => opp.severity === "HIGH" || opp.severity === "CRITICAL");
  if (highThreatExists && !assessment.hasJustSayNoInHand && assessment.nearCompleteSets.length > 0) {
    assessment.nearCompleteSets.forEach(near => {
      recommendations.push({
        tacticId: "DEFER_SET_COMPLETION",
        targetColor: near.color,
        actionable: true,
        urgency: maxSeverity,
        reason: `Defer completing ${near.color} set while Deal Breaker threat is live and no Just Say No is held.`
      });
    });
  }

  return {
    playerId,
    vulnerable: assessment.vulnerable,
    overallExposureScore: assessment.overallExposureScore,
    recommendations
  };
}

module.exports = {
  THREAT_MITIGATION_CATALOG,
  getThreatMitigationCatalog,
  calculateSetExposureRiskScores,
  assessDealBreakerVulnerability,
  recommendDefensiveCounterPlay
};
