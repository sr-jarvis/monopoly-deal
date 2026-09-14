'use strict';

const assert = require('assert');
const game_manager = require('../game_manager');
const room_registry = require('../room_registry');
const turn_planner = require('../turn_planner');
const { ACTION_TYPES, PHASES } = require('../rules_validator');
const ActionCard = require('../models/ActionCard');
const MoneyCard = require('../models/MoneyCard');

function actionCard(title, id, value = 1) {
  const card = new ActionCard(title, `${title} fixture`, value);
  card.id = id;
  return card;
}

function money(id, value) {
  const card = new MoneyCard(`${value}M`, value);
  card.id = id;
  return card;
}

function actionState(players, actorId) {
  const state = game_manager.createGameState(players);
  const drawn = game_manager.applyAction(state, { type: ACTION_TYPES.DRAW, playerId: actorId, count: 2 });
  assert.strictEqual(drawn.legal, true);
  return drawn.gameState;
}

function makeBotRoom(label, botCount = 1) {
  const room = room_registry.createRoom(`human-${label}`, `Human ${label}`);
  for (let index = 0; index < botCount; index += 1) {
    const result = room_registry.addBotSeat(room.roomCode, `Bot ${index + 1}`);
    assert.ok(!result.error);
  }
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

describe('Solo bot action cards', function () {
  afterEach(function () {
    for (const room of room_registry.listRooms()) {
      if (room.roomCode) room_registry.deleteRoom(room.roomCode);
    }
  });

  it('plans Pass Go as PLAY_ACTION_CARD, draws two, and discards it', function () {
    let state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    state.players.bot.hand = [actionCard('Pass Go', 'pass-go')];
    state.drawPile = [money('draw-a', 1), money('draw-b', 2)];

    const plan = turn_planner.planTurnActionSequence(state, 'bot');
    const play = plan.steps.find(step => step.type === 'PLAY_ACTION_CARD');
    assert.ok(play);
    assert.strictEqual(play.cardId, 'pass-go');
    // The authoritative Pass Go draw/discard contract is covered in pass_go.test.js;
    // this planner test proves the bot reaches that action path rather than banking it.
  });

  it('selects the richest valid Debt Collector opponent deterministically', function () {
    const state = actionState([
      { id: 'bot', name: 'Bot' }, { id: 'first', name: 'First' }, { id: 'rich', name: 'Rich' }
    ], 'bot');
    state.players.first.bank = [money('first-money', 2)];
    state.players.rich.bank = [money('rich-money', 5)];
    assert.strictEqual(turn_planner.selectDebtCollectorTarget(state, 'bot'), 'rich');
    state.players.rich.bank = [money('rich-tie', 2)];
    assert.strictEqual(turn_planner.selectDebtCollectorTarget(state, 'bot'), 'first');
  });

  it('plans Debt Collector then parks without blocked tail steps', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    state.players.bot.hand = [actionCard('Debt Collector', 'debt-collector', 3)];
    state.players.human.bank = [money('human-five', 5)];

    const plan = turn_planner.planTurnActionSequence(state, 'bot');
    assert.strictEqual(plan.steps[0].type, 'PLAY_ACTION_CARD');
    assert.strictEqual(plan.steps[0].targetPlayerId, 'human');
    assert.ok(!plan.steps.some(step => step.type === 'BLOCKED'));
  });

  it('drives a bot-created human debt into the existing pending-resolution view', function () {
    const app = require('../app');
    const { room, firstBot } = makeBotRoom('park');
    room.gameState.players[firstBot.playerId].hand = [actionCard('Debt Collector', 'bot-debt', 3)];
    room.gameState.players[room.hostPlayerId].bank = [money('human-pay', 5)];

    app.__botDriver.driveBotTurns(room.roomCode);

    assert.ok(room.gameState.pendingCharge);
    assert.strictEqual(room.gameState.pendingCharge.fromPlayerId, firstBot.playerId);
    assert.strictEqual(room.gameState.pendingCharge.debtors[room.hostPlayerId].amountOwed, 5);
    const humanView = room_registry.toClientView(room, room.hostPlayerId);
    const botView = room_registry.toClientView(room, firstBot.playerId);
    assert.strictEqual(humanView.pendingResolution.sourceTitle, 'Debt Collector');
    assert.ok(humanView.pendingCharge);
    assert.strictEqual(botView.pendingResolution, undefined);
  });

  it('auto-settles bot-to-bot Debt Collector without exposing a human debtor', function () {
    const app = require('../app');
    const { room, firstBot } = makeBotRoom('settle', 2);
    const secondBot = room.seats.filter(seat => seat.isBot)[1];
    room.gameState.players[firstBot.playerId].hand = [actionCard('Debt Collector', 'bot-debt-two', 3)];
    room.gameState.players[secondBot.playerId].bank = [money('second-bot-pay', 5)];

    const charged = game_manager.applyAction(room.gameState, {
      type: ACTION_TYPES.PLAY_ACTION_CARD,
      playerId: firstBot.playerId,
      cardId: 'bot-debt-two',
      targetPlayerId: secondBot.playerId
    });
    assert.strictEqual(charged.legal, true);
    room.gameState = charged.gameState;
    app.__botDriver.settlePendingBotDebts(room.roomCode);

    assert.strictEqual(room.gameState.pendingCharge, null);
    assert.ok(room.gameState.players[firstBot.playerId].bank.some(card => card.id === 'second-bot-pay'));
    assert.strictEqual(room_registry.toClientView(room, room.hostPlayerId).pendingResolution, undefined);
  });

  it('parks a Birthday charge for the human while auto-settling the other bot debtor', function () {
    const app = require('../app');
    const { room, firstBot } = makeBotRoom('birthday-fanout', 2);
    const secondBot = room.seats.filter(seat => seat.isBot)[1];
    room.gameState.players[firstBot.playerId].hand = [actionCard('Its My Birthday', 'bot-birthday', 2)];
    room.gameState.players[room.hostPlayerId].bank = [money('human-birthday-pay', 2)];
    room.gameState.players[secondBot.playerId].bank = [money('bot-birthday-pay', 2)];

    app.__botDriver.driveBotTurns(room.roomCode);

    assert.ok(room.gameState.pendingCharge);
    assert.strictEqual(room.gameState.pendingCharge.sourceTitle, 'Its My Birthday');
    assert.deepStrictEqual(Object.keys(room.gameState.pendingCharge.debtors), [room.hostPlayerId]);
    assert.strictEqual(room.gameState.pendingCharge.debtors[room.hostPlayerId].amountOwed, 2);
    assert.ok(room.gameState.players[firstBot.playerId].bank.some(card => card.id === 'bot-birthday-pay'));

    const humanView = room_registry.toClientView(room, room.hostPlayerId);
    assert.strictEqual(humanView.pendingResolution.sourceTitle, 'Its My Birthday');
    assert.strictEqual(humanView.pendingResolution.amountOwed, 2);
    assert.deepStrictEqual(humanView.pendingCharge.debtors, [{ playerId: room.hostPlayerId, amountOwed: 2 }]);
  });

  it('does not emit out-of-scope action cards through the new action lane', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    state.players.bot.hand = [actionCard('Just Say No', 'jsn-card', 4)];
    const plan = turn_planner.planTurnActionSequence(state, 'bot');
    assert.ok(!plan.steps.some(step => step.type === 'PLAY_ACTION_CARD'));
  });

  it('plans Sly Deal to steal an opponent property from an incomplete set', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    const stolenCard = { id: 'lb-1', name: 'Oriental Avenue', type: 'LightBlue', value: 1 };
    state.players.human.properties = { LightBlue: { cards: [stolenCard], hasHouse: false, hasHotel: false } };
    state.players.bot.hand = [actionCard('Sly Deal', 'sly-deal', 3)];

    const plan = turn_planner.planTurnActionSequence(state, 'bot');
    const step = plan.steps.find(s => s.type === 'PLAY_ACTION_CARD');
    assert.ok(step);
    assert.strictEqual(step.actionCardTitle, 'Sly Deal');
    assert.strictEqual(step.targetPlayerId, 'human');
    assert.strictEqual(step.targetPropertyColor, 'LightBlue');
    assert.strictEqual(step.targetCardId, 'lb-1');
  });

  it('prioritizes stealing a card that completes a set for the bot', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    const darkBlue1 = { id: 'db-1', name: 'Boardwalk', type: 'DarkBlue', value: 4 };
    const darkBlue2 = { id: 'db-2', name: 'Park Place', type: 'DarkBlue', value: 3 };
    const green1 = { id: 'gr-1', name: 'Pacific Avenue', type: 'Green', value: 2 };

    // Bot has 1 Dark Blue (needs 1 to complete)
    state.players.bot.properties = { DarkBlue: { cards: [darkBlue1], hasHouse: false, hasHotel: false } };
    state.players.bot.hand = [actionCard('Sly Deal', 'sly-deal', 3)];

    // Opponent has 1 Dark Blue (incomplete) and 1 Green (incomplete)
    state.players.human.properties = {
      DarkBlue: { cards: [darkBlue2], hasHouse: false, hasHotel: false },
      Green: { cards: [green1], hasHouse: false, hasHotel: false }
    };

    const play = turn_planner.selectSlyDealPlay(state, 'bot');
    assert.ok(play);
    assert.strictEqual(play.targetPropertyColor, 'DarkBlue');
    assert.strictEqual(play.targetCardId, 'db-2');
  });

  it('refuses to steal from a complete property set', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    const darkBlue1 = { id: 'db-1', name: 'Boardwalk', type: 'DarkBlue', value: 4 };
    const darkBlue2 = { id: 'db-2', name: 'Park Place', type: 'DarkBlue', value: 3 };

    // Opponent has a complete 2-card Dark Blue set
    state.players.human.properties = {
      DarkBlue: { cards: [darkBlue1, darkBlue2], hasHouse: false, hasHotel: false }
    };
    state.players.bot.hand = [actionCard('Sly Deal', 'sly-deal', 3)];

    const play = turn_planner.selectSlyDealPlay(state, 'bot');
    assert.strictEqual(play, null);
  });

  it('drives Sly Deal through app.__botDriver without creating a pending charge or blocking turn flow', function () {
    const app = require('../app');
    const { room, firstBot } = makeBotRoom('sly-driver');
    const stolenCard = { id: 'stolen-prop', name: 'Oriental Avenue', type: 'LightBlue', value: 1 };
    room.gameState.players[firstBot.playerId].hand = [actionCard('Sly Deal', 'sly-card', 3)];
    room.gameState.players[room.hostPlayerId].properties = {
      LightBlue: { cards: [stolenCard], hasHouse: false, hasHotel: false }
    };

    app.__botDriver.driveBotTurns(room.roomCode);

    const botState = room.gameState.players[firstBot.playerId];
    const hostState = room.gameState.players[room.hostPlayerId];

    assert.ok(botState.properties.LightBlue);
    assert.ok(botState.properties.LightBlue.cards.some(c => c.id === 'stolen-prop'));
    assert.strictEqual(hostState.properties.LightBlue, undefined);
    assert.ok(room.gameState.discardPile.some(c => c.id === 'sly-card'));
    assert.ok(!room.gameState.pendingCharge);
  });

  it('plans Deal Breaker to steal an opponent complete property set', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    const db1 = { id: 'db-1', name: 'Boardwalk', type: 'DarkBlue', value: 4 };
    const db2 = { id: 'db-2', name: 'Park Place', type: 'DarkBlue', value: 3 };
    state.players.human.properties = { DarkBlue: { cards: [db1, db2], hasHouse: false, hasHotel: false } };
    state.players.bot.hand = [actionCard('Deal Breaker', 'db-card', 5)];

    const play = turn_planner.selectDealBreakerPlay(state, 'bot');
    assert.ok(play);
    assert.strictEqual(play.targetPlayerId, 'human');
    assert.strictEqual(play.targetPropertyColor, 'DarkBlue');
    assert.strictEqual(play.actionCardTitle, 'Deal Breaker');
  });

  it('prioritizes a Deal Breaker steal that wins the game immediately', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    // Bot has 2 complete sets (needs 1 more to win)
    state.players.bot.properties = {
      Brown: { cards: [{ id: 'br-1', value: 1 }, { id: 'br-2', value: 1 }], hasHouse: false, hasHotel: false },
      DarkBlue: { cards: [{ id: 'db-1', value: 4 }, { id: 'db-2', value: 3 }], hasHouse: false, hasHotel: false }
    };
    state.players.bot.hand = [actionCard('Deal Breaker', 'db-card', 5)];

    // Opponent has Green (complete 3 cards) and Yellow (complete 3 cards)
    state.players.human.properties = {
      Green: { cards: [{ id: 'gr-1', value: 2 }, { id: 'gr-2', value: 2 }, { id: 'gr-3', value: 2 }], hasHouse: false, hasHotel: false },
      Yellow: { cards: [{ id: 'yl-1', value: 3 }, { id: 'yl-2', value: 3 }, { id: 'yl-3', value: 3 }], hasHouse: true, hasHotel: false }
    };

    const play = turn_planner.selectDealBreakerPlay(state, 'bot');
    assert.ok(play);
    assert.ok(['Green', 'Yellow'].includes(play.targetPropertyColor));
  });

  it('refuses Deal Breaker when opponent has no complete property sets', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    state.players.human.properties = {
      DarkBlue: { cards: [{ id: 'db-1', value: 4 }], hasHouse: false, hasHotel: false }
    };
    state.players.bot.hand = [actionCard('Deal Breaker', 'db-card', 5)];

    const play = turn_planner.selectDealBreakerPlay(state, 'bot');
    assert.strictEqual(play, null);
  });

  it('drives Deal Breaker through app.__botDriver, moving complete set wholesale with buildings preserved', function () {
    const app = require('../app');
    const { room, firstBot } = makeBotRoom('db-driver');
    const db1 = { id: 'db-1', name: 'Boardwalk', type: 'DarkBlue', value: 4 };
    const db2 = { id: 'db-2', name: 'Park Place', type: 'DarkBlue', value: 3 };
    room.gameState.players[firstBot.playerId].hand = [actionCard('Deal Breaker', 'db-card', 5)];
    room.gameState.players[room.hostPlayerId].properties = {
      DarkBlue: { cards: [db1, db2], hasHouse: true, hasHotel: false }
    };

    app.__botDriver.driveBotTurns(room.roomCode);

    const botState = room.gameState.players[firstBot.playerId];
    const hostState = room.gameState.players[room.hostPlayerId];

    assert.ok(botState.properties.DarkBlue);
    assert.strictEqual(botState.properties.DarkBlue.cards.length, 2);
    assert.strictEqual(botState.properties.DarkBlue.hasHouse, true);
    assert.strictEqual(hostState.properties.DarkBlue, undefined);
    assert.ok(room.gameState.discardPile.some(c => c.id === 'db-card'));
  });

  it('plans Forced Deal to swap incomplete properties with opponent', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    const myBrown = { id: 'my-br', name: 'Baltic Avenue', type: 'Brown', value: 1 };
    const oppGreen = { id: 'opp-gr', name: 'Pacific Avenue', type: 'Green', value: 2 };

    state.players.bot.properties = { Brown: { cards: [myBrown], hasHouse: false, hasHotel: false } };
    state.players.human.properties = { Green: { cards: [oppGreen], hasHouse: false, hasHotel: false } };
    state.players.bot.hand = [actionCard('Forced Deal', 'fd-card', 3)];

    const play = turn_planner.selectForcedDealPlay(state, 'bot');
    assert.ok(play);
    assert.strictEqual(play.actionCardTitle, 'Forced Deal');
    assert.strictEqual(play.targetPlayerId, 'human');
    assert.strictEqual(play.offeredCardId, 'my-br');
    assert.strictEqual(play.offeredPropertyColor, 'Brown');
    assert.strictEqual(play.requestedCardId, 'opp-gr');
    assert.strictEqual(play.requestedPropertyColor, 'Green');
  });

  it('prioritizes a Forced Deal swap that completes a set for the bot', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    const botDb1 = { id: 'bot-db1', name: 'Boardwalk', type: 'DarkBlue', value: 4 };
    const botBr1 = { id: 'bot-br1', name: 'Baltic Avenue', type: 'Brown', value: 1 };
    const oppDb2 = { id: 'opp-db2', name: 'Park Place', type: 'DarkBlue', value: 3 };
    const oppGr1 = { id: 'opp-gr1', name: 'Pacific Avenue', type: 'Green', value: 2 };

    // Bot has 1 DarkBlue (1 away from complete) and 1 Brown
    state.players.bot.properties = {
      DarkBlue: { cards: [botDb1], hasHouse: false, hasHotel: false },
      Brown: { cards: [botBr1], hasHouse: false, hasHotel: false }
    };
    // Opponent has 1 DarkBlue and 1 Green
    state.players.human.properties = {
      DarkBlue: { cards: [oppDb2], hasHouse: false, hasHotel: false },
      Green: { cards: [oppGr1], hasHouse: false, hasHotel: false }
    };
    state.players.bot.hand = [actionCard('Forced Deal', 'fd-card', 3)];

    const play = turn_planner.selectForcedDealPlay(state, 'bot');
    assert.ok(play);
    assert.strictEqual(play.requestedPropertyColor, 'DarkBlue');
    assert.strictEqual(play.requestedCardId, 'opp-db2');
    assert.strictEqual(play.offeredPropertyColor, 'Brown');
    assert.strictEqual(play.offeredCardId, 'bot-br1');
  });

  it('vetoes a Forced Deal swap that would complete a set for the opponent', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    const botDb1 = { id: 'bot-db1', name: 'Boardwalk', type: 'DarkBlue', value: 4 };
    const oppDb2 = { id: 'opp-db2', name: 'Park Place', type: 'DarkBlue', value: 3 };
    const oppGr1 = { id: 'opp-gr1', name: 'Pacific Avenue', type: 'Green', value: 2 };

    // Bot has 1 DarkBlue
    state.players.bot.properties = { DarkBlue: { cards: [botDb1], hasHouse: false, hasHotel: false } };
    // Opponent has 1 DarkBlue and 1 Green.
    // If bot offers DarkBlue to opponent for Green, opponent gets a complete DarkBlue set (2/2)!
    state.players.human.properties = {
      DarkBlue: { cards: [oppDb2], hasHouse: false, hasHotel: false },
      Green: { cards: [oppGr1], hasHouse: false, hasHotel: false }
    };
    state.players.bot.hand = [actionCard('Forced Deal', 'fd-card', 3)];

    const play = turn_planner.selectForcedDealPlay(state, 'bot');
    // Offering DarkBlue to human completes human's DarkBlue set, so it's vetoed!
    assert.strictEqual(play, null);
  });

  it('vetoes a same-color Forced Deal swap with no value gain', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    const botGr1 = { id: 'bot-gr1', name: 'Pacific Avenue', type: 'Green', value: 2 };
    const oppGr2 = { id: 'opp-gr2', name: 'North Carolina Avenue', type: 'Green', value: 2 };

    state.players.bot.properties = { Green: { cards: [botGr1], hasHouse: false, hasHotel: false } };
    state.players.human.properties = { Green: { cards: [oppGr2], hasHouse: false, hasHotel: false } };
    state.players.bot.hand = [actionCard('Forced Deal', 'fd-card', 3)];

    const play = turn_planner.selectForcedDealPlay(state, 'bot');
    assert.strictEqual(play, null);
  });

  it('drives Forced Deal through app.__botDriver, cleanly swapping properties and updating colors', function () {
    const app = require('../app');
    const { room, firstBot } = makeBotRoom('fd-driver');
    const myBrown = { id: 'my-br', name: 'Baltic Avenue', type: 'Brown', value: 1 };
    const oppGreen = { id: 'opp-gr', name: 'Pacific Avenue', type: 'Green', value: 2 };

    room.gameState.players[firstBot.playerId].properties = { Brown: { cards: [myBrown], hasHouse: false, hasHotel: false } };
    room.gameState.players[room.hostPlayerId].properties = { Green: { cards: [oppGreen], hasHouse: false, hasHotel: false } };
    room.gameState.players[firstBot.playerId].hand = [actionCard('Forced Deal', 'fd-card', 3)];

    app.__botDriver.driveBotTurns(room.roomCode);

    const botState = room.gameState.players[firstBot.playerId];
    const hostState = room.gameState.players[room.hostPlayerId];

    assert.ok(botState.properties.Green);
    assert.ok(botState.properties.Green.cards.some(c => c.id === 'opp-gr'));
    assert.strictEqual(botState.properties.Brown, undefined);

    assert.ok(hostState.properties.Brown);
    assert.ok(hostState.properties.Brown.cards.some(c => c.id === 'my-br'));
    assert.strictEqual(hostState.properties.Green, undefined);

    assert.ok(room.gameState.discardPile.some(c => c.id === 'fd-card'));
  });

  it('maintains deterministic plan output over 50 repetitions', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    state.players.bot.hand = [
      actionCard('Pass Go', 'pg-1'),
      actionCard('Sly Deal', 'sly-1', 3),
      actionCard('Forced Deal', 'fd-1', 3),
      actionCard('Deal Breaker', 'db-1', 5)
    ];
    state.players.human.properties = {
      DarkBlue: { cards: [{ id: 'db-a', value: 4 }, { id: 'db-b', value: 3 }], hasHouse: false, hasHotel: false },
      Green: { cards: [{ id: 'gr-a', value: 2 }], hasHouse: false, hasHotel: false }
    };
    state.players.bot.properties = {
      Brown: { cards: [{ id: 'br-a', value: 1 }], hasHouse: false, hasHotel: false }
    };

    const firstPlan = JSON.stringify(turn_planner.planTurnActionSequence(state, 'bot'));
    for (let i = 0; i < 50; i++) {
      const stateClone = JSON.parse(JSON.stringify(state));
      const plan = JSON.stringify(turn_planner.planTurnActionSequence(stateClone, 'bot'));
      assert.strictEqual(plan, firstPlan);
    }
  });

  it('follows action card precedence: Pass Go -> Deal Breaker -> Sly Deal -> Forced Deal -> House -> Hotel -> Birthday -> Debt Collector -> Rent', function () {
    const state = actionState([{ id: 'bot', name: 'Bot' }, { id: 'human', name: 'Human' }], 'bot');
    state.players.bot.hand = [
      actionCard('Forced Deal', 'fd-1', 3),
      actionCard('Pass Go', 'pg-1', 1),
      actionCard('Sly Deal', 'sly-1', 3),
      actionCard('Deal Breaker', 'db-1', 5)
    ];
    state.players.human.properties = {
      DarkBlue: { cards: [{ id: 'db-a', value: 4 }, { id: 'db-b', value: 3 }], hasHouse: false, hasHotel: false },
      Green: { cards: [{ id: 'gr-a', value: 2 }], hasHouse: false, hasHotel: false }
    };
    state.players.bot.properties = {
      Brown: { cards: [{ id: 'br-a', value: 1 }], hasHouse: false, hasHotel: false }
    };

    // 1st play should be Pass Go
    const play1 = turn_planner.selectActionCardPlay(state, 'bot');
    assert.strictEqual(play1.actionCardTitle, 'Pass Go');

    // Remove Pass Go -> 2nd play should be Deal Breaker (stealing complete Dark Blue)
    state.players.bot.hand = state.players.bot.hand.filter(c => c.id !== 'pg-1');
    const play2 = turn_planner.selectActionCardPlay(state, 'bot');
    assert.strictEqual(play2.actionCardTitle, 'Deal Breaker');

    // Remove Deal Breaker -> 3rd play should be Sly Deal (stealing Green)
    state.players.bot.hand = state.players.bot.hand.filter(c => c.id !== 'db-1');
    const play3 = turn_planner.selectActionCardPlay(state, 'bot');
    assert.strictEqual(play3.actionCardTitle, 'Sly Deal');

    // Remove Sly Deal -> 4th play should be Forced Deal
    state.players.bot.hand = state.players.bot.hand.filter(c => c.id !== 'sly-1');
    const play4 = turn_planner.selectActionCardPlay(state, 'bot');
    assert.strictEqual(play4.actionCardTitle, 'Forced Deal');
  });
});
