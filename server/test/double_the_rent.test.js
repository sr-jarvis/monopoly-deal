'use strict';

const assert = require('assert');

const game_manager = require('../game_manager');
const app = require('../app');
const { ACTION_TYPES } = require('../rules_validator');
const ActionCard = require('../models/ActionCard');
const PropertyCard = require('../models/PropertyCard');
const RentCard = require('../models/RentCard');
const PropertyType = require('../models/PropertyType');

const buildActionEventSummary = app.buildActionEventSummary;

function makeRent(id, colors) {
    const card = new RentCard('Rent', colors.length > 2 ? 3 : 1, colors);
    card.id = id;
    return card;
}

function makeDtr(id) {
    const card = new ActionCard('Double The Rent', 'Needs to played with a rent card. Play into center to use.', 1);
    card.id = id;
    return card;
}

function group(cards) {
    return { cards, hasHouse: false, hasHotel: false };
}

function fullSet(playerId, color, count) {
    const cards = [];
    for (let i = 0; i < count; i += 1) {
        const card = new PropertyCard(`${color} ${i}`, 1, color);
        card.id = `${playerId}-${color}-${i}`;
        cards.push(card);
    }
    return group(cards);
}

function drawToActionPhase(state, playerId) {
    return game_manager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId, count: 2 }).gameState;
}

