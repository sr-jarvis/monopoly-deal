const assert = require("assert");
const game_manager = require("../game_manager");
const hand_inference = require("../hand_inference");

describe("Monopoly Deal Opponent Hand Inference & Counter-Play Engine (v3.4)", function() {

  describe("hand_inference module unit tests", function() {
    it("probabilityHoldsAtLeastOne calculates exact hypergeometric probability", function() {
      // 10 unseen total, 2 matching copies, draw 5 cards
      // P(none) = (8/10) * (7/9) * (6/8) * (5/7) * (4/6) = 6720 / 30240 = 0.2222
      // P(at least 1) = 1 - 0.2222 = 0.7778
      const prob = hand_inference.probabilityHoldsAtLeastOne(10, 2, 5);
      assert.strictEqual(prob, 0.7778);
    });

    it("getCounterTacticsCatalog returns non-empty catalog of 5 tactics", function() {
      const catalog = hand_inference.getCounterTacticsCatalog();
      assert.strictEqual(catalog.length, 5);
      assert.ok(catalog.some(t => t.threatType === "DEAL_BREAKER_RISK"));
    });

    it("inferOpponentHand throws error when player does not exist", function() {
      const gs = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
      assert.throws(() => {
        hand_inference.inferOpponentHand(gs, "nonexistent");
      }, /Invalid or missing opponent player/);
    });

    it("inferOpponentHand respects information boundary and derives threat scores", function() {
      const gs = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
      // Give p2 5 cards
      gs.players["p2"].hand = [
        { id: "c1", title: "Pass Go", type: "action" },
        { id: "c2", title: "Rent", type: "rent" },
        { id: "c3", title: "Money 1M", type: "money" },
        { id: "c4", title: "Property Red", type: "property" },
        { id: "c5", title: "Wildcard", type: "wildcard" }
      ];

      const res1 = hand_inference.inferOpponentHand(gs, "p2", "p1");
      assert.strictEqual(res1.opponentPlayerId, "p2");
      assert.strictEqual(res1.handSize, 5);
      assert.ok(res1.unseenPoolSize > 0);
      assert.ok(res1.cardProbabilities["Deal Breaker"]);

      // Hidden-information boundary proof: replace p2's hand cards with different cards, keeping hand.length = 5
      gs.players["p2"].hand = [
        { id: "c6", title: "Deal Breaker", type: "action" },
        { id: "c7", title: "Deal Breaker", type: "action" },
        { id: "c8", title: "Just Say No", type: "action" },
        { id: "c9", title: "Just Say No", type: "action" },
        { id: "c10", title: "Just Say No", type: "action" }
      ];

      const res2 = hand_inference.inferOpponentHand(gs, "p2", "p1");
      // Output MUST be byte-identical because the estimator only reads hand.length
      assert.deepStrictEqual(res1.cardProbabilities, res2.cardProbabilities);
      assert.deepStrictEqual(res1.inferredThreats, res2.inferredThreats);
    });

    it("evaluateDefensiveMove recommends actionable counters when player holds response cards", function() {
      const hand = [
        { id: "jsn1", title: "Just Say No", type: "action" },
        { id: "m1", title: "Money 5M", type: "money" }
      ];
      const threats = [
        { threatType: "DEAL_BREAKER_RISK", severity: "CRITICAL" },
        { threatType: "RENT_ATTACK_RISK", severity: "HIGH" }
      ];

      const evalRes = hand_inference.evaluateDefensiveMove(hand, threats);
      assert.strictEqual(evalRes.recommendedCounters.length, 2);
      assert.strictEqual(evalRes.recommendedCounters[0].threatType, "DEAL_BREAKER_RISK");
      assert.strictEqual(evalRes.recommendedCounters[0].counterTactic, "RETAIN_JUST_SAY_NO");
      assert.strictEqual(evalRes.recommendedCounters[0].actionable, true);
    });
  });

  describe("API Endpoint Handlers", function() {
    it("getCounterTacticsCatalog integration via catalog query", function() {
      const tactics = hand_inference.getCounterTacticsCatalog();
      assert.ok(Array.isArray(tactics));
      assert.strictEqual(tactics.length, 5);
    });

    it("inferOpponentHand integration with full gameState", function() {
      const gs = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
      const res = hand_inference.inferOpponentHand(gs, "p2", "p1");
      assert.strictEqual(res.opponentPlayerId, "p2");
      assert.ok(res.estimatedComposition);
      assert.ok(res.inferredThreats);
    });
  });
});
