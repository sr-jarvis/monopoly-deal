const { simulateMatch } = require('./match_simulator');
const { STRATEGY_PROFILES } = require('./bot_engine');

let tournamentHistory = [];
const MAX_TOURNAMENT_HISTORY = 50;

function resetTournamentHistory() {
  tournamentHistory = [];
}

function runTournament(options = {}) {
  const participants = Array.isArray(options.participants) && options.participants.length >= 2 && options.participants.length <= 5
    ? options.participants.map(s => String(s).toUpperCase())
    : ['BALANCED', 'AGGRESSIVE'];

  const knownStrategies = Object.keys(STRATEGY_PROFILES);
  for (const strat of participants) {
    if (!knownStrategies.includes(strat)) {
      throw new Error(`Unknown strategy participant: ${strat}`);
    }
  }

  const roundsPerMatchup = Math.max(1, Math.min(20, parseInt(options.roundsPerMatchup) || 5));
  const maxTurns = Math.max(10, Math.min(500, parseInt(options.maxTurns) || 200));

  const tournamentId = `tourn-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const matches = [];

  const standingsMap = {};
  participants.forEach(strat => {
    standingsMap[strat] = { strategy: strat, wins: 0, losses: 0, safetyHalted: 0, winRate: 0.0 };
  });

  for (let r = 1; r <= roundsPerMatchup; r++) {
    const simRes = simulateMatch({
      botCount: participants.length,
      strategies: participants,
      maxTurns
    });

    matches.push(simRes);

    if (simRes.status === 'FINISHED' && simRes.winnerId) {
      const winnerSeatIdx = parseInt(simRes.winnerId.replace('bot-', '')) - 1;
      const winningStrategy = participants[winnerSeatIdx];
      if (winningStrategy && standingsMap[winningStrategy]) {
        standingsMap[winningStrategy].wins += 1;
      }
      participants.forEach((strat, idx) => {
        if (idx !== winnerSeatIdx && standingsMap[strat]) {
          standingsMap[strat].losses += 1;
        }
      });
    } else {
      participants.forEach(strat => {
        if (standingsMap[strat]) {
          standingsMap[strat].safetyHalted += 1;
        }
      });
    }
  }

  const standings = Object.values(standingsMap).map(st => {
    const totalFinished = st.wins + st.losses;
    st.winRate = totalFinished > 0 ? Number((st.wins / totalFinished).toFixed(3)) : 0.0;
    return st;
  }).sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);

  const result = {
    tournamentId,
    participants,
    roundsPlayed: roundsPerMatchup,
    standings,
    matchesCount: matches.length
  };

  tournamentHistory.unshift(result);
  if (tournamentHistory.length > MAX_TOURNAMENT_HISTORY) {
    tournamentHistory.pop();
  }

  return result;
}

function getStrategyLeaderboard() {
  const aggregate = {};
  Object.keys(STRATEGY_PROFILES).forEach(s => {
    aggregate[s] = { strategy: s, wins: 0, losses: 0, safetyHalted: 0, winRate: 0.0, tournamentsPlayed: 0 };
  });

  for (const t of tournamentHistory) {
    for (const st of t.standings) {
      if (aggregate[st.strategy]) {
        aggregate[st.strategy].wins += st.wins;
        aggregate[st.strategy].losses += st.losses;
        aggregate[st.strategy].safetyHalted += st.safetyHalted;
        aggregate[st.strategy].tournamentsPlayed += 1;
      }
    }
  }

  const leaderboard = Object.values(aggregate).map(st => {
    const totalFinished = st.wins + st.losses;
    st.winRate = totalFinished > 0 ? Number((st.wins / totalFinished).toFixed(3)) : 0.0;
    return st;
  }).sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);

  return {
    totalTournaments: tournamentHistory.length,
    leaderboard
  };
}

module.exports = {
  runTournament,
  getStrategyLeaderboard,
  resetTournamentHistory
};
