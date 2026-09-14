const { STRATEGY_PROFILES } = require("./bot_engine");

const RUSHER_FAST_WIN_TURN_THRESHOLD = 15;
const DOMINANT_MIN_SCORE = 70;
const DOMINANT_MIN_WINRATE = 0.6;
const DOMINANT_MAX_BLUNDERS = 0.5;
const PASSIVE_MAX_WINRATE = 0.4;
const PASSIVE_MAX_ASSET_CONVERSION = 0.5;
const RUSHER_MIN_WINRATE = 0.5;

const META_STRATEGY_RULES_CATALOG = Object.freeze([
  {
    id: "COUNTER_DOMINANT_AGGRESSOR",
    title: "Counter a Dominant Aggressor Opponent",
    category: "OPPONENT_ARCHETYPE",
    archetype: "DOMINANT_AGGRESSOR",
    adjustments: Object.freeze([
      { param: "actionCardWeight", direction: "decrease" },
      { param: "moneyBufferTarget", direction: "increase" }
    ]),
    triggerCondition: "An opponent's tacticalDominanceScore >= 70, winRate >= 0.6, and avgBlundersPerMatch <= 0.5",
    rationale: "A clean, dominant opponent is out-executing us; pull back on risky action-card exchanges and build a larger cash buffer to absorb their pressure."
  },
  {
    id: "EXPLOIT_PASSIVE_HOARDER",
    title: "Exploit a Passive Hoarder Opponent",
    category: "OPPONENT_ARCHETYPE",
    archetype: "PASSIVE_HOARDER",
    adjustments: Object.freeze([
      { param: "propertyAdvanceWeight", direction: "increase" },
      { param: "actionCardWeight", direction: "increase" }
    ]),
    triggerCondition: "An opponent's winRate <= 0.4 while their replay-benchmark avgAssetConversionRate < 0.5",
    rationale: "Opponent is winning rarely and converting drawn cards to board assets slowly; press the advantage with faster property development and more assertive action-card play."
  },
  {
    id: "NEUTRALIZE_RUSHER",
    title: "Neutralize a Set-Completion Rusher",
    category: "OPPONENT_ARCHETYPE",
    archetype: "RUSHER",
    adjustments: Object.freeze([
      { param: "setCompletionUrgency", direction: "increase" }
    ]),
    triggerCondition: "An opponent's winRate >= 0.5 with avgTurnsToWin <= 15",
    rationale: "Opponent wins by completing sets unusually fast; match their urgency to avoid being out-raced to the win condition."
  },
  {
    id: "STABILIZE_HIGH_VARIANCE",
    title: "Stabilize Our Own High-Variance Performance",
    category: "SELF_CONSISTENCY",
    archetype: null,
    adjustments: Object.freeze([
      { param: "moneyBufferTarget", direction: "increase" }
    ]),
    triggerCondition: "Our own replay-benchmark summary reports HIGH_VARIANCE_RISK or assetConversionVariance > 0.1",
    rationale: "Our own results are swinging widely match to match; raise our cash buffer target for a steadier floor regardless of opponent."
  },
  {
    id: "PRESERVE_BALANCED_BASELINE",
    title: "Preserve Balanced Baseline",
    category: "BASELINE",
    archetype: null,
    adjustments: Object.freeze([]),
    triggerCondition: "No opponent archetype divergence and no self-instability signal detected",
    rationale: "No significant meta-strategy divergence detected; current profile parameters are retained unchanged."
  }
]);

function getMetaStrategyRulesCatalog() {
  return META_STRATEGY_RULES_CATALOG;
}

function getMetaRule(ruleId) {
  return META_STRATEGY_RULES_CATALOG.find(r => r.id === ruleId);
}

const ARCHETYPE_TO_RULE_ID = META_STRATEGY_RULES_CATALOG
  .filter(r => r.archetype)
  .reduce((acc, r) => { acc[r.archetype] = r.id; return acc; }, {});

