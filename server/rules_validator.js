/**
 * rules_validator.js
 *
 * Server-authoritative validator for Monopoly Deal *turn structure* rules:
 * draw count, the 3-play-per-turn limit, and the end-of-turn hand limit.
 *
 * Scope: this module governs turn/phase legality only. It does NOT resolve
 * individual card effects (Sly Deal targeting, rent calculation, Deal
 * Breaker, win-condition detection, etc.) — that is a separate rules module
 * planned for a later slice (see RULES_SPEC.md, Section 7).
 *
 * Pure functions only: nothing here mutates the state object passed in.
 * `applyValidatedAction` returns a *new* state; callers (e.g. app.js) own
 * persisting it.
 *
 * CommonJS on purpose — app.js and package.json have no build/transpile
 * step, so this must run unmodified under plain Node.
 */

'use strict';

var { RENT_TIERS } = require('./card_catalog');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var HAND_LIMIT = 7;
var MAX_PLAYS_PER_TURN = 3;
var NORMAL_DRAW_COUNT = 2;
var EMPTY_HAND_DRAW_COUNT = 5;
var FULL_SET_RENT_MULTIPLIER = 2;
var HOUSE_RENT_BONUS = 3;
var HOTEL_RENT_BONUS = 4;
var HOUSE_HOTEL_EXCLUDED_COLORS = ['Railroad', 'Utility'];

var PHASES = Object.freeze({
    DRAW: 'DRAW',       // player must draw before acting
    ACTION: 'ACTION',   // player may play up to 3 cards (JSN/rearrange free)
    DISCARD: 'DISCARD', // hand > 7; player must discard down to the limit
    COMPLETE: 'COMPLETE' // turn is over, ready to advance to next player
});

var ACTION_TYPES = Object.freeze({
    DRAW: 'DRAW',
    PLAY_CARD: 'PLAY_CARD',       // money/property/action card played from hand
    PLAY_ACTION_CARD: 'PLAY_ACTION_CARD', // action card played with targeted/unique rules
    JUST_SAY_NO: 'JUST_SAY_NO',   // may be played in- or out-of-turn to block
    REARRANGE: 'REARRANGE',       // reorganizing own board, e.g. wildcard color
    DISCARD: 'DISCARD',           // end-of-turn discard down to hand limit
    END_TURN: 'END_TURN',
    PAY_BANK: 'PAY_BANK',         // paying bank/debt with money or action cards
    PAY_RENT: 'PAY_RENT'          // paying rent owed to another player
});

var ACTION_CARD_TITLES = Object.freeze({
    PASS_GO: 'Pass Go',
    DEBT_COLLECTOR: 'Debt Collector',
    BIRTHDAY: 'Its My Birthday',      // matches Deck.js exactly - no apostrophe
    DEAL_BREAKER: 'Deal Breaker',
    SLY_DEAL: 'Sly Deal',
    FORCED_DEAL: 'Forced Deal',
    JUST_SAY_NO: 'Just Say No'
});
var DEBT_COLLECTOR_AMOUNT = 5;
var BIRTHDAY_AMOUNT = 2;

var COMPLETE_SET_SIZE = Object.freeze({
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
});

// ---------------------------------------------------------------------------
// JSDoc type definitions (documentation only, no runtime effect)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CardRef
 * @property {string} id     Unique instance id of the card (not just title;
 *                            Monopoly Deal has many duplicate cards).
 * @property {string} title
 *
 * @typedef {Object} PropertyGroup
 * @property {CardRef[]} cards   Property/wildcard cards assigned to this color.
 * @property {boolean} hasHouse
 * @property {boolean} hasHotel
 *
 * @typedef {Object} PlayerState
 * @property {string} id
 * @property {string} name
 * @property {CardRef[]} hand
 * @property {CardRef[]} bank                         Money/action-as-money pile.
 * @property {Object.<string, PropertyGroup>} properties  Keyed by PropertyType.
 *
 * @typedef {Object} TurnState
 * @property {string} playerId              Whose turn it is.
 * @property {string} phase                 One of PHASES.
 * @property {number} playsMade             Count toward MAX_PLAYS_PER_TURN.
 * @property {boolean} hasDrawn
 * @property {number} handSizeAtStartOfTurn Snapshot taken by startTurn();
 *                                            drives the 2-vs-5 draw rule.
 *
 * @typedef {Object} PendingActionResolution
 * @property {string} sourceCard
 * @property {string} fromPlayerId
 * @property {string[]} eligibleResponderIds  Players allowed to Just Say No.
 *
 * @typedef {Object} GameState
 * @property {Object.<string, PlayerState>} players
 * @property {string[]} turnOrder
 * @property {TurnState} turn
 * @property {?PendingActionResolution} pendingActionResolution
 *
 * @typedef {Object} Action
 * @property {string} type       One of ACTION_TYPES.
 * @property {string} playerId   Player performing the action.
 * @property {string} [cardId]
 * @property {number} [count]    Used by DRAW to state how many were drawn.
 *
 * @typedef {Object} ValidationResult
 * @property {boolean} legal
 * @property {string} [reason]              Present when legal === false.
 * @property {boolean} [countsTowardPlayLimit] Present when legal === true
 *                                              and type is play-like.
 */

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function legal(extra) {
    return Object.assign({ legal: true }, extra || {});
}

function illegal(reason) {
    return { legal: false, reason: reason };
}

/**
 * @param {number} handSizeAtStartOfTurn
 * @returns {number} 5 if the player's hand was empty at the start of their
 *   turn, otherwise the normal draw count of 2.
 */
function getRequiredDrawCount(handSizeAtStartOfTurn) {
    return handSizeAtStartOfTurn === 0 ? EMPTY_HAND_DRAW_COUNT : NORMAL_DRAW_COUNT;
}

/**
 * Builds a fresh TurnState for the given player, snapshotting their current
 * hand size (required for the empty-hand-draws-5 rule).
 * @param {GameState} state
 * @param {string} playerId
 * @returns {TurnState}
 */
function startTurn(state, playerId) {
    var player = state.players[playerId];
    if (!player) {
        throw new Error('startTurn: unknown playerId ' + playerId);
    }
    return {
        playerId: playerId,
        phase: PHASES.DRAW,
        playsMade: 0,
        hasDrawn: false,
        handSizeAtStartOfTurn: player.hand.length
    };
}

