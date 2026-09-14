'use strict';

const opponentProfiles = new Map();
const MAX_HISTORY_PER_OPPONENT = 500;

const OBSERVED_ACTION_TYPES = Object.freeze([
  'PLAY_PROPERTY',
  'PLAY_ACTION_CARD',
  'BANK',
  'DISCARD',
  'HELD_JUST_SAY_NO',
  'END_TURN'
]);

const TENDENCY_CATEGORIES_CATALOG = Object.freeze([
  {
    id: "HOARDER",
    title: "Cash Hoarder",
    description: "Banks a disproportionate share of cards relative to property plays.",
    observedSignal: "BANK vs PLAY_PROPERTY ratio"
  },
  {
    id: "AGGRESSOR",
    title: "Action-Card Aggressor",
    description: "Frequently plays Deal Breaker, Sly Deal, Forced Deal, or Debt Collector against opponents.",
    observedSignal: "targeted action-card plays / total observations"
  },
  {
    id: "RUSHER",
    title: "Set-Completion Rusher",
    description: "Completes property sets in rapid succession with little banking delay.",
    observedSignal: "turnNumber cadence between PLAY_PROPERTY observations"
  },
  {
    id: "DEFENSIVE_HOLDER",
    title: "Just Say No Holder",
    description: "Tends to retain Just Say No in reserve rather than playing or banking it.",
    observedSignal: "HELD_JUST_SAY_NO vs Just-Say-No played/banked ratio"
  },
  {
    id: "PREDICTABLE_TARGETER",
    title: "Predictable Targeter",
    description: "Repeatedly aims steal-type action cards at the same opponent/color pair.",
    observedSignal: "max repeat count of a single (targetPlayerId, targetPropertyColor) pair"
  }
]);

function getTendencyCategoriesCatalog() {
  return TENDENCY_CATEGORIES_CATALOG;
}

function recordOpponentObservedAction(opponentKey, observation) {
  if (!opponentKey || typeof opponentKey !== 'string') {
    throw new Error("opponentKey must be a non-empty string");
  }
  if (!observation || !OBSERVED_ACTION_TYPES.includes(observation.actionType)) {
    throw new Error(`Unknown or missing actionType: ${observation ? observation.actionType : 'undefined'}`);
  }
  if (observation.actionType === 'PLAY_ACTION_CARD' && (!observation.cardTitle || typeof observation.cardTitle !== 'string')) {
    throw new Error("cardTitle is required for PLAY_ACTION_CARD observations");
  }

  if (!opponentProfiles.has(opponentKey)) {
    opponentProfiles.set(opponentKey, { history: [] });
  }

  const entry = opponentProfiles.get(opponentKey);
  const normalizedRecord = {
    actionType: observation.actionType,
    cardTitle: observation.cardTitle || null,
    targetPlayerId: observation.targetPlayerId || null,
    targetPropertyColor: observation.targetPropertyColor || null,
    turnNumber: typeof observation.turnNumber === 'number' ? observation.turnNumber : null,
    recordedAt: typeof observation.timestamp === 'number' ? observation.timestamp : Date.now()
  };

  entry.history.push(normalizedRecord);
  if (entry.history.length > MAX_HISTORY_PER_OPPONENT) {
    entry.history.shift();
  }

  return {
    opponentKey,
    totalObservations: entry.history.length,
    recorded: normalizedRecord
  };
}

function roundVal(v) {
  return Math.round(v * 1000) / 1000;
}

function getStrengthLabel(score) {
  if (score >= 0.75) return 'DOMINANT';
  if (score >= 0.50) return 'STRONG';
  if (score >= 0.25) return 'MODERATE';
  return 'WEAK';
}

