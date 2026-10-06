/**
 * game_manager.js
 *
 * Authoritative Game Session and State Manager for Monopoly Deal.
 * Integrates rules_validator.js with actual card asset mutations (drawing,
 * playing, discarding, and turn rotation) to provide a fully validated game loop.
 */

'use strict';

const crypto = require('crypto');
const {
    HAND_LIMIT,
    PHASES,
    ACTION_TYPES,
    COMPLETE_SET_SIZE,
    getRequiredDrawCount,
    startTurn,
    validateAction,
    applyValidatedAction,
    checkWinCondition,
    calculateRentAmount,
    describeActionCardEffect,
    validateDealBreakerTarget,
    validateSlyDealTarget,
    validateForcedDealTarget
} = require('./rules_validator');
const Deck = require('./models/Deck');
const cardEffects = require('./card_effects');

/**
 * Creates a fresh, authoritative GameState for a set of players.
 * @param {Array<{id: string, name: string}>} playerList
 * @returns {Object} GameState
 */
function createGameState(playerList) {
    if (!playerList || playerList.length < 2) {
        throw new Error('Cannot start a game with fewer than 2 players.');
    }

    const players = {};
    const turnOrder = [];

    // Initialize players
    playerList.forEach(p => {
        players[p.id] = {
            id: p.id,
            name: p.name,
            hand: [],
            bank: [],
            properties: {} // Keyed by color, e.g. "Green": { cards: [], hasHouse: false, hasHotel: false }
        };
        turnOrder.push(p.id);
    });

    // Create and shuffle authoritative deck
    const deckInstance = new Deck();
    const drawPile = deckInstance.cards; // 106 playable cards with server-stamped ids; Hasbro's 4 rules/reference cards are not shuffled
    const discardPile = [];

    const state = {
        status: 'IN_PROGRESS',
        winnerId: null,
        winDetails: null,
        players,
        turnOrder,
        drawPile,
        discardPile,
        turn: null,
        pendingActionResolution: null,
        turnNumber: 1,
        replayLogs: [],
        replaySeqCounter: 0
    };

    // Deal 5 initial cards to every player
    turnOrder.forEach(playerId => {
        for (let i = 0; i < 5; i++) {
            if (state.drawPile.length > 0) {
                state.players[playerId].hand.push(state.drawPile.pop());
            }
        }
    });

    // Start the first player's turn
    state.turn = startTurn(state, turnOrder[0]);

    return state;
}

/**
 * Validates and applies an authoritative action to the GameState.
 * Handles the actual card movements (mutations) that rules_validator.js doesn't own.
 * @param {Object} state - Current authoritative GameState
 * @param {Object} action - Action structure { type, playerId, cardId, count, ... }
 * @returns {Object} { legal: boolean, reason?: string, gameState?: Object }
 */
