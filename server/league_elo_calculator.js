const DEFAULT_RATING = 1200;
const DEFAULT_K_FACTOR = 32;
const DRIFT_THRESHOLD = 15;
const HIGH_VOLATILITY_STDDEV_THRESHOLD = 40;
const MIN_HISTORY_FOR_CONFIDENCE = 6;

const ELO_RATING_TIERS_CATALOG = Object.freeze([
  { id: "NOVICE", title: "Novice", minRating: 0, maxRating: 1099, description: "Early-stage skill; ratings not yet stabilized." },
  { id: "CLUB", title: "Club Level", minRating: 1100, maxRating: 1299, description: "Consistent baseline competence against the field." },
  { id: "COMPETENT", title: "Competent", minRating: 1300, maxRating: 1499, description: "Reliable wins against club-level and novice opposition." },
  { id: "EXPERT", title: "Expert", minRating: 1500, maxRating: 1699, description: "Strong, consistent tournament performance." },
  { id: "MASTER", title: "Master", minRating: 1700, maxRating: Infinity, description: "Top-tier league performance sustained across many matches." }
]);

function getEloRatingTiersCatalog() {
  return ELO_RATING_TIERS_CATALOG;
}

function getTierForRating(rating) {
  return ELO_RATING_TIERS_CATALOG.find(t => rating >= t.minRating && rating <= t.maxRating) || ELO_RATING_TIERS_CATALOG[0];
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function calculateMultiplayerEloDeltas(participants, matchResult, options = {}) {
  if (!Array.isArray(participants) || participants.length < 2) {
    throw new Error("calculateMultiplayerEloDeltas requires at least 2 participants");
  }
  const ids = participants.map(p => p.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("participants must have unique id values");
  }

  const winnerId = (matchResult && matchResult.winnerId !== undefined) ? matchResult.winnerId : null;
  if (winnerId !== null && !ids.includes(winnerId)) {
    throw new Error(`matchResult.winnerId does not match any participant: ${winnerId}`);
  }

  const kFactor = Math.max(10, Math.min(64, Number(options.kFactor) || DEFAULT_K_FACTOR));

  const normalized = participants.map(p => ({
    id: p.id,
    rating: (typeof p.rating === "number" && !isNaN(p.rating)) ? p.rating : DEFAULT_RATING
  }));

  const n = normalized.length;
  const results = normalized.map(p => {
    let expectedSum = 0;
    let actualSum = 0;
    normalized.forEach(opp => {
      if (opp.id === p.id) return;
      expectedSum += expectedScore(p.rating, opp.rating);
      if (winnerId === null) {
        actualSum += 0.5;
      } else if (p.id === winnerId) {
        actualSum += 1;
      } else if (opp.id === winnerId) {
        actualSum += 0;
      } else {
        actualSum += 0.5;
      }
    });

    const avgExpected = expectedSum / (n - 1);
    const avgActual = actualSum / (n - 1);
    const delta = Number((kFactor * (avgActual - avgExpected)).toFixed(2));
    const newRating = Math.max(100, Math.round(p.rating + delta));

    return {
      id: p.id,
      previousRating: p.rating,
      expectedScore: Number(avgExpected.toFixed(3)),
      actualScore: Number(avgActual.toFixed(3)),
      delta,
      newRating,
      tier: getTierForRating(newRating).id
    };
  });

  return { winnerId, kFactor, participantCount: n, participants: results };
}

function mean(nums) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function populationStdDev(nums) {
  if (nums.length <= 1) return 0;
  const m = mean(nums);
  return Math.sqrt(nums.reduce((acc, v) => acc + Math.pow(v - m, 2), 0) / nums.length);
}

function detectSkillDrift(ratingHistory) {
  if (!Array.isArray(ratingHistory) || ratingHistory.length === 0) {
    throw new Error("detectSkillDrift requires a non-empty ratingHistory array");
  }
  const ratings = ratingHistory.map(entry => (typeof entry === "number" ? entry : entry.rating));
  if (ratings.some(r => typeof r !== "number" || isNaN(r))) {
    throw new Error("detectSkillDrift requires numeric rating values");
  }

  const half = Math.max(1, Math.floor(ratings.length / 2));
  const baselineWindow = ratings.slice(0, half);
  const recentWindow = ratings.slice(half);

  const baselineAvg = Number(mean(baselineWindow).toFixed(1));
  const recentAvg = recentWindow.length > 0 ? Number(mean(recentWindow).toFixed(1)) : baselineAvg;
  const driftMagnitude = Number((recentAvg - baselineAvg).toFixed(1));

  let driftDirection = "STABLE";
  if (driftMagnitude >= DRIFT_THRESHOLD) driftDirection = "IMPROVING";
  else if (driftMagnitude <= -DRIFT_THRESHOLD) driftDirection = "DECLINING";

  const consecutiveDeltas = [];
  for (let i = 1; i < ratings.length; i++) {
    consecutiveDeltas.push(ratings[i] - ratings[i - 1]);
  }
  const volatility = Number(populationStdDev(consecutiveDeltas).toFixed(2));

  const riskFlags = [];
  if (ratings.length < MIN_HISTORY_FOR_CONFIDENCE) riskFlags.push("INSUFFICIENT_HISTORY_RISK");
  if (volatility >= HIGH_VOLATILITY_STDDEV_THRESHOLD) riskFlags.push("HIGH_VOLATILITY_RISK");

  return {
    matchesConsidered: ratings.length,
    baselineAvg,
    recentAvg,
    driftMagnitude,
    driftDirection,
    volatility,
    startTier: getTierForRating(ratings[0]).id,
    currentTier: getTierForRating(ratings[ratings.length - 1]).id,
    riskFlags
  };
}

module.exports = {
  DEFAULT_RATING,
  DEFAULT_K_FACTOR,
  ELO_RATING_TIERS_CATALOG,
  getEloRatingTiersCatalog,
  getTierForRating,
  calculateMultiplayerEloDeltas,
  detectSkillDrift
};
