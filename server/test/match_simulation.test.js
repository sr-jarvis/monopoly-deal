const assert = require('assert');
const {
  simulateMatch,
  translateDecisionToAction,
  getSimulationStats,
  resetSimulationHistory
} = require('../match_simulator');
const { ACTION_TYPES } = require('../rules_validator');
const app = require('../app');

describe('Multi-Bot Autonomous Match Simulation & Analytics (v2.5)', function() {
  let server;
  let baseUrl;

  before(function(done) {
    server = app.listen(0, function() {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after(function(done) {
    if (server) server.close(done);
    else done();
  });

  beforeEach(function() {
    resetSimulationHistory();
  });

  describe('translateDecisionToAction', function() {
    it('translates end_turn decision correctly', function() {
      const act = translateDecisionToAction({ action: 'end_turn' }, 'p1');
      assert.strictEqual(act.type, ACTION_TYPES.END_TURN);
      assert.strictEqual(act.playerId, 'p1');
    });

    it('translates discard decision correctly', function() {
      const act = translateDecisionToAction({ action: 'discard', cardId: 'c101' }, 'p1');
      assert.strictEqual(act.type, ACTION_TYPES.DISCARD);
      assert.strictEqual(act.cardId, 'c101');
    });

    it('translates property play decision correctly', function() {
      const act = translateDecisionToAction({
        action: 'play',
        cardId: 'p12',
        targetZone: 'properties',
        propertyColor: 'red'
      }, 'p1');
      assert.strictEqual(act.type, ACTION_TYPES.PLAY_CARD);
      assert.strictEqual(act.targetZone, 'properties');
      assert.strictEqual(act.propertyColor, 'red');
    });

    it('translates action play decision to bank fallback', function() {
      const act = translateDecisionToAction({
        action: 'play',
        cardId: 'a05',
        targetZone: null,
        cardTitle: 'Pass Go'
      }, 'p1');
      assert.strictEqual(act.type, ACTION_TYPES.PLAY_CARD);
      assert.strictEqual(act.targetZone, 'bank');
    });
  });

  describe('simulateMatch', function() {
    it('runs 2-bot match to completion or safety halt', function() {
      const sim = simulateMatch({ botCount: 2 });
      assert.ok(sim.simulationId.startsWith('sim-'));
      assert.ok(['FINISHED', 'SAFETY_HALTED'].includes(sim.status));
      assert.ok(sim.turnsPlayed > 0);
      assert.ok(sim.telemetry);
      assert.strictEqual(typeof sim.durationMs, 'number');
    });

    it('respects maxTurns clamp and halts deterministically', function() {
      const sim = simulateMatch({ botCount: 2, maxTurns: 10 });
      assert.strictEqual(sim.status, 'SAFETY_HALTED');
      assert.strictEqual(sim.haltReason, 'MAX_TURNS_EXCEEDED');
      assert.strictEqual(sim.turnsPlayed, 10);
    });

    it('supports 3-5 bot matches', function() {
      const sim3 = simulateMatch({ botCount: 3 });
      assert.strictEqual(Object.keys(sim3.telemetry.perPlayer).length, 3);

      const sim5 = simulateMatch({ botCount: 5 });
      assert.strictEqual(Object.keys(sim5.telemetry.perPlayer).length, 5);
    });

    it('includes replayLog when requested', function() {
      const sim = simulateMatch({ botCount: 2, maxTurns: 15, includeReplayLog: true });
      assert.ok(Array.isArray(sim.replayLog));
      assert.ok(sim.replayLog.length > 0);
    });
  });

  describe('getSimulationStats', function() {
    it('computes accurate aggregate simulation statistics', function() {
      simulateMatch({ botCount: 2, maxTurns: 10 });
      simulateMatch({ botCount: 2, maxTurns: 10 });

      const stats = getSimulationStats();
      assert.strictEqual(stats.totalSimulations, 2);
      assert.strictEqual(stats.safetyHaltedCount, 2);
      assert.strictEqual(stats.haltReasonBreakdown.MAX_TURNS_EXCEEDED, 2);
    });
  });

  describe('REST API Endpoints', function() {
    it('POST /api/monopoly/bot/simulate-match runs match', async function() {
      const res = await fetch(`${baseUrl}/api/monopoly/bot/simulate-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botCount: 2, maxTurns: 15 })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.simulation);
      assert.strictEqual(Object.keys(data.simulation.telemetry.perPlayer).length, 2);
    });

    it('POST /api/monopoly/bot/simulate-match rejects invalid botCount', async function() {
      const res = await fetch(`${baseUrl}/api/monopoly/bot/simulate-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botCount: 10 })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
    });

    it('GET /api/monopoly/bot/simulations/stats returns stats', async function() {
      const res = await fetch(`${baseUrl}/api/monopoly/bot/simulations/stats`);
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'ok');
      assert.ok(data.stats);
      assert.strictEqual(typeof data.stats.totalSimulations, 'number');
    });
  });
});
