const assert = require('assert');
const http = require('http');
const app = require('../app');
const league_season_manager = require('../league_season_manager');

describe('Monopoly Deal AI Bot League Season Standings & Transition Engine (v4.9)', function () {
  let server;
  let baseUrl;

  before(function (done) {
    server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after(function (done) {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  describe('Catalog & Unit Functions', function () {
    it('getSeasonTiersCatalog should return 3 tiers in correct rank order', function () {
      const catalog = league_season_manager.getSeasonTiersCatalog();
      assert.strictEqual(catalog.length, 3);
      assert.strictEqual(catalog[0].id, 'PREMIER_LEAGUE');
      assert.strictEqual(catalog[1].id, 'CHAMPIONSHIP');
      assert.strictEqual(catalog[2].id, 'DIVISION_ONE');
    });

    it('calculateSeasonRankings should aggregate points and rank bots correctly', function () {
      const mockMatches = [
        { winnerId: 'bot-1', participants: [{ id: 'bot-1', name: 'Bot 1', tier: 'CHAMPIONSHIP' }, { id: 'bot-2', name: 'Bot 2', tier: 'CHAMPIONSHIP' }] },
        { winnerId: 'bot-1', participants: [{ id: 'bot-1', name: 'Bot 1', tier: 'CHAMPIONSHIP' }, { id: 'bot-2', name: 'Bot 2', tier: 'CHAMPIONSHIP' }] }
      ];
      const rankings = league_season_manager.calculateSeasonRankings(mockMatches);
      assert.strictEqual(rankings.length, 2);
      assert.strictEqual(rankings[0].botId, 'bot-1');
      assert.strictEqual(rankings[0].points, 6);
      assert.strictEqual(rankings[1].botId, 'bot-2');
      assert.strictEqual(rankings[1].points, 0);
    });

    it('evaluateTierPromotionsAndRelegations should identify promotions and relegations', function () {
      const rankings = [
        { botId: 'bot-champ-1', botName: 'Champ Winner', tier: 'CHAMPIONSHIP', points: 9, winRatePct: 100 },
        { botId: 'bot-champ-2', botName: 'Champ Loser', tier: 'CHAMPIONSHIP', points: 0, winRatePct: 0 }
      ];
      const transitions = league_season_manager.evaluateTierPromotionsAndRelegations(rankings);
      assert.strictEqual(transitions.length, 2);
      const promo = transitions.find(t => t.action === 'PROMOTION');
      const releg = transitions.find(t => t.action === 'RELEGATION');
      assert.strictEqual(promo.botId, 'bot-champ-1');
      assert.strictEqual(promo.toTier, 'PREMIER_LEAGUE');
      assert.strictEqual(releg.botId, 'bot-champ-2');
      assert.strictEqual(releg.toTier, 'DIVISION_ONE');
    });
  });

  describe('REST Endpoints', function () {
    it('GET /api/monopoly/bot/season-tiers should return tiers catalog', function (done) {
      http.get(`${baseUrl}/api/monopoly/bot/season-tiers`, (res) => {
        assert.strictEqual(res.statusCode, 200);
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const json = JSON.parse(body);
          assert.strictEqual(json.status, 'ok');
          assert.strictEqual(json.count, 3);
          done();
        });
      }).on('error', done);
    });

    it('POST /api/monopoly/bot/calculate-season-standings should calculate standings', function (done) {
      const postData = JSON.stringify({
        matchResults: [
          { winnerId: 'bot-a', participants: [{ id: 'bot-a', name: 'Bot A' }, { id: 'bot-b', name: 'Bot B' }] }
        ]
      });

      const req = http.request(`${baseUrl}/api/monopoly/bot/calculate-season-standings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        assert.strictEqual(res.statusCode, 200);
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const json = JSON.parse(body);
          assert.strictEqual(json.status, 'ok');
          assert.strictEqual(json.standings.length, 2);
          done();
        });
      });

      req.on('error', done);
      req.write(postData);
      req.end();
    });

    it('POST /api/monopoly/bot/evaluate-season-transitions should simulate season transition', function (done) {
      const postData = JSON.stringify({
        seasonId: 'SEASON-TEST',
        matchResults: [
          { winnerId: 'bot-x', participants: [{ id: 'bot-x', name: 'Bot X', tier: 'CHAMPIONSHIP' }, { id: 'bot-y', name: 'Bot Y', tier: 'CHAMPIONSHIP' }] }
        ]
      });

      const req = http.request(`${baseUrl}/api/monopoly/bot/evaluate-season-transitions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (res) => {
        assert.strictEqual(res.statusCode, 200);
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const json = JSON.parse(body);
          assert.strictEqual(json.status, 'ok');
          assert.strictEqual(json.transitionSummary.seasonId, 'SEASON-TEST');
          assert.strictEqual(json.transitionSummary.transitionsCount, 2);
          done();
        });
      });

      req.on('error', done);
      req.write(postData);
      req.end();
    });
  });
});
