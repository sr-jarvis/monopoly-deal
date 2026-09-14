/**
 * card_effects.js
 *
 * Focused helper for classifying "charge" action cards (cards that force one
 * or more opponents to pay the player who played them) and the Sly Deal
 * property-steal card, by their exact title.
 *
 * Cards in this codebase don't carry a reliable `card.type` field (see
 * models/ActionCard.js / models/Card.js — only PropertyCard sets `.type`,
 * to a color), so these cards must be identified by title, matching the
 * exact strings Deck.js stamps onto ActionCard instances.
 *
 * Scope: Debt Collector, Its My Birthday, standard/all-color Rent cards,
 * Sly Deal, Forced Deal, Deal Breaker, Pass Go, House, Hotel, and Double The
 * Rent (only ever legal attached to a Rent action). Just Say No is out of
 * scope for this slice.
 */

'use strict';

var CHARGE_CARD_TITLES = Object.freeze({
    DEBT_COLLECTOR: 'Debt Collector',
    BIRTHDAY: 'Its My Birthday' // matches Deck.js exactly - no apostrophe
});

var SLY_DEAL_TITLE = 'Sly Deal';
var FORCED_DEAL_TITLE = 'Forced Deal'; // matches Deck.js exactly
var DEAL_BREAKER_TITLE = 'Deal Breaker'; // matches Deck.js exactly
var PASS_GO_TITLE = 'Pass Go'; // matches Deck.js exactly
var HOUSE_TITLE = 'House'; // matches Deck.js exactly
var HOTEL_TITLE = 'Hotel'; // matches Deck.js exactly
var DOUBLE_THE_RENT_TITLE = 'Double The Rent'; // matches Deck.js exactly

// Colors a House/Hotel can never be added to (per the physical card text).
var HOUSE_HOTEL_EXCLUDED_COLORS = Object.freeze(['Railroad', 'Utility']);
var HOUSE_RENT_BONUS = 3;
var HOTEL_RENT_BONUS = 4;

var TARGETING = Object.freeze({
    SINGLE_OPPONENT: 'SINGLE_OPPONENT',
    ALL_OPPONENTS: 'ALL_OPPONENTS'
});

var CHARGE_CARD_SPECS = Object.freeze({
    'Debt Collector': Object.freeze({ title: CHARGE_CARD_TITLES.DEBT_COLLECTOR, amount: 5, targeting: TARGETING.SINGLE_OPPONENT }),
    'Its My Birthday': Object.freeze({ title: CHARGE_CARD_TITLES.BIRTHDAY, amount: 2, targeting: TARGETING.ALL_OPPONENTS })
});

/** @returns {boolean} whether the given card title is a supported charge card. */
function isChargeCardTitle(title) {
    return !!CHARGE_CARD_SPECS[title];
}

/** @returns {boolean} whether the given card is a Sly Deal action card. */
function isSlyDealCard(card) {
    return !!card && card.title === SLY_DEAL_TITLE;
}

/** @returns {boolean} whether the given card is a Forced Deal action card. */
function isForcedDealCard(card) {
    return !!card && card.title === FORCED_DEAL_TITLE;
}

/** @returns {boolean} whether the given card is a Deal Breaker action card. */
function isDealBreakerCard(card) {
    return !!card && card.title === DEAL_BREAKER_TITLE;
}

/** @returns {boolean} whether the given card is a Pass Go action card. */
function isPassGoCard(card) {
    return !!card && card.title === PASS_GO_TITLE;
}

/** @returns {boolean} whether the given card is a House action card. */
function isHouseCard(card) {
    return !!card && card.title === HOUSE_TITLE;
}

/** @returns {boolean} whether the given card is a Hotel action card. */
function isHotelCard(card) {
    return !!card && card.title === HOTEL_TITLE;
}

/** @returns {boolean} whether the given card is a Double The Rent action card. */
function isDoubleTheRentCard(card) {
    return !!card && card.title === DOUBLE_THE_RENT_TITLE;
}