function baseState(playerCount) {
    const players = Array.from({ length: playerCount || 2 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
    return drawToActionPhase(game_manager.createGameState(players), 'p1');
}

function rentAction(overrides) {
    return Object.assign({
        type: ACTION_TYPES.PLAY_ACTION_CARD,
        playerId: 'p1',
        cardId: 'rent-1',
        propertyColor: 'Brown'
    }, overrides);
}

describe('Double The Rent — atomic with Rent', function () {
    describe('happy path', function () {
        it('doubles the rent, consumes two plays, and discards both cards', function () {
            const state = baseState(2);
            state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
            state.players.p1.hand = [
                makeRent('rent-1', [PropertyType.Brown, PropertyType.LightBlue]),
                makeDtr('dtr-1')
            ];

            const result = game_manager.applyAction(state, rentAction({ doubleRentCardId: 'dtr-1' }));

            assert.strictEqual(result.legal, true);
            const next = result.gameState;
            // Plain full Brown rent = 2 (tier) x2 (full set) = 4; doubled = 8.
            assert.strictEqual(next.pendingCharge.debtors.p2.amountOwed, 8);
            assert.strictEqual(next.pendingCharge.doubled, true);
            assert.strictEqual(next.pendingCharge.type, 'RENT');
            assert.strictEqual(next.pendingCharge.sourceTitle, 'Rent');
            assert.strictEqual(next.turn.playsMade, 2);

            assert.ok(!next.players.p1.hand.some(c => c.id === 'rent-1'));
            assert.ok(!next.players.p1.hand.some(c => c.id === 'dtr-1'));
            assert.ok(next.discardPile.some(c => c.id === 'rent-1'));
            assert.ok(next.discardPile.some(c => c.id === 'dtr-1'));

            // Input state is never mutated.
            assert.strictEqual(state.turn.playsMade, 0);
            assert.strictEqual(state.players.p1.hand.length, 2);
        });

        it('doubles rent computed with a House and Hotel bonus', function () {
            const state = baseState(2);
            state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
            state.players.p1.properties.Brown.hasHouse = true;
            state.players.p1.properties.Brown.hasHotel = true;
            state.players.p1.hand = [
                makeRent('rent-1', [PropertyType.Brown, PropertyType.LightBlue]),
                makeDtr('dtr-1')
            ];

            const result = game_manager.applyAction(state, rentAction({ doubleRentCardId: 'dtr-1' }));

            assert.strictEqual(result.legal, true);
            // (2 x2) + 3 (house) + 4 (hotel) = 11; doubled = 22.
            assert.strictEqual(result.gameState.pendingCharge.debtors.p2.amountOwed, 22);
        });

        it('doubles the charge for every debtor of an all-opponent Rent', function () {
            const state = baseState(3);
            state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
            state.players.p1.hand = [
                makeRent('rent-1', [PropertyType.Brown, PropertyType.LightBlue]),
                makeDtr('dtr-1')
            ];

            const result = game_manager.applyAction(state, rentAction({ doubleRentCardId: 'dtr-1' }));

            assert.strictEqual(result.legal, true);
            assert.deepStrictEqual(Object.keys(result.gameState.pendingCharge.debtors).sort(), ['p2', 'p3']);
            assert.strictEqual(result.gameState.pendingCharge.debtors.p2.amountOwed, 8);
            assert.strictEqual(result.gameState.pendingCharge.debtors.p3.amountOwed, 8);
        });

        it('doubles an all-color Rent against the chosen target', function () {
            const state = baseState(3);
            state.players.p1.properties.Green = fullSet('p1', 'Green', 3);
            state.players.p1.hand = [
                makeRent('rent-1', Object.values(PropertyType)),
                makeDtr('dtr-1')
            ];

            const result = game_manager.applyAction(state, rentAction({
                propertyColor: 'Green',
                targetPlayerId: 'p3',
                doubleRentCardId: 'dtr-1'
            }));

            assert.strictEqual(result.legal, true);
            assert.deepStrictEqual(Object.keys(result.gameState.pendingCharge.debtors), ['p3']);
            // Green tier for 3 cards = 7, x2 full set = 14; doubled = 28.
            assert.strictEqual(result.gameState.pendingCharge.debtors.p3.amountOwed, 28);
        });
    });

    describe('rejections leave the input state untouched', function () {
        function assertUnchanged(state, result) {
            assert.strictEqual(result.legal, false);
            assert.strictEqual(result.gameState, undefined);
            assert.strictEqual(state.turn.playsMade, 0);
            assert.ok(state.players.p1.hand.some(c => c.id === 'rent-1'));
            assert.ok(state.players.p1.hand.some(c => c.id === 'dtr-1'));
            assert.ok(!state.discardPile.some(c => c.id === 'rent-1' || c.id === 'dtr-1'));
        }

        function stateWithBoth() {
            const state = baseState(2);
            state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
            state.players.p1.hand = [
                makeRent('rent-1', [PropertyType.Brown, PropertyType.LightBlue]),
                makeDtr('dtr-1')
            ];
            return state;
        }

        it('rejects when fewer than 2 plays remain', function () {
            const state = stateWithBoth();
            state.turn.playsMade = 2;

            const result = game_manager.applyAction(state, rentAction({ doubleRentCardId: 'dtr-1' }));

            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /Play limit/);
            assert.strictEqual(state.turn.playsMade, 2);
            assert.ok(state.players.p1.hand.some(c => c.id === 'dtr-1'));
        });

        it('rejects when the doubleRentCardId is not in hand', function () {
            const state = stateWithBoth();
            const result = game_manager.applyAction(state, rentAction({ doubleRentCardId: 'ghost' }));
            assert.match(result.reason, /not found in your hand/);
            assertUnchanged(state, result);
        });

        it('rejects when the doubleRentCardId names a non-DTR card', function () {
            const state = stateWithBoth();
            const wrong = new PropertyCard('Brown extra', 1, 'Brown');
            wrong.id = 'not-dtr';
            state.players.p1.hand.push(wrong);

            const result = game_manager.applyAction(state, rentAction({ doubleRentCardId: 'not-dtr' }));
            assert.match(result.reason, /not a Double The Rent card/);
            assertUnchanged(state, result);
        });

        it('rejects when doubleRentCardId equals the Rent cardId', function () {
            const state = stateWithBoth();
            const result = game_manager.applyAction(state, rentAction({ doubleRentCardId: 'rent-1' }));
            assert.match(result.reason, /separate card/);
            assertUnchanged(state, result);
        });

        it('rejects an all-color Rent + DTR with no targetPlayerId', function () {
            const state = baseState(3);
            state.players.p1.properties.Green = fullSet('p1', 'Green', 3);
            state.players.p1.hand = [
                makeRent('rent-1', Object.values(PropertyType)),
                makeDtr('dtr-1')
            ];

            const result = game_manager.applyAction(state, rentAction({
                propertyColor: 'Green',
                doubleRentCardId: 'dtr-1'
            }));

            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /requires a targetPlayerId/);
            assert.strictEqual(state.turn.playsMade, 0);
            assert.ok(state.players.p1.hand.some(c => c.id === 'dtr-1'));
        });
    });

    describe('standalone Double The Rent', function () {
        it('is rejected when played on its own as an action card', function () {
            const state = baseState(2);
            state.players.p1.hand = [makeDtr('dtr-1')];

            const result = game_manager.applyAction(state, {
                type: ACTION_TYPES.PLAY_ACTION_CARD,
                playerId: 'p1',
                cardId: 'dtr-1',
                targetZone: 'action'
            });

            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /must be played together with a Rent card/);
            assert.strictEqual(state.turn.playsMade, 0);
            assert.ok(state.players.p1.hand.some(c => c.id === 'dtr-1'));
        });

        it('can still be banked as $1M', function () {
            const state = baseState(2);
            state.players.p1.hand = [makeDtr('dtr-1')];

            const result = game_manager.applyAction(state, {
                type: ACTION_TYPES.PLAY_CARD,
                playerId: 'p1',
                cardId: 'dtr-1',
                targetZone: 'bank'
            });

            assert.strictEqual(result.legal, true);
            assert.ok(result.gameState.players.p1.bank.some(c => c.id === 'dtr-1'));
            assert.strictEqual(result.gameState.turn.playsMade, 1);
        });

        it('rejects a forged DTR payload on an ordinary bank play without consuming a play', function () {
            const state = baseState(2);
            const cash = new ActionCard('Pass Go', 'Draw 2 cards.', 1);
            cash.id = 'cash-1';
            state.players.p1.hand = [cash, makeDtr('dtr-1')];

            const result = game_manager.applyAction(state, {
                type: ACTION_TYPES.PLAY_CARD,
                playerId: 'p1',
                cardId: 'cash-1',
                targetZone: 'bank',
                doubleRentCardId: 'dtr-1'
            });

            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /only be used with a Rent action/);
            assert.strictEqual(state.turn.playsMade, 0);
            assert.strictEqual(state.players.p1.bank.length, 0);
            assert.ok(state.players.p1.hand.some(c => c.id === 'cash-1'));
        });

        it('rejects a forged DTR payload on a non-card action', function () {
            const state = game_manager.createGameState([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }]);

            const result = game_manager.applyAction(state, {
                type: ACTION_TYPES.DRAW,
                playerId: 'p1',
                count: 2,
                doubleRentCardId: 'forged'
            });

            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /only be used with a Rent action/);
            assert.strictEqual(state.turn.phase, 'DRAW');
            assert.strictEqual(state.turn.playsMade, 0);
        });

        it('rejects empty and non-string forged DTR fields by presence, not truthiness', function () {
            for (const doubleRentCardId of ['', null, 0, {}]) {
                const state = game_manager.createGameState([{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }]);
                const result = game_manager.applyAction(state, {
                    type: ACTION_TYPES.DRAW,
                    playerId: 'p1',
                    count: 2,
                    doubleRentCardId
                });

                assert.strictEqual(result.legal, false);
                assert.match(result.reason, /requires a card ID/);
                assert.strictEqual(state.turn.phase, 'DRAW');
            }
        });
    });

    describe('plain Rent regression (no doubleRentCardId)', function () {
        it('charges the undoubled amount, consumes one play, and keeps any DTR in hand', function () {
            const state = baseState(2);
            state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
            state.players.p1.hand = [
                makeRent('rent-1', [PropertyType.Brown, PropertyType.LightBlue]),
                makeDtr('dtr-1')
            ];

            const result = game_manager.applyAction(state, rentAction());

            assert.strictEqual(result.legal, true);
            const next = result.gameState;
            assert.strictEqual(next.pendingCharge.debtors.p2.amountOwed, 4);
            assert.strictEqual(next.pendingCharge.doubled, false);
            assert.strictEqual(next.turn.playsMade, 1);
            assert.ok(!next.players.p1.hand.some(c => c.id === 'rent-1'));
            assert.ok(next.players.p1.hand.some(c => c.id === 'dtr-1'));
            assert.ok(!next.discardPile.some(c => c.id === 'dtr-1'));
        });
    });

    describe('event summary wording', function () {
        it('states that the rent was doubled', function () {
            const state = baseState(2);
            state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
            state.players.p1.hand = [
                makeRent('rent-1', [PropertyType.Brown, PropertyType.LightBlue]),
                makeDtr('dtr-1')
            ];
            const previousGameState = state;
            const action = rentAction({ doubleRentCardId: 'dtr-1' });
            const result = game_manager.applyAction(state, action);
            assert.strictEqual(result.legal, true);

            const room = {
                seats: [
                    { seatIndex: 0, playerId: 'p1', displayName: 'Scott', connected: true },
                    { seatIndex: 1, playerId: 'p2', displayName: 'Riri', connected: true }
                ],
                gameState: result.gameState
            };

            const summary = buildActionEventSummary(room, action, previousGameState);
            assert.match(summary, /doubled/i);
            assert.match(summary, /must pay \$8M/);
        });
    });
});
