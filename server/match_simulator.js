const game_manager = require('./game_manager');
const { MonopolyBotEngine, STRATEGY_PROFILES } = require('./bot_engine');
const { PHASES, ACTION_TYPES } = require('./rules_validator');

const DEFAULT_MAX_TURNS = 250;
const DEFAULT_MAX_STEPS_PER_TURN = 15;
const DEFAULT_MAX_TOTAL_ACTIONS = 3000;

let simulationHistory = [];
const MAX_HISTORY_LENGTH = 200;

function resetSimulationHistory() {
  simulationHistory = [];
}

function translateDecisionToAction(decision, playerId) {
  if (!decision || decision.action === 'end_turn') {
    return { type: ACTION_TYPES.END_TURN, playerId };
  }
  if (decision.action === 'discard') {
    return { type: ACTION_TYPES.DISCARD, playerId, cardId: decision.cardId };
  }
  if (decision.action === 'bank') {
    return { type: ACTION_TYPES.PLAY_CARD, playerId, cardId: decision.cardId, targetZone: 'bank' };
  }
  if (decision.action === 'play') {
    if (decision.targetZone === 'properties') {
      return {
        type: ACTION_TYPES.PLAY_CARD,
        playerId,
        cardId: decision.cardId,
        targetZone: 'properties',
        propertyColor: decision.propertyColor
      };
    }
    return { type: ACTION_TYPES.PLAY_CARD, playerId, cardId: decision.cardId, targetZone: 'bank' };
  }
  return { type: ACTION_TYPES.END_TURN, playerId };
}

