const assert = require("assert");
const http = require("http");
const app = require("../app");
const replay_benchmark_evaluator = require("../replay_benchmark_evaluator");

describe("Monopoly Deal AI Bot Match Replay Comparative Benchmarking & Cross-Bot Performance Evaluation (v4.4)", function() {
  it("should return the catalog of benchmark metric types", function() {
    const catalog = replay_benchmark_evaluator.getBenchmarkMetricTypesCatalog();
    assert.strictEqual(Array.isArray(catalog), true);
    assert.strictEqual(catalog.length, 5);
    const ids = catalog.map((m) => m.id);
    assert.deepStrictEqual(ids, [
      "WIN_MARGIN_DIFF",
      "BLUNDER_RATE_GAP",
      "EFFICIENCY_DELTA",
      "TACTICAL_SUPERIORITY_INDEX",
      "ASSET_CONVERSION_VARIANCE"
    ]);
  });

  it("should throw when summarizing empty or invalid replay series", function() {
    assert.throws(() => {
      replay_benchmark_evaluator.summarizeReplaySeries(null);
    }, /requires a series object/);

    assert.throws(() => {
      replay_benchmark_evaluator.summarizeReplaySeries({ seriesId: "s1", subjectPlayerId: "p1", matches: [] });
    }, /non-empty matches array/);
  });

  it("should correctly calculate win rates and risk flags for a replay series", function() {
    const series = {
      seriesId: "series-alpha",
      subjectPlayerId: "bot-1",
      matches: [
        { status: "FINISHED", winnerId: "bot-1", strategies: ["BALANCED", "AGGRESSIVE"] },
        { status: "FINISHED", winnerId: "bot-1", strategies: ["BALANCED", "AGGRESSIVE"] },
        { status: "FINISHED", winnerId: "bot-2", strategies: ["BALANCED", "AGGRESSIVE"] },
        { status: "SAFETY_HALTED", winnerId: null, strategies: ["BALANCED", "AGGRESSIVE"] }
      ]
    };

    const summary = replay_benchmark_evaluator.summarizeReplaySeries(series);
    assert.strictEqual(summary.seriesId, "series-alpha");
    assert.strictEqual(summary.matchesConsidered, 4);
    assert.strictEqual(summary.matchesFinished, 3);
    assert.strictEqual(summary.winRate, 0.667);
    assert.strictEqual(summary.riskFlags.includes("LOW_SAMPLE_SIZE_RISK"), true);
  });

  it("should throw when comparing less than 2 series or duplicate seriesIds", function() {
    assert.throws(() => {
      replay_benchmark_evaluator.compareReplaySeries([]);
    }, /requires at least 2 replay series/);

    assert.throws(() => {
      replay_benchmark_evaluator.compareReplaySeries([
        { seriesId: "s1", subjectPlayerId: "p1", matches: [{ status: "FINISHED", winnerId: "p1" }] },
        { seriesId: "s1", subjectPlayerId: "p2", matches: [{ status: "FINISHED", winnerId: "p2" }] }
      ]);
    }, /Duplicate seriesId/);
  });

  it("should compare two valid replay series and compute pairwise deltas and overall ranking", function() {
    const seriesA = {
      seriesId: "aggressive-bot",
      subjectPlayerId: "bot-agg",
      matches: Array(6).fill(null).map(() => ({
        status: "FINISHED",
        winnerId: "bot-agg",
        strategies: ["AGGRESSIVE", "DEFENSIVE"]
      }))
    };

    const seriesB = {
      seriesId: "defensive-bot",
      subjectPlayerId: "bot-def",
      matches: Array(6).fill(null).map((_, i) => ({
        status: "FINISHED",
        winnerId: i < 2 ? "bot-def" : "other",
        strategies: ["AGGRESSIVE", "DEFENSIVE"]
      }))
    };

    const comparison = replay_benchmark_evaluator.compareReplaySeries([seriesA, seriesB]);
    assert.strictEqual(comparison.seriesSummaries.length, 2);
    assert.strictEqual(comparison.pairwiseComparisons.length, 1);

    const pair = comparison.pairwiseComparisons[0];
    assert.strictEqual(pair.WIN_MARGIN_DIFF > 0, true);
    assert.strictEqual(pair.favoredSeriesId, "aggressive-bot");
    assert.strictEqual(comparison.overallRanking[0], "aggressive-bot");
  });

  describe("REST Endpoints", function() {
    let server;
    let baseUrl;

    before(function(done) {
      server = http.createServer(app);
      server.listen(0, function() {
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

    it("GET /api/monopoly/bot/benchmark-metric-types should return metric catalog", function(done) {
      http.get(`${baseUrl}/api/monopoly/bot/benchmark-metric-types`, function(res) {
        assert.strictEqual(res.statusCode, 200);
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          const body = JSON.parse(data);
          assert.strictEqual(body.status, "ok");
          assert.strictEqual(body.count, 5);
          done();
        });
      });
    });

    it("POST /api/monopoly/bot/compare-match-replays should compare series over HTTP", function(done) {
      const payload = JSON.stringify({
        seriesList: [
          {
            seriesId: "bot-series-1",
            subjectPlayerId: "p1",
            matches: Array(5).fill(null).map(() => ({ status: "FINISHED", winnerId: "p1" }))
          },
          {
            seriesId: "bot-series-2",
            subjectPlayerId: "p2",
            matches: Array(5).fill(null).map(() => ({ status: "FINISHED", winnerId: "p3" }))
          }
        ]
      });

      const req = http.request(
        `${baseUrl}/api/monopoly/bot/compare-match-replays`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload)
          }
        },
        function(res) {
          assert.strictEqual(res.statusCode, 200);
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            const body = JSON.parse(data);
            assert.strictEqual(body.status, "ok");
            assert.strictEqual(body.comparison.overallRanking[0], "bot-series-1");
            done();
          });
        }
      );
      req.write(payload);
      req.end();
    });
  });
});
