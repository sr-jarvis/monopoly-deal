const assert = require("assert");
const http = require("http");
const app = require("../app");
const rent_mitigation_optimizer = require("../rent_mitigation_optimizer");
const game_manager = require("../game_manager");

describe("Monopoly Deal AI Bot Rent Mitigation & Counter-Strategy Engine (v3.8)", function() {
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

  function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const options = {
        method,
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
        res.on("data", (chunk) => (responseData += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(responseData);
            resolve({ status: res.statusCode, body: parsed });
          } catch (e) {
            resolve({ status: res.statusCode, raw: responseData });
          }
        });
      });

      req.on("error", reject);
      if (body) req.write(dataString);
      req.end();
    });
  }

  function setupTestState() {
    return game_manager.createGameState([
      { id: 'p1', name: 'Player 1' },
      { id: 'p2', name: 'Player 2' }
    ]);
  }

  it("getRentMitigationCatalog returns 6 structured rule tiers", function() {
    const catalog = rent_mitigation_optimizer.getRentMitigationCatalog();
    assert.strictEqual(catalog.length, 6);
    assert.strictEqual(catalog[0].id, "JUST_SAY_NO_CANCEL");
    assert.strictEqual(catalog[0].tier, 0);
  });

  it("evaluateRentPaymentImpact evaluates cash-only settlement", function() {
    const state = setupTestState();
    state.players['p1'].bank = [{ id: 'm1', name: '1M', value: 1, type: 'money' }];
    const impact = rent_mitigation_optimizer.evaluateRentPaymentImpact(state, 'p1', { cardIds: ['m1'] });
    assert.strictEqual(impact.settlementValue, 1);
    assert.strictEqual(impact.strategyType, 'CASH');
    assert.strictEqual(impact.breaksCompleteSet, false);
  });

  it("selectOptimalRentSettlement liquidates bank cash notes for rent demand", function() {
    const state = setupTestState();
    state.players['p1'].bank = [
      { id: 'm1', name: '1M', value: 1, type: 'money' },
      { id: 'm2', name: '2M', value: 2, type: 'money' }
    ];
    const settlement = rent_mitigation_optimizer.selectOptimalRentSettlement(state, 'p1', 2);
    assert.strictEqual(settlement.paidValue, 2);
    assert.strictEqual(settlement.shortfall, 0);
    assert.strictEqual(settlement.impact.strategyType, 'CASH');
  });

  it("optimizeRentDefense recommends PLAY_JUST_SAY_NO when player holds Just Say No card", function() {
    const state = setupTestState();
    state.players['p1'].hand = [{ id: 'jsn1', name: 'JUST_SAY_NO', type: 'action', value: 4 }];
    state.players['p2'].properties = {
      DarkBlue: { cards: [{ id: 'db1', name: 'Boardwalk', value: 4, type: 'property' }] }
    };

    const defense = rent_mitigation_optimizer.optimizeRentDefense(state, 'p1', 'p2', 'DarkBlue');
    assert.strictEqual(defense.recommendation, 'PLAY_JUST_SAY_NO');
    assert.strictEqual(defense.rentAmount, 3);
    assert.strictEqual(defense.settlement.impact.strategyType, 'JUST_SAY_NO');
  });

  it("optimizeRentDefense calculates rent settlement when no Just Say No is held", function() {
    const state = setupTestState();
    state.players['p1'].hand = [];
    state.players['p1'].bank = [{ id: 'm5', name: '5M', value: 5, type: 'money' }];
    state.players['p2'].properties = {
      DarkBlue: { cards: [{ id: 'db1', name: 'Boardwalk', value: 4, type: 'property' }] }
    };

    const defense = rent_mitigation_optimizer.optimizeRentDefense(state, 'p1', 'p2', 'DarkBlue');
    assert.strictEqual(defense.recommendation, 'PAY_RENT_SETTLEMENT');
    assert.strictEqual(defense.rentAmount, 3);
    assert.strictEqual(defense.settlement.paidValue, 5);
  });

  it("REST GET /api/monopoly/bot/rent-mitigation-rules returns catalog", async function() {
    const res = await makeRequest("GET", "/api/monopoly/bot/rent-mitigation-rules");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(res.body.count, 6);
  });

  it("REST POST /api/monopoly/bot/optimize-rent-defense returns defense recommendation", async function() {
    const state = setupTestState();
    state.players['p1'].hand = [{ id: 'jsn1', name: 'JUST_SAY_NO', type: 'action', value: 4 }];
    state.players['p2'].properties = {
      DarkBlue: { cards: [{ id: 'db1', name: 'Boardwalk', value: 4, type: 'property' }] }
    };

    const res = await makeRequest("POST", "/api/monopoly/bot/optimize-rent-defense", {
      gameState: state,
      payerId: 'p1',
      ownerId: 'p2',
      propertyColor: 'DarkBlue'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(res.body.defense.recommendation, "PLAY_JUST_SAY_NO");
  });

  it("REST POST /api/monopoly/bot/optimize-rent-defense rejects missing parameters with HTTP 400", async function() {
    const res = await makeRequest("POST", "/api/monopoly/bot/optimize-rent-defense", {
      payerId: 'p1'
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.status, "error");
  });
});
