'use strict';
const assert = require('assert');
const game = require('../../game_manager');

// Existing effect/settlement characterization tests assume the opponent accepts.
// Script that explicit decision here; manual_complete.test.js exercises raw
// response windows, cancellation, countering, authorization and deferred wins.
module.exports = { ...game, applyAction(state, action) {
 let result = game.applyAction(state, action);
 while (result.legal && result.gameState.pendingActionResolution) {
  const pending = result.gameState.pendingActionResolution;
  const accepted = game.applyAction(result.gameState, {type:'ACCEPT_ACTION', playerId:pending.eligibleResponderIds[0]});
  assert.strictEqual(accepted.legal, true, accepted.reason);
  result = { ...result, ...accepted };
 }
 return result;
}};
