const assert = require('assert');
const Deck = require('../models/Deck');

describe('Deck integrity & CSPRNG shuffle (Phase 0.2)', function () {
    it('should initialize a complete Monopoly Deal deck with exactly 108 cards', function () {
        const deck = new Deck();
        assert.strictEqual(deck.cards.length, 108);
    });

    it('should contain correct card counts across all categories summing to 108', function () {
        const deck = new Deck();
        assert.strictEqual(deck.actionCards.length, 36);
        assert.strictEqual(deck.propertyCards.length, 28);
        assert.strictEqual(deck.wildcards.length, 11);
        assert.strictEqual(deck.rentCards.length, 13);
        assert.strictEqual(deck.moneyCards.length, 20);
        assert.strictEqual(
            deck.actionCards.length +
            deck.propertyCards.length +
            deck.wildcards.length +
            deck.rentCards.length +
            deck.moneyCards.length,
            108
        );
    });

    it('should assign a unique UUID to every single card in the deck', function () {
        const deck = new Deck();
        const cardIds = new Set(deck.cards.map(c => c.id));
        assert.strictEqual(cardIds.size, 108);

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
        assert.strictEqual(objectInstances.size, 108, 'All 108 cards must be distinct object references');
    });

    it('should support seedable / custom RNG for deterministic testing', function () {
        // Deterministic mock RNG that always picks index 0
        const dummyRng = (min, max) => min;
        const deck1 = new Deck({ rng: dummyRng });
        const deck2 = new Deck({ rng: dummyRng });

        assert.strictEqual(deck1.cards.length, 108);
        assert.strictEqual(deck2.cards.length, 108);

        // With identical dummy RNG and identical initial construction order, title sequence matches
        const titles1 = deck1.cards.map(c => c.title);
        const titles2 = deck2.cards.map(c => c.title);
        assert.deepStrictEqual(titles1, titles2);
    });
});
