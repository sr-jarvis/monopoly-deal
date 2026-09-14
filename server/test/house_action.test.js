'use strict';

const assert = require('assert');

const game_manager = require('../game_manager');
const room_registry = require('../room_registry');
const { ACTION_TYPES } = require('../rules_validator');
const ActionCard = require('../models/ActionCard');
const PropertyCard = require('../models/PropertyCard');
const RentCard = require('../models/RentCard');
const PropertyType = require('../models/PropertyType');

function makeHouse(id) {
    const card = new ActionCard('House', 'Add onto any full set you own to add 3M to the rent value. (Except railroads and Utility)', 3);
    card.id = id;
    return card;
}

function makeRent(id, colors) {
    const card = new RentCard('Rent', colors.length > 2 ? 3 : 1, colors);
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

function houseAction(overrides) {
    return Object.assign({
        type: ACTION_TYPES.PLAY_ACTION_CARD,
        playerId: 'p1',
        cardId: 'house-1',
        targetZone: 'action',
        propertyColor: 'Brown'
    }, overrides);
}

describe('House action card — server-authoritative', function () {
    it('adds a House onto a complete set, discards the card and consumes one play', function () {
        const state = baseState();
        state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
        state.players.p1.hand = [makeHouse('house-1')];

        const result = game_manager.applyAction(state, houseAction());

        assert.strictEqual(result.legal, true);
        const next = result.gameState;
        assert.strictEqual(next.players.p1.properties.Brown.hasHouse, true);
        assert.strictEqual(next.players.p1.properties.Brown.hasHotel, false);
        assert.ok(!next.players.p1.hand.some(c => c.id === 'house-1'));
        assert.ok(next.discardPile.some(c => c.id === 'house-1'));
        assert.strictEqual(next.turn.playsMade, 1);

        // Input state is never mutated.
        assert.strictEqual(state.players.p1.properties.Brown.hasHouse, false);
        assert.ok(state.players.p1.hand.some(c => c.id === 'house-1'));
    });

    it('rejects a House on a Railroad set without consuming the card or the play', function () {
        const state = baseState();
        state.players.p1.properties.Railroad = fullSet('p1', 'Railroad', 4);
        state.players.p1.hand = [makeHouse('house-1')];

        const result = game_manager.applyAction(state, houseAction({ propertyColor: 'Railroad' }));

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /Railroad/);
        assert.strictEqual(result.gameState, undefined);
        assert.strictEqual(state.players.p1.properties.Railroad.hasHouse, false);
        assert.ok(state.players.p1.hand.some(c => c.id === 'house-1'));
    });

    it('rejects a House on a Utility set', function () {
        const state = baseState();
        state.players.p1.properties.Utility = fullSet('p1', 'Utility', 2);
        state.players.p1.hand = [makeHouse('house-1')];

        const result = game_manager.applyAction(state, houseAction({ propertyColor: 'Utility' }));

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /Utility/);
    });

    it('rejects a second House on a set that already has one', function () {
        const state = baseState();
        state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
        state.players.p1.properties.Brown.hasHouse = true;
        state.players.p1.hand = [makeHouse('house-1')];

        const result = game_manager.applyAction(state, houseAction());

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /already has a House/);
        assert.ok(state.players.p1.hand.some(c => c.id === 'house-1'));
    });

    it('rejects a House on an incomplete set', function () {
        const state = baseState();
        state.players.p1.properties.Brown = fullSet('p1', 'Brown', 1);
        state.players.p1.hand = [makeHouse('house-1')];

        const result = game_manager.applyAction(state, houseAction());

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /complete Brown set/);
    });

    it('rejects a House on a color the player does not own', function () {
        const state = baseState();
        state.players.p1.hand = [makeHouse('house-1')];

        const result = game_manager.applyAction(state, houseAction({ propertyColor: 'Green' }));

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /complete Green set/);
    });

    it('rejects a House with a missing or unknown property color', function () {
        const state = baseState();
        state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
        state.players.p1.hand = [makeHouse('house-1'), makeHouse('house-2')];

        const missing = game_manager.applyAction(state, houseAction({ propertyColor: undefined }));
        assert.strictEqual(missing.legal, false);
        assert.match(missing.reason, /requires a target property color/);

        const unknown = game_manager.applyAction(state, houseAction({ cardId: 'house-2', propertyColor: 'Rainbow' }));
        assert.strictEqual(unknown.legal, false);
        assert.match(unknown.reason, /Unknown property color/);

        assert.strictEqual(state.turn.playsMade, 0);
    });

    it('boosts rent on the built set by the House bonus', function () {
        const state = baseState(2);
        state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
        state.players.p1.hand = [makeHouse('house-1'), makeRent('rent-1', [PropertyType.Brown, PropertyType.LightBlue])];

        const built = game_manager.applyAction(state, houseAction());
        assert.strictEqual(built.legal, true);

        const rented = game_manager.applyAction(built.gameState, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'rent-1',
            propertyColor: PropertyType.Brown
        });

        assert.strictEqual(rented.legal, true);
        // 2-card Brown tier (2) doubled for the full set (4) + House bonus (3) = 7.
        assert.strictEqual(rented.gameState.pendingCharge.debtors.p2.amountOwed, 7);
    });

    it('leaves the banking-House path unchanged', function () {
        const state = baseState();
        state.players.p1.hand = [makeHouse('house-1')];

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_CARD,
            playerId: 'p1',
            cardId: 'house-1',
            targetZone: 'bank'
        });

        assert.strictEqual(result.legal, true);
        assert.ok(result.gameState.players.p1.bank.some(c => c.id === 'house-1'));
        assert.strictEqual(result.gameState.turn.playsMade, 1);
        assert.deepStrictEqual(Object.keys(result.gameState.players.p1.properties), []);
    });

    describe('room_registry.toClientView — additive buildings projection', function () {
        it('exposes a sparse buildings map for self and opponents', function () {
            const room = room_registry.createRoom('p1', 'Scott');
            room.seats.push({ seatIndex: 1, playerId: 'p2', displayName: 'Riri', connected: true });
            room.gameState = game_manager.createGameState([
                { id: 'p1', name: 'Scott' },
                { id: 'p2', name: 'Riri' }
            ]);
            room.gameState.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
            room.gameState.players.p1.properties.Brown.hasHouse = true;
            room.gameState.players.p1.properties.Green = fullSet('p1', 'Green', 3);
            room.gameState.players.p2.properties.DarkBlue = fullSet('p2', 'DarkBlue', 2);
            room.gameState.players.p2.properties.DarkBlue.hasHotel = true;

            const selfView = room_registry.toClientView(room, 'p1');
            assert.deepStrictEqual(selfView.self.buildings, { Brown: { house: true } });
            assert.deepStrictEqual(selfView.opponents[0].buildings, { DarkBlue: { hotel: true } });

            const oppView = room_registry.toClientView(room, 'p2');
            assert.deepStrictEqual(oppView.self.buildings, { DarkBlue: { hotel: true } });
            assert.deepStrictEqual(oppView.opponents[0].buildings, { Brown: { house: true } });

            // The existing properties wire shape is untouched (arrays keyed by color).
            assert.ok(Array.isArray(selfView.self.properties.Brown));
        });
    });

    describe('PAY_RENT free-building exploit', function () {
        it('clears building state when a property group is emptied by rent payment', function () {
            const state = baseState(2);
            state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2);
            state.players.p1.properties.Brown.hasHouse = true;
            state.players.p1.hand = [];

            // p2 charges p1; p1 pays with both Brown cards, emptying the group.
            state.pendingCharge = {
                type: 'CHARGE',
                sourceTitle: 'Debt Collector',
                fromPlayerId: 'p2',
                targetPlayerId: 'p1',
                debtors: { p1: { amountOwed: 2 } }
            };
            state.turn = Object.assign({}, state.turn, { playerId: 'p2' });

            const paid = game_manager.applyAction(state, {
                type: ACTION_TYPES.PAY_RENT,
                playerId: 'p1',
                paymentCardIds: ['p1-Brown-0', 'p1-Brown-1']
            });

            assert.strictEqual(paid.legal, true);
            // The emptied group — and its stale hasHouse flag — is gone entirely.
            assert.strictEqual(paid.gameState.players.p1.properties.Brown, undefined);

            // A later single Brown card cannot revive a free House.
            const nextTurn = Object.assign({}, paid.gameState.turn, { playerId: 'p1', phase: 'ACTION', playsMade: 0 });
            const revived = Object.assign({}, paid.gameState, { turn: nextTurn });
            const lone = new PropertyCard('Brown lone', 1, 'Brown');
            lone.id = 'brown-lone';
            revived.players.p1.hand = [lone];

            const placed = game_manager.applyAction(revived, {
                type: ACTION_TYPES.PLAY_CARD,
                playerId: 'p1',
                cardId: 'brown-lone',
                targetZone: 'properties',
                propertyColor: 'Brown'
            });

            assert.strictEqual(placed.legal, true);
            assert.strictEqual(placed.gameState.players.p1.properties.Brown.hasHouse, false);
        });
    });
});
