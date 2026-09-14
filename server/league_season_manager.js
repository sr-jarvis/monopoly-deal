/**
 * Monopoly Deal AI Bot Tournament League Season Standings & Promotion / Relegation Engine (v4.9)
 */

const SEASON_TIERS = [
  {
    id: 'PREMIER_LEAGUE',
    title: 'Premier League',
    rank: 1,
    minPointsThreshold: 100,
    promotionTargetTier: null,
    relegationTargetTier: 'CHAMPIONSHIP'
  },
  {
    id: 'CHAMPIONSHIP',
    title: 'Championship',
    rank: 2,
    minPointsThreshold: 50,
    promotionTargetTier: 'PREMIER_LEAGUE',
    relegationTargetTier: 'DIVISION_ONE'
  },
  {
    id: 'DIVISION_ONE',
    title: 'Division One',
    rank: 3,
    minPointsThreshold: 0,
    promotionTargetTier: 'CHAMPIONSHIP',
    relegationTargetTier: null
  }
];

function getSeasonTiersCatalog() {
  return SEASON_TIERS.map(t => ({ ...t }));
}

function calculateSeasonRankings(matchResults = []) {
  if (!Array.isArray(matchResults)) {
    throw new TypeError('matchResults must be an array');
  }

  const botStatsMap = new Map();

  for (const match of matchResults) {
    if (!match || !Array.isArray(match.participants)) continue;

    const winnerId = match.winnerId || null;

    for (const p of match.participants) {
      const pid = typeof p === 'string' ? p : p.id;
      if (!pid) continue;

      if (!botStatsMap.has(pid)) {
        botStatsMap.set(pid, {
          botId: pid,
          botName: p.name || pid,
          tier: p.tier || 'CHAMPIONSHIP',
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          points: 0,
          totalTurns: 0,
          totalBlunders: 0
        });
      }

      const stats = botStatsMap.get(pid);
      stats.matchesPlayed += 1;
      if (match.turns) stats.totalTurns += match.turns;
      if (p.blunders) stats.totalBlunders += p.blunders;

      if (winnerId === pid) {
        stats.wins += 1;
        stats.points += 3;
      } else if (winnerId === null) {
        stats.draws += 1;
        stats.points += 1;
      } else {
        stats.losses += 1;
      }
    }
  }

  const rankings = Array.from(botStatsMap.values()).map(s => {
    const winRatePct = s.matchesPlayed > 0 ? Math.round((s.wins / s.matchesPlayed) * 1000) / 10 : 0.0;
    const avgBlunders = s.matchesPlayed > 0 ? Math.round((s.totalBlunders / s.matchesPlayed) * 10) / 10 : 0.0;
    return {
      ...s,
      winRatePct,
      avgBlunders
    };
  });

  rankings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.winRatePct !== a.winRatePct) return b.winRatePct - a.winRatePct;
    return a.avgBlunders - b.avgBlunders;
  });

  return rankings.map((r, idx) => ({ rank: idx + 1, ...r }));
}

function evaluateTierPromotionsAndRelegations(currentRankings = []) {
  if (!Array.isArray(currentRankings)) {
    throw new TypeError('currentRankings must be an array');
  }

  const tierGroups = {
    PREMIER_LEAGUE: [],
    CHAMPIONSHIP: [],
    DIVISION_ONE: []
  };

  for (const bot of currentRankings) {
    const tier = tierGroups[bot.tier] ? bot.tier : 'CHAMPIONSHIP';
    tierGroups[tier].push(bot);
  }

  const transitions = [];

  for (const tierMeta of SEASON_TIERS) {
    const group = tierGroups[tierMeta.id];
    if (!group || group.length === 0) continue;

    group.sort((a, b) => b.points - a.points || b.winRatePct - a.winRatePct);

    if (tierMeta.promotionTargetTier && group.length > 0) {
      const promotedBot = group[0];
      transitions.push({
        botId: promotedBot.botId,
        botName: promotedBot.botName,
        fromTier: tierMeta.id,
        toTier: tierMeta.promotionTargetTier,
        action: 'PROMOTION',
        reason: `Finished 1st in ${tierMeta.title} with ${promotedBot.points} points (${promotedBot.winRatePct}% win rate).`
      });
    }

    if (tierMeta.relegationTargetTier && group.length > 1) {
      const relegatedBot = group[group.length - 1];
      transitions.push({
        botId: relegatedBot.botId,
        botName: relegatedBot.botName,
        fromTier: tierMeta.id,
        toTier: tierMeta.relegationTargetTier,
        action: 'RELEGATION',
        reason: `Finished last in ${tierMeta.title} with ${relegatedBot.points} points.`
      });
    }
  }

  return transitions;
}

function simulateSeasonTransition(seasonId = 'SEASON-1', matchResults = []) {
  const rankings = calculateSeasonRankings(matchResults);
  const transitions = evaluateTierPromotionsAndRelegations(rankings);

  return {
    seasonId,
    totalMatchesProcessed: matchResults.length,
    activeBotsCount: rankings.length,
    standings: rankings,
    transitionsCount: transitions.length,
    transitions,
    evaluatedAt: new Date().toISOString()
  };
}

module.exports = {
  getSeasonTiersCatalog,
  calculateSeasonRankings,
  evaluateTierPromotionsAndRelegations,
  simulateSeasonTransition
};
