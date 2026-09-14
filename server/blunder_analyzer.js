/**
 * Monopoly Deal v2.8 Bot Replay Analysis & Tactical Blunder Detector
 */
const { COMPLETE_SET_SIZE, ACTION_CARD_TITLES } = require("./rules_validator");

const MAX_REPLAY_LOG_ENTRIES = 5000;

const BLUNDER_RULES_CATALOG = Object.freeze([
  {
    id: "BANK_OVER_SET_ADVANCE",
    title: "Banked Property Over Set Advancement",
    category: "TACTICAL_BOARD",
    severity: "BLUNDER",
    description: "Banked or discarded a property card whose color set was incomplete and could have been advanced or completed.",
    rationale: "Property placement directly advances win conditions, whereas banking property provides minimal liquidity relative to set progress."
  },
  {
    id: "SUBOPTIMAL_TARGET_STEAL",
    title: "Suboptimal or Invalid Action Card Target",
    category: "ACTION_CARD_TARGETING",
    severity: "BLUNDER",
    description: "Targeted an incomplete property set with Deal Breaker or a complete property set with Sly Deal.",
    rationale: "Deal Breaker requires a full set to steal, while Sly Deal only steals single cards from incomplete sets."
  },
  {
    id: "WASTEFUL_DISCARD",
    title: "Wasteful Wildcard or Property Discard",
    category: "RESOURCE_MANAGEMENT",
    severity: "BLUNDER",
    description: "Discarded a wildcard or high-value property card when a lower-value money card was available in hand.",
    rationale: "Wildcards and property cards are scarcer and essential for completing 3 distinct property sets."
  },
  {
    id: "IGNORED_PENDING_DEBT",
    title: "Ignored Pending Debt or Rent Obligation",
    category: "DEBT_RESPONSE",
    severity: "BLUNDER",
    description: "Ended turn or failed to pay pending debt when sufficient bank or hand assets were available.",
    rationale: "Failing to settle debt risks defaulting assets or violating mandatory payment sequence rules."
  }
]);

function getBlunderDetectionRules() {
  return BLUNDER_RULES_CATALOG;
}

/**
 * Inspects turn actions and board state in a replay log to identify bot tactical blunders.
 * @param {Array} replayLog Array of turn/action events
 * @param {string} botPlayerId Target bot player ID
 * @returns {Object} Analysis report with quality score, blunder count, and move grades
 */