// ---------------------------------------------------------------------------
// Per-action validators
// ---------------------------------------------------------------------------

/** @returns {ValidationResult} */
function validateDrawAction(state, action) {
    var turn = state.turn;
    if (action.playerId !== turn.playerId) {
        return illegal('Only the current player may draw.');
    }
    if (turn.phase !== PHASES.DRAW) {
        return illegal('Not in the draw phase (already drew, or turn has moved on).');
    }
    if (turn.hasDrawn) {
        return illegal('Player has already drawn this turn.');
    }
    var required = getRequiredDrawCount(turn.handSizeAtStartOfTurn);
    if (typeof action.count !== 'number' || action.count !== required) {
        return illegal('Must draw exactly ' + required + ' card(s) this turn.');
    }
    return legal();
}

/** @returns {ValidationResult} */
function validateJustSayNoAction(state, action) {
    var pending = state.pendingActionResolution;
    if (!pending) {
        return illegal('No pending action card to respond to.');
    }
    if (pending.eligibleResponderIds.indexOf(action.playerId) === -1) {
        return illegal('Player is not an eligible target of the pending action card.');
    }
    // Just Say No may be played in- or out-of-turn and never counts toward
    // the 3-play limit.
    return legal({ countsTowardPlayLimit: false });
}

/** @returns {ValidationResult} */
function validateRearrangeAction(state, action) {
    var turn = state.turn;
    if (action.playerId !== turn.playerId) {
        return illegal('Only the current player may rearrange their own board.');
    }
    if (turn.phase !== PHASES.ACTION && turn.phase !== PHASES.DISCARD) {
        return illegal('Rearranging is only allowed during your own turn.');
    }
    // Rearranging (e.g. reassigning a wildcard's color) never counts toward
    // the 3-play limit.
    return legal({ countsTowardPlayLimit: false });
}

/** @returns {ValidationResult} */
function validatePlayCardAction(state, action) {
    var turn = state.turn;
    if (action.playerId !== turn.playerId) {
        return illegal('Only the current player may play a card.');
    }
    if (turn.phase !== PHASES.ACTION) {
        return illegal('Not in the action phase (must draw first, or turn is in discard/complete).');
    }
    if (!action.cardId) {
        return illegal('No card specified to play.');
    }
    // A Rent played atomically with Double The Rent (action.doubleRentCardId)
    // is a single play that costs two toward the per-turn limit; every other
    // play costs one. Pre-increment check, so no off-by-one.
    var playCost = action.doubleRentCardId ? 2 : 1;
    if (turn.playsMade + playCost > MAX_PLAYS_PER_TURN) {
        return illegal('Play limit of ' + MAX_PLAYS_PER_TURN + ' cards per turn has been reached.');
    }
    return legal({ countsTowardPlayLimit: true });
}

/** @returns {ValidationResult} */
function validateDiscardAction(state, action) {
    var turn = state.turn;
    var player = state.players[action.playerId];
    if (!player) {
        return illegal('Unknown player.');
    }
    if (action.playerId !== turn.playerId) {
        return illegal('Only the current player may discard.');
    }
    if (turn.phase !== PHASES.DISCARD) {
        return illegal('Discarding is only allowed once the end-of-turn hand limit check has started.');
    }
    if (player.hand.length <= HAND_LIMIT) {
        return illegal('Hand is already within the ' + HAND_LIMIT + '-card limit; no discard needed.');
    }
    if (!action.cardId) {
        return illegal('No card specified to discard.');
    }
    // Discards never count toward the 3-play limit.
    return legal({ countsTowardPlayLimit: false });
}

function validatePayBankTurnAction(state, action) {
    if (!action.cardIds || !Array.isArray(action.cardIds) || action.cardIds.length === 0) {
        return illegal('PAY_BANK action requires non-empty cardIds array.');
    }
    return legal({ countsTowardPlayLimit: false });
}

/** @returns {ValidationResult} */
function validateEndTurnAction(state, action) {
    var turn = state.turn;
    var player = state.players[action.playerId];
    if (action.playerId !== turn.playerId) {
        return illegal('Only the current player may end their turn.');
    }
    if (turn.phase !== PHASES.ACTION && turn.phase !== PHASES.DISCARD) {
        return illegal('Cannot end turn from the current phase.');
    }
    if (turn.phase === PHASES.DISCARD && player.hand.length > HAND_LIMIT) {
        return illegal('Must discard down to ' + HAND_LIMIT + ' cards before ending the turn.');
    }
    return legal();
}

// ---------------------------------------------------------------------------
// Public dispatcher
// ---------------------------------------------------------------------------

/**
 * @param {GameState} state
 * @param {Action} action
 * @returns {ValidationResult}
 */
function validateAction(state, action) {
    if (!state || !state.turn) {
        return illegal('Game has no active turn.');
    }
    if (!action || !action.type) {
        return illegal('Action is missing a type.');
    }
    // Double The Rent is represented only as an optional companion card on the
    // atomic PLAY_ACTION_CARD Rent path. Presence (not truthiness) matters: a
    // malformed empty/non-string companion must not slip through as an ordinary
    // action and cannot affect turn structure.
    var hasDoubleRentCardId = Object.prototype.hasOwnProperty.call(action, 'doubleRentCardId');
    if (hasDoubleRentCardId && (action.type !== ACTION_TYPES.PLAY_ACTION_CARD ||
        typeof action.doubleRentCardId !== 'string' || action.doubleRentCardId.trim() === '')) {
        return illegal('Double The Rent may only be used with a Rent action and requires a card ID.');
    }
    if (hasOutstandingPendingCharge(state) && action.type !== ACTION_TYPES.PAY_RENT) {
        return illegal('A pending payment is outstanding; it must be resolved with PAY_RENT before any other action.');
    }
    switch (action.type) {
        case ACTION_TYPES.DRAW:
            return validateDrawAction(state, action);
        case ACTION_TYPES.JUST_SAY_NO:
            return validateJustSayNoAction(state, action);
        case ACTION_TYPES.REARRANGE:
            return validateRearrangeAction(state, action);
        case ACTION_TYPES.PLAY_CARD:
            return validatePlayCardAction(state, action);
        case ACTION_TYPES.PLAY_ACTION_CARD:
            return validatePlayCardAction(state, action);
        case ACTION_TYPES.DISCARD:
            return validateDiscardAction(state, action);
        case ACTION_TYPES.END_TURN:
            return validateEndTurnAction(state, action);
        case ACTION_TYPES.PAY_BANK:
            return validatePayBankTurnAction(state, action);
        case ACTION_TYPES.PAY_RENT:
            return validatePendingChargePaymentAction(state, action);
        default:
            return illegal('Unknown action type: ' + action.type);
    }
}

