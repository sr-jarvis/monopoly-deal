const { COMPLETE_SET_SIZE } = require("./card_catalog");
const blunder_analyzer = require("./blunder_analyzer");

const REPLAY_METRIC_TYPES_CATALOG = Object.freeze([
  { id: "EFFICIENCY_RATING", unit: "0-100", title: "Efficiency Rating", description: "Share of a player's attempted actions that were applied across the match." },
  { id: "ASSET_CONVERSION_RATE", unit: "ratio", title: "Asset Conversion Rate", description: "Cards played to bank/properties divided by cards drawn." },
  { id: "MOMENTUM_INDEX", unit: "signed score", title: "Momentum Index", description: "Change in board-strength score between first and second half of the match." },
  { id: "BLUNDER_COUNT", unit: "count", title: "Blunder Count", description: "Tactical blunders detected via blunder_analyzer for this player." },
  { id: "TURNING_POINTS", unit: "event list", title: "Turning Points", description: "Events where the match leader by board-strength score changed." },
  { id: "PERFORMANCE_GRADE", unit: "S/A/B/C/D", title: "Performance Grade", description: "Composite letter grade evaluating overall player performance." }
]);

function getReplayMetricTypesCatalog() {
  return REPLAY_METRIC_TYPES_CATALOG;
}

const NET_WORTH_WEIGHTS = { bankValue: 1, propertyCard: 2, completedSet: 10 };

function computeBoardStrengthScore(snapshot) {
  if (!snapshot) return 0;
  let score = (snapshot.bankTotal || 0) * NET_WORTH_WEIGHTS.bankValue;
  for (const [color, group] of Object.entries(snapshot.properties || {})) {
    const cardsOwned = group.cardsOwned || 0;
    score += cardsOwned * NET_WORTH_WEIGHTS.propertyCard;
    const req = COMPLETE_SET_SIZE[color] || 3;
    if (cardsOwned >= req) score += NET_WORTH_WEIGHTS.completedSet;
  }
  return score;
}

function validateHistoryEvents(historyEvents) {
  if (!Array.isArray(historyEvents) || historyEvents.length === 0) {
    throw new Error("historyEvents must be a non-empty array");
  }
}

