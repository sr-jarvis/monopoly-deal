const {
  MAX_PLAYS_PER_TURN,
  PHASES,
  COMPLETE_SET_SIZE,
  WIN_REQUIRED_SET_COUNT,
  validatePropertyPlacementAction,
  validateBankZoneEligibility,
  validateActionCardPlay,
  validateDebtCollectorTarget,
  isCompletePropertySet
} = require('./rules_validator');

const RISK_PROFILES = {
  CONSERVATIVE: {
    name: 'CONSERVATIVE',
    description: 'Minimizes board exposure and threat reaction',
    riskTolerance: 0.2,
    exposureLimit: 6,
    opponentThreatSensitivity: 1.6,
    endgameAggressionMultiplier: 0.8
  },
  MODERATE: {
    name: 'MODERATE',
    description: 'Default balanced risk posture',
    riskTolerance: 0.5,
    exposureLimit: 12,
    opponentThreatSensitivity: 1.0,
    endgameAggressionMultiplier: 1.0
  },
  HIGH_RISK: {
    name: 'HIGH_RISK',
    description: 'Maximizes tempo and offensive exposure',
    riskTolerance: 0.85,
    exposureLimit: 99,
    opponentThreatSensitivity: 0.5,
    endgameAggressionMultiplier: 1.3
  }
};

function normalizeRiskParams(raw = {}) {
  let baseProfile = RISK_PROFILES.MODERATE;
  if (raw.riskProfile) {
    const key = String(raw.riskProfile).toUpperCase();
    if (!RISK_PROFILES[key]) {
      throw new Error(`Unknown risk profile: ${raw.riskProfile}`);
    }
    baseProfile = RISK_PROFILES[key];
  }

  const overrides = (typeof raw.riskParams === 'object' && raw.riskParams !== null && !Array.isArray(raw.riskParams))
    ? raw.riskParams
    : {};

  const clamp = (val, min, max, fallback) => {
    if (typeof val !== 'number' || isNaN(val)) return fallback;
    return Math.max(min, Math.min(max, val));
  };

  return {
    name: baseProfile.name,
    description: baseProfile.description,
    riskTolerance: clamp(overrides.riskTolerance, 0.0, 1.0, baseProfile.riskTolerance),
    exposureLimit: clamp(overrides.exposureLimit, 0, 999, baseProfile.exposureLimit),
    opponentThreatSensitivity: clamp(overrides.opponentThreatSensitivity, 0.0, 5.0, baseProfile.opponentThreatSensitivity),
    endgameAggressionMultiplier: clamp(overrides.endgameAggressionMultiplier, 0.0, 5.0, baseProfile.endgameAggressionMultiplier)
  };
}

function computeEffectiveRiskTolerance(gameState, playerSeat, params) {
  let effective = params.riskTolerance;
  const adjustments = [];

  if (gameState && gameState.players) {
    // Check opponent threats (completed sets)
    let threatFound = false;
    for (const [seat, player] of Object.entries(gameState.players)) {
      if (seat === playerSeat) continue;
      if (player && player.properties) {
        let completedCount = 0;
        for (const color of Object.keys(player.properties)) {
          if (isCompletePropertySet && isCompletePropertySet(gameState, seat, color)) {
            completedCount++;
          }
        }
        if (completedCount >= ((WIN_REQUIRED_SET_COUNT || 3) - 1)) {
          threatFound = true;
          break;
        }
      }
    }

    if (threatFound) {
      const delta = roundVal(-0.2 * params.opponentThreatSensitivity);
      effective += delta;
      adjustments.push({ reason: 'Opponent near victory threat', delta });
    }

    // Check endgame draw pile
    if (Array.isArray(gameState.drawPile) && gameState.drawPile.length <= 15) {
      const factor = params.endgameAggressionMultiplier;
      const delta = roundVal(effective * (factor - 1.0));
      effective *= factor;
      adjustments.push({ reason: 'Endgame draw pile depletion', delta });
    }
  }

  effective = Math.max(0.0, Math.min(1.0, roundVal(effective)));
  return { effectiveRiskTolerance: effective, adaptiveAdjustments: adjustments };
}

function roundVal(num) {
  return Math.round(num * 1000) / 1000;
}

