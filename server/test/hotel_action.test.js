'use strict';

const assert = require('assert');

const game_manager = require('../game_manager');
const room_registry = require('../room_registry');
const { ACTION_TYPES } = require('../rules_validator');
const ActionCard = require('../models/ActionCard');
const PropertyCard = require('../models/PropertyCard');
const RentCard = require('../models/RentCard');
const PropertyType = require('../models/PropertyType');

function makeHotel(id) {
    const card = new ActionCard('Hotel', 'Add onto any full set you own to add 4M to the rent value. (Except railroads and Utility)', 4);
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

/** A complete Brown set that already carries a House — the Hotel prerequisite. */
function housedBrownSet() {
    const g = fullSet('p1', 'Brown', 2);
    g.hasHouse = true;
    return g;
}

function hotelAction(overrides) {
    return Object.assign({
        type: ACTION_TYPES.PLAY_ACTION_CARD,
        playerId: 'p1',
        cardId: 'hotel-1',
        targetZone: 'action',
        propertyColor: 'Brown'
    }, overrides);
}

describe('Hotel action card — server-authoritative', function () {
    it('adds a Hotel onto a complete housed set, discards the card and consumes one play', function () {
        const state = baseState();
        state.players.p1.properties.Brown = housedBrownSet();
        state.players.p1.hand = [makeHotel('hotel-1')];

        const result = game_manager.applyAction(state, hotelAction());

        assert.strictEqual(result.legal, true);
        const next = result.gameState;
        assert.strictEqual(next.players.p1.properties.Brown.hasHotel, true);
        assert.strictEqual(next.players.p1.properties.Brown.hasHouse, true);
        assert.ok(!next.players.p1.hand.some(c => c.id === 'hotel-1'));
        assert.ok(next.discardPile.some(c => c.id === 'hotel-1'));
        assert.strictEqual(next.turn.playsMade, 1);

        // Input state is never mutated.
        assert.strictEqual(state.players.p1.properties.Brown.hasHotel, false);
        assert.ok(state.players.p1.hand.some(c => c.id === 'hotel-1'));
    });

    it('rejects a Hotel on a complete set that has no House, without consuming the card or the play', function () {
        const state = baseState();
        state.players.p1.properties.Brown = fullSet('p1', 'Brown', 2); // complete, but no House
        state.players.p1.hand = [makeHotel('hotel-1')];

        const result = game_manager.applyAction(state, hotelAction());

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /needs a House/);
        assert.strictEqual(result.gameState, undefined);
        assert.strictEqual(state.players.p1.properties.Brown.hasHotel, false);
        assert.ok(state.players.p1.hand.some(c => c.id === 'hotel-1'));
        assert.strictEqual(state.turn.playsMade, 0);
    });

    it('rejects a second Hotel on a set that already has one', function () {
        const state = baseState();
        state.players.p1.properties.Brown = housedBrownSet();
        state.players.p1.properties.Brown.hasHotel = true;
        state.players.p1.hand = [makeHotel('hotel-1')];

        const result = game_manager.applyAction(state, hotelAction());

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /already has a Hotel/);
        assert.ok(state.players.p1.hand.some(c => c.id === 'hotel-1'));
    });

    it('rejects a Hotel on an incomplete set (even if flagged with a House)', function () {
        const state = baseState();
        const g = fullSet('p1', 'Brown', 1);
        g.hasHouse = true;
        state.players.p1.properties.Brown = g;
        state.players.p1.hand = [makeHotel('hotel-1')];

        const result = game_manager.applyAction(state, hotelAction());

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /complete Brown set/);
    });

    it('rejects a Hotel on a Railroad set', function () {
        const state = baseState();
        const g = fullSet('p1', 'Railroad', 4);
        g.hasHouse = true;
        state.players.p1.properties.Railroad = g;
        state.players.p1.hand = [makeHotel('hotel-1')];

        const result = game_manager.applyAction(state, hotelAction({ propertyColor: 'Railroad' }));

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /Railroad/);
        assert.strictEqual(result.gameState, undefined);
    });

    it('rejects a Hotel on a Utility set', function () {
        const state = baseState();
        const g = fullSet('p1', 'Utility', 2);
        g.hasHouse = true;
        state.players.p1.properties.Utility = g;
        state.players.p1.hand = [makeHotel('hotel-1')];

        const result = game_manager.applyAction(state, hotelAction({ propertyColor: 'Utility' }));

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /Utility/);
    });

    it('rejects a Hotel with a missing or unknown property color', function () {
        const state = baseState();
        state.players.p1.properties.Brown = housedBrownSet();
        state.players.p1.hand = [makeHotel('hotel-1'), makeHotel('hotel-2')];

        const missing = game_manager.applyAction(state, hotelAction({ propertyColor: undefined }));
        assert.strictEqual(missing.legal, false);
        assert.match(missing.reason, /requires a target property color/);

        const unknown = game_manager.applyAction(state, hotelAction({ cardId: 'hotel-2', propertyColor: 'Rainbow' }));
        assert.strictEqual(unknown.legal, false);
        assert.match(unknown.reason, /Unknown property color/);

        assert.strictEqual(state.turn.playsMade, 0);
    });

    it('rejects a Hotel on a color the player does not own', function () {
        const state = baseState();
        state.players.p1.hand = [makeHotel('hotel-1')];

        const result = game_manager.applyAction(state, hotelAction({ propertyColor: 'Green' }));

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /complete Green set/);
    });

    it('boosts rent on the built set by the House + Hotel bonuses ($11M Brown)', function () {
        const state = baseState(2);
        state.players.p1.properties.Brown = housedBrownSet();
        state.players.p1.hand = [makeHotel('hotel-1'), makeRent('rent-1', [PropertyType.Brown, PropertyType.LightBlue])];

        const built = game_manager.applyAction(state, hotelAction());
        assert.strictEqual(built.legal, true);

        const rented = game_manager.applyAction(built.gameState, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'rent-1',
            propertyColor: PropertyType.Brown
        });

        assert.strictEqual(rented.legal, true);
        // 2-card Brown tier (2) doubled for the full set (4) + House (3) + Hotel (4) = 11.
        assert.strictEqual(rented.gameState.pendingCharge.debtors.p2.amountOwed, 11);
    });

    it('leaves the banking-Hotel path unchanged ($4M cash, no building)', function () {
        const state = baseState();
        state.players.p1.hand = [makeHotel('hotel-1')];

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_CARD,
            playerId: 'p1',
            cardId: 'hotel-1',
            targetZone: 'bank'
        });

        assert.strictEqual(result.legal, true);
        const banked = result.gameState.players.p1.bank.find(c => c.id === 'hotel-1');
        assert.ok(banked);
        assert.strictEqual(banked.value, 4);
        assert.strictEqual(result.gameState.turn.playsMade, 1);
        assert.deepStrictEqual(Object.keys(result.gameState.players.p1.properties), []);
    });

    it('does not let a Hotel finish the game (win counts cards, not buildings)', function () {
        const state = baseState(2);
        state.players.p1.properties.Brown = housedBrownSet();
        state.players.p1.properties.Green = fullSet('p1', 'Green', 3);
        state.players.p1.hand = [makeHotel('hotel-1')];

        const result = game_manager.applyAction(state, hotelAction());

        assert.strictEqual(result.legal, true);
        assert.notStrictEqual(result.gameState.status, 'FINISHED');
        assert.ok(!result.gameState.winnerId);
    });

    it('keeps the hasHotel ⇒ hasHouse invariant across a Deal Breaker merge', function () {
        const state = baseState(2);
        const built = fullSet('p1', 'Green', 3);
        built.hasHouse = true;
        built.hasHotel = true;
        state.players.p1.properties.Green = built;
        state.players.p2.properties.Green = fullSet('p2', 'Green', 3); // plain complete set
        state.players.p1.hand = [new ActionCard('Deal Breaker', 'Steals a complete set.', 5)];
        state.players.p1.hand[0].id = 'db-1';

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'db-1',
            targetZone: 'action',
            targetPlayerId: 'p2',
            targetPropertyColor: 'Green'
        });

        assert.strictEqual(result.legal, true);
        const merged = result.gameState.players.p1.properties.Green;
        assert.strictEqual(merged.hasHotel, true);
        assert.strictEqual(merged.hasHouse, true);
        assert.ok(!merged.hasHotel || merged.hasHouse); // invariant: hotel implies house
    });

    it('clears both building flags when a Hotel-built group is emptied by rent payment', function () {
        const state = baseState(2);
        const g = fullSet('p1', 'Brown', 2);
        g.hasHouse = true;
        g.hasHotel = true;
        state.players.p1.properties.Brown = g;
        state.players.p1.hand = [];

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
        assert.strictEqual(paid.gameState.players.p1.properties.Brown, undefined);
    });

    describe('room_registry.toClientView — buildings projection with a Hotel', function () {
        it('projects { house, hotel } for self and opponents', function () {
            const room = room_registry.createRoom('p1', 'Scott');
            room.seats.push({ seatIndex: 1, playerId: 'p2', displayName: 'Riri', connected: true });
            room.gameState = game_manager.createGameState([
                { id: 'p1', name: 'Scott' },
                { id: 'p2', name: 'Riri' }
            ]);
            const g = fullSet('p1', 'Brown', 2);
            g.hasHouse = true;
            g.hasHotel = true;
            room.gameState.players.p1.properties.Brown = g;
            const g2 = fullSet('p2', 'DarkBlue', 2);
            g2.hasHouse = true;
            g2.hasHotel = true;
            room.gameState.players.p2.properties.DarkBlue = g2;

            const selfView = room_registry.toClientView(room, 'p1');
            assert.deepStrictEqual(selfView.self.buildings, { Brown: { house: true, hotel: true } });
            assert.deepStrictEqual(selfView.opponents[0].buildings, { DarkBlue: { house: true, hotel: true } });

            const oppView = room_registry.toClientView(room, 'p2');
            assert.deepStrictEqual(oppView.self.buildings, { DarkBlue: { house: true, hotel: true } });
            assert.deepStrictEqual(oppView.opponents[0].buildings, { Brown: { house: true, hotel: true } });

            // The existing properties wire shape is untouched (arrays keyed by color).
            assert.ok(Array.isArray(selfView.self.properties.Brown));
        });
    });
});
