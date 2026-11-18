'use strict';

const assert = require('assert');
const ioClient = require('socket.io-client');

describe('Human turn draw phase', function () {
    this.timeout(20000);

    let app;
    let server;
    let client;

    before(function (done) {
        app = require('../app');
        server = app.http;
        server.listen(0, done);
    });

    after(function (done) {
        if (client) client.disconnect();
        server.close(done);
    });

    it('returns a human player with the mandatory draw already applied after a bot turn', function (done) {
        const port = server.address().port;
        let roomStarted = false;
        let endedInitialTurn = false;

        let finished = false;
        let settledPendingSeq = null;

        const fail = (error) => {
            if (finished) return;
            finished = true;
            done(error);
        };

        client = ioClient(`http://127.0.0.1:${port}`, { forceNew: true, transports: ['websocket'] });
        client.on('connect', () => client.emit('room:create', { displayName: 'Browser Player' }));
        client.on('game:action-rejected', ({ reason }) => fail(new Error(`Action rejected: ${reason}`)));
        client.on('room:state', (room) => {
            if (roomStarted) return;
            if (room.seats.length === 1) {
                client.emit('room:add-bot', { displayName: 'Jarvis Bot', difficulty: 'BALANCED' });
            } else if (room.seats.length === 2) {
                roomStarted = true;
                client.emit('room:start');
            }
        });
        client.on('game:state', (state) => {
            if (state.pendingActionResolution) {
                if (state.pendingActionResolution.eligibleResponderIds.includes(state.self.id) && state.seq !== settledPendingSeq) {
                    settledPendingSeq = state.seq;
                    client.emit('game:action', {type:'ACCEPT_ACTION'});
                }
                return;
            }
            // A real bot may now raise a supported charge during its turn. Settle
            // the projected human-only PaymentModal contract before waiting for
            // normal turn rotation, just as the browser client does.
            if (state.pendingResolution && state.seq !== settledPendingSeq) {
                settledPendingSeq = state.seq;
                const paymentCardIds = [
                    ...(state.self.bank || []).map(card => card.id),
                    ...Object.values(state.self.properties || {}).flat().filter(card => card.value > 0).map(card => card.id),
                    ...Object.values(state.self.buildings || {}).flatMap(b => [b.houseCard,b.hotelCard].filter(Boolean).map(card => card.id))
                ];
                client.emit('game:action', { type: 'PAY_RENT', paymentCardIds });
                return;
            }
            if (finished || state.currentTurnPlayerId !== state.self.id) return;

            if (!endedInitialTurn) {
                assert.strictEqual(state.turnPhase, 'ACTION');
                endedInitialTurn = true;
                client.emit('game:action', { type: 'END_TURN' });
                return;
            }

            if (!finished) {
                try {
                    assert.strictEqual(state.currentTurnPlayerId, state.self.id);
                    assert.strictEqual(state.turnPhase, 'ACTION');
                    assert.strictEqual(state.drawCount, null);
                    assert.strictEqual(state.turnNumber, 3);
                    assert.deepStrictEqual(state.drawEvents.at(-1), {
                        id: state.drawEvents.at(-1).id,
                        playerId: state.self.id,
                        count: 2,
                        kind: 'DRAW'
                    });
                    finished = true;
                    done();
                } catch (error) {
                    fail(error);
                }
            }
        });
    });
});