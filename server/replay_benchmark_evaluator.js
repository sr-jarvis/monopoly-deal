const match_replay_analyzer = require("./match_replay_analyzer");

const BENCHMARK_METRIC_TYPES_CATALOG = Object.freeze([
  {
    id: "WIN_MARGIN_DIFF",
    unit: "win-rate points (-1..1)",
    title: "Win Margin / Win-Rate Differential",
    description: "seriesA.winRate - seriesB.winRate — covers head-to-head win margin and win-rate differential between strategy series."
  },
  {
    id: "BLUNDER_RATE_GAP",
    unit: "blunders/match",
    title: "Blunder Rate Gap",
    description: "Difference in average tactical blunders per match between two strategy series."
  },
  {
    id: "EFFICIENCY_DELTA",
    unit: "percentage points",
    title: "Efficiency Delta",
    description: "Difference in average action-efficiency rating between two strategy series."
  },
  {
    id: "TACTICAL_SUPERIORITY_INDEX",
    unit: "0-100 composite",
    title: "Tactical Superiority Index",
    description: "Composite score blending win rate, efficiency rating, blunder frequency, and asset conversion performance."
  },
  {
    id: "ASSET_CONVERSION_VARIANCE",
    unit: "variance",
    title: "Asset Conversion Variance",
    description: "Statistical variance of a single series' own asset-conversion rate across its matches — a within-series consistency indicator."
  }
]);

function getBenchmarkMetricTypesCatalog() {
  return BENCHMARK_METRIC_TYPES_CATALOG;
}

function mean(nums) {
  if (!nums || nums.length === 0) return 0;
  const sum = nums.reduce((acc, val) => acc + val, 0);
  return sum / nums.length;
}

function populationVariance(nums) {
  if (!nums || nums.length <= 1) return 0;
  const m = mean(nums);
  const varianceSum = nums.reduce((acc, val) => acc + Math.pow(val - m, 2), 0);
  return varianceSum / nums.length;
}

function clamp(min, max, val) {
  return Math.max(min, Math.min(max, val));
}

function summarizeReplaySeries(series) {
  if (!series || typeof series !== "object") {
    throw new Error("summarizeReplaySeries requires a series object");
  }
  const { seriesId, subjectPlayerId, matches } = series;
  if (!seriesId || typeof seriesId !== "string") {
    throw new Error("summarizeReplaySeries requires a valid seriesId");
  }
  if (!subjectPlayerId || typeof subjectPlayerId !== "string") {
    throw new Error("summarizeReplaySeries requires a valid subjectPlayerId");
  }
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new Error("summarizeReplaySeries requires a non-empty matches array");
  }

  let wins = 0;
  let matchesFinished = 0;
  let matchesWithReplayData = 0;

  const efficiencyRatings = [];
  const assetConversionRates = [];
  const blunderCounts = [];
  const botCounts = [];
  const maxTurnsConfiguredList = [];

  for (const match of matches) {
    if (!match) continue;
    const finished = match.status === "FINISHED";
    if (finished) {
      matchesFinished++;
      if (match.winnerId === subjectPlayerId) {
        wins++;
      }
    }

    if (Array.isArray(match.strategies)) {
      botCounts.push(match.strategies.length);
    }
    if (typeof match.maxTurnsConfigured === "number") {
      maxTurnsConfiguredList.push(match.maxTurnsConfigured);
    }

    if (Array.isArray(match.replayLog) && match.replayLog.length > 0) {
      try {
        const analysis = match_replay_analyzer.analyzeMatchReplay(match.replayLog);
        if (analysis && analysis.perPlayer && analysis.perPlayer[subjectPlayerId]) {
          const perPlayer = analysis.perPlayer[subjectPlayerId];
          matchesWithReplayData++;
          if (typeof perPlayer.efficiencyRating === "number") {
            efficiencyRatings.push(perPlayer.efficiencyRating);
          }
          if (typeof perPlayer.assetConversionRate === "number") {
            assetConversionRates.push(perPlayer.assetConversionRate);
          }
          if (typeof perPlayer.blunderCount === "number") {
            blunderCounts.push(perPlayer.blunderCount);
          }
        }
      } catch (err) {
        // Skip malformed individual match replay logs gracefully
      }
    }
  }

  const matchesConsidered = matches.length;
  const winRate = matchesFinished > 0 ? Number((wins / matchesFinished).toFixed(3)) : 0;
  const avgEfficiencyRating = efficiencyRatings.length > 0 ? Number(mean(efficiencyRatings).toFixed(2)) : 0;
  const avgAssetConversionRate = assetConversionRates.length > 0 ? Number(mean(assetConversionRates).toFixed(3)) : 0;
  const assetConversionVariance = assetConversionRates.length > 1 ? Number(populationVariance(assetConversionRates).toFixed(4)) : 0;
  const avgBlunderCount = blunderCounts.length > 0 ? Number(mean(blunderCounts).toFixed(2)) : 0;

  const rawTsi =
    winRate * 100 * 0.40 +
    avgEfficiencyRating * 0.25 +
    Math.min(avgAssetConversionRate, 1.5) * 100 * 0.20 +
    Math.max(0, 20 - avgBlunderCount * 5) * 0.15;
  const tacticalSuperiorityIndex = clamp(0, 100, Math.round(rawTsi));

  const riskFlags = [];
  if (matchesConsidered < 5) {
    riskFlags.push("LOW_SAMPLE_SIZE_RISK");
  }
  if (matchesFinished / matchesConsidered < 0.5) {
    riskFlags.push("INCONCLUSIVE_MATCHES_RISK");
  }
  if (matchesWithReplayData < matchesFinished) {
    riskFlags.push("MISSING_REPLAY_DATA_RISK");
  }
  if (assetConversionVariance > 0.1) {
    riskFlags.push("HIGH_VARIANCE_RISK");
  }

  return {
    seriesId,
    subjectPlayerId,
    matchesConsidered,
    matchesFinished,
    matchesWithReplayData,
    winRate,
    avgEfficiencyRating,
    avgAssetConversionRate,
    assetConversionVariance,
    avgBlunderCount,
    tacticalSuperiorityIndex,
    botCountMode: botCounts.length > 0 ? botCounts[0] : null,
    maxTurnsMode: maxTurnsConfiguredList.length > 0 ? maxTurnsConfiguredList[0] : null,
    riskFlags
  };
}

