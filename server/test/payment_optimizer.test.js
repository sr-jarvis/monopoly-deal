const assert = require("assert");
const http = require("http");
const app = require("../app");
const payment_optimizer = require("../payment_optimizer");
const game_manager = require("../game_manager");

describe("Monopoly Deal AI Bot Payment Optimizer & Bank Liquidation Strategy Engine (v3.7)", function() {
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

  it("1. getPaymentRulesCatalog returns 5 liquidation tiers", function() {
    const rules = payment_optimizer.getPaymentRulesCatalog();
    assert.strictEqual(rules.length, 5);
    assert.strictEqual(rules[0].id, "LIQUIDATE_BANK_CASH_FIRST");
    assert.strictEqual(rules[4].id, "PROTECT_COMPLETE_SETS_LAST_RESORT");
  });

  it("2. Bank cash used before hand cash or properties", function() {
    const state = setupTestState();
    state.players.p1.bank = [
      { id: 'm1', name: 'MONEY_2', value: 2, type: 'money' }
    ];
    state.players.p1.hand = [
      { id: 'm2', name: 'MONEY_5', value: 5, type: 'money' }
    ];

    const plan = payment_optimizer.optimizeDebtPayment(state, 'p1', { amountOwed: 2 });
    assert.strictEqual(plan.required, true);
    assert.deepStrictEqual(plan.cardIds, ['m1']);
    assert.strictEqual(plan.settlementValue, 2);
    assert.strictEqual(plan.overpayment, 0);
  });

  it("3. Loose wildcard liquidated before invested property set", function() {
    const state = setupTestState();
    state.players.p1.bank = [];
    state.players.p1.hand = [];
    state.players.p1.properties = {
      DarkBlue: {
        color: 'DarkBlue',
        cards: [
          { id: 'db1', name: 'DARK_BLUE_1', value: 4, type: 'property' },
          { id: 'db2', name: 'DARK_BLUE_2', value: 4, type: 'property' }
        ]
      },
      Green: {
        color: 'Green',
        cards: [
          { id: 'wc1', name: 'WILD_GREEN_DARKBLUE', value: 4, type: 'wildcard' }
        ]
      }
    };

    const plan = payment_optimizer.optimizeDebtPayment(state, 'p1', { amountOwed: 4 });
    assert.strictEqual(plan.required, true);
    assert.deepStrictEqual(plan.propertyCardIds, ['wc1']);
  });

  it("4. Complete sets protected when cheaper assets cover debt", function() {
    const state = setupTestState();
    state.players.p1.bank = [
      { id: 'm1', name: 'MONEY_3', value: 3, type: 'money' }
    ];
    state.players.p1.properties = {
      DarkBlue: {
        color: 'DarkBlue',
        cards: [
          { id: 'db1', name: 'DARK_BLUE_1', value: 4, type: 'property' },
          { id: 'db2', name: 'DARK_BLUE_2', value: 4, type: 'property' }
        ]
      }
    };

    const plan = payment_optimizer.optimizeDebtPayment(state, 'p1', { amountOwed: 3 });
    assert.strictEqual(plan.required, true);
    assert.deepStrictEqual(plan.cardIds, ['m1']);
    assert.strictEqual(plan.setsBroken.length, 0);
  });

  it("5. Complete set broken as absolute last resort", function() {
    const state = setupTestState();
    state.players.p1.bank = [];
    state.players.p1.hand = [];
    state.players.p1.properties = {
      DarkBlue: {
        color: 'DarkBlue',
        cards: [
          { id: 'db1', name: 'DARK_BLUE_1', value: 4, type: 'property' },
          { id: 'db2', name: 'DARK_BLUE_2', value: 4, type: 'property' }
        ]
      }
    };

    const plan = payment_optimizer.optimizeDebtPayment(state, 'p1', { amountOwed: 4 });
    assert.strictEqual(plan.required, true);
    assert.strictEqual(plan.propertyCardIds.length, 1);
    assert.ok(plan.setsBroken.includes('DarkBlue'));
  });

  it("6. Minimal overpayment selected exact match subset", function() {
    const state = setupTestState();
    // createGameState deals a random opening hand; this case must isolate the bank subset.
    state.players.p1.hand = [];
    state.players.p1.bank = [
      { id: 'm1', name: 'MONEY_10', value: 10, type: 'money' },
      { id: 'm2', name: 'MONEY_2', value: 2, type: 'money' },
      { id: 'm3', name: 'MONEY_3', value: 3, type: 'money' }
    ];

    const plan = payment_optimizer.optimizeDebtPayment(state, 'p1', { amountOwed: 5 });
    assert.strictEqual(plan.settlementValue, 5);
    assert.strictEqual(plan.overpayment, 0);
    assert.deepStrictEqual(plan.cardIds.sort(), ['m2', 'm3']);
  });

  it("7. amountOwed <= 0 returns non-required empty plan", function() {
    const state = setupTestState();
    const plan = payment_optimizer.optimizeDebtPayment(state, 'p1', { amountOwed: 0 });
    assert.strictEqual(plan.required, false);
    assert.strictEqual(plan.cardIds.length, 0);
    assert.strictEqual(plan.propertyCardIds.length, 0);
  });

  it("8. REST GET /api/monopoly/bot/payment-rules returns rules catalog", async function() {
    const res = await makeRequest("GET", "/api/monopoly/bot/payment-rules");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(res.body.count, 5);
    assert.strictEqual(res.body.rules[0].id, "LIQUIDATE_BANK_CASH_FIRST");
  });

  it("9. REST POST /api/monopoly/bot/optimize-payment optimizes debt payment", async function() {
    const state = setupTestState();
    state.players.p1.bank = [
      { id: 'm1', name: 'MONEY_5', value: 5, type: 'money' }
    ];

    const res = await makeRequest("POST", "/api/monopoly/bot/optimize-payment", {
      gameState: state,
      playerId: "p1",
      amountOwed: 5
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(res.body.plan.settlementValue, 5);
    assert.deepStrictEqual(res.body.plan.cardIds, ['m1']);
  });

  it("10. REST POST /api/monopoly/bot/optimize-payment rejects missing parameters", async function() {
    const res1 = await makeRequest("POST", "/api/monopoly/bot/optimize-payment", { playerId: "p1" });
    assert.strictEqual(res1.status, 400);

    const res2 = await makeRequest("POST", "/api/monopoly/bot/optimize-payment", {
      gameState: setupTestState(),
      amountOwed: 5
    });
    assert.strictEqual(res2.status, 400);
  });
});