const STRATEGY_PROFILES = {
  BALANCED: {
    name: 'BALANCED',
    description: 'Standard balanced strategy focusing on property sets, strategic banking, and action card plays.',
    propertyAdvanceWeight: 1.0,
    actionCardWeight: 1.0,
    bankWeight: 1.0,
    setCompletionUrgency: 1.0,
    moneyBufferTarget: 0,
    retainJustSayNo: true
  },
  AGGRESSIVE: {
    name: 'AGGRESSIVE',
    description: 'High-offense strategy prioritizing action card plays, set completion, and aggressive targeting.',
    propertyAdvanceWeight: 1.5,
    actionCardWeight: 1.8,
    bankWeight: 0.5,
    setCompletionUrgency: 2.0,
    moneyBufferTarget: 0,
    retainJustSayNo: false
  },
  DEFENSIVE: {
    name: 'DEFENSIVE',
    description: 'Risk-averse strategy prioritizing bank building for rent protection and retaining defense cards.',
    propertyAdvanceWeight: 0.8,
    actionCardWeight: 0.7,
    bankWeight: 1.5,
    setCompletionUrgency: 0.8,
    moneyBufferTarget: 6,
    retainJustSayNo: true
  },
  HOARDER: {
    name: 'HOARDER',
    description: 'Capital hoarding strategy maximizing bank deposits and delaying full set exposure.',
    propertyAdvanceWeight: 0.6,
    actionCardWeight: 0.5,
    bankWeight: 2.2,
    setCompletionUrgency: 0.5,
    moneyBufferTarget: 10,
    retainJustSayNo: true
  }
};

class MonopolyBotEngine {
  constructor(strategyName = 'BALANCED') {
    const key = String(strategyName).toUpperCase();
    this.strategy = STRATEGY_PROFILES[key] || STRATEGY_PROFILES.BALANCED;
    this.strategyName = this.strategy.name;
  }

  classifyCard(card) {
    if (!card) return 'unknown';
    if (card.description !== undefined) return 'action';
    if (Array.isArray(card.types)) return card.title === 'Rent' ? 'rent' : 'wildcard';
    if (card.type) return 'property';
    return 'money';
  }

