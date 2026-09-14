const assert = require("assert");
const http = require("http");
const dealbreaker_defense = require("../dealbreaker_defense");
const game_manager = require("../game_manager");
const rules_validator = require("../rules_validator");
const hand_inference = require("../hand_inference");
const app = require("../app");

describe("Monopoly Deal AI Bot Deal-Breaker Threat Assessment & Defensive Counter-Play Strategy Engine (v4.0)", function() {
  let server;
  let baseUrl;

  before(function(done) {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after(function(done) {
    server.close(done);
  });

  it("should return threat mitigation tactics catalog", function() {
    const catalog = dealbreaker_defense.getThreatMitigationCatalog();
    assert.strictEqual(catalog.length, 4);
    assert.strictEqual(catalog[0].id, "RETAIN_JUST_SAY_NO");
    assert.strictEqual(catalog[1].id, "DEFER_SET_COMPLETION");
    assert.strictEqual(catalog[2].id, "ACCELERATE_WIN_RACE");
    assert.strictEqual(catalog[3].id, "PRIORITIZE_JSN_ACQUISITION");
  });

  it("should return zero exposure score when player has no complete sets", function() {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    const scores = dealbreaker_defense.calculateSetExposureRiskScores(state, "p1");
    assert.strictEqual(scores.playerId, "p1");
    assert.strictEqual(scores.setExposure.length, 0);
    assert.strictEqual(scores.overallExposureScore, 0);
    assert.strictEqual(scores.mostVulnerableSet, null);
  });

  it("should calculate set exposure risk score reflecting face value + rent", function() {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    const p1 = state.players["p1"];
    p1.properties = {
      DarkBlue: {
        cards: [
          { id: "db1", type: "property", color: "DarkBlue", name: "Boardwalk", value: 4 },
          { id: "db2", type: "property", color: "DarkBlue", name: "Park Place", value: 4 }
        ]
      }
    };

    const scores = dealbreaker_defense.calculateSetExposureRiskScores(state, "p1");
    assert.strictEqual(scores.setExposure.length, 1);
    const exp = scores.setExposure[0];
    assert.strictEqual(exp.color, "DarkBlue");
    assert.strictEqual(exp.setFaceValue, 8);

    const rentObj = rules_validator.calculateRentAmount(state, "p1", "DarkBlue");
    assert.strictEqual(exp.rentGenerationValue, rentObj.totalRent);
    assert.strictEqual(exp.impact, exp.setFaceValue + exp.rentGenerationValue);
  });

  it("should rank multiple complete sets by risk score descending", function() {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    const p1 = state.players["p1"];
    p1.properties = {
      DarkBlue: {
        cards: [
          { id: "db1", type: "property", color: "DarkBlue", name: "Boardwalk", value: 4 },
          { id: "db2", type: "property", color: "DarkBlue", name: "Park Place", value: 4 }
        ]
      },
      Brown: {
        cards: [
          { id: "br1", type: "property", color: "Brown", name: "Baltic", value: 1 },
          { id: "br2", type: "property", color: "Brown", name: "Mediterranean", value: 1 }
        ]
      }
    };

    const scores = dealbreaker_defense.calculateSetExposureRiskScores(state, "p1");
    assert.strictEqual(scores.setExposure.length, 2);
    assert.strictEqual(scores.setExposure[0].color, "DarkBlue");
    assert.strictEqual(scores.setExposure[1].color, "Brown");
    assert.strictEqual(scores.mostVulnerableSet, "DarkBlue");
    assert(scores.setExposure[0].exposureRiskScore >= scores.setExposure[1].exposureRiskScore);
  });

  it("should report vulnerable: false when zero complete sets exist even if opponent hand holds Deal Breaker", function() {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    const vulnerability = dealbreaker_defense.assessDealBreakerVulnerability(state, "p1");
    assert.strictEqual(vulnerability.vulnerable, false);
    assert.strictEqual(vulnerability.completeSetCount, 0);
  });

  it("should correctly detect hasJustSayNoInHand in player hand", function() {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    state.players["p1"].hand = [];
    let v1 = dealbreaker_defense.assessDealBreakerVulnerability(state, "p1");
    assert.strictEqual(v1.hasJustSayNoInHand, false);

    state.players["p1"].hand.push({ id: "jsn1", type: "action", title: "Just Say No", value: 4 });
    let v2 = dealbreaker_defense.assessDealBreakerVulnerability(state, "p1");
    assert.strictEqual(v2.hasJustSayNoInHand, true);
  });

  it("should cross-check opponent threat probability with hand_inference module", function() {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    const vul = dealbreaker_defense.assessDealBreakerVulnerability(state, "p1");
    assert.strictEqual(vul.perOpponentThreats.length, 1);

    const inf = hand_inference.inferOpponentHand(state, "p2", "p1");
    assert.strictEqual(vul.perOpponentThreats[0].probabilityHeld, inf.cardProbabilities["Deal Breaker"].probabilityHeld);
  });

  it("should recommend RETAIN_JUST_SAY_NO when vulnerable and Just Say No is held", function() {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    state.players["p1"].properties = {
      DarkBlue: {
        cards: [
          { id: "db1", type: "property", color: "DarkBlue", name: "Boardwalk", value: 4 },
          { id: "db2", type: "property", color: "DarkBlue", name: "Park Place", value: 4 }
        ]
      }
    };
    state.players["p1"].hand.push({ id: "jsn1", type: "action", title: "Just Say No", value: 4 });

    const rec = dealbreaker_defense.recommendDefensiveCounterPlay(state, "p1");
    assert.strictEqual(rec.vulnerable, true);
    assert(rec.recommendations.some(r => r.tacticId === "RETAIN_JUST_SAY_NO" && r.actionable && r.targetColor === "DarkBlue"));
  });

  it("should recommend ACCELERATE_WIN_RACE and PRIORITIZE_JSN_ACQUISITION when vulnerable and no Just Say No held", function() {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    state.players["p1"].hand = [];
    state.players["p1"].properties = {
      DarkBlue: {
        cards: [
          { id: "db1", type: "property", color: "DarkBlue", name: "Boardwalk", value: 4 },
          { id: "db2", type: "property", color: "DarkBlue", name: "Park Place", value: 4 }
        ]
      }
    };

    const rec = dealbreaker_defense.recommendDefensiveCounterPlay(state, "p1");
    assert.strictEqual(rec.vulnerable, true);
    assert(rec.recommendations.some(r => r.tacticId === "ACCELERATE_WIN_RACE"));
    assert(rec.recommendations.some(r => r.tacticId === "PRIORITIZE_JSN_ACQUISITION"));
    assert(!rec.recommendations.some(r => r.tacticId === "RETAIN_JUST_SAY_NO"));
  });

  it("should return no recommendations on untouched early-game board", function() {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    const rec = dealbreaker_defense.recommendDefensiveCounterPlay(state, "p1");
    assert.strictEqual(rec.vulnerable, false);
    assert.strictEqual(rec.recommendations.length, 0);
  });

  it("should throw a descriptive error when invalid playerId is provided", function() {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    assert.throws(() => {
      dealbreaker_defense.calculateSetExposureRiskScores(state, "unknown_p3");
    }, /Invalid gameState or player ID not found/);
  });

  it("should support REST GET /api/monopoly/bot/dealbreaker-mitigation-tactics", function(done) {
    http.get(`${baseUrl}/api/monopoly/bot/dealbreaker-mitigation-tactics`, res => {
      assert.strictEqual(res.statusCode, 200);
      let body = "";
      res.on("data", chunk => (body += chunk));
      res.on("end", () => {
        const json = JSON.parse(body);
        assert.strictEqual(json.status, "ok");
        assert.strictEqual(json.count, 4);
        assert.strictEqual(json.tactics.length, 4);
        done();
      });
    });
  });

  it("should support REST POST /api/monopoly/bot/assess-dealbreaker-threat", function(done) {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    state.players["p1"].properties = {
      DarkBlue: {
        cards: [
          { id: "db1", type: "property", color: "DarkBlue", name: "Boardwalk", value: 4 },
          { id: "db2", type: "property", color: "DarkBlue", name: "Park Place", value: 4 }
        ]
      }
    };

    const payload = JSON.stringify({ gameState: state, playerId: "p1" });
    const req = http.request(
      `${baseUrl}/api/monopoly/bot/assess-dealbreaker-threat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      res => {
        assert.strictEqual(res.statusCode, 200);
        let body = "";
        res.on("data", chunk => (body += chunk));
        res.on("end", () => {
          const json = JSON.parse(body);
          assert.strictEqual(json.status, "ok");
          assert.strictEqual(json.plan.vulnerable, true);
          assert(json.plan.recommendations.length > 0);
          done();
        });
      }
    );
    req.write(payload);
    req.end();
  });
});