function compareReplaySeries(seriesList) {
  if (!Array.isArray(seriesList) || seriesList.length < 2) {
    throw new Error("compareReplaySeries requires at least 2 replay series");
  }

  const seenIds = new Set();
  for (const s of seriesList) {
    if (!s || !s.seriesId) continue;
    if (seenIds.has(s.seriesId)) {
      throw new Error(`Duplicate seriesId: ${s.seriesId}`);
    }
    seenIds.add(s.seriesId);
  }

  const summaries = seriesList.map(summarizeReplaySeries);

  const pairwiseComparisons = [];
  for (let i = 0; i < summaries.length; i++) {
    for (let j = i + 1; j < summaries.length; j++) {
      const a = summaries[i];
      const b = summaries[j];

      const winMarginDiff = Number((a.winRate - b.winRate).toFixed(3));
      const efficiencyDelta = Number((a.avgEfficiencyRating - b.avgEfficiencyRating).toFixed(2));
      const blunderRateGap = Number((a.avgBlunderCount - b.avgBlunderCount).toFixed(2));
      const favoredSeriesId = a.tacticalSuperiorityIndex >= b.tacticalSuperiorityIndex ? a.seriesId : b.seriesId;

      pairwiseComparisons.push({
        pair: [a.seriesId, b.seriesId],
        WIN_MARGIN_DIFF: winMarginDiff,
        EFFICIENCY_DELTA: efficiencyDelta,
        BLUNDER_RATE_GAP: blunderRateGap,
        tacticalSuperiorityIndex: {
          [a.seriesId]: a.tacticalSuperiorityIndex,
          [b.seriesId]: b.tacticalSuperiorityIndex
        },
        favoredSeriesId
      });
    }
  }

  const overallRanking = [...summaries]
    .sort((a, b) => b.tacticalSuperiorityIndex - a.tacticalSuperiorityIndex)
    .map((s) => s.seriesId);

  const crossSeriesRiskFlags = [];
  const botCounts = summaries.map((s) => s.botCountMode).filter((v) => v !== null);
  if (botCounts.length > 1 && new Set(botCounts).size > 1) {
    crossSeriesRiskFlags.push("NON_COMPARABLE_CONDITIONS_RISK");
  }

  return {
    seriesSummaries: summaries,
    pairwiseComparisons,
    overallRanking,
    crossSeriesRiskFlags
  };
}

module.exports = {
  getBenchmarkMetricTypesCatalog,
  summarizeReplaySeries,
  compareReplaySeries
};
