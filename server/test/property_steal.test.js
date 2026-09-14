'use strict';

const assert = require('assert');

const game_manager = require('../game_manager');
const { ACTION_TYPES } = require('../rules_validator');
const ActionCard = require('../models/ActionCard');
const PropertyCard = require('../models/PropertyCard');
const MoneyCard = require('../models/MoneyCard');

function makeSlyDeal(id) {
    const card = new ActionCard('Sly Deal', 'Steal a property from the player of your choice. (Cannot be part of a full set) Play into center to use.', 3);
    card.id = id;
    return card;
}

function makeProperty(id, title, value, color) {
    const card = new PropertyCard(title, value, color);
    card.id = id;
    return card;
}

function drawToActionPhase(state, playerId) {
    return game_manager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId, count: 2 }).gameState;
}

function baseState() {
    let state = game_manager.createGameState([
        { id: 'p1', name: 'Scott' },
        { id: 'p2', name: 'Riri' }
    ]);
    return drawToActionPhase(state, 'p1');
}

describe('Sly Deal — property steal', function() {
    it('transfers the targeted card, removes it from the source group, discards the Sly Deal card, and counts a play', function() {
        let state = baseState();
        const stolen = makeProperty('lb-1', 'Oriental Avenue', 1, 'LightBlue');
        state.players.p2.properties.LightBlue = { cards: [stolen], hasHouse: false, hasHotel: false };
        state.players.p1.hand = [makeSlyDeal('sly-1')];

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'sly-1',
            targetZone: 'action',
            targetPlayerId: 'p2',
            targetPropertyColor: 'LightBlue',
            targetCardId: 'lb-1'
        });

        assert.strictEqual(result.legal, true);
        const next = result.gameState;

        assert.strictEqual(next.players.p1.properties.LightBlue.cards.length, 1);
        assert.strictEqual(next.players.p1.properties.LightBlue.cards[0].id, 'lb-1');
        assert.strictEqual(next.players.p2.properties.LightBlue, undefined);

        assert.ok(!next.players.p1.hand.some(c => c.id === 'sly-1'));
        assert.ok(next.discardPile.some(c => c.id === 'sly-1'));

        assert.strictEqual(next.turn.playsMade, 1);
        assert.strictEqual(next.pendingCharge, undefined);
    });

    it('leaves a non-empty source group in place when the target owns other cards of that color', function() {
        let state = baseState();
        const stolen = makeProperty('lb-1', 'Oriental Avenue', 1, 'LightBlue');
        const remaining = makeProperty('lb-2', 'Vermont Avenue', 1, 'LightBlue');
        state.players.p2.properties.LightBlue = { cards: [stolen, remaining], hasHouse: false, hasHotel: false };
        state.players.p1.hand = [makeSlyDeal('sly-1')];

        const next = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'sly-1',
            targetZone: 'action',
            targetPlayerId: 'p2',
            targetPropertyColor: 'LightBlue',
            targetCardId: 'lb-1'
        }).gameState;

        assert.strictEqual(next.players.p2.properties.LightBlue.cards.length, 1);
        assert.strictEqual(next.players.p2.properties.LightBlue.cards[0].id, 'lb-2');
        assert.strictEqual(next.players.p1.properties.LightBlue.cards[0].id, 'lb-1');
    });

    it('rejects stealing from a complete property set and leaves the original state untouched', function() {
        let state = baseState();
        // DarkBlue's complete set size is 2.
        state.players.p2.properties.DarkBlue = {
            cards: [makeProperty('db-1', 'Park Place', 3, 'DarkBlue'), makeProperty('db-2', 'Boardwalk', 4, 'DarkBlue')],
            hasHouse: false,
            hasHotel: false
        };
        state.players.p1.hand = [makeSlyDeal('sly-1')];
        const snapshot = JSON.stringify(state);

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'sly-1',
            targetZone: 'action',
            targetPlayerId: 'p2',
            targetPropertyColor: 'DarkBlue',
            targetCardId: 'db-1'
        });

        assert.strictEqual(result.legal, false);
        assert.ok(/complete property set/i.test(result.reason));
        assert.strictEqual(JSON.stringify(state), snapshot, 'original state must not be mutated on rejection');
    });

    it('rejects a targetCardId that is not actually in the named property group and leaves the original state untouched', function() {
        let state = baseState();
        state.players.p2.properties.LightBlue = {
            cards: [makeProperty('lb-1', 'Oriental Avenue', 1, 'LightBlue')],
            hasHouse: false,
            hasHotel: false
        };
        state.players.p1.hand = [makeSlyDeal('sly-1')];
        const snapshot = JSON.stringify(state);

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'sly-1',
            targetZone: 'action',
            targetPlayerId: 'p2',
            targetPropertyColor: 'LightBlue',
            targetCardId: 'does-not-exist'
        });

        assert.strictEqual(result.legal, false);
        assert.ok(/not in p2's LightBlue property set/i.test(result.reason));
        assert.strictEqual(JSON.stringify(state), snapshot, 'original state must not be mutated on rejection');
    });

    it('completes a winning third set when the stolen card fills the last gap', function() {
        let state = baseState();
        state.players.p1.properties.Brown = {
            cards: [makeProperty('br-1', 'Mediterranean Avenue', 1, 'Brown'), makeProperty('br-2', 'Baltic Avenue', 1, 'Brown')],
            hasHouse: false,
            hasHotel: false
        };
        state.players.p1.properties.Utility = {
            cards: [makeProperty('ut-1', 'Water Works', 2, 'Utility'), makeProperty('ut-2', 'Electric Company', 2, 'Utility')],
            hasHouse: false,
            hasHotel: false
        };
        state.players.p1.properties.LightBlue = {
            cards: [makeProperty('lb-2', 'Vermont Avenue', 1, 'LightBlue'), makeProperty('lb-3', 'Connecticut Avenue', 1, 'LightBlue')],
            hasHouse: false,
            hasHotel: false
        };
        state.players.p2.properties.LightBlue = {
            cards: [makeProperty('lb-1', 'Oriental Avenue', 1, 'LightBlue')],
            hasHouse: false,
            hasHotel: false
        };
        state.players.p1.hand = [makeSlyDeal('sly-1')];

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'sly-1',
            targetZone: 'action',
            targetPlayerId: 'p2',
            targetPropertyColor: 'LightBlue',
            targetCardId: 'lb-1'
        });

        assert.strictEqual(result.legal, true);
        assert.strictEqual(result.isWinner, true);
        assert.strictEqual(result.winnerId, 'p1');
        assert.deepStrictEqual(result.completedSetColors.sort(), ['Brown', 'LightBlue', 'Utility']);
        assert.strictEqual(result.gameState.status, 'FINISHED');
    });

    it('leaves the ordinary bank-deposit route working unchanged', function() {
        let state = baseState();
        state.players.p1.hand = [new MoneyCard('3M', 3)];
        const cardId = state.players.p1.hand[0].id;

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_CARD,
            playerId: 'p1',
            cardId,
            targetZone: 'bank'
        });

        assert.strictEqual(result.legal, true);
        assert.ok(result.gameState.players.p1.bank.some(c => c.id === cardId));
        assert.strictEqual(result.gameState.turn.playsMade, 1);
    });
});
