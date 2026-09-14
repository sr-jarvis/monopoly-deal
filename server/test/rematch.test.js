'use strict';

const assert = require('assert');
const ioClient = require('socket.io-client');
const room_registry = require('../room_registry');

describe('Rematch & Lobby State Persistence — room_registry.resetRoom', function() {
  it('should reset room to LOBBY and clear gameState while preserving seats and bot difficulty', function() {
    const room = room_registry.createRoom('socket_host_rematch_1', 'Host One');
    const botRes = room_registry.addBotSeat(room.roomCode, 'Jarvis Bot', 'HARD');
    assert(!botRes.error);

    room.status = 'IN_PROGRESS';
    room.seq = 15;
    room.gameState = {
      turn: { playerId: 'socket_host_rematch_1', phase: 'ACTION' },
      players: {}
    };

    const result = room_registry.resetRoom(room.roomCode);
    assert(!result.error);
    assert.strictEqual(result.room.status, 'LOBBY');
    assert.strictEqual(result.room.gameState, null);
    assert.strictEqual(result.room.seq, 0);

    // Verify seats and bot difficulty are preserved
    assert.strictEqual(result.room.seats.length, 2);
    assert.strictEqual(result.room.seats[0].playerId, 'socket_host_rematch_1');
    assert.strictEqual(result.room.seats[1].displayName, 'Jarvis Bot');
    assert.strictEqual(result.room.seats[1].difficulty, 'HARD');
    assert.strictEqual(result.room.seats[1].isBot, true);
  });

  it('should return error when attempting to reset unknown room', function() {
    const result = room_registry.resetRoom('BOGUS_CODE');
    assert.strictEqual(result.error, 'Room not found');
  });
});

describe('Rematch & Lobby State Persistence — Socket.IO Flow', function() {
  this.timeout(15000);
  let server;
  let serverPort;
  let client1;
  let client2;
  let app;

  before((done) => {
    app = require('../app');
    server = app.http;
    server.listen(0, () => {
      serverPort = server.address().port;
      done();
    });
  });

  after((done) => {
    if (client1 && client1.connected) client1.disconnect();
    if (client2 && client2.connected) client2.disconnect();
    if (server) server.close();
    done();
  });

  it('should reset match and return all players to lobby via room:rematch', function(done) {
    client1 = ioClient.connect(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });

    let roomCode = '';

    client1.on('connect', () => {
      client1.emit('room:create', { displayName: 'Host Player' });
    });

    client1.once('room:state', (roomState) => {
      roomCode = roomState.roomCode;
      assert.strictEqual(roomState.status, 'LOBBY');

      // Add bot with HARD difficulty
      client1.emit('room:add-bot', { difficulty: 'HARD' });

      client1.once('room:state', (updatedRoomState) => {
        assert.strictEqual(updatedRoomState.seats.length, 2);
        const botSeat = updatedRoomState.seats.find((s) => s.isBot);
        assert.ok(botSeat);
        assert.strictEqual(botSeat.difficulty, 'HARD');

        // Start match
        client1.emit('room:start', {});

        client1.once('game:state', (gameState) => {
          assert.ok(gameState);
          assert.strictEqual(gameState.roomCode, roomCode);

          // Listen for rematch events
          let receivedLobbyState = false;
          let receivedNullGameState = false;
          let receivedRematchEvent = false;

          const checkDone = () => {
            if (receivedLobbyState && receivedNullGameState && receivedRematchEvent) {
              // Verify we can start a second match immediately
              client1.emit('room:start', {});
              client1.once('game:state', (secondGameState) => {
                assert.ok(secondGameState);
                assert.strictEqual(secondGameState.roomCode, roomCode);
                done();
              });
            }
          };

          client1.on('room:state', (rematchRoomState) => {
            if (rematchRoomState.status === 'LOBBY') {
              receivedLobbyState = true;
              assert.strictEqual(rematchRoomState.seats.length, 2);
              const botSeatAfter = rematchRoomState.seats.find((s) => s.isBot);
              assert.strictEqual(botSeatAfter.difficulty, 'HARD');
              checkDone();
            }
          });

          client1.on('game:state', (state) => {
            if (state === null) {
              receivedNullGameState = true;
              checkDone();
            }
          });

          client1.on('game:event', (evt) => {
            if (evt.action === 'REMATCH') {
              receivedRematchEvent = true;
              checkDone();
            }
          });

          // Request rematch
          client1.emit('room:rematch', { roomCode });
        });
      });
    });
  });

  it('should reject room:rematch from non-seated sockets', function(done) {
    // Create a real room
    const room = room_registry.createRoom('socket_host_rematch_guard', 'Host Guard');

    client2 = ioClient.connect(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });

    client2.on('connect', () => {
      client2.once('game:action-rejected', (err) => {
        assert.strictEqual(err.reason, 'Must be seated in room to request rematch');
        done();
      });

      client2.emit('room:rematch', { roomCode: room.roomCode });
    });
  });
});