/**
 * Applies an already-validated action's *turn-structure* side effects
 * (play/draw counters, phase transitions) and returns a new GameState.
 * Does not move cards between hand/bank/board — that remains the caller's
 * responsibility (or a future card-effects module's).
 *
 * Throws if the action is not legal; always call validateAction() first,
 * or rely on this function's internal re-check.
 *
 * @param {GameState} state
 * @param {Action} action
 * @returns {GameState}
 */
function applyValidatedAction(state, action) {
    var result = validateAction(state, action);
    if (!result.legal) {
        throw new Error('applyValidatedAction: illegal action - ' + result.reason);
    }

    var nextTurn = Object.assign({}, state.turn);

    switch (action.type) {
        case ACTION_TYPES.DRAW:
            nextTurn.hasDrawn = true;
            nextTurn.phase = PHASES.ACTION;
            break;
        case ACTION_TYPES.PLAY_CARD:
        case ACTION_TYPES.PLAY_ACTION_CARD:
            // Rent + Double The Rent is one action that consumes two plays; see
            // validatePlayCardAction. Every other play consumes one.
            nextTurn.playsMade = nextTurn.playsMade + (action.doubleRentCardId ? 2 : 1);
            break;
        case ACTION_TYPES.JUST_SAY_NO:
        case ACTION_TYPES.REARRANGE:
            // No turn-counter change; these are free actions.
            break;
        case ACTION_TYPES.DISCARD: {
            var player = state.players[action.playerId];
            var willBeAtLimit = player.hand.length - 1 <= HAND_LIMIT;
            if (willBeAtLimit) {
                nextTurn.phase = PHASES.COMPLETE;
            }
            break;
        }
        case ACTION_TYPES.END_TURN: {
            var currentPlayer = state.players[action.playerId];
            if (nextTurn.phase === PHASES.ACTION && currentPlayer.hand.length > HAND_LIMIT) {
                nextTurn.phase = PHASES.DISCARD;
            } else {
                nextTurn.phase = PHASES.COMPLETE;
            }
            break;
        }
        default:
            break;
    }

    return Object.assign({}, state, { turn: nextTurn });
}

// ---------------------------------------------------------------------------
// Extended Action & Dry-Run Validation Helpers
// ---------------------------------------------------------------------------

function validatePropertyPlacementAction(state, action) {
    var errors = [];
    var player = state.players[action.playerId];
    if (!player) return { errors: ['Unknown player.'] };

    var card = (player.hand || []).find(function (c) { return c.id === action.cardId; });
    if (!card) {
        return { errors: ['Card ' + action.cardId + ' is not in player hand.'] };
    }

    if (card.value !== undefined && card.value >= 0 && !card.type && !card.types) {
        errors.push('Money cards cannot be placed directly into property sets.');
    } else if (card.action || card.description) {
        errors.push('Action cards (unless wildcard/property) cannot be placed in property sets.');
    }

    if (action.propertyColor) {
        if (!COMPLETE_SET_SIZE[action.propertyColor]) {
            errors.push('Invalid property color: ' + action.propertyColor);
        } else if (card.type && card.type !== action.propertyColor) {
            errors.push('Property card color ' + card.type + ' does not match target set ' + action.propertyColor);
        } else if (card.types && Array.isArray(card.types) && card.types.length === 2 && !card.types.includes(action.propertyColor)) {
            errors.push('Wildcard ' + (card.name || card.title || 'wildcard') + ' is not eligible for color ' + action.propertyColor);
        }
    }

    return { errors: errors };
}

function validateBankZoneEligibility(state, action) {
    var errors = [];
    var player = state.players[action.playerId];
    if (!player) return { errors: ['Unknown player.'] };

    var card = (player.hand || []).find(function (c) { return c.id === action.cardId; });
    if (!card) {
        return { errors: ['Card ' + action.cardId + ' is not in player hand.'] };
    }

    if (card.type || (card.types && !card.action)) {
        errors.push('Standard property and property wildcards cannot be banked as money.');
    }

    return { errors: errors };
}

function validateBankPaymentAction(state, action) {
    var errors = [];
    var player = state.players[action.playerId];
    if (!player) return { errors: ['Unknown player.'] };

    if (!action.cardIds || !Array.isArray(action.cardIds) || action.cardIds.length === 0) {
        return { errors: ['PAY_BANK action requires non-empty cardIds array.'] };
    }

    var seen = new Set();
    for (var i = 0; i < action.cardIds.length; i++) {
        var cid = action.cardIds[i];
        if (seen.has(cid)) {
            errors.push('Duplicate card ID in payment: ' + cid);
        }
        seen.add(cid);

        var inHand = (player.hand || []).find(function (c) { return c.id === cid; });
        var inBank = (player.bank || []).find(function (c) { return c.id === cid; });
        if (!inHand && !inBank) {
            errors.push('Payment card ' + cid + ' is not owned in hand or bank by player.');
        } else {
            var card = inHand || inBank;
            if (card.type && !card.action) {
                errors.push('Property card ' + cid + ' cannot be used for direct bank payment.');
            }
        }
    }

    return { errors: errors };
}

function projectHandSizeAfterAction(state, action) {
    var player = state.players[action.playerId];
    if (!player) return 0;
    var current = (player.hand || []).length;

    if (action.type === ACTION_TYPES.DRAW) {
        return current + (action.count || 2);
    } else if (action.type === ACTION_TYPES.PLAY_CARD || action.type === ACTION_TYPES.DISCARD) {
        return Math.max(0, current - 1);
    } else if (action.type === ACTION_TYPES.PAY_BANK && Array.isArray(action.cardIds)) {
        var handPaid = action.cardIds.filter(function (id) {
            return (player.hand || []).some(function (c) { return c.id === id; });
        }).length;
        return Math.max(0, current - handPaid);
    }
    return current;
}