  evaluateHandAndState(gameState, playerSeat) {
    if (!gameState || !gameState.players || !gameState.players[playerSeat]) {
      return { action: 'end_turn', reason: 'Invalid game state or player seat' };
    }

    const player = gameState.players[playerSeat];
    const hand = Array.isArray(player.hand) ? player.hand : [];

    // Guard: turn active check
    if (gameState.turn && gameState.turn.playerId && gameState.turn.playerId !== playerSeat) {
      return { action: 'end_turn', reason: 'Not this player turn' };
    }

    // Guard: phase check
    const phase = gameState.turn ? gameState.turn.phase : PHASES.ACTION;
    if (phase === PHASES.DISCARD || hand.length > 7) {
      // Find lowest value card to discard
      const sortedHand = [...hand].sort((a, b) => (a.value || 0) - (b.value || 0));
      const discardCandidate = sortedHand[0];
      return {
        action: 'discard',
        cardId: discardCandidate ? discardCandidate.id : null,
        reason: 'Hand exceeds 7 cards limit'
      };
    }

    const playsMade = gameState.turn ? (gameState.turn.playsMade || 0) : 0;
    if (playsMade >= MAX_PLAYS_PER_TURN) {
      return { action: 'end_turn', reason: '0 actions remain this turn' };
    }

    if (hand.length === 0) {
      return { action: 'end_turn', reason: 'Hand is empty' };
    }

    const currentBankVal = (player.bank || []).reduce((acc, c) => acc + (c.value || 0), 0);
    const needsBankBuffer = this.strategy.moneyBufferTarget > 0 && currentBankVal < this.strategy.moneyBufferTarget;

    // High bank urgency strategy (DEFENSIVE/HOARDER) deposits money/actions before non-completing property plays
    if (needsBankBuffer) {
      for (const card of hand) {
        const cType = this.classifyCard(card);
        if (cType === 'money' || (cType === 'action' && card.title !== 'Just Say No')) {
          const valRes = validateBankZoneEligibility(gameState, { playerId: playerSeat, cardId: card.id });
          if (!valRes.errors || valRes.errors.length === 0) {
            return {
              action: 'bank',
              cardId: card.id,
              targetZone: 'bank',
              reason: `Deposit ${cType} card into bank zone (strategy ${this.strategyName} buffer: ${currentBankVal}/${this.strategy.moneyBufferTarget})`
            };
          }
        }
      }
    }

    // Priority 1: Complete or advance property sets
    for (const card of hand) {
      const cType = this.classifyCard(card);
      if (cType === 'property') {
        const color = card.type;
        const currentGroup = player.properties && player.properties[color] ? player.properties[color] : { cards: [] };
        const reqSize = COMPLETE_SET_SIZE[color] || 3;
        if (currentGroup.cards.length < reqSize) {
          const valRes = validatePropertyPlacementAction(gameState, {
            playerId: playerSeat,
            cardId: card.id,
            targetZone: 'properties',
            targetColor: color
          });
          if (!valRes.errors || valRes.errors.length === 0) {
            return {
              action: 'play',
              cardId: card.id,
              targetZone: 'properties',
              propertyColor: color,
              reason: `Play property card to advance ${color} set (${currentGroup.cards.length + 1}/${reqSize})`
            };
          }
        }
      } else if (cType === 'wildcard') {
        const eligibleColors = Array.isArray(card.types) ? card.types : [];
        for (const color of eligibleColors) {
          const currentGroup = player.properties && player.properties[color] ? player.properties[color] : { cards: [] };
          const reqSize = COMPLETE_SET_SIZE[color] || 3;
          if (currentGroup.cards.length < reqSize) {
            const valRes = validatePropertyPlacementAction(gameState, {
              playerId: playerSeat,
              cardId: card.id,
              targetZone: 'properties',
              targetColor: color
            });
            if (!valRes.errors || valRes.errors.length === 0) {
              return {
                action: 'play',
                cardId: card.id,
                targetZone: 'properties',
                propertyColor: color,
                reason: `Play wildcard card to advance ${color} set (${currentGroup.cards.length + 1}/${reqSize})`
              };
            }
          }
        }
      }
    }

    // Priority 2: Play action cards if legal and beneficial
    for (const card of hand) {
      const cType = this.classifyCard(card);
      if (cType === 'action') {
        const title = card.title;
        if (title === 'Pass Go' || title === 'Its My Birthday') {
          const valRes = validateActionCardPlay(gameState, playerSeat, card.id);
          if (valRes.valid || (valRes.errors && valRes.errors.length === 0)) {
            return {
              action: 'play',
              cardId: card.id,
              targetZone: null,
              cardTitle: title,
              reason: `Play action card '${title}'`
            };
          }
        } else if (title === 'Debt Collector') {
          // Find target player with money or properties
          for (const oppSeat of Object.keys(gameState.players)) {
            if (oppSeat === playerSeat) continue;
            const targetVal = validateDebtCollectorTarget(gameState, playerSeat, oppSeat);
            if (targetVal.valid || (targetVal.errors && targetVal.errors.length === 0)) {
              return {
                action: 'play',
                cardId: card.id,
                targetZone: null,
                cardTitle: title,
                targetPlayerId: oppSeat,
                reason: `Play Debt Collector against ${oppSeat}`
              };
            }
          }
        }
      }
    }

    // Priority 3: Bank MoneyCards or unplayable ActionCards (NEVER bank property/wildcards or Just Say No)
    for (const card of hand) {
      const cType = this.classifyCard(card);
      if (cType === 'money' || (cType === 'action' && card.title !== 'Just Say No')) {
        const valRes = validateBankZoneEligibility(gameState, { playerId: playerSeat, cardId: card.id });
        if (!valRes.errors || valRes.errors.length === 0) {
          return {
            action: 'bank',
            cardId: card.id,
            targetZone: 'bank',
            reason: `Deposit ${cType} card into bank zone (value: ${card.value || 0})`
          };
        }
      }
    }

    // Default: end turn
    return { action: 'end_turn', reason: 'No further valid beneficial plays' };
  }

