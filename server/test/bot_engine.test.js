const assert = require('assert');
const { MonopolyBotEngine } = require('../bot_engine');
const { createGameState } = require('../game_manager');
const MoneyCard = require('../models/MoneyCard');
const PropertyCard = require('../models/PropertyCard');
const Wildcard = require('../models/Wildcard');
const ActionCard = require('../models/ActionCard');

describe('MonopolyBotEngine (v2.4)', function() {
  let bot;

  beforeEach(function() {
    bot = new MonopolyBotEngine();
  });

  it('should correctly classify cards by structural properties', function() {
    const money = new MoneyCard(5, 101);
    const prop = new PropertyCard('Boardwalk', 4, 'BLUE', 102);
    const wild = new Wildcard('Property Wild Card', 3, ['BLUE', 'GREEN'], 103);
    const action = new ActionCard('Pass Go', 'Draw 2 extra cards.', 1, 104);

    assert.strictEqual(bot.classifyCard(money), 'money');
    assert.strictEqual(bot.classifyCard(prop), 'property');
    assert.strictEqual(bot.classifyCard(wild), 'wildcard');
    assert.strictEqual(bot.classifyCard(action), 'action');
  });

  it('should prioritize playing property cards to advance property sets', function() {
    const players = [
      { id: 'p1', name: 'Bot Player' },
      { id: 'p2', name: 'Opponent' }
    ];
    const gs = createGameState(players);
    const propCard = new PropertyCard('Park Place', 4, 'BLUE');
    propCard.id = 'prop-201';
    const moneyCard = new MoneyCard(2, 202);
    moneyCard.id = 'money-202';

    gs.players['p1'].hand = [moneyCard, propCard];
    gs.turn.playerId = 'p1';
    gs.turn.playsMade = 0;

    const decision = bot.evaluateHandAndState(gs, 'p1');
    assert.strictEqual(decision.action, 'play');
    assert.strictEqual(decision.cardId, propCard.id);
    assert.strictEqual(decision.propertyColor, 'BLUE');
  });

  it('should bank money when no property set play exists', function() {
    const players = [
      { id: 'p1', name: 'Bot Player' },
      { id: 'p2', name: 'Opponent' }
    ];
    const gs = createGameState(players);
    const moneyCard = new MoneyCard(5, 301);
    moneyCard.id = 'money-301';

    gs.players['p1'].hand = [moneyCard];
    gs.turn.playerId = 'p1';
    gs.turn.playsMade = 0;

    const decision = bot.evaluateHandAndState(gs, 'p1');
    assert.strictEqual(decision.action, 'bank');
    assert.strictEqual(decision.cardId, moneyCard.id);
    assert.strictEqual(decision.targetZone, 'bank');
  });

  it('should terminate turn when playsMade reaches 3', function() {
    const players = [
      { id: 'p1', name: 'Bot Player' },
      { id: 'p2', name: 'Opponent' }
    ];
    const gs = createGameState(players);
    const moneyCard = new MoneyCard(5, 401);
    moneyCard.id = 'money-401';

    gs.players['p1'].hand = [moneyCard];
    gs.turn.playerId = 'p1';
    gs.turn.playsMade = 3;

    const decision = bot.evaluateHandAndState(gs, 'p1');
    assert.strictEqual(decision.action, 'end_turn');
    assert.ok(decision.reason.includes('0 actions remain'));
  });

  it('should discard card when hand exceeds 7 cards during discard phase', function() {
    const players = [
      { id: 'p1', name: 'Bot Player' },
      { id: 'p2', name: 'Opponent' }
    ];
    const gs = createGameState(players);
    const cards = [];
    for (let i = 0; i < 8; i++) {
      const c = new MoneyCard(i + 1, 500 + i);
      c.id = `money-${500 + i}`;
      cards.push(c);
    }

    gs.players['p1'].hand = cards;
    gs.turn.playerId = 'p1';
    gs.turn.phase = 'DISCARD';

    const decision = bot.evaluateHandAndState(gs, 'p1');
    assert.strictEqual(decision.action, 'discard');
    assert.strictEqual(decision.cardId, cards[0].id); // Lowest value card
  });
});