function applyAction(state, action) {
    if (state && state.status === 'FINISHED') {
        return { legal: false, reason: 'Game is already finished.' };
    }

    // PAY_BANK exists only in the legacy dry-run API; the authoritative action
    // switch has no safe settlement semantics for it. Reject before validation
    // so a socket cannot create a legal-looking no-op and broadcast fake events.
    if (action && action.type === ACTION_TYPES.PAY_BANK) {
        return { legal: false, reason: 'PAY_BANK is not a supported Monopoly Deal action.' };
    }

    // 1. Validate the action's turn-legality via rules_validator.js
    const validation = validateAction(state, action);
    if (!validation.legal) {
        return { legal: false, reason: validation.reason };
    }

    // 2. Clone state and players to ensure side-effect-free immutability
    const nextState = JSON.parse(JSON.stringify(state));
    const turn = nextState.turn;
    const player = nextState.players[action.playerId];

    // 3. Apply turn-structure side effects first (on the unmutated state)
    const structureApplied = applyValidatedAction(nextState, action);
    nextState.turn = structureApplied.turn;

    // 4. Mutate card arrays based on the action type
    switch (action.type) {
        case ACTION_TYPES.DRAW: {
            const requiredCount = getRequiredDrawCount(turn.handSizeAtStartOfTurn);
            drawCards(nextState, player, requiredCount);
            break;
        }

        case ACTION_TYPES.PLAY_CARD: {
            // `doubleRentCardId` is valid only for the atomic Rent action below.
            // Reject it on ordinary bank/property plays so a forged payload
            // cannot consume an extra play without actually using Double The Rent.
            if (action.doubleRentCardId) {
                return { legal: false, reason: 'Double The Rent may only be used with a Rent action.' };
            }
            // Find card in hand
            const cardIdx = player.hand.findIndex(c => c.id === action.cardId);
            if (cardIdx === -1) {
                return { legal: false, reason: `Card ${action.cardId} not found in player hand.` };
            }
            const card = player.hand.splice(cardIdx, 1)[0];

            // Decide placement based on action specifications or card meta.
            if (action.targetZone === 'bank' || card.kind === 'MONEY') {
                player.bank.push(card);
            } else if (action.targetZone === 'properties') {
                const color = action.propertyColor || card.color;
                if (!color) {
                    return { legal: false, reason: 'Must specify property color to play property card.' };
                }
                if (!Object.prototype.hasOwnProperty.call(COMPLETE_SET_SIZE, color)) {
                    return { legal: false, reason: `Unknown property color: ${color}.` };
                }
                if (card.kind === 'WILDCARD') {
                    const allowedColors = Array.isArray(card.colors) ? card.colors : (Array.isArray(card.types) ? card.types : []);
                    if (allowedColors.length > 0 && !allowedColors.includes(color)) {
                        return { legal: false, reason: `Wildcard ${card.title} cannot be placed on ${color}.` };
                    }
                } else if (card.kind !== 'PROPERTY') {
                    return { legal: false, reason: `Card ${card.title} cannot be played as a property.` };
                }
                if (!player.properties[color]) {
                    player.properties[color] = { cards: [], hasHouse: false, hasHotel: false };
                }
                player.properties[color].cards.push(card);
            } else {
                // Action card played into the center/discard pile
                nextState.discardPile.push(card);
            }
            break;
        }

        case ACTION_TYPES.PLAY_ACTION_CARD: {
            const cardIdx = player.hand.findIndex(c => c.id === action.cardId);
            if (cardIdx === -1) {
                return { legal: false, reason: `Card ${action.cardId} not found in player hand.` };
            }
            const card = player.hand[cardIdx];

            // The validator reserves two plays whenever this field is supplied.
            // Only a Rent card may legally consume that reservation; all other
            // action cards reject rather than silently accepting a forged field.
            if (action.doubleRentCardId && !cardEffects.isRentCard(card)) {
                return { legal: false, reason: 'Double The Rent may only be used with a Rent action.' };
            }

            if (cardEffects.isRentCard(card)) {
                // `propertyColor` is the existing wire field for the selected
                // property color; Rent uses it as the color being charged.
                const rentColor = action.propertyColor;
                const rentSpec = cardEffects.getRentSpec(card);
                if (!rentColor) return { legal: false, reason: 'Rent requires a property color.' };
                if (!Object.prototype.hasOwnProperty.call(COMPLETE_SET_SIZE, rentColor)) {
                    return { legal: false, reason: `Unknown property color: ${rentColor}.` };
                }
                if (rentSpec.targeting === cardEffects.TARGETING.ALL_OPPONENTS && !rentSpec.colors.includes(rentColor)) {
                    return { legal: false, reason: `Rent card does not cover ${rentColor}.` };
                }
                if (rentSpec.targeting === cardEffects.TARGETING.SINGLE_OPPONENT) {
                    if (!action.targetPlayerId) return { legal: false, reason: 'All-color Rent requires a targetPlayerId.' };
                    if (action.targetPlayerId === action.playerId) return { legal: false, reason: 'Cannot target yourself with All-color Rent.' };
                    if (!nextState.players[action.targetPlayerId]) return { legal: false, reason: `Target player ${action.targetPlayerId} does not exist.` };
                }
                const rent = calculateRentAmount(nextState, action.playerId, rentColor);
                if (rent.errors && rent.errors.length) return { legal: false, reason: rent.errors.join(' ') };
                if (rent.totalRent <= 0) return { legal: false, reason: `You own no ${rentColor} properties; no rent is owed.` };

                // Optional atomic Double The Rent: a separate DTR card in hand
                // that doubles the rent AFTER the normal calculation. The play
                // limit (2 plays) is enforced upstream in validatePlayCardAction;
                // here we validate the card's identity and location. If any check
                // fails we return { legal: false } and the whole nextState clone
                // is discarded by the caller (app.js only commits when legal), so
                // no state — including the 2 plays already added by
                // applyValidatedAction — leaks.
                let doubled = false;
                let dtrIdx = -1;
                if (action.doubleRentCardId) {
                    if (action.doubleRentCardId === action.cardId) {
                        return { legal: false, reason: 'Double The Rent must be a separate card from the Rent card.' };
                    }
                    dtrIdx = player.hand.findIndex(c => c.id === action.doubleRentCardId);
                    if (dtrIdx === -1) {
                        return { legal: false, reason: 'Double The Rent card not found in your hand.' };
                    }
                    if (!cardEffects.isDoubleTheRentCard(player.hand[dtrIdx])) {
                        return { legal: false, reason: 'That card is not a Double The Rent card.' };
                    }
                    rent.totalRent *= 2;
                    doubled = true;
                }

                const debtors = cardEffects.computeRentDebtors(nextState, action.playerId, card, action.targetPlayerId, rent.totalRent);
                if (Object.keys(debtors).length === 0) return { legal: false, reason: `No eligible debtors for "${card.title}".` };

                if (dtrIdx !== -1) {
                    // Remove both cards by descending index so the first splice
                    // can't invalidate the second index; discard both.
                    const dtrCard = player.hand[dtrIdx];
                    player.hand.splice(Math.max(cardIdx, dtrIdx), 1);
                    player.hand.splice(Math.min(cardIdx, dtrIdx), 1);
                    nextState.discardPile.push(card);
                    nextState.discardPile.push(dtrCard);
                } else {
                    player.hand.splice(cardIdx, 1);
                    nextState.discardPile.push(card);
                }
                nextState.pendingCharge = {
                    type: 'RENT',
                    sourceTitle: card.title,
                    rentColor,
                    fromPlayerId: action.playerId,
                    targetPlayerId: action.targetPlayerId || null,
                    debtors,
                    doubled
                };
                break;
            }

            if (cardEffects.isSlyDealCard(card)) {
                const slyErrors = validateSlyDealTarget(nextState, { ...action, playerId: action.playerId });
                if (slyErrors.length) {
                    return { legal: false, reason: slyErrors.join(' ') };
                }

                const targetPlayer = nextState.players[action.targetPlayerId];
                const sourceGroup = targetPlayer.properties[action.targetPropertyColor];
                const stolenIdx = sourceGroup.cards.findIndex(c => c.id === action.targetCardId);
                const [stolenCard] = sourceGroup.cards.splice(stolenIdx, 1);
                if (sourceGroup.cards.length === 0) {
                    delete targetPlayer.properties[action.targetPropertyColor];
                }

                if (!player.properties[action.targetPropertyColor]) {
                    player.properties[action.targetPropertyColor] = { cards: [], hasHouse: false, hasHotel: false };
                }
                player.properties[action.targetPropertyColor].cards.push(stolenCard);

                player.hand.splice(cardIdx, 1);
                nextState.discardPile.push(card);
                break;
            }

            if (cardEffects.isForcedDealCard(card)) {
                const forcedErrors = validateForcedDealTarget(nextState, { ...action, playerId: action.playerId });
                if (forcedErrors.length) {
                    return { legal: false, reason: forcedErrors.join(' ') };
                }

                const targetPlayer = nextState.players[action.targetPlayerId];
                const offeredGroup = player.properties[action.offeredPropertyColor];
                const requestedGroup = targetPlayer.properties[action.requestedPropertyColor];
                const offeredIdx = offeredGroup ? offeredGroup.cards.findIndex(c => c.id === action.offeredCardId) : -1;
                const requestedIdx = requestedGroup ? requestedGroup.cards.findIndex(c => c.id === action.requestedCardId) : -1;
                if (offeredIdx === -1 || requestedIdx === -1) {
                    // validateForcedDealTarget already guarantees both cards exist in
                    // their named groups; this is a defensive guard only.
                    return { legal: false, reason: 'Forced Deal card not found in the named property group.' };
                }

                // Resolve BOTH removals before ANY addition so a same-color swap
                // (offeredPropertyColor === requestedPropertyColor) can't transiently
                // place a card into a group we still need to read from.
                const [offeredCard] = offeredGroup.cards.splice(offeredIdx, 1);
                const [requestedCard] = requestedGroup.cards.splice(requestedIdx, 1);

                // Cleanup now-empty source groups so the same color can be
                // re-created cleanly on the receiving side and empty groups
                // don't linger (which would also break win/complete-set checks).
                if (offeredGroup.cards.length === 0) {
                    delete player.properties[action.offeredPropertyColor];
                }
                if (requestedGroup.cards.length === 0) {
                    delete targetPlayer.properties[action.requestedPropertyColor];
                }

                // Source group colors persist: the requested card joins the actor's
                // group keyed by requestedPropertyColor; the offered card joins the
                // target's group keyed by offeredPropertyColor.
                if (!player.properties[action.requestedPropertyColor]) {
                    player.properties[action.requestedPropertyColor] = { cards: [], hasHouse: false, hasHotel: false };
                }
                player.properties[action.requestedPropertyColor].cards.push(requestedCard);

                if (!targetPlayer.properties[action.offeredPropertyColor]) {
                    targetPlayer.properties[action.offeredPropertyColor] = { cards: [], hasHouse: false, hasHotel: false };
                }
                targetPlayer.properties[action.offeredPropertyColor].cards.push(offeredCard);

                player.hand.splice(cardIdx, 1);
                nextState.discardPile.push(card);

                // Win condition: the acting player is covered by the generic
                // post-switch check below. Also detect a target who just completed
                // a third set from the offered card (actor keeps priority on ties).
                const actorForcedWin = checkWinCondition(player);
                if (!actorForcedWin.isWinner) {
                    const targetForcedWin = checkWinCondition(targetPlayer);
                    if (targetForcedWin.isWinner && nextState.status !== 'FINISHED') {
                        nextState.status = 'FINISHED';
                        nextState.winnerId = action.targetPlayerId;
                        nextState.winDetails = targetForcedWin.details;
                        recordGameEvent(nextState, action.type, action.playerId, buildPayloadSummary(action), 'APPLIED');
                        return {
                            legal: true,
                            isWinner: true,
                            winnerId: action.targetPlayerId,
                            completedSetColors: targetForcedWin.completedSetColors,
                            details: targetForcedWin.details,
                            gameState: nextState
                        };
                    }
                }
                break;
            }

            if (cardEffects.isDealBreakerCard(card)) {
                const dealBreakerErrors = validateDealBreakerTarget(nextState, { ...action, playerId: action.playerId });
                if (dealBreakerErrors.length) {
                    return { legal: false, reason: dealBreakerErrors.join(' ') };
                }

                const targetPlayer = nextState.players[action.targetPlayerId];
                const color = action.targetPropertyColor;
                // Move the group object wholesale so cards and any future House/
                // Hotel state stay attached to the complete set being stolen.
                const stolenGroup = targetPlayer.properties[color];
                delete targetPlayer.properties[color];

                const existingGroup = player.properties[color];
                if (!existingGroup) {
                    player.properties[color] = stolenGroup;
                } else {
                    // The color-keyed model used by existing transfer paths merges
                    // same-color groups. Preserve either group's building state.
                    existingGroup.cards = existingGroup.cards.concat(stolenGroup.cards);
                    existingGroup.hasHouse = !!existingGroup.hasHouse || !!stolenGroup.hasHouse;
                    existingGroup.hasHotel = !!existingGroup.hasHotel || !!stolenGroup.hasHotel;
                }

                player.hand.splice(cardIdx, 1);
                nextState.discardPile.push(card);
                break;
            }

            if (cardEffects.isHouseCard(card)) {
                // House is server-authoritative: it may only be added onto a
                // complete set the actor owns (never Railroad/Utility), and a
                // set may hold at most one House. It consumes exactly one normal
                // play and the card itself is discarded. Banking a House (played
                // via PLAY_CARD -> targetZone 'bank') is a separate path and is
                // intentionally left unchanged.
                const color = action.propertyColor;
                if (!color) {
                    return { legal: false, reason: 'House requires a target property color.' };
                }
                if (!Object.prototype.hasOwnProperty.call(COMPLETE_SET_SIZE, color)) {
                    return { legal: false, reason: `Unknown property color: ${color}.` };
                }
                if (cardEffects.HOUSE_HOTEL_EXCLUDED_COLORS.indexOf(color) !== -1) {
                    return { legal: false, reason: `A House cannot be added to a ${color} set.` };
                }
                const group = player.properties[color];
                const cardsOwned = group && Array.isArray(group.cards) ? group.cards.length : 0;
                if (cardsOwned < COMPLETE_SET_SIZE[color]) {
                    return { legal: false, reason: `You must own a complete ${color} set to add a House.` };
                }
                if (group.hasHouse) {
                    return { legal: false, reason: `Your ${color} set already has a House.` };
                }

                group.hasHouse = true;
                player.hand.splice(cardIdx, 1);
                nextState.discardPile.push(card);
                break;
            }

            if (cardEffects.isHotelCard(card)) {
                // Hotel mirrors House exactly, with one added prerequisite: the
                // target set must already carry a House. Same complete-set /
                // non-Railroad-Utility gate, one Hotel max, consumes exactly one
                // normal play, card discarded. Banking a Hotel (played via
                // PLAY_CARD -> targetZone 'bank', $4M cash) is a separate path
                // and is intentionally left unchanged. This is kept as a small
                // parallel branch rather than a shared validator so the freshly
                // verified House code above is not disturbed.
                const color = action.propertyColor;
                if (!color) {
                    return { legal: false, reason: 'Hotel requires a target property color.' };
                }
                if (!Object.prototype.hasOwnProperty.call(COMPLETE_SET_SIZE, color)) {
                    return { legal: false, reason: `Unknown property color: ${color}.` };
                }
                if (cardEffects.HOUSE_HOTEL_EXCLUDED_COLORS.indexOf(color) !== -1) {
                    return { legal: false, reason: `A Hotel cannot be added to a ${color} set.` };
                }
                const group = player.properties[color];
                const cardsOwned = group && Array.isArray(group.cards) ? group.cards.length : 0;
                if (cardsOwned < COMPLETE_SET_SIZE[color]) {
                    return { legal: false, reason: `You must own a complete ${color} set to add a Hotel.` };
                }
                if (!group.hasHouse) {
                    return { legal: false, reason: `Your ${color} set needs a House before you can add a Hotel.` };
                }
                if (group.hasHotel) {
                    return { legal: false, reason: `Your ${color} set already has a Hotel.` };
                }

                group.hasHotel = true;
                player.hand.splice(cardIdx, 1);
                nextState.discardPile.push(card);
                break;
            }

            if (cardEffects.isDoubleTheRentCard(card)) {
                // Double The Rent is only ever legal attached to a Rent action
                // (via action.doubleRentCardId, handled in the RENT branch
                // above). Played on its own it does nothing. This never mutates
                // state — it just replaces the generic "not yet supported"
                // fallthrough with a specific rejection. Banking a Double The
                // Rent as $1M (PLAY_CARD -> targetZone 'bank') is a separate
                // path and is intentionally left unchanged.
                return { legal: false, reason: 'Double The Rent must be played together with a Rent card.' };
            }

            if (cardEffects.isPassGoCard(card)) {
                const effect = describeActionCardEffect({ cardTitle: card.title });
                if (!effect || effect.type !== 'DRAW' || !Number.isInteger(effect.count) || effect.count <= 0) {
                    return { legal: false, reason: 'Pass Go has no valid draw effect defined.' };
                }
                // Discard before drawing so the established draw-pile exhaustion
                // behavior can reshuffle this action card back in if necessary.
                player.hand.splice(cardIdx, 1);
                nextState.discardPile.push(card);
                drawCards(nextState, player, effect.count);
                break;
            }

            if (!cardEffects.isChargeCardTitle(card.title)) {
                return { legal: false, reason: `Action card "${card.title}" is not yet supported for server-authoritative play.` };
            }

            if (card.title === cardEffects.CHARGE_CARD_TITLES.DEBT_COLLECTOR) {
                if (!action.targetPlayerId) {
                    return { legal: false, reason: 'Debt Collector requires a targetPlayerId.' };
                }
                if (action.targetPlayerId === action.playerId) {
                    return { legal: false, reason: 'Cannot target yourself with Debt Collector.' };
                }
                if (!nextState.players[action.targetPlayerId]) {
                    return { legal: false, reason: `Target player ${action.targetPlayerId} does not exist.` };
                }
            }

            const debtors = cardEffects.computeDebtors(nextState, action.playerId, card.title, action.targetPlayerId);
            if (Object.keys(debtors).length === 0) {
                return { legal: false, reason: `No eligible debtors for "${card.title}".` };
            }

            player.hand.splice(cardIdx, 1);
            nextState.discardPile.push(card);

            nextState.pendingCharge = {
                sourceTitle: card.title,
                fromPlayerId: action.playerId,
                targetPlayerId: action.targetPlayerId || null,
                debtors
            };
            break;
        }

        case ACTION_TYPES.REARRANGE: {
            // Wildcard Rearrange (narrow scope): move ONE of the current
            // player's wildcards that is ALREADY sitting in a property group to
            // a different color the card itself allows. It is a free action —
            // validateRearrangeAction / applyValidatedAction never touch
            // playsMade — never creates a pending charge, and never affects
            // another player. Building flags on every group it does not move a
            // card out of or into are left exactly as they were. Deliberately
            // out of scope: hand/bank cards, non-wildcard property cards, and
            // any cross-player move.
            const cardId = action.cardId;
            const destColor = action.propertyColor;
            if (!cardId) {
                return { legal: false, reason: 'Rearrange requires a cardId.' };
            }
            if (!destColor) {
                return { legal: false, reason: 'Rearrange requires a destination propertyColor.' };
            }
            if (!Object.prototype.hasOwnProperty.call(COMPLETE_SET_SIZE, destColor)) {
                return { legal: false, reason: `Unknown property color: ${destColor}.` };
            }

            // Locate the card in one of the actor's own property groups. Hand
            // and bank cards are not rearrangeable and are never inspected here.
            let sourceColor = null;
            let sourceGroup = null;
            let sourceIdx = -1;
            for (const color of Object.keys(player.properties || {})) {
                const grp = player.properties[color];
                const idx = grp && Array.isArray(grp.cards)
                    ? grp.cards.findIndex(c => c.id === cardId)
                    : -1;
                if (idx !== -1) {
                    sourceColor = color;
                    sourceGroup = grp;
                    sourceIdx = idx;
                    break;
                }
            }
            if (!sourceGroup) {
                return { legal: false, reason: `Card ${cardId} is not in any of your property sets.` };
            }

            const card = sourceGroup.cards[sourceIdx];
            if (card.kind !== 'WILDCARD') {
                return { legal: false, reason: 'Only a wildcard may be rearranged to a different color.' };
            }
            if (destColor === sourceColor) {
                return { legal: false, reason: 'Wildcard is already assigned to that color.' };
            }
            // A House or Hotel belongs to the completed source set. Moving a
            // wildcard out would leave the building flags on an incomplete set,
            // which is invalid and could be forced through the socket without
            // this server-side guard.
            if (sourceGroup.hasHouse || sourceGroup.hasHotel) {
                return { legal: false, reason: 'A wildcard cannot be moved out of a set with a House or Hotel.' };
            }

            const allowedColors = Array.isArray(card.colors)
                ? card.colors
                : (Array.isArray(card.types) ? card.types : []);
            if (allowedColors.length > 0 && !allowedColors.includes(destColor)) {
                return { legal: false, reason: `That wildcard cannot be assigned to ${destColor}.` };
            }

            // Move it: drop from source, delete the source group if now empty,
            // create the destination group only if it doesn't already exist.
            sourceGroup.cards.splice(sourceIdx, 1);
            if (sourceGroup.cards.length === 0) {
                delete player.properties[sourceColor];
            }
            if (!player.properties[destColor]) {
                player.properties[destColor] = { cards: [], hasHouse: false, hasHotel: false };
            }
            player.properties[destColor].cards.push(card);
            break;
        }

        case ACTION_TYPES.PAY_RENT: {
            const pending = nextState.pendingCharge;
            const debtorEntry = pending && pending.debtors && pending.debtors[action.playerId];
            if (!debtorEntry) {
                return { legal: false, reason: 'No pending payment owed by this player.' };
            }

            const recipient = nextState.players[pending.fromPlayerId];
            const paymentCardIds = action.paymentCardIds || action.cardIds || [];

            for (const cardId of paymentCardIds) {
                const extracted = extractPlayerAssetCard(player, cardId);
                if (!extracted) {
                    return { legal: false, reason: `Payment card ${cardId} not found in player assets.` };
                }
                if (extracted.zone === 'properties') {
                    if (!recipient.properties[extracted.color]) {
                        recipient.properties[extracted.color] = { cards: [], hasHouse: false, hasHotel: false };
                    }
                    recipient.properties[extracted.color].cards.push(extracted.card);
                } else {
                    recipient.bank.push(extracted.card);
                }
            }

            // Exploit guard: if paying rent stripped the last card out of one of
            // the payer's property groups, drop the whole group — including any
            // hasHouse/hasHotel flags. Leaving an empty-but-flagged group behind
            // would let a single later property card "revive" a free House/Hotel
            // on an incomplete set.
            Object.keys(player.properties || {}).forEach(color => {
                const grp = player.properties[color];
                if (!grp || !Array.isArray(grp.cards) || grp.cards.length === 0) {
                    delete player.properties[color];
                }
            });

            delete pending.debtors[action.playerId];
            if (Object.keys(pending.debtors).length === 0) {
                nextState.pendingCharge = null;
            }

            const recipientWin = checkWinCondition(recipient);
            if (recipientWin.isWinner && nextState.status !== 'FINISHED') {
                nextState.status = 'FINISHED';
                nextState.winnerId = pending.fromPlayerId;
                nextState.winDetails = recipientWin.details;
            }
            break;
        }

        case ACTION_TYPES.DISCARD: {
            const cardIdx = player.hand.findIndex(c => c.id === action.cardId);
            if (cardIdx === -1) {
                return { legal: false, reason: `Card ${action.cardId} not found in player hand.` };
            }
            const card = player.hand.splice(cardIdx, 1)[0];
            nextState.discardPile.push(card);
            break;
        }

        case ACTION_TYPES.END_TURN: {
            // Hand limit check is driven by rules_validator, phase transition is applied in step 4
            break;
        }

        default:
            break;
    }

    // 4.5 Check if acting player achieved win condition
    const winCheck = checkWinCondition(nextState.players[action.playerId]);
    if (winCheck.isWinner) {
        nextState.status = 'FINISHED';
        nextState.winnerId = action.playerId;
        nextState.winDetails = winCheck.details;
        recordGameEvent(nextState, action.type, action.playerId, buildPayloadSummary(action), 'APPLIED');
        return {
            legal: true,
            isWinner: true,
            winnerId: action.playerId,
            completedSetColors: winCheck.completedSetColors,
            details: winCheck.details,
            gameState: nextState
        };
    }

    // 5. If turn phase is now COMPLETE, rotate to the next player automatically
    if (nextState.turn.phase === PHASES.COMPLETE) {
        const currentIdx = nextState.turnOrder.indexOf(nextState.turn.playerId);
        const nextIdx = (currentIdx + 1) % nextState.turnOrder.length;
        const nextPlayerId = nextState.turnOrder[nextIdx];
        nextState.turn = startTurn(nextState, nextPlayerId);
        nextState.turnNumber = (nextState.turnNumber || 1) + 1;
    }

    // Record authoritative game event replay log
    recordGameEvent(nextState, action.type, action.playerId, buildPayloadSummary(action), 'APPLIED');

    return { legal: true, gameState: nextState };
}