  decideMoveCustom(gameState, playerSeat, riskInput = {}) {
    const params = normalizeRiskParams(riskInput);
    const { effectiveRiskTolerance, adaptiveAdjustments } = computeEffectiveRiskTolerance(gameState, playerSeat, params);

    const baseDecision = this.evaluateHandAndState(gameState, playerSeat);

    // Apply exposure limit check to decision if it attempts to play non-set-completing property
    if (gameState && gameState.players && gameState.players[playerSeat]) {
      const player = gameState.players[playerSeat];
      let currentPropertyVal = 0;
      if (player.properties) {
        for (const group of Object.values(player.properties)) {
          if (group && Array.isArray(group.cards)) {
            currentPropertyVal += group.cards.reduce((acc, c) => acc + (c.value || 0), 0);
          }
        }
      }

      if (currentPropertyVal >= params.exposureLimit && baseDecision.action === 'play' && baseDecision.targetZone === 'properties') {
        // Fallback to bank if exposure limit is reached
        const hand = Array.isArray(player.hand) ? player.hand : [];
        for (const card of hand) {
          const cType = this.classifyCard(card);
          if (cType === 'money' || (cType === 'action' && card.title !== 'Just Say No')) {
            const valRes = validateBankZoneEligibility(gameState, { playerId: playerSeat, cardId: card.id });
            if (!valRes.errors || valRes.errors.length === 0) {
              return {
                decision: {
                  action: 'bank',
                  cardId: card.id,
                  targetZone: 'bank',
                  reason: `Exposure limit (${currentPropertyVal}/${params.exposureLimit}) reached; depositing ${cType} card into bank`
                },
                riskContext: { effectiveRiskTolerance, appliedParams: params, adaptiveAdjustments }
              };
            }
          }
        }
      }
    }

    return {
      decision: baseDecision,
      riskContext: {
        effectiveRiskTolerance,
        appliedParams: params,
        adaptiveAdjustments
      }
    };
  }

