const assert = require("assert");
const http = require("http");
const app = require("../app");
const trade_negotiator = require("../trade_negotiator");
const game_manager = require("../game_manager");

describe("Monopoly Deal AI Bot Trade Counter-Offer & Negotiation Strategy Engine (v3.9)", function() {
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

  function makeRequest(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const options = {
        method: method,
        headers: {}
      };
      let dataString = "";
      if (body) {
        dataString = JSON.stringify(body);
        options.headers["Content-Type"] = "application/json";
        options.headers["Content-Length"] = Buffer.byteLength(dataString);
      }

      const req = http.request(url, options, (res) => {
        let responseData = "";
        res.on("data", (chunk) => {
          responseData += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(responseData);
            resolve({ statusCode: res.statusCode, body: parsed });
          } catch (e) {
            resolve({ statusCode: res.statusCode, body: responseData });
          }
        });
      });

      req.on("error", (err) => {
        reject(err);
      });

      if (body) {
        req.write(dataString);
      }
      req.end();
    });
  }

  it("should return the negotiation rules catalog", async function() {
    const res = await makeRequest("GET", "/api/monopoly/bot/negotiation-rules");
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(res.body.count, 5);
    assert.strictEqual(Array.isArray(res.body.rules), true);
    assert.strictEqual(res.body.rules[0].id, "ROUND_CAP_FORCE_RESOLUTION");
  });

  it("should evaluate a trade proposal and handle negotiation rounds", function() {
    const gameState = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    gameState.players["p1"].hand = [{ id: "c1", title: "Boardwalk", value: 4, type: "property", color: "DarkBlue" }];
    gameState.players["p2"].hand = [{ id: "c2", title: "Park Place", value: 4, type: "property", color: "DarkBlue" }];

    const evalRes = trade_negotiator.evaluateTradeProposal(gameState, {
      proposingPlayerId: "p1",
      respondingPlayerId: "p2",
      offeredCardIds: ["c1"],
      requestedCardIds: ["c2"],
      negotiationRound: 1
    });

    assert.strictEqual(evalRes.negotiationRound, 1);
    assert.strictEqual(evalRes.roundLimitReached, false);
    assert.strictEqual(Array.isArray(evalRes.thirdPartyImpact), true);
  });

  it("should generate counter-offer when evaluation recommends counter", function() {
    const gameState = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    gameState.players["p1"].hand = [
      { id: "c1", title: "Marvin Gardens", value: 3, type: "property", color: "Yellow" },
      { id: "c3", title: "Water Works", value: 2, type: "property", color: "Utility" }
    ];
    gameState.players["p2"].hand = [{ id: "c2", title: "Park Place", value: 4, type: "property", color: "DarkBlue" }];

    const counterRes = trade_negotiator.generateCounterOffer(gameState, {
      proposingPlayerId: "p1",
      respondingPlayerId: "p2",
      offeredCardIds: ["c1"],
      requestedCardIds: ["c2"],
      negotiationRound: 0,
      riskProfile: "CONSERVATIVE"
    });

    assert.strictEqual(counterRes.counterGenerated, true);
    assert.strictEqual(counterRes.negotiationRound, 1);
    assert.strictEqual(Array.isArray(counterRes.proposedOfferedCardIds), true);
  });

  it("should handle negotiation via HTTP POST endpoint", async function() {
    const gameState = game_manager.createGameState([{ id: "p1", name: "P1" }, { id: "p2", name: "P2" }]);
    gameState.players["p1"].hand = [{ id: "c1", title: "Boardwalk", value: 4, type: "property", color: "DarkBlue" }];
    gameState.players["p2"].hand = [{ id: "c2", title: "Park Place", value: 4, type: "property", color: "DarkBlue" }];

    const res = await makeRequest("POST", "/api/monopoly/bot/negotiate-trade", {
      gameState: gameState,
      proposingPlayerId: "p1",
      respondingPlayerId: "p2",
      offeredCardIds: ["c1"],
      requestedCardIds: ["c2"],
      negotiationRound: 0
    });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, "ok");
    assert.notStrictEqual(res.body.evaluation, null);
  });
});