/**
 * Moves up to `count` cards from the draw pile to a player's hand. When the
 * draw pile runs out it preserves the normal mandatory-draw reshuffle rule.
 * Returns fewer than `count` only when both piles are exhausted.
 */
function drawCards(state, player, count) {
    let drawn = 0;
    for (let i = 0; i < count; i++) {
        if (state.drawPile.length === 0 && state.discardPile.length > 0) {
            state.drawPile = shuffleArray(state.discardPile);
            state.discardPile = [];
        }
        if (state.drawPile.length === 0) break;
        player.hand.push(state.drawPile.pop());
        drawn += 1;
    }
    return drawn;
}

/**
 * Removes and returns a payable asset owned by `player` from bank or a
 * property group. Hand cards are not payable Monopoly Deal assets. Mutates
 * `player` in place.
 * @returns {?{card: Object, zone: 'bank'|'properties', color: ?string}}
 */
function extractPlayerAssetCard(player, cardId) {
    if (!player) return null;

    const bankIdx = (player.bank || []).findIndex(c => c.id === cardId);
    if (bankIdx !== -1) {
        return { card: player.bank.splice(bankIdx, 1)[0], zone: 'bank', color: null };
    }

    const properties = player.properties || {};
    for (const color of Object.keys(properties)) {
        const group = properties[color];
        const idx = (group.cards || []).findIndex(c => c.id === cardId);
        if (idx !== -1) {
            return { card: group.cards.splice(idx, 1)[0], zone: 'properties', color };
        }
    }

    return null;
}

