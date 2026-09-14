const { STRATEGY_PROFILES } = require("./bot_engine");
const match_simulator = require("./match_simulator");
const blunder_analyzer = require("./blunder_analyzer");

const TOURNAMENT_MODES_CATALOG = Object.freeze([
  {
    id: "ROUND_ROBIN_PAIRWISE",
    title: "Round-Robin Pairwise",
    description: "Every strategy plays a head-to-head series against every other configured strategy; supports pairwise head-to-head breakdowns.",
    minStrategies: 2,
    maxStrategies: 4,
    matchSize: 2
  },
  {
    id: "FULL_TABLE_REPEATED",
    title: "Full-Table Repeated",
    description: "All configured strategies are seated together in the same match, repeated matchesPerPairing times.",
    minStrategies: 2,
    maxStrategies: 4,
    matchSize: "all participants"
  }
]);

function getTournamentModesCatalog() {
  return TOURNAMENT_MODES_CATALOG;
}

function normalizeStrategies(rawStrategies) {
  const strategies = Array.isArray(rawStrategies) && rawStrategies.length >= 2
    ? rawStrategies.map(s => String(s).toUpperCase())
    : ["BALANCED", "AGGRESSIVE", "DEFENSIVE", "HOARDER"];

  if (strategies.length < 2 || strategies.length > 4) {
    throw new Error("strategies must contain between 2 and 4 entries");
  }
  if (new Set(strategies).size !== strategies.length) {
    throw new Error("strategies must not contain duplicate entries");
  }
  const known = Object.keys(STRATEGY_PROFILES);
  strategies.forEach(s => {
    if (!known.includes(s)) {
      throw new Error(`Unknown strategy participant: ${s}`);
    }
  });
  return strategies;
}

function normalizeMode(rawMode) {
  const mode = rawMode ? String(rawMode).toUpperCase() : "ROUND_ROBIN_PAIRWISE";
  if (!TOURNAMENT_MODES_CATALOG.some(m => m.id === mode)) {
    throw new Error(`Unknown tournament mode: ${mode}`);
  }
  return mode;
}

function buildPairings(strategies) {
  const pairs = [];
  for (let i = 0; i < strategies.length; i++) {
    for (let j = i + 1; j < strategies.length; j++) {
      pairs.push([strategies[i], strategies[j]]);
    }
  }
  return pairs;
}

function computeSeatBlunderCounts(replayLog, seatIds) {
  const counts = {};
  seatIds.forEach(seatId => {
    try {
      counts[seatId] = blunder_analyzer.analyzeBotReplay(replayLog, seatId).blunderCount;
    } catch (_e) {
      counts[seatId] = 0;
    }
  });
  return counts;
}

function runSingleMatch(pairingStrategies, maxTurns) {
  const simRes = match_simulator.simulateMatch({
    botCount: pairingStrategies.length,
    strategies: pairingStrategies,
    maxTurns,
    includeReplayLog: true
  });

  const seatIds = pairingStrategies.map((_, idx) => `bot-${idx + 1}`);
  const seatBlunderCounts = (Array.isArray(simRes.replayLog) && simRes.replayLog.length > 0)
    ? computeSeatBlunderCounts(simRes.replayLog, seatIds)
    : Object.fromEntries(seatIds.map(id => [id, 0]));

  const strategyBlunderCounts = {};
  pairingStrategies.forEach((strat, idx) => {
    strategyBlunderCounts[strat] = seatBlunderCounts[`bot-${idx + 1}`] || 0;
  });

  let winnerStrategy = null;
  if (simRes.status === "FINISHED" && simRes.winnerId) {
    const winnerSeatIdx = parseInt(simRes.winnerId.replace("bot-", ""), 10) - 1;
    winnerStrategy = pairingStrategies[winnerSeatIdx] || null;
  }

  return {
    pairing: pairingStrategies,
    status: simRes.status,
    haltReason: simRes.haltReason,
    winnerStrategy,
    turnsPlayed: simRes.turnsPlayed,
    strategyBlunderCounts,
    replayLog: simRes.replayLog
  };
}

