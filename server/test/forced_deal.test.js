'use strict';

const assert = require('assert');

const game_manager = require('../game_manager');
const { ACTION_TYPES } = require('../rules_validator');
const ActionCard = require('../models/ActionCard');
const PropertyCard = require('../models/PropertyCard');
const Wildcard = require('../models/Wildcard');
const MoneyCard = require('../models/MoneyCard');

function makeForcedDeal(id) {
    const card = new ActionCard('Forced Deal', 'Swap any property with another player. (Cannot be part of a full set) Play into center to use.', 3);
    card.id = id;
    return card;
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

function group(cards) {
    return { cards, hasHouse: false, hasHotel: false };
}

function drawToActionPhase(state, playerId) {
    return game_manager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId, count: 2 }).gameState;
}

function baseState() {
    const state = game_manager.createGameState([
        { id: 'p1', name: 'Scott' },
        { id: 'p2', name: 'Riri' }
    ]);
    return drawToActionPhase(state, 'p1');
}

function forcedDealAction(overrides) {
    return Object.assign({
        type: ACTION_TYPES.PLAY_ACTION_CARD,
        playerId: 'p1',
        cardId: 'fd-1',
        targetZone: 'action',
        targetPlayerId: 'p2'
    }, overrides);
}

describe('Forced Deal — end-to-end property swap', function () {
    it('swaps one offered property for one requested property, persisting the source group colors, discarding the card and consuming one play', function () {
        const state = baseState();
        state.players.p1.properties.Purple = group([makeProperty('pu-1', 'St. Charles Place', 2, 'Purple')]);
        state.players.p2.properties.Orange = group([
            makeProperty('or-1', 'St. James Place', 2, 'Orange'),
            makeProperty('or-2', 'Tennessee Avenue', 2, 'Orange')
        ]);
        state.players.p1.hand = [makeForcedDeal('fd-1')];

        const result = game_manager.applyAction(state, forcedDealAction({
            offeredCardId: 'pu-1',
            offeredPropertyColor: 'Purple',
            requestedCardId: 'or-1',
            requestedPropertyColor: 'Orange'
        }));

        assert.strictEqual(result.legal, true);
        const next = result.gameState;

        // Requested card moved to the actor under the requested color.
        assert.deepStrictEqual(next.players.p1.properties.Orange.cards.map(c => c.id), ['or-1']);
        // Offered card moved to the target under the offered color.
        assert.deepStrictEqual(next.players.p2.properties.Purple.cards.map(c => c.id), ['pu-1']);
        // Target keeps the rest of the Orange group.
        assert.deepStrictEqual(next.players.p2.properties.Orange.cards.map(c => c.id), ['or-2']);
        // Actor's emptied Purple source group is cleaned up.
        assert.strictEqual(next.players.p1.properties.Purple, undefined);

        assert.ok(!next.players.p1.hand.some(c => c.id === 'fd-1'));
        assert.ok(next.discardPile.some(c => c.id === 'fd-1'));
        assert.strictEqual(next.turn.playsMade, 1);
        assert.strictEqual(next.pendingCharge, undefined);
    });

    it('keeps a wildcard under its source group color rather than its native color when swapped', function () {
        const state = baseState();
        // Purple/Orange wildcard parked in the actor's Orange group.
        state.players.p1.properties.Orange = group([
            makeWildcard('wc-1', 'Purple & Orange', 2, ['Purple', 'Orange']),
            makeProperty('or-9', 'New York Avenue', 2, 'Orange')
        ]);
        state.players.p2.properties.Red = group([makeProperty('re-1', 'Kentucky Avenue', 3, 'Red')]);
        state.players.p1.hand = [makeForcedDeal('fd-1')];

        const next = game_manager.applyAction(state, forcedDealAction({
            offeredCardId: 'wc-1',
            offeredPropertyColor: 'Orange',
            requestedCardId: 're-1',
            requestedPropertyColor: 'Red'
        })).gameState;

        assert.deepStrictEqual(next.players.p2.properties.Orange.cards.map(c => c.id), ['wc-1']);
        assert.strictEqual(next.players.p2.properties.Purple, undefined);
        assert.deepStrictEqual(next.players.p1.properties.Red.cards.map(c => c.id), ['re-1']);
    });

    it('supports a same-color swap, resolving both removals before adding and cleaning up empty groups', function () {
        const state = baseState();
        state.players.p1.properties.LightBlue = group([makeProperty('lb-1', 'Oriental Avenue', 1, 'LightBlue')]);
        state.players.p2.properties.LightBlue = group([
            makeProperty('lb-2', 'Vermont Avenue', 1, 'LightBlue'),
            makeProperty('lb-3', 'Connecticut Avenue', 1, 'LightBlue')
        ]);
        state.players.p1.hand = [makeForcedDeal('fd-1')];

        const next = game_manager.applyAction(state, forcedDealAction({
            offeredCardId: 'lb-1',
            offeredPropertyColor: 'LightBlue',
            requestedCardId: 'lb-2',
            requestedPropertyColor: 'LightBlue'
        })).gameState;

        // Actor's LightBlue was emptied then re-created holding only the requested card.
        assert.deepStrictEqual(next.players.p1.properties.LightBlue.cards.map(c => c.id), ['lb-2']);
        // Target's LightBlue keeps its remaining card and receives the offered one.
        assert.deepStrictEqual(next.players.p2.properties.LightBlue.cards.map(c => c.id).sort(), ['lb-1', 'lb-3']);
    });

    it('rejects requesting a property from a complete set and leaves the original state untouched', function () {
        const state = baseState();
        state.players.p1.properties.Purple = group([makeProperty('pu-1', 'St. Charles Place', 2, 'Purple')]);
        // DarkBlue complete set size is 2.
        state.players.p2.properties.DarkBlue = group([
            makeProperty('db-1', 'Park Place', 3, 'DarkBlue'),
            makeProperty('db-2', 'Boardwalk', 4, 'DarkBlue')
        ]);
        state.players.p1.hand = [makeForcedDeal('fd-1')];
        const snapshot = JSON.stringify(state);

        const result = game_manager.applyAction(state, forcedDealAction({
            offeredCardId: 'pu-1',
            offeredPropertyColor: 'Purple',
            requestedCardId: 'db-1',
            requestedPropertyColor: 'DarkBlue'
        }));

        assert.strictEqual(result.legal, false);
        assert.ok(/complete set/i.test(result.reason));
        assert.strictEqual(JSON.stringify(state), snapshot, 'original state must not be mutated on rejection');
    });

    it('rejects offering a property from a complete set and leaves the original state untouched', function () {
        const state = baseState();
        state.players.p1.properties.DarkBlue = group([
            makeProperty('db-1', 'Park Place', 3, 'DarkBlue'),
            makeProperty('db-2', 'Boardwalk', 4, 'DarkBlue')
        ]);
        state.players.p2.properties.Orange = group([makeProperty('or-1', 'St. James Place', 2, 'Orange')]);
        state.players.p1.hand = [makeForcedDeal('fd-1')];
        const snapshot = JSON.stringify(state);

        const result = game_manager.applyAction(state, forcedDealAction({
            offeredCardId: 'db-1',
            offeredPropertyColor: 'DarkBlue',
            requestedCardId: 'or-1',
            requestedPropertyColor: 'Orange'
        }));

        assert.strictEqual(result.legal, false);
        assert.ok(/complete set/i.test(result.reason));
        assert.strictEqual(JSON.stringify(state), snapshot, 'original state must not be mutated on rejection');
    });

    it('rejects a requested card that is not in the named group and leaves the original state untouched', function () {
        const state = baseState();
        state.players.p1.properties.Purple = group([makeProperty('pu-1', 'St. Charles Place', 2, 'Purple')]);
        state.players.p2.properties.Orange = group([makeProperty('or-1', 'St. James Place', 2, 'Orange')]);
        state.players.p1.hand = [makeForcedDeal('fd-1')];
        const snapshot = JSON.stringify(state);

        const result = game_manager.applyAction(state, forcedDealAction({
            offeredCardId: 'pu-1',
            offeredPropertyColor: 'Purple',
            requestedCardId: 'does-not-exist',
            requestedPropertyColor: 'Orange'
        }));

        assert.strictEqual(result.legal, false);
        assert.strictEqual(JSON.stringify(state), snapshot, 'original state must not be mutated on rejection');
    });

    it('declares the acting player the winner when the requested card completes their third set', function () {
        const state = baseState();
        state.players.p1.properties.Brown = group([
            makeProperty('br-1', 'Mediterranean Avenue', 1, 'Brown'),
            makeProperty('br-2', 'Baltic Avenue', 1, 'Brown')
        ]);
        state.players.p1.properties.Utility = group([
            makeProperty('ut-1', 'Water Works', 2, 'Utility'),
            makeProperty('ut-2', 'Electric Company', 2, 'Utility')
        ]);
        state.players.p1.properties.LightBlue = group([
            makeProperty('lb-1', 'Oriental Avenue', 1, 'LightBlue'),
            makeProperty('lb-2', 'Vermont Avenue', 1, 'LightBlue')
        ]);
        state.players.p1.properties.Green = group([makeProperty('gr-1', 'Pacific Avenue', 4, 'Green')]);
        state.players.p2.properties.LightBlue = group([
            makeProperty('lb-3', 'Connecticut Avenue', 1, 'LightBlue'),
            makeProperty('lb-4', 'Park Lane', 1, 'LightBlue')
        ]);
        state.players.p1.hand = [makeForcedDeal('fd-1')];

        const result = game_manager.applyAction(state, forcedDealAction({
            offeredCardId: 'gr-1',
            offeredPropertyColor: 'Green',
            requestedCardId: 'lb-3',
            requestedPropertyColor: 'LightBlue'
        }));

        assert.strictEqual(result.legal, true);
        assert.strictEqual(result.isWinner, true);
        assert.strictEqual(result.winnerId, 'p1');
        assert.deepStrictEqual(result.completedSetColors.sort(), ['Brown', 'LightBlue', 'Utility']);
        assert.strictEqual(result.gameState.status, 'FINISHED');
    });

    it('declares the target the winner when the offered card completes the target\'s third set', function () {
        const state = baseState();
        state.players.p2.properties.Brown = group([
            makeProperty('br-1', 'Mediterranean Avenue', 1, 'Brown'),
            makeProperty('br-2', 'Baltic Avenue', 1, 'Brown')
        ]);
        state.players.p2.properties.Utility = group([
            makeProperty('ut-1', 'Water Works', 2, 'Utility'),
            makeProperty('ut-2', 'Electric Company', 2, 'Utility')
        ]);
        state.players.p2.properties.LightBlue = group([
            makeProperty('lb-1', 'Oriental Avenue', 1, 'LightBlue'),
            makeProperty('lb-2', 'Vermont Avenue', 1, 'LightBlue')
        ]);
        state.players.p2.properties.Green = group([makeProperty('gr-2', 'North Carolina Avenue', 4, 'Green')]);
        state.players.p1.properties.LightBlue = group([
            makeProperty('lb-3', 'Connecticut Avenue', 1, 'LightBlue'),
            makeProperty('lb-4', 'Park Lane', 1, 'LightBlue')
        ]);
        state.players.p1.hand = [makeForcedDeal('fd-1')];

        const result = game_manager.applyAction(state, forcedDealAction({
            offeredCardId: 'lb-3',
            offeredPropertyColor: 'LightBlue',
            requestedCardId: 'gr-2',
            requestedPropertyColor: 'Green'
        }));

        assert.strictEqual(result.legal, true);
        assert.strictEqual(result.isWinner, true);
        assert.strictEqual(result.winnerId, 'p2');
        assert.deepStrictEqual(result.completedSetColors.sort(), ['Brown', 'LightBlue', 'Utility']);
        assert.strictEqual(result.gameState.status, 'FINISHED');
    });

    it('leaves the ordinary bank-deposit route working unchanged', function () {
        const state = baseState();
        state.players.p1.hand = [new MoneyCard('3M', 3), makeForcedDeal('fd-1')];
        const moneyId = state.players.p1.hand[0].id;

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_CARD,
            playerId: 'p1',
            cardId: moneyId,
            targetZone: 'bank'
        });

        assert.strictEqual(result.legal, true);
        assert.ok(result.gameState.players.p1.bank.some(c => c.id === moneyId));
        assert.strictEqual(result.gameState.turn.playsMade, 1);
    });

    it('lets a Forced Deal card be banked as cash without triggering the swap', function () {
        const state = baseState();
        state.players.p1.hand = [makeForcedDeal('fd-1')];

        const result = game_manager.applyAction(state, {
            type: ACTION_TYPES.PLAY_CARD,
            playerId: 'p1',
            cardId: 'fd-1',
            targetZone: 'bank'
        });

        assert.strictEqual(result.legal, true);
        assert.ok(result.gameState.players.p1.bank.some(c => c.id === 'fd-1'));
        assert.strictEqual(result.gameState.turn.playsMade, 1);
    });
});
