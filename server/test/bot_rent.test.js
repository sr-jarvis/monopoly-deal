'use strict';

// Standard two-color solo-bot Rent cards: planner selection / tie-break, the
// planner -> app.js replay mapping, bot->human parking, and the exclusions
// (all-color Rent, Double The Rent, no owned colors, play limit, precedence).
// All fixtures are deterministic — no RNG — so the planner simulation and the
// authoritative replay always agree.

const assert = require('assert');

const game_manager = require('../game_manager');
const room_registry = require('../room_registry');
const turn_planner = require('../turn_planner');
const app = require('../app');
const { ACTION_TYPES, PHASES } = require('../rules_validator');
const RentCard = require('../models/RentCard');
const ActionCard = require('../models/ActionCard');
const PropertyCard = require('../models/PropertyCard');
const PropertyType = require('../models/PropertyType');
const MoneyCard = require('../models/MoneyCard');

function rent(id, colors) {
  const card = new RentCard('Rent', colors.length > 2 ? 3 : 1, colors);
  card.id = id;
  return card;
}

function dtr(id) {
  const card = new ActionCard('Double The Rent', 'Play with a Rent card.', 1);
  card.id = id;
  return card;
}

function money(id, value) {
  const card = new MoneyCard(`${value}M`, value);
  card.id = id;
  return card;
}

function propGroup(ownerId, color, count) {
  const cards = [];
  for (let i = 0; i < count; i += 1) {
    const card = new PropertyCard(`${color} ${i}`, 1, color);
    card.id = `${ownerId}-${color}-${i}`;
    cards.push(card);
  }
  return { cards, hasHouse: false, hasHotel: false };
}

function actionState(players, actorId) {
  const state = game_manager.createGameState(players);
  const drawn = game_manager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId: actorId, count: 2 });
  assert.strictEqual(drawn.legal, true);
  return drawn.gameState;
}

function botState() {
  return actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
}

function planRentStep(state) {
  const plan = turn_planner.planTurnActionSequence(state, 'bot');
  return plan.steps.find(step => step.type === 'PLAY_ACTION_CARD');
}

function makeBotRoom(label) {
  const room = room_registry.createRoom(`human-${label}`, `Human ${label}`);
  const added = room_registry.addBotSeat(room.roomCode, 'Bot 1');
  assert.ok(!added.error);
  const players = room.seats.map(seat => ({ id: seat.playerId, name: seat.displayName }));
  const firstBot = room.seats.find(seat => seat.isBot);
  room.gameState = actionState(players, room.hostPlayerId);
  room.gameState.turn.playerId = firstBot.playerId;
  room.gameState.turn.phase = PHASES.ACTION;
  room.gameState.turn.hasDrawn = true;
  room.gameState.turn.playsMade = 0;
  room.status = 'IN_PROGRESS';
  return { room, firstBot };
}

