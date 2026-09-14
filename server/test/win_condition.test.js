'use strict';

const assert = require('assert');
const rules = require('../rules_validator');
const gameManager = require('../game_manager');

describe('Game Victory & Set Requirement Resolution (v2.2)', function() {
    it('should identify player with 0 or 1 complete property set as non-winner', function() {
        const playerState = {
            properties: {
                DarkBlue: { cards: [{ id: 'db1' }, { id: 'db2' }] }, // DarkBlue set size = 2
                Brown: { cards: [{ id: 'br1' }] }                    // Brown set size = 2 (incomplete)
            }
        };
        const result = rules.checkWinCondition(playerState);
        assert.strictEqual(result.isWinner, false);
        assert.deepStrictEqual(result.completedSetColors, ['DarkBlue']);
    });

    it('should identify player with 3 complete sets of distinct colors as winner', function() {
        const playerState = {
            properties: {
                DarkBlue: { cards: [{ id: 'db1' }, { id: 'db2' }] }, // complete (2)
                Brown: { cards: [{ id: 'br1' }, { id: 'br2' }] },    // complete (2)
                Utility: { cards: [{ id: 'ut1' }, { id: 'ut2' }] }   // complete (2)
            }
        };
        const result = rules.checkWinCondition(playerState);
        assert.strictEqual(result.isWinner, true);
        assert.strictEqual(result.completedSetColors.length, 3);
        assert.ok(result.details.includes('3 full sets'));
    });

    it('should handle overfull property sets correctly without double-counting', function() {
        const playerState = {
            properties: {
                DarkBlue: { cards: [{ id: 'db1' }, { id: 'db2' }, { id: 'db3' }] }, // overfull set (3 cards for size 2)
                Brown: { cards: [{ id: 'br1' }, { id: 'br2' }] },
                Utility: { cards: [{ id: 'ut1' }, { id: 'ut2' }] }
            }
        };
        const result = rules.checkWinCondition(playerState);
        assert.strictEqual(result.isWinner, true);
        assert.strictEqual(result.completedSetColors.length, 3);
    });

    it('should reject win condition if player has only 2 complete sets', function() {
        const playerState = {
            properties: {
                Green: { cards: [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }] }, // complete (3)
                Yellow: { cards: [{ id: 'y1' }, { id: 'y2' }, { id: 'y3' }] }  // complete (3)
            }
        };
        const result = rules.checkWinCondition(playerState);
        assert.strictEqual(result.isWinner, false);
        assert.strictEqual(result.completedSetColors.length, 2);
    });

    it('should evaluate win condition via game_manager.evaluateWinCondition', function() {
        const state = gameManager.createGameState([
            { id: 'p1', name: 'Scott' },
            { id: 'p2', name: 'Shuri' }
        ]);

        // Grant p1 three complete sets
        state.players.p1.properties = {
            DarkBlue: { cards: [{ id: 'db1' }, { id: 'db2' }] },
            Brown: { cards: [{ id: 'br1' }, { id: 'br2' }] },
            Utility: { cards: [{ id: 'ut1' }, { id: 'ut2' }] }
        };

        const evalResult = gameManager.evaluateWinCondition(state, 'p1');
        assert.strictEqual(evalResult.legal, true);
        assert.strictEqual(evalResult.winResult.isWinner, true);
        assert.strictEqual(evalResult.transitioned, true);
        assert.strictEqual(evalResult.gameState.status, 'FINISHED');
        assert.strictEqual(evalResult.gameState.winnerId, 'p1');
    });

    it('should reject game actions when game status is FINISHED', function() {
        const state = gameManager.createGameState([
            { id: 'p1', name: 'Scott' },
            { id: 'p2', name: 'Shuri' }
        ]);
        state.status = 'FINISHED';

        const actionResult = gameManager.applyAction(state, { type: 'DRAW', playerId: 'p1' });
        assert.strictEqual(actionResult.legal, false);
        assert.strictEqual(actionResult.reason, 'Game is already finished.');
    });
});