function validatePlayerAction(gameState, playerId, action) {
    var errors = [];
    var warnings = [];
    var mergedAction = Object.assign({}, action, { playerId: playerId });

    if (!gameState || !gameState.players || !gameState.players[playerId]) {
        return { valid: false, errors: ['Unknown playerId: ' + playerId], warnings: [], actionSummary: null };
    }
    if (!mergedAction.type) {
        return { valid: false, errors: ['Action is missing a type.'], warnings: [], actionSummary: null };
    }

    var turnResult = validateAction(gameState, mergedAction);
    if (!turnResult.legal) {
        errors.push(turnResult.reason || 'Action is not legal for turn phase.');
    }

    if (mergedAction.type === ACTION_TYPES.PLAY_CARD && mergedAction.targetZone === 'properties') {
        var propRes = validatePropertyPlacementAction(gameState, mergedAction);
        if (propRes.errors.length > 0) errors.push.apply(errors, propRes.errors);
    }
    if (mergedAction.type === ACTION_TYPES.PLAY_CARD && mergedAction.targetZone === 'bank') {
        var bankRes = validateBankZoneEligibility(gameState, mergedAction);
        if (bankRes.errors.length > 0) errors.push.apply(errors, bankRes.errors);
    }
    if (mergedAction.type === ACTION_TYPES.PAY_BANK) {
        var payRes = validateBankPaymentAction(gameState, mergedAction);
        if (payRes.errors.length > 0) errors.push.apply(errors, payRes.errors);
    }

    var projectedHandSize = projectHandSizeAfterAction(gameState, mergedAction);
    if (projectedHandSize > HAND_LIMIT) {
        warnings.push('Hand will have ' + projectedHandSize + ' cards after this action; discard to ' + HAND_LIMIT + ' will be required before ending the turn.');
    }

    var phaseAfter = gameState.turn ? gameState.turn.phase : 'UNKNOWN';
    var playsMadeAfter = gameState.turn ? gameState.turn.playsMade : 0;
    if (errors.length === 0 && gameState.turn) {
        var clone = JSON.parse(JSON.stringify(gameState));
        var projected = applyValidatedAction(clone, mergedAction);
        if (projected && projected.turn) {
            phaseAfter = projected.turn.phase;
            playsMadeAfter = projected.turn.playsMade;
        }
    }

    var actionSummary = {
        playerId: playerId,
        actionType: mergedAction.type,
        cardId: mergedAction.cardId || null,
        targetZone: mergedAction.targetZone || null,
        propertyColor: mergedAction.propertyColor || null,
        phaseBefore: gameState.turn ? gameState.turn.phase : null,
        phaseAfter: phaseAfter,
        playsMadeBefore: gameState.turn ? gameState.turn.playsMade : 0,
        playsMadeAfter: playsMadeAfter,
        projectedHandSize: projectedHandSize,
        handLimitExceeded: projectedHandSize > HAND_LIMIT,
        countsTowardPlayLimit: !!turnResult.countsTowardPlayLimit
    };

    return {
        valid: errors.length === 0,
        errors: errors,
        warnings: warnings,
        actionSummary: actionSummary
    };
}

// ---------------------------------------------------------------------------
// Rent Calculation & Payment Validation (v2.0)
// ---------------------------------------------------------------------------

function calculateRentAmount(state, ownerId, propertyColor) {
    if (!state || !state.players) {
        return { errors: ['Invalid state provided'] };
    }
    var owner = state.players[ownerId];
    if (!owner) {
        return { errors: ['Unknown player: ' + ownerId] };
    }
    if (!COMPLETE_SET_SIZE[propertyColor]) {
        return { errors: ['Invalid property color: ' + propertyColor] };
    }

    var group = (owner.properties && owner.properties[propertyColor]) || { cards: [], hasHouse: false, hasHotel: false };
    var cardsOwned = group.cards ? group.cards.length : 0;
    var setSize = COMPLETE_SET_SIZE[propertyColor];
    var isCompleteSet = cardsOwned >= setSize;

    var tiers = (RENT_TIERS && RENT_TIERS[propertyColor]) || [];
    var tierIndex = Math.min(cardsOwned, tiers.length) - 1;
    var baseRent = tierIndex >= 0 ? tiers[tierIndex] : 0;

    var fullSetMultiplierApplied = isCompleteSet && baseRent > 0;
    var rentAfterMultiplier = fullSetMultiplierApplied ? baseRent * FULL_SET_RENT_MULTIPLIER : baseRent;

    var eligibleForBonus = HOUSE_HOTEL_EXCLUDED_COLORS.indexOf(propertyColor) === -1 && isCompleteSet;
    var houseBonus = eligibleForBonus && group.hasHouse ? HOUSE_RENT_BONUS : 0;
    var hotelBonus = eligibleForBonus && group.hasHotel ? HOTEL_RENT_BONUS : 0;

    var totalRent = rentAfterMultiplier + houseBonus + hotelBonus;

    var breakdown = [
        { label: 'base (' + cardsOwned + ' cards)', amount: baseRent }
    ];
    if (fullSetMultiplierApplied) {
        breakdown.push({ label: 'full-set x' + FULL_SET_RENT_MULTIPLIER, amount: rentAfterMultiplier - baseRent });
    }
    if (houseBonus) {
        breakdown.push({ label: 'house', amount: houseBonus });
    }
    if (hotelBonus) {
        breakdown.push({ label: 'hotel', amount: hotelBonus });
    }

    return {
        errors: [],
        color: propertyColor,
        cardsOwned: cardsOwned,
        isCompleteSet: isCompleteSet,
        baseRent: baseRent,
        fullSetMultiplierApplied: fullSetMultiplierApplied,
        houseBonus: houseBonus,
        hotelBonus: hotelBonus,
        totalRent: totalRent,
        breakdown: breakdown
    };
}

