'use strict';

const assert = require('assert');

const game_manager = require('../game_manager');
const app = require('../app');
const { ACTION_TYPES } = require('../rules_validator');
const PropertyCard = require('../models/PropertyCard');
const Wildcard = require('../models/Wildcard');

function makeWildcard(id, colors, value) {
    const card = new Wildcard('Property Wild Card', value === undefined ? 4 : value, colors);
    card.id = id;
    return card;
}

function makeProperty(id, color) {
    const card = new PropertyCard(`${color} prop`, 1, color);
    card.id = id;
    return card;
}

function group(cards, flags) {
    return Object.assign({ cards, hasHouse: false, hasHotel: false }, flags || {});
}

function drawToActionPhase(state, playerId) {
    return game_manager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId, count: 2 }).gameState;
}

function baseState(playerCount) {
    const players = Array.from({ length: playerCount || 2 }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
    return game_manager.createGameState(players);
}

function actionPhaseState(playerCount) {
    return drawToActionPhase(baseState(playerCount), 'p1');
}

function rearrange(overrides) {
    return Object.assign({
        type: ACTION_TYPES.REARRANGE,
        playerId: 'p1',
        cardId: 'wild-1',
        propertyColor: 'DarkBlue'
    }, overrides);
}

describe('Wildcard Rearrange — server-authoritative REARRANGE branch', function () {
    it('moves a placed wildcard to another allowed color it does not already sit on', function () {
        const state = actionPhaseState();
        state.players.p1.hand = [];
        state.players.p1.properties.Green = group([
            makeProperty('g-1', 'Green'),
            makeWildcard('wild-1', ['DarkBlue', 'Green'])
        ]);

        const result = game_manager.applyAction(state, rearrange());

        assert.strictEqual(result.legal, true);
        const next = result.gameState;
        assert.deepStrictEqual(next.players.p1.properties.Green.cards.map(c => c.id), ['g-1']);
        assert.deepStrictEqual(next.players.p1.properties.DarkBlue.cards.map(c => c.id), ['wild-1']);
    });

    it('deletes the emptied source group and creates the destination group', function () {
        const state = actionPhaseState();
        state.players.p1.hand = [];
        state.players.p1.properties.Green = group([makeWildcard('wild-1', ['DarkBlue', 'Green'])]);

        const result = game_manager.applyAction(state, rearrange());

        assert.strictEqual(result.legal, true);
        const next = result.gameState;
        assert.strictEqual(next.players.p1.properties.Green, undefined);
        assert.ok(next.players.p1.properties.DarkBlue);
        assert.deepStrictEqual(next.players.p1.properties.DarkBlue.cards.map(c => c.id), ['wild-1']);
    });

    it('merges into an existing destination group and preserves building flags on untouched groups', function () {
        const state = actionPhaseState();
        state.players.p1.hand = [];
        state.players.p1.properties.Green = group([makeWildcard('wild-1', ['DarkBlue', 'Green'])]);
        state.players.p1.properties.DarkBlue = group([makeProperty('db-1', 'DarkBlue')], { hasHouse: true });
        state.players.p1.properties.Brown = group(
            [makeProperty('br-1', 'Brown'), makeProperty('br-2', 'Brown')],
            { hasHouse: true, hasHotel: true }
        );

        const result = game_manager.applyAction(state, rearrange());

        assert.strictEqual(result.legal, true);
        const next = result.gameState;
        assert.deepStrictEqual(next.players.p1.properties.DarkBlue.cards.map(c => c.id).sort(), ['db-1', 'wild-1']);
        // Destination group's own flags are left as-is.
        assert.strictEqual(next.players.p1.properties.DarkBlue.hasHouse, true);
        // Fully unaffected group keeps every flag.
        assert.strictEqual(next.players.p1.properties.Brown.hasHouse, true);
        assert.strictEqual(next.players.p1.properties.Brown.hasHotel, true);
    });

    it('is a free action: it never changes playsMade and is legal with the play limit reached', function () {
        const state = actionPhaseState();
        state.players.p1.hand = [];
        state.players.p1.properties.Green = group([makeWildcard('wild-1', ['DarkBlue', 'Green'])]);
        state.turn = Object.assign({}, state.turn, { playsMade: 3 });

        const result = game_manager.applyAction(state, rearrange());

        assert.strictEqual(result.legal, true);
        assert.strictEqual(result.gameState.turn.playsMade, 3);
    });

    it('does not mutate the input state on a successful move', function () {
        const state = actionPhaseState();
        state.players.p1.hand = [];
        state.players.p1.properties.Green = group([makeWildcard('wild-1', ['DarkBlue', 'Green'])]);

        const result = game_manager.applyAction(state, rearrange());

        assert.notStrictEqual(result.gameState, state);
        assert.ok(state.players.p1.properties.Green, 'source group still present on input state');
        assert.deepStrictEqual(state.players.p1.properties.Green.cards.map(c => c.id), ['wild-1']);
        assert.strictEqual(state.players.p1.properties.DarkBlue, undefined);
    });

    it('preserves the input state on rejection (invalid destination color for the card)', function () {
        const state = actionPhaseState();
        state.players.p1.hand = [];
        state.players.p1.properties.Green = group([makeWildcard('wild-1', ['DarkBlue', 'Green'])]);

        const result = game_manager.applyAction(state, rearrange({ propertyColor: 'Red' }));

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /cannot be assigned to Red/);
        assert.strictEqual(result.gameState, undefined);
        assert.deepStrictEqual(state.players.p1.properties.Green.cards.map(c => c.id), ['wild-1']);
        assert.strictEqual(state.turn.playsMade, 0);
    });

    it('rejects an unknown destination color', function () {
        const state = actionPhaseState();
        state.players.p1.properties.Green = group([makeWildcard('wild-1', ['DarkBlue', 'Green'])]);

        const result = game_manager.applyAction(state, rearrange({ propertyColor: 'Rainbow' }));

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /Unknown property color/);
    });

    it('rejects a move to the color the wildcard already sits on', function () {
        const state = actionPhaseState();
        state.players.p1.properties.Green = group([makeWildcard('wild-1', ['DarkBlue', 'Green'])]);

        const result = game_manager.applyAction(state, rearrange({ propertyColor: 'Green' }));

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /already assigned to that color/);
    });

    it('rejects a missing cardId or missing destination propertyColor', function () {
        const state = actionPhaseState();
        state.players.p1.properties.Green = group([makeWildcard('wild-1', ['DarkBlue', 'Green'])]);

        const noCard = game_manager.applyAction(state, rearrange({ cardId: undefined }));
        assert.strictEqual(noCard.legal, false);
        assert.match(noCard.reason, /requires a cardId/);

        const noColor = game_manager.applyAction(state, rearrange({ propertyColor: undefined }));
        assert.strictEqual(noColor.legal, false);
        assert.match(noColor.reason, /requires a destination propertyColor/);
    });

    it('rejects a card that is in hand or bank rather than in a property set', function () {
        const state = actionPhaseState();
        const handWild = makeWildcard('wild-1', ['DarkBlue', 'Green']);
        state.players.p1.hand = [handWild];
        state.players.p1.bank = [makeWildcard('wild-2', ['DarkBlue', 'Green'])];

        const fromHand = game_manager.applyAction(state, rearrange());
        assert.strictEqual(fromHand.legal, false);
        assert.match(fromHand.reason, /not in any of your property sets/);

        const fromBank = game_manager.applyAction(state, rearrange({ cardId: 'wild-2' }));
        assert.strictEqual(fromBank.legal, false);
        assert.match(fromBank.reason, /not in any of your property sets/);
    });

    it('rejects a non-wildcard property card', function () {
        const state = actionPhaseState();
        state.players.p1.properties.Green = group([makeProperty('g-1', 'Green')]);

        const result = game_manager.applyAction(state, rearrange({ cardId: 'g-1' }));

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /Only a wildcard may be rearranged/);
    });

    it('rejects rearranging outside the ACTION/DISCARD phase (e.g. before drawing)', function () {
        const state = baseState(); // still in DRAW phase, p1 has not drawn
        state.players.p1.properties.Green = group([makeWildcard('wild-1', ['DarkBlue', 'Green'])]);

        const result = game_manager.applyAction(state, rearrange());

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /only allowed during your own turn/);
    });

    it('rejects a rearrange requested by a player whose turn it is not', function () {
        const state = actionPhaseState(2);
        state.players.p2.properties.Green = group([makeWildcard('wild-1', ['DarkBlue', 'Green'])]);

        const result = game_manager.applyAction(state, rearrange({ playerId: 'p2' }));

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /Only the current player may rearrange/);
    });

    ['hasHouse', 'hasHotel'].forEach((buildingFlag) => {
        it(`rejects a wildcard move out of a ${buildingFlag === 'hasHouse' ? 'House' : 'Hotel'} set without mutating it`, function () {
            const state = actionPhaseState();
            state.players.p1.hand = [];
            state.players.p1.properties.Green = group(
                [
                    makeProperty('g-1', 'Green'),
                    makeProperty('g-2', 'Green'),
                    makeWildcard('wild-1', ['DarkBlue', 'Green'])
                ],
                { [buildingFlag]: true }
            );

            const before = JSON.stringify(state);
            const result = game_manager.applyAction(state, rearrange());

            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /House or Hotel/);
            assert.strictEqual(result.gameState, undefined);
            assert.strictEqual(JSON.stringify(state), before);
        });
    });

    it('produces an accurate event-feed summary naming both colors', function () {
        const previousGameState = {
            players: {
                p1: {
                    id: 'p1', name: 'Scott', hand: [], bank: [],
                    properties: { Green: group([{ id: 'wild-1', kind: 'WILDCARD', colors: ['DarkBlue', 'Green'] }]) }
                }
            }
        };
        const room = {
            seats: [{ seatIndex: 0, playerId: 'p1', displayName: 'Scott', connected: true }],
            gameState: { players: { p1: previousGameState.players.p1 } }
        };

        const summary = app.buildActionEventSummary(
            room,
            { type: 'REARRANGE', playerId: 'p1', cardId: 'wild-1', propertyColor: 'DarkBlue' },
            previousGameState
        );

        assert.match(summary, /Scott moved a wildcard from their Green set to Dark Blue\./);
    });
});
