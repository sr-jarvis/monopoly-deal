const assert = require("assert");
const http = require("http");
const app = require("../app");
const game_manager = require("../game_manager");
const discard_optimizer = require("../discard_optimizer");

function createCard(id, title, value, type, color) {
  return {
    id,
    title,
    value: value || 0,
    type: type || "PROPERTY",
    color: color || "DarkBlue"
  };
}

describe("Monopoly Deal AI Bot Hand Discard & Turn-End Optimization Engine (v3.6)", function() {
  let gameState;
  let server;
  let baseUrl;

  before(function(done) {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", function() {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after(function(done) {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  beforeEach(function() {
    gameState = game_manager.createGameState([
      { id: "p1", name: "Player 1" },
      { id: "p2", name: "Player 2" }
    ]);
  });

  describe("getDiscardRulesCatalog", function() {
    it("should return the catalog of 5 discard priority rules", function() {
      const catalog = discard_optimizer.getDiscardRulesCatalog();
      assert.strictEqual(Array.isArray(catalog), true);
      assert.strictEqual(catalog.length, 5);
      assert.strictEqual(catalog[0].id, "PREFER_LOW_VALUE_MONEY_DISCARD");
      assert.strictEqual(catalog[4].id, "PROTECT_JUST_SAY_NO");
    });
  });

  describe("evaluateDiscardCandidates & optimizeTurnEndDiscards", function() {
    it("should prioritize money cards before property cards", function() {
      gameState.players.p1.hand = [
        createCard("prop1", "DarkBlue 1", 3, "PROPERTY", "DarkBlue"),
        createCard("m1", "$1M", 1, "MONEY")
      ];

      const res = discard_optimizer.evaluateDiscardCandidates(gameState, "p1");
      assert.strictEqual(res.candidates.length, 2);
      assert.strictEqual(res.candidates[0].cardId, "m1");
      assert.strictEqual(res.candidates[0].kind, "money");
      assert.strictEqual(res.candidates[1].kind, "property");
    });

    it("should protect set-completing properties over money when choosing discards", function() {
      gameState.players.p1.hand = [
        createCard("p_db1", "Park Place", 4, "PROPERTY", "DarkBlue"),
        createCard("m_5", "$5M", 5, "MONEY")
      ];

      const res = discard_optimizer.evaluateDiscardCandidates(gameState, "p1");
      assert.strictEqual(res.candidates[0].kind, "money");
    });

    it("should protect Just Say No as last resort", function() {
      gameState.players.p1.hand = [
        createCard("jsn_1", "Just Say No", 4, "ACTION"),
        createCard("rent_1", "Rent", 1, "ACTION"),
        createCard("m2", "$2M", 2, "MONEY")
      ];

      const res = discard_optimizer.evaluateDiscardCandidates(gameState, "p1");
      const lastCandidate = res.candidates[res.candidates.length - 1];
      assert.strictEqual(lastCandidate.cardId, "jsn_1");
      assert.strictEqual(lastCandidate.tier, 5);
    });

    it("should return required=false when hand <= HAND_LIMIT (7)", function() {
      gameState.players.p1.hand = [
        createCard("m1", "$1M", 1, "MONEY"),
        createCard("m2", "$2M", 2, "MONEY")
      ];

      const plan = discard_optimizer.optimizeTurnEndDiscards(gameState, "p1");
      assert.strictEqual(plan.required, false);
      assert.strictEqual(plan.excessCount, 0);
      assert.strictEqual(plan.discardCardIds.length, 0);
    });

    it("should select exact excess count when hand > 7", function() {
      gameState.players.p1.hand = [
        createCard("m1", "$1M", 1, "MONEY"),
        createCard("m2", "$2M", 2, "MONEY"),
        createCard("m3", "$3M", 3, "MONEY"),
        createCard("m4", "$4M", 4, "MONEY"),
        createCard("m5", "$5M", 5, "MONEY"),
        createCard("act1", "Pass Go", 2, "ACTION"),
        createCard("act2", "Debt Collector", 3, "ACTION"),
        createCard("p1", "Boardwalk", 4, "PROPERTY", "DarkBlue"),
        createCard("p2", "Park Place", 4, "PROPERTY", "DarkBlue")
      ];

      const plan = discard_optimizer.optimizeTurnEndDiscards(gameState, "p1");
      assert.strictEqual(plan.required, true);
      assert.strictEqual(plan.excessCount, 2);
      assert.strictEqual(plan.discardCardIds.length, 2);
      assert.deepStrictEqual(plan.discardCardIds, ["m1", "m2"]);
      assert.strictEqual(plan.postDiscardHandSize, 7);
    });

    it("should throw error for invalid or unknown player ID", function() {
      assert.throws(() => {
        discard_optimizer.evaluateDiscardCandidates(gameState, "nonexistent");
      }, /Invalid gameState or player ID not found/);
    });
  });

  describe("REST API Endpoints", function() {
    it("GET /api/monopoly/bot/discard-rules should return rules catalog", function(done) {
      http.get(`${baseUrl}/api/monopoly/bot/discard-rules`, (res) => {
        assert.strictEqual(res.statusCode, 200);
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          const json = JSON.parse(body);
          assert.strictEqual(json.status, "ok");
          assert.strictEqual(json.count, 5);
          assert.strictEqual(Array.isArray(json.rules), true);
          done();
        });
      });
    });

    it("POST /api/monopoly/bot/optimize-discards should return optimal discard plan", function(done) {
      gameState.players.p1.hand = [
        createCard("m1", "$1M", 1, "MONEY"),
        createCard("m2", "$2M", 2, "MONEY"),
        createCard("m3", "$3M", 3, "MONEY"),
        createCard("m4", "$4M", 4, "MONEY"),
        createCard("m5", "$5M", 5, "MONEY"),
        createCard("act1", "Pass Go", 2, "ACTION"),
        createCard("act2", "Debt Collector", 3, "ACTION"),
        createCard("p1", "Boardwalk", 4, "PROPERTY", "DarkBlue")
      ];

      const postData = JSON.stringify({ gameState, playerId: "p1" });
      const req = http.request(`${baseUrl}/api/monopoly/bot/optimize-discards`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData)
        }
      }, (res) => {
        assert.strictEqual(res.statusCode, 200);
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          const json = JSON.parse(body);
          assert.strictEqual(json.status, "ok");
          assert.strictEqual(json.plan.required, true);
          assert.strictEqual(json.plan.excessCount, 1);
          assert.strictEqual(json.plan.discardCardIds[0], "m1");
          done();
        });
      });

      req.write(postData);
      req.end();
    });

    it("POST /api/monopoly/bot/optimize-discards should return 400 when missing parameters", function(done) {
      const postData = JSON.stringify({ playerId: "p1" });
      const req = http.request(`${baseUrl}/api/monopoly/bot/optimize-discards`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData)
        }
      }, (res) => {
        assert.strictEqual(res.statusCode, 400);
        done();
      });

      req.write(postData);
      req.end();
    });
  });
});
