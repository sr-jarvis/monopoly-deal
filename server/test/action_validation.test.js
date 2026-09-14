'use strict';

const assert = require('assert');
const rules_validator = require('../rules_validator');

describe('Action Validation & Dry-Run API (v1.9)', function () {
    function makeState() {
        return {
            players: {
                p1: {
                    id: 'p1',
                    name: 'Scott',
                    hand: [
                        { id: 'c1', title: 'Pass Go', action: 'Draw 2 cards', value: 1 },
                        { id: 'c2', title: 'Boardwalk', type: 'DarkBlue', value: 4 },
                        { id: 'c3', title: 'Park Place', type: 'DarkBlue', value: 4 },
                        { id: 'c4', title: 'Wildcard DarkBlue/Green', types: ['DarkBlue', 'Green'], value: 4 },
                        { id: 'c5', title: '$5M Money', value: 5 }
                    ],
                    bank: [
                        { id: 'b1', title: '$1M Money', value: 1 }
                    ],
                    properties: {}
                },
                p2: {
                    id: 'p2',
                    name: 'Riri',
                    hand: [{ id: 'r1', title: '$2M Money', value: 2 }],
                    bank: [],
                    properties: {}
                }
            },
            turnOrder: ['p1', 'p2'],
            turn: {
                playerId: 'p1',
                phase: 'ACTION',
                playsMade: 0,
                hasDrawn: true,
                handSizeAtStartOfTurn: 5
            },
            pendingActionResolution: null
        };
    }

    it('should validate legal PLAY_CARD to bank', function () {
        const state = makeState();
        const action = {
            type: 'PLAY_CARD',
            cardId: 'c5',
            targetZone: 'bank'
        };
        const result = rules_validator.validatePlayerAction(state, 'p1', action);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.errors.length, 0);
        assert.strictEqual(result.actionSummary.targetZone, 'bank');
        assert.strictEqual(result.actionSummary.countsTowardPlayLimit, true);
    });

    it('should reject property card played directly to bank', function () {
        const state = makeState();
        const action = {
            type: 'PLAY_CARD',
            cardId: 'c2', // Boardwalk property
            targetZone: 'bank'
        };
        const result = rules_validator.validatePlayerAction(state, 'p1', action);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('cannot be banked as money')));
    });

    it('should validate legal PLAY_CARD property placement with matching color', function () {
        const state = makeState();
        const action = {
            type: 'PLAY_CARD',
            cardId: 'c2',
            targetZone: 'properties',
            propertyColor: 'DarkBlue'
        };
        const result = rules_validator.validatePlayerAction(state, 'p1', action);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.actionSummary.propertyColor, 'DarkBlue');
    });

    it('should reject PLAY_CARD property placement with mismatched color', function () {
        const state = makeState();
        const action = {
            type: 'PLAY_CARD',
            cardId: 'c2', // DarkBlue
            targetZone: 'properties',
            propertyColor: 'Red'
        };
        const result = rules_validator.validatePlayerAction(state, 'p1', action);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('does not match target set')));
    });

    it('should validate PAY_BANK with valid bank-eligible card IDs', function () {
        const state = makeState();
        const action = {
            type: 'PAY_BANK',
            cardIds: ['c5', 'b1']
        };
        const result = rules_validator.validatePlayerAction(state, 'p1', action);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.errors.length, 0);
    });

    it('should reject PAY_BANK with unowned or property card IDs', function () {
        const state = makeState();
        const action = {
            type: 'PAY_BANK',
            cardIds: ['c2'] // Property card
        };
        const result = rules_validator.validatePlayerAction(state, 'p1', action);
        assert.strictEqual(result.valid, false);
        assert.ok(result.errors.some(e => e.includes('Property card')));
    });

    it('should flag hand size limit warning when action leaves hand > 7', function () {
        const state = makeState();
        state.turn.phase = 'DRAW';
        state.turn.hasDrawn = false;
        state.players.p1.hand = new Array(7).fill(0).map((_, i) => ({ id: 'h' + i, value: 1 }));
        const action = {
            type: 'DRAW',
            count: 2
        };
        const result = rules_validator.validatePlayerAction(state, 'p1', action);
        assert.strictEqual(result.valid, true); // DRAW is legal
        assert.strictEqual(result.warnings.length, 1);
        assert.ok(result.warnings[0].includes('Hand will have 9 cards'));
        assert.strictEqual(result.actionSummary.handLimitExceeded, true);
    });

    it('should not mutate original state during validation', function () {
        const state = makeState();
        const original = JSON.stringify(state);
        const action = {
            type: 'PLAY_CARD',
            cardId: 'c2',
            targetZone: 'properties',
            propertyColor: 'DarkBlue'
        };
        rules_validator.validatePlayerAction(state, 'p1', action);
        assert.strictEqual(JSON.stringify(state), original);
    });
});
