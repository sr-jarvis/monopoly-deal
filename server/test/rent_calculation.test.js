/**
 * rent_calculation.test.js
 *
 * Unit tests for Monopoly Deal v2.0 Rent Calculation & Payment Settlement API.
 */

'use strict';

const assert = require('assert');
const rules_validator = require('../rules_validator');

describe('Rent Calculation & Payment Settlement (v2.0)', function() {
    let mockState;

    beforeEach(function() {
        mockState = {
            players: {
                p1: {
                    id: 'p1',
                    name: 'Scott',
                    hand: [
                        { id: 'm1', title: '1M', value: 1, type: 'MoneyCard' },
                        { id: 'm5', title: '5M', value: 5, type: 'MoneyCard' }
                    ],
                    bank: [
                        { id: 'm2', title: '2M', value: 2, type: 'MoneyCard' }
                    ],
                    properties: {
                        Green: {
                            cards: [
                                { id: 'g1', title: 'Green Property 1', value: 4, type: 'PropertyCard' }
                            ],
                            hasHouse: false,
                            hasHotel: false
                        }
                    }
                },
                p2: {
                    id: 'p2',
                    name: 'Riri',
                    hand: [],
                    bank: [],
                    properties: {
                        Green: {
                            cards: [
                                { id: 'g2', title: 'Green Property 2', value: 4, type: 'PropertyCard' },
                                { id: 'g3', title: 'Green Property 3', value: 4, type: 'PropertyCard' },
                                { id: 'g4', title: 'Green Property 4', value: 4, type: 'PropertyCard' }
                            ],
                            hasHouse: true,
                            hasHotel: true
                        },
                        Railroad: {
                            cards: [
                                { id: 'rr1', title: 'B&O Railroad', value: 2, type: 'PropertyCard' },
                                { id: 'rr2', title: 'Short Line', value: 2, type: 'PropertyCard' }
                            ],
                            hasHouse: true,
                            hasHotel: false
                        }
                    }
                }
            },
            turnOrder: ['p1', 'p2'],
            turn: { playerId: 'p1', phase: 'ACTION', playsMade: 0, hasDrawn: true }
        };
    });

    it('should calculate base rent for a partial property set', function() {
        const rent = rules_validator.calculateRentAmount(mockState, 'p1', 'Green');
        assert.strictEqual(rent.errors.length, 0);
        assert.strictEqual(rent.cardsOwned, 1);
        assert.strictEqual(rent.isCompleteSet, false);
        assert.strictEqual(rent.baseRent, 2); // 1 Green card = 2M base rent
        assert.strictEqual(rent.fullSetMultiplierApplied, false);
        assert.strictEqual(rent.houseBonus, 0);
        assert.strictEqual(rent.hotelBonus, 0);
        assert.strictEqual(rent.totalRent, 2);
    });

    it('should double rent and add house + hotel bonuses for a complete set', function() {
        const rent = rules_validator.calculateRentAmount(mockState, 'p2', 'Green');
        assert.strictEqual(rent.errors.length, 0);
        assert.strictEqual(rent.cardsOwned, 3);
        assert.strictEqual(rent.isCompleteSet, true);
        assert.strictEqual(rent.baseRent, 7); // 3 Green cards = 7M base rent
        assert.strictEqual(rent.fullSetMultiplierApplied, true); // doubled to 14M
        assert.strictEqual(rent.houseBonus, 3);
        assert.strictEqual(rent.hotelBonus, 4);
        assert.strictEqual(rent.totalRent, 21); // 14 + 3 + 4 = 21M
    });

    it('should exclude house/hotel bonuses for Railroads even if flagged', function() {
        const rent = rules_validator.calculateRentAmount(mockState, 'p2', 'Railroad');
        assert.strictEqual(rent.errors.length, 0);
        assert.strictEqual(rent.cardsOwned, 2);
        assert.strictEqual(rent.isCompleteSet, false); // Railroad set size = 4
        assert.strictEqual(rent.baseRent, 2); // 2 Railroads = 2M base rent
        assert.strictEqual(rent.houseBonus, 0); // Railroads exclude house/hotel
        assert.strictEqual(rent.totalRent, 2);
    });

    it('should return 0 rent when owner owns 0 cards of color', function() {
        const rent = rules_validator.calculateRentAmount(mockState, 'p1', 'Red');
        assert.strictEqual(rent.errors.length, 0);
        assert.strictEqual(rent.cardsOwned, 0);
        assert.strictEqual(rent.totalRent, 0);
    });

    it('should reject invalid ownerId or propertyColor', function() {
        const rentBadUser = rules_validator.calculateRentAmount(mockState, 'unknown', 'Green');
        assert.strictEqual(rentBadUser.errors.length, 1);

        const rentBadColor = rules_validator.calculateRentAmount(mockState, 'p1', 'InvalidColor');
        assert.strictEqual(rentBadColor.errors.length, 1);
    });

    it('should validate a legal full rent payment using bank/hand cards', function() {
        const payment = rules_validator.validateRentPaymentAction(mockState, {
            playerId: 'p1',
            toPlayerId: 'p2',
            propertyColor: 'Railroad',
            cardIds: ['m2'] // 2M bank card covers 2M Railroad rent
        });
        assert.strictEqual(payment.errors.length, 0);
        assert.strictEqual(payment.settlementValue, 2);
        assert.strictEqual(payment.shortfall, 0);
    });

    it('should allow settling rent with property cards', function() {
        const payment = rules_validator.validateRentPaymentAction(mockState, {
            playerId: 'p1',
            toPlayerId: 'p2',
            propertyColor: 'Railroad',
            propertyCardIds: ['g1'] // 4M Green property covers 2M Railroad rent
        });
        assert.strictEqual(payment.errors.length, 0);
        assert.strictEqual(payment.settlementValue, 4);
        assert.strictEqual(payment.shortfall, 0);
    });

    it('should allow an all-in shortfall payment when player uses all available worth', function() {
        // Rent owed for Green is 21M, p1 only has 12M total assets (1M + 5M + 2M + 4M)
        const payment = rules_validator.validateRentPaymentAction(mockState, {
            playerId: 'p1',
            toPlayerId: 'p2',
            propertyColor: 'Green',
            cardIds: ['m1', 'm5', 'm2'],
            propertyCardIds: ['g1']
        });
        assert.strictEqual(payment.errors.length, 0); // Valid all-in!
        assert.strictEqual(payment.settlementValue, 12);
        assert.strictEqual(payment.shortfall, 9);
    });

    it('should reject a shortfall payment if player holds back available assets', function() {
        // Rent owed for Green is 21M, p1 offers 1M but holds back 11M assets
        const payment = rules_validator.validateRentPaymentAction(mockState, {
            playerId: 'p1',
            toPlayerId: 'p2',
            propertyColor: 'Green',
            cardIds: ['m1']
        });
        assert.strictEqual(payment.errors.length, 1);
        assert.ok(payment.errors[0].includes('short of 21 rent owed'));
    });

    it('should not mutate state during rent calculation or validation', function() {
        const before = JSON.stringify(mockState);
        rules_validator.calculateRentAmount(mockState, 'p2', 'Green');
        rules_validator.validateRentPaymentAction(mockState, {
            playerId: 'p1',
            toPlayerId: 'p2',
            propertyColor: 'Green',
            cardIds: ['m1']
        });
        const after = JSON.stringify(mockState);
        assert.strictEqual(before, after);
    });
});
