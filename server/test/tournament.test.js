const assert = require('assert');
const http = require('http');
const app = require('../app');
const { MonopolyBotEngine, STRATEGY_PROFILES } = require('../bot_engine');
const { runTournament, getStrategyLeaderboard, resetTournamentHistory } = require('../tournament_engine');

describe('Monopoly Deal v2.6 Bot Strategy Profiles & Tournament Engine', function() {
  this.timeout(10000);

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

  beforeEach(function() {
    resetTournamentHistory();
  });

  describe('Strategy Profiles in Bot Engine', function() {
    it('defines 4 strategy personas (BALANCED, AGGRESSIVE, DEFENSIVE, HOARDER)', function() {
      assert.strictEqual(Object.keys(STRATEGY_PROFILES).length, 4);
      assert.ok(STRATEGY_PROFILES.BALANCED);
      assert.ok(STRATEGY_PROFILES.AGGRESSIVE);
      assert.ok(STRATEGY_PROFILES.DEFENSIVE);
      assert.ok(STRATEGY_PROFILES.HOARDER);
    });

    it('defaults MonopolyBotEngine to BALANCED strategy', function() {
      const bot = new MonopolyBotEngine();
      assert.strictEqual(bot.strategyName, 'BALANCED');
    });

    it('instantiates MonopolyBotEngine with requested strategy profile', function() {
      const aggBot = new MonopolyBotEngine('AGGRESSIVE');
      assert.strictEqual(aggBot.strategyName, 'AGGRESSIVE');

      const hoarderBot = new MonopolyBotEngine('hoarder');
      assert.strictEqual(hoarderBot.strategyName, 'HOARDER');
    });
  });

  describe('Tournament Engine Unit Tests', function() {
    it('runs a tournament between AGGRESSIVE and DEFENSIVE strategies', function() {
      const res = runTournament({
        participants: ['AGGRESSIVE', 'DEFENSIVE'],
        roundsPerMatchup: 3,
        maxTurns: 250
      });

      assert.ok(res.tournamentId.startsWith('tourn-'));
      assert.strictEqual(res.roundsPlayed, 3);
      assert.strictEqual(res.matchesCount, 3);
      assert.strictEqual(res.standings.length, 2);

      res.standings.forEach(s => {
        assert.strictEqual(s.wins + s.losses + s.safetyHalted, 3);
      });
    });

    it('throws error for unknown strategy participant', function() {
      assert.throws(() => {
        runTournament({ participants: ['BALANCED', 'UNKNOWN_STRAT'] });
      }, /Unknown strategy participant/);
    });

    it('aggregates tournament leaderboard', function() {
      runTournament({ participants: ['BALANCED', 'HOARDER'], roundsPerMatchup: 2 });
      const stats = getStrategyLeaderboard();
      assert.strictEqual(stats.totalTournaments, 1);
      assert.strictEqual(stats.leaderboard.length, 4);
    });
  });

  describe('REST API Endpoints', function() {
    it('GET /api/monopoly/bot/personas returns all strategy profiles', async function() {
      const res = await fetch(`${baseUrl}/api/monopoly/bot/personas`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(data.count, 4);
      assert.ok(data.personas.BALANCED);
    });

    it('POST /api/monopoly/bot/tournament executes a tournament and returns standings', async function() {
      const res = await fetch(`${baseUrl}/api/monopoly/bot/tournament`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants: ['AGGRESSIVE', 'BALANCED'],
          roundsPerMatchup: 2
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.strictEqual(data.tournament.roundsPlayed, 2);
      assert.strictEqual(data.tournament.standings.length, 2);
    });

    it('POST /api/monopoly/bot/tournament returns 400 for invalid participants', async function() {
      const res = await fetch(`${baseUrl}/api/monopoly/bot/tournament`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants: ['NON_EXISTENT_STRAT']
        })
      });

      assert.strictEqual(res.status, 400);
    });
  });
});
