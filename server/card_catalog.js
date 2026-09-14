'use strict';
const Deck = require('./models/Deck');

const RENT_TIERS = {
    Brown: [1, 2],
    LightBlue: [1, 2, 3],
    Purple: [1, 2, 4],
    Orange: [1, 3, 5],
    Red: [2, 3, 6],
    Yellow: [2, 4, 6],
    Green: [2, 4, 7],
    DarkBlue: [3, 8],
    Railroad: [1, 2, 3, 4],
    Utility: [1, 2]
};

const COMPLETE_SET_SIZE = {
    Brown: 2,
    LightBlue: 3,
    Purple: 3,
    Orange: 3,
    Red: 3,
    Yellow: 3,
    Green: 3,
    DarkBlue: 2,
    Utility: 2,
    Railroad: 4
};

let cachedCatalog = null;

function buildCardCatalog() {
    const deck = new Deck();
    
    // Aggregate property cards by title
    const propertyMap = new Map();
    deck.propertyCards.forEach(card => {
        const title = card.name || card.title;
        const color = card.type || card.color;
        if (!propertyMap.has(title)) {
            propertyMap.set(title, {
                title: title,
                color: color,
                value: card.value,
                completeSetSize: COMPLETE_SET_SIZE[color] || 0,
                rentTiers: RENT_TIERS[color] || [],
                count: 1
            });
        } else {
            propertyMap.get(title).count += 1;
        }
    });

    // Aggregate wildcards by title + types
    const wildcardMap = new Map();
    deck.wildcards.forEach(card => {
        const title = card.name || card.title;
        const types = card.types || [];
        const key = `${title}:${types.join('-')}`;
        if (!wildcardMap.has(key)) {
            wildcardMap.set(key, {
                title: title,
                value: card.value,
                types: types,
                count: 1
            });
        } else {
            wildcardMap.get(key).count += 1;
        }
    });

    // Aggregate rent cards by title + types
    const rentMap = new Map();
    deck.rentCards.forEach(card => {
        const title = card.name || card.title;
        const types = card.types || [];
        const key = `${title}:${types.join('-')}`;
        if (!rentMap.has(key)) {
            rentMap.set(key, {
                title: title,
                value: card.value,
                types: types,
                count: 1
            });
        } else {
            rentMap.get(key).count += 1;
        }
    });

    // Aggregate action cards by title
    const actionMap = new Map();
    deck.actionCards.forEach(card => {
        const title = card.name || card.title;
        if (!actionMap.has(title)) {
            actionMap.set(title, {
                title: title,
                value: card.value,
                description: card.action || card.description || '',
                count: 1
            });
        } else {
            actionMap.get(title).count += 1;
        }
    });

    // Aggregate money cards by value
    const moneyMap = new Map();
    deck.moneyCards.forEach(card => {
        const val = card.value;
        const key = `${val}M`;
        if (!moneyMap.has(key)) {
            moneyMap.set(key, {
                title: `${val}M Money Card`,
                value: val,
                count: 1
            });
        } else {
            moneyMap.get(key).count += 1;
        }
    });

    return {
        totalCards: deck.cards.length,
        cardTypeBreakdown: {
            action: deck.actionCards.length,
            property: deck.propertyCards.length,
            wildcard: deck.wildcards.length,
            rent: deck.rentCards.length,
            money: deck.moneyCards.length
        },
        properties: Array.from(propertyMap.values()),
        wildcards: Array.from(wildcardMap.values()),
        rentCards: Array.from(rentMap.values()),
        actionCards: Array.from(actionMap.values()),
        moneyCards: Array.from(moneyMap.values())
    };
}

function getCardCatalog() {
    if (!cachedCatalog) {
        cachedCatalog = buildCardCatalog();
    }
    return cachedCatalog;
}

module.exports = {
    getCardCatalog,
    RENT_TIERS,
    COMPLETE_SET_SIZE
};
