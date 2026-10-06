const assert = require('assert');
const Deck = require('../models/Deck');
const canonicalCatalog = require('../fixtures/hasbro-b0965-catalog.json');

function countBy(items, getKey) {
    return items.reduce((counts, item) => {
        const key = getKey(item);
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});
}

function sortedVariant(types) {
    return types.length === 10 ? 'ALL' : types.join('/');
}

describe('Deck integrity & CSPRNG shuffle (Phase 0.2)', function () {
    it('should initialize the Hasbro-standard playable Monopoly Deal deck with exactly 106 cards', function () {
        const deck = new Deck();
        assert.strictEqual(deck.cards.length, canonicalCatalog.playableTotalCards);
        assert.strictEqual(
            deck.cards.length + canonicalCatalog.referenceCards.Rules,
            canonicalCatalog.printedTotalCardsIncludingReference
        );
    });

    it('should contain canonical Hasbro card counts across all playable categories', function () {
        const deck = new Deck();
        assert.strictEqual(deck.actionCards.length, canonicalCatalog.cardTypeBreakdown.action);
        assert.strictEqual(deck.propertyCards.length, canonicalCatalog.cardTypeBreakdown.property);
        assert.strictEqual(deck.wildcards.length, canonicalCatalog.cardTypeBreakdown.wildcard);
        assert.strictEqual(deck.rentCards.length, canonicalCatalog.cardTypeBreakdown.rent);
        assert.strictEqual(deck.moneyCards.length, canonicalCatalog.cardTypeBreakdown.money);
        assert.strictEqual(
            deck.actionCards.length +
            deck.propertyCards.length +
            deck.wildcards.length +
            deck.rentCards.length +
            deck.moneyCards.length,
            canonicalCatalog.playableTotalCards
        );
    });

    it('should match canonical Hasbro title and variant counts', function () {
        const deck = new Deck({ rng: (min) => min });
        assert.deepStrictEqual(countBy(deck.actionCards, card => card.title), canonicalCatalog.actionTitleCounts);
        assert.deepStrictEqual(countBy(deck.propertyCards, card => card.type), canonicalCatalog.propertyColorCounts);
        assert.deepStrictEqual(countBy(deck.wildcards, card => sortedVariant(card.types)), canonicalCatalog.wildcardVariantCounts);
        assert.deepStrictEqual(countBy(deck.rentCards, card => sortedVariant(card.types)), canonicalCatalog.rentVariantCounts);
        assert.deepStrictEqual(countBy(deck.moneyCards, card => String(card.value)), canonicalCatalog.moneyValueCounts);
    });

    it('should assign a unique UUID to every single card in the deck', function () {
        const deck = new Deck();
        const cardIds = new Set(deck.cards.map(c => c.id));
        assert.strictEqual(cardIds.size, canonicalCatalog.playableTotalCards);

        // Verify UUID format (8-4-4-4-12 hex string)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        deck.cards.forEach(card => {
            assert.ok(card.id, 'Card must have an id');
            assert.ok(uuidRegex.test(card.id), `Card id '${card.id}' should be a valid UUID`);
        });
    });

    it('should ensure every card in the deck is a distinct object instance', function () {
        const deck = new Deck();
        const objectInstances = new Set(deck.cards);
        assert.strictEqual(objectInstances.size, canonicalCatalog.playableTotalCards, `All ${canonicalCatalog.playableTotalCards} cards must be distinct object references`);
    });

    it('should support seedable / custom RNG for deterministic testing', function () {
        // Deterministic mock RNG that always picks index 0
        const dummyRng = (min, max) => min;
        const deck1 = new Deck({ rng: dummyRng });
        const deck2 = new Deck({ rng: dummyRng });

        assert.strictEqual(deck1.cards.length, canonicalCatalog.playableTotalCards);
        assert.strictEqual(deck2.cards.length, canonicalCatalog.playableTotalCards);

        // With identical dummy RNG and identical initial construction order, title sequence matches
        const titles1 = deck1.cards.map(c => c.title);
        const titles2 = deck2.cards.map(c => c.title);
        assert.deepStrictEqual(titles1, titles2);
    });
});
