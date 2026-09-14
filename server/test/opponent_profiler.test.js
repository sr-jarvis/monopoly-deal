'use strict';

const assert = require('assert');
const http = require('http');
const app = require('../app');
const opponent_profiler = require('../opponent_profiler');

describe('Monopoly Deal AI Bot Match Memory & Opponent Tendency Profiling Engine (v4.2)', function() {
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

  afterEach(function() {
    opponent_profiler.resetOpponentProfile('opp-1');
    opponent_profiler.resetOpponentProfile('opp-2');
    opponent_profiler.resetOpponentProfile('opp-test');
    opponent_profiler.resetOpponentProfile('opp-rest');
  });

  describe('Core Module Functions', function() {
    it('getTendencyCategoriesCatalog returns 5 categories', function() {
      const cat = opponent_profiler.getTendencyCategoriesCatalog();
      assert.strictEqual(Array.isArray(cat), true);
      assert.strictEqual(cat.length, 5);
      const ids = cat.map(c => c.id);
      assert.deepStrictEqual(ids, ['HOARDER', 'AGGRESSOR', 'RUSHER', 'DEFENSIVE_HOLDER', 'PREDICTABLE_TARGETER']);
    });

    it('rejects invalid opponentKey', function() {
      assert.throws(() => {
        opponent_profiler.recordOpponentObservedAction('', { actionType: 'BANK' });
      }, /opponentKey must be a non-empty string/);
    });

    it('rejects invalid actionType', function() {
      assert.throws(() => {
        opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'INVALID_TYPE' });
      }, /Unknown or missing actionType/);
    });

    it('PLAY_ACTION_CARD requires cardTitle', function() {
      assert.throws(() => {
        opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_ACTION_CARD' });
      }, /cardTitle is required/);
    });

    it('records observation and increments count', function() {
      const res1 = opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'BANK' });
      assert.strictEqual(res1.totalObservations, 1);
      const res2 = opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_PROPERTY' });
      assert.strictEqual(res2.totalObservations, 2);
    });

    it('unobserved opponentKey throws on profile calculation', function() {
      assert.throws(() => {
        opponent_profiler.calculateOpponentBehaviorProfile('opp-unknown');
      }, /No observations recorded for opponentKey/);
    });

    it('calculates HOARDER score accurately', function() {
      for (let i = 0; i < 6; i++) {
        opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'BANK' });
      }
      for (let i = 0; i < 2; i++) {
        opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_PROPERTY' });
      }

      const profile = opponent_profiler.calculateOpponentBehaviorProfile('opp-1');
      assert.strictEqual(profile.opponentKey, 'opp-1');
      assert.strictEqual(profile.totalObservations, 8);

      const hoarderTrait = profile.traits.find(t => t.categoryId === 'HOARDER');
      assert.strictEqual(hoarderTrait.score, 0.75);
      assert.strictEqual(hoarderTrait.strength, 'DOMINANT');
      assert.strictEqual(profile.dominantTrait, 'HOARDER');
    });

    it('calculates AGGRESSOR score accurately', function() {
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_ACTION_CARD', cardTitle: 'Deal Breaker' });
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_ACTION_CARD', cardTitle: 'Sly Deal' });
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'BANK' });
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_PROPERTY' });

      const profile = opponent_profiler.calculateOpponentBehaviorProfile('opp-1');
      const aggressorTrait = profile.traits.find(t => t.categoryId === 'AGGRESSOR');
      assert.strictEqual(aggressorTrait.score, 0.5);
      assert.strictEqual(aggressorTrait.strength, 'STRONG');
    });

    it('calculates RUSHER cadence with turnNumbers', function() {
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_PROPERTY', turnNumber: 1 });
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_PROPERTY', turnNumber: 2 });
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_PROPERTY', turnNumber: 3 });

      const profile = opponent_profiler.calculateOpponentBehaviorProfile('opp-1');
      const rusherTrait = profile.traits.find(t => t.categoryId === 'RUSHER');
      assert.strictEqual(rusherTrait.score, 1.0);
      assert.strictEqual(rusherTrait.dataQuality, 'SUFFICIENT');
    });

    it('calculates DEFENSIVE_HOLDER score and detects INSUFFICIENT quality', function() {
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'BANK' });
      const profileNoJsn = opponent_profiler.calculateOpponentBehaviorProfile('opp-1');
      const defTraitNoJsn = profileNoJsn.traits.find(t => t.categoryId === 'DEFENSIVE_HOLDER');
      assert.strictEqual(defTraitNoJsn.dataQuality, 'INSUFFICIENT');

      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'HELD_JUST_SAY_NO' });
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'HELD_JUST_SAY_NO' });
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_ACTION_CARD', cardTitle: 'Just Say No' });

      const profileWithJsn = opponent_profiler.calculateOpponentBehaviorProfile('opp-1');
      const defTraitWithJsn = profileWithJsn.traits.find(t => t.categoryId === 'DEFENSIVE_HOLDER');
      assert.strictEqual(defTraitWithJsn.score, 0.667);
      assert.strictEqual(defTraitWithJsn.dataQuality, 'SUFFICIENT');
    });

    it('calculates PREDICTABLE_TARGETER score', function() {
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_ACTION_CARD', cardTitle: 'Sly Deal', targetPlayerId: 'p2', targetPropertyColor: 'DarkBlue' });
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_ACTION_CARD', cardTitle: 'Deal Breaker', targetPlayerId: 'p2', targetPropertyColor: 'DarkBlue' });
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_ACTION_CARD', cardTitle: 'Forced Deal', targetPlayerId: 'p2', targetPropertyColor: 'Red' });

      const profile = opponent_profiler.calculateOpponentBehaviorProfile('opp-1');
      const targetTrait = profile.traits.find(t => t.categoryId === 'PREDICTABLE_TARGETER');
      assert.strictEqual(targetTrait.score, 0.667);
      assert.strictEqual(targetTrait.mostRepeatedColor, 'DarkBlue');
    });

    it('recommends counter tactics for DOMINANT/STRONG traits', function() {
      for (let i = 0; i < 8; i++) {
        opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'BANK' });
      }
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'PLAY_PROPERTY' });

      const recs = opponent_profiler.recommendCounterTacticsForProfile('opp-1');
      assert.strictEqual(recs.opponentKey, 'opp-1');
      assert.strictEqual(recs.recommendations.length >= 1, true);
      assert.strictEqual(recs.recommendations[0].tacticId, 'LEAN_AGGRESSIVE_STRATEGY');
    });

    it('resetOpponentProfile clears history', function() {
      opponent_profiler.recordOpponentObservedAction('opp-1', { actionType: 'BANK' });
      assert.strictEqual(opponent_profiler.resetOpponentProfile('opp-1'), true);
      assert.throws(() => {
        opponent_profiler.calculateOpponentBehaviorProfile('opp-1');
      }, /No observations recorded/);
    });
  });

  describe('REST Endpoints Integration', function() {
    it('GET /api/monopoly/bot/tendency-categories returns 200 and categories catalog', function(done) {
      http.get(`${baseUrl}/api/monopoly/bot/tendency-categories`, function(res) {
        assert.strictEqual(res.statusCode, 200);
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const body = JSON.parse(data);
          assert.strictEqual(body.status, 'ok');
          assert.strictEqual(body.count, 5);
          done();
        });
      });
    });

    it('POST /api/monopoly/bot/profile-opponent records action and returns profile', function(done) {
      const payload = JSON.stringify({
        opponentKey: 'opp-rest',
        observation: { actionType: 'BANK' }
      });

      const req = http.request(`${baseUrl}/api/monopoly/bot/profile-opponent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, function(res) {
        assert.strictEqual(res.statusCode, 200);
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const body = JSON.parse(data);
          assert.strictEqual(body.status, 'ok');
          assert.strictEqual(body.recorded.opponentKey, 'opp-rest');
          assert.strictEqual(body.profile.totalObservations, 1);
          done();
        });
      });

      req.write(payload);
      req.end();
    });

    it('POST /api/monopoly/bot/profile-opponent returns 404 for unobserved opponentKey', function(done) {
      const payload = JSON.stringify({
        opponentKey: 'opp-never-seen'
      });

      const req = http.request(`${baseUrl}/api/monopoly/bot/profile-opponent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, function(res) {
        assert.strictEqual(res.statusCode, 404);
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const body = JSON.parse(data);
          assert.strictEqual(body.status, 'error');
          assert.strictEqual(body.message.includes('No observations recorded'), true);
          done();
        });
      });

      req.write(payload);
      req.end();
    });
  });
});
