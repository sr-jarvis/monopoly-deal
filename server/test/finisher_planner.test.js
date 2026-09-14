const assert = require("assert");
const game_manager = require("../game_manager");
const finisher_planner = require("../finisher_planner");

describe("Monopoly Deal AI Bot Endgame Win-Rate Calculator & Tactical Finisher Planner (v3.5)", function() {
  let gameState;

  beforeEach(function() {
    gameState = game_manager.createGameState([
      { id: "p1", name: "Player 1" },
      { id: "p2", name: "Player 2" }
    ]);
  });

  it("should return the 4 fixed finisher tactics in the catalog", function() {
    const catalog = finisher_planner.getFinisherTacticsCatalog();
    assert.strictEqual(catalog.length, 4);
    const ids = catalog.map(t => t.id);
    assert.ok(ids.includes("NATURAL_COMPLETION"));
    assert.ok(ids.includes("DEAL_BREAKER_STEAL"));
    assert.ok(ids.includes("SLY_DEAL_ASSIST"));
    assert.ok(ids.includes("FORCED_DEAL_SWAP"));
  });

  it("should calculate turn-to-win distance and win probabilities summing to 1", function() {
    // p1 has 2 complete sets
    gameState.players["p1"].properties = {
      DarkBlue: { cards: [{ id: "c1" }, { id: "c2" }] },
      Brown: { cards: [{ id: "c3" }, { id: "c4" }] }
    };

    const result = finisher_planner.calculateEndgameWinProbability(gameState, "p1");
    // console.log("Debug result:", JSON.stringify(result));
    assert.strictEqual(result.playerId, "p1");
    assert.ok(typeof result.turnsToWin === "number");
    assert.ok(result.winProbability && typeof result.winProbability === "object");
    assert.ok(Number(result.winProbability["p1"]) > 0);
    assert.ok(result.winProbability["p2"] > 0);

    const sumProb = result.winProbability["p1"] + result.winProbability["p2"];
    assert.ok(Math.abs(sumProb - 1.0) < 0.05);
  });

  it("should detect immediate win via NATURAL_COMPLETION when hand completes 3rd set", function() {
    gameState.players["p1"].properties = {
      DarkBlue: { cards: [{ id: "c1" }, { id: "c2" }] },
      Brown: { cards: [{ id: "c3" }, { id: "c4" }] },
      Green: { cards: [{ id: "g1" }, { id: "g2" }] }
    };
    gameState.players["p1"].hand = [
      { id: "g3", name: "Green Property", type: "PROPERTY", color: "Green" }
    ];

    const tactics = finisher_planner.evaluateFinisherTactics(gameState, "p1");
    assert.strictEqual(tactics.bestImmediateWin, "NATURAL_COMPLETION");
    assert.strictEqual(tactics.tactics.find(t => t.id === "NATURAL_COMPLETION").winsImmediately, true);

    const plan = finisher_planner.planFinisherSequence(gameState, "p1");
    assert.strictEqual(plan.winsThisTurn, true);
    assert.strictEqual(plan.recommendedSequence[0].tacticId, "NATURAL_COMPLETION");
  });

  it("should detect immediate win via DEAL_BREAKER_STEAL against complete opponent set", function() {
    gameState.players["p1"].properties = {
      DarkBlue: { cards: [{ id: "c1" }, { id: "c2" }] },
      Brown: { cards: [{ id: "c3" }, { id: "c4" }] }
    };
    gameState.players["p1"].hand = [
      { id: "action_deal_breaker", name: "Deal Breaker", type: "ACTION" }
    ];
    gameState.players["p2"].properties = {
      Green: { cards: [{ id: "g1" }, { id: "g2" }, { id: "g3" }] }
    };

    const tactics = finisher_planner.evaluateFinisherTactics(gameState, "p1");
    assert.strictEqual(tactics.bestImmediateWin, "DEAL_BREAKER_STEAL");

    const plan = finisher_planner.planFinisherSequence(gameState, "p1");
    assert.strictEqual(plan.winsThisTurn, true);
    assert.strictEqual(plan.recommendedSequence[0].tacticId, "DEAL_BREAKER_STEAL");
    assert.strictEqual(plan.recommendedSequence[0].targetPlayerId, "p2");
    assert.strictEqual(plan.recommendedSequence[0].targetPropertyColor, "Green");
  });

  it("should throw for invalid or unknown player ID", function() {
    assert.throws(() => {
      finisher_planner.calculateEndgameWinProbability(gameState, "nonexistent");
    }, /Invalid gameState or player ID not found/);
  });
});
