'use strict';

const assert = require('assert');
const ioClient = require('socket.io-client');
const ActionCard = require('../models/ActionCard');
const PropertyCard = require('../models/PropertyCard');
const room_registry = require('../room_registry');

function makeDealBreaker(id) {
    const card = new ActionCard('Deal Breaker', 'Steals a complete set of properties from any player. (Includes any buildings) Play into center to use.', 5);
    card.id = id;
    return card;
}

function makeProperty(id, title) {
    const card = new PropertyCard(title, 1, 'Brown');
    card.id = id;
    return card;
}

describe('Deal Breaker — Socket.IO action contract', function () {
    this.timeout(10000);

    let app;
    let server;
    let host;
    let witness;

    before(function (done) {
        app = require('../app');
        server = app.http;
        server.listen(0, done);
    });

    after(function (done) {
        if (host) host.disconnect();
        if (witness) witness.disconnect();
        server.close(done);
    });

    it('broadcasts the authoritative complete-set transfer and readable event summary', function (done) {
        const port = server.address().port;
        let roomCode;
        let started = false;
        let fixtureInjected = false;
        let actionEmitted = false;
        let expectedPostActionSeq = null;
        let witnessObserved = false;
        let eventObserved = false;
        let resolved = false;

        const fail = (error) => {
            if (resolved) return;
            resolved = true;
            done(error);
        };

        const completeIfObserved = () => {
            if (!resolved && witnessObserved && eventObserved) {
                resolved = true;
                done();
            }
        };

        host = ioClient(`http://127.0.0.1:${port}`, { forceNew: true, transports: ['websocket'] });
        witness = ioClient(`http://127.0.0.1:${port}`, { forceNew: true, transports: ['websocket'] });

        host.on('connect', () => host.emit('room:create', { displayName: 'Browser Actor' }));
        witness.on('connect', () => {
            const waitForRoom = () => {
                if (roomCode) witness.emit('room:join', { roomCode, displayName: 'Fixture Witness' });
                else setTimeout(waitForRoom, 5);
            };
            waitForRoom();
        });

        host.on('room:state', (room) => {
            roomCode = room.roomCode;
            if (!started && room.seats.length === 2) {
                started = true;
                host.emit('room:start');
            }
        });

        host.on('game:state', (state) => {
            if (!started || fixtureInjected || resolved || state.currentTurnPlayerId !== state.self.id || state.turnPhase !== 'ACTION') return;
            fixtureInjected = true;
            const room = room_registry.getRoom(roomCode);
            const actor = room.gameState.players[host.id];
            const target = room.gameState.players[witness.id];

            actor.hand = [makeDealBreaker('db-action')];
            target.properties.Brown = {
                cards: [makeProperty('br-1', 'Mediterranean Avenue'), makeProperty('br-2', 'Baltic Avenue')],
                hasHouse: true,
                hasHotel: false
            };
            expectedPostActionSeq = room.seq + 1;
            actionEmitted = true;
            host.emit('game:action', {
                type: 'PLAY_ACTION_CARD',
                cardId: 'db-action',
                targetZone: 'action',
                targetPlayerId: witness.id,
                targetPropertyColor: 'Brown'
            });
        });

        witness.on('game:state', (state) => {
            if (!actionEmitted || resolved) return;
            if (state.seq < expectedPostActionSeq) return;
            try {
                const actor = state.opponents.find(opp => opp.displayName === 'Browser Actor');
                assert.ok(actor, 'witness should receive the actor in the post-action client view');
                assert.strictEqual((actor.properties.Brown || []).length, 2);
                assert.strictEqual((state.self.properties.Brown || []).length, 0);
                witnessObserved = true;
                completeIfObserved();
            } catch (error) {
                fail(error);
            }
        });

        host.on('game:event', (event) => {
            if (!event.summary || !event.summary.includes('used Deal Breaker')) return;
            try {
                assert.match(event.summary, /Browser Actor used Deal Breaker to steal Fixture Witness's complete Brown set \(with house\)\./);
                const room = room_registry.getRoom(roomCode);
                assert.strictEqual(room.gameState.players[witness.id].properties.Brown, undefined);
                assert.strictEqual(room.gameState.players[host.id].properties.Brown.cards.length, 2);
                assert.strictEqual(room.gameState.discardPile.some(card => card.id === 'db-action'), true);
                eventObserved = true;
                completeIfObserved();
            } catch (error) {
                fail(error);
            }
        });

        host.on('game:action-rejected', ({ reason }) => fail(new Error(`Deal Breaker rejected: ${reason}`)));
    });
});