function summarizePlayerPublicState(player) {
    if (!player) return { handCount: 0, bankTotal: 0, properties: {} };
    const propertiesSummary = {};
    Object.keys(player.properties || {}).forEach(color => {
        const group = player.properties[color];
        propertiesSummary[color] = {
            cardsOwned: group.cards ? group.cards.length : 0,
            hasHouse: !!group.hasHouse,
            hasHotel: !!group.hasHotel
        };
    });
    return {
        handCount: (player.hand || []).length,
        bankTotal: (player.bank || []).reduce((sum, c) => sum + (c.value || 0), 0),
        properties: propertiesSummary
    };
}

function buildPayloadSummary(action) {
    if (!action) return {};
    const summary = {};
    if (action.cardId) summary.cardId = action.cardId;
    if (action.targetZone) summary.targetZone = action.targetZone;
    if (action.propertyColor) summary.propertyColor = action.propertyColor;
    if (action.targetPlayerId) summary.targetPlayerId = action.targetPlayerId;
    if (action.targetPropertyColor) summary.targetPropertyColor = action.targetPropertyColor;
    if (action.targetCardId) summary.targetCardId = action.targetCardId;
    if (action.offeredCardId) summary.offeredCardId = action.offeredCardId;
    if (action.offeredPropertyColor) summary.offeredPropertyColor = action.offeredPropertyColor;
    if (action.requestedCardId) summary.requestedCardId = action.requestedCardId;
    if (action.requestedPropertyColor) summary.requestedPropertyColor = action.requestedPropertyColor;
    if (action.count !== undefined) summary.count = action.count;
    if (action.cardIds) summary.cardCount = action.cardIds.length;
    return summary;
}