function validateRentPaymentAction(state, action) {
    var errors = [];
    if (!state || !state.players) return { errors: ['Invalid state provided'] };
    if (!action) return { errors: ['Action is required'] };

    var payerId = action.playerId;
    var toPlayerId = action.toPlayerId;
    var propertyColor = action.propertyColor;

    if (!payerId) errors.push('Payer playerId is required');
    if (!toPlayerId) errors.push('Recipient toPlayerId is required');
    if (payerId && toPlayerId && payerId === toPlayerId) {
        errors.push('Payer and recipient cannot be the same player');
    }

    var payer = state.players[payerId];
    var recipient = state.players[toPlayerId];

    if (!payer) errors.push('Unknown payer player: ' + payerId);
    if (!recipient) errors.push('Unknown recipient player: ' + toPlayerId);

    var rentAmount = calculateRentAmount(state, toPlayerId, propertyColor);
    if (rentAmount.errors && rentAmount.errors.length) {
        errors = errors.concat(rentAmount.errors);
    } else if (rentAmount.cardsOwned === 0) {
        errors.push(toPlayerId + ' owns no ' + propertyColor + ' cards; no rent is owed.');
    }

    if (errors.length > 0) {
        return { errors: errors, rentAmount: rentAmount, settlementValue: 0, shortfall: rentAmount.totalRent || 0 };
    }

    var cardIds = action.cardIds || [];
    var propertyCardIds = action.propertyCardIds || [];

    var settlementValue = 0;
    var usedCardIds = {};

    for (var i = 0; i < cardIds.length; i++) {
        var cid = cardIds[i];
        if (usedCardIds[cid]) {
            errors.push('Duplicate card ID in payment: ' + cid);
            continue;
        }
        usedCardIds[cid] = true;

        var foundInHand = payer.hand && payer.hand.find(function (c) { return c.id === cid; });
        var foundInBank = payer.bank && payer.bank.find(function (c) { return c.id === cid; });
        var card = foundInHand || foundInBank;

        if (!card) {
            errors.push('Card ' + cid + ' not found in player ' + payerId + ' hand or bank');
            continue;
        }

        var cardVal = typeof card.value === 'number' ? card.value : (parseInt(card.value, 10) || 0);
        settlementValue += cardVal;
    }

    for (var j = 0; j < propertyCardIds.length; j++) {
        var pid = propertyCardIds[j];
        if (usedCardIds[pid]) {
            errors.push('Duplicate property card ID in payment: ' + pid);
            continue;
        }
        usedCardIds[pid] = true;

        var foundProp = null;
        if (payer.properties) {
            Object.keys(payer.properties).forEach(function (col) {
                var group = payer.properties[col];
                if (group && group.cards) {
                    var match = group.cards.find(function (c) { return c.id === pid; });
                    if (match) foundProp = match;
                }
            });
        }

        if (!foundProp) {
            errors.push('Property card ' + pid + ' not found in player ' + payerId + ' properties');
            continue;
        }

        var propVal = typeof foundProp.value === 'number' ? foundProp.value : (parseInt(foundProp.value, 10) || 0);
        settlementValue += propVal;
    }

    var totalRent = rentAmount.totalRent || 0;
    var shortfall = Math.max(0, totalRent - settlementValue);

    if (shortfall > 0) {
        var totalAvailable = 0;
        if (payer.hand) {
            payer.hand.forEach(function (c) {
                totalAvailable += typeof c.value === 'number' ? c.value : (parseInt(c.value, 10) || 0);
            });
        }
        if (payer.bank) {
            payer.bank.forEach(function (c) {
                totalAvailable += typeof c.value === 'number' ? c.value : (parseInt(c.value, 10) || 0);
            });
        }
        if (payer.properties) {
            Object.keys(payer.properties).forEach(function (col) {
                var group = payer.properties[col];
                if (group && group.cards) {
                    group.cards.forEach(function (c) {
                        totalAvailable += typeof c.value === 'number' ? c.value : (parseInt(c.value, 10) || 0);
                    });
                }
            });
        }

        if (settlementValue < totalAvailable) {
            errors.push('Payment of ' + settlementValue + ' is short of ' + totalRent + ' rent owed and does not use all available assets.');
        }
    }

    return {
        errors: errors,
        rentAmount: rentAmount,
        settlementValue: settlementValue,
        shortfall: shortfall
    };
}

// ---------------------------------------------------------------------------
// Pending Charge Payment (Debt Collector / Its My Birthday) Validation
// ---------------------------------------------------------------------------

/** @returns {boolean} true if the game has a charge in flight still owed by someone. */
function hasOutstandingPendingCharge(state) {
    var pending = state && state.pendingCharge;
    return !!(pending && pending.debtors && Object.keys(pending.debtors).length > 0);
}

/**
 * Finds a payable asset owned by `player` across bank and property groups.
 * Hand cards are not valid payment assets.
 * @returns {?{card: CardRef, zone: 'bank'|'properties', color: ?string}}
 */
function findPlayerAssetCard(player, cardId) {
    if (!player) return null;

    var inBank = (player.bank || []).find(function (c) { return c.id === cardId; });
    if (inBank) return { card: inBank, zone: 'bank', color: null };

    var found = null;
    Object.keys(player.properties || {}).forEach(function (color) {
        if (found) return;
        var group = player.properties[color];
        var match = group && group.cards && group.cards.find(function (c) { return c.id === cardId; });
        if (match) found = { card: match, zone: 'properties', color: color };
    });
    return found;
}

/** @returns {number} total value of every payable asset the player owns across bank and properties. */
function sumPlayerAssetsValue(player) {
    if (!player) return 0;
    var total = 0;
    var addValue = function (c) {
        total += typeof c.value === 'number' ? c.value : (parseInt(c.value, 10) || 0);
    };
    (player.bank || []).forEach(addValue);
    Object.keys(player.properties || {}).forEach(function (color) {
        var group = player.properties[color];
        (group && group.cards ? group.cards : []).forEach(addValue);
    });
    return total;
}

/**
 * Validates a PAY_RENT action settling an outstanding pendingCharge (Debt
 * Collector / Its My Birthday). Distinct from validateRentPaymentAction,
 * which prices actual property-rent demands; here the amount owed comes
 * from the pendingCharge record created when the charge card was played.
 * @returns {ValidationResult}
 */
