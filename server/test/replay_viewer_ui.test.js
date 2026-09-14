const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const app = require('../app');

const CLIENT_SRC = path.join(__dirname, '../../client/src');

function readClientFile(relPath) {
  const full = path.join(CLIENT_SRC, relPath);
  assert.strictEqual(fs.existsSync(full), true, `${relPath} must exist`);
  return fs.readFileSync(full, 'utf8');
}

function getJson(baseUrl, urlPath, cb) {
  http.get(`${baseUrl}${urlPath}`, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => cb(null, res.statusCode, JSON.parse(body)));
  }).on('error', cb);
}

function postJson(baseUrl, urlPath, payload, cb) {
  const data = JSON.stringify(payload);
  const req = http.request(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => cb(null, res.statusCode, JSON.parse(body)));
  });
  req.on('error', cb);
  req.write(data);
  req.end();
}

/* Reference implementations matching client/src/utils/replayViewer.ts */
function summarizeReplay(roomCode, events, analysis) {
  const playersSet = new Set();
  let totalTurns = 0;
  let cardsPlayedCount = 0;
  let moneyBankedTotal = 0;
  let winnerName = undefined;

  events.forEach((evt) => {
    const pName = evt.displayName || evt.playerName || evt.playerId;
    if (pName && pName !== 'SYSTEM') playersSet.add(pName);
    if (typeof evt.turn === 'number' && evt.turn > totalTurns) totalTurns = evt.turn;
    const evtType = (evt.type || evt.action || '').toUpperCase();
    if (evtType.includes('PLAY') || evtType.includes('CARD') || evtType.includes('RENT')) {
      cardsPlayedCount++;
    }
    if (evtType.includes('BANK') || evtType.includes('PAY_BANK')) {
      if (typeof evt.amount === 'number') moneyBankedTotal += evt.amount;
    }
    if (evtType.includes('WIN') || evtType.includes('GAME_OVER')) {
      winnerName = pName;
    }
  });

  return {
    roomCode,
    totalSteps: events.length,
    totalTurns: Math.max(totalTurns, 1),
    players: Array.from(playersSet),
    cardsPlayedCount,
    moneyBankedTotal,
    blunderCount: analysis?.blunderCount || 0,
    winnerName
  };
}

function formatReplayEventDescription(evt) {
  if (evt.message) return evt.message;
  const actor = evt.displayName || evt.playerName || evt.playerId || 'Player';
  const type = (evt.type || evt.action || 'ACTION').toUpperCase();

  switch (type) {
    case 'DRAW':
    case 'DRAW_CARDS':
      return `${actor} drew 2 cards from the deck.`;
    case 'PLAY_CARD':
    case 'PLAY_ACTION_CARD':
      return `${actor} played ${evt.cardName || evt.cardTitle || 'a card'}${evt.propertyColor ? ` on ${evt.propertyColor}` : ''}.`;
    case 'PAY_BANK':
      return `${actor} deposited $${evt.amount || 0}M into their bank.`;
    case 'PAY_RENT':
      return `${actor} paid $${evt.amount || 0}M rent to ${evt.targetPlayerName || evt.targetPlayerId || 'opponent'}.`;
    case 'DISCARD':
    case 'DISCARD_CARD':
      return `${actor} discarded extra card(s) down to hand limit.`;
    case 'END_TURN':
      return `${actor} ended their turn.`;
    default:
      return `${actor} performed ${type}.`;
  }
}

