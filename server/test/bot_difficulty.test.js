const assert = require('assert');
const {
  MonopolyBotEngine,
  DIFFICULTY_PROFILES,
  getDifficultyProfiles,
  normalizeDifficultyParams
} = require('../bot_engine');
const { createGameState } = require('../game_manager');

describe('Monopoly Deal AI Bot Hand Handicapping & Dynamic Difficulty Levels (v2.9)', function() {
  let engine;

  beforeEach(function() {
    engine = new MonopolyBotEngine();
  });

  it('should return 4 difficulty profiles via getDifficultyProfiles()', function() {
    const profiles = getDifficultyProfiles();
    assert.strictEqual(Object.keys(profiles).length, 4);
    assert.ok(profiles.EASY);
    assert.ok(profiles.MEDIUM);
    assert.ok(profiles.HARD);
    assert.ok(profiles.GRANDMASTER);
    assert.strictEqual(profiles.EASY.moveEvaluationDepth, 1);
    assert.strictEqual(profiles.GRANDMASTER.moveEvaluationDepth, 4);
  });

  it('should normalize difficulty parameters with base profile and overrides', function() {
    const defaultParams = normalizeDifficultyParams({});
    assert.strictEqual(defaultParams.difficultyLevel, 'MEDIUM');
    assert.strictEqual(defaultParams.moveEvaluationDepth, 2);

    const customParams = normalizeDifficultyParams({
      difficultyLevel: 'EASY',
      handicapParams: { moveEvaluationDepth: 3, mistakeInjectionRate: 0.1 }
    });
    assert.strictEqual(customParams.difficultyLevel, 'EASY');
    assert.strictEqual(customParams.moveEvaluationDepth, 3);
    assert.strictEqual(customParams.mistakeInjectionRate, 0.1);
  });

  it('should normalize BALANCED alias to MEDIUM profile', function() {
    const params = normalizeDifficultyParams({ difficultyLevel: 'BALANCED' });
    assert.strictEqual(params.difficultyLevel, 'MEDIUM');
  });

  it('should return end_turn decision when playsMade >= MAX_PLAYS_PER_TURN in decideMoveHandicapped', function() {
    const players = [{ id: 'p1', name: 'Bot' }, { id: 'p2', name: 'Opponent' }];
    const gs = createGameState(players);
    gs.turn = { playerId: 'p1', phase: 'ACTION', playsMade: 3 };
    gs.players.p1.hand = [
      { id: 'c1', type: 'money', value: 2 }
    ];

    const result = engine.decideMoveHandicapped(gs, 'p1', { difficultyLevel: 'HARD' });
    assert.strictEqual(result.decision.action, 'end_turn');
    assert.strictEqual(result.decision.reason, 'Maximum plays reached for turn');
  });

  it('should throw error on unknown difficulty level', function() {
    assert.throws(() => {
      normalizeDifficultyParams({ difficultyLevel: 'IMPOSSIBLE' });
    }, /Unknown difficulty level/);
  });

  it('should compute handicapped move decision with depth and difficulty context', function() {
    const players = [{ id: 'p1', name: 'Bot' }, { id: 'p2', name: 'Opponent' }];
    const gs = createGameState(players);
    gs.turn = { playerId: 'p1', phase: 'ACTION', playsMade: 0 };
    gs.players.p1.hand = [
      { id: 'c1', type: 'property', title: 'Boardwalk', color: 'blue', value: 4 },
      { id: 'c2', type: 'money', value: 3 }
    ];

    const result = engine.decideMoveHandicapped(gs, 'p1', { difficultyLevel: 'HARD' });
    assert.ok(result.decision);
    assert.ok(result.difficultyContext);
    assert.strictEqual(result.difficultyContext.appliedParams.difficultyLevel, 'HARD');
    assert.strictEqual(result.difficultyContext.depthUsed, 3);
  });

  it('should fallback strategy profiles to MEDIUM difficulty', function() {
    const params = normalizeDifficultyParams({ difficultyLevel: 'AGGRESSIVE' });
    assert.strictEqual(params.difficultyLevel, 'MEDIUM');
  });

  it('should inject mistake when mistakeInjectionRate is 1.0', function() {
    const players = [{ id: 'p1', name: 'Bot' }, { id: 'p2', name: 'Opponent' }];
    const gs = createGameState(players);
    gs.currentTurnPlayerId = 'p1';
    gs.players.p1.hand = [
      { id: 'c1', type: 'money', value: 2 },
      { id: 'c2', type: 'property', title: 'Park Place', color: 'blue', value: 4 }
    ];

    const result = engine.decideMoveHandicapped(gs, 'p1', {
      difficultyLevel: 'EASY',
      handicapParams: { mistakeInjectionRate: 1.0 },
      randomFn: () => 0.0
    });

    assert.ok(result.difficultyContext.mistakeInjected);
    assert.ok(result.decision.reason.includes('[MISTAKE]'));
  });
});