const PARAM_STEP = Object.freeze({
  propertyAdvanceWeight: 0.15,
  actionCardWeight: 0.15,
  setCompletionUrgency: 0.2,
  moneyBufferTarget: 1.5
});

const PARAM_BOUNDS = Object.freeze({
  propertyAdvanceWeight: [0.3, 2.5],
  actionCardWeight: [0.2, 2.5],
  setCompletionUrgency: [0.2, 2.5],
  moneyBufferTarget: [0, 15]
});

function classifyArchetype(standingRow, replaySummary) {
  const { winRate, avgTurnsToWin, avgBlundersPerMatch, tacticalDominanceScore } = standingRow;
  if (tacticalDominanceScore >= DOMINANT_MIN_SCORE && winRate >= DOMINANT_MIN_WINRATE && avgBlundersPerMatch <= DOMINANT_MAX_BLUNDERS) {
    return "DOMINANT_AGGRESSOR";
  }
  if (winRate <= PASSIVE_MAX_WINRATE && replaySummary && typeof replaySummary.avgAssetConversionRate === "number" && replaySummary.avgAssetConversionRate < PASSIVE_MAX_ASSET_CONVERSION) {
    return "PASSIVE_HOARDER";
  }
  if (winRate >= RUSHER_MIN_WINRATE && typeof avgTurnsToWin === "number" && avgTurnsToWin <= RUSHER_FAST_WIN_TURN_THRESHOLD) {
    return "RUSHER";
  }
  return "NEUTRAL";
}

function evaluateTournamentMetaDivergence(standings, replaySummaries) {
  if (!standings || !Array.isArray(standings.standings) || standings.standings.length === 0) {
    throw new Error("evaluateTournamentMetaDivergence requires a standings object with a non-empty standings array");
  }
  const summaries = Array.isArray(replaySummaries) ? replaySummaries : [];

  const strategyArchetypes = standings.standings.map(row => {
    const replaySummary = summaries.find(s => s && s.seriesId === row.strategy) || null;
    return {
      strategy: row.strategy,
      archetype: classifyArchetype(row, replaySummary),
      winRate: row.winRate,
      avgTurnsToWin: row.avgTurnsToWin,
      avgBlundersPerMatch: row.avgBlundersPerMatch,
      tacticalDominanceScore: row.tacticalDominanceScore,
      riskFlags: row.riskFlags,
      replaySignals: replaySummary ? {
        avgAssetConversionRate: replaySummary.avgAssetConversionRate,
        assetConversionVariance: replaySummary.assetConversionVariance,
        avgEfficiencyRating: replaySummary.avgEfficiencyRating,
        riskFlags: replaySummary.riskFlags
      } : null
    };
  });

  return {
    tournamentSeriesId: standings.tournamentSeriesId || null,
    strategyArchetypes,
    headToHead: Array.isArray(standings.headToHead) ? standings.headToHead : [],
    generatedAt: Date.now()
  };
}

function selfHasHighVariance(selfEntry) {
  if (!selfEntry || !selfEntry.replaySignals) return false;
  const { assetConversionVariance, riskFlags } = selfEntry.replaySignals;
  return (Array.isArray(riskFlags) && riskFlags.includes("HIGH_VARIANCE_RISK")) ||
    (typeof assetConversionVariance === "number" && assetConversionVariance > 0.1);
}