function simulateTournamentSeries(options = {}) {
  const strategies = normalizeStrategies(options.strategies);
  const mode = normalizeMode(options.mode);
  const matchesPerPairing = Math.max(1, Math.min(20, parseInt(options.matchesPerPairing, 10) || 5));
  const maxTurns = Math.max(10, Math.min(500, parseInt(options.maxTurns, 10) || 200));
  const includeReplayLog = Boolean(options.includeReplayLog);

  const tournamentSeriesId = `tsrs-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const matches = [];

  if (mode === "ROUND_ROBIN_PAIRWISE") {
    buildPairings(strategies).forEach(pair => {
      for (let r = 1; r <= matchesPerPairing; r++) {
        matches.push(runSingleMatch(pair, maxTurns));
      }
    });
  } else {
    for (let r = 1; r <= matchesPerPairing; r++) {
      matches.push(runSingleMatch(strategies, maxTurns));
    }
  }

  if (!includeReplayLog) {
    matches.forEach(m => { delete m.replayLog; });
  }

  return { tournamentSeriesId, mode, strategies, matchesPerPairing, maxTurns, matches, matchesCount: matches.length };
}

function mean(nums) {
  if (!nums || nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function buildHeadToHead(matches) {
  const groups = new Map();
  matches.forEach(m => {
    if (!Array.isArray(m.pairing) || m.pairing.length !== 2) return;
    const key = [...m.pairing].sort().join("::");
    if (!groups.has(key)) groups.set(key, { pair: [...m.pairing].sort(), winsByStrategy: {}, safetyHalted: 0 });
    const g = groups.get(key);
    if (m.status === "FINISHED" && m.winnerStrategy) {
      g.winsByStrategy[m.winnerStrategy] = (g.winsByStrategy[m.winnerStrategy] || 0) + 1;
    } else {
      g.safetyHalted++;
    }
  });

  return Array.from(groups.values()).map(g => {
    const [a, b] = g.pair;
    const winsA = g.winsByStrategy[a] || 0;
    const winsB = g.winsByStrategy[b] || 0;
    return { pair: g.pair, winsA, winsB, safetyHalted: g.safetyHalted, favoredStrategy: winsA === winsB ? null : (winsA > winsB ? a : b) };
  });
}

function evaluateTournamentStandings(seriesResult) {
  if (!seriesResult || !Array.isArray(seriesResult.matches) || seriesResult.matches.length === 0) {
    throw new Error("evaluateTournamentStandings requires a seriesResult with a non-empty matches array");
  }
  if (!Array.isArray(seriesResult.strategies) || seriesResult.strategies.length === 0) {
    throw new Error("evaluateTournamentStandings requires seriesResult.strategies");
  }

  const maxTurns = seriesResult.maxTurns || 200;

  const standings = seriesResult.strategies.map(strategy => {
    const involved = seriesResult.matches.filter(m => Array.isArray(m.pairing) && m.pairing.includes(strategy));
    const matchesPlayed = involved.length;
    const finished = involved.filter(m => m.status === "FINISHED");
    const wins = involved.filter(m => m.winnerStrategy === strategy).length;
    const losses = finished.filter(m => m.winnerStrategy !== strategy).length;
    const safetyHalted = matchesPlayed - finished.length;
    const winRate = finished.length > 0 ? Number((wins / finished.length).toFixed(3)) : 0;

    const winTurns = involved.filter(m => m.winnerStrategy === strategy).map(m => m.turnsPlayed);
    const avgTurnsToWinRaw = mean(winTurns);
    const avgTurnsToWin = avgTurnsToWinRaw !== null ? Number(avgTurnsToWinRaw.toFixed(1)) : null;

    const blunderCounts = involved
      .map(m => (m.strategyBlunderCounts ? m.strategyBlunderCounts[strategy] : undefined))
      .filter(v => typeof v === "number");
    const avgBlundersPerMatch = blunderCounts.length > 0 ? Number(mean(blunderCounts).toFixed(2)) : 0;

    const turnsComponent = avgTurnsToWin !== null ? Math.max(0, 100 - (avgTurnsToWin / maxTurns) * 100) : 0;
    const blunderComponent = Math.max(0, 20 - avgBlundersPerMatch * 5);
    const tacticalDominanceScore = Math.max(0, Math.min(100, Math.round(
      winRate * 100 * 0.45 + turnsComponent * 0.35 + blunderComponent * 1.0
    )));

    const riskFlags = [];
    if (matchesPlayed < 5) riskFlags.push("LOW_SAMPLE_SIZE_RISK");
    if (matchesPlayed > 0 && wins === 0) riskFlags.push("NEVER_WON_RISK");
    if (avgBlundersPerMatch >= 1.5) riskFlags.push("HIGH_BLUNDER_RATE_RISK");

    return { strategy, matchesPlayed, wins, losses, safetyHalted, winRate, avgTurnsToWin, avgBlundersPerMatch, tacticalDominanceScore, riskFlags };
  }).sort((a, b) => b.tacticalDominanceScore - a.tacticalDominanceScore || b.winRate - a.winRate);

  return {
    tournamentSeriesId: seriesResult.tournamentSeriesId,
    mode: seriesResult.mode,
    matchesConsidered: seriesResult.matchesCount,
    standings,
    overallRanking: standings.map(s => s.strategy),
    headToHead: seriesResult.mode === "ROUND_ROBIN_PAIRWISE" ? buildHeadToHead(seriesResult.matches) : []
  };
}

module.exports = {
  TOURNAMENT_MODES_CATALOG,
  getTournamentModesCatalog,
  simulateTournamentSeries,
  evaluateTournamentStandings
};
