const { STRATEGY_PROFILES } = require("./bot_engine");

const TUNING_RULES_CATALOG = Object.freeze([
  {
    id: "TRAILING_WIN_MARGIN",
    title: "Trailing Win Margin vs Comparison Series",
    category: "OUTCOME",
    param: "setCompletionUrgency",
    direction: "increase",
    triggerCondition: "WIN_MARGIN_DIFF against the target series is <= -0.15 in one or more pairwise comparisons",
    rationale: "Target series is losing head-to-head win rate by a wide margin; push toward faster set completion to close races."
  },
  {
    id: "EXCESS_BLUNDER_RATE",
    title: "Excess Tactical Blunder Rate",
    category: "TACTICAL_QUALITY",
    param: "actionCardWeight",
    direction: "decrease",
    triggerCondition: "avgBlunderCount >= 1.5 for the target series summary",
    rationale: "High blunder rate correlates with over-eager action-card targeting; dial back actionCardWeight to favor more selective plays."
  },
  {
    id: "LOW_ASSET_CONVERSION_EFFICIENCY",
    title: "Low Asset Conversion Efficiency",
    category: "RESOURCE_THROUGHPUT",
    param: "propertyAdvanceWeight",
    direction: "increase",
    triggerCondition: "avgAssetConversionRate < 0.5 for the target series summary",
    rationale: "Cards drawn are not converting into board assets quickly enough; increase propertyAdvanceWeight to push hand-to-board throughput."
  },
  {
    id: "HIGH_VARIANCE_INSTABILITY",
    title: "High Cross-Match Variance / Instability",
    category: "CONSISTENCY",
    param: "moneyBufferTarget",
    direction: "increase",
    triggerCondition: "riskFlags includes HIGH_VARIANCE_RISK or assetConversionVariance > 0.1 for the target series summary",
    rationale: "Volatile asset-conversion performance across matches suggests thin cash reserves are amplifying swings; raise moneyBufferTarget for a steadier floor."
  },
  {
    id: "TACTICAL_SUPERIORITY_DEFICIT",
    title: "Tactical Superiority Index Deficit",
    category: "COMPOSITE",
    param: "actionCardWeight",
    direction: "increase",
    triggerCondition: "target series is not the favoredSeriesId in one or more pairwise comparisons",
    rationale: "Target series' composite Tactical Superiority Index trails one or more comparison series; lean into more assertive action-card play to close the gap."
  }
]);

function getTuningRulesCatalog() {
  return TUNING_RULES_CATALOG;
}

const PARAM_STEP = Object.freeze({
  propertyAdvanceWeight: 0.15,
  actionCardWeight: 0.15,
  bankWeight: 0.15,
  setCompletionUrgency: 0.2,
  moneyBufferTarget: 1.5
});

const PARAM_BOUNDS = Object.freeze({
  propertyAdvanceWeight: [0.3, 2.5],
  actionCardWeight: [0.2, 2.5],
  bankWeight: [0.2, 3.0],
  setCompletionUrgency: [0.2, 2.5],
  moneyBufferTarget: [0, 15]
});

function getRule(ruleId) {
  return TUNING_RULES_CATALOG.find(r => r.id === ruleId);
}

function evaluateReplayTuningCandidates(comparison, targetSeriesId) {
  if (!comparison || !Array.isArray(comparison.seriesSummaries)) {
    throw new Error("evaluateReplayTuningCandidates requires a comparison object with seriesSummaries");
  }
  if (!targetSeriesId || typeof targetSeriesId !== "string") {
    throw new Error("evaluateReplayTuningCandidates requires a valid targetSeriesId");
  }
  const summary = comparison.seriesSummaries.find(s => s.seriesId === targetSeriesId);
  if (!summary) {
    throw new Error(`No series summary found for targetSeriesId: ${targetSeriesId}`);
  }

  const relevantPairs = (comparison.pairwiseComparisons || [])
    .filter(p => Array.isArray(p.pair) && p.pair.includes(targetSeriesId));

  const candidates = [];

  const trailingPairs = relevantPairs.filter(p => {
    const isFirst = p.pair[0] === targetSeriesId;
    const signedMargin = isFirst ? p.WIN_MARGIN_DIFF : -p.WIN_MARGIN_DIFF;
    return signedMargin <= -0.15;
  });
  if (trailingPairs.length > 0) {
    const rule = getRule("TRAILING_WIN_MARGIN");
    candidates.push({ ...rule, ruleId: rule.id, magnitude: Math.min(2, trailingPairs.length), evidence: trailingPairs.map(p => ({ pair: p.pair, WIN_MARGIN_DIFF: p.WIN_MARGIN_DIFF })) });
  }

  if (typeof summary.avgBlunderCount === "number" && summary.avgBlunderCount >= 1.5) {
    const rule = getRule("EXCESS_BLUNDER_RATE");
    candidates.push({ ...rule, ruleId: rule.id, magnitude: 1, evidence: [{ avgBlunderCount: summary.avgBlunderCount }] });
  }

  if (typeof summary.avgAssetConversionRate === "number" && summary.avgAssetConversionRate < 0.5) {
    const rule = getRule("LOW_ASSET_CONVERSION_EFFICIENCY");
    candidates.push({ ...rule, ruleId: rule.id, magnitude: 1, evidence: [{ avgAssetConversionRate: summary.avgAssetConversionRate }] });
  }

  const hasVarianceFlag = Array.isArray(summary.riskFlags) && summary.riskFlags.includes("HIGH_VARIANCE_RISK");
  const highVariance = typeof summary.assetConversionVariance === "number" && summary.assetConversionVariance > 0.1;
  if (hasVarianceFlag || highVariance) {
    const rule = getRule("HIGH_VARIANCE_INSTABILITY");
    candidates.push({ ...rule, ruleId: rule.id, magnitude: 1, evidence: [{ riskFlags: summary.riskFlags, assetConversionVariance: summary.assetConversionVariance }] });
  }

  const losingPairs = relevantPairs.filter(p => p.favoredSeriesId !== targetSeriesId);
  if (losingPairs.length > 0) {
    const rule = getRule("TACTICAL_SUPERIORITY_DEFICIT");
    candidates.push({ ...rule, ruleId: rule.id, magnitude: Math.min(2, losingPairs.length), evidence: losingPairs.map(p => ({ pair: p.pair, favoredSeriesId: p.favoredSeriesId })) });
  }

  return { targetSeriesId, evaluatedRuleCount: TUNING_RULES_CATALOG.length, candidates, summary };
}

