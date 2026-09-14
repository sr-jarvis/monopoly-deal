const assert = require('assert');
const http = require('http');
const app = require('../app');
const match_replay_analyzer = require('../match_replay_analyzer');
const game_manager = require('../game_manager');

describe('Match Replay Analyzer Module (v4.3)', function() {
  const sampleEvents = [
    {
      seq: 1,
      timestamp: 1000,
      phase: 'ACTION',
      actionType: 'DRAW',
      actorId: 'p1',
      payload: { count: 2 },
      status: 'APPLIED',
      boardSnapshotSummary: {
        p1: { bankTotal: 1, properties: { Red: { cardsOwned: 1 } } },
        p2: { bankTotal: 0, properties: {} }
      }
    },
    {
      seq: 2,
      timestamp: 2000,
      phase: 'ACTION',
      actionType: 'PLAY_CARD',
      actorId: 'p1',
      payload: { cardId: 'c1' },
      status: 'APPLIED',
      boardSnapshotSummary: {
        p1: { bankTotal: 2, properties: { Red: { cardsOwned: 3 } } },
        p2: { bankTotal: 1, properties: {} }
      }
    },
    {
      seq: 3,
      timestamp: 3000,
      phase: 'ACTION',
      actionType: 'PLAY_CARD',
      actorId: 'p2',
      payload: { cardId: 'c2' },
      status: 'APPLIED',
      boardSnapshotSummary: {
        p1: { bankTotal: 2, properties: { Red: { cardsOwned: 3 } } },
        p2: { bankTotal: 10, properties: { DarkBlue: { cardsOwned: 2 } } }
      }
    }
  ];

  it('getReplayMetricTypesCatalog returns 6 frozen metric definitions', function() {
    const catalog = match_replay_analyzer.getReplayMetricTypesCatalog();
    assert.strictEqual(catalog.length, 6);
    assert.strictEqual(catalog[0].id, 'EFFICIENCY_RATING');
    assert.strictEqual(catalog[5].id, 'PERFORMANCE_GRADE');
  });

  it('analyzeMatchReplay calculates metrics and turning points correctly', function() {
    const analysis = match_replay_analyzer.analyzeMatchReplay(sampleEvents);
    assert.strictEqual(analysis.playerCount, 2);
    assert.strictEqual(analysis.eventCount, 3);
    assert.ok(analysis.perPlayer.p1);
    assert.ok(analysis.perPlayer.p2);
    assert.strictEqual(analysis.perPlayer.p1.efficiencyRating, 100);
    assert.ok(['S', 'A', 'B', 'C', 'D'].includes(analysis.perPlayer.p1.performanceGrade));
    assert.ok(analysis.turningPoints.length >= 1);
  });

  it('generateStrategicMatchSummary returns narrative, ranking and counterTactics', function() {
    const summary = match_replay_analyzer.generateStrategicMatchSummary(sampleEvents);
    assert.ok(typeof summary.narrative === 'string');
    assert.ok(Array.isArray(summary.ranking));
    assert.ok(Array.isArray(summary.counterTactics));
    assert.strictEqual(summary.ranking[0], 'p2');
  });

  it('throws on empty or invalid historyEvents', function() {
    assert.throws(() => match_replay_analyzer.analyzeMatchReplay([]), /non-empty array/);
    assert.throws(() => match_replay_analyzer.analyzeMatchReplay(null), /non-empty array/);
  });
});

describe('Match Replay Analytics REST API Endpoints (v4.3)', function() {
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

  function jsonPost(urlPath, body, callback) {
    const data = JSON.stringify(body);
    const u = new URL(urlPath, baseUrl);
    const req = http.request(u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, function(res) {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          callback(null, res.statusCode, JSON.parse(raw));
        } catch (e) {
          callback(e, res.statusCode, raw);
        }
      });
    });
    req.on('error', callback);
    req.write(data);
    req.end();
  }

  function jsonGet(urlPath, callback) {
    const u = new URL(urlPath, baseUrl);
    http.get(u, function(res) {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          callback(null, res.statusCode, JSON.parse(raw));
        } catch (e) {
          callback(e, res.statusCode, raw);
        }
      });
    }).on('error', callback);
  }

  it('GET /api/monopoly/bot/replay-metric-types returns 200 and catalog', function(done) {
    jsonGet('/api/monopoly/bot/replay-metric-types', function(err, status, body) {
      assert.ifError(err);
      assert.strictEqual(status, 200);
      assert.strictEqual(body.status, 'ok');
      assert.strictEqual(body.count, 6);
      done();
    });
  });

  it('POST /api/monopoly/bot/analyze-match-replay returns 200 analysis', function(done) {
    const sampleEvents = [
      {
        seq: 1,
        timestamp: 1000,
        phase: 'ACTION',
        actionType: 'DRAW',
        actorId: 'p1',
        payload: { count: 2 },
        status: 'APPLIED',
        boardSnapshotSummary: {
          p1: { bankTotal: 1, properties: { Red: { cardsOwned: 1 } } }
        }
      }
    ];
    jsonPost('/api/monopoly/bot/analyze-match-replay', { historyEvents: sampleEvents }, function(err, status, body) {
      assert.ifError(err);
      assert.strictEqual(status, 200);
      assert.strictEqual(body.status, 'ok');
      assert.ok(body.analysis);
      done();
    });
  });

  it('POST /api/monopoly/bot/analyze-match-replay with mode="summary" returns summary', function(done) {
    const sampleEvents = [
      {
        seq: 1,
        timestamp: 1000,
        phase: 'ACTION',
        actionType: 'DRAW',
        actorId: 'p1',
        payload: { count: 2 },
        status: 'APPLIED',
        boardSnapshotSummary: {
          p1: { bankTotal: 1, properties: { Red: { cardsOwned: 1 } } }
        }
      }
    ];
    jsonPost('/api/monopoly/bot/analyze-match-replay', { historyEvents: sampleEvents, mode: 'summary' }, function(err, status, body) {
      assert.ifError(err);
      assert.strictEqual(status, 200);
      assert.strictEqual(body.status, 'ok');
      assert.ok(body.summary);
      assert.ok(body.summary.narrative);
      done();
    });
  });

  it('POST /api/monopoly/bot/analyze-match-replay returns 400 on empty input', function(done) {
    jsonPost('/api/monopoly/bot/analyze-match-replay', { historyEvents: [] }, function(err, status, body) {
      assert.ifError(err);
      assert.strictEqual(status, 400);
      assert.strictEqual(body.status, 'error');
      done();
    });
  });
});