function validatePendingChargePaymentAction(state, action) {
    var pending = state && state.pendingCharge;
    var debtorEntry = pending && pending.debtors && pending.debtors[action.playerId];
    if (!debtorEntry) {
        return illegal('No pending charge payment is owed by this player.');
    }

    var payer = state.players[action.playerId];
    if (!payer) {
        return illegal('Unknown player: ' + action.playerId);
    }

    var cardIds = action.paymentCardIds || action.cardIds || [];
    if (!Array.isArray(cardIds)) {
        return illegal('paymentCardIds must be an array.');
    }

    var seen = {};
    var settlementValue = 0;
    for (var i = 0; i < cardIds.length; i++) {
        var cid = cardIds[i];
        if (seen[cid]) {
            return illegal('Duplicate card ID in payment: ' + cid);
        }
        seen[cid] = true;

        var found = findPlayerAssetCard(payer, cid);
        if (!found) {
            return illegal('Payment card ' + cid + ' is not owned by player ' + action.playerId + '.');
        }
        settlementValue += typeof found.card.value === 'number' ? found.card.value : (parseInt(found.card.value, 10) || 0);
    }

    var amountOwed = debtorEntry.amountOwed;
    var totalAvailable = sumPlayerAssetsValue(payer);

    if (settlementValue < amountOwed && settlementValue < totalAvailable) {
        return illegal('Payment of ' + settlementValue + ' is short of ' + amountOwed + ' owed and does not use all available assets.');
    }

    return legal({ countsTowardPlayLimit: false, amountOwed: amountOwed, settlementValue: settlementValue });
}

// ---------------------------------------------------------------------------
// Action Card Rules & Validation
// ---------------------------------------------------------------------------

function isCompletePropertySet(state, playerId, color) {
    var player = state && state.players && state.players[playerId];
    var group = player && player.properties && player.properties[color];
    var cardsOwned = group && group.cards ? group.cards.length : 0;
    return cardsOwned >= (COMPLETE_SET_SIZE[color] || Infinity);
}

var WIN_REQUIRED_SET_COUNT = 3;

function checkWinCondition(playerState) {
    var properties = (playerState && playerState.properties) || {};
    var completedSetColors = Object.keys(COMPLETE_SET_SIZE).filter(function (color) {
        var group = properties[color];
        var cardsOwned = group && group.cards ? group.cards.length : 0;
        return cardsOwned >= COMPLETE_SET_SIZE[color];
    });
    var isWinner = completedSetColors.length >= WIN_REQUIRED_SET_COUNT;
    var details = isWinner
        ? 'Player completed ' + completedSetColors.length + ' full sets (' + completedSetColors.join(', ') + ')'
        : 'Player has ' + completedSetColors.length + ' complete sets';
    return {
        isWinner: isWinner,
        completedSetColors: completedSetColors,
        details: details
    };
}

function validateDebtCollectorTarget(state, action) {
    var errors = [];
    if (!action.targetPlayerId) {
        errors.push('targetPlayerId is required for Debt Collector');
    } else if (action.targetPlayerId === action.playerId) {
        errors.push('Cannot target self for Debt Collector');
    } else if (!state.players || !state.players[action.targetPlayerId]) {
        errors.push('Target player ' + action.targetPlayerId + ' does not exist in game');
    }
    return errors;
}

function validateDealBreakerTarget(state, action) {
    var errors = [];
    if (!action.targetPlayerId) {
        errors.push('targetPlayerId is required for Deal Breaker');
    } else if (action.targetPlayerId === action.playerId) {
        errors.push('Cannot target self for Deal Breaker');
    } else if (!state.players || !state.players[action.targetPlayerId]) {
        errors.push('Target player ' + action.targetPlayerId + ' does not exist in game');
    }

    if (!action.targetPropertyColor) {
        errors.push('targetPropertyColor is required for Deal Breaker');
    } else if (!COMPLETE_SET_SIZE[action.targetPropertyColor]) {
        errors.push('Invalid property color: ' + action.targetPropertyColor);
    } else if (action.targetPlayerId && state.players && state.players[action.targetPlayerId]) {
        if (!isCompletePropertySet(state, action.targetPlayerId, action.targetPropertyColor)) {
            errors.push('Deal Breaker can only steal a complete property set. Target set ' + action.targetPropertyColor + ' is incomplete.');
        }
    }
    return errors;
}

function validateSlyDealTarget(state, action) {
    var errors = [];
    if (!action.targetPlayerId) {
        errors.push('targetPlayerId is required for Sly Deal');
    } else if (action.targetPlayerId === action.playerId) {
        errors.push('Cannot target self for Sly Deal');
    } else if (!state.players || !state.players[action.targetPlayerId]) {
        errors.push('Target player ' + action.targetPlayerId + ' does not exist in game');
    }

    if (!action.targetPropertyColor) {
        errors.push('targetPropertyColor is required for Sly Deal');
    } else if (!COMPLETE_SET_SIZE[action.targetPropertyColor]) {
        errors.push('Invalid property color: ' + action.targetPropertyColor);
    }

    if (!action.targetCardId) {
        errors.push('targetCardId is required for Sly Deal');
    }

    if (action.targetPlayerId && action.targetPropertyColor && state.players && state.players[action.targetPlayerId]) {
        if (isCompletePropertySet(state, action.targetPlayerId, action.targetPropertyColor)) {
            errors.push('Sly Deal cannot steal from a complete property set; use Deal Breaker instead.');
        }
        var targetPlayer = state.players[action.targetPlayerId];
        var group = targetPlayer.properties && targetPlayer.properties[action.targetPropertyColor];
        var card = group && group.cards && group.cards.find(function (c) { return c.id === action.targetCardId; });
        if (!card && action.targetCardId) {
            errors.push('Target card ' + action.targetCardId + ' is not in ' + action.targetPlayerId + '\'s ' + action.targetPropertyColor + ' property set.');
        }
    }
    return errors;
}