function simulateMatch(options = {}) {
  const botCount = Math.max(2, Math.min(5, parseInt(options.botCount) || 2));
  const playerList = Array.isArray(options.playerNames) && options.playerNames.length === botCount
    ? options.playerNames.map((name, i) => ({ id: `bot-${i + 1}`, name }))
    : Array.from({ length: botCount }, (_, i) => ({ id: `bot-${i + 1}`, name: `Bot ${i + 1}` }));

  const maxTurns = Math.max(10, Math.min(500, parseInt(options.maxTurns) || DEFAULT_MAX_TURNS));
  const includeReplayLog = Boolean(options.includeReplayLog);

  const strategies = Array.isArray(options.strategies) && options.strategies.length === botCount
    ? options.strategies
    : Array.from({ length: botCount }, () => 'BALANCED');

  let gameState = game_manager.createGameState(playerList);
  game_manager.recordGameEvent(gameState, 'MATCH_STARTED', null, { playerNames: playerList.map(p => p.name) }, 'APPLIED');

  const botEngines = {};
  playerList.forEach((p, idx) => {
    botEngines[p.id] = new MonopolyBotEngine(strategies[idx] || 'BALANCED');
  });

  const simulationId = `sim-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const startTime = Date.now();

  let turnNumber = 1;
  let totalActions = 0;
  let status = 'FINISHED';
  let haltReason = null;
  let winnerId = null;

  while (gameState.status === 'IN_PROGRESS' && turnNumber <= maxTurns && totalActions < DEFAULT_MAX_TOTAL_ACTIONS) {
    const currentPlayerId = gameState.turn.playerId;
    const botEngine = botEngines[currentPlayerId] || botEngines['bot-1'];

    if (gameState.turn.phase === PHASES.DRAW) {
      const drawRes = game_manager.applyAction(gameState, { type: ACTION_TYPES.DRAW, playerId: currentPlayerId });
      if (drawRes.legal) {
        gameState = drawRes.gameState;
      }
    }

    let steps = 0;
    while (steps < DEFAULT_MAX_STEPS_PER_TURN && gameState.status === 'IN_PROGRESS') {
      steps++;
      totalActions++;

      const decision = botEngine.evaluateHandAndState(gameState, currentPlayerId);
      if (decision.action === 'end_turn') {
        const endRes = game_manager.applyAction(gameState, { type: ACTION_TYPES.END_TURN, playerId: currentPlayerId });
        if (endRes.legal) {
          gameState = endRes.gameState;
        }
        break;
      }

      const action = translateDecisionToAction(decision, currentPlayerId);
      const res = game_manager.applyAction(gameState, action);

      if (res.legal) {
        gameState = res.gameState;
        if (gameState.status === 'FINISHED') {
          winnerId = gameState.winnerId;
          break;
        }
      } else {
        const forceEnd = game_manager.applyAction(gameState, { type: ACTION_TYPES.END_TURN, playerId: currentPlayerId });
        if (forceEnd.legal) gameState = forceEnd.gameState;
        break;
      }
    }

    if (gameState.status === 'FINISHED') {
      winnerId = gameState.winnerId;
      break;
    }

    turnNumber++;
  }

  if (gameState.status !== 'FINISHED') {
    status = 'SAFETY_HALTED';
    if (turnNumber > maxTurns) {
      haltReason = 'MAX_TURNS_EXCEEDED';
    } else if (totalActions >= DEFAULT_MAX_TOTAL_ACTIONS) {
      haltReason = 'MAX_TOTAL_ACTIONS_EXCEEDED';
    }
  } else {
    winnerId = gameState.winnerId;
  }

  const durationMs = Date.now() - startTime;
  const telemetry = game_manager.getMatchTelemetry(gameState);

  const result = {
    simulationId,
    status,
    haltReason,
    winnerId,
    strategies,
    turnsPlayed: Math.min(turnNumber, maxTurns),
    durationMs,
    telemetry,
    replayLog: includeReplayLog ? gameState.replayLogs : undefined
  };

  simulationHistory.unshift(result);
  if (simulationHistory.length > MAX_HISTORY_LENGTH) {
    simulationHistory.pop();
  }

  return result;
}

function getSimulationStats() {
  const totalSimulations = simulationHistory.length;
  if (totalSimulations === 0) {
    return {
      totalSimulations: 0,
      finishedCount: 0,
      safetyHaltedCount: 0,
      haltReasonBreakdown: {},
      winRateBySeatIndex: {},
      avgTurnsPlayed: 0,
      avgDurationMs: 0,
      avgActionsPerMatch: 0
    };
  }

  let finishedCount = 0;
  let safetyHaltedCount = 0;
  const haltReasonBreakdown = {};
  const winsBySeat = {};
  let totalTurns = 0;
  let totalDuration = 0;
  let totalActionsAll = 0;

  for (const sim of simulationHistory) {
    if (sim.status === 'FINISHED') {
      finishedCount++;
      if (sim.winnerId) {
        winsBySeat[sim.winnerId] = (winsBySeat[sim.winnerId] || 0) + 1;
      }
    } else {
      safetyHaltedCount++;
      if (sim.haltReason) {
        haltReasonBreakdown[sim.haltReason] = (haltReasonBreakdown[sim.haltReason] || 0) + 1;
      }
    }

    totalTurns += sim.turnsPlayed || 0;
    totalDuration += sim.durationMs || 0;
    totalActionsAll += sim.telemetry ? (sim.telemetry.totalActionsApplied || 0) : 0;
  }

  const winRateBySeatIndex = {};
  for (const seat in winsBySeat) {
    winRateBySeatIndex[seat] = Number((winsBySeat[seat] / (finishedCount || 1)).toFixed(3));
  }

  return {
    totalSimulations,
    finishedCount,
    safetyHaltedCount,
    haltReasonBreakdown,
    winRateBySeatIndex,
    avgTurnsPlayed: Number((totalTurns / totalSimulations).toFixed(1)),
    avgDurationMs: Number((totalDuration / totalSimulations).toFixed(1)),
    avgActionsPerMatch: Number((totalActionsAll / totalSimulations).toFixed(1))
  };
}

module.exports = {
  simulateMatch,
  translateDecisionToAction,
  getSimulationStats,
  resetSimulationHistory,
  DEFAULT_MAX_TURNS,
  DEFAULT_MAX_STEPS_PER_TURN,
  DEFAULT_MAX_TOTAL_ACTIONS
};
