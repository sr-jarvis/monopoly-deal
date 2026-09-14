'use strict';

const assert = require('assert');
const game_manager = require('../game_manager');
const room_registry = require('../room_registry');
const { ACTION_TYPES } = require('../rules_validator');
const RentCard = require('../models/RentCard');
const PropertyCard = require('../models/PropertyCard');
const PropertyType = require('../models/PropertyType');

function drawToActionPhase(state, playerId) {
    return game_manager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId, count: 2 }).gameState;
}

function makeRent(id, colors) {
    const card = new RentCard('Rent', colors.length > 2 ? 3 : 1, colors);
    card.id = id;
    return card;
}

function addProperties(state, playerId, color, count) {
    state.players[playerId].properties[color] = { cards: [], hasHouse: false, hasHotel: false };
    for (let index = 0; index < count; index += 1) {
        const card = new PropertyCard(`${color} ${index}`, 1, color);
        card.id = `${playerId}-${color}-${index}`;
        state.players[playerId].properties[color].cards.push(card);
    }
}

function makeState(playerCount) {
    const players = Array.from({ length: playerCount }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}` }));
    return drawToActionPhase(game_manager.createGameState(players), 'p1');
}

describe('Rent resolution', function () {
    it('charges every opponent for a standard two-color Rent card', function () {
        const state = makeState(3);
        addProperties(state, 'p1', PropertyType.LightBlue, 2);
        state.players.p1.hand.push(makeRent('rent-standard', [PropertyType.LightBlue, PropertyType.Brown]));

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'rent-standard',
            propertyColor: PropertyType.LightBlue
        });

        assert.strictEqual(result.legal, true);
        assert.strictEqual(result.gameState.pendingCharge.type, 'RENT');
        assert.strictEqual(result.gameState.pendingCharge.rentColor, PropertyType.LightBlue);
        assert.deepStrictEqual(Object.keys(result.gameState.pendingCharge.debtors).sort(), ['p2', 'p3']);
        assert.strictEqual(result.gameState.pendingCharge.debtors.p2.amountOwed, 2);
        assert.strictEqual(result.gameState.turn.playsMade, 1);
    });

    it('charges only the selected opponent for all-color Rent', function () {
        const state = makeState(3);
        addProperties(state, 'p1', PropertyType.Green, 1);
        state.players.p1.hand.push(makeRent('rent-wild', Object.values(PropertyType)));

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'rent-wild',
            propertyColor: PropertyType.Green,
            targetPlayerId: 'p3'
        });

        assert.strictEqual(result.legal, true);
        assert.deepStrictEqual(Object.keys(result.gameState.pendingCharge.debtors), ['p3']);
    });

    it('rejects uncovered or unowned colors without consuming the card or play', function () {
        const state = makeState(2);
        addProperties(state, 'p1', PropertyType.LightBlue, 1);
        state.players.p1.hand.push(makeRent('rent-invalid', [PropertyType.LightBlue, PropertyType.Brown]));

        const uncovered = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'rent-invalid',
            propertyColor: PropertyType.Green
        });
        assert.strictEqual(uncovered.legal, false);
        assert.match(uncovered.reason, /does not cover/);
        assert.ok(state.players.p1.hand.some(card => card.id === 'rent-invalid'));
        assert.strictEqual(state.turn.playsMade, 0);

        const unowned = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'rent-invalid',
            propertyColor: PropertyType.Brown
        });
        assert.strictEqual(unowned.legal, false);
        assert.match(unowned.reason, /own no Brown properties/);
    });

    it('uses the existing complete-set multiplier and projects the rent pending resolution', function () {
        const state = makeState(2);
        addProperties(state, 'p1', PropertyType.DarkBlue, 2);
        state.players.p1.hand.push(makeRent('rent-complete', [PropertyType.DarkBlue, PropertyType.Green]));
        const next = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'rent-complete',
            propertyColor: PropertyType.DarkBlue
        }).gameState;
        assert.strictEqual(next.pendingCharge.debtors.p2.amountOwed, 16);

        const room = room_registry.createRoom('p1', 'P1');
        room.seats.push({ seatIndex: 1, playerId: 'p2', displayName: 'P2', connected: true });
        room.gameState = next;
        const view = room_registry.toClientView(room, 'p2');
        assert.strictEqual(view.pendingResolution.type, 'RENT');
        assert.strictEqual(view.pendingResolution.rentColor, PropertyType.DarkBlue);
    });
});
