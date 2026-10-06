'use strict';
const assert = require('assert');
const card_catalog = require('../card_catalog');
const rules_catalog = require('../rules_catalog');
const canonicalCatalog = require('../fixtures/hasbro-b0965-catalog.json');

describe('card_catalog', function() {
    it('returns totalCards matching the full deck size', function() {
        const catalog = card_catalog.getCardCatalog();
        assert(catalog.totalCards > 0);
    });

    it('breaks down card counts by type summing to totalCards', function() {
        const c = card_catalog.getCardCatalog();
        const sum = Object.values(c.cardTypeBreakdown).reduce((a, b) => a + b, 0);
        assert.strictEqual(sum, c.totalCards);
    });

    it('every property entry has a completeSetSize and rentTiers array', function() {
        const c = card_catalog.getCardCatalog();
        c.properties.forEach(p => {
            assert(Number.isInteger(p.completeSetSize));
            assert(Array.isArray(p.rentTiers));
            assert.strictEqual(p.rentTiers.length, p.completeSetSize);
        });
    });

    it('is memoized (same object reference across calls)', function() {
        assert.strictEqual(card_catalog.getCardCatalog(), card_catalog.getCardCatalog());
    });

    it('action cards include description text', function() {
        const c = card_catalog.getCardCatalog();
        const dealBreaker = c.actionCards.find(a => a.title === 'Deal Breaker');
        assert(dealBreaker && dealBreaker.description.length > 0);
    });

    it('cites the canonical Hasbro B0965/E3113 source and omits reference cards from the draw pile', function() {
        const c = card_catalog.getCardCatalog();
        assert.strictEqual(c.edition, canonicalCatalog.edition);
        assert.deepStrictEqual(c.sources, canonicalCatalog.sources);
        assert.strictEqual(c.totalCards, canonicalCatalog.playableTotalCards);
        assert.strictEqual(c.printedTotalCardsIncludingReference, canonicalCatalog.printedTotalCardsIncludingReference);
        assert.deepStrictEqual(c.referenceCards, canonicalCatalog.referenceCards);
    });
});

describe('rules_catalog', function() {
    it('exposes all four turn phases', function() {
        const r = rules_catalog.getRulesReference();
        assert.deepStrictEqual(Object.keys(r.turnPhases).sort(), ['ACTION', 'COMPLETE', 'DISCARD', 'DRAW']);
    });

    it('matches rules_validator constants (no drift)', function() {
        const rulesValidator = require('../rules_validator');
        const r = rules_catalog.getRulesReference();
        assert.strictEqual(r.handLimit, rulesValidator.HAND_LIMIT);
        assert.strictEqual(r.actionLimits.maxPlaysPerTurn, rulesValidator.MAX_PLAYS_PER_TURN);
    });

    it('win condition requires 3 complete sets', function() {
        const r = rules_catalog.getRulesReference();
        assert.strictEqual(r.winCondition.completeSetsRequired, 3);
    });

    it('completeSetSize matches per-color counts', function() {
        const r = rules_catalog.getRulesReference();
        assert.strictEqual(r.winCondition.completeSetSize.Brown, 2);
        assert.strictEqual(r.winCondition.completeSetSize.DarkBlue, 2);
        assert.strictEqual(r.winCondition.completeSetSize.Railroad, 4);
    });
});