/** @returns {?{title:string, amount:number, targeting:string}} */
function getChargeCardSpec(title) {
    return CHARGE_CARD_SPECS[title] || null;
}

/**
 * Computes the debtor map owed by a charge card's target(s).
 * @param {Object} state    GameState (needs turnOrder for ALL_OPPONENTS).
 * @param {string} sourcePlayerId  Player who played the charge card.
 * @param {string} cardTitle
 * @param {?string} targetPlayerId  Required for SINGLE_OPPONENT cards.
 * @returns {Object.<string, {amountOwed: number}>}
 */
function computeDebtors(state, sourcePlayerId, cardTitle, targetPlayerId) {
    var spec = getChargeCardSpec(cardTitle);
    if (!spec) return {};

    var debtors = {};
    if (spec.targeting === TARGETING.SINGLE_OPPONENT) {
        if (targetPlayerId) {
            debtors[targetPlayerId] = { amountOwed: spec.amount };
        }
    } else if (spec.targeting === TARGETING.ALL_OPPONENTS) {
        (state.turnOrder || []).forEach(function (playerId) {
            if (playerId !== sourcePlayerId) {
                debtors[playerId] = { amountOwed: spec.amount };
            }
        });
    }
    return debtors;
}

function isRentCard(card) {
    return !!card && card.kind === 'RENT';
}

function getRentSpec(card) {
    if (!isRentCard(card) || !Array.isArray(card.types) || card.types.length === 0) return null;
    return {
        colors: card.types.slice(),
        targeting: card.types.length > 2 ? TARGETING.SINGLE_OPPONENT : TARGETING.ALL_OPPONENTS
    };
}

function computeRentDebtors(state, sourcePlayerId, card, targetPlayerId, rentAmount) {
    var spec = getRentSpec(card);
    if (!spec || typeof rentAmount !== 'number' || rentAmount <= 0) return {};
    if (spec.targeting === TARGETING.SINGLE_OPPONENT) {
        return targetPlayerId ? { [targetPlayerId]: { amountOwed: rentAmount } } : {};
    }
    return (state.turnOrder || []).reduce(function (debtors, playerId) {
        if (playerId !== sourcePlayerId) debtors[playerId] = { amountOwed: rentAmount };
        return debtors;
    }, {});
}

module.exports = {
    CHARGE_CARD_TITLES: CHARGE_CARD_TITLES,
    SLY_DEAL_TITLE: SLY_DEAL_TITLE,
    FORCED_DEAL_TITLE: FORCED_DEAL_TITLE,
    DEAL_BREAKER_TITLE: DEAL_BREAKER_TITLE,
    PASS_GO_TITLE: PASS_GO_TITLE,
    HOUSE_TITLE: HOUSE_TITLE,
    HOTEL_TITLE: HOTEL_TITLE,
    DOUBLE_THE_RENT_TITLE: DOUBLE_THE_RENT_TITLE,
    HOUSE_HOTEL_EXCLUDED_COLORS: HOUSE_HOTEL_EXCLUDED_COLORS,
    HOUSE_RENT_BONUS: HOUSE_RENT_BONUS,
    HOTEL_RENT_BONUS: HOTEL_RENT_BONUS,
    TARGETING: TARGETING,
    CHARGE_CARD_SPECS: CHARGE_CARD_SPECS,
    isChargeCardTitle: isChargeCardTitle,
    isSlyDealCard: isSlyDealCard,
    isForcedDealCard: isForcedDealCard,
    isDealBreakerCard: isDealBreakerCard,
    isPassGoCard: isPassGoCard,
    isHouseCard: isHouseCard,
    isHotelCard: isHotelCard,
    isDoubleTheRentCard: isDoubleTheRentCard,
    getChargeCardSpec: getChargeCardSpec,
    computeDebtors: computeDebtors,
    isRentCard: isRentCard,
    getRentSpec: getRentSpec,
    computeRentDebtors: computeRentDebtors
};
