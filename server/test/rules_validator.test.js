const assert = require('assert');
const {
    HAND_LIMIT,
    MAX_PLAYS_PER_TURN,
    NORMAL_DRAW_COUNT,
    EMPTY_HAND_DRAW_COUNT,
    PHASES,
    ACTION_TYPES,
    getRequiredDrawCount,
    startTurn,
    validateAction,
    applyValidatedAction,
    validateDrawAction,
    validateJustSayNoAction,
    validateRearrangeAction,
    validatePlayCardAction,
    validateDiscardAction,
    validateEndTurnAction
} = require('../rules_validator');

describe('rules_validator', function() {
    // Shared state generator
    function makeState(overrides) {
        const base = {
            players: {
                p1: { id: 'p1', name: 'Scott', hand: [], bank: [], properties: {} },
                p2: { id: 'p2', name: 'Riri', hand: [], bank: [], properties: {} }
            },
            turnOrder: ['p1', 'p2'],
            turn: null,
            pendingActionResolution: null
        };
        
        if (overrides) {
            if (overrides.players) {
                Object.assign(base.players, overrides.players);
            }
            if (overrides.turn) {
                base.turn = Object.assign(startTurn(base, 'p1'), overrides.turn);
            } else {
                base.turn = startTurn(base, 'p1');
            }
            if (overrides.pendingActionResolution !== undefined) {
                base.pendingActionResolution = overrides.pendingActionResolution;
            }
        } else {
            base.turn = startTurn(base, 'p1');
        }
        return base;
    }

    describe('constants & getRequiredDrawCount', function() {
        it('should have correct turn structure constants', function() {
            assert.strictEqual(HAND_LIMIT, 7);
            assert.strictEqual(MAX_PLAYS_PER_TURN, 3);
            assert.strictEqual(NORMAL_DRAW_COUNT, 2);
            assert.strictEqual(EMPTY_HAND_DRAW_COUNT, 5);
        });

        it('should return 5 cards when hand is empty at start of turn, else 2', function() {
            assert.strictEqual(getRequiredDrawCount(0), 5);
            assert.strictEqual(getRequiredDrawCount(1), 2);
            assert.strictEqual(getRequiredDrawCount(7), 2);
        });
    });

    describe('startTurn', function() {
        it('should initialize a TurnState with snapshot of hand size', function() {
            const state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: [{ id: 'c1' }, { id: 'c2' }], bank: [], properties: {} }
                }
            });
            const turn = startTurn(state, 'p1');
            assert.strictEqual(turn.playerId, 'p1');
            assert.strictEqual(turn.phase, PHASES.DRAW);
            assert.strictEqual(turn.playsMade, 0);
            assert.strictEqual(turn.hasDrawn, false);
            assert.strictEqual(turn.handSizeAtStartOfTurn, 2);
        });

        it('should throw when unknown player starts turn', function() {
            const state = makeState();
            assert.throws(() => startTurn(state, 'nonexistent'), /unknown playerId nonexistent/);
        });
    });

    describe('DRAW phase — validateDrawAction', function() {
        it('should allow drawing 5 when hand starts empty', function() {
            const state = makeState(); // starts empty by default
            const action = { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 5 };
            const result = validateDrawAction(state, action);
            assert.strictEqual(result.legal, true);
        });

        it('should reject drawing 2 when hand starts empty', function() {
            const state = makeState();
            const action = { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 2 };
            const result = validateDrawAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /Must draw exactly 5/);
        });

        it('should allow drawing 2 when hand has cards', function() {
            const state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: [{ id: 'c1' }], bank: [], properties: {} }
                }
            });
            const action = { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 2 };
            const result = validateDrawAction(state, action);
            assert.strictEqual(result.legal, true);
        });

        it('should reject drawing 5 when hand has cards', function() {
            const state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: [{ id: 'c1' }], bank: [], properties: {} }
                }
            });
            const action = { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 5 };
            const result = validateDrawAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /Must draw exactly 2/);
        });

        it('should reject draw action from incorrect player', function() {
            const state = makeState();
            const action = { type: ACTION_TYPES.DRAW, playerId: 'p2', count: 5 };
            const result = validateDrawAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /Only the current player/);
        });

        it('should reject drawing when already drew', function() {
            const state = makeState({
                turn: { hasDrawn: true, phase: PHASES.ACTION }
            });
            const action = { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 5 };
            const result = validateDrawAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /Not in the draw phase/);
        });
    });

    describe('ACTION phase — validatePlayCardAction', function() {
        it('should allow playing card when in action phase and under limit', function() {
            const state = makeState({
                turn: { phase: PHASES.ACTION, playsMade: 0 }
            });
            const action = { type: ACTION_TYPES.PLAY_CARD, playerId: 'p1', cardId: 'c1' };
            const result = validatePlayCardAction(state, action);
            assert.strictEqual(result.legal, true);
            assert.strictEqual(result.countsTowardPlayLimit, true);
        });

        it('should reject play if at play limit', function() {
            const state = makeState({
                turn: { phase: PHASES.ACTION, playsMade: 3 }
            });
            const action = { type: ACTION_TYPES.PLAY_CARD, playerId: 'p1', cardId: 'c1' };
            const result = validatePlayCardAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /Play limit of 3 cards/);
        });

        it('should reject play if wrong player', function() {
            const state = makeState({
                turn: { phase: PHASES.ACTION, playsMade: 0 }
            });
            const action = { type: ACTION_TYPES.PLAY_CARD, playerId: 'p2', cardId: 'c1' };
            const result = validatePlayCardAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /Only the current player/);
        });

        it('should reject play if no card specified', function() {
            const state = makeState({
                turn: { phase: PHASES.ACTION, playsMade: 0 }
            });
            const action = { type: ACTION_TYPES.PLAY_CARD, playerId: 'p1' };
            const result = validatePlayCardAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /No card specified/);
        });
    });

    describe('ACTION phase — free actions: Just Say No', function() {
        it('should allow JSN response when there is a pending action targetting them', function() {
            const state = makeState({
                pendingActionResolution: {
                    sourceCard: 'Sly Deal',
                    fromPlayerId: 'p2',
                    eligibleResponderIds: ['p1']
                }
            });
            const action = { type: ACTION_TYPES.JUST_SAY_NO, playerId: 'p1' };
            const result = validateJustSayNoAction(state, action);
            assert.strictEqual(result.legal, true);
            assert.strictEqual(result.countsTowardPlayLimit, false);
        });

        it('should reject JSN response if no pending action', function() {
            const state = makeState();
            const action = { type: ACTION_TYPES.JUST_SAY_NO, playerId: 'p1' };
            const result = validateJustSayNoAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /No pending action card/);
        });

        it('should reject JSN response if player is not an eligible responder', function() {
            const state = makeState({
                pendingActionResolution: {
                    sourceCard: 'Sly Deal',
                    fromPlayerId: 'p1',
                    eligibleResponderIds: ['p2']
                }
            });
            const action = { type: ACTION_TYPES.JUST_SAY_NO, playerId: 'p1' };
            const result = validateJustSayNoAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /not an eligible target/);
        });
    });

    describe('ACTION phase — free actions: Rearrange', function() {
        it('should allow current player to rearrange in ACTION phase', function() {
            const state = makeState({
                turn: { phase: PHASES.ACTION }
            });
            const action = { type: ACTION_TYPES.REARRANGE, playerId: 'p1' };
            const result = validateRearrangeAction(state, action);
            assert.strictEqual(result.legal, true);
            assert.strictEqual(result.countsTowardPlayLimit, false);
        });

        it('should allow current player to rearrange in DISCARD phase', function() {
            const state = makeState({
                turn: { phase: PHASES.DISCARD }
            });
            const action = { type: ACTION_TYPES.REARRANGE, playerId: 'p1' };
            const result = validateRearrangeAction(state, action);
            assert.strictEqual(result.legal, true);
        });

        it('should reject rearrange if wrong player', function() {
            const state = makeState({
                turn: { phase: PHASES.ACTION }
            });
            const action = { type: ACTION_TYPES.REARRANGE, playerId: 'p2' };
            const result = validateRearrangeAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /Only the current player/);
        });
    });

    describe('DISCARD phase — validateDiscardAction', function() {
        it('should allow discard when in DISCARD phase and hand exceeds 7', function() {
            const state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: new Array(8).fill({ id: 'c' }), bank: [], properties: {} }
                },
                turn: { phase: PHASES.DISCARD }
            });
            const action = { type: ACTION_TYPES.DISCARD, playerId: 'p1', cardId: 'c1' };
            const result = validateDiscardAction(state, action);
            assert.strictEqual(result.legal, true);
        });

        it('should reject discard if hand is already within limit', function() {
            const state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: new Array(7).fill({ id: 'c' }), bank: [], properties: {} }
                },
                turn: { phase: PHASES.DISCARD }
            });
            const action = { type: ACTION_TYPES.DISCARD, playerId: 'p1', cardId: 'c1' };
            const result = validateDiscardAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /Hand is already within/);
        });

        it('should reject discard if not in DISCARD phase', function() {
            const state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: new Array(8).fill({ id: 'c' }), bank: [], properties: {} }
                },
                turn: { phase: PHASES.ACTION }
            });
            const action = { type: ACTION_TYPES.DISCARD, playerId: 'p1', cardId: 'c1' };
            const result = validateDiscardAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /Discarding is only allowed once/);
        });
    });

    describe('END_TURN — validateEndTurnAction', function() {
        it('should allow ending turn if in action phase and hand <= 7', function() {
            const state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: new Array(7).fill({ id: 'c' }), bank: [], properties: {} }
                },
                turn: { phase: PHASES.ACTION }
            });
            const action = { type: ACTION_TYPES.END_TURN, playerId: 'p1' };
            const result = validateEndTurnAction(state, action);
            assert.strictEqual(result.legal, true);
        });

        it('should allow ending turn from ACTION if hand > 7 (transitions to DISCARD)', function() {
            const state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: new Array(8).fill({ id: 'c' }), bank: [], properties: {} }
                },
                turn: { phase: PHASES.ACTION }
            });
            const action = { type: ACTION_TYPES.END_TURN, playerId: 'p1' };
            const result = validateEndTurnAction(state, action);
            assert.strictEqual(result.legal, true); // legal to call end_turn; applyValidatedAction handles moving to DISCARD phase
        });

        it('should reject ending turn if in DISCARD phase and hand > 7', function() {
            const state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: new Array(8).fill({ id: 'c' }), bank: [], properties: {} }
                },
                turn: { phase: PHASES.DISCARD }
            });
            const action = { type: ACTION_TYPES.END_TURN, playerId: 'p1' };
            const result = validateEndTurnAction(state, action);
            assert.strictEqual(result.legal, false);
            assert.match(result.reason, /Must discard down/);
        });
    });

    describe('applyValidatedAction — transitions and counters', function() {
        it('should increment playsMade on PLAY_CARD', function() {
            let state = makeState({
                turn: { phase: PHASES.ACTION, playsMade: 0 }
            });
            state = applyValidatedAction(state, { type: ACTION_TYPES.PLAY_CARD, playerId: 'p1', cardId: 'c1' });
            assert.strictEqual(state.turn.playsMade, 1);
            state = applyValidatedAction(state, { type: ACTION_TYPES.PLAY_CARD, playerId: 'p1', cardId: 'c2' });
            assert.strictEqual(state.turn.playsMade, 2);
        });

        it('should transit to ACTION on DRAW', function() {
            let state = makeState({
                turn: { phase: PHASES.DRAW, hasDrawn: false }
            });
            state = applyValidatedAction(state, { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 5 });
            assert.strictEqual(state.turn.hasDrawn, true);
            assert.strictEqual(state.turn.phase, PHASES.ACTION);
        });

        it('should transition to DISCARD on END_TURN if hand > 7', function() {
            let state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: new Array(8).fill({ id: 'c' }), bank: [], properties: {} }
                },
                turn: { phase: PHASES.ACTION }
            });
            state = applyValidatedAction(state, { type: ACTION_TYPES.END_TURN, playerId: 'p1' });
            assert.strictEqual(state.turn.phase, PHASES.DISCARD);
        });

        it('should transition to COMPLETE on END_TURN if hand <= 7', function() {
            let state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: new Array(7).fill({ id: 'c' }), bank: [], properties: {} }
                },
                turn: { phase: PHASES.ACTION }
            });
            state = applyValidatedAction(state, { type: ACTION_TYPES.END_TURN, playerId: 'p1' });
            assert.strictEqual(state.turn.phase, PHASES.COMPLETE);
        });

        it('should transition to COMPLETE on DISCARD if remaining hand <= 7', function() {
            let state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: new Array(8).fill({ id: 'c' }), bank: [], properties: {} }
                },
                turn: { phase: PHASES.DISCARD }
            });
            state = applyValidatedAction(state, { type: ACTION_TYPES.DISCARD, playerId: 'p1', cardId: 'c1' });
            assert.strictEqual(state.turn.phase, PHASES.COMPLETE);
        });

        it('should keep DISCARD phase on DISCARD if remaining hand still > 7', function() {
            let state = makeState({
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: new Array(9).fill({ id: 'c' }), bank: [], properties: {} }
                },
                turn: { phase: PHASES.DISCARD }
            });
            state = applyValidatedAction(state, { type: ACTION_TYPES.DISCARD, playerId: 'p1', cardId: 'c1' });
            assert.strictEqual(state.turn.phase, PHASES.DISCARD);
        });
    });

    describe('Full Turn Integration', function() {
        it('should execute a complete valid turn lifecycle smoothly', function() {
            let state = {
                players: {
                    p1: { id: 'p1', name: 'Scott', hand: [], bank: [], properties: {} },
                    p2: { id: 'p2', name: 'Riri', hand: [], bank: [], properties: {} }
                },
                turnOrder: ['p1', 'p2'],
                turn: null,
                pendingActionResolution: null
            };

            // Start turn (empty hand -> must draw 5)
            state.turn = startTurn(state, 'p1');
            assert.strictEqual(state.turn.phase, PHASES.DRAW);
            
            // Draw
            state = applyValidatedAction(state, { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 5 });
            assert.strictEqual(state.turn.phase, PHASES.ACTION);

            // Give them some hand cards
            state.players.p1.hand = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }, { id: 'c5' }];

            // Play 3 cards
            state = applyValidatedAction(state, { type: ACTION_TYPES.PLAY_CARD, playerId: 'p1', cardId: 'c1' });
            state = applyValidatedAction(state, { type: ACTION_TYPES.PLAY_CARD, playerId: 'p1', cardId: 'c2' });
            state = applyValidatedAction(state, { type: ACTION_TYPES.PLAY_CARD, playerId: 'p1', cardId: 'c3' });
            assert.strictEqual(state.turn.playsMade, 3);

            // 4th play should be blocked
            const blockedResult = validateAction(state, { type: ACTION_TYPES.PLAY_CARD, playerId: 'p1', cardId: 'c4' });
            assert.strictEqual(blockedResult.legal, false);

            // Rearrange (free, allowed)
            state = applyValidatedAction(state, { type: ACTION_TYPES.REARRANGE, playerId: 'p1' });
            assert.strictEqual(state.turn.playsMade, 3); // didn't change playsMade

            // Hand size grows to 8 (e.g. drawn from action card or other events)
            state.players.p1.hand = new Array(8).fill({ id: 'h' });

            // End turn (moves to DISCARD because hand size is 8 > 7)
            state = applyValidatedAction(state, { type: ACTION_TYPES.END_TURN, playerId: 'p1' });
            assert.strictEqual(state.turn.phase, PHASES.DISCARD);

            // Discard 1 card
            state = applyValidatedAction(state, { type: ACTION_TYPES.DISCARD, playerId: 'p1', cardId: 'h0' });
            assert.strictEqual(state.turn.phase, PHASES.COMPLETE);
        });
    });
});
