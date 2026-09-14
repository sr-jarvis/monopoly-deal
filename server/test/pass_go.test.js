'use strict';

const assert = require('assert');
const gameManager = require('../game_manager');
const { ACTION_TYPES, PHASES } = require('../rules_validator');
const ActionCard = require('../models/ActionCard');

function passGo(id = 'pass-go') {
    const card = new ActionCard('Pass Go', 'Draw 2 extra cards. Play into center to use.', 1);
    card.id = id;
    return card;
}

function card(id, title = id) {
    return { id, title, kind: 'MONEY', value: 1 };
}

function actionState() {
    const state = gameManager.createGameState([
        { id: 'p1', name: 'Scott' },
        { id: 'p2', name: 'Riri' }
    ]);
    return gameManager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId: 'p1', count: 2 }).gameState;
}

function playPassGo(state, overrides = {}) {
    return gameManager.applyAction(state, {
        type: ACTION_TYPES.PLAY_ACTION_CARD,
        playerId: 'p1',
        cardId: 'pass-go',
        targetZone: 'action',
        ...overrides
    });
}

describe('Pass Go — server-authoritative extra draw', function () {
    it('discards Pass Go, draws two cards, and retains the action phase', function () {
        const state = actionState();
        state.players.p1.hand = [passGo(), card('kept')];
        state.drawPile = [card('draw-1'), card('draw-2')];
        const snapshot = JSON.stringify(state);

        const result = playPassGo(state);
        const next = result.gameState;

        assert.strictEqual(result.legal, true);
        assert.strictEqual(JSON.stringify(state), snapshot);
        assert.deepStrictEqual(next.players.p1.hand.map(c => c.id).sort(), ['draw-1', 'draw-2', 'kept']);
        assert.deepStrictEqual(next.discardPile.map(c => c.id), ['pass-go']);
        assert.strictEqual(next.drawPile.length, 0);
        assert.strictEqual(next.turn.phase, PHASES.ACTION);
        assert.strictEqual(next.turn.playsMade, 1);
        assert.strictEqual(next.turn.hasDrawn, true);
        assert.strictEqual(next.pendingCharge, undefined);
        assert.strictEqual(next.replayLogs.at(-1).actionType, ACTION_TYPES.PLAY_ACTION_CARD);
    });

    it('uses the normal reshuffle path when the draw pile runs out mid-draw', function () {
        const state = actionState();
        state.players.p1.hand = [passGo()];
        state.drawPile = [card('draw-1')];
        state.discardPile = [card('discard-1'), card('discard-2')];

        const result = playPassGo(state);
        const next = result.gameState;

        assert.strictEqual(result.legal, true);
        assert.strictEqual(next.players.p1.hand.length, 2);
        assert.strictEqual(next.discardPile.length, 0);
        assert.strictEqual(next.drawPile.length, 2);
        assert.strictEqual(next.turn.playsMade, 1);
    });

    it('remains authoritative when neither pile can supply extra cards', function () {
        const state = actionState();
        state.players.p1.hand = [passGo()];
        state.drawPile = [];
        state.discardPile = [];

        const result = playPassGo(state);

        assert.strictEqual(result.legal, true);
        // Pass Go itself is available to the normal reshuffle, so it is the
        // only card drawn when both piles were otherwise empty.
        assert.deepStrictEqual(result.gameState.players.p1.hand.map(c => c.id), ['pass-go']);
        assert.strictEqual(result.gameState.turn.playsMade, 1);
    });

    it('rejects a non-current player without changing authoritative state', function () {
        const state = actionState();
        state.players.p2.hand = [passGo()];
        const snapshot = JSON.stringify(state);

        const result = gameManager.applyAction(state, {
            type: ACTION_TYPES.PLAY_ACTION_CARD,
            playerId: 'p2',
            cardId: 'pass-go',
            targetZone: 'action'
        });

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /current player/i);
        assert.strictEqual(JSON.stringify(state), snapshot);
    });

    it('rejects an action-phase violation without changing authoritative state', function () {
        const state = actionState();
        state.players.p1.hand = [passGo()];
        state.turn.phase = PHASES.DRAW;
        state.turn.hasDrawn = false;
        const snapshot = JSON.stringify(state);

        const result = playPassGo(state);

        assert.strictEqual(result.legal, false);
        assert.match(result.reason, /action phase|draw first/i);
        assert.strictEqual(JSON.stringify(state), snapshot);
    });
});
