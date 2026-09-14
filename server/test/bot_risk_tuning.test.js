const assert = require('assert');
const {
  MonopolyBotEngine,
  RISK_PROFILES,
  normalizeRiskParams,
  computeEffectiveRiskTolerance
} = require('../bot_engine');
const game_manager = require('../game_manager');

describe('Monopoly Deal AI Bot Risk Tuning & Adaptive Engine (v2.7)', function() {
  it('should normalize risk parameters with correct bounds and defaults', function() {
    const defaultParams = normalizeRiskParams();
    assert.strictEqual(defaultParams.name, 'MODERATE');
    assert.strictEqual(defaultParams.riskTolerance, 0.5);

    const customParams = normalizeRiskParams({
      riskProfile: 'HIGH_RISK',
      riskParams: { riskTolerance: 1.5, exposureLimit: -10 }
    });
    assert.strictEqual(customParams.name, 'HIGH_RISK');
    assert.strictEqual(customParams.riskTolerance, 1.0); // Clamped to 1.0
    assert.strictEqual(customParams.exposureLimit, 0); // Clamped to 0
  });

  it('should throw error on unknown risk profile name', function() {
    assert.throws(() => {
      normalizeRiskParams({ riskProfile: 'SUPER_AGGRESSIVE' });
    }, /Unknown risk profile/);
  });

  it('should compute adaptive effective risk tolerance based on opponent threat', function() {
    const gameState = game_manager.createGameState([
      { id: 'p1', name: 'Scott' },
      { id: 'p2', name: 'Riri' }
    ]);
    
    // Give p2 two completed sets (threat)
    gameState.players.p2.properties = {
      DarkBlue: { cards: [{ id: 'b1', value: 4 }, { id: 'b2', value: 4 }] },
      Brown: { cards: [{ id: 'br1', value: 1 }, { id: 'br2', value: 1 }] }
    };

    const params = normalizeRiskParams({ riskProfile: 'MODERATE' });
    const { effectiveRiskTolerance, adaptiveAdjustments } = computeEffectiveRiskTolerance(gameState, 'p1', params);

    assert(effectiveRiskTolerance < params.riskTolerance, 'Effective tolerance should decrease due to threat');
    assert.strictEqual(adaptiveAdjustments.length, 1);
    assert.strictEqual(adaptiveAdjustments[0].reason, 'Opponent near victory threat');
  });

  it('should enforce exposure limit during custom decision evaluation', function() {
    const bot = new MonopolyBotEngine();
    const gameState = game_manager.createGameState([
      { id: 'p1', name: 'Scott' },
      { id: 'p2', name: 'Riri' }
    ]);

    // Set p1 property exposure to $10
    gameState.players.p1.properties = {
      green: { cards: [{ id: 'g1', value: 4 }, { id: 'g2', value: 4 }] }
    };
    gameState.players.p1.hand = [
      { id: 'prop1', type: 'dark_blue', value: 4 },
      { id: 'm1', value: 2 }
    ];

    // Conservative profile has exposure limit of 6
    const res = bot.decideMoveCustom(gameState, 'p1', { riskProfile: 'CONSERVATIVE' });
    assert.strictEqual(res.decision.action, 'bank');
    assert(res.decision.reason.includes('Exposure limit'), 'Reason should cite exposure limit');
    assert.strictEqual(res.riskContext.appliedParams.name, 'CONSERVATIVE');
  });
});