  decideMoveHandicapped(gameState, playerSeat, difficultyInput = {}) {
    const params = normalizeDifficultyParams(difficultyInput);
    const randomFn = (typeof difficultyInput.randomFn === 'function') ? difficultyInput.randomFn : Math.random;

    if (!gameState || !gameState.players || !gameState.players[playerSeat]) {
      return { decision: { action: 'end_turn', reason: 'Invalid game state or player' }, difficultyContext: { appliedParams: params, depthUsed: params.moveEvaluationDepth, mistakeInjected: false } };
    }

    const player = gameState.players[playerSeat];
    const hand = Array.isArray(player.hand) ? player.hand : [];

    const currentTurnId = (gameState.turn && gameState.turn.playerId) ? gameState.turn.playerId : (gameState.currentTurnPlayerId || null);
    if (currentTurnId && currentTurnId !== playerSeat) {
      return { decision: { action: 'end_turn', reason: 'Not current turn' }, difficultyContext: { appliedParams: params, depthUsed: params.moveEvaluationDepth, mistakeInjected: false } };
    }
    if ((gameState.turn && gameState.turn.phase === PHASES.DISCARD) || gameState.turnPhase === PHASES.DISCARD || hand.length > 7) {
      return { decision: this.evaluateHandAndState(gameState, playerSeat), difficultyContext: { appliedParams: params, depthUsed: params.moveEvaluationDepth, mistakeInjected: false } };
    }
    const playsMade = (gameState.turn && typeof gameState.turn.playsMade === 'number') ? gameState.turn.playsMade : (gameState.turnPlaysCount || 0);
    if (playsMade >= MAX_PLAYS_PER_TURN) {
      return { decision: { action: 'end_turn', reason: 'Maximum plays reached for turn' }, difficultyContext: { appliedParams: params, depthUsed: params.moveEvaluationDepth, mistakeInjected: false } };
    }

    let decision = null;

    if (params.moveEvaluationDepth >= 4) {
      const bankVal = Array.isArray(player.bank) ? player.bank.reduce((acc, c) => acc + (c.value || 0), 0) : 0;
      if (bankVal < 3) {
        for (const card of hand) {
          const cType = this.classifyCard(card);
          if (cType === 'money' || (cType === 'action' && card.title !== 'Just Say No')) {
            const valRes = validateBankZoneEligibility(gameState, { playerId: playerSeat, cardId: card.id });
            if (!valRes.errors || valRes.errors.length === 0) {
              decision = { action: 'bank', cardId: card.id, targetZone: 'bank', reason: `Depth-4 Bank buffer priority (${bankVal}/3 M)` };
              break;
            }
          }
        }
      }
    }

    if (!decision && params.moveEvaluationDepth >= 1) {
      const propCandidates = [];
      for (const card of hand) {
        const cType = this.classifyCard(card);
        if (cType === 'property' || cType === 'wildcard') {
          const colors = cType === 'property'
            ? [card.color || (card.spec && card.spec.color)]
            : (card.colors || (card.spec && card.spec.colors) || []);
          for (const color of colors) {
            if (!color) continue;
            const valRes = validatePropertyPlacementAction(gameState, { playerId: playerSeat, cardId: card.id, propertyColor: color, targetColor: color });
            if (!valRes.errors || valRes.errors.length === 0) {
              propCandidates.push({ card, color, val: card.value || 0 });
            }
          }
        }
      }

      if (propCandidates.length > 0) {
        propCandidates.sort((a, b) => {
          if (params.greedFactor >= 0.5) {
            return b.val - a.val;
          } else {
            return a.val - b.val;
          }
        });
        const chosen = propCandidates[0];
        decision = { action: 'play', cardId: chosen.card.id, targetZone: 'properties', propertyColor: chosen.color, targetColor: chosen.color, reason: `Handicapped (depth ${params.moveEvaluationDepth}, greed ${params.greedFactor}) property play` };
      }
    }

    if (!decision && params.moveEvaluationDepth >= 3) {
      const baseDec = this.evaluateHandAndState(gameState, playerSeat);
      if (baseDec.action === 'play' && baseDec.targetZone === 'action') {
        decision = baseDec;
      }
    }

    if (!decision && params.moveEvaluationDepth >= 2) {
      for (const card of hand) {
        const cType = this.classifyCard(card);
        if (cType === 'money' || (cType === 'action' && card.title !== 'Just Say No')) {
          const valRes = validateBankZoneEligibility(gameState, { playerId: playerSeat, cardId: card.id });
          if (!valRes.errors || valRes.errors.length === 0) {
            decision = { action: 'bank', cardId: card.id, targetZone: 'bank', reason: `Depth-${params.moveEvaluationDepth} Bank fallback` };
            break;
          }
        }
      }
    }

    if (!decision) {
      decision = { action: 'end_turn', reason: 'No valid handicapped plays' };
    }

    let currentPropValue = 0;
    if (player.properties) {
      for (const group of Object.values(player.properties)) {
        if (group && Array.isArray(group.cards)) {
          currentPropValue += group.cards.reduce((acc, c) => acc + (c.value || 0), 0);
        }
      }
    }
    const exposureCeiling = Math.round(6 + params.setProtectionDiscipline * 24);
    if (currentPropValue >= exposureCeiling && decision.action === 'play' && decision.targetZone === 'properties' && params.moveEvaluationDepth >= 2) {
      for (const card of hand) {
        const cType = this.classifyCard(card);
        if (cType === 'money' || (cType === 'action' && card.title !== 'Just Say No')) {
          const valRes = validateBankZoneEligibility(gameState, { playerId: playerSeat, cardId: card.id });
          if (!valRes.errors || valRes.errors.length === 0) {
            decision = { action: 'bank', cardId: card.id, targetZone: 'bank', reason: `Discipline ceiling (${currentPropValue}/${exposureCeiling}) reached; banking ${cType}` };
            break;
          }
        }
      }
    }

    let mistakeInjected = false;
    let originalDecision = null;
    if (params.mistakeInjectionRate > 0 && randomFn() < params.mistakeInjectionRate) {
      originalDecision = decision;
      mistakeInjected = true;
      let bankFound = false;
      for (const card of hand) {
        const cType = this.classifyCard(card);
        if (cType === 'money' || cType === 'action') {
          const valRes = validateBankZoneEligibility(gameState, { playerId: playerSeat, cardId: card.id });
          if (!valRes.errors || valRes.errors.length === 0) {
            decision = { action: 'bank', cardId: card.id, targetZone: 'bank', reason: `[MISTAKE] Suboptimal deposit injection` };
            bankFound = true;
            break;
          }
        }
      }
      if (!bankFound) {
        decision = { action: 'end_turn', reason: `[MISTAKE] Suboptimal turn termination` };
      }
    }

    return {
      decision,
      difficultyContext: {
        appliedParams: params,
        depthUsed: params.moveEvaluationDepth,
        mistakeInjected,
        originalDecision
      }
    };
  }
}

