'use strict';

const assert = require('assert');
const ioClient = require('socket.io-client');

const game_manager = require('../game_manager');
const room_registry = require('../room_registry');
const { ACTION_TYPES, DEBT_COLLECTOR_AMOUNT, BIRTHDAY_AMOUNT } = require('../rules_validator');
const ActionCard = require('../models/ActionCard');
const MoneyCard = require('../models/MoneyCard');
const PropertyCard = require('../models/PropertyCard');
const PropertyType = require('../models/PropertyType');

function makeDebtCollector(id) {
    const card = new ActionCard('Debt Collector', 'Force any player to pay you 5M. Play into center to use.', 3);
    card.id = id;
    return card;
}

function makeBirthday(id) {
    const card = new ActionCard('Its My Birthday', "All players give you 2M as a 'gift'.", 2);
    card.id = id;
    return card;
}

function drawToActionPhase(state, playerId) {
    return game_manager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId, count: 2 }).gameState;
}

describe('Charge resolution — Debt Collector / Its My Birthday', function() {
    it('rejects stale PAY_BANK protocol actions without mutating the game state', function() {
        const state = game_manager.createGameState([
            { id: 'p1', name: 'Scott' },
            { id: 'p2', name: 'Riri' }
        ]);
        const before = JSON.stringify(state);
        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PAY_BANK,
            playerId: 'p2',
            cardIds: ['forged-card']
        });

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /not a supported Monopoly Deal action/);
        assert.strictEqual(JSON.stringify(state), before);
    });

    describe('Debt Collector', function() {
        let state;

        beforeEach(function() {
            state = game_manager.createGameState([
                { id: 'p1', name: 'Scott' },
                { id: 'p2', name: 'Riri' }
            ]);
            state = drawToActionPhase(state, 'p1');
            state.players.p1.hand.push(makeDebtCollector('debt-1'));
        });

        it('creates a pendingCharge, discards the card, and consumes a play', function() {
            const result = game_manager.applyAction(state, {
                type: ACTION_TYPES.PLAY_ACTION_CARD,
                playerId: 'p1',
                cardId: 'debt-1',
                targetZone: 'action',
                targetPlayerId: 'p2'
            });

            assert.strictEqual(result.legal, true);
            const next = result.gameState;

            assert.ok(!next.players.p1.hand.some(c => c.id === 'debt-1'));
            assert.ok(next.discardPile.some(c => c.id === 'debt-1'));
            assert.strictEqual(next.turn.playsMade, 1);

            assert.ok(next.pendingCharge);
            assert.strictEqual(next.pendingCharge.sourceTitle, 'Debt Collector');
            assert.strictEqual(next.pendingCharge.fromPlayerId, 'p1');
            assert.deepStrictEqual(Object.keys(next.pendingCharge.debtors), ['p2']);
            assert.strictEqual(next.pendingCharge.debtors.p2.amountOwed, DEBT_COLLECTOR_AMOUNT);
        });

        it('rejects targeting yourself or omitting a target', function() {
            const selfTarget = game_manager.applyAction(state, {
                type: ACTION_TYPES.PLAY_ACTION_CARD,
                playerId: 'p1',
                cardId: 'debt-1',
                targetZone: 'action',
                targetPlayerId: 'p1'
            });
            assert.strictEqual(selfTarget.legal, false);

            const noTarget = game_manager.applyAction(state, {
                type: ACTION_TYPES.PLAY_ACTION_CARD,
                playerId: 'p1',
                cardId: 'debt-1',
                targetZone: 'action'
            });
            assert.strictEqual(noTarget.legal, false);
        });

        it('settles the charge and transfers the paid cards to the charging player', function() {
            let next = game_manager.applyAction(state, {
                type: ACTION_TYPES.PLAY_ACTION_CARD,
                playerId: 'p1',
                cardId: 'debt-1',
                targetZone: 'action',
                targetPlayerId: 'p2'
            }).gameState;

            next.players.p2.bank.push(new MoneyCard('5M', 5));
            const payCardId = next.players.p2.bank[0].id;

            const payResult = game_manager.applyAction(next, {
                type: ACTION_TYPES.PAY_RENT,
                playerId: 'p2',
                paymentCardIds: [payCardId]
            });

            assert.strictEqual(payResult.legal, true);
            const settled = payResult.gameState;

            assert.strictEqual(settled.pendingCharge, null);
            assert.strictEqual(settled.players.p2.bank.length, 0);
            assert.ok(settled.players.p1.bank.some(c => c.id === payCardId));
        });
    });

    describe('Its My Birthday', function() {
        it('charges every other player and clears only once all have paid', function() {
            let state = game_manager.createGameState([
                { id: 'p1', name: 'Scott' },
                { id: 'p2', name: 'Riri' },
                { id: 'p3', name: 'Shuri' }
            ]);
            state = drawToActionPhase(state, 'p1');
            state.players.p1.hand.push(makeBirthday('bday-1'));

            let next = game_manager.applyAction(state, {
                type: ACTION_TYPES.PLAY_ACTION_CARD,
                playerId: 'p1',
                cardId: 'bday-1',
                targetZone: 'action'
            }).gameState;

            assert.deepStrictEqual(Object.keys(next.pendingCharge.debtors).sort(), ['p2', 'p3']);
            assert.strictEqual(next.pendingCharge.debtors.p2.amountOwed, BIRTHDAY_AMOUNT);
            assert.strictEqual(next.pendingCharge.debtors.p3.amountOwed, BIRTHDAY_AMOUNT);

            next.players.p2.bank.push(new MoneyCard('2M', 2));
            const p2CardId = next.players.p2.bank[0].id;
            next = game_manager.applyAction(next, {
                type: ACTION_TYPES.PAY_RENT,
                playerId: 'p2',
                paymentCardIds: [p2CardId]
            }).gameState;

            // Still owed by p3.
            assert.ok(next.pendingCharge);
            assert.deepStrictEqual(Object.keys(next.pendingCharge.debtors), ['p3']);

            next.players.p3.bank.push(new MoneyCard('2M', 2));
            const p3CardId = next.players.p3.bank[0].id;
            next = game_manager.applyAction(next, {
                type: ACTION_TYPES.PAY_RENT,
                playerId: 'p3',
                paymentCardIds: [p3CardId]
            }).gameState;

            assert.strictEqual(next.pendingCharge, null);
            assert.strictEqual(next.players.p1.bank.reduce((s, c) => s + (c.value || 0), 0), 4);
        });
    });

    describe('Shortfall / all-assets settlement', function() {
        let state;

        beforeEach(function() {
            state = game_manager.createGameState([
                { id: 'p1', name: 'Scott' },
                { id: 'p2', name: 'Riri' }
            ]);
            state = drawToActionPhase(state, 'p1');
            state.players.p1.hand.push(makeDebtCollector('debt-1'));
            state = game_manager.applyAction(state, {
                type: ACTION_TYPES.PLAY_ACTION_CARD,
                playerId: 'p1',
                cardId: 'debt-1',
                targetZone: 'action',
                targetPlayerId: 'p2'
            }).gameState;
            // Strip p2 down to a controlled, insufficient set of assets.
            state.players.p2.hand = [];
            state.players.p2.bank = [];
            state.players.p2.properties = {};
        });

        it('accepts a payment covering all available assets even though it falls short of the amount owed', function() {
            state.players.p2.bank.push(new MoneyCard('2M', 2));
            const cardId = state.players.p2.bank[0].id;

            const result = game_manager.applyAction(state, {
                type: ACTION_TYPES.PAY_RENT,
                playerId: 'p2',
                paymentCardIds: [cardId]
            });

            assert.strictEqual(result.legal, true);
            assert.strictEqual(result.gameState.pendingCharge, null);
            assert.ok(result.gameState.players.p1.bank.some(c => c.id === cardId));
        });

        it('accepts an empty payment when the debtor has cards in hand but no payable bank/property assets', function() {
            state.players.p2.hand.push(new MoneyCard('5M', 5));

            const result = game_manager.applyAction(state, {
                type: ACTION_TYPES.PAY_RENT,
                playerId: 'p2',
                paymentCardIds: []
            });

            assert.strictEqual(result.legal, true);
            assert.strictEqual(result.gameState.pendingCharge, null);
            assert.strictEqual(result.gameState.players.p2.hand.length, 1);
            assert.strictEqual(result.gameState.players.p1.bank.length, 0);
        });

        it('accepts an empty payment when the debtor owns no assets at all', function() {
            const result = game_manager.applyAction(state, {
                type: ACTION_TYPES.PAY_RENT,
                playerId: 'p2',
                paymentCardIds: []
            });

            assert.strictEqual(result.legal, true);
            assert.strictEqual(result.gameState.pendingCharge, null);
        });

        it('rejects an underpayment when the debtor could have paid more', function() {
            state.players.p2.bank.push(new MoneyCard('1M', 1));
            state.players.p2.bank.push(new MoneyCard('1M', 1));
            state.players.p2.bank.push(new MoneyCard('1M', 1));

            const [firstCardId] = state.players.p2.bank.map(c => c.id);
            const result = game_manager.applyAction(state, {
                type: ACTION_TYPES.PAY_RENT,
                playerId: 'p2',
                paymentCardIds: [firstCardId]
            });

            assert.strictEqual(result.legal, false);
            assert.ok(/short/i.test(result.reason));
        });
    });

    describe('Pending charge blocks other actions', function() {
        let state;

        beforeEach(function() {
            state = game_manager.createGameState([
                { id: 'p1', name: 'Scott' },
                { id: 'p2', name: 'Riri' }
            ]);
            state = drawToActionPhase(state, 'p1');
            state.players.p1.hand.push(makeDebtCollector('debt-1'));
            state = game_manager.applyAction(state, {
                type: ACTION_TYPES.PLAY_ACTION_CARD,
                playerId: 'p1',
                cardId: 'debt-1',
                targetZone: 'action',
                targetPlayerId: 'p2'
            }).gameState;
        });

        it('rejects unrelated actions from any player while a debtor still owes payment', function() {
            const endTurnAttempt = game_manager.applyAction(state, { type: ACTION_TYPES.END_TURN, playerId: 'p1' });
            assert.strictEqual(endTurnAttempt.legal, false);
            assert.ok(/pending payment/i.test(endTurnAttempt.reason));

            const otherCard = state.players.p1.hand[0];
            const playAttempt = game_manager.applyAction(state, {
                type: ACTION_TYPES.PLAY_CARD,
                playerId: 'p1',
                cardId: otherCard.id,
                targetZone: 'bank'
            });
            assert.strictEqual(playAttempt.legal, false);
            assert.ok(/pending payment/i.test(playAttempt.reason));
        });

        it('still allows the owing debtor to PAY_RENT', function() {
            state.players.p2.bank.push(new MoneyCard('5M', 5));
            const cardId = state.players.p2.bank[0].id;

            const result = game_manager.applyAction(state, {
                type: ACTION_TYPES.PAY_RENT,
                playerId: 'p2',
                paymentCardIds: [cardId]
            });
            assert.strictEqual(result.legal, true);
        });
    });

    describe('room_registry.toClientView — pendingResolution', function() {
        it('surfaces the charge only to the viewer who owes it', function() {
            const room = room_registry.createRoom('p1', 'Scott');
            room.seats.push({ seatIndex: 1, playerId: 'p2', displayName: 'Riri', connected: true });
            room.gameState = game_manager.createGameState([
                { id: 'p1', name: 'Scott' },
                { id: 'p2', name: 'Riri' }
            ]);
            room.gameState.pendingCharge = {
                sourceTitle: 'Debt Collector',
                fromPlayerId: 'p1',
                targetPlayerId: 'p2',
                debtors: { p2: { amountOwed: 5 } }
            };

            const viewForDebtor = room_registry.toClientView(room, 'p2');
            assert.ok(viewForDebtor.pendingResolution);
            assert.strictEqual(viewForDebtor.pendingResolution.targetPlayerId, 'p2');
            assert.strictEqual(viewForDebtor.pendingResolution.amountOwed, 5);
            assert.strictEqual(viewForDebtor.pendingResolution.fromPlayerId, 'p1');
            assert.strictEqual(viewForDebtor.pendingResolution.sourceTitle, 'Debt Collector');

            const viewForCharger = room_registry.toClientView(room, 'p1');
            assert.strictEqual(viewForCharger.pendingResolution, undefined);
        });
    });

    describe('Bot auto-payment (socket-driven)', function() {
        this.timeout(10000);
        let server, serverPort, client1;

        before(function(done) {
            const app = require('../app');
            server = app.http;
            server.listen(0, () => {
                serverPort = server.address().port;
                done();
            });
        });

        after(function(done) {
            if (client1 && client1.connected) client1.disconnect();
            server.close(done);
        });

        it('auto-settles a Debt Collector charge against a bot debtor without human intervention', function(done) {
            const url = `http://localhost:${serverPort}`;
            client1 = ioClient(url, { forceNew: true, transports: ['websocket'] });

            let roomCode = null;
            let botPlayerId = null;
            let triggered = false;

            client1.on('connect', () => {
                client1.emit('room:create', { displayName: 'Charger' });
            });

            client1.on('game:action-rejected', (err) => {
                done(new Error(`Action rejected: ${JSON.stringify(err)}`));
            });

            client1.on('room:state', (roomState) => {
                if (!roomCode && roomState.roomCode) {
                    roomCode = roomState.roomCode;
                    client1.emit('room:add-bot', { displayName: 'Jarvis', difficulty: 'BALANCED' });
                    return;
                }
                if (roomState.status === 'LOBBY' && roomState.seats.length === 2 && !botPlayerId) {
                    const botSeat = roomState.seats.find(s => s.isBot);
                    if (botSeat) {
                        botPlayerId = botSeat.playerId;
                        client1.emit('room:start');
                    }
                }
            });

            client1.on('game:state', (state) => {
                if (triggered || !state || state.currentTurnPlayerId !== client1.id) return;
                triggered = true;

                const room = room_registry.getRoom(roomCode);
                const debtCollector = makeDebtCollector('e2e-debt-1');
                room.gameState.players[client1.id].hand.push(debtCollector);

                client1.emit('game:action', {
                    type: 'PLAY_ACTION_CARD',
                    cardId: debtCollector.id,
                    targetZone: 'action',
                    targetPlayerId: botPlayerId
                });

                setTimeout(() => {
                    try {
                        const finalRoom = room_registry.getRoom(roomCode);
                        assert.strictEqual(finalRoom.gameState.pendingCharge, null, 'pending charge should auto-settle for a bot debtor');
                        done();
                    } catch (err) {
                        done(err);
                    }
                }, 500);
            });
        });
    });
});
