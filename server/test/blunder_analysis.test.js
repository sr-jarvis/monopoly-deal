const assert = require("assert");
const http = require("http");
const { analyzeBotReplay, getBlunderDetectionRules } = require("../blunder_analyzer");
const app = require("../app");

describe("Monopoly Deal v2.8 Bot Replay Analysis & Blunder Detector", function () {
  let server;
  let baseUrl;

  before(function (done) {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", function () {
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

  describe("blunder_analyzer unit tests", function () {
    it("should return blunder rules catalog with 4 rules", function () {
      const rules = getBlunderDetectionRules();
      assert.strictEqual(rules.length, 4);
      assert.ok(rules.some((r) => r.id === "BANK_OVER_SET_ADVANCE"));
      assert.ok(rules.some((r) => r.id === "SUBOPTIMAL_TARGET_STEAL"));
      assert.ok(rules.some((r) => r.id === "WASTEFUL_DISCARD"));
      assert.ok(rules.some((r) => r.id === "IGNORED_PENDING_DEBT"));
    });

    it("should throw error when replayLog is not an array or empty", function () {
      assert.throws(() => analyzeBotReplay(null, "bot1"), /must be a non-empty array/);
      assert.throws(() => analyzeBotReplay([], "bot1"), /must be a non-empty array/);
      assert.throws(() => analyzeBotReplay([{}], null), /botPlayerId string is required/);
    });

    it("should detect BANK_OVER_SET_ADVANCE blunder when banking an advanceable property", function () {
      const replayLog = [
        {
          seq: 1,
          actorId: "bot1",
          actionType: "PLAY_CARD",
          payload: { targetZone: "bank" },
          card: { kind: "PROPERTY", color: "blue", title: "Boardwalk" },
          boardBefore: {
            bot1: { properties: { blue: { cards: [{ title: "Park Place" }] } } }
          }
        }
      ];

      const res = analyzeBotReplay(replayLog, "bot1");
      assert.strictEqual(res.blunderCount, 1);
      assert.strictEqual(res.moves[0].grade, "BLUNDER");
      assert.strictEqual(res.blunders[0].ruleId, "BANK_OVER_SET_ADVANCE");
      assert.strictEqual(res.overallQualityScore, 0);
    });

    it("should detect WASTEFUL_DISCARD blunder when discarding wildcard over money", function () {
      const replayLog = [
        {
          seq: 1,
          actorId: "bot1",
          actionType: "DISCARD",
          card: { kind: "WILDCARD", title: "Blue/Green Wildcard" },
          handBefore: [
            { kind: "WILDCARD", title: "Blue/Green Wildcard" },
            { kind: "MONEY", value: 1 }
          ]
        }
      ];

      const res = analyzeBotReplay(replayLog, "bot1");
      assert.strictEqual(res.blunderCount, 1);
      assert.strictEqual(res.blunders[0].ruleId, "WASTEFUL_DISCARD");
    });

    it("should evaluate clean replay log as excellent quality", function () {
      const replayLog = [
        {
          seq: 1,
          actorId: "bot1",
          actionType: "PLAY_CARD",
          payload: { targetZone: "properties" },
          card: { kind: "PROPERTY", color: "red", title: "Kentucky Avenue" }
        }
      ];

      const res = analyzeBotReplay(replayLog, "bot1");
      assert.strictEqual(res.blunderCount, 0);
      assert.strictEqual(res.excellentCount, 1);
      assert.strictEqual(res.overallQualityScore, 100);
    });
  });

  describe("REST API Endpoints", function () {
    it("GET /api/monopoly/bot/blunder-rules should return catalog", async function () {
      const res = await fetch(`${baseUrl}/api/monopoly/bot/blunder-rules`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, "ok");
      assert.strictEqual(data.count, 4);
      assert.strictEqual(data.rules.length, 4);
    });

    it("POST /api/monopoly/bot/analyze-replay should analyze valid replay", async function () {
      const payload = {
        botPlayerId: "bot1",
        replayLog: [
          {
            seq: 1,
            actorId: "bot1",
            actionType: "PLAY_CARD",
            payload: { targetZone: "properties" },
            card: { kind: "PROPERTY", color: "green", title: "North Carolina Avenue" }
          }
        ]
      };

      const res = await fetch(`${baseUrl}/api/monopoly/bot/analyze-replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, "ok");
      assert.strictEqual(data.analysis.overallQualityScore, 100);
      assert.strictEqual(data.analysis.moveCount, 1);
    });

    it("POST /api/monopoly/bot/analyze-replay should reject missing args", async function () {
      const res = await fetch(`${baseUrl}/api/monopoly/bot/analyze-replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.status, "error");
    });
  });
});