const DIFFICULTY_PROFILES = {
  EASY: {
    name: 'EASY',
    description: 'Shallow evaluation, greedy selection, frequent mistakes. Ideal for beginners.',
    moveEvaluationDepth: 1,
    greedFactor: 0.9,
    mistakeInjectionRate: 0.35,
    setProtectionDiscipline: 0.2
  },
  MEDIUM: {
    name: 'MEDIUM',
    description: 'Balanced evaluation depth with occasional lapses in discipline.',
    moveEvaluationDepth: 2,
    greedFactor: 0.6,
    mistakeInjectionRate: 0.15,
    setProtectionDiscipline: 0.5
  },
  HARD: {
    name: 'HARD',
    description: 'Deep evaluation, disciplined set protection, rare mistakes.',
    moveEvaluationDepth: 3,
    greedFactor: 0.3,
    mistakeInjectionRate: 0.05,
    setProtectionDiscipline: 0.8
  },
  GRANDMASTER: {
    name: 'GRANDMASTER',
    description: 'Full-depth evaluation, disciplined set protection, zero deliberate mistakes.',
    moveEvaluationDepth: 4,
    greedFactor: 0.15,
    mistakeInjectionRate: 0.0,
    setProtectionDiscipline: 1.0
  }
};

function normalizeDifficultyParams(raw = {}) {
  let baseProfile = DIFFICULTY_PROFILES.MEDIUM;
  if (raw.difficultyLevel) {
    let key = String(raw.difficultyLevel).toUpperCase();
    if (key === 'BALANCED') key = 'MEDIUM';
    if (!DIFFICULTY_PROFILES[key]) {
      if (STRATEGY_PROFILES[key]) {
        key = 'MEDIUM';
      } else {
        throw new Error(`Unknown difficulty level: ${raw.difficultyLevel}`);
      }
    }
    baseProfile = DIFFICULTY_PROFILES[key];
  }

  const overrides = (typeof raw.handicapParams === 'object' && raw.handicapParams !== null && !Array.isArray(raw.handicapParams))
    ? raw.handicapParams
    : {};

  const moveEvaluationDepth = (typeof overrides.moveEvaluationDepth === 'number' && !isNaN(overrides.moveEvaluationDepth))
    ? Math.max(1, Math.min(4, Math.round(overrides.moveEvaluationDepth)))
    : baseProfile.moveEvaluationDepth;

  const greedFactor = (typeof overrides.greedFactor === 'number' && !isNaN(overrides.greedFactor))
    ? Math.max(0.0, Math.min(1.0, overrides.greedFactor))
    : baseProfile.greedFactor;

  const mistakeInjectionRate = (typeof overrides.mistakeInjectionRate === 'number' && !isNaN(overrides.mistakeInjectionRate))
    ? Math.max(0.0, Math.min(1.0, overrides.mistakeInjectionRate))
    : baseProfile.mistakeInjectionRate;

  const setProtectionDiscipline = (typeof overrides.setProtectionDiscipline === 'number' && !isNaN(overrides.setProtectionDiscipline))
    ? Math.max(0.0, Math.min(1.0, overrides.setProtectionDiscipline))
    : baseProfile.setProtectionDiscipline;

  return {
    difficultyLevel: baseProfile.name,
    moveEvaluationDepth,
    greedFactor,
    mistakeInjectionRate,
    setProtectionDiscipline
  };
}

function getDifficultyProfiles() {
  return DIFFICULTY_PROFILES;
}

module.exports = {
  MonopolyBotEngine,
  STRATEGY_PROFILES,
  RISK_PROFILES,
  DIFFICULTY_PROFILES,
  normalizeRiskParams,
  normalizeDifficultyParams,
  computeEffectiveRiskTolerance,
  getDifficultyProfiles
};