function analyzeBotReplay(replayLog, botPlayerId) {
  if (!Array.isArray(replayLog) || replayLog.length === 0) {
    throw new Error("replayLog must be a non-empty array");
  }
  if (!botPlayerId || typeof botPlayerId !== "string") {
    throw new Error("botPlayerId string is required");
  }

  let blunderCount = 0;
  let inefficiencyCount = 0;
  let goodCount = 0;
  let excellentCount = 0;
  let indeterminateCount = 0;

  const analyzedMoves = [];
  const detectedBlunders = [];
  const warnings = [];

  for (let idx = 0; idx < replayLog.length; idx++) {
    const entry = replayLog[idx];
    if (!entry || typeof entry !== "object") {
      warnings.push(`Index ${idx}: Ignored invalid entry`);
      indeterminateCount++;
      continue;
    }

    // Only analyze discretionary actions taken by target bot
    if (entry.actorId !== botPlayerId) {
      continue;
    }

    const actionType = entry.actionType || (entry.payload && entry.payload.actionType);
    if (!["PLAY_CARD", "PLAY_ACTION_CARD", "DISCARD", "END_TURN"].includes(actionType)) {
      continue;
    }

    const seq = entry.seq || idx + 1;
    const card = entry.card || (entry.payload && entry.payload.card);
    const handBefore = entry.handBefore || [];
    const boardBefore = entry.boardBefore || {};
    const pendingDebt = entry.pendingDebt || null;

    const triggeredRules = [];
    let isIndeterminate = false;

    // Rule 1: BANK_OVER_SET_ADVANCE
    if (actionType === "PLAY_CARD" && entry.payload && entry.payload.targetZone === "bank") {
      if (card && card.kind === "PROPERTY" && card.color) {
        const playerBoard = boardBefore[botPlayerId] || {};
        const playerProps = playerBoard.properties || {};
        const colorSet = playerProps[card.color] || { cards: [] };
        const reqSize = COMPLETE_SET_SIZE[card.color] || 3;
        if ((colorSet.cards || []).length < reqSize) {
          triggeredRules.push("BANK_OVER_SET_ADVANCE");
        }
      } else if (!card) {
        isIndeterminate = true;
      }
    }

    // Rule 2: SUBOPTIMAL_TARGET_STEAL
    if (actionType === "PLAY_ACTION_CARD" || (actionType === "PLAY_CARD" && card && card.kind === "ACTION")) {
      const cardTitle = card ? card.title : (entry.payload && entry.payload.cardTitle);
      const targetPlayerId = entry.payload && entry.payload.targetPlayerId;
      const targetColor = entry.payload && entry.payload.propertyColor;

      if (cardTitle === "Deal Breaker" && targetPlayerId && targetColor) {
        const targetBoard = (boardBefore[targetPlayerId] || {}).properties || {};
        const targetProps = (targetBoard[targetColor] || {}).cards || [];
        const reqSize = COMPLETE_SET_SIZE[targetColor] || 3;
        if (targetProps.length < reqSize) {
          triggeredRules.push("SUBOPTIMAL_TARGET_STEAL");
        }
      } else if (cardTitle === "Sly Deal" && targetPlayerId && targetColor) {
        const targetBoard = (boardBefore[targetPlayerId] || {}).properties || {};
        const targetProps = (targetBoard[targetColor] || {}).cards || [];
        const reqSize = COMPLETE_SET_SIZE[targetColor] || 3;
        if (targetProps.length >= reqSize) {
          triggeredRules.push("SUBOPTIMAL_TARGET_STEAL");
        }
      }
    }

    // Rule 3: WASTEFUL_DISCARD
    if (actionType === "DISCARD") {
      if (card && (card.kind === "WILDCARD" || card.kind === "PROPERTY")) {
        const hasMoney = handBefore.some(c => c.kind === "MONEY");
        if (hasMoney) {
          triggeredRules.push("WASTEFUL_DISCARD");
        }
      } else if (!card) {
        isIndeterminate = true;
      }
    }

    // Rule 4: IGNORED_PENDING_DEBT
    if (actionType === "END_TURN" && pendingDebt) {
      triggeredRules.push("IGNORED_PENDING_DEBT");
    }

    let grade = "EXCELLENT";
    if (isIndeterminate && triggeredRules.length === 0) {
      indeterminateCount++;
      grade = "GOOD"; // Default neutral grade
    } else if (triggeredRules.length > 0) {
      const hasBlunder = triggeredRules.some(rId => {
        const r = BLUNDER_RULES_CATALOG.find(b => b.id === rId);
        return r && r.severity === "BLUNDER";
      });
      if (hasBlunder) {
        grade = "BLUNDER";
        blunderCount++;
        triggeredRules.forEach(rId => {
          const ruleDef = BLUNDER_RULES_CATALOG.find(b => b.id === rId);
          detectedBlunders.push({
            seq,
            ruleId: rId,
            severity: ruleDef ? ruleDef.severity : "BLUNDER",
            message: ruleDef ? ruleDef.description : "Tactical blunder detected"
          });
        });
      } else {
        grade = "INACCURATE";
        inefficiencyCount++;
      }
    } else {
      excellentCount++;
    }

    analyzedMoves.push({
      seq,
      actionType,
      grade,
      triggeredRules,
      notes: triggeredRules.length > 0 ? `Triggered rules: ${triggeredRules.join(", ")}` : "Optimal move execution"
    });
  }

  const totalGraded = blunderCount + inefficiencyCount + goodCount + excellentCount;
  let overallQualityScore = 100;
  if (totalGraded > 0) {
    const rawScore = (excellentCount * 100 + goodCount * 80 + inefficiencyCount * 50 + blunderCount * 0) / totalGraded;
    overallQualityScore = Math.round(rawScore);
  }

  return {
    botPlayerId,
    moveCount: analyzedMoves.length,
    blunderCount,
    inefficiencyCount,
    goodCount,
    excellentCount,
    indeterminateCount,
    overallQualityScore,
    moves: analyzedMoves,
    blunders: detectedBlunders,
    warnings
  };
}

module.exports = {
  MAX_REPLAY_LOG_ENTRIES,
  getBlunderDetectionRules,
  analyzeBotReplay
};