function recordGameEvent(gameState, actionType, actorId, payload, status) {
    if (!gameState) return gameState;
    if (!gameState.replayLogs) gameState.replayLogs = [];
    if (gameState.replaySeqCounter === undefined) gameState.replaySeqCounter = 0;

    gameState.replaySeqCounter += 1;
    const boardSnapshotSummary = {};
    Object.keys(gameState.players || {}).forEach(id => {
        boardSnapshotSummary[id] = summarizePlayerPublicState(gameState.players[id]);
    });

    gameState.replayLogs.push({
        seq: gameState.replaySeqCounter,
        timestamp: Date.now(),
        phase: gameState.turn ? gameState.turn.phase : null,
        actionType,
        actorId: actorId || null,
        payload: payload || {},
        status: status || 'APPLIED',
        boardSnapshotSummary
    });

    if (gameState.replayLogs.length > 500) {
        gameState.replayLogs = gameState.replayLogs.slice(gameState.replayLogs.length - 500);
    }

    return gameState;
}

function getMatchTelemetry(gameState) {
    if (!gameState) return {};
    const logs = gameState.replayLogs || [];
    const applied = logs.filter(e => e.status === 'APPLIED');
    const rejected = logs.filter(e => e.status === 'REJECTED');
    const actionCountsByType = {};
    const actionCountsByPlayer = {};

    applied.forEach(e => {
        actionCountsByType[e.actionType] = (actionCountsByType[e.actionType] || 0) + 1;
        if (e.actorId) actionCountsByPlayer[e.actorId] = (actionCountsByPlayer[e.actorId] || 0) + 1;
    });

    const perPlayer = {};
    Object.keys(gameState.players || {}).forEach(id => {
        perPlayer[id] = summarizePlayerPublicState(gameState.players[id]);
    });

    const firstTs = logs.length ? logs[0].timestamp : null;
    const lastTs = logs.length ? logs[logs.length - 1].timestamp : null;

    return {
        matchStatus: gameState.status || 'IN_PROGRESS',
        winnerId: gameState.winnerId || null,
        turnNumber: gameState.turnNumber || 1,
        currentPhase: gameState.turn ? gameState.turn.phase : null,
        currentPlayerId: gameState.turn ? gameState.turn.playerId : null,
        totalActionsApplied: applied.length,
        totalActionsRejected: rejected.length,
        actionCountsByType,
        actionCountsByPlayer,
        drawPileRemaining: (gameState.drawPile || []).length,
        discardPileCount: (gameState.discardPile || []).length,
        matchDurationMs: firstTs ? (lastTs || Date.now()) - firstTs : 0,
        averageActionsPerTurn: (gameState.turnNumber || 1) ? +(applied.length / (gameState.turnNumber || 1)).toFixed(2) : 0,
        perPlayer
    };
}

