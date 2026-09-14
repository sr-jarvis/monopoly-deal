const assert = require("assert");
const http = require("http");
const express = require("express");
const tournament_runner = require("../tournament_runner");
const app = require("../app");

describe("Monopoly Deal v4.6 Strategy Benchmarking & Tournament Match Runner", function() {
  this.timeout(10000);

  describe("Catalog & Helper Unit Tests", function() {
    it("should export TOURNAMENT_MODES_CATALOG with 2 modes", function() {
      const modes = tournament_runner.getTournamentModesCatalog();
      assert.strictEqual(Array.isArray(modes), true);
      assert.strictEqual(modes.length, 2);
      assert.deepStrictEqual(modes.map(m => m.id), ["ROUND_ROBIN_PAIRWISE", "FULL_TABLE_REPEATED"]);
    });

    it("should throw on unknown strategy or duplicates in simulateTournamentSeries", function() {
      assert.throws(() => {
        tournament_runner.simulateTournamentSeries({ strategies: ["UNKNOWN_STRAT", "BALANCED"] });
      }, /Unknown strategy participant/);

      assert.throws(() => {
        tournament_runner.simulateTournamentSeries({ strategies: ["BALANCED", "BALANCED"] });
      }, /duplicate entries/);

      assert.throws(() => {
        tournament_runner.simulateTournamentSeries({ mode: "INVALID_MODE" });
      }, /Unknown tournament mode/);
    });

    it("should run pairwise round-robin simulation correctly", function() {
      const res = tournament_runner.simulateTournamentSeries({
        strategies: ["BALANCED", "AGGRESSIVE", "DEFENSIVE"],
        mode: "ROUND_ROBIN_PAIRWISE",
        matchesPerPairing: 2,
        maxTurns: 40,
        includeReplayLog: false
      });

      assert.strictEqual(res.mode, "ROUND_ROBIN_PAIRWISE");
      assert.strictEqual(res.matchesCount, 6); // C(3,2)=3 pairs * 2 matches
      assert.strictEqual(res.matches.length, 6);
      assert.strictEqual(res.matches[0].replayLog, undefined);
    });

    it("should run full-table repeated simulation correctly", function() {
      const res = tournament_runner.simulateTournamentSeries({
        strategies: ["BALANCED", "AGGRESSIVE", "DEFENSIVE"],
        mode: "FULL_TABLE_REPEATED",
        matchesPerPairing: 3,
        maxTurns: 40
      });

      assert.strictEqual(res.mode, "FULL_TABLE_REPEATED");
      assert.strictEqual(res.matchesCount, 3);
      assert.strictEqual(res.matches[0].pairing.length, 3);
    });

    it("should evaluate tournament standings correctly from series result", function() {
      const mockSeries = {
        tournamentSeriesId: "tsrs-test-123",
        mode: "ROUND_ROBIN_PAIRWISE",
        strategies: ["BALANCED", "AGGRESSIVE"],
        matchesCount: 2,
        maxTurns: 100,
        matches: [
          {
            pairing: ["BALANCED", "AGGRESSIVE"],
            status: "FINISHED",
            winnerStrategy: "BALANCED",
            turnsPlayed: 20,
            strategyBlunderCounts: { BALANCED: 0, AGGRESSIVE: 1 }
          },
          {
            pairing: ["BALANCED", "AGGRESSIVE"],
            status: "FINISHED",
            winnerStrategy: "BALANCED",
            turnsPlayed: 30,
            strategyBlunderCounts: { BALANCED: 0, AGGRESSIVE: 0 }
          }
        ]
      };

      const standingsRes = tournament_runner.evaluateTournamentStandings(mockSeries);
      assert.strictEqual(standingsRes.tournamentSeriesId, "tsrs-test-123");
      assert.strictEqual(standingsRes.overallRanking[0], "BALANCED");
      assert.strictEqual(standingsRes.standings[0].strategy, "BALANCED");
      assert.strictEqual(standingsRes.standings[0].wins, 2);
      assert.strictEqual(standingsRes.standings[0].winRate, 1.0);
      assert.strictEqual(standingsRes.standings[1].strategy, "AGGRESSIVE");
      assert.strictEqual(standingsRes.standings[1].wins, 0);
      assert.strictEqual(standingsRes.headToHead.length, 1);
      assert.strictEqual(standingsRes.headToHead[0].favoredStrategy, "BALANCED");
    });
  });

  describe("REST Endpoints Integration", function() {
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

    it("GET /api/monopoly/bot/tournament-modes should return catalog", function(done) {
      http.get(`${baseUrl}/api/monopoly/bot/tournament-modes`, res => {
        assert.strictEqual(res.statusCode, 200);
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => {
          const json = JSON.parse(data);
          assert.strictEqual(json.status, "ok");
          assert.strictEqual(json.count, 2);
          assert.strictEqual(json.modes.length, 2);
          done();
        });
      });
    });

    it("POST /api/monopoly/bot/run-tournament-series should execute tournament and return standings", function(done) {
      const payload = JSON.stringify({
        strategies: ["BALANCED", "AGGRESSIVE"],
        matchesPerPairing: 2,
        maxTurns: 30
      });

      const req = http.request(`${baseUrl}/api/monopoly/bot/run-tournament-series`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      }, res => {
        assert.strictEqual(res.statusCode, 200);
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => {
          const json = JSON.parse(data);
          assert.strictEqual(json.status, "ok");
          assert.strictEqual(json.series.matchesCount, 2);
          assert.strictEqual(json.standings.standings.length, 2);
          assert.strictEqual(Array.isArray(json.standings.overallRanking), true);
          done();
        });
      });

      req.write(payload);
      req.end();
    });

    it("POST /api/monopoly/bot/run-tournament-series should return 400 for invalid strategies", function(done) {
      const payload = JSON.stringify({
        strategies: ["INVALID_STRAT", "BALANCED"]
      });

      const req = http.request(`${baseUrl}/api/monopoly/bot/run-tournament-series`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      }, res => {
        assert.strictEqual(res.statusCode, 400);
        let data = "";
        res.on("data", chunk => { data += chunk; });
        res.on("end", () => {
          const json = JSON.parse(data);
          assert.strictEqual(json.status, "error");
          assert.strictEqual(json.message.includes("Unknown strategy participant"), true);
          done();
        });
      });

      req.write(payload);
      req.end();
    });
  });
});