function analyzeMatchReplay(historyEvents) {
  validateHistoryEvents(historyEvents);

  const events = [...historyEvents].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const playerIds = Object.keys(events[events.length - 1].boardSnapshotSummary || {});
  if (playerIds.length === 0) {
    throw new Error("historyEvents contains no boardSnapshotSummary data to analyze");
  }

  const perPlayer = {};
  playerIds.forEach(id => {
    perPlayer[id] = {
      playerId: id,
      appliedActions: 0,
      rejectedActions: 0,
      actionBreakdown: {},
      cardsDrawn: 0,
      cardsPlayed: 0,
      scoreTrajectory: []
    };
  });

  events.forEach(evt => {
    const snap = evt.boardSnapshotSummary || {};
    playerIds.forEach(id => {
      perPlayer[id].scoreTrajectory.push({
        seq: evt.seq,
        timestamp: evt.timestamp,
        score: computeBoardStrengthScore(snap[id])
      });
    });

    const actorId = evt.actorId;
    if (!actorId || !perPlayer[actorId]) return;
    const p = perPlayer[actorId];
    if (evt.status === 'REJECTED') {
      p.rejectedActions++;
      return;
    }
    p.appliedActions++;
    p.actionBreakdown[evt.actionType] = (p.actionBreakdown[evt.actionType] || 0) + 1;
    if (evt.actionType === 'DRAW') p.cardsDrawn += (evt.payload && evt.payload.count) || 1;
    if (evt.actionType === 'PLAY_CARD' || evt.actionType === 'PLAY_ACTION_CARD') p.cardsPlayed += 1;
  });

  const turningPoints = [];
  let currentLeader = null;
  events.forEach(evt => {
    const snap = evt.boardSnapshotSummary || {};
    let leader = null, leaderScore = -1;
    playerIds.forEach(id => {
      const s = computeBoardStrengthScore(snap[id]);
      if (s > leaderScore) {
        leaderScore = s;
        leader = id;
      }
    });
    if (leader && leader !== currentLeader) {
      turningPoints.push({
        seq: evt.seq,
        timestamp: evt.timestamp,
        actionType: evt.actionType,
        actorId: evt.actorId,
        previousLeader: currentLeader,
        newLeader: leader,
        leaderScore
      });
      currentLeader = leader;
    }
  });

  const results = {};
  playerIds.forEach(id => {
    const p = perPlayer[id];
    const totalAttempted = p.appliedActions + p.rejectedActions;
    const efficiencyRating = totalAttempted > 0
      ? Math.round((p.appliedActions / totalAttempted) * 100) : 100;
    const assetConversionRate = p.cardsDrawn > 0
      ? Math.round((p.cardsPlayed / p.cardsDrawn) * 100) / 100 : 0;

    const half = Math.max(1, Math.floor(p.scoreTrajectory.length / 2));
    const firstHalf = p.scoreTrajectory.slice(0, half);
    const secondHalf = p.scoreTrajectory.slice(half);
    const avg = arr => arr.length ? arr.reduce((s, x) => s + x.score, 0) / arr.length : 0;
    const momentumIndex = Math.round((avg(secondHalf) - avg(firstHalf)) * 10) / 10;

    let blunderCount = 0;
    try {
      blunderCount = blunder_analyzer.analyzeBotReplay(events, id).blunderCount;
    } catch (_e) {
      blunderCount = 0;
    }

    const performanceScore = Math.max(0, Math.min(100, Math.round(
      efficiencyRating * 0.35 +
      Math.min(assetConversionRate, 1.5) * 100 * 0.25 +
      Math.max(-50, Math.min(50, momentumIndex)) * 0.3 +
      Math.max(0, 20 - blunderCount * 5) * 0.5 * 0.1
    )));

    let performanceGrade = "D";
    if (performanceScore >= 90) performanceGrade = "S";
    else if (performanceScore >= 75) performanceGrade = "A";
    else if (performanceScore >= 60) performanceGrade = "B";
    else if (performanceScore >= 40) performanceGrade = "C";

    results[id] = {
      playerId: id,
      efficiencyRating,
      assetConversionRate,
      momentumIndex,
      blunderCount,
      performanceScore,
      performanceGrade,
      actionBreakdown: p.actionBreakdown,
      finalScore: p.scoreTrajectory.length ? p.scoreTrajectory[p.scoreTrajectory.length - 1].score : 0
    };
  });

  return {
    playerCount: playerIds.length,
    eventCount: events.length,
    perPlayer: results,
    turningPoints
  };
}

function generateStrategicMatchSummary(historyEvents) {
  const analysis = analyzeMatchReplay(historyEvents);

  const ranked = Object.values(analysis.perPlayer).sort((a, b) => b.finalScore - a.finalScore);
  const narrativeLines = [];
  const counterTactics = [];

  ranked.forEach((p, idx) => {
    narrativeLines.push(
      `${p.playerId} finished ${idx === 0 ? 'in the lead' : `#${idx + 1}`} ` +
      `with a ${p.performanceGrade} grade (score ${p.performanceScore}), ` +
      `${p.efficiencyRating}% action efficiency and momentum index of ${p.momentumIndex}.`
    );
    if (p.assetConversionRate < 0.5) {
      counterTactics.push({
        targetPlayerId: p.playerId,
        tacticId: "EXPLOIT_LOW_CONVERSION",
        note: `${p.playerId} converts drawn cards to board assets slowly (rate ${p.assetConversionRate}); pressure their hand before deployment.`
      });
    }
    if (p.blunderCount > 0) {
      counterTactics.push({
        targetPlayerId: p.playerId,
        tacticId: "REPEATED_BLUNDER_PATTERN",
        note: `${p.playerId} recorded ${p.blunderCount} tactical blunder(s) this match.`
      });
    }
  });

  if (analysis.turningPoints.length > 0) {
    const last = analysis.turningPoints[analysis.turningPoints.length - 1];
    narrativeLines.push(
      `The match lead changed hands ${analysis.turningPoints.length} time(s); ` +
      `${last.newLeader} took the final lead at seq ${last.seq} via a ${last.actionType} action.`
    );
  }

  return {
    narrative: narrativeLines.join(' '),
    ranking: ranked.map(p => p.playerId),
    counterTactics,
    analysis
  };
}

module.exports = {
  REPLAY_METRIC_TYPES_CATALOG,
  getReplayMetricTypesCatalog,
  analyzeMatchReplay,
  generateStrategicMatchSummary
};
