const assert = require("assert");
const http = require("http");
const app = require("../app");
const replay_strategy_tuner = require("../replay_strategy_tuner");
const replay_benchmark_evaluator = require("../replay_benchmark_evaluator");

describe("Monopoly Deal AI Bot Strategy Recommendation & Counter-Tactic Tuning Engine (v4.5)", function() {
  const dummyComparison = {
    seriesSummaries: [
      {
        seriesId: "underperforming-bot",
        seriesTitle: "Underperforming Bot Series",
        winRate: 0.2,
        avgEfficiencyRating: 55.0,
        avgAssetConversionRate: 0.4,
        assetConversionVariance: 0.15,
        avgBlunderCount: 2.0,
        tacticalSuperiorityIndex: 40.0,
        riskFlags: ["HIGH_VARIANCE_RISK"]
      },
      {
        seriesId: "benchmark-bot",
        seriesTitle: "Benchmark Bot Series",
        winRate: 0.8,
        avgEfficiencyRating: 85.0,
        avgAssetConversionRate: 0.75,
        assetConversionVariance: 0.02,
        avgBlunderCount: 0.2,
        tacticalSuperiorityIndex: 88.0,
        riskFlags: []
      }
    ],
    pairwiseComparisons: [
      {
        pair: ["underperforming-bot", "benchmark-bot"],
        WIN_MARGIN_DIFF: -0.6,
        EFFICIENCY_DELTA: -30.0,
        BLUNDER_RATE_GAP: 1.8,
        favoredSeriesId: "benchmark-bot"
      }
    ],
    overallRanking: ["benchmark-bot", "underperforming-bot"]
  };

  describe("Catalog & Helper Unit Tests", function() {
    it("should export catalog with 5 tuning rules", function() {
      const catalog = replay_strategy_tuner.getTuningRulesCatalog();
      assert.strictEqual(Array.isArray(catalog), true);
      assert.strictEqual(catalog.length, 5);
      const ruleIds = catalog.map(r => r.id);
      assert.deepStrictEqual(ruleIds, [
        "TRAILING_WIN_MARGIN",
        "EXCESS_BLUNDER_RATE",
        "LOW_ASSET_CONVERSION_EFFICIENCY",
        "HIGH_VARIANCE_INSTABILITY",
        "TACTICAL_SUPERIORITY_DEFICIT"
      ]);
    });
  });

  describe("evaluateReplayTuningCandidates()", function() {
    it("should throw on invalid comparison or missing targetSeriesId", function() {
      assert.throws(() => replay_strategy_tuner.evaluateReplayTuningCandidates(null, "s1"), /requires a comparison/);
      assert.throws(() => replay_strategy_tuner.evaluateReplayTuningCandidates(dummyComparison, ""), /valid targetSeriesId/);
      assert.throws(() => replay_strategy_tuner.evaluateReplayTuningCandidates(dummyComparison, "non-existent"), /No series summary found/);
    });

    it("should identify triggered candidates for an underperforming series", function() {
      const result = replay_strategy_tuner.evaluateReplayTuningCandidates(dummyComparison, "underperforming-bot");
      assert.strictEqual(result.targetSeriesId, "underperforming-bot");
      assert.strictEqual(result.candidates.length > 0, true);
      const triggeredIds = result.candidates.map(c => c.ruleId);
      assert.strictEqual(triggeredIds.includes("TRAILING_WIN_MARGIN"), true);
      assert.strictEqual(triggeredIds.includes("EXCESS_BLUNDER_RATE"), true);
      assert.strictEqual(triggeredIds.includes("LOW_ASSET_CONVERSION_EFFICIENCY"), true);
      assert.strictEqual(triggeredIds.includes("HIGH_VARIANCE_INSTABILITY"), true);
      assert.strictEqual(triggeredIds.includes("TACTICAL_SUPERIORITY_DEFICIT"), true);
    });

    it("should return 0 candidates for a well-performing benchmark series", function() {
      const result = replay_strategy_tuner.evaluateReplayTuningCandidates(dummyComparison, "benchmark-bot");
      assert.strictEqual(result.candidates.length, 0);
    });
  });

  describe("generateStrategyTuningRecommendations()", function() {
    it("should generate tuning recommendations with tuned profile deltas", function() {
      const rec = replay_strategy_tuner.generateStrategyTuningRecommendations(dummyComparison, "underperforming-bot");
      assert.strictEqual(rec.targetSeriesId, "underperforming-bot");
      assert.strictEqual(rec.status, "TUNING_RECOMMENDED");
      assert.strictEqual(rec.triggeredRuleIds.length > 0, true);
      assert.strictEqual(typeof rec.tunedProfile, "object");
      assert.strictEqual(typeof rec.narrative, "string");
    });

    it("should return NO_TUNING_NEEDED when no rules trigger", function() {
      const rec = replay_strategy_tuner.generateStrategyTuningRecommendations(dummyComparison, "benchmark-bot");
      assert.strictEqual(rec.status, "NO_TUNING_NEEDED");
      assert.strictEqual(rec.triggeredRuleIds.length, 0);
    });
  });

  describe("REST API Endpoints", function() {
    let server;
    let baseUrl;

    before(function(done) {
      server = http.createServer(app);
      server.listen(0, function() {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        done();
      });
    });

    after(function(done) {
      server.close(done);
    });

    it("GET /api/monopoly/bot/strategy-tuning-rules should return catalog", function(done) {
      http.get(`${baseUrl}/api/monopoly/bot/strategy-tuning-rules`, function(res) {
        assert.strictEqual(res.statusCode, 200);
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", function() {
          const body = JSON.parse(data);
          assert.strictEqual(body.status, "ok");
          assert.strictEqual(body.count, 5);
          done();
        });
      });
    });

    it("POST /api/monopoly/bot/recommend-strategy-tuning should return recommendations", function(done) {
      const payload = JSON.stringify({
        comparison: dummyComparison,
        targetSeriesId: "underperforming-bot"
      });
      const req = http.request(`${baseUrl}/api/monopoly/bot/recommend-strategy-tuning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
      }, function(res) {
        assert.strictEqual(res.statusCode, 200);
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", function() {
          const body = JSON.parse(data);
          assert.strictEqual(body.status, "ok");
          assert.strictEqual(body.recommendation.targetSeriesId, "underperforming-bot");
          done();
        });
      });
      req.write(payload);
      req.end();
    });

    it("POST /api/monopoly/bot/recommend-strategy-tuning should return 400 for missing targetSeriesId", function(done) {
      const payload = JSON.stringify({ comparison: dummyComparison });
      const req = http.request(`${baseUrl}/api/monopoly/bot/recommend-strategy-tuning`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
      }, function(res) {
        assert.strictEqual(res.statusCode, 400);
        done();
      });
      req.write(payload);
      req.end();
    });
  });
});