/**
 * Formats and redacts the GameState for a specific client to prevent cheating.
 * Opponents' hands are hidden (replaced by length integers).
 * @param {Object} gameState
 * @param {string} playerId
 * @returns {Object} Redacted GameState
 */
function toClientView(gameState, playerId) {
    const redacted = JSON.parse(JSON.stringify(gameState));
    
    // Hide draw pile cards (only reveal count)
    redacted.drawPileCount = redacted.drawPile.length;
    delete redacted.drawPile;

    // Redact opponent hands
    Object.keys(redacted.players).forEach(id => {
        if (id !== playerId) {
            redacted.players[id].handCount = redacted.players[id].hand.length;
            delete redacted.players[id].hand;
        }
    });

    return redacted;
}

function shuffleArray(array, rng) {
    const arr = [...array];
    let currentIndex = arr.length, temporaryValue, randomIndex;
    const randomInt = rng || ((min, max) => crypto.randomInt(min, max));
    while (0 !== currentIndex) {
      randomIndex = randomInt(0, currentIndex);
      currentIndex -= 1;
      temporaryValue = arr[currentIndex];
      arr[currentIndex] = arr[randomIndex];
      arr[randomIndex] = temporaryValue;
    }
    return arr;
}

function evaluateWinCondition(gameState, playerId) {
    if (!gameState || !gameState.players || !gameState.players[playerId]) {
        return { legal: false, reason: `Player ${playerId} not found in game state.` };
    }
    const winResult = checkWinCondition(gameState.players[playerId]);
    const nextState = JSON.parse(JSON.stringify(gameState));
    let transitioned = false;
    if (winResult.isWinner && nextState.status !== 'FINISHED') {
        nextState.status = 'FINISHED';
        nextState.winnerId = playerId;
        nextState.winDetails = winResult.details;
        transitioned = true;
    }
    return {
        legal: true,
        winResult,
        gameState: nextState,
        transitioned
    };
}

module.exports = {
    createGameState,
    applyAction,
    evaluateWinCondition,
    toClientView,
    recordGameEvent,
    getMatchTelemetry,
    summarizePlayerPublicState
};