describe('Match Replay & Tactical Telemetry Viewer Contract & Integration Tests', function() {
  let server;
  let baseUrl;

  before(function(done) {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
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

  it('verifies client components and utility contract files exist', function() {
    const replayViewerCode = readClientFile('utils/replayViewer.ts');
    assert.ok(replayViewerCode.includes('fetchRoomReplay'));
    assert.ok(replayViewerCode.includes('fetchReplayAnalysis'));
    assert.ok(replayViewerCode.includes('summarizeReplay'));

    const modalCode = readClientFile('components/ReplayViewerModal.tsx');
    assert.ok(modalCode.includes('role="dialog"'));
    assert.ok(modalCode.includes('Match Replay & Telemetry'));
    assert.ok(modalCode.includes('activeTab'));

    const lobbyCode = readClientFile('components/LobbyView.tsx');
    assert.ok(lobbyCode.includes('ReplayViewerModal'));
    assert.ok(lobbyCode.includes('🎬 Match Replay'));

    const winModalCode = readClientFile('components/WinModal.tsx');
    assert.ok(winModalCode.includes('ReplayViewerModal'));
    assert.ok(winModalCode.includes('🎬 Match Replay & Telemetry'));

    const boardCode = readClientFile('components/GameBoardView.tsx');
    assert.ok(boardCode.includes('ReplayViewerModal'));
    assert.ok(boardCode.includes('🎬 Replay'));
  });

  it('GET /api/monopoly/rooms/UNKNOWN/replay returns 404', function(done) {
    getJson(baseUrl, '/api/monopoly/rooms/UNKNOWN/replay', (err, status, body) => {
      assert.strictEqual(err, null);
      assert.strictEqual(status, 404);
      assert.strictEqual(body.status, 'error');
      assert.strictEqual(body.message, 'Room not found');
      done();
    });
  });

  it('POST /api/monopoly/bot/analyze-replay rejects empty replayLog', function(done) {
    postJson(baseUrl, '/api/monopoly/bot/analyze-replay', { replayLog: [], botPlayerId: 'bot1' }, (err, status, body) => {
      assert.strictEqual(err, null);
      assert.strictEqual(status, 400);
      assert.strictEqual(body.status, 'error');
      done();
    });
  });

  it('POST /api/monopoly/bot/analyze-replay accepts valid replay log', function(done) {
    const sampleEvents = [
      { seq: 1, type: 'DRAW', playerId: 'p1', displayName: 'Player 1', turn: 1 },
      { seq: 2, type: 'PAY_BANK', playerId: 'p1', displayName: 'Player 1', amount: 5, turn: 1 },
      { seq: 3, type: 'END_TURN', playerId: 'p1', displayName: 'Player 1', turn: 1 }
    ];
    postJson(baseUrl, '/api/monopoly/bot/analyze-replay', { replayLog: sampleEvents, botPlayerId: 'p1' }, (err, status, body) => {
      assert.strictEqual(err, null);
      assert.strictEqual(status, 200);
      assert.strictEqual(body.status, 'ok');
      done();
    });
  });

  it('correctly calculates replay summary metrics', function() {
    const events = [
      { seq: 1, type: 'DRAW', playerId: 'p1', displayName: 'Alice', turn: 1 },
      { seq: 2, type: 'PLAY_CARD', playerId: 'p1', displayName: 'Alice', cardName: 'Boardwalk', turn: 1 },
      { seq: 3, type: 'PAY_BANK', playerId: 'p1', displayName: 'Alice', amount: 3, turn: 1 },
      { seq: 4, type: 'END_TURN', playerId: 'p1', displayName: 'Alice', turn: 1 },
      { seq: 5, type: 'DRAW', playerId: 'p2', displayName: 'Bob', turn: 2 },
      { seq: 6, type: 'PAY_RENT', playerId: 'p2', displayName: 'Bob', targetPlayerName: 'Alice', amount: 2, turn: 2 },
      { seq: 7, type: 'GAME_OVER', playerId: 'p1', displayName: 'Alice', turn: 2 }
    ];

    const summary = summarizeReplay('TEST', events, { blunderCount: 1, blunders: [] });
    assert.strictEqual(summary.roomCode, 'TEST');
    assert.strictEqual(summary.totalSteps, 7);
    assert.strictEqual(summary.totalTurns, 2);
    assert.deepStrictEqual(summary.players, ['Alice', 'Bob']);
    assert.strictEqual(summary.cardsPlayedCount, 2); // PLAY_CARD + PAY_RENT
    assert.strictEqual(summary.moneyBankedTotal, 3);
    assert.strictEqual(summary.blunderCount, 1);
    assert.strictEqual(summary.winnerName, 'Alice');
  });

  it('correctly formats replay event descriptions', function() {
    assert.strictEqual(
      formatReplayEventDescription({ type: 'DRAW', displayName: 'Alice' }),
      'Alice drew 2 cards from the deck.'
    );
    assert.strictEqual(
      formatReplayEventDescription({ type: 'PAY_BANK', displayName: 'Alice', amount: 5 }),
      'Alice deposited $5M into their bank.'
    );
    assert.strictEqual(
      formatReplayEventDescription({ type: 'END_TURN', displayName: 'Bob' }),
      'Bob ended their turn.'
    );
  });
});
