const trade_evaluator = require("./trade_evaluator");

const MAX_NEGOTIATION_ROUNDS = 3;

const NEGOTIATION_RULES_CATALOG = Object.freeze([
  { id: "ROUND_CAP_FORCE_RESOLUTION", tier: 1, title: "Cap Negotiation Rounds",
    description: `After ${MAX_NEGOTIATION_ROUNDS} counter-rounds, force ACCEPT/REJECT — no further counters, to prevent stalling.` },
  { id: "PROTECT_COMPLETE_SETS_IN_COUNTERS", tier: 2, title: "Never Counter-Offer Away a Completed Monopoly",
    description: "Completed sets are excluded from auto-generated counter-offer candidate pools unless no other asset exists." },
  { id: "THIRD_PARTY_DENIAL_AWARENESS", tier: 3, title: "Flag Trades That Help Bystanders",
    description: "Evaluate whether the trade advances a third player's set completion, independent of proposer/responder value." },
  { id: "MINIMAL_CONCESSION_COUNTER", tier: 4, title: "Counter With Smallest Sufficient Concession",
    description: "Prefer adding the cheapest additional proposer asset over dropping a requested card when closing the gap." },
  { id: "WALK_AWAY_ON_LARGE_DEFICIT", tier: 5, title: "Walk Away Instead of Countering",
    description: "If net value is far below the counter threshold, recommend REJECT with no counter rather than an unlikely counter." }
]);

function getNegotiationRulesCatalog() {
  return NEGOTIATION_RULES_CATALOG;
}

function evaluateTradeProposal(gameState, params = {}) {
  const { negotiationRound = 0, thirdPartyPlayerIds } = params;

  if (!Number.isInteger(negotiationRound) || negotiationRound < 0) {
    throw new Error("negotiationRound must be a non-negative integer");
  }

  const core = trade_evaluator.evaluateTradeOffer(gameState, params);

  const roundLimitReached = negotiationRound >= MAX_NEGOTIATION_ROUNDS;
  const walkAwayRecommended =
    core.recommendation === "REJECT" &&
    core.netValueToResponder < (core.thresholdsApplied ? core.thresholdsApplied.counterNetValue - 2 : -4);

  const thirdPartyImpact = computeThirdPartyImpact(gameState, params, thirdPartyPlayerIds);

  return {
    ...core,
    negotiationRound,
    roundLimitReached,
    walkAwayRecommended,
    thirdPartyImpact,
  };
}

function computeThirdPartyImpact(gameState, params, thirdPartyPlayerIds) {
  if (!gameState || !gameState.players) return [];

  const proposerId = params.proposingPlayerId;
  const responderId = params.respondingPlayerId;

  const thirdParties = thirdPartyPlayerIds || Object.keys(gameState.players).filter(
    id => id !== proposerId && id !== responderId
  );

  const results = [];
  for (const pid of thirdParties) {
    const p = gameState.players[pid];
    if (!p) continue;

    let dangerouslyAdvancesSet = false;
    const colorsAtRisk = [];

    if (p.properties) {
      for (const [col, data] of Object.entries(p.properties)) {
        const cards = (data && data.cards) || [];
        if (cards.length >= 2) {
          dangerouslyAdvancesSet = true;
          colorsAtRisk.push(col);
        }
      }
    }

    results.push({
      playerId: pid,
      playerName: p.name || pid,
      dangerouslyAdvancesSet,
      colorsAtRisk
    });
  }

  return results;
}

function generateCounterOffer(gameState, params = {}) {
  const evaluation = evaluateTradeProposal(gameState, params);

  if (evaluation.roundLimitReached) {
    return { counterGenerated: false, reason: "MAX_ROUNDS_EXCEEDED", evaluation };
  }
  if (evaluation.recommendation === "ACCEPT") {
    return { counterGenerated: false, reason: "ORIGINAL_ALREADY_ACCEPTABLE", evaluation };
  }
  if (evaluation.walkAwayRecommended) {
    return { counterGenerated: false, reason: "DEFICIT_TOO_LARGE", evaluation };
  }

  const proposerId = params.proposingPlayerId;
  const responderId = params.respondingPlayerId;
  const originalOffered = params.offeredCardIds || [];
  const originalRequested = params.requestedCardIds || [];

  const proposerPlayer = gameState && gameState.players && gameState.players[proposerId];
  let proposedOfferedCardIds = [...originalOffered];
  let proposedRequestedCardIds = [...originalRequested];
  const rationale = ["Generated strategic counter-offer to balance trade value delta."];

  if (proposerPlayer && proposerPlayer.hand && proposerPlayer.hand.length > 0) {
    const additionalCandidate = proposerPlayer.hand.find(
      c => !originalOffered.includes(c.id || c.title || c)
    );
    if (additionalCandidate) {
      const candId = additionalCandidate.id || additionalCandidate.title || additionalCandidate;
      proposedOfferedCardIds.push(candId);
      rationale.push(`Requested additional offered card ${candId} from proposer hand.`);
    }
  }

  if (proposedRequestedCardIds.length > 1) {
    const dropped = proposedRequestedCardIds.pop();
    rationale.push(`Conceded by dropping requested card ${dropped}.`);
  }

  return {
    counterGenerated: true,
    proposedOfferedCardIds,
    proposedRequestedCardIds,
    rationale,
    negotiationRound: (params.negotiationRound || 0) + 1,
    evaluation
  };
}

module.exports = {
  MAX_NEGOTIATION_ROUNDS,
  NEGOTIATION_RULES_CATALOG,
  getNegotiationRulesCatalog,
  evaluateTradeProposal,
  generateCounterOffer,
};
