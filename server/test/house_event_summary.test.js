'use strict';

const assert = require('assert');

// app.js exports buildActionEventSummary for focused unit testing of the
// human-readable game:event summaries. Requiring app.js does not start a
// listener (it only listens when run as the main module).
const app = require('../app');
const buildActionEventSummary = app.buildActionEventSummary;

function seat(playerId, displayName) {
    return { seatIndex: 0, playerId, displayName, connected: true };
}

function player(id, name, hand) {
    return { id, name, hand: hand || [], bank: [], properties: {} };
}

describe('buildActionEventSummary — House and prior-Rent interaction', function () {
    it('describes a House build truthfully even after a Rent earlier in the same turn', function () {
        const houseCard = { id: 'house-1', title: 'House' };
        const previousGameState = {
            players: {
                p1: player('p1', 'Scott', [houseCard]),
                p2: player('p2', 'Riri')
            },
            // The earlier Rent this turn has already been fully settled.
            pendingCharge: null
        };
        const room = {
            seats: [seat('p1', 'Scott'), seat('p2', 'Riri')],
            gameState: {
                players: {
                    p1: player('p1', 'Scott', []),
                    p2: player('p2', 'Riri')
                },
                pendingCharge: null
            }
        };

        const summary = buildActionEventSummary(
            room,
            { type: 'PLAY_ACTION_CARD', playerId: 'p1', cardId: 'house-1', propertyColor: 'Brown' },
            previousGameState
        );

        assert.match(summary, /Scott added a House to their complete Brown set/);
        assert.doesNotMatch(summary, /must pay/);
    });

    it('does not echo a still-listed charge when the action played is a House', function () {
        const houseCard = { id: 'house-1', title: 'House' };
        const previousGameState = {
            players: { p1: player('p1', 'Scott', [houseCard]), p2: player('p2', 'Riri') },
            pendingCharge: null
        };
        const room = {
            seats: [seat('p1', 'Scott'), seat('p2', 'Riri')],
            gameState: {
                players: { p1: player('p1', 'Scott', []), p2: player('p2', 'Riri') },
                // A charge whose source is a Rent card — the House play must not adopt it.
                pendingCharge: {
                    type: 'RENT',
                    sourceTitle: 'Rent',
                    rentColor: 'Brown',
                    fromPlayerId: 'p1',
                    debtors: { p2: { amountOwed: 7 } }
                }
            }
        };

        const summary = buildActionEventSummary(
            room,
            { type: 'PLAY_ACTION_CARD', playerId: 'p1', cardId: 'house-1', propertyColor: 'Brown' },
            previousGameState
        );

        assert.match(summary, /added a House/);
        assert.doesNotMatch(summary, /played Rent/);
    });

    it('describes a Hotel build truthfully even after a Rent earlier in the same turn (no echo)', function () {
        const hotelCard = { id: 'hotel-1', title: 'Hotel' };
        const previousGameState = {
            players: { p1: player('p1', 'Scott', [hotelCard]), p2: player('p2', 'Riri') },
            pendingCharge: null
        };
        const room = {
            seats: [seat('p1', 'Scott'), seat('p2', 'Riri')],
            gameState: {
                players: { p1: player('p1', 'Scott', []), p2: player('p2', 'Riri') },
                // A charge whose source is a Rent card — the Hotel play must not adopt it.
                pendingCharge: {
                    type: 'RENT',
                    sourceTitle: 'Rent',
                    rentColor: 'Brown',
                    fromPlayerId: 'p1',
                    debtors: { p2: { amountOwed: 11 } }
                }
            }
        };

        const summary = buildActionEventSummary(
            room,
            { type: 'PLAY_ACTION_CARD', playerId: 'p1', cardId: 'hotel-1', propertyColor: 'Brown' },
            previousGameState
        );

        assert.match(summary, /Scott added a Hotel to their complete Brown set/);
        assert.doesNotMatch(summary, /must pay/);
        assert.doesNotMatch(summary, /played Rent/);
    });

    it('still describes a freshly played Rent charge', function () {
        const rentCard = { id: 'rent-1', title: 'Rent' };
        const previousGameState = {
            players: { p1: player('p1', 'Scott', [rentCard]), p2: player('p2', 'Riri') },
            pendingCharge: null
        };
        const room = {
            seats: [seat('p1', 'Scott'), seat('p2', 'Riri')],
            gameState: {
                players: { p1: player('p1', 'Scott', []), p2: player('p2', 'Riri') },
                pendingCharge: {
                    type: 'RENT',
                    sourceTitle: 'Rent',
                    rentColor: 'Brown',
                    fromPlayerId: 'p1',
                    debtors: { p2: { amountOwed: 7 } }
                }
            }
        };

        const summary = buildActionEventSummary(
            room,
            { type: 'PLAY_ACTION_CARD', playerId: 'p1', cardId: 'rent-1', propertyColor: 'Brown' },
            previousGameState
        );

        assert.match(summary, /Scott played Rent \(Brown\) — Riri must pay \$7M/);
    });
});
