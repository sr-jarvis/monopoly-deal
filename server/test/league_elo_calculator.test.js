const assert = require('assert');
const http = require('http');
const league_elo_calculator = require('../league_elo_calculator');
const app = require('../app');

describe('Monopoly Deal Tournament League Elo Calculator (v4.8)', function() {
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

  describe('Elo Rating Tiers Catalog', function() {
    it('returns 5 tiers in correct minRating order', function() {
      const catalog = league_elo_calculator.getEloRatingTiersCatalog();
      assert.strictEqual(catalog.length, 5);
      assert.strictEqual(catalog[0].id, 'NOVICE');
      assert.strictEqual(catalog[1].id, 'CLUB');
      assert.strictEqual(catalog[2].id, 'COMPETENT');
      assert.strictEqual(catalog[3].id, 'EXPERT');
      assert.strictEqual(catalog[4].id, 'MASTER');
    });

    it('maps ratings to correct tier IDs', function() {
      assert.strictEqual(league_elo_calculator.getTierForRating(500).id, 'NOVICE');
      assert.strictEqual(league_elo_calculator.getTierForRating(1200).id, 'CLUB');
      assert.strictEqual(league_elo_calculator.getTierForRating(1400).id, 'COMPETENT');
      assert.strictEqual(league_elo_calculator.getTierForRating(1600).id, 'EXPERT');
      assert.strictEqual(league_elo_calculator.getTierForRating(1800).id, 'MASTER');
    });
  });

  describe('Multiplayer Elo Delta Calculations', function() {
    it('throws error for fewer than 2 participants', function() {
      assert.throws(() => {
        league_elo_calculator.calculateMultiplayerEloDeltas([{ id: 'p1' }]);
      }, /requires at least 2 participants/);
    });

    it('throws error for duplicate participant IDs', function() {
      assert.throws(() => {
        league_elo_calculator.calculateMultiplayerEloDeltas([{ id: 'p1' }, { id: 'p1' }]);
      }, /unique id values/);
    });

    it('throws error for unknown winnerId', function() {
      assert.throws(() => {
        league_elo_calculator.calculateMultiplayerEloDeltas(
          [{ id: 'p1' }, { id: 'p2' }],
          { winnerId: 'p3' }
        );
      }, /winnerId does not match any participant/);
    });

    it('computes textbook 2-player equal-rating deltas (+16 / -16)', function() {
      const res = league_elo_calculator.calculateMultiplayerEloDeltas(
        [{ id: 'p1', rating: 1200 }, { id: 'p2', rating: 1200 }],
        { winnerId: 'p1' },
        { kFactor: 32 }
      );
      assert.strictEqual(res.participants.length, 2);
      const p1 = res.participants.find(p => p.id === 'p1');
      const p2 = res.participants.find(p => p.id === 'p2');
      assert.strictEqual(p1.delta, 16);
      assert.strictEqual(p2.delta, -16);
      assert.strictEqual(p1.newRating, 1216);
      assert.strictEqual(p2.newRating, 1184);
    });

    it('preserves zero-sum invariant across 4-player free-for-all', function() {
      const participants = [
        { id: 'BALANCED', rating: 1200 },
        { id: 'AGGRESSIVE', rating: 1350 },
        { id: 'DEFENSIVE', rating: 1100 },
        { id: 'HOARDER', rating: 1250 }
      ];
      const res = league_elo_calculator.calculateMultiplayerEloDeltas(
        participants,
        { winnerId: 'HOARDER' },
        { kFactor: 32 }
      );

      const sumDeltas = res.participants.reduce((acc, p) => acc + p.delta, 0);
      assert(Math.abs(sumDeltas) < 0.1, `Sum of deltas should be near 0, got ${sumDeltas}`);
    });

    it('handles SAFETY_HALTED draw match (winnerId: null)', function() {
      const participants = [
        { id: 'p1', rating: 1200 },
        { id: 'p2', rating: 1200 }
      ];
      const res = league_elo_calculator.calculateMultiplayerEloDeltas(participants, { winnerId: null });
      assert.strictEqual(res.participants[0].delta, 0);
      assert.strictEqual(res.participants[1].delta, 0);
    });
  });

  describe('Skill Drift Detection', function() {
    it('detects IMPROVING skill drift', function() {
      const history = [1200, 1210, 1220, 1250, 1280, 1310];
      const drift = league_elo_calculator.detectSkillDrift(history);
      assert.strictEqual(drift.driftDirection, 'IMPROVING');
      assert(drift.driftMagnitude >= 15);
      assert.strictEqual(drift.currentTier, 'COMPETENT');
    });

    it('detects DECLINING skill drift', function() {
      const history = [1300, 1280, 1260, 1220, 1180, 1150];
      const drift = league_elo_calculator.detectSkillDrift(history);
      assert.strictEqual(drift.driftDirection, 'DECLINING');
      assert(drift.driftMagnitude <= -15);
    });

    it('flags INSUFFICIENT_HISTORY_RISK for short history', function() {
      const history = [1200, 1210, 1220];
      const drift = league_elo_calculator.detectSkillDrift(history);
      assert(drift.riskFlags.includes('INSUFFICIENT_HISTORY_RISK'));
    });
  });

  describe('REST Endpoints', function() {
    it('GET /api/monopoly/bot/elo-rating-tiers returns 200 with 5 tiers', function(done) {
      http.get(`${baseUrl}/api/monopoly/bot/elo-rating-tiers`, (res) => {
        assert.strictEqual(res.statusCode, 200);
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const parsed = JSON.parse(data);
          assert.strictEqual(parsed.status, 'ok');
          assert.strictEqual(parsed.count, 5);
          assert.strictEqual(parsed.tiers.length, 5);
          done();
        });
      });
    });

    it('POST /api/monopoly/bot/calculate-league-elo calculates deltas and skill drift', function(done) {
      const payload = JSON.stringify({
        participants: [
          { id: 'BALANCED', rating: 1200 },
          { id: 'AGGRESSIVE', rating: 1200 },
          { id: 'DEFENSIVE', rating: 1200 }
        ],
        matchResult: { winnerId: 'AGGRESSIVE' },
        ratingHistories: {
          AGGRESSIVE: [1150, 1160, 1170, 1180, 1190, 1200]
        }
      });

      const req = http.request(`${baseUrl}/api/monopoly/bot/calculate-league-elo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        assert.strictEqual(res.statusCode, 200);
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const parsed = JSON.parse(data);
          assert.strictEqual(parsed.status, 'ok');
          assert.strictEqual(parsed.eloResult.participants.length, 3);
          const winner = parsed.eloResult.participants.find(p => p.id === 'AGGRESSIVE');
          assert(winner.delta > 0);
          assert(parsed.skillDrift.AGGRESSIVE);
          done();
        });
      });

      req.write(payload);
      req.end();
    });
  });
});
