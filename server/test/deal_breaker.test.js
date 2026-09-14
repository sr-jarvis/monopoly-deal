'use strict';

const assert = require('assert');

const game_manager = require('../game_manager');
const { ACTION_TYPES } = require('../rules_validator');
const ActionCard = require('../models/ActionCard');
const PropertyCard = require('../models/PropertyCard');

function makeDealBreaker(id) {
    const card = new ActionCard('Deal Breaker', 'Steals a complete set of properties from any player. (Includes any buildings) Play into center to use.', 5);
    card.id = id;
    return card;
}

function makeProperty(id, title, value, color) {
    const card = new PropertyCard(title, value, color);
    card.id = id;
    return card;
}

function group(cards, hasHouse = false, hasHotel = false) {
    return { cards, hasHouse, hasHotel };
}

function drawToActionPhase(state, playerId) {
    return game_manager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId, count: 2 }).gameState;
}

function baseState() {
    return drawToActionPhase(game_manager.createGameState([
        { id: 'p1', name: 'Scott' },
        { id: 'p2', name: 'Riri' }
    ]), 'p1');
}

function dealBreakerAction(overrides) {
    return Object.assign({
        type: ACTION_TYPES.PLAY_ACTION_CARD,
        playerId: 'p1',
        cardId: 'db-action',
        targetZone: 'action',
        targetPlayerId: 'p2',
        targetPropertyColor: 'Brown'
    }, overrides);
}

