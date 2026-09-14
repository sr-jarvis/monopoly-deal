'use strict';

const assert = require('assert');
const rules = require('../rules_validator');

describe('Action Card Rules & Validation (v2.1)', function() {
    let state;

    beforeEach(function() {
        state = {
            players: {
                p1: {
                    id: 'p1',
                    name: 'Scott',
                    hand: [
                        { id: 'c_passgo', title: 'Pass Go' },
                        { id: 'c_debt', title: 'Debt Collector' },
                        { id: 'c_bday', title: 'Its My Birthday' },
                        { id: 'c_db', title: 'Deal Breaker' },
                        { id: 'c_sly', title: 'Sly Deal' },
                        { id: 'c_forced', title: 'Forced Deal' },
                        { id: 'c_jsn', title: 'Just Say No' }
                    ],
                    bank: [],
                    properties: {
                        Brown: { cards: [{ id: 'p1_brown1', title: 'Brown 1' }], hasHouse: false, hasHotel: false }
                    }
                },
                p2: {
                    id: 'p2',
                    name: 'Riri',
                    hand: [],
                    bank: [],
                    properties: {
                        Brown: {
                            cards: [
                                { id: 'p2_brown1', title: 'Brown 1' },
                                { id: 'p2_brown2', title: 'Brown 2' }
                            ],
                            hasHouse: false,
                            hasHotel: false
                        },
                        DarkBlue: {
                            cards: [{ id: 'p2_blue1', title: 'Dark Blue 1' }],
                            hasHouse: false,
                            hasHotel: false
                        }
                    }
                },
                p3: {
                    id: 'p3',
                    name: 'Shuri',
                    hand: [],
                    bank: [],
                    properties: {}
                }
            },
            turnOrder: ['p1', 'p2', 'p3'],
            turn: {
                playerId: 'p1',
                phase: rules.PHASES.ACTION,
                playsMade: 0,
                hasDrawn: true,
                handSizeAtStartOfTurn: 5
            },
            pendingActionResolution: null
        };
    });

    it('should validate Pass Go play', function() {
        const res = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_passgo',
            cardTitle: 'Pass Go'
        });
        assert.strictEqual(res.legal, true);
        assert.strictEqual(res.errors.length, 0);
        assert.deepStrictEqual(res.actionSummary.effect, { type: 'DRAW', count: 2 });
    });

    it('should validate Debt Collector play with valid target', function() {
        const res = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_debt',
            cardTitle: 'Debt Collector',
            targetPlayerId: 'p2'
        });
        assert.strictEqual(res.legal, true);
        assert.deepStrictEqual(res.actionSummary.eligibleResponderIds, ['p2']);
        assert.strictEqual(res.actionSummary.effect.amount, 5);
    });

    it('should reject Debt Collector when targeting self or missing target', function() {
        const resNoTarget = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_debt',
            cardTitle: 'Debt Collector'
        });
        assert.strictEqual(resNoTarget.legal, false);

        const resSelfTarget = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_debt',
            cardTitle: 'Debt Collector',
            targetPlayerId: 'p1'
        });
        assert.strictEqual(resSelfTarget.legal, false);
    });

    it('should validate Its My Birthday play collecting from all other players', function() {
        const res = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_bday',
            cardTitle: 'Its My Birthday'
        });
        assert.strictEqual(res.legal, true);
        assert.deepStrictEqual(res.actionSummary.eligibleResponderIds, ['p2', 'p3']);
        assert.strictEqual(res.actionSummary.effect.amountEach, 2);
    });

    it('should validate Deal Breaker when target set is complete', function() {
        const res = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_db',
            cardTitle: 'Deal Breaker',
            targetPlayerId: 'p2',
            targetPropertyColor: 'Brown'
        });
        assert.strictEqual(res.legal, true);
        assert.strictEqual(res.actionSummary.effect.type, 'STEAL_SET');
    });

    it('should reject Deal Breaker when target set is incomplete', function() {
        const res = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_db',
            cardTitle: 'Deal Breaker',
            targetPlayerId: 'p2',
            targetPropertyColor: 'DarkBlue'
        });
        assert.strictEqual(res.legal, false);
        assert.ok(res.errors.some(e => e.includes('incomplete')));
    });

    it('should validate Sly Deal when target property is in an incomplete set', function() {
        const res = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_sly',
            cardTitle: 'Sly Deal',
            targetPlayerId: 'p2',
            targetPropertyColor: 'DarkBlue',
            targetCardId: 'p2_blue1'
        });
        assert.strictEqual(res.legal, true);
        assert.strictEqual(res.actionSummary.effect.type, 'STEAL_PROPERTY');
    });

    it('should reject Sly Deal when attempting to steal from a complete set', function() {
        const res = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_sly',
            cardTitle: 'Sly Deal',
            targetPlayerId: 'p2',
            targetPropertyColor: 'Brown',
            targetCardId: 'p2_brown1'
        });
        assert.strictEqual(res.legal, false);
        assert.ok(res.errors.some(e => e.includes('Deal Breaker')));
    });

    it('should validate Forced Deal swapping properties between incomplete sets', function() {
        const res = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_forced',
            cardTitle: 'Forced Deal',
            targetPlayerId: 'p2',
            offeredCardId: 'p1_brown1',
            offeredPropertyColor: 'Brown',
            requestedCardId: 'p2_blue1',
            requestedPropertyColor: 'DarkBlue'
        });
        assert.strictEqual(res.legal, true);
        assert.strictEqual(res.actionSummary.effect.type, 'SWAP_PROPERTY');
    });

    it('should reject Forced Deal when requesting card from a complete set', function() {
        const res = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_forced',
            cardTitle: 'Forced Deal',
            targetPlayerId: 'p2',
            offeredCardId: 'p1_brown1',
            offeredPropertyColor: 'Brown',
            requestedCardId: 'p2_brown1',
            requestedPropertyColor: 'Brown'
        });
        assert.strictEqual(res.legal, false);
        assert.ok(res.errors.some(e => e.includes('complete set')));
    });

    it('should route Just Say No play', function() {
        state.pendingActionResolution = { sourceCard: 'Sly Deal', fromPlayerId: 'p2', eligibleResponderIds: ['p1'] };
        const res = rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_jsn',
            cardTitle: 'Just Say No'
        });
        assert.strictEqual(res.legal, true);
        assert.strictEqual(res.actionSummary.cancels, 'Sly Deal');
    });

    it('should verify isCompletePropertySet helper accuracy', function() {
        assert.strictEqual(rules.isCompletePropertySet(state, 'p2', 'Brown'), true);
        assert.strictEqual(rules.isCompletePropertySet(state, 'p2', 'DarkBlue'), false);
        assert.strictEqual(rules.isCompletePropertySet(state, 'p1', 'Brown'), false);
    });

    it('should preserve state immutability during validation', function() {
        const snapshot = JSON.stringify(state);
        rules.validateActionCardPlay(state, {
            playerId: 'p1',
            cardId: 'c_forced',
            cardTitle: 'Forced Deal',
            targetPlayerId: 'p2',
            offeredCardId: 'p1_brown1',
            offeredPropertyColor: 'Brown',
            requestedCardId: 'p2_blue1',
            requestedPropertyColor: 'DarkBlue'
        });
        assert.strictEqual(JSON.stringify(state), snapshot);
    });

    it('should integrate with validateAction dispatcher for PLAY_ACTION_CARD', function() {
        const res = rules.validateAction(state, {
            type: rules.ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p1',
            cardId: 'c_passgo'
        });
        assert.strictEqual(res.legal, true);
    });
});
