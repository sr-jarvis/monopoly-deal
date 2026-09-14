'use strict';

const assert = require('assert');
const game_manager = require('../game_manager');
const { ACTION_TYPES, PHASES } = require('../rules_validator');

describe('Monopoly Deal Game Event Replay & Match Telemetry (v2.3)', function() {
    let players;

    beforeEach(function() {
        players = [
            { id: 'p1', name: 'Alice' },
            { id: 'p2', name: 'Bob' }
        ];
    });

    describe('recordGameEvent & summarizePlayerPublicState', function() {
        it('should summarize player public state without exposing raw hand/bank cards', function() {
            const state = game_manager.createGameState(players);
            const summary = game_manager.summarizePlayerPublicState(state.players.p1);
            assert.strictEqual(typeof summary.handCount, 'number');
            assert.strictEqual(summary.handCount, 5);
            assert.strictEqual(typeof summary.bankTotal, 'number');
            assert.strictEqual(summary.bankTotal, 0);
            assert.strictEqual(typeof summary.properties, 'object');
            assert.strictEqual(summary.hand, undefined);
            assert.strictEqual(summary.bank, undefined);
        });

        it('should record game event and increment seq counter', function() {
            const state = game_manager.createGameState(players);
            game_manager.recordGameEvent(state, 'TEST_ACTION', 'p1', { test: true }, 'APPLIED');
            assert.strictEqual(state.replayLogs.length, 1);
            assert.strictEqual(state.replayLogs[0].seq, 1);
            assert.strictEqual(state.replayLogs[0].actionType, 'TEST_ACTION');
            assert.strictEqual(state.replayLogs[0].actorId, 'p1');
            assert.strictEqual(state.replayLogs[0].status, 'APPLIED');
            assert.strictEqual(typeof state.replayLogs[0].boardSnapshotSummary, 'object');
        });
    });

    describe('applyAction event logging integration', function() {
        it('should log DRAW action in replay logs', function() {
            const state = game_manager.createGameState(players);
            const drawAction = { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 2 };
            const result = game_manager.applyAction(state, drawAction);
            assert.strictEqual(result.legal, true, result.reason);
            const nextState = result.gameState;
            assert.strictEqual(nextState.replayLogs.length, 1);
            assert.strictEqual(nextState.replayLogs[0].actionType, ACTION_TYPES.DRAW);
            assert.strictEqual(nextState.replayLogs[0].actorId, 'p1');
        });

        it('should log PLAY_CARD action in replay logs and track telemetry', function() {
            const state = game_manager.createGameState(players);
            // First draw
            const drawRes = game_manager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 2 });
            assert.strictEqual(drawRes.legal, true, drawRes.reason);
            const p1State = drawRes.gameState;

            // Find a playable card in hand
            const hand = p1State.players.p1.hand;
            assert(hand.length > 0, 'Hand should contain cards');
            const cardToPlay = hand[0];

            let playAction;
            if (cardToPlay.type === 'PROPERTY' || cardToPlay.type === 'WILDCARD') {
                playAction = {
                    type: ACTION_TYPES.PLAY_CARD,
                    playerId: 'p1',
                    cardId: cardToPlay.id,
                    targetZone: 'PROPERTIES',
                    propertyColor: cardToPlay.color || (cardToPlay.colors ? cardToPlay.colors[0] : 'Green')
                };
            } else {
                playAction = {
                    type: ACTION_TYPES.PLAY_CARD,
                    playerId: 'p1',
                    cardId: cardToPlay.id,
                    targetZone: 'BANK'
                };
            }

            const playRes = game_manager.applyAction(p1State, playAction);
            assert.strictEqual(playRes.legal, true, playRes.reason);
            const finalState = playRes.gameState;

            assert.strictEqual(finalState.replayLogs.length, 2);
            assert.strictEqual(finalState.replayLogs[1].actionType, ACTION_TYPES.PLAY_CARD);

            const telemetry = game_manager.getMatchTelemetry(finalState);
            assert.strictEqual(telemetry.totalActionsApplied, 2);
            assert.strictEqual(telemetry.actionCountsByPlayer.p1, 2);
            assert.strictEqual(telemetry.actionCountsByType[ACTION_TYPES.DRAW], 1);
            assert.strictEqual(telemetry.actionCountsByType[ACTION_TYPES.PLAY_CARD], 1);
            assert.strictEqual(telemetry.perPlayer.p1.handCount, finalState.players.p1.hand.length);
        });
    });
});