function validateForcedDealTarget(state, action) {
    var errors = [];
    if (!action.targetPlayerId) {
        errors.push('targetPlayerId is required for Forced Deal');
    } else if (action.targetPlayerId === action.playerId) {
        errors.push('Cannot target self for Forced Deal');
    } else if (!state.players || !state.players[action.targetPlayerId]) {
        errors.push('Target player ' + action.targetPlayerId + ' does not exist in game');
    }

    if (!action.offeredCardId || !action.offeredPropertyColor) {
        errors.push('offeredCardId and offeredPropertyColor are required for Forced Deal');
    } else if (!COMPLETE_SET_SIZE[action.offeredPropertyColor]) {
        errors.push('Invalid offered property color: ' + action.offeredPropertyColor);
    }

    if (!action.requestedCardId || !action.requestedPropertyColor) {
        errors.push('requestedCardId and requestedPropertyColor are required for Forced Deal');
    } else if (!COMPLETE_SET_SIZE[action.requestedPropertyColor]) {
        errors.push('Invalid requested property color: ' + action.requestedPropertyColor);
    }

    if (state.players) {
        var actor = state.players[action.playerId];
        if (actor && action.offeredPropertyColor && action.offeredCardId) {
            if (isCompletePropertySet(state, action.playerId, action.offeredPropertyColor)) {
                errors.push('Cannot offer a property from a complete set in Forced Deal.');
            }
            var offerGroup = actor.properties && actor.properties[action.offeredPropertyColor];
            var offerCard = offerGroup && offerGroup.cards && offerGroup.cards.find(function (c) { return c.id === action.offeredCardId; });
            if (!offerCard) {
                errors.push('Offered card ' + action.offeredCardId + ' is not in actor\'s ' + action.offeredPropertyColor + ' property set.');
            }
        }

        if (action.targetPlayerId && state.players[action.targetPlayerId] && action.requestedPropertyColor && action.requestedCardId) {
            if (isCompletePropertySet(state, action.targetPlayerId, action.requestedPropertyColor)) {
                errors.push('Cannot request a property from a complete set in Forced Deal.');
            }
            var targetPlayer = state.players[action.targetPlayerId];
            var reqGroup = targetPlayer.properties && targetPlayer.properties[action.requestedPropertyColor];
            var reqCard = reqGroup && reqGroup.cards && reqGroup.cards.find(function (c) { return c.id === action.requestedCardId; });
            if (!reqCard) {
                errors.push('Requested card ' + action.requestedCardId + ' is not in target\'s ' + action.requestedPropertyColor + ' property set.');
            }
        }
    }
    return errors;
}

function describeActionCardEffect(action) {
    switch (action.cardTitle) {
        case ACTION_CARD_TITLES.PASS_GO:
            return { type: 'DRAW', count: 2 };
        case ACTION_CARD_TITLES.DEBT_COLLECTOR:
            return { type: 'COLLECT', amount: DEBT_COLLECTOR_AMOUNT, fromPlayerId: action.targetPlayerId || null };
        case ACTION_CARD_TITLES.BIRTHDAY:
            return { type: 'COLLECT_ALL', amountEach: BIRTHDAY_AMOUNT };
        case ACTION_CARD_TITLES.DEAL_BREAKER:
            return { type: 'STEAL_SET', color: action.targetPropertyColor || null, fromPlayerId: action.targetPlayerId || null };
        case ACTION_CARD_TITLES.SLY_DEAL:
            return { type: 'STEAL_PROPERTY', cardId: action.targetCardId || null, color: action.targetPropertyColor || null, fromPlayerId: action.targetPlayerId || null };
        case ACTION_CARD_TITLES.FORCED_DEAL:
            return {
                type: 'SWAP_PROPERTY',
                give: { cardId: action.offeredCardId || null, color: action.offeredPropertyColor || null },
                take: { cardId: action.requestedCardId || null, color: action.requestedPropertyColor || null },
                withPlayerId: action.targetPlayerId || null
            };
        case ACTION_CARD_TITLES.JUST_SAY_NO:
            return { type: 'CANCEL' };
        default:
            return { type: 'UNKNOWN' };
    }
}