function adaptTournamentMetaStrategy(currentStrategy, tournamentMeta) {
  if (!currentStrategy || typeof currentStrategy !== "string") {
    throw new Error("adaptTournamentMetaStrategy requires a valid currentStrategy string");
  }
  const strategyKey = currentStrategy.toUpperCase();
  if (!STRATEGY_PROFILES[strategyKey]) {
    throw new Error(`Unknown strategy: ${currentStrategy}`);
  }
  if (!tournamentMeta || !Array.isArray(tournamentMeta.strategyArchetypes) || tournamentMeta.strategyArchetypes.length === 0) {
    throw new Error("adaptTournamentMetaStrategy requires a tournamentMeta object with strategyArchetypes");
  }

  const selfEntry = tournamentMeta.strategyArchetypes.find(a => a.strategy === strategyKey) || null;
  const opponents = tournamentMeta.strategyArchetypes.filter(a => a.strategy !== strategyKey);
  const relevantHeadToHead = (tournamentMeta.headToHead || []).filter(h => Array.isArray(h.pair) && h.pair.includes(strategyKey));

  const candidates = [];

  opponents.forEach(opp => {
    const ruleId = ARCHETYPE_TO_RULE_ID[opp.archetype];
    if (!ruleId) return;
    const rule = getMetaRule(ruleId);
    const h2h = relevantHeadToHead.find(h => h.pair.includes(opp.strategy)) || null;
    candidates.push({ ruleId: rule.id, adjustments: rule.adjustments, evidence: { opponent: opp.strategy, archetype: opp.archetype, headToHead: h2h } });
  });

  if (selfHasHighVariance(selfEntry)) {
    const rule = getMetaRule("STABILIZE_HIGH_VARIANCE");
    candidates.push({ ruleId: rule.id, adjustments: rule.adjustments, evidence: { self: strategyKey, replaySignals: selfEntry.replaySignals } });
  }

  if (candidates.length === 0) {
    const rule = getMetaRule("PRESERVE_BALANCED_BASELINE");
    return {
      currentStrategy: strategyKey,
      status: "BASELINE_PRESERVED",
      triggeredRuleIds: [rule.id],
      recommendedAdjustments: {},
      conflictingSignals: {},
      adaptedProfile: { ...STRATEGY_PROFILES[strategyKey] },
      narrative: rule.rationale
    };
  }

  const netStepsByParam = {};
  const contributorsByParam = {};
  candidates.forEach(c => {
    c.adjustments.forEach(adj => {
      const signed = adj.direction === "increase" ? 1 : -1;
      netStepsByParam[adj.param] = (netStepsByParam[adj.param] || 0) + signed;
      contributorsByParam[adj.param] = (contributorsByParam[adj.param] || []).concat(c.ruleId);
    });
  });

  const baseParams = STRATEGY_PROFILES[strategyKey];
  const recommendedAdjustments = {};
  const conflictingSignals = {};
  Object.keys(netStepsByParam).forEach(param => {
    const netSteps = netStepsByParam[param];
    const currentValue = typeof baseParams[param] === "number" ? baseParams[param] : 0;
    const triggeredBy = [...new Set(contributorsByParam[param])];
    if (netSteps === 0) {
      conflictingSignals[param] = { triggeredBy, note: "Opposing meta signals canceled out; no net adjustment applied." };
      return;
    }
    const step = PARAM_STEP[param] || 0.15;
    const [min, max] = PARAM_BOUNDS[param] || [0, Infinity];
    const rawValue = currentValue + netSteps * step;
    const recommendedValue = Math.round(Math.max(min, Math.min(max, rawValue)) * 1000) / 1000;
    recommendedAdjustments[param] = {
      currentValue,
      recommendedValue,
      delta: Math.round((recommendedValue - currentValue) * 1000) / 1000,
      direction: recommendedValue >= currentValue ? "increase" : "decrease",
      triggeredBy
    };
  });

  const adaptedProfile = { ...baseParams };
  Object.keys(recommendedAdjustments).forEach(param => { adaptedProfile[param] = recommendedAdjustments[param].recommendedValue; });

  return {
    currentStrategy: strategyKey,
    status: "META_ADAPTATION_APPLIED",
    triggeredRuleIds: [...new Set(candidates.map(c => c.ruleId))],
    recommendedAdjustments,
    conflictingSignals,
    adaptedProfile,
    narrative: [...new Set(candidates.map(c => c.ruleId))].map(id => getMetaRule(id).rationale).join(" ")
  };
}

module.exports = {
  META_STRATEGY_RULES_CATALOG,
  getMetaStrategyRulesCatalog,
  evaluateTournamentMetaDivergence,
  adaptTournamentMetaStrategy
};