describe('Deal Breaker — complete property-set transfer', function () {
    it('transfers the complete set, discards Deal Breaker, and consumes one play', function () {
        const state = baseState();
        state.players.p1.hand = [makeDealBreaker('db-action')];
        state.players.p2.properties.Brown = group([
            makeProperty('br-1', 'Mediterranean Avenue', 1, 'Brown'),
            makeProperty('br-2', 'Baltic Avenue', 1, 'Brown')
        ]);

        const result = game_manager.applyAction(state, dealBreakerAction());

        assert.strictEqual(result.legal, true);
        assert.deepStrictEqual(result.gameState.players.p1.properties.Brown.cards.map(card => card.id), ['br-1', 'br-2']);
        assert.strictEqual(result.gameState.players.p2.properties.Brown, undefined);
        assert.ok(!result.gameState.players.p1.hand.some(card => card.id === 'db-action'));
        assert.ok(result.gameState.discardPile.some(card => card.id === 'db-action'));
        assert.strictEqual(result.gameState.turn.playsMade, 1);
        assert.strictEqual(result.gameState.pendingCharge, undefined);
    });

    it('preserves House and Hotel flags when moving a complete group', function () {
        const state = baseState();
        state.players.p1.hand = [makeDealBreaker('db-action')];
        state.players.p2.properties.DarkBlue = group([
            makeProperty('blue-1', 'Park Place', 3, 'DarkBlue'),
            makeProperty('blue-2', 'Boardwalk', 4, 'DarkBlue')
        ], true, true);

        const result = game_manager.applyAction(state, dealBreakerAction({ targetPropertyColor: 'DarkBlue' }));

        assert.strictEqual(result.legal, true);
        assert.strictEqual(result.gameState.players.p1.properties.DarkBlue.hasHouse, true);
        assert.strictEqual(result.gameState.players.p1.properties.DarkBlue.hasHotel, true);
    });

    it('merges a same-color source group without losing either building flag', function () {
        const state = baseState();
        state.players.p1.hand = [makeDealBreaker('db-action')];
        state.players.p1.properties.Brown = group([makeProperty('br-own', 'Mediterranean Avenue', 1, 'Brown')], false, true);
        state.players.p2.properties.Brown = group([
            makeProperty('br-1', 'Mediterranean Avenue', 1, 'Brown'),
            makeProperty('br-2', 'Baltic Avenue', 1, 'Brown')
        ], true, false);

        const result = game_manager.applyAction(state, dealBreakerAction());
        const merged = result.gameState.players.p1.properties.Brown;

        assert.strictEqual(result.legal, true);
        assert.deepStrictEqual(merged.cards.map(card => card.id), ['br-own', 'br-1', 'br-2']);
        assert.strictEqual(merged.hasHouse, true);
        assert.strictEqual(merged.hasHotel, true);
    });

    it('rejects incomplete targets without mutating the original state', function () {
        const state = baseState();
        state.players.p1.hand = [makeDealBreaker('db-action')];
        state.players.p2.properties.Brown = group([makeProperty('br-1', 'Mediterranean Avenue', 1, 'Brown')]);
        const snapshot = JSON.stringify(state);

        const result = game_manager.applyAction(state, dealBreakerAction());

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /complete property set/i);
        assert.strictEqual(JSON.stringify(state), snapshot);
    });

    it('rejects missing, self, and unknown targets without mutating the original state', function () {
        [
            { targetPlayerId: undefined, targetPropertyColor: 'Brown', reason: /targetPlayerId is required/i },
            { targetPlayerId: 'p1', targetPropertyColor: 'Brown', reason: /Cannot target self/i },
            { targetPlayerId: 'missing', targetPropertyColor: 'Brown', reason: /does not exist/i },
            { targetPlayerId: 'p2', targetPropertyColor: undefined, reason: /targetPropertyColor is required/i }
        ].forEach((overrides) => {
            const state = baseState();
            state.players.p1.hand = [makeDealBreaker('db-action')];
            state.players.p2.properties.Brown = group([
                makeProperty('br-1', 'Mediterranean Avenue', 1, 'Brown'),
                makeProperty('br-2', 'Baltic Avenue', 1, 'Brown')
            ]);
            const snapshot = JSON.stringify(state);

            const result = game_manager.applyAction(state, dealBreakerAction(overrides));
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, overrides.reason);
            assert.strictEqual(JSON.stringify(state), snapshot);
        });
    });

    it('declares the actor the winner when the stolen group is a third complete set', function () {
        const state = baseState();
        state.players.p1.hand = [makeDealBreaker('db-action')];
        state.players.p1.properties.Brown = group([
            makeProperty('own-br-1', 'Mediterranean Avenue', 1, 'Brown'),
            makeProperty('own-br-2', 'Baltic Avenue', 1, 'Brown')
        ]);
        state.players.p1.properties.Utility = group([
            makeProperty('ut-1', 'Water Works', 2, 'Utility'),
            makeProperty('ut-2', 'Electric Company', 2, 'Utility')
        ]);
        state.players.p2.properties.DarkBlue = group([
            makeProperty('blue-1', 'Park Place', 3, 'DarkBlue'),
            makeProperty('blue-2', 'Boardwalk', 4, 'DarkBlue')
        ]);

        const result = game_manager.applyAction(state, dealBreakerAction({ targetPropertyColor: 'DarkBlue' }));

        assert.strictEqual(result.legal, true);
        assert.strictEqual(result.isWinner, true);
        assert.strictEqual(result.winnerId, 'p1');
        assert.deepStrictEqual(result.completedSetColors.sort(), ['Brown', 'DarkBlue', 'Utility']);
        assert.strictEqual(result.gameState.status, 'FINISHED');
    });

    it('enforces the action-play limit before attempting a transfer', function () {
        const state = baseState();
        state.turn.playsMade = 3;
        state.players.p1.hand = [makeDealBreaker('db-action')];
        state.players.p2.properties.Brown = group([
            makeProperty('br-1', 'Mediterranean Avenue', 1, 'Brown'),
            makeProperty('br-2', 'Baltic Avenue', 1, 'Brown')
        ]);

        const result = game_manager.applyAction(state, dealBreakerAction());

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /play limit of 3 cards/i);
    });

    it('keeps the ordinary bank-deposit route available without attempting a transfer', function () {
        const state = baseState();
        state.players.p1.hand = [makeDealBreaker('db-action')];
        state.players.p2.properties.Brown = group([
            makeProperty('br-1', 'Mediterranean Avenue', 1, 'Brown'),
            makeProperty('br-2', 'Baltic Avenue', 1, 'Brown')
        ]);

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_CARD,
            playerId: 'p1',
            cardId: 'db-action',
            targetZone: 'bank'
        });

        assert.strictEqual(result.legal, true);
        assert.strictEqual(result.gameState.players.p1.bank.some(card => card.id === 'db-action'), true);
        assert.strictEqual(result.gameState.players.p2.properties.Brown.cards.length, 2);
        assert.strictEqual(result.gameState.discardPile.some(card => card.id === 'db-action'), false);
    });
});