function validateActionCardPlay(state, action) {
    if (!state || !state.players) return { legal: false, errors: ['Invalid state provided'], actionSummary: null };
    if (!action || !action.cardTitle) return { legal: false, errors: ['action.cardTitle is required'], actionSummary: null };

    if (action.cardTitle === ACTION_CARD_TITLES.JUST_SAY_NO) {
        var jsn = validateJustSayNoAction(state, action);
        return {
            legal: jsn.legal,
            errors: jsn.legal ? [] : [jsn.reason],
            actionSummary: {
                playerId: action.playerId,
                cardTitle: action.cardTitle,
                cancels: state.pendingActionResolution ? state.pendingActionResolution.sourceCard : null
            }
        };
    }

    var errors = [];
    var turnCheck = validatePlayCardAction(state, action);
    if (!turnCheck.legal) errors.push(turnCheck.reason);

    var player = state.players[action.playerId];
    var card = player && (player.hand || []).find(function (c) { return c.id === action.cardId; });
    if (player && !card) errors.push('Card ' + action.cardId + ' is not in player hand.');
    else if (card && card.title !== action.cardTitle) errors.push('Card ' + action.cardId + ' is not a ' + action.cardTitle + '.');

    var eligibleResponderIds = [];
    switch (action.cardTitle) {
        case ACTION_CARD_TITLES.PASS_GO:
            break;
        case ACTION_CARD_TITLES.DEBT_COLLECTOR:
            errors = errors.concat(validateDebtCollectorTarget(state, action));
            eligibleResponderIds = action.targetPlayerId ? [action.targetPlayerId] : [];
            break;
        case ACTION_CARD_TITLES.BIRTHDAY:
            eligibleResponderIds = (state.turnOrder || []).filter(function (id) { return id !== action.playerId; });
            break;
        case ACTION_CARD_TITLES.DEAL_BREAKER:
            errors = errors.concat(validateDealBreakerTarget(state, action));
            eligibleResponderIds = action.targetPlayerId ? [action.targetPlayerId] : [];
            break;
        case ACTION_CARD_TITLES.SLY_DEAL:
            errors = errors.concat(validateSlyDealTarget(state, action));
            eligibleResponderIds = action.targetPlayerId ? [action.targetPlayerId] : [];
            break;
        case ACTION_CARD_TITLES.FORCED_DEAL:
            errors = errors.concat(validateForcedDealTarget(state, action));
            eligibleResponderIds = action.targetPlayerId ? [action.targetPlayerId] : [];
            break;
        default:
            errors.push('Unknown action card: ' + action.cardTitle);
    }

    return {
        legal: errors.length === 0,
        errors: errors,
        actionSummary: {
            playerId: action.playerId,
            cardTitle: action.cardTitle,
            cardId: action.cardId || null,
            targetPlayerId: action.targetPlayerId || null,
            countsTowardPlayLimit: true,
            eligibleResponderIds: eligibleResponderIds,
            effect: describeActionCardEffect(action)
        }
    };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    HAND_LIMIT: HAND_LIMIT,
    MAX_PLAYS_PER_TURN: MAX_PLAYS_PER_TURN,
    NORMAL_DRAW_COUNT: NORMAL_DRAW_COUNT,
    EMPTY_HAND_DRAW_COUNT: EMPTY_HAND_DRAW_COUNT,
    FULL_SET_RENT_MULTIPLIER: FULL_SET_RENT_MULTIPLIER,
    HOUSE_RENT_BONUS: HOUSE_RENT_BONUS,
    HOTEL_RENT_BONUS: HOTEL_RENT_BONUS,
    PHASES: PHASES,
    ACTION_TYPES: ACTION_TYPES,
    ACTION_CARD_TITLES: ACTION_CARD_TITLES,
    DEBT_COLLECTOR_AMOUNT: DEBT_COLLECTOR_AMOUNT,
    BIRTHDAY_AMOUNT: BIRTHDAY_AMOUNT,
    COMPLETE_SET_SIZE: COMPLETE_SET_SIZE,
    getRequiredDrawCount: getRequiredDrawCount,
    startTurn: startTurn,
    validateAction: validateAction,
    applyValidatedAction: applyValidatedAction,
    validatePlayerAction: validatePlayerAction,
    validatePropertyPlacementAction: validatePropertyPlacementAction,
    validateBankZoneEligibility: validateBankZoneEligibility,
    validateBankPaymentAction: validateBankPaymentAction,
    calculateRentAmount: calculateRentAmount,
    validateRentPaymentAction: validateRentPaymentAction,
    hasOutstandingPendingCharge: hasOutstandingPendingCharge,
    findPlayerAssetCard: findPlayerAssetCard,
    sumPlayerAssetsValue: sumPlayerAssetsValue,
    validatePendingChargePaymentAction: validatePendingChargePaymentAction,
    projectHandSizeAfterAction: projectHandSizeAfterAction,
    isCompletePropertySet: isCompletePropertySet,
    WIN_REQUIRED_SET_COUNT: WIN_REQUIRED_SET_COUNT,
    checkWinCondition: checkWinCondition,
    validateDebtCollectorTarget: validateDebtCollectorTarget,
    validateDealBreakerTarget: validateDealBreakerTarget,
    validateSlyDealTarget: validateSlyDealTarget,
    validateForcedDealTarget: validateForcedDealTarget,
    describeActionCardEffect: describeActionCardEffect,
    validateActionCardPlay: validateActionCardPlay,
    // Exposed individually for testing
    validateDrawAction: validateDrawAction,
    validateJustSayNoAction: validateJustSayNoAction,
    validateRearrangeAction: validateRearrangeAction,
    validatePlayCardAction: validatePlayCardAction,
    validateDiscardAction: validateDiscardAction,
    validateEndTurnAction: validateEndTurnAction
};

// ---------------------------------------------------------------------------
// Smoke test (run directly with `node rules_validator.js`). Not a substitute
// for a real test suite - see RULES_SPEC.md Section 7 for that next slice.
// ---------------------------------------------------------------------------

if (require.main === module) {
    var assert = require('assert');

    var state = {
        players: {
            p1: { id: 'p1', name: 'Scott', hand: [], bank: [], properties: {} },
            p2: { id: 'p2', name: 'Riri', hand: [], bank: [], properties: {} }
        },
        turnOrder: ['p1', 'p2'],
        turn: null,
        pendingActionResolution: null
    };

    // Empty hand at start of turn -> must draw 5.
    state.turn = startTurn(state, 'p1');
    assert.strictEqual(getRequiredDrawCount(state.turn.handSizeAtStartOfTurn), 5);
    assert.strictEqual(validateAction(state, { type: 'DRAW', playerId: 'p1', count: 2 }).legal, false);
    var afterDraw = applyValidatedAction(state, { type: 'DRAW', playerId: 'p1', count: 5 });
    assert.strictEqual(afterDraw.turn.phase, PHASES.ACTION);

    // 3-play limit, Just Say No and rearrange don't count against it.
    state.players.p1.hand = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }];
    state.turn = afterDraw.turn;
    state.pendingActionResolution = { sourceCard: 'Sly Deal', fromPlayerId: 'p2', eligibleResponderIds: ['p1'] };
    state = applyValidatedAction(state, { type: 'JUST_SAY_NO', playerId: 'p1' });
    state = applyValidatedAction(state, { type: 'REARRANGE', playerId: 'p1' });
    assert.strictEqual(state.turn.playsMade, 0, 'JSN/rearrange must not count toward the 3-play limit');

    state = applyValidatedAction(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: 'c1' });
    state = applyValidatedAction(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: 'c2' });
    state = applyValidatedAction(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: 'c3' });
    assert.strictEqual(state.turn.playsMade, 3);
    assert.strictEqual(validateAction(state, { type: 'PLAY_CARD', playerId: 'p1', cardId: 'c4' }).legal, false);

    // Hand limit: 8 cards -> must discard down to 7 before ending turn.
    state.players.p1.hand = new Array(8).fill(0).map(function (_, i) { return { id: 'h' + i }; });
    assert.strictEqual(validateAction(state, { type: 'END_TURN', playerId: 'p1' }).legal, true);
    state = applyValidatedAction(state, { type: 'END_TURN', playerId: 'p1' });
    assert.strictEqual(state.turn.phase, PHASES.DISCARD);
    assert.strictEqual(validateAction(state, { type: 'END_TURN', playerId: 'p1' }).legal, false);
    assert.strictEqual(validateAction(state, { type: 'DISCARD', playerId: 'p1', cardId: 'h0' }).legal, true);
    state = applyValidatedAction(state, { type: 'DISCARD', playerId: 'p1', cardId: 'h0' });
    state.players.p1.hand.pop();
    assert.strictEqual(state.turn.phase, PHASES.COMPLETE);

    console.log('rules_validator.js smoke test passed.');
}