describe('Solo bot standard Rent cards', function () {
  afterEach(function () {
    for (const room of room_registry.listRooms()) {
      if (room.roomCode) room_registry.deleteRoom(room.roomCode);
    }
  });

  it('picks the color that charges the most, and tie-breaks deterministically', function () {
    const richer = botState();
    richer.players.bot.properties.Brown = propGroup('bot', 'Brown', 2);      // full set: base 2 x2 = 4
    richer.players.bot.properties.LightBlue = propGroup('bot', 'LightBlue', 1); // base 1
    richer.players.bot.hand = [rent('rent-1', [PropertyType.Brown, PropertyType.LightBlue])];

    const play = turn_planner.selectRentCardPlay(richer, 'bot');
    assert.ok(play);
    assert.strictEqual(play.propertyColor, 'Brown');
    assert.strictEqual(play.type, ACTION_TYPES.PLAY_ACTION_CARD);
    assert.strictEqual(play.targetPlayerId, undefined);

    // Equal charges break lexicographically by color, regardless of card/color
    // order in the hand; same-color ties retain the earlier hand card.
    const tied = botState();
    tied.players.bot.properties.Brown = propGroup('bot', 'Brown', 1);   // base 1
    tied.players.bot.properties.Purple = propGroup('bot', 'Purple', 1); // base 1
    tied.players.bot.hand = [
      rent('rent-a', [PropertyType.Purple, PropertyType.Brown]),
      rent('rent-b', [PropertyType.Brown, PropertyType.Purple])
    ];
    const tiedPlay = turn_planner.selectRentCardPlay(tied, 'bot');
    assert.strictEqual(tiedPlay.cardId, 'rent-a');
    assert.strictEqual(tiedPlay.propertyColor, 'Brown');
  });

  it('records propertyColor on the planned step so the app.js replay is legal', function () {
    const state = botState();
    state.players.bot.properties.Brown = propGroup('bot', 'Brown', 2);
    state.players.bot.hand = [rent('rent-1', [PropertyType.Brown, PropertyType.LightBlue])];

    const step = planRentStep(state);
    assert.ok(step);
    assert.strictEqual(step.cardId, 'rent-1');
    assert.strictEqual(step.propertyColor, 'Brown');

    const action = app.__botDriver.botStepToAction(step, 'bot');
    assert.strictEqual(action.propertyColor, 'Brown');
    assert.ok(!Object.prototype.hasOwnProperty.call(action, 'doubleRentCardId'));

    const replay = game_manager.applyAction(state, action);
    assert.strictEqual(replay.legal, true);
    assert.strictEqual(replay.gameState.pendingCharge.type, 'RENT');
    assert.strictEqual(replay.gameState.pendingCharge.rentColor, 'Brown');
    assert.strictEqual(replay.gameState.pendingCharge.doubled, false);
    assert.strictEqual(replay.gameState.pendingCharge.debtors.human.amountOwed, 4);
  });

  it('parks a bot Rent charge for the human through the existing pending view', function () {
    const { room, firstBot } = makeBotRoom('rent-park');
    room.gameState.players[firstBot.playerId].properties.Brown = propGroup(firstBot.playerId, 'Brown', 2);
    room.gameState.players[firstBot.playerId].hand = [rent('bot-rent', [PropertyType.Brown, PropertyType.LightBlue])];
    room.gameState.players[room.hostPlayerId].bank = [money('human-pay', 5)];

    app.__botDriver.driveBotTurns(room.roomCode);

    assert.ok(room.gameState.pendingCharge);
    assert.strictEqual(room.gameState.pendingCharge.type, 'RENT');
    assert.strictEqual(room.gameState.pendingCharge.sourceTitle, 'Rent');
    assert.deepStrictEqual(Object.keys(room.gameState.pendingCharge.debtors), [room.hostPlayerId]);
    assert.strictEqual(room.gameState.pendingCharge.debtors[room.hostPlayerId].amountOwed, 4);

    const humanView = room_registry.toClientView(room, room.hostPlayerId);
    const botView = room_registry.toClientView(room, firstBot.playerId);
    assert.strictEqual(humanView.pendingResolution.sourceTitle, 'Rent');
    assert.strictEqual(humanView.pendingResolution.rentColor, 'Brown');
    assert.ok(humanView.pendingCharge);
    assert.strictEqual(botView.pendingResolution, undefined);
  });

  it('plays All-Color Rent against the sole opponent', function () {
    const state = botState();
    state.players.bot.properties.Green = propGroup('bot', 'Green', 3);
    state.players.bot.hand = [rent('rent-all', Object.values(PropertyType))];

    const play = turn_planner.selectRentCardPlay(state, 'bot');
    assert.ok(play);
    assert.strictEqual(play.propertyColor, 'Green');
    assert.strictEqual(play.targetPlayerId, 'human');

    const step = planRentStep(state);
    assert.ok(step);
    assert.strictEqual(step.cardId, 'rent-all');
    assert.strictEqual(step.propertyColor, 'Green');
    assert.strictEqual(step.targetPlayerId, 'human');
  });

  it('plays a standard Rent when it is the only in-scope card', function () {
    const state = botState();
    state.players.bot.properties.Orange = propGroup('bot', 'Orange', 2); // base tier 3, incomplete set
    state.players.bot.hand = [rent('rent-1', [PropertyType.Orange, PropertyType.Red])];

    const step = planRentStep(state);
    assert.ok(step);
    assert.strictEqual(step.actionCardTitle, 'Rent');
    assert.strictEqual(step.propertyColor, 'Orange');
  });

  it('attaches Double The Rent to injected Rent when 2+ plays remain', function () {
    const state = botState();
    state.players.bot.properties.Brown = propGroup('bot', 'Brown', 2);
    state.players.bot.hand = [
      rent('rent-1', [PropertyType.Brown, PropertyType.LightBlue]),
      dtr('dtr-1')
    ];

    const step = planRentStep(state);
    assert.ok(step);
    assert.strictEqual(step.cardId, 'rent-1');
    assert.strictEqual(step.doubleRentCardId, 'dtr-1');

    const replay = game_manager.applyAction(state, app.__botDriver.botStepToAction(step, 'bot'));
    assert.strictEqual(replay.legal, true);
    assert.strictEqual(replay.gameState.pendingCharge.doubled, true);
    assert.strictEqual(replay.gameState.pendingCharge.debtors.human.amountOwed, 8);
  });

  it('does not play Rent when the bot owns none of its colors', function () {
    const state = botState();
    state.players.bot.hand = [rent('rent-1', [PropertyType.Brown, PropertyType.LightBlue])];

    assert.strictEqual(turn_planner.selectRentCardPlay(state, 'bot'), null);
    assert.strictEqual(planRentStep(state), undefined);
  });

  it('does not inject Rent once the per-turn play limit is reached', function () {
    const state = botState();
    state.players.bot.properties.Brown = propGroup('bot', 'Brown', 2);
    state.players.bot.hand = [rent('rent-1', [PropertyType.Brown, PropertyType.LightBlue])];
    state.turn.playsMade = 3;

    const plan = turn_planner.planTurnActionSequence(state, 'bot');
    assert.ok(!plan.steps.some(step => step.type === 'PLAY_ACTION_CARD'));
  });

  it('keeps existing action-card precedence ahead of Rent', function () {
    const state = botState();
    state.players.bot.properties.Brown = propGroup('bot', 'Brown', 2);
    state.players.bot.hand = [
      new ActionCard('Debt Collector', 'Debt Collector fixture', 3),
      rent('rent-1', [PropertyType.Brown, PropertyType.LightBlue])
    ];
    state.players.bot.hand[0].id = 'debt-1';
    state.players.human.bank = [money('human-money', 5)];

    const plan = turn_planner.planTurnActionSequence(state, 'bot');
    const actionSteps = plan.steps.filter(step => step.type === 'PLAY_ACTION_CARD');
    assert.strictEqual(actionSteps.length, 1);
    assert.strictEqual(actionSteps[0].actionCardTitle, 'Debt Collector');
  });

  it('does not mutate the input game state', function () {
    const state = botState();
    state.players.bot.properties.Brown = propGroup('bot', 'Brown', 2);
    state.players.bot.hand = [rent('rent-1', [PropertyType.Brown, PropertyType.LightBlue])];
    const snapshot = JSON.stringify(state);

    turn_planner.selectRentCardPlay(state, 'bot');
    turn_planner.planTurnActionSequence(state, 'bot');

    assert.strictEqual(JSON.stringify(state), snapshot);
  });

  describe('All-Color Rent & Double The Rent detailed selection & replay', function () {
    const ALL_COLORS = Object.values(PropertyType);

    function botState3() {
      return actionState([
        { id: 'bot', name: 'Bot' },
        { id: 'human', name: 'Human' },
        { id: 'rival', name: 'Rival' }
      ], 'bot');
    }

    it('selectWildRentTarget targets opponent with completed set over board value', function () {
      const state = botState3();
      state.players.bot.properties.Brown = propGroup('bot', 'Brown', 2);
      state.players.human.properties.DarkBlue = propGroup('human', 'DarkBlue', 2); // 1 completed set
      state.players.rival.properties.Green = propGroup('rival', 'Green', 2); // 0 completed set, board value 2

      const target = turn_planner.selectWildRentTarget(state, 'bot');
      assert.strictEqual(target, 'human');
    });

    it('selectWildRentTarget breaks completed set tie by board value', function () {
      const state = botState3();
      state.players.human.properties.Green = propGroup('human', 'Green', 2); // value 2
      state.players.rival.properties.Green = propGroup('rival', 'Green', 1); // value 1

      const target = turn_planner.selectWildRentTarget(state, 'bot');
      assert.strictEqual(target, 'human');
    });

    it('selectWildRentTarget breaks full tie by turn order', function () {
      const state = botState3();
      state.players.human.properties.Brown = propGroup('human', 'Brown', 1);
      state.players.rival.properties.Brown = propGroup('rival', 'Brown', 1);

      const target = turn_planner.selectWildRentTarget(state, 'bot');
      assert.strictEqual(target, 'human'); // human comes before rival in turnOrder
    });

    it('does not attach DTR when only 1 play remains in turn', function () {
      const state = botState();
      state.players.bot.properties.Brown = propGroup('bot', 'Brown', 2);
      state.players.bot.hand = [
        rent('rent-1', [PropertyType.Brown, PropertyType.LightBlue]),
        dtr('dtr-1')
      ];
      state.turn.playsMade = 2; // 1 play remaining

      const step = planRentStep(state);
      assert.ok(step);
      assert.strictEqual(step.cardId, 'rent-1');
      assert.strictEqual(step.doubleRentCardId, undefined);
    });

    it('botStepToAction forwards doubleRentCardId and targetPlayerId correctly', function () {
      const step = {
        type: 'PLAY_ACTION_CARD',
        cardId: 'wild-1',
        propertyColor: 'Green',
        targetPlayerId: 'human',
        doubleRentCardId: 'dtr-1',
        actionCardTitle: 'Rent'
      };
      const action = app.__botDriver.botStepToAction(step, 'bot');
      assert.strictEqual(action.type, 'PLAY_ACTION_CARD');
      assert.strictEqual(action.propertyColor, 'Green');
      assert.strictEqual(action.targetPlayerId, 'human');
      assert.strictEqual(action.doubleRentCardId, 'dtr-1');
    });

    it('e2e driveBotTurns plays All-Color Rent + Double The Rent and parks doubled charge', function () {
      const { room, firstBot } = makeBotRoom('wild-dtr-e2e');
      room.gameState.players[firstBot.playerId].properties.Green = propGroup(firstBot.playerId, 'Green', 3); // base 7 x2 = 14
      room.gameState.players[firstBot.playerId].hand = [
        rent('bot-wild', ALL_COLORS),
        dtr('bot-dtr')
      ];
      room.gameState.turn.playsMade = 0;
      room.gameState.players[room.hostPlayerId].bank = [money('human-bank', 30)];

      app.__botDriver.driveBotTurns(room.roomCode);

      assert.ok(room.gameState.pendingCharge);
      assert.strictEqual(room.gameState.pendingCharge.type, 'RENT');
      assert.strictEqual(room.gameState.pendingCharge.doubled, true);
      assert.strictEqual(room.gameState.pendingCharge.rentColor, 'Green');
      assert.deepStrictEqual(Object.keys(room.gameState.pendingCharge.debtors), [room.hostPlayerId]);
      assert.strictEqual(room.gameState.pendingCharge.debtors[room.hostPlayerId].amountOwed, 28); // 14 x 2 = 28
      assert.strictEqual(room.gameState.turn.playsMade, 2);

      const clientView = room_registry.toClientView(room, room.hostPlayerId);
      assert.strictEqual(clientView.pendingResolution.rentColor, 'Green');
      assert.strictEqual(clientView.pendingResolution.amountOwed, 28);
    });
  });
});
