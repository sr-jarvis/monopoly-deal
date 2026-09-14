const assert = require("assert");
const http = require("http");
const app = require("../app");
const game_manager = require("../game_manager");
const rules_validator = require("../rules_validator");
const turn_planner = require("../turn_planner");

describe("Monopoly Deal AI Bot Turn Action Sequencer & Full Turn Planner (v4.1)", function () {
  let server;
  let baseUrl;

  before(function (done) {
    server = http.createServer(app);
    server.listen(0, function () {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after(function (done) {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  it("1. getTurnPlanningTacticsCatalog() returns all 4 defined tactics", function () {
    const catalog = turn_planner.getTurnPlanningTacticsCatalog();
    assert.strictEqual(Object.keys(catalog).length, 4);
    assert.ok(catalog.AGGRESSIVE_SET_COMPLETE);
    assert.ok(catalog.DEFENSIVE_CONSOLIDATION);
    assert.ok(catalog.BALANCED_MONEY_PLAY);
    assert.ok(catalog.DISCARD_PRUNING);
    assert.strictEqual(catalog.AGGRESSIVE_SET_COMPLETE.name, "AGGRESSIVE_SET_COMPLETE");
  });

  it("2. evaluateTurnContext() calculates situational snapshot", function () {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    const ctx = turn_planner.evaluateTurnContext(state, "p1");
    assert.strictEqual(ctx.playerId, "p1");
    assert.strictEqual(ctx.playsRemaining, 3);
    assert.strictEqual(ctx.winsThisTurn, false);
    assert.strictEqual(ctx.dealBreakerVulnerable, false);
  });

  it("3. planTurnActionSequence() selects BALANCED_MONEY_PLAY by default on neutral board", function () {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    const plan = turn_planner.planTurnActionSequence(state, "p1");
    assert.strictEqual(plan.playerId, "p1");
    assert.strictEqual(plan.tacticSelected, "BALANCED_MONEY_PLAY");
    assert.ok(Array.isArray(plan.steps));
  });

  it("4. planTurnActionSequence() respects forceTactic option", function () {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    const plan = turn_planner.planTurnActionSequence(state, "p1", { forceTactic: "DEFENSIVE_CONSOLIDATION" });
    assert.strictEqual(plan.tacticSelected, "DEFENSIVE_CONSOLIDATION");
  });

  it("5. planTurnActionSequence() throws error on invalid forceTactic", function () {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    assert.throws(() => {
      turn_planner.planTurnActionSequence(state, "p1", { forceTactic: "INVALID_TACTIC" });
    }, /Unknown turn planning tactic/);
  });

  it("6. planTurnActionSequence() non-mutation guarantee", function () {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    const originalJson = JSON.stringify(state);
    turn_planner.planTurnActionSequence(state, "p1");
    assert.strictEqual(JSON.stringify(state), originalJson);
  });

  it("7. planTurnActionSequence() throws on invalid player ID", function () {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    assert.throws(() => {
      turn_planner.planTurnActionSequence(state, "nonexistent");
    }, /Invalid gameState or player ID not found/);
  });

  it("8. GET /api/monopoly/bot/turn-planning-tactics REST endpoint", function (done) {
    http.get(`${baseUrl}/api/monopoly/bot/turn-planning-tactics`, function (res) {
      assert.strictEqual(res.statusCode, 200);
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", function () {
        const body = JSON.parse(data);
        assert.strictEqual(body.status, "ok");
        assert.strictEqual(body.count, 4);
        assert.ok(body.tactics.BALANCED_MONEY_PLAY);
        done();
      });
    });
  });

  it("9. POST /api/monopoly/bot/plan-turn REST endpoint with valid state", function (done) {
    const state = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    const postData = JSON.stringify({
      gameState: state,
      playerId: "p1"
    });

    const req = http.request(
      `${baseUrl}/api/monopoly/bot/plan-turn`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData)
        }
      },
      function (res) {
        assert.strictEqual(res.statusCode, 200);
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", function () {
          const body = JSON.parse(data);
          assert.strictEqual(body.status, "ok");
          assert.ok(body.plan);
          assert.strictEqual(body.plan.playerId, "p1");
          assert.ok(Array.isArray(body.plan.steps));
          done();
        });
      }
    );

    req.write(postData);
    req.end();
  });

  it("10. POST /api/monopoly/bot/plan-turn REST endpoint validation errors", function (done) {
    const postData = JSON.stringify({
      maxSteps: 50
    });

    const req = http.request(
      `${baseUrl}/api/monopoly/bot/plan-turn`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData)
        }
      },
      function (res) {
        assert.strictEqual(res.statusCode, 400);
        done();
      }
    );

    req.write(postData);
    req.end();
  });
});