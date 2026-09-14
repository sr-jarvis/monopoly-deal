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

    it('returns a human player to DRAW and accepts the client-projected mandatory draw after a bot turn', function (done) {
        const port = server.address().port;
        let roomStarted = false;
        let endedInitialTurn = false;
        let drewOnSecondTurn = false;
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
            // A real bot may now raise a supported charge during its turn. Settle
            // the projected human-only PaymentModal contract before waiting for
            // normal turn rotation, just as the browser client does.
            if (state.pendingResolution && state.seq !== settledPendingSeq) {
                settledPendingSeq = state.seq;
                const paymentCardIds = [
                    ...(state.self.bank || []).map(card => card.id),
                    ...Object.values(state.self.properties || {}).flat().map(card => card.id)
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

            if (!drewOnSecondTurn) {
                assert.strictEqual(state.turnPhase, 'DRAW');
                assert.strictEqual(state.drawCount, 2);
                drewOnSecondTurn = true;
                client.emit('game:action', { type: 'DRAW', count: state.drawCount });
                return;
            }

            if (drewOnSecondTurn && !finished) {
                try {
                    assert.strictEqual(state.currentTurnPlayerId, state.self.id);
                    assert.strictEqual(state.turnPhase, 'ACTION');
                    assert.strictEqual(state.drawCount, null);
                    finished = true;
                    done();
                } catch (error) {
                    fail(error);
                }
            }
        });
    });
});