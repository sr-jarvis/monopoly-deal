'use strict';

const assert = require('assert');

const game_manager = require('../game_manager');
const room_registry = require('../room_registry');
const { ACTION_TYPES } = require('../rules_validator');
const PropertyCard = require('../models/PropertyCard');
const Wildcard = require('../models/Wildcard');
const ActionCard = require('../models/ActionCard');

function drawToActionPhase(state, playerId) {
    return game_manager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId, count: 2 }).gameState;
}

function makeProperty(id, title, value, color) {
    const card = new PropertyCard(title, value, color);
    card.id = id;
    return card;
}

function makeWildcard(id, title, value, colors) {
    const card = new Wildcard(title, value, colors);
    card.id = id;
    return card;
}

describe('Property placement client contract', function() {
    it('stamps server cards with additive kind/color metadata for client routing', function() {
        const property = makeProperty('park-place', 'Park Place', 4, 'DarkBlue');
        const wildcard = makeWildcard('wild-db-green', 'Dark Blue & Green', 4, ['DarkBlue', 'Green']);
        const action = new ActionCard('Debt Collector', 'Force any player to pay you 5M.', 3);

        assert.strictEqual(property.kind, 'PROPERTY');
        assert.strictEqual(property.type, 'DarkBlue');
        assert.strictEqual(property.color, 'DarkBlue');
        assert.strictEqual(wildcard.kind, 'WILDCARD');
        assert.deepStrictEqual(wildcard.colors, ['DarkBlue', 'Green']);
        assert.strictEqual(action.kind, 'ACTION');
    });

    it('places a property card into a server-canonical color group and consumes one action', function() {
        let state = game_manager.createGameState([
            { id: 'p1', name: 'Scott' },
            { id: 'p2', name: 'Riri' }
        ]);
        state = drawToActionPhase(state, 'p1');
        state.players.p1.hand = [makeProperty('park-place', 'Park Place', 4, 'DarkBlue')];

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_CARD,
            playerId: 'p1',
            cardId: 'park-place',
            targetZone: 'properties',
            propertyColor: 'DarkBlue'
        });

        assert.strictEqual(result.legal, true);
        const next = result.gameState;
        assert.strictEqual(next.players.p1.hand.length, 0);
        assert.strictEqual(next.players.p1.properties.DarkBlue.cards.length, 1);
        assert.strictEqual(next.players.p1.properties.DarkBlue.cards[0].id, 'park-place');
        assert.strictEqual(next.turn.playsMade, 1);
    });

    it('rejects unknown property colors instead of creating phantom groups', function() {
        let state = game_manager.createGameState([
            { id: 'p1', name: 'Scott' },
            { id: 'p2', name: 'Riri' }
        ]);
        state = drawToActionPhase(state, 'p1');
        state.players.p1.hand = [makeProperty('park-place', 'Park Place', 4, 'DarkBlue')];

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_CARD,
            playerId: 'p1',
            cardId: 'park-place',
            targetZone: 'properties',
            propertyColor: 'DARK_BLUE'
        });

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /Unknown property color/);
        assert.strictEqual(state.players.p1.properties.DARK_BLUE, undefined);
    });

    it('limits wildcard placement to the colors printed on the card', function() {
        let state = game_manager.createGameState([
            { id: 'p1', name: 'Scott' },
            { id: 'p2', name: 'Riri' }
        ]);
        state = drawToActionPhase(state, 'p1');
        state.players.p1.hand = [makeWildcard('wild-db-green', 'Dark Blue & Green', 4, ['DarkBlue', 'Green'])];

        const rejected = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_CARD,
            playerId: 'p1',
            cardId: 'wild-db-green',
            targetZone: 'properties',
            propertyColor: 'Red'
        });
        assert.strictEqual(rejected.legal, false);
        assert.match(rejected.reason, /cannot be placed/);

        const accepted = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_CARD,
            playerId: 'p1',
            cardId: 'wild-db-green',
            targetZone: 'properties',
            propertyColor: 'Green'
        });
        assert.strictEqual(accepted.legal, true);
        assert.strictEqual(accepted.gameState.players.p1.properties.Green.cards[0].id, 'wild-db-green');
    });

    it('flattens property groups and completed-set colors in room client views', function() {
        const room = room_registry.createRoom('p1', 'Scott');
        room.seats.push({ seatIndex: 1, playerId: 'p2', displayName: 'Riri', connected: true });
        room.status = 'IN_PROGRESS';
        room.gameState = game_manager.createGameState([
            { id: 'p1', name: 'Scott' },
            { id: 'p2', name: 'Riri' }
        ]);
        room.gameState.players.p1.properties = {
            DarkBlue: {
                cards: [
                    makeProperty('park-place', 'Park Place', 4, 'DarkBlue'),
                    makeProperty('boardwalk', 'Boardwalk', 4, 'DarkBlue')
                ],
                hasHouse: false,
                hasHotel: false
            }
        };
        room.gameState.players.p2.properties = {
            Brown: {
                cards: [
                    makeProperty('mediterranean', 'Mediterranean Avenue', 1, 'Brown'),
                    makeProperty('baltic', 'Baltic Avenue', 1, 'Brown')
                ],
                hasHouse: false,
                hasHotel: false
            }
        };

        const view = room_registry.toClientView(room, 'p1');

        assert.ok(Array.isArray(view.self.properties.DarkBlue));
        assert.strictEqual(view.self.properties.DarkBlue.length, 2);
        assert.deepStrictEqual(view.self.completedSetColors, ['DarkBlue']);
        assert.ok(Array.isArray(view.opponents[0].properties.Brown));
        assert.strictEqual(view.opponents[0].properties.Brown.length, 2);
        assert.deepStrictEqual(view.opponents[0].completedSetColors, ['Brown']);
    });

    it('transfers a selected property payment to the charging player board', function() {
        let state = game_manager.createGameState([
            { id: 'p1', name: 'Scott' },
            { id: 'p2', name: 'Riri' }
        ]);
        state = drawToActionPhase(state, 'p1');
        const debt = new ActionCard('Debt Collector', 'Force any player to pay you 5M.', 3);
        debt.id = 'debt-1';
        state.players.p1.hand = [debt];
        state = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'debt-1',
            targetZone: 'action',
            targetPlayerId: 'p2'
        }).gameState;
        state.players.p2.properties = {
            DarkBlue: {
                cards: [makeProperty('park-place', 'Park Place', 4, 'DarkBlue')],
                hasHouse: false,
                hasHotel: false
            }
        };

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PAY_RENT,
            playerId: 'p2',
            paymentCardIds: ['park-place']
        });

        assert.strictEqual(result.legal, true);
        // Paying away the last card of a group removes the (now empty) group
        // entirely, along with any building state, so it can't later be revived.
        assert.strictEqual(result.gameState.players.p2.properties.DarkBlue, undefined);
        assert.strictEqual(result.gameState.players.p1.properties.DarkBlue.cards[0].id, 'park-place');
    });
});
