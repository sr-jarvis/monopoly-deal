const assert = require("assert");
const http = require("http");
const app = require("../app");
const tournament_meta_adaptor = require("../tournament_meta_adaptor");
const tournament_runner = require("../tournament_runner");

describe("Tournament Meta-Strategy Adaptation Engine", function() {
  this.timeout(10000);

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
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  it("should return meta-strategy rules catalog with 5 rules", function() {
    const catalog = tournament_meta_adaptor.getMetaStrategyRulesCatalog();
    assert.strictEqual(catalog.length, 5);
    const ids = catalog.map(r => r.id);
    assert.deepStrictEqual(ids, [
      "COUNTER_DOMINANT_AGGRESSOR",
      "EXPLOIT_PASSIVE_HOARDER",
      "NEUTRALIZE_RUSHER",
      "STABILIZE_HIGH_VARIANCE",
      "PRESERVE_BALANCED_BASELINE"
    ]);
  });

  it("should evaluate tournament meta divergence and classify archetypes", function() {
    const standings = {
      tournamentSeriesId: "test-series-1",
      standings: [
        {
          strategy: "AGGRESSIVE",
          winRate: 0.8,
          avgTurnsToWin: 18,
          avgBlundersPerMatch: 0.1,
          tacticalDominanceScore: 85,
          riskFlags: []
        },
        {
          strategy: "HOARDER",
          winRate: 0.2,
          avgTurnsToWin: 30,
          avgBlundersPerMatch: 1.5,
          tacticalDominanceScore: 30,
          riskFlags: []
        },
        {
          strategy: "BALANCED",
          winRate: 0.5,
          avgTurnsToWin: 12,
          avgBlundersPerMatch: 0.3,
          tacticalDominanceScore: 50,
          riskFlags: []
        }
      ],
      headToHead: []
    };

    const replaySummaries = [
      {
        seriesId: "HOARDER",
        avgAssetConversionRate: 0.3,
        assetConversionVariance: 0.05,
        avgEfficiencyRating: 0.4,
        riskFlags: []
      }
    ];

    const meta = tournament_meta_adaptor.evaluateTournamentMetaDivergence(standings, replaySummaries);
    assert.strictEqual(meta.tournamentSeriesId, "test-series-1");
    assert.strictEqual(meta.strategyArchetypes.length, 3);

    const agg = meta.strategyArchetypes.find(a => a.strategy === "AGGRESSIVE");
    assert.strictEqual(agg.archetype, "DOMINANT_AGGRESSOR");

    const hoarder = meta.strategyArchetypes.find(a => a.strategy === "HOARDER");
    assert.strictEqual(hoarder.archetype, "PASSIVE_HOARDER");

    const bal = meta.strategyArchetypes.find(a => a.strategy === "BALANCED");
    assert.strictEqual(bal.archetype, "RUSHER");
  });

  it("should adapt tournament meta-strategy for DOMINANT_AGGRESSOR opponent", function() {
    const standings = {
      tournamentSeriesId: "series-dom",
      standings: [
        {
          strategy: "AGGRESSIVE",
          winRate: 0.75,
          avgTurnsToWin: 20,
          avgBlundersPerMatch: 0.2,
          tacticalDominanceScore: 80,
          riskFlags: []
        },
        {
          strategy: "BALANCED",
          winRate: 0.25,
          avgTurnsToWin: 25,
          avgBlundersPerMatch: 0.6,
          tacticalDominanceScore: 40,
          riskFlags: []
        }
      ],
      headToHead: []
    };

    const meta = tournament_meta_adaptor.evaluateTournamentMetaDivergence(standings, []);
    const result = tournament_meta_adaptor.adaptTournamentMetaStrategy("BALANCED", meta);

    assert.strictEqual(result.status, "META_ADAPTATION_APPLIED");
    assert.deepStrictEqual(result.triggeredRuleIds, ["COUNTER_DOMINANT_AGGRESSOR"]);
    assert.ok(result.recommendedAdjustments.actionCardWeight);
    assert.strictEqual(result.recommendedAdjustments.actionCardWeight.direction, "decrease");
    assert.ok(result.recommendedAdjustments.moneyBufferTarget);
    assert.strictEqual(result.recommendedAdjustments.moneyBufferTarget.direction, "increase");
  });

  it("should preserve baseline when no archetype divergence exists", function() {
    const standings = {
      tournamentSeriesId: "series-bal",
      standings: [
        {
          strategy: "BALANCED",
          winRate: 0.5,
          avgTurnsToWin: 20,
          avgBlundersPerMatch: 0.6,
          tacticalDominanceScore: 50,
          riskFlags: []
        },
        {
          strategy: "DEFENSIVE",
          winRate: 0.5,
          avgTurnsToWin: 22,
          avgBlundersPerMatch: 0.6,
          tacticalDominanceScore: 50,
          riskFlags: []
        }
      ],
      headToHead: []
    };

    const meta = tournament_meta_adaptor.evaluateTournamentMetaDivergence(standings, []);
    const result = tournament_meta_adaptor.adaptTournamentMetaStrategy("BALANCED", meta);

    assert.strictEqual(result.status, "BASELINE_PRESERVED");
    assert.deepStrictEqual(result.triggeredRuleIds, ["PRESERVE_BALANCED_BASELINE"]);
  });

  it("should expose REST endpoint GET /api/monopoly/bot/meta-strategy-rules", function(done) {
    http.get(`${baseUrl}/api/monopoly/bot/meta-strategy-rules`, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        assert.strictEqual(res.statusCode, 200);
        const data = JSON.parse(body);
        assert.strictEqual(data.status, "ok");
        assert.strictEqual(data.count, 5);
        assert.ok(Array.isArray(data.rules));
        done();
      });
    }).on("error", done);
  });

  it("should expose REST endpoint POST /api/monopoly/bot/adapt-tournament-strategy", function(done) {
    const payload = JSON.stringify({
      currentStrategy: "BALANCED",
      standings: {
        tournamentSeriesId: "rest-test",
        standings: [
          {
            strategy: "AGGRESSIVE",
            winRate: 0.8,
            avgTurnsToWin: 18,
            avgBlundersPerMatch: 0.1,
            tacticalDominanceScore: 88,
            riskFlags: []
          },
          {
            strategy: "BALANCED",
            winRate: 0.2,
            avgTurnsToWin: 25,
            avgBlundersPerMatch: 0.5,
            tacticalDominanceScore: 35,
            riskFlags: []
          }
        ]
      }
    });

    const req = http.request(`${baseUrl}/api/monopoly/bot/adapt-tournament-strategy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        assert.strictEqual(res.statusCode, 200);
        const data = JSON.parse(body);
        assert.strictEqual(data.status, "ok");
        assert.ok(data.tournamentMeta);
        assert.ok(data.adaptation);
        assert.strictEqual(data.adaptation.status, "META_ADAPTATION_APPLIED");
        done();
      });
    });

    req.on("error", done);
    req.write(payload);
    req.end();
  });
});