function calculateOpponentBehaviorProfile(opponentKey) {
  const entry = opponentProfiles.get(opponentKey);
  if (!entry || entry.history.length === 0) {
    throw new Error(`No observations recorded for opponentKey: ${opponentKey}`);
  }

  const history = entry.history;
  const totalObs = history.length;

  let bankCount = 0;
  let propertyPlayCount = 0;
  let targetedActionCount = 0;
  let heldJsnCount = 0;
  let jsnPlayedOrBankedCount = 0;

  const targetPairs = new Map();
  let targetingObsCount = 0;
  const propertyTurns = [];

  const ATTACK_CARDS = ['Deal Breaker', 'Sly Deal', 'Forced Deal', 'Debt Collector'];

  for (const rec of history) {
    if (rec.actionType === 'BANK') bankCount++;
    if (rec.actionType === 'PLAY_PROPERTY') {
      propertyPlayCount++;
      if (rec.turnNumber !== null) propertyTurns.push(rec.turnNumber);
    }
    if (rec.actionType === 'PLAY_ACTION_CARD') {
      if (ATTACK_CARDS.includes(rec.cardTitle)) targetedActionCount++;
      if (rec.cardTitle === 'Just Say No') jsnPlayedOrBankedCount++;
    }
    if (rec.actionType === 'BANK' && rec.cardTitle === 'Just Say No') {
      jsnPlayedOrBankedCount++;
    }
    if (rec.actionType === 'HELD_JUST_SAY_NO') {
      heldJsnCount++;
    }
    if (rec.targetPlayerId && rec.targetPropertyColor) {
      targetingObsCount++;
      const pairKey = `${rec.targetPlayerId}:${rec.targetPropertyColor}`;
      targetPairs.set(pairKey, (targetPairs.get(pairKey) || 0) + 1);
    }
  }

  // HOARDER
  const hoarderDenom = bankCount + propertyPlayCount;
  const hoarderScore = hoarderDenom > 0 ? roundVal(bankCount / hoarderDenom) : 0;

  // AGGRESSOR
  const aggressorScore = roundVal(targetedActionCount / totalObs);

  // RUSHER
  let rusherScore = 0;
  let rusherQuality = 'LIMITED';
  if (propertyTurns.length >= 2) {
    let gapSum = 0;
    for (let i = 1; i < propertyTurns.length; i++) {
      gapSum += Math.abs(propertyTurns[i] - propertyTurns[i - 1]);
    }
    const avgGap = gapSum / (propertyTurns.length - 1);
    rusherScore = roundVal(Math.min(1.0, 1.0 / Math.max(1.0, avgGap)));
    rusherQuality = 'SUFFICIENT';
  } else {
    rusherScore = roundVal(propertyPlayCount / totalObs);
  }

  // DEFENSIVE_HOLDER
  let defensiveScore = 0;
  let defensiveQuality = 'SUFFICIENT';
  const jsnDenom = heldJsnCount + jsnPlayedOrBankedCount;
  if (jsnDenom > 0) {
    defensiveScore = roundVal(heldJsnCount / jsnDenom);
  } else {
    defensiveQuality = 'INSUFFICIENT';
  }

  // PREDICTABLE_TARGETER
  let maxTargetRepeat = 0;
  let mostRepeatedColor = null;
  for (const [pairKey, count] of targetPairs.entries()) {
    if (count > maxTargetRepeat) {
      maxTargetRepeat = count;
      mostRepeatedColor = pairKey.split(':')[1];
    }
  }
  const predictableScore = targetingObsCount > 0 ? roundVal(maxTargetRepeat / targetingObsCount) : 0;

  const traits = [
    { categoryId: "HOARDER", score: hoarderScore, strength: getStrengthLabel(hoarderScore), dataQuality: "SUFFICIENT", sampleSize: totalObs },
    { categoryId: "AGGRESSOR", score: aggressorScore, strength: getStrengthLabel(aggressorScore), dataQuality: "SUFFICIENT", sampleSize: totalObs },
    { categoryId: "RUSHER", score: rusherScore, strength: getStrengthLabel(rusherScore), dataQuality: rusherQuality, sampleSize: propertyPlayCount },
    { categoryId: "DEFENSIVE_HOLDER", score: defensiveScore, strength: getStrengthLabel(defensiveScore), dataQuality: defensiveQuality, sampleSize: jsnDenom },
    { categoryId: "PREDICTABLE_TARGETER", score: predictableScore, strength: getStrengthLabel(predictableScore), dataQuality: targetingObsCount > 0 ? "SUFFICIENT" : "INSUFFICIENT", sampleSize: targetingObsCount, mostRepeatedColor }
  ];

  traits.sort((a, b) => b.score - a.score);

  const dominantTrait = traits[0].score > 0 ? traits[0].categoryId : null;

  return {
    opponentKey,
    totalObservations: totalObs,
    traits,
    dominantTrait
  };
}

function recommendCounterTacticsForProfile(opponentKey) {
  const profile = calculateOpponentBehaviorProfile(opponentKey);
  const recommendations = [];

  for (const trait of profile.traits) {
    if (trait.strength === 'STRONG' || trait.strength === 'DOMINANT') {
      if (trait.categoryId === 'HOARDER') {
        recommendations.push({
          tacticId: 'LEAN_AGGRESSIVE_STRATEGY',
          reason: "Opponent hoards cash rather than punishing exposure quickly — bias bot strategy toward AGGRESSIVE and turn_planner towards AGGRESSIVE_SET_COMPLETE."
        });
      } else if (trait.categoryId === 'AGGRESSOR') {
        recommendations.push({
          tacticId: 'RAISE_SET_PROTECTION_DISCIPLINE',
          reason: "Opponent frequently plays targeted attack action cards — raise setProtectionDiscipline and prioritize dealbreaker_defense RETAIN_JUST_SAY_NO."
        });
      } else if (trait.categoryId === 'RUSHER') {
        recommendations.push({
          tacticId: 'TREAT_RACE_AS_URGENT',
          reason: "Opponent completes property sets in rapid succession — weight finisher_planner raceDetection more conservatively against this opponent."
        });
      } else if (trait.categoryId === 'DEFENSIVE_HOLDER') {
        recommendations.push({
          tacticId: 'ASSUME_JUST_SAY_NO_READY',
          reason: "Opponent retains Just Say No in reserve — treat aggressive action-card plays against them as lower EV."
        });
      } else if (trait.categoryId === 'PREDICTABLE_TARGETER') {
        recommendations.push({
          tacticId: 'PROTECT_REPEATED_TARGET_COLOR',
          targetPropertyColor: trait.mostRepeatedColor || 'Unknown',
          reason: `Opponent repeatedly targets property color '${trait.mostRepeatedColor || 'Unknown'}' — prioritize defending or completing that set first.`
        });
      }
    }
  }

  return {
    opponentKey,
    profile,
    recommendations
  };
}

function resetOpponentProfile(opponentKey) {
  return opponentProfiles.delete(opponentKey);
}

module.exports = {
  OBSERVED_ACTION_TYPES,
  TENDENCY_CATEGORIES_CATALOG,
  getTendencyCategoriesCatalog,
  recordOpponentObservedAction,
  calculateOpponentBehaviorProfile,
  recommendCounterTacticsForProfile,
  resetOpponentProfile
};
