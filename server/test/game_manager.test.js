const assert = require('assert');
const { createGameState, applyAction, toClientView } = require('../game_manager');
const { PHASES, ACTION_TYPES } = require('../rules_validator');

describe('game_manager', function() {
    let players;

    beforeEach(function() {
        players = [
            { id: 'p1', name: 'Scott' },
            { id: 'p2', name: 'Riri' }
        ];
    });

    describe('createGameState', function() {
        it('should initialize game state with 2 players, dealing 5 cards to each', function() {
            const state = createGameState(players);
            
            assert.strictEqual(state.turnOrder.length, 2);
            assert.strictEqual(state.turnOrder[0], 'p1');
            assert.strictEqual(state.turnOrder[1], 'p2');
            
            assert.strictEqual(state.players.p1.hand.length, 5);
            assert.strictEqual(state.players.p2.hand.length, 5);
            
            // 106 playable cards total - 10 dealt = 96 remaining in draw pile
            assert.strictEqual(state.drawPile.length, 96);
            assert.strictEqual(state.discardPile.length, 0);
            
            // Turn initialized for first player in DRAW phase
            assert.strictEqual(state.turn.playerId, 'p1');
            assert.strictEqual(state.turn.phase, PHASES.DRAW);
            assert.strictEqual(state.turn.playsMade, 0);
            assert.strictEqual(state.turn.handSizeAtStartOfTurn, 5);
        });

        it('should throw error if fewer than 2 players are provided', function() {
            assert.throws(() => createGameState([{ id: 'p1', name: 'Scott' }]), /Cannot start a game with fewer than 2 players/);
        });
    });

    describe('applyAction — DRAW', function() {
        it('should draw 2 cards and transition to ACTION phase', function() {
            const state = createGameState(players);
            const action = { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 2 };
            
            const result = applyAction(state, action);
            assert.strictEqual(result.legal, true);
            
            const nextState = result.gameState;
            assert.strictEqual(nextState.players.p1.hand.length, 7); // 5 initial + 2 drawn
            assert.strictEqual(nextState.drawPile.length, 94);
            assert.strictEqual(nextState.turn.phase, PHASES.ACTION);
            assert.strictEqual(nextState.turn.hasDrawn, true);
        });

        it('should draw 5 cards if player starts turn with 0 cards in hand', function() {
            const state = createGameState(players);
            // Manually empty hand of p1 and reset turn snapshot
            state.players.p1.hand = [];
            state.turn.handSizeAtStartOfTurn = 0;
            
            const action = { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 5 };
            const result = applyAction(state, action);
            assert.strictEqual(result.legal, true);
            
            const nextState = result.gameState;
            assert.strictEqual(nextState.players.p1.hand.length, 5);
            assert.strictEqual(nextState.drawPile.length, 91);
            assert.strictEqual(nextState.turn.phase, PHASES.ACTION);
        });

        it('should reject draw if performed out-of-turn', function() {
            const state = createGameState(players);
            const action = { type: ACTION_TYPES.DRAW, playerId: 'p2', count: 2 }; // p1 is active
            
            const result = applyAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.ok(result.reason.includes('current player'));
        });
    });

    describe('applyAction — PLAY_CARD', function() {
        let state;
        let drawnState;

        beforeEach(function() {
            state = createGameState(players);
            const drawAction = { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 2 };
            drawnState = applyAction(state, drawAction).gameState;
        });

        it('should play money/action card from hand to bank', function() {
            const hand = drawnState.players.p1.hand;
            // Find a card that is money or action (e.g. 5M, 1M, or Deal Breaker)
            const moneyCard = hand[0];
            const action = {
                type: ACTION_TYPES.PLAY_CARD,
                playerId: 'p1',
                cardId: moneyCard.id,
                targetZone: 'bank'
            };

            const result = applyAction(drawnState, action);
            assert.strictEqual(result.legal, true);
            
            const nextState = result.gameState;
            assert.strictEqual(nextState.players.p1.hand.length, 6); // 7 - 1 played
            assert.strictEqual(nextState.players.p1.bank.length, 1);
            assert.strictEqual(nextState.players.p1.bank[0].id, moneyCard.id);
            assert.strictEqual(nextState.turn.playsMade, 1);
        });

        it('should play property card from hand to properties zone', function() {
            const hand = drawnState.players.p1.hand;
            // Let's manually inject a PropertyCard
            const PropertyCard = require('../models/PropertyCard');
            const PropertyType = require('../models/PropertyType');
            const prop = new PropertyCard("Boardwalk", 4, PropertyType.DarkBlue);
            prop.id = "boardwalk-test";
            hand.push(prop);

            const action = {
                type: ACTION_TYPES.PLAY_CARD,
                playerId: 'p1',
                cardId: "boardwalk-test",
                targetZone: 'properties',
                propertyColor: PropertyType.DarkBlue
            };

            const result = applyAction(drawnState, action);
            assert.strictEqual(result.legal, true);
            
            const nextState = result.gameState;
            assert.strictEqual(nextState.players.p1.properties[PropertyType.DarkBlue].cards.length, 1);
            assert.strictEqual(nextState.players.p1.properties[PropertyType.DarkBlue].cards[0].id, "boardwalk-test");
            assert.strictEqual(nextState.turn.playsMade, 1);
        });

        it('should reject play if card is not in player hand', function() {
            const action = {
                type: ACTION_TYPES.PLAY_CARD,
                playerId: 'p1',
                cardId: 'nonexistent-card-id',
                targetZone: 'bank'
            };
            const result = applyAction(drawnState, action);
            assert.strictEqual(result.legal, false);
            assert.ok(result.reason.includes('not found in player hand'));
        });

        it('should reject play if action limit (3 plays) is exceeded', function() {
            let activeState = drawnState;
            // Play 3 cards
            for (let i = 0; i < 3; i++) {
                const card = activeState.players.p1.hand[0];
                const action = {
                    type: ACTION_TYPES.PLAY_CARD,
                    playerId: 'p1',
                    cardId: card.id,
                    targetZone: 'bank'
                };
                activeState = applyAction(activeState, action).gameState;
            }
            assert.strictEqual(activeState.turn.playsMade, 3);

            // Attempt to play a 4th card
            const fourthCard = activeState.players.p1.hand[0];
            const action4 = {
                type: ACTION_TYPES.PLAY_CARD,
                playerId: 'p1',
                cardId: fourthCard.id,
                targetZone: 'bank'
            };
            const result = applyAction(activeState, action4);
            assert.strictEqual(result.legal, false);
            assert.ok(result.reason.includes('limit of 3'));
        });
    });

    describe('applyAction — DISCARD & END_TURN rotation', function() {
        let state;
        let drawnState;

        beforeEach(function() {
            state = createGameState(players);
            const drawAction = { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 2 };
            drawnState = applyAction(state, drawAction).gameState;
        });

        it('should allow ending turn directly if hand size is <= 7, rotating turn to p2', function() {
            // Hand size is 7 (limit is 7), so ending turn is legal and directly completes
            const action = { type: ACTION_TYPES.END_TURN, playerId: 'p1' };
            const result = applyAction(drawnState, action);
            assert.strictEqual(result.legal, true);
            
            const nextState = result.gameState;
            // Turn rotated to p2!
            assert.strictEqual(nextState.turn.playerId, 'p2');
            assert.strictEqual(nextState.turn.phase, PHASES.DRAW);
            assert.strictEqual(nextState.turn.playsMade, 0);
            assert.strictEqual(nextState.turn.handSizeAtStartOfTurn, 5);
        });

        it('should force transition to DISCARD phase if hand size > 7 when ending turn', function() {
            // Manually inject 2 cards to exceed hand limit of 7 (making it 9)
            drawnState.players.p1.hand.push({ id: 'ex-1' });
            drawnState.players.p1.hand.push({ id: 'ex-2' });
            assert.strictEqual(drawnState.players.p1.hand.length, 9);

            const endAction = { type: ACTION_TYPES.END_TURN, playerId: 'p1' };
            const result = applyAction(drawnState, endAction);
            assert.strictEqual(result.legal, true);
            
            const nextState = result.gameState;
            assert.strictEqual(nextState.turn.phase, PHASES.DISCARD);
            // Turn playerId is still p1 (it hasn't rotated yet because discard is required)
            assert.strictEqual(nextState.turn.playerId, 'p1');
        });

        it('should allow discarding cards down to 7, then rotate on last discard', function() {
            // Hand size 9
            drawnState.players.p1.hand.push({ id: 'ex-1' });
            drawnState.players.p1.hand.push({ id: 'ex-2' });
            
            // Move to discard phase
            let activeState = applyAction(drawnState, { type: ACTION_TYPES.END_TURN, playerId: 'p1' }).gameState;
            assert.strictEqual(activeState.turn.phase, PHASES.DISCARD);

            // Discard 1st card -> hand size goes 9 -> 8, still in DISCARD phase
            const disc1 = { type: ACTION_TYPES.DISCARD, playerId: 'p1', cardId: 'ex-1' };
            const res1 = applyAction(activeState, disc1);
            assert.strictEqual(res1.legal, true);
            activeState = res1.gameState;
            assert.strictEqual(activeState.players.p1.hand.length, 8);
            assert.strictEqual(activeState.turn.phase, PHASES.DISCARD);
            assert.strictEqual(activeState.discardPile.length, 1);

            // Discard 2nd card -> hand size goes 8 -> 7, reaches limit! Auto-completes and rotates to p2
            const disc2 = { type: ACTION_TYPES.DISCARD, playerId: 'p1', cardId: 'ex-2' };
            const res2 = applyAction(activeState, disc2);
            assert.strictEqual(res2.legal, true);
            activeState = res2.gameState;
            
            assert.strictEqual(activeState.players.p1.hand.length, 7);
            assert.strictEqual(activeState.discardPile.length, 2);
            // Rotated to p2!
            assert.strictEqual(activeState.turn.playerId, 'p2');
            assert.strictEqual(activeState.turn.phase, PHASES.DRAW);
        });
    });

    describe('toClientView', function() {
        it('should redact opponents hands and draw pile cards while keeping lengths/counts', function() {
            const state = createGameState(players);
            const clientViewForP1 = toClientView(state, 'p1');

            // p1 hand is fully visible
            assert.ok(Array.isArray(clientViewForP1.players.p1.hand));
            assert.strictEqual(clientViewForP1.players.p1.hand.length, 5);

            // p2 hand is redacted (replaced by handCount integer)
            assert.strictEqual(clientViewForP1.players.p2.hand, undefined);
            assert.strictEqual(clientViewForP1.players.p2.handCount, 5);

            // drawPile is hidden, but drawPileCount exists
            assert.strictEqual(clientViewForP1.drawPile, undefined);
            assert.strictEqual(clientViewForP1.drawPileCount, 96);
        });
    });
});