function generateStrategyTuningRecommendations(comparison, targetSeriesId, currentParams) {
  const evaluation = evaluateReplayTuningCandidates(comparison, targetSeriesId);

  const baseParams = (currentParams && typeof currentParams === "object" && !Array.isArray(currentParams))
    ? currentParams
    : STRATEGY_PROFILES.BALANCED;

  const lowSample = Array.isArray(evaluation.summary.riskFlags) && evaluation.summary.riskFlags.includes("LOW_SAMPLE_SIZE_RISK");
  const candidateCount = evaluation.candidates.length;
  let confidence = "MODERATE";
  if (lowSample) confidence = "LOW";
  else if (candidateCount === 0 || candidateCount >= 3) confidence = "HIGH";
  else if (candidateCount === 1) confidence = "LOW";

  if (candidateCount === 0) {
    return {
      targetSeriesId,
      status: "NO_TUNING_NEEDED",
      triggeredRuleIds: [],
      recommendedAdjustments: {},
      conflictingSignals: {},
      tunedProfile: { ...baseParams },
      confidence,
      narrative: `No tuning rules triggered for ${targetSeriesId}; current strategy parameters appear well-calibrated against the compared series.`
    };
  }

  const netStepsByParam = {};
  const contributorsByParam = {};
  evaluation.candidates.forEach(c => {
    const signedSteps = (c.direction === "increase" ? 1 : -1) * c.magnitude;
    netStepsByParam[c.param] = (netStepsByParam[c.param] || 0) + signedSteps;
    contributorsByParam[c.param] = (contributorsByParam[c.param] || []).concat(c.ruleId);
  });

  const recommendedAdjustments = {};
  const conflictingSignals = {};
  Object.keys(netStepsByParam).forEach(param => {
    const netSteps = netStepsByParam[param];
    const currentValue = typeof baseParams[param] === "number" ? baseParams[param] : 0;
    if (netSteps === 0) {
      conflictingSignals[param] = { triggeredBy: contributorsByParam[param], note: "Triggered rules canceled out; no net adjustment applied." };
      return;
    }
    const step = PARAM_STEP[param] || 0.1;
    const [min, max] = PARAM_BOUNDS[param] || [0, Infinity];
    const rawValue = currentValue + netSteps * step;
    const recommendedValue = Math.round(Math.max(min, Math.min(max, rawValue)) * 1000) / 1000;
    recommendedAdjustments[param] = {
      currentValue,
      recommendedValue,
      delta: Math.round((recommendedValue - currentValue) * 1000) / 1000,
      direction: recommendedValue >= currentValue ? "increase" : "decrease",
      triggeredBy: contributorsByParam[param]
    };
  });

  const tunedProfile = { ...baseParams };
  Object.keys(recommendedAdjustments).forEach(param => { tunedProfile[param] = recommendedAdjustments[param].recommendedValue; });

  const narrativeParts = evaluation.candidates.map(c => c.rationale);
  if (Object.keys(conflictingSignals).length > 0) {
    narrativeParts.push(`Conflicting signals on ${Object.keys(conflictingSignals).join(", ")} canceled out with no net change.`);
  }

  return {
    targetSeriesId,
    status: "TUNING_RECOMMENDED",
    triggeredRuleIds: evaluation.candidates.map(c => c.ruleId),
    recommendedAdjustments,
    conflictingSignals,
    tunedProfile,
    confidence,
    narrative: narrativeParts.join(" ")
  };
}

module.exports = {
  TUNING_RULES_CATALOG,
  getTuningRulesCatalog,
  evaluateReplayTuningCandidates,
  generateStrategyTuningRecommendations
};
