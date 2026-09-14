const assert = require("assert");
const game_manager = require("../game_manager");
const trade_evaluator = require("../trade_evaluator");

describe("Monopoly Deal Trade Evaluator & Value Matrix API (v3.0)", function () {
  describe("trade_evaluator unit tests", function () {
    it("calculateCardValueMatrix should return base catalog values when no gameState provided", function () {
      const matrix = trade_evaluator.calculateCardValueMatrix(null, null);
      assert.ok(matrix["Pass Go"]);
      assert.strictEqual(matrix["Pass Go"].baseValue, 1);
      assert.strictEqual(matrix["Pass Go"].setCompletionBoost, 0);
      assert.strictEqual(matrix["Pass Go"].monopolyDenialValue, 0);
      assert.strictEqual(matrix["Pass Go"].strategicValue, 1);
    });

    it("calculateCardValueMatrix should calculate set completion boost and denial value", function () {
      const gameState = game_manager.createGameState([
        { id: "p1", name: "Player 1" },
        { id: "p2", name: "Player 2" },
      ]);
      gameState.players["p1"].properties = {
        DarkBlue: { cards: [{ id: "prop_boardwalk", name: "Boardwalk", value: 4, type: "property", color: "DarkBlue" }] },
      };

      const matrix1 = trade_evaluator.calculateCardValueMatrix(gameState, "p1");
      // DarkBlue set size is 2. p1 owns 1 card, so adding Park Place completes set (3x boost)
      assert.ok(matrix1["Park Place"].setCompletionBoost > 0);

      const matrix2 = trade_evaluator.calculateCardValueMatrix(gameState, "p2");
      // From p2's perspective, p1 is one card away from completing DarkBlue, so denial value is high
      assert.ok(matrix2["Park Place"].monopolyDenialValue > 0);
    });

    it("getTradeAcceptanceThresholds should return threshold values based on risk profile", function () {
      const moderate = trade_evaluator.getTradeAcceptanceThresholds({ riskProfile: "MODERATE" });
      assert.strictEqual(moderate.acceptNetValue, 0);
      assert.strictEqual(moderate.counterNetValue, -2);

      const highRisk = trade_evaluator.getTradeAcceptanceThresholds({ riskProfile: "HIGH_RISK" });
      assert.strictEqual(highRisk.acceptNetValue, -1);

      assert.throws(() => {
        trade_evaluator.getTradeAcceptanceThresholds({ riskProfile: "INVALID_PROFILE" });
      }, /Unknown risk profile/);
    });

    it("evaluateTradeOffer should evaluate trade offer correctly", function () {
      const gameState = game_manager.createGameState([
        { id: "p1", name: "Player 1" },
        { id: "p2", name: "Player 2" },
      ]);
      gameState.players["p1"].hand = [{ id: "prop_boardwalk", name: "Boardwalk", value: 4, type: "property", color: "DarkBlue" }];
      gameState.players["p2"].hand = [{ id: "prop_park_place", name: "Park Place", value: 4, type: "property", color: "DarkBlue" }];

      const evalRes = trade_evaluator.evaluateTradeOffer(gameState, {
        proposingPlayerId: "p1",
        respondingPlayerId: "p2",
        offeredCardIds: ["prop_boardwalk"],
        requestedCardIds: ["prop_park_place"],
        riskProfile: "MODERATE",
      });

      assert.strictEqual(evalRes.proposingPlayerId, "p1");
      assert.strictEqual(evalRes.respondingPlayerId, "p2");
      assert.ok(evalRes.recommendation);
      assert.ok(Array.isArray(evalRes.offeredBreakdown));
      assert.ok(Array.isArray(evalRes.requestedBreakdown));
    });

    it("evaluateTradeOffer should throw error for invalid or missing arguments", function () {
      assert.throws(() => {
        trade_evaluator.evaluateTradeOffer(null, {});
      }, /Must provide both/);

      const gameState = game_manager.createGameState([
        { id: "p1", name: "Player 1" },
        { id: "p2", name: "Player 2" },
      ]);
      assert.throws(() => {
        trade_evaluator.evaluateTradeOffer(gameState, {
          proposingPlayerId: "p1",
          respondingPlayerId: "p2",
          offeredCardIds: ["nonexistent_card"],
          requestedCardIds: ["prop_boardwalk"],
        });
      }, /not found/);
    });
  });
});
