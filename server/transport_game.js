'use strict';

const game = require('./game_manager');
const { PHASES, MAX_PLAYS_PER_TURN, getRequiredDrawCount, hasOutstandingPendingCharge } = require('./rules_validator');

// Transport policy only: the engine remains a manual-turn API for simulations
// and rule callers. Run after the entire action (including deferred responses),
// never inside a speculative board transfer or before every debtor has settled.
function progressTurn(state) {
    let next = state;
    while (next.status !== 'FINISHED' && !next.pendingActionResolution && !hasOutstandingPendingCharge(next)) {
        const turn = next.turn;
        let action;
        if (turn.phase === PHASES.DRAW && !turn.hasDrawn) {
            action = { type: 'DRAW', playerId: turn.playerId, count: getRequiredDrawCount(turn.handSizeAtStartOfTurn) };
        } else if (turn.phase === PHASES.ACTION && turn.playsMade >= MAX_PLAYS_PER_TURN) {
            action = { type: 'END_TURN', playerId: turn.playerId };
        } else break; // DISCARD belongs to the seat until exactly HAND_LIMIT.
        const result = game.applyAction(next, action);
        if (!result.legal) throw new Error(`Automatic ${action.type} failed: ${result.reason}`);
        next = result.gameState;
    }
    return next;
}

function applyAction(state, action) {
    const result = game.applyAction(state, action);
    if (!result.legal) return result;
    return { ...result, gameState: progressTurn(result.gameState) };
}

module.exports = { applyAction, progressTurn };
